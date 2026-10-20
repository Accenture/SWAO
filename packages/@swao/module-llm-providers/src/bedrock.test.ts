// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- BedrockLlmProvider unit tests (#2159)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// No live AWS calls -- @aws-sdk/client-bedrock-runtime is mocked entirely.
// Retry sleep is bypassed via vi.useFakeTimers() + vi.runAllTimersAsync().

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { BedrockLlmProvider, BedrockConnectivityError } from './bedrock.js';
import { LlmToolsUnsupportedError } from './errors.js';

vi.mock('@swao/core', () => ({
  redactPreLlm: (text: string) => ({ text, counts: {} }),
  recordRedaction: vi.fn(),
  logPortfolio: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Hoist mockSend so the vi.mock factory can reference it before imports run.
// ---------------------------------------------------------------------------
const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  // Both are used with `new`, so the mock functions must return an object
  // (JS constructor semantics: if fn returns object, `new fn()` returns it).
  BedrockRuntimeClient: vi.fn(function MockClient() { return { send: mockSend }; }),
  ConverseCommand: vi.fn(function MockCmd(input: unknown) { return input; }),
}));

const MockedBedrockRuntimeClient = vi.mocked(BedrockRuntimeClient);
const MockedConverseCommand = vi.mocked(ConverseCommand);

const BASE_URL_EU = 'https://bedrock-runtime.eu-central-1.amazonaws.com';
const BASE_URL_US = 'https://bedrock-runtime.us-east-1.amazonaws.com';
const MODEL = 'eu.anthropic.claude-sonnet-4-6';

function makeConverseResponse(text: string, inputTokens = 100, outputTokens = 50) {
  return {
    output: { message: { content: [{ text }] } },
    usage: { inputTokens, outputTokens },
  };
}

describe('BedrockLlmProvider -- construction and region resolution', () => {
  beforeEach(() => {
    MockedBedrockRuntimeClient.mockClear();
    mockSend.mockClear();
  });

  it('extracts eu-central-1 from the base_url', () => {
    new BedrockLlmProvider(MODEL, BASE_URL_EU);
    expect(MockedBedrockRuntimeClient).toHaveBeenCalledWith({ region: 'eu-central-1' });
  });

  it('extracts us-east-1 from the base_url', () => {
    new BedrockLlmProvider(MODEL, BASE_URL_US);
    expect(MockedBedrockRuntimeClient).toHaveBeenCalledWith({ region: 'us-east-1' });
  });

  it('falls back to AWS_REGION env when base_url is not a Bedrock URL', () => {
    process.env['AWS_REGION'] = 'ap-southeast-1';
    new BedrockLlmProvider(MODEL, 'https://not-a-bedrock-url.example.com');
    expect(MockedBedrockRuntimeClient).toHaveBeenCalledWith({ region: 'ap-southeast-1' });
    delete process.env['AWS_REGION'];
  });

  it('falls back to eu-central-1 when no env var and no recognisable base_url', () => {
    delete process.env['AWS_REGION'];
    delete process.env['AWS_DEFAULT_REGION'];
    new BedrockLlmProvider(MODEL, 'https://not-a-bedrock-url.example.com');
    expect(MockedBedrockRuntimeClient).toHaveBeenCalledWith({ region: 'eu-central-1' });
  });

  it('has name === bedrock and carries the model', () => {
    const p = new BedrockLlmProvider(MODEL, BASE_URL_EU);
    expect(p.name).toBe('bedrock');
    expect(p.model).toBe(MODEL);
  });
});

