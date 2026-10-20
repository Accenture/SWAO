// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- OllamaLlmProvider tool-calling tests (#3311)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// No network: global fetch is stubbed in every test.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { OllamaLlmProvider } from './ollama.js';
import { LlmToolsUnsupportedError } from './errors.js';
import type { LlmTool } from './types.js';

const TOOLS: LlmTool[] = [{
  name: 'swao_risks',
  description: 'Risk findings',
  input_schema: { type: 'object', properties: { app_id: { type: 'string' } } },
}];

type Json = Record<string, unknown>;

function ok(body: Json): Partial<Response> {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body };
}

function toolTurn(calls: Array<{ name: string; args: unknown }>, inTok = 40, outTok = 10): Partial<Response> {
  return ok({
    message: { role: 'assistant', content: '', tool_calls: calls.map(c => ({ function: { name: c.name, arguments: c.args } })) },
    prompt_eval_count: inTok,
    eval_count: outTok,
  });
}

function textTurn(content: string, inTok = 60, outTok = 15): Partial<Response> {
  return ok({ message: { role: 'assistant', content }, prompt_eval_count: inTok, eval_count: outTok });
}

/** Stub fetch with the given responses; returns the parsed request bodies. */
function stubFetch(...responses: Array<Partial<Response>>): { bodies: Json[]; urls: string[]; mock: ReturnType<typeof vi.fn> } {
  const bodies: Json[] = [];
  const urls: string[] = [];
  const mock = vi.fn();
  for (const r of responses) {
    mock.mockImplementationOnce(async (url: string, init: { body: string }) => {
      urls.push(url);
      bodies.push(JSON.parse(init.body) as Json);
      return r as Response;
    });
  }
  vi.stubGlobal('fetch', mock);
  return { bodies, urls, mock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OllamaLlmProvider.completeWithToolsDetailed (#3311)', () => {
  it('posts /api/chat with OpenAI-format tools, runs the tool, returns the final text with usage summed', async () => {
    const { bodies, urls } = stubFetch(
      toolTurn([{ name: 'swao_risks', args: { app_id: 'a1' } }]),
      textTurn('Two risks.'),
    );
    const onToolCall = vi.fn().mockResolvedValue('["R1","R2"]');
    const p = new OllamaLlmProvider('qwen3:8b', 'http://ollama.test:11434', 0, undefined, { inputPerMillion: 1, outputPerMillion: 2 });
    const res = await p.completeWithToolsDetailed({
      system: 'sys prompt', messages: [{ role: 'user', content: 'risks?' }], tools: TOOLS, onToolCall,
    });

    expect(res.text).toBe('Two risks.');
    expect(res.usage).toEqual({ input_tokens: 100, output_tokens: 25, cost_usd: (100 * 1 + 25 * 2) / 1_000_000 });
    expect(res.trace?.scrubbedPrompt).toBe('[tool-call chat, 2 iterations]');
    expect(onToolCall).toHaveBeenCalledWith('swao_risks', { app_id: 'a1' });

    expect(urls).toEqual(['http://ollama.test:11434/api/chat', 'http://ollama.test:11434/api/chat']);
    const first = bodies[0]!;
    expect(first['model']).toBe('qwen3:8b');
    expect(first['stream']).toBe(false);
    expect(first).not.toHaveProperty('format');
    expect(first['tools']).toEqual([{
      type: 'function',
      function: { name: 'swao_risks', description: 'Risk findings', parameters: TOOLS[0]!.input_schema },
    }]);
    expect(first['messages']).toEqual([
      { role: 'system', content: 'sys prompt' },
      { role: 'user', content: 'risks?' },
    ]);
    const second = bodies[1]!['messages'] as Json[];
    expect(second).toHaveLength(4);
    expect(second[2]).toMatchObject({ role: 'assistant', tool_calls: [{ function: { name: 'swao_risks' } }] });
    expect(second[3]).toEqual({ role: 'tool', tool_name: 'swao_risks', content: '["R1","R2"]' });
  });

  it('accepts tool arguments sent as a JSON string', async () => {
    stubFetch(toolTurn([{ name: 'swao_risks', args: '{"app_id":"a2"}' }]), textTurn('ok'));
    const onToolCall = vi.fn().mockResolvedValue('x');
    await new OllamaLlmProvider('m', 'http://ollama.test').completeWithTools({
      system: 's', messages: [{ role: 'user', content: 'q' }], tools: TOOLS, onToolCall,
    });
    expect(onToolCall).toHaveBeenCalledWith('swao_risks', { app_id: 'a2' });
  });

  it('no tool calls: returns the content without invoking onToolCall', async () => {
    stubFetch(textTurn('Direct.'));
    const onToolCall = vi.fn();
    const text = await new OllamaLlmProvider('m', 'http://ollama.test').completeWithTools({
      system: 's', messages: [{ role: 'user', content: 'q' }], tools: TOOLS, onToolCall,
    });
    expect(text).toBe('Direct.');
    expect(onToolCall).not.toHaveBeenCalled();
  });

  it('a failing onToolCall is passed to the model as [Tool error: ...] (#3312)', async () => {
    const { bodies } = stubFetch(toolTurn([{ name: 'swao_risks', args: {} }]), textTurn('The tool failed.'));
    const res = await new OllamaLlmProvider('m', 'http://ollama.test').completeWithToolsDetailed({
      system: 's', messages: [{ role: 'user', content: 'q' }], tools: TOOLS,
      onToolCall: async () => { throw new Error('MCP timeout after 300000ms'); },
    });
    expect(res.text).toBe('The tool failed.');
    const msgs = bodies[1]!['messages'] as Json[];
    expect(msgs[3]).toEqual({ role: 'tool', tool_name: 'swao_risks', content: '[Tool error: MCP timeout after 300000ms]' });
  });

  it('HTTP 400 "does not support tools" raises LlmToolsUnsupportedError without retry, remembered for later calls', async () => {
    const { mock } = stubFetch({
      ok: false, status: 400, statusText: 'Bad Request',
      text: async () => '{"error":"registry.ollama.ai/library/gemma:2b does not support tools"}',
    });
    const p = new OllamaLlmProvider('gemma:2b', 'http://ollama.test');
    const params = { system: 's', messages: [{ role: 'user' as const, content: 'q' }], tools: TOOLS, onToolCall: vi.fn() };
    await expect(p.completeWithToolsDetailed(params)).rejects.toBeInstanceOf(LlmToolsUnsupportedError);
    await expect(p.completeWithTools(params)).rejects.toThrow('Model gemma:2b (ollama) does not support tool calling');
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('any other HTTP 400 stays an HTTP error', async () => {
    stubFetch({ ok: false, status: 400, statusText: 'Bad Request', text: async () => '{"error":"invalid message"}' });
    await expect(new OllamaLlmProvider('m', 'http://ollama.test').completeWithTools({
      system: 's', messages: [{ role: 'user', content: 'q' }], tools: TOOLS, onToolCall: vi.fn(),
    })).rejects.toThrow(/Ollama tool-call failed: 400/);
  });

  it('max iterations guard: returns the sentinel after maxIterations tool rounds', async () => {
    const mock = vi.fn(async () => toolTurn([{ name: 'swao_risks', args: {} }]) as Response);
    vi.stubGlobal('fetch', mock);
    const onToolCall = vi.fn().mockResolvedValue('r');
    const text = await new OllamaLlmProvider('m', 'http://ollama.test').completeWithTools({
      system: 's', messages: [{ role: 'user', content: 'q' }], tools: TOOLS, onToolCall, maxIterations: 2,
    });
    expect(text).toBe('[tool-calling loop exceeded max iterations]');
    expect(mock).toHaveBeenCalledTimes(2);
  });
});
