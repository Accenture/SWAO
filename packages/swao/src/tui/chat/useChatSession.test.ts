// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Unit tests for extractProseFromResponse, formatChatPrompt (#2786 follow-up), and
// readSwaoYmlConnectorId (#2895).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractProseFromResponse, formatChatPrompt, readSwaoYmlConnectorId, runChatCompletion, toolsUnsupportedNotice } from './useChatSession.js';
import { requestLlmWithRetry, LlmHttpStatusError, LlmToolsUnsupportedError, LLM_CHAT_MAX_ATTEMPTS } from '@swao/module-llm-providers';
import type { LlmProvider, LlmCompletion, LlmToolChatParams } from '@swao/module-llm-providers';
import type { ChatTurn } from '@swao/core';

describe('extractProseFromResponse (#2786)', () => {
  it('extracts "response" key from JSON envelope', () => {
    const raw = JSON.stringify({ response: 'Hello, I can help you.', language: 'en' });
    expect(extractProseFromResponse(raw)).toBe('Hello, I can help you.');
  });

  it('extracts "message" key from JSON envelope', () => {
    const raw = JSON.stringify({ message: 'No assessments found.', status: 'ok' });
    expect(extractProseFromResponse(raw)).toBe('No assessments found.');
  });

  it('extracts "text" key from JSON envelope', () => {
    const raw = JSON.stringify({ text: 'Here is the summary.' });
    expect(extractProseFromResponse(raw)).toBe('Here is the summary.');
  });

  it('converts literal \\\\n sequences to real newlines in extracted prose', () => {
    const raw = JSON.stringify({ response: 'Line one.\\nLine two.\\n\\nParagraph two.' });
    const result = extractProseFromResponse(raw);
    expect(result).toContain('Line one.\nLine two.');
    expect(result).not.toContain('\\n');
  });

  it('returns non-JSON text as-is', () => {
    const plain = 'This is a plain prose response.';
    expect(extractProseFromResponse(plain)).toBe(plain);
  });

  it('converts literal \\\\n in non-JSON text', () => {
    const raw = 'First paragraph.\\n\\nSecond paragraph.';
    expect(extractProseFromResponse(raw)).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('handles malformed JSON gracefully by returning text as-is', () => {
    const broken = '{ response: "not valid json" }';
    expect(extractProseFromResponse(broken)).toBe(broken);
  });

  it('trims leading and trailing whitespace', () => {
    expect(extractProseFromResponse('  hello  ')).toBe('hello');
  });

  it('returns empty string for empty input', () => {
    expect(extractProseFromResponse('')).toBe('');
  });

  it('does not extract from JSON arrays (returns as-is)', () => {
    const arr = '[{"item": "one"}]';
    expect(extractProseFromResponse(arr)).toBe(arr);
  });

  it('extracts "reason" from error/refusal JSON envelope (#2791)', () => {
    const raw = JSON.stringify({
      error: 'Unable to provide response',
      reason: 'No portfolio context is loaded.',
      action_taken: 'Refusing to hallucinate',
      response_mode: 'json_only',
    });
    expect(extractProseFromResponse(raw)).toBe('No portfolio context is loaded.');
  });

  it('extracts "description" from error JSON when reason is absent (#2791)', () => {
    const raw = JSON.stringify({ error: 'fail', description: 'Something went wrong.' });
    expect(extractProseFromResponse(raw)).toBe('Something went wrong.');
  });

  it('extracts bare "error" string when it is the only key (#2793)', () => {
    const raw = JSON.stringify({
      error: 'SWAO Portfolio Advisor kann nur in natuerlicher Sprache antworten, nicht im JSON-Format',
    });
    expect(extractProseFromResponse(raw)).toBe(
      'SWAO Portfolio Advisor kann nur in natuerlicher Sprache antworten, nicht im JSON-Format',
    );
  });

  it('extracts German prose with Umlauts from JSON envelope', () => {
    const raw = JSON.stringify({
      response: 'Guten Tag! Ich bin der SWAO Portfolio Advisor.',
      language: 'de',
    });
    expect(extractProseFromResponse(raw)).toBe('Guten Tag! Ich bin der SWAO Portfolio Advisor.');
  });
});

// ---------------------------------------------------------------------------
// readSwaoYmlConnectorId (#2895)
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'swao-chat-session-'));
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('readSwaoYmlConnectorId (#2895)', () => {
  it('returns the connector id from .swao.yml providers.llm.primary.connector', () => {
    writeFileSync(join(tmpDir, '.swao.yml'), [
      'providers:',
      '  llm:',
      '    primary:',
      '      connector: corp-genai-preprod',
      '      model: /gemma-4',
    ].join('\n') + '\n', 'utf-8');
    expect(readSwaoYmlConnectorId(tmpDir)).toBe('corp-genai-preprod');
  });

  it('returns undefined when .swao.yml has no connector field', () => {
    writeFileSync(join(tmpDir, '.swao.yml'), [
      'providers:',
      '  llm:',
      '    primary:',
      '      type: anthropic',
      '      model: claude-opus-5',
    ].join('\n') + '\n', 'utf-8');
    expect(readSwaoYmlConnectorId(tmpDir)).toBeUndefined();
  });

  it('returns undefined when .swao.yml does not exist', () => {
    expect(readSwaoYmlConnectorId(tmpDir)).toBeUndefined();
  });

  it('returns undefined when providers block is absent', () => {
    writeFileSync(join(tmpDir, '.swao.yml'), 'workspace:\n  name: test\n', 'utf-8');
    expect(readSwaoYmlConnectorId(tmpDir)).toBeUndefined();
  });
});