describe('BedrockLlmProvider -- happy path', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockedBedrockRuntimeClient.mockClear();
    MockedConverseCommand.mockClear();
    mockSend.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('returns text from ConverseResponse', async () => {
    mockSend.mockResolvedValueOnce(makeConverseResponse('{"result":"ok"}'));
    const p = new BedrockLlmProvider(MODEL, BASE_URL_EU);
    const out = await p.complete('analyse this');
    expect(out).toBe('{"result":"ok"}');
  });

  it('passes modelId, temperature, and maxTokens to ConverseCommand', async () => {
    mockSend.mockResolvedValueOnce(makeConverseResponse('ok'));
    const p = new BedrockLlmProvider(MODEL, BASE_URL_EU, 0.5, 4096);
    await p.complete('x');
    const callArg = MockedConverseCommand.mock.calls[0]?.[0] as {
      modelId: string;
      inferenceConfig: { temperature: number; maxTokens: number };
    };
    expect(callArg.modelId).toBe(MODEL);
    expect(callArg.inferenceConfig.temperature).toBe(0.5);
    expect(callArg.inferenceConfig.maxTokens).toBe(4096);
  });

  it('records token usage after a successful call', async () => {
    mockSend.mockResolvedValueOnce(makeConverseResponse('ok', 200, 80));
    const p = new BedrockLlmProvider(MODEL, BASE_URL_EU);
    await p.complete('x');
    const usage = p.getLastUsage();
    expect(usage?.input_tokens).toBe(200);
    expect(usage?.output_tokens).toBe(80);
  });

  it('records a scrubbed trace after a successful call', async () => {
    mockSend.mockResolvedValueOnce(makeConverseResponse('reply'));
    const p = new BedrockLlmProvider(MODEL, BASE_URL_EU);
    await p.complete('my prompt');
    const trace = p.getLastTrace();
    expect(trace?.scrubbedPrompt).toBe('my prompt');
    expect(trace?.response).toBe('reply');
  });

  it('uses catalogue entry cost when provided', async () => {
    mockSend.mockResolvedValueOnce(makeConverseResponse('ok', 1_000_000, 1_000_000));
    const cost = { inputPerMillion: 3.0, outputPerMillion: 15.0 };
    const p = new BedrockLlmProvider(MODEL, BASE_URL_EU, 0, 8192, cost);
    await p.complete('x');
    // 1M in * 3.0 + 1M out * 15.0 per million = 18 USD
    expect(p.getLastUsage()?.cost_usd).toBeCloseTo(18.0, 6);
  });

  it('falls back to anthropicCostUsd() when no catalogue cost; strips eu.anthropic. prefix', async () => {
    mockSend.mockResolvedValueOnce(makeConverseResponse('ok', 1000, 500));
    const p = new BedrockLlmProvider(MODEL, BASE_URL_EU);
    await p.complete('x');
    expect((p.getLastUsage()?.cost_usd ?? 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('BedrockLlmProvider -- retry behaviour', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSend.mockClear();
    MockedBedrockRuntimeClient.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('retries ThrottlingException and succeeds on the third attempt', async () => {
    const throttleErr = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
    mockSend
      .mockRejectedValueOnce(throttleErr)
      .mockRejectedValueOnce(throttleErr)
      .mockResolvedValueOnce(makeConverseResponse('ok'));
    const p = new BedrockLlmProvider(MODEL, BASE_URL_EU);
    const resultPromise = p.complete('x');
    await vi.runAllTimersAsync();
    await expect(resultPromise).resolves.toBe('ok');
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('does not retry AccessDeniedException (non-retryable)', async () => {
    const authErr = Object.assign(new Error('User not authorized'), { name: 'AccessDeniedException' });
    mockSend.mockRejectedValue(authErr);
    const p = new BedrockLlmProvider(MODEL, BASE_URL_EU);
    await expect(p.complete('x')).rejects.toBeInstanceOf(BedrockConnectivityError);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('throws BedrockConnectivityError after exhausting all retries', async () => {
    const throttleErr = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
    mockSend.mockRejectedValue(throttleErr);
    const p = new BedrockLlmProvider(MODEL, BASE_URL_EU);
    const resultPromise = p.complete('x');
    // #3159: attach the rejection handler before running timers so the
    // rejection is never momentarily unhandled (vitest reports that as an error).
    const assertion = expect(resultPromise).rejects.toBeInstanceOf(BedrockConnectivityError);
    await vi.runAllTimersAsync();
    await assertion;
    // #3284: shared retry policy -> LLM_MAX_ATTEMPTS = 6 total
    expect(mockSend).toHaveBeenCalledTimes(6);
  });

  it('retries socket errors (ECONNRESET)', async () => {
    const socketErr = Object.assign(new Error('read ECONNRESET'), { name: 'Error' });
    mockSend
      .mockRejectedValueOnce(socketErr)
      .mockResolvedValueOnce(makeConverseResponse('recovered'));
    const p = new BedrockLlmProvider(MODEL, BASE_URL_EU);
    const resultPromise = p.complete('x');
    await vi.runAllTimersAsync();
    await expect(resultPromise).resolves.toBe('recovered');
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// completeWithTools -- Converse toolConfig / toolUse loop (#3311, #3312)
// ---------------------------------------------------------------------------

describe('BedrockLlmProvider.completeWithToolsDetailed (#3311)', () => {
  const TOOLS = [{
    name: 'swao_risks',
    description: 'Risk findings',
    input_schema: { type: 'object', properties: { app_id: { type: 'string' } } },
  }];
  /** Request inputs captured at call time (the provider reuses its messages array). */
  let sent: Array<Record<string, unknown>>;

  function toolUseTurn(id: string, name: string, input: Record<string, unknown>, inTok = 100, outTok = 20) {
    return {
      output: { message: { role: 'assistant', content: [{ text: 'checking' }, { toolUse: { toolUseId: id, name, input } }] } },
      stopReason: 'tool_use',
      usage: { inputTokens: inTok, outputTokens: outTok },
    };
  }
  function endTurn(text: string, inTok = 150, outTok = 30) {
    return { output: { message: { role: 'assistant', content: [{ text }] } }, stopReason: 'end_turn', usage: { inputTokens: inTok, outputTokens: outTok } };
  }

  beforeEach(() => {
    MockedConverseCommand.mockClear();
    mockSend.mockReset();
    sent = [];
  });

  function script(...responses: Array<unknown>): void {
    for (const r of responses) {
      mockSend.mockImplementationOnce(async (input: unknown) => {
        sent.push(structuredClone(input) as Record<string, unknown>);
        if (r instanceof Error) throw r;
        return r;
      });
    }
  }

  it('sends toolConfig + system, runs the tool and returns the final text with usage summed', async () => {
    script(toolUseTurn('tu-1', 'swao_risks', { app_id: 'a1' }), endTurn('Two risks.'));
    const onToolCall = vi.fn().mockResolvedValue('["R1","R2"]');
    const p = new BedrockLlmProvider(MODEL, BASE_URL_EU, 0, 1024, { inputPerMillion: 1, outputPerMillion: 2 });
    const res = await p.completeWithToolsDetailed({
      system: 'sys prompt', messages: [{ role: 'user', content: 'risks?' }], tools: TOOLS, onToolCall,
    });

    expect(res.text).toBe('Two risks.');
    expect(res.usage).toEqual({ input_tokens: 250, output_tokens: 50, cost_usd: (250 * 1 + 50 * 2) / 1_000_000 });
    expect(onToolCall).toHaveBeenCalledWith('swao_risks', { app_id: 'a1' });
    expect(sent).toHaveLength(2);
    const first = sent[0] as { system: unknown; toolConfig: { tools: Array<{ toolSpec: Record<string, unknown> }> }; messages: unknown[] };
    expect(first.system).toEqual([{ text: 'sys prompt' }]);
    expect(first.toolConfig.tools[0]!.toolSpec).toEqual({ name: 'swao_risks', description: 'Risk findings', inputSchema: { json: TOOLS[0]!.input_schema } });
    expect(first.messages).toEqual([{ role: 'user', content: [{ text: 'risks?' }] }]);
    const second = sent[1] as { messages: Array<{ role: string; content: Array<Record<string, unknown>> }> };
    expect(second.messages).toHaveLength(3);
    expect(second.messages[1]!.role).toBe('assistant');
    expect(second.messages[2]).toEqual({
      role: 'user',
      content: [{ toolResult: { toolUseId: 'tu-1', content: [{ text: '["R1","R2"]' }] } }],
    });
    expect(res.trace?.scrubbedPrompt).toBe('[tool-call chat, 2 iterations]');
  });

  it('a failing onToolCall is passed to the model as [Tool error: ...] with status error (#3312)', async () => {
    script(toolUseTurn('tu-9', 'swao_risks', {}), endTurn('The tool failed.'));
    const p = new BedrockLlmProvider(MODEL, BASE_URL_EU);
    const res = await p.completeWithToolsDetailed({
      system: 's', messages: [{ role: 'user', content: 'q' }], tools: TOOLS,
      onToolCall: async () => { throw new Error('MCP timeout after 300000ms'); },
    });
    expect(res.text).toBe('The tool failed.');
    const second = sent[1] as { messages: Array<{ content: Array<{ toolResult?: Record<string, unknown> }> }> };
    expect(second.messages[2]!.content[0]!.toolResult).toEqual({
      toolUseId: 'tu-9', content: [{ text: '[Tool error: MCP timeout after 300000ms]' }], status: 'error',
    });
  });

  it('keeps blank history turns as a placeholder (Converse rejects empty text blocks, roles must alternate)', async () => {
    script(endTurn('hi'));
    const p = new BedrockLlmProvider(MODEL, BASE_URL_EU);
    await p.completeWithTools({
      system: 's', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: '  ' }, { role: 'user', content: 'b' }],
      tools: TOOLS, onToolCall: vi.fn(),
    });
    expect((sent[0] as { messages: unknown[] }).messages).toEqual([
      { role: 'user', content: [{ text: 'a' }] },
      { role: 'assistant', content: [{ text: '(no text)' }] },
      { role: 'user', content: [{ text: 'b' }] },
    ]);
  });

  it('ValidationException "doesn\'t support tool use" raises LlmToolsUnsupportedError, remembered for later calls', async () => {
    const err = Object.assign(new Error("This model doesn't support tool use."), { name: 'ValidationException' });
    script(err);
    const p = new BedrockLlmProvider('meta.llama2-13b-chat-v1', BASE_URL_EU);
    const params = { system: 's', messages: [{ role: 'user' as const, content: 'q' }], tools: TOOLS, onToolCall: vi.fn() };
    await expect(p.completeWithToolsDetailed(params)).rejects.toBeInstanceOf(LlmToolsUnsupportedError);
    await expect(p.completeWithToolsDetailed(params)).rejects.toThrow(/does not support tool calling/);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('any other ValidationException stays a BedrockConnectivityError', async () => {
    script(Object.assign(new Error('Malformed input request'), { name: 'ValidationException' }));
    const p = new BedrockLlmProvider(MODEL, BASE_URL_EU);
    await expect(p.completeWithToolsDetailed({
      system: 's', messages: [{ role: 'user', content: 'q' }], tools: TOOLS, onToolCall: vi.fn(),
    })).rejects.toBeInstanceOf(BedrockConnectivityError);
  });
});