describe('formatChatPrompt (#2781)', () => {
  const sys: ChatTurn = { ts: '', role: 'system', content: 'System instructions.' };
  const u1: ChatTurn  = { ts: '', role: 'user',   content: 'Hello.' };
  const a1: ChatTurn  = { ts: '', role: 'assistant', content: 'Hi there.' };

  it('includes system content at the start', () => {
    const prompt = formatChatPrompt([sys], 'New question');
    expect(prompt.startsWith('System instructions.')).toBe(true);
  });

  it('includes conversation history between system and new turn', () => {
    const prompt = formatChatPrompt([sys, u1, a1], 'Follow-up');
    expect(prompt).toContain('User: Hello.');
    expect(prompt).toContain('Assistant: Hi there.');
  });

  it('ends with "User: ... Assistant:" pattern', () => {
    const prompt = formatChatPrompt([sys], 'My question');
    expect(prompt).toMatch(/User: My question\n\nAssistant:$/);
  });

  it('filters out system messages from the history section', () => {
    const prompt = formatChatPrompt([sys, u1, a1], 'Next');
    const historySection = prompt.split('CONVERSATION HISTORY')[1] ?? '';
    expect(historySection).not.toContain('System instructions.');
  });
});

describe('runChatCompletion (#3301)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('sends every chat call with at most 3 attempts (per-call limit, not the full assessment policy)', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const failing: LlmProvider = {
      name: 'stub',
      model: 'unit',
      complete: async () => { throw new Error('unused'); },
      completeDetailed: (): Promise<LlmCompletion> => requestLlmWithRetry<LlmCompletion>({
        provider: 'chat-unit', label: 'ChatUnit', model: 'unit', kind: 'text',
        endpoint: 'https://chat-unit.example.com', limiterKey: 'chat-unit|https://chat-unit.example.com',
        streaming: false, promptChars: 1,
        run: async () => { attempts += 1; throw new LlmHttpStatusError('503', 503); },
      }),
    };
    const p = runChatCompletion(failing, { system: '', history: [], content: 'hi', tools: [] });
    const assertion = expect(p).rejects.toThrow(/all retries exhausted/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(LLM_CHAT_MAX_ATTEMPTS).toBe(3);
    expect(attempts).toBe(3);
  });

  it('reads usage from the call result, not from the shared getLastUsage()', async () => {
    const provider: LlmProvider = {
      name: 'stub',
      model: 'unit',
      complete: async () => 'unused',
      completeDetailed: async () => ({
        text: JSON.stringify({ response: 'Hello.' }),
        usage: { input_tokens: 11, output_tokens: 42, cost_usd: 0.5 },
      }),
      // A concurrent call's usage: must not be attributed to this chat turn.
      getLastUsage: () => ({ input_tokens: 999, output_tokens: 999, cost_usd: 9 }),
    };
    const r = await runChatCompletion(provider, { system: '', history: [], content: 'hi', tools: [] });
    expect(r.text).toBe('Hello.');
    expect(r.usage).toEqual({ input_tokens: 11, output_tokens: 42, cost_usd: 0.5 });
  });

  it('uses the tool-calling path with the loop usage when MCP tools are available', async () => {
    let seen: LlmToolChatParams | undefined;
    const provider: LlmProvider = {
      name: 'stub',
      model: 'unit',
      complete: async () => 'unused',
      completeWithTools: async () => 'unused',
      completeWithToolsDetailed: async (params) => {
        seen = params;
        return { text: 'Tool answer.', usage: { input_tokens: 300, output_tokens: 30, cost_usd: 0.03 } };
      },
    };
    const history: ChatTurn[] = [
      { ts: 't', role: 'system', content: 'sys' },
      { ts: 't', role: 'user', content: 'q1' },
      { ts: 't', role: 'assistant', content: 'a1' },
    ];
    const r = await runChatCompletion(provider, {
      system: 'SYSTEM',
      history,
      content: 'q2',
      tools: [{ name: 'swao_list', description: 'd', input_schema: {} }],
      onToolCall: async () => 'tool result',
    });
    expect(r).toEqual({ text: 'Tool answer.', usage: { input_tokens: 300, output_tokens: 30, cost_usd: 0.03 } });
    expect(seen?.system).toBe('SYSTEM');
    expect(seen?.messages.map((m) => m.content)).toEqual(['q1', 'a1', 'q2']);
  });
  it('degrades to the prompt without tools when the model does not support tool calling (#3311)', async () => {
    let toolCalls = 0;
    const prompts: string[] = [];
    const provider: LlmProvider = {
      name: 'ollama',
      model: 'gemma:2b',
      complete: async () => 'unused',
      completeWithTools: async () => 'unused',
      completeWithToolsDetailed: async () => { toolCalls += 1; throw new LlmToolsUnsupportedError('ollama', 'gemma:2b'); },
      completeDetailed: async (prompt) => {
        prompts.push(prompt);
        return { text: JSON.stringify({ response: 'Plain answer.' }), usage: { input_tokens: 5, output_tokens: 2, cost_usd: 0 } };
      },
    };
    const req = {
      system: 'SYSTEM', history: [] as ChatTurn[], content: 'q',
      tools: [{ name: 'swao_list', description: 'd', input_schema: {} }],
      onToolCall: async () => 'tool result',
    };
    const first = await runChatCompletion(provider, req);
    expect(first.text).toBe(`${toolsUnsupportedNotice('gemma:2b')}

Plain answer.`);
    expect(first.text).toContain('does not support tool calling');
    expect(first.usage).toEqual({ input_tokens: 5, output_tokens: 2, cost_usd: 0 });
    // Later turns go straight to the no-tools prompt, without the notice.
    const second = await runChatCompletion(provider, req);
    expect(second.text).toBe('Plain answer.');
    expect(toolCalls).toBe(1);
    expect(prompts).toHaveLength(2);
  });

  it('other tool-chat errors still fail the turn', async () => {
    const provider: LlmProvider = {
      name: 'stub',
      model: 'unit',
      complete: async () => 'unused',
      completeWithTools: async () => 'unused',
      completeWithToolsDetailed: async () => { throw new Error('boom'); },
    };
    await expect(runChatCompletion(provider, {
      system: '', history: [], content: 'q',
      tools: [{ name: 'swao_list', description: 'd', input_schema: {} }],
      onToolCall: async () => 'r',
    })).rejects.toThrow('boom');
  });
});

// #3315: a failed MCP tool call reaches the model as [MCP error: ...] and is
// recorded in the chat log (NDJSON history), not swallowed as empty text.
import { callMcpToolLogged } from './useChatSession.js';
import { readFileSync as readFileSync3315 } from 'node:fs';

describe('callMcpToolLogged (#3315)', () => {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'swao-3315-')); });
  afterEach(() => { vi.unstubAllGlobals(); rmSync(dir, { recursive: true, force: true }); });

  it('returns the [MCP error: ...] text to the model and appends it to the chat log', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) }); });
    const history = join(dir, 'wsp', 'chat', 's.ndjson');
    const text = await callMcpToolLogged({ sessionId: 's', port: 3737 }, history, 'swao_risks', {});
    expect(text).toBe('[MCP error: swao_risks request failed: fetch failed (ECONNREFUSED)]');
    const turns = readFileSync3315(history, 'utf-8').trim().split('\n').map(l => JSON.parse(l) as ChatTurn);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ role: 'assistant', content: `${text} (tool swao_risks)` });
  });

  it('logs nothing for a successful call', async () => {
    vi.stubGlobal('fetch', async (_u: string, opts: RequestInit) => {
      const id = (JSON.parse(String(opts.body)) as { id: number }).id;
      return { ok: true, status: 200, text: async () => 'data: ' + JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'risks' }] } }) + '\n' };
    });
    const history = join(dir, 'wsp', 'chat', 's.ndjson');
    expect(await callMcpToolLogged({ sessionId: 's', port: 3737 }, history, 'swao_risks', {})).toBe('risks');
    expect(() => readFileSync3315(history, 'utf-8')).toThrow();
  });
});
