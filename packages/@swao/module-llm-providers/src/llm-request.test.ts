// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3284: shared LLM provider request helper. Every provider (openai, ollama,
// open-llm-provider, bedrock; anthropic is covered in anthropic.test.ts) and
// every call kind (text, vision, tools) emits the same event set to the
// portfolio and app logs, with one attempt count, the idle watchdog and the
// provider-level concurrency limiter. No network: global fetch, undici fetch
// and the Bedrock SDK are all stubbed.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { originalGlobalFetch, mockSend } = vi.hoisted(() => ({
  originalGlobalFetch: globalThis.fetch,
  mockSend: vi.fn(),
}));

// undici fetch (open-llm-provider) routes to the stubbed global fetch and
// refuses outright when no stub is installed (#3159).
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return {
    ...actual,
    fetch: (...args: Parameters<typeof globalThis.fetch>) => {
      if (globalThis.fetch === originalGlobalFetch) {
        throw new Error('network access blocked in tests: stub global fetch first (#3159)');
      }
      return globalThis.fetch(...args);
    },
  };
});

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn(function MockClient() { return { send: mockSend }; }),
  ConverseCommand: vi.fn(function MockCmd(input: unknown) { return input; }),
}));

vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return { ...actual, logPortfolio: vi.fn(), logApp: vi.fn() };
});

import { logPortfolio, logApp } from '@swao/core';
import { OpenAiLlmProvider } from './openai.js';
import { OllamaLlmProvider } from './ollama.js';
import { OpenLlmProvider } from './open-llm-provider.js';
import { BedrockLlmProvider } from './bedrock.js';
import { AnthropicLlmProvider } from './anthropic.js';
import { createLlmProvider } from './factory.js';
import { createProviderFromConnector } from './gateway/resolve.js';
import type { LoadedConnector } from './gateway/connector-loader.js';
import { parseConnectorYaml } from './gateway/connector-schema.js';
import {
  requestLlmWithRetry,
  resolveLlmIdleTimeoutMs,
  withLlmAttemptLimit,
  LlmConnectivityError,
  LlmHttpStatusError,
  LLM_MAX_ATTEMPTS,
  LLM_CHAT_MAX_ATTEMPTS,
  TLS_CERT_HINT,
  tlsCertErrorCode,
} from './llm-request.js';
import {
  acquireLlmSlot,
  getLlmConcurrencyLimit,
  setLlmConcurrencyLimit,
  resetLlmConcurrencyLimitersForTests,
  DEFAULT_LLM_MAX_CONCURRENCY,
} from './concurrency.js';
import { UsageTrackingLlmProvider } from './usage-tracker.js';
import type { LlmProvider, LlmTrace } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type LogCall = [string, string, string, { context?: Record<string, unknown> }?];
type AppLogCall = [string, string, string, string, { context?: Record<string, unknown> }?];

function eventsOf(code: string): LogCall[] {
  return (vi.mocked(logPortfolio).mock.calls as unknown as LogCall[]).filter(c => c[1] === code);
}
function appEventsOf(code: string): AppLogCall[] {
  return (vi.mocked(logApp).mock.calls as unknown as AppLogCall[]).filter(c => c[2] === code);
}
function ctxOf(call: LogCall | undefined): Record<string, unknown> {
  return call?.[3]?.context ?? {};
}

const PROMPT_MARKER = 'PROMPT-PAYLOAD-MARKER-3284';
const PROMPT = `${PROMPT_MARKER} analyse this workload and answer in JSON. `.repeat(12);
const IMAGE = Buffer.from('IMAGE-PAYLOAD-BYTES-3284');

/** CLAUDE.md section 5.7: events never carry the prompt or image bytes. */
function assertNoPayloadInEvents(): void {
  const all = JSON.stringify([...vi.mocked(logPortfolio).mock.calls, ...vi.mocked(logApp).mock.calls]);
  expect(all).not.toContain(PROMPT_MARKER);
  expect(all).not.toContain(IMAGE.toString('base64'));
}

function chatOk(content: string): Partial<Response> {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 120, completion_tokens: 40 } }),
  };
}
function ollamaOk(response: string): Partial<Response> {
  return { ok: true, status: 200, json: async () => ({ response, prompt_eval_count: 90, eval_count: 30 }) };
}
function httpError(status: number, body = 'error body'): Partial<Response> {
  return { ok: false, status, statusText: body, text: async () => body };
}

const EVENT_SET = ['attempt', 'ok', 'waiting', 'timeout', 'retry', 'http-error', 'connectivity-failure', 'error'];

beforeEach(() => {
  vi.mocked(logPortfolio).mockClear();
  vi.mocked(logApp).mockClear();
  resetLlmConcurrencyLimitersForTests();
  delete process.env['SWAO_LLM_IDLE_TIMEOUT_MS'];
  delete process.env['SWAO_ANTHROPIC_IDLE_TIMEOUT_MS'];
});

afterEach(() => {
  globalThis.fetch = originalGlobalFetch;
  vi.useRealTimers();
  mockSend.mockReset();
});

// ---------------------------------------------------------------------------
// Per-provider event coverage (text, vision, tools)
// ---------------------------------------------------------------------------

interface ProviderCase {
  provider: string;
  make: () => LlmProvider;
  ok: (text: string) => Partial<Response>;
}

const fetchCases: ProviderCase[] = [
  { provider: 'openai', make: () => new OpenAiLlmProvider('sk-test-openai-0001', 'gpt-4o-mini', 0, undefined, 'demo-app'), ok: chatOk },
  { provider: 'ollama', make: () => new OllamaLlmProvider('llava', 'http://ollama.test:11434', 0, undefined, undefined, 'demo-app'), ok: ollamaOk },
  {
    provider: 'open-llm-provider',
    make: () => new OpenLlmProvider('tok-1234', 'hub-model', 'https://genai-hub.example.com', '', 0, undefined, undefined, { appId: 'demo-app' }),
    ok: chatOk,
  },
];

describe.each(fetchCases)('$provider -- shared helper events (#3284)', ({ provider, make, ok }) => {
  it('text: attempt + ok to portfolio and app logs, no payload', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(ok('{"ok":true}')) as typeof fetch;
    const p = make();
    expect(await p.complete(PROMPT)).toBe('{"ok":true}');

    const attempts = eventsOf(`provider.llm.${provider}.attempt`);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]![2]).toContain('attempt 1/6');
    expect(ctxOf(attempts[0])).toMatchObject({ provider, kind: 'text', attempt: 1, max_attempts: 6 });
    expect(typeof ctxOf(attempts[0])['prompt_chars']).toBe('number');

    const oks = eventsOf(`provider.llm.${provider}.ok`);
    expect(oks).toHaveLength(1);
    expect(ctxOf(oks[0])).toMatchObject({ provider, kind: 'text', http_status: 200, attempt: 1, max_attempts: 6 });
    expect(typeof ctxOf(oks[0])['latency_ms']).toBe('number');
    expect(typeof ctxOf(oks[0])['tokens_in']).toBe('number');

    // App scope (#3284): the same codes reach the app log.
    expect(appEventsOf(`provider.llm.${provider}.attempt`)).toHaveLength(1);
    expect(appEventsOf(`provider.llm.${provider}.ok`)).toHaveLength(1);
    expect(appEventsOf(`provider.llm.${provider}.ok`)[0]![0]).toBe('demo-app');
    // The portfolio copy prints on the console; the app copy does not repeat it.
    expect((appEventsOf(`provider.llm.${provider}.ok`)[0]![4] as { mirror?: boolean }).mirror).toBe(false);
    assertNoPayloadInEvents();
  });

  it('vision: events carry kind vision and image_count, never the image bytes', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(ok('a login form')) as typeof fetch;
    const p = make();
    expect(await p.completeVision!(PROMPT, [IMAGE])).toBe('a login form');
    const attempts = eventsOf(`provider.llm.${provider}.attempt`);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]![2]).toContain('vision call attempt 1/6');
    expect(ctxOf(attempts[0])).toMatchObject({ kind: 'vision', image_count: 1 });
    expect(eventsOf(`provider.llm.${provider}.ok`)).toHaveLength(1);
    assertNoPayloadInEvents();
  });

  it('retry: one count -- "attempt 1/6 failed ... as attempt 2/6" (off-by-one fixed)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(httpError(429, 'rate limited'))
      .mockResolvedValueOnce(ok('{"ok":2}'));
    globalThis.fetch = fetchMock as typeof fetch;
    const p = make().complete(PROMPT);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await p).toBe('{"ok":2}');

    const httpErrs = eventsOf(`provider.llm.${provider}.http-error`);
    expect(httpErrs).toHaveLength(1);
    expect(httpErrs[0]![0]).toBe('warn');
    expect(ctxOf(httpErrs[0])).toMatchObject({ http_status: 429, reason: 'rate_limited', transient: true, attempt: 1, max_attempts: 6 });

    const retries = eventsOf(`provider.llm.${provider}.retry`);
    expect(retries).toHaveLength(1);
    expect(retries[0]![2]).toContain('attempt 1/6 failed');
    expect(retries[0]![2]).toContain('as attempt 2/6');
    expect(ctxOf(retries[0])).toMatchObject({ attempt: 1, next_attempt: 2, max_attempts: 6, reason: 'rate_limited', delay_ms: 3000 });
    expect(ctxOf(eventsOf(`provider.llm.${provider}.ok`)[0])).toMatchObject({ attempt: 2, max_attempts: 6 });
    assertNoPayloadInEvents();
  });

  it('connectivity-failure after 6 network failures', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() => Promise.reject(new TypeError('fetch failed')));
    globalThis.fetch = fetchMock as typeof fetch;
    const p = make().complete(PROMPT);
    const assertion = expect(p).rejects.toBeInstanceOf(LlmConnectivityError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(eventsOf(`provider.llm.${provider}.retry`).map(r => ctxOf(r)['attempt'])).toEqual([1, 2, 3, 4, 5]);
    const failure = eventsOf(`provider.llm.${provider}.connectivity-failure`);
    expect(failure).toHaveLength(1);
    expect(failure[0]![0]).toBe('error');
    expect(ctxOf(failure[0])).toMatchObject({ max_attempts: 6, reason: 'network_or_malformed_response' });
    expect(appEventsOf(`provider.llm.${provider}.connectivity-failure`)).toHaveLength(1);
    assertNoPayloadInEvents();
  });

  it('non-transient HTTP status fails at once with one http-error event', async () => {
    const fetchMock = vi.fn().mockResolvedValue(httpError(400, 'bad request'));
    globalThis.fetch = fetchMock as typeof fetch;
    await expect(make().complete(PROMPT)).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const errs = eventsOf(`provider.llm.${provider}.http-error`);
    expect(errs).toHaveLength(1);
    expect(ctxOf(errs[0])).toMatchObject({ http_status: 400, reason: 'bad_request', transient: false });
    expect(eventsOf(`provider.llm.${provider}.retry`)).toHaveLength(0);
    // Not double-logged as a generic error.
    expect(eventsOf(`provider.llm.${provider}.error`)).toHaveLength(0);
  });

  it('a non-retryable programming error leaves one error event', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new RangeError('boom')) as typeof fetch;
    await expect(make().complete(PROMPT)).rejects.toThrow('boom');
    const errs = eventsOf(`provider.llm.${provider}.error`);
    expect(errs).toHaveLength(1);
    expect(errs[0]![0]).toBe('error');
    expect(ctxOf(errs[0])).toMatchObject({ reason: 'non_retryable', error_name: 'RangeError' });
  });

  it('non-streaming: a 150 s wait for headers is not cut (headers floor), waiting events are info', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve(ok('{"slow":true}')), 150_000);
    }));
    globalThis.fetch = fetchMock as typeof fetch;
    const p = make().complete(PROMPT);
    await vi.advanceTimersByTimeAsync(150_000);
    expect(await p).toBe('{"slow":true}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(eventsOf(`provider.llm.${provider}.timeout`)).toHaveLength(0);
    const waiting = eventsOf(`provider.llm.${provider}.waiting`);
    expect(waiting.length).toBe(2);
    for (const w of waiting) {
      expect(w[0]).toBe('info');
      expect(ctxOf(w)).toMatchObject({ phase: 'headers', streaming: false });
    }
  });

  it('non-streaming: no headers at all times out at the 300 s floor and retries', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise(() => { /* never answers */ }))
      .mockImplementationOnce(() => Promise.resolve(ok('{"ok":3}')));
    globalThis.fetch = fetchMock as typeof fetch;
    const p = make().complete(PROMPT);
    await vi.advanceTimersByTimeAsync(299_999);
    expect(eventsOf(`provider.llm.${provider}.timeout`)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const timeouts = eventsOf(`provider.llm.${provider}.timeout`);
    expect(timeouts).toHaveLength(1);
    expect(ctxOf(timeouts[0])).toMatchObject({ phase: 'headers', limit: 'idle', limit_ms: 300_000 });
    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await p).toBe('{"ok":3}');
  });
});

describe('open-llm-provider tool calls run through the helper (#3284)', () => {
  it('emits attempt/ok with kind tools and iteration context', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(chatOk('final answer')) as typeof fetch;
    const p = new OpenLlmProvider('tok-1234', 'hub-model', 'https://genai-hub.example.com', '', 0, undefined, undefined, { appId: 'demo-app' });
    const out = await p.completeWithTools({
      system: `${PROMPT_MARKER} system`,
      messages: [{ role: 'user', content: PROMPT }],
      tools: [{ name: 't', description: 'd', input_schema: { type: 'object' } }],
      onToolCall: vi.fn(),
    });
    expect(out).toBe('final answer');
    const attempts = eventsOf('provider.llm.open-llm-provider.attempt');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]![2]).toContain('tool-call call attempt 1/6');
    expect(ctxOf(attempts[0])).toMatchObject({ kind: 'tools', iteration: 1, tool_count: 1 });
    expect(eventsOf('provider.llm.open-llm-provider.ok')).toHaveLength(1);
    assertNoPayloadInEvents();
  });
});

describe('anthropic tool calls run through the helper (#3284)', () => {
  it('retries a 529 on a tool-call iteration and logs kind tools', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(httpError(529, '{"type":"error","error":{"type":"overloaded_error"}}'))
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ content: [{ type: 'text', text: 'chat answer' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }),
      });
    globalThis.fetch = fetchMock as typeof fetch;
    const p = new AnthropicLlmProvider('sk-ant-test-0000', 'claude-sonnet-4-6', 0, undefined, undefined, 'demo-app');
    const out = p.completeWithTools({
      system: 'sys', messages: [{ role: 'user', content: PROMPT }], tools: [], onToolCall: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await out).toBe('chat answer');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ctxOf(eventsOf('provider.llm.anthropic.retry')[0])).toMatchObject({ kind: 'tools', reason: 'overloaded' });
    expect(ctxOf(eventsOf('provider.llm.anthropic.ok')[0])).toMatchObject({ kind: 'tools', attempt: 2, stop_reason: 'end_turn' });
    assertNoPayloadInEvents();
  });
});

describe('bedrock -- shared helper events (#3284)', () => {
  it('emits attempt, retry and ok events for an SDK call', async () => {
    vi.useFakeTimers();
    const throttle = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
    mockSend
      .mockRejectedValueOnce(throttle)
      .mockResolvedValueOnce({ output: { message: { content: [{ text: 'ok' }] } }, usage: { inputTokens: 10, outputTokens: 5 }, $metadata: { httpStatusCode: 200 } });
    const p = new BedrockLlmProvider('eu.anthropic.claude-sonnet-4-6', 'https://bedrock-runtime.eu-central-1.amazonaws.com', 0, 100, undefined, 'demo-app');
    const out = p.complete(PROMPT);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await out).toBe('ok');
    expect(eventsOf('provider.llm.bedrock.attempt')).toHaveLength(2);
    expect(ctxOf(eventsOf('provider.llm.bedrock.retry')[0])).toMatchObject({ attempt: 1, next_attempt: 2, max_attempts: 6 });
    expect(ctxOf(eventsOf('provider.llm.bedrock.ok')[0])).toMatchObject({ http_status: 200, tokens_in: 10, tokens_out: 5 });
    expect(appEventsOf('provider.llm.bedrock.ok')).toHaveLength(1);
    // The SDK call receives the watchdog's abort signal.
    expect((mockSend.mock.calls[0]![1] as { abortSignal: AbortSignal }).abortSignal).toBeInstanceOf(AbortSignal);
    assertNoPayloadInEvents();
  });
});

describe('event set is the same for every provider', () => {
  it('codes follow provider.llm.<provider>.<event>', () => {
    // Pinned so docs/runbooks/log-events.md stays in sync with the helper.
    expect(EVENT_SET).toEqual(['attempt', 'ok', 'waiting', 'timeout', 'retry', 'http-error', 'connectivity-failure', 'error']);
  });
});

// ---------------------------------------------------------------------------
// Idle timeout environment variables (D-13)
// ---------------------------------------------------------------------------

describe('resolveLlmIdleTimeoutMs (#3284 / D-13)', () => {
  it('defaults to 120 s', () => {
    expect(resolveLlmIdleTimeoutMs()).toBe(120_000);
  });
  it('honours SWAO_LLM_IDLE_TIMEOUT_MS', () => {
    process.env['SWAO_LLM_IDLE_TIMEOUT_MS'] = '45000';
    expect(resolveLlmIdleTimeoutMs()).toBe(45_000);
  });
  it('keeps SWAO_ANTHROPIC_IDLE_TIMEOUT_MS as an alias', () => {
    process.env['SWAO_ANTHROPIC_IDLE_TIMEOUT_MS'] = '7000';
    expect(resolveLlmIdleTimeoutMs()).toBe(7_000);
  });
  it('the provider-neutral name wins over the alias', () => {
    process.env['SWAO_LLM_IDLE_TIMEOUT_MS'] = '9000';
    process.env['SWAO_ANTHROPIC_IDLE_TIMEOUT_MS'] = '7000';
    expect(resolveLlmIdleTimeoutMs()).toBe(9_000);
  });
  it('ignores invalid values', () => {
    process.env['SWAO_LLM_IDLE_TIMEOUT_MS'] = 'soon';
    expect(resolveLlmIdleTimeoutMs()).toBe(120_000);
  });
});

// ---------------------------------------------------------------------------
// Helper policy details
// ---------------------------------------------------------------------------

describe('requestLlmWithRetry policy', () => {
  const spec = {
    provider: 'unit', label: 'Unit', model: 'm', kind: 'text' as const,
    endpoint: 'https://unit.example.com/v1', limiterKey: 'unit|https://unit.example.com',
    streaming: false, promptChars: 10,
  };

  it('retryNow re-sends at once without consuming an attempt', async () => {
    let calls = 0;
    const out = await requestLlmWithRetry({
      ...spec,
      run: async () => {
        calls += 1;
        if (calls === 1) throw new LlmHttpStatusError('401 refreshed', 401, { retryNow: true });
        return { value: 'ok', status: 200, okContext: {} };
      },
    });
    expect(out).toBe('ok');
    expect(calls).toBe(2);
    expect(eventsOf('provider.llm.unit.retry')).toHaveLength(0);
    expect(ctxOf(eventsOf('provider.llm.unit.ok')[0])).toMatchObject({ attempt: 1 });
  });

  it('throwAs replaces the final error', async () => {
    const replacement = new Error('typed auth failure');
    await expect(requestLlmWithRetry({
      ...spec,
      run: async () => { throw new LlmHttpStatusError('401', 401, { throwAs: replacement }); },
    })).rejects.toBe(replacement);
  });

  // #3384: a self-signed corporate chain cannot succeed on a retry.
  it('certificate error on the cause chain fails after one attempt with the TLS hint', async () => {
    let calls = 0;
    const certErr = Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
    await expect(requestLlmWithRetry({
      ...spec,
      run: async () => { calls += 1; throw new TypeError('fetch failed', { cause: certErr }); },
    })).rejects.toThrow(TLS_CERT_HINT);
    expect(calls).toBe(1);
    expect(eventsOf('provider.llm.unit.retry')).toHaveLength(0);
    const errs = eventsOf('provider.llm.unit.error');
    expect(errs).toHaveLength(1);
    expect(ctxOf(errs[0])).toMatchObject({ reason: 'tls_certificate', tls_code: 'SELF_SIGNED_CERT_IN_CHAIN' });
  });

  it('tlsCertErrorCode walks nested causes and ignores transient codes', () => {
    const nested = new TypeError('fetch failed', { cause: new Error('wrap', { cause: Object.assign(new Error('x'), { code: 'CERT_HAS_EXPIRED' }) }) });
    expect(tlsCertErrorCode(nested)).toBe('CERT_HAS_EXPIRED');
    expect(tlsCertErrorCode(new TypeError('fetch failed', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) }))).toBeNull();
  });

  it('a transient ECONNRESET is still retried', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const p = withLlmAttemptLimit(2, () => requestLlmWithRetry({
      ...spec,
      run: async () => {
        calls += 1;
        if (calls === 1) throw new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });
        return { value: 'ok', status: 200, okContext: {} };
      },
    }));
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe('ok');
    expect(calls).toBe(2);
    expect(eventsOf('provider.llm.unit.retry')).toHaveLength(1);
  });

  it('withLlmAttemptLimit lowers the count for probes ("attempt N/4")', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const p = withLlmAttemptLimit(4, () => requestLlmWithRetry({
      ...spec,
      run: async () => { calls += 1; throw new TypeError('fetch failed'); },
    }));
    const assertion = expect(p).rejects.toBeInstanceOf(LlmConnectivityError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(calls).toBe(4);
    expect(eventsOf('provider.llm.unit.attempt').at(-1)![2]).toContain('attempt 4/4');
  });

  it('#3301: the chat attempt limit (3) applies per call; a concurrent call keeps the full policy', async () => {
    vi.useFakeTimers();
    expect(LLM_CHAT_MAX_ATTEMPTS).toBe(3);
    let chatCalls = 0;
    let assessCalls = 0;
    const chat = withLlmAttemptLimit(LLM_CHAT_MAX_ATTEMPTS, () => requestLlmWithRetry({
      ...spec,
      provider: 'chat',
      run: async () => { chatCalls += 1; throw new LlmHttpStatusError('503', 503); },
    }));
    // Started at the same time, outside the scoped limit.
    const assess = requestLlmWithRetry({
      ...spec,
      provider: 'assess',
      run: async () => { assessCalls += 1; throw new TypeError('fetch failed'); },
    });
    const chatAssertion = expect(chat).rejects.toBeInstanceOf(LlmConnectivityError);
    const assessAssertion = expect(assess).rejects.toBeInstanceOf(LlmConnectivityError);
    await vi.runAllTimersAsync();
    await chatAssertion;
    await assessAssertion;
    expect(chatCalls).toBe(3);
    expect(assessCalls).toBe(LLM_MAX_ATTEMPTS);
    const chatAttempts = eventsOf('provider.llm.chat.attempt');
    expect(chatAttempts).toHaveLength(3);
    expect(ctxOf(chatAttempts.at(-1))).toMatchObject({ attempt: 3, max_attempts: 3 });
    expect(ctxOf(eventsOf('provider.llm.chat.connectivity-failure')[0])).toMatchObject({ max_attempts: 3 });
    expect(ctxOf(eventsOf('provider.llm.assess.attempt').at(-1))).toMatchObject({ max_attempts: LLM_MAX_ATTEMPTS });
    // Back-off of the chat call: 3 s + 6 s, never the 48 s steps of the full policy.
    const delays = eventsOf('provider.llm.chat.retry').map((c) => ctxOf(c)['delay_ms']);
    expect(delays).toEqual([3000, 6000]);
  });
});

// ---------------------------------------------------------------------------
// Concurrency limiter (D-14)
// ---------------------------------------------------------------------------

describe('provider-level concurrency limiter (#3284 / D-14)', () => {
  it('defaults to 4 and never exceeds the configured limit across provider instances', async () => {
    const key = 'unit|https://limit.example.com';
    expect(getLlmConcurrencyLimit(key)).toBe(DEFAULT_LLM_MAX_CONCURRENCY);
    setLlmConcurrencyLimit(key, 2);
    let inFlight = 0;
    let max = 0;
    const call = () => requestLlmWithRetry({
      provider: 'unit', label: 'Unit', model: 'm', kind: 'text', endpoint: 'https://limit.example.com/x',
      limiterKey: key, streaming: false, promptChars: 1,
      run: async () => {
        inFlight += 1; max = Math.max(max, inFlight);
        await new Promise(r => setTimeout(r, 5));
        inFlight -= 1;
        return { value: 1, status: 200, okContext: {} };
      },
    });
    await Promise.all(Array.from({ length: 7 }, call));
    expect(max).toBe(2);
    const queued = eventsOf('provider.llm.unit.attempt').map(a => ctxOf(a)['queued_ms'] as number);
    expect(queued.some(q => q > 0)).toBe(true);
  });

  it('releases the slot during back-off so other calls proceed', async () => {
    const key = 'unit|https://backoff.example.com';
    setLlmConcurrencyLimit(key, 1);
    vi.useFakeTimers();
    let first = true;
    const failing = requestLlmWithRetry({
      provider: 'unit', label: 'Unit', model: 'm', kind: 'text', endpoint: 'https://backoff.example.com',
      limiterKey: key, streaming: false, promptChars: 1,
      run: async () => {
        if (first) { first = false; throw new TypeError('fetch failed'); }
        return { value: 'late', status: 200, okContext: {} };
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    // While the first call sleeps 3 s, the single slot is free.
    const slot = await acquireLlmSlot(key);
    expect(slot.queuedMs).toBe(0);
    slot.release();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await failing).toBe('late');
  });

  it('providers expose maxConcurrency from their endpoint key', () => {
    const p = new OpenLlmProvider('tok', 'model-a', 'https://gw.example.com', '');
    const q = new OpenLlmProvider('tok', 'model-b', 'https://gw.example.com', '/other');
    setLlmConcurrencyLimit(p.concurrencyKey, 6);
    expect(p.maxConcurrency).toBe(6);
    // Same gateway origin, different model path: same pool.
    expect(q.maxConcurrency).toBe(6);
    expect(new UsageTrackingLlmProvider(p).maxConcurrency).toBe(6);
  });

  describe('configuration', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'swao-3284-'));
      process.env['SWAO_OPENAI_API_KEY'] = 'sk-test-openai-0001';
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
      delete process.env['SWAO_OPENAI_API_KEY'];
    });

    it('factory reads providers.llm.max_concurrency from the workspace .swao.yml', () => {
      writeFileSync(join(dir, '.swao.yml'), 'providers:\n  llm:\n    max_concurrency: 2\n    primary:\n      type: openai\n', 'utf-8');
      const p = createLlmProvider('app', 'pass', { type: 'openai', workspaceRoot: dir });
      expect(p.maxConcurrency).toBe(2);
    });

    it('explicit config.max_concurrency wins; default is 4', () => {
      expect(createLlmProvider('app', 'pass', { type: 'openai' }).maxConcurrency).toBe(4);
      expect(createLlmProvider('app', 'pass', { type: 'openai', max_concurrency: 8 }).maxConcurrency).toBe(8);
    });

    it('an invalid value warns and falls back to 4', () => {
      writeFileSync(join(dir, '.swao.yml'), 'providers:\n  llm:\n    max_concurrency: 0\n', 'utf-8');
      expect(createLlmProvider('app', 'pass', { type: 'openai', workspaceRoot: dir }).maxConcurrency).toBe(4);
      expect(eventsOf('provider.llm.max-concurrency-invalid')).toHaveLength(1);
    });

    it('a gateway connector sets its own limit; .swao.yml beats it', () => {
      const yaml = [
        'schema_version: "1.0"',
        'connector:',
        '  id: limited-hub',
        '  name: Limited hub',
        '  protocol: openai-chat',
        '  base_url: https://limited-hub.example.com',
        '  max_concurrency: 2',
        '  models:',
        '    default: hub-model',
      ].join('\n');
      const parsed = parseConnectorYaml(yaml, 'limited-hub.yaml');
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const loaded = { file: parsed.file, path: join(dir, 'limited-hub.yaml'), origin: 'workspace' } as LoadedConnector;
      expect(createProviderFromConnector(loaded).provider.maxConcurrency).toBe(2);
      expect(createProviderFromConnector(loaded, { maxConcurrency: 5 }).provider.maxConcurrency).toBe(5);
    });

    it('connector schema rejects an out-of-range max_concurrency', () => {
      const yaml = [
        'schema_version: "1.0"',
        'connector:',
        '  id: bad-hub',
        '  name: Bad hub',
        '  protocol: openai-chat',
        '  base_url: https://bad-hub.example.com',
        '  max_concurrency: 0',
        '  models:',
        '    default: m',
      ].join('\n');
      expect(parseConnectorYaml(yaml, 'bad-hub.yaml').ok).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Trace sample: first call SENT, not first finished (D-14)
// ---------------------------------------------------------------------------

describe('UsageTrackingLlmProvider trace sample under concurrency (#3284)', () => {
  class DelayedTraceProvider implements LlmProvider {
    readonly name = 'stub' as const;
    readonly model = 'delayed';
    private last: LlmTrace | undefined;
    constructor(private readonly delays: Record<string, number>) {}
    async complete(prompt: string): Promise<string> {
      await new Promise(r => setTimeout(r, this.delays[prompt] ?? 0));
      const response = `response-to-${prompt}`;
      this.last = { scrubbedPrompt: `scrubbed-${prompt}`, response };
      return response;
    }
    getLastTrace(): LlmTrace | undefined { return this.last; }
  }

  it('records the first call sent even when a later call finishes first', async () => {
    const inner = new DelayedTraceProvider({ first: 30, second: 1 });
    const tracker = new UsageTrackingLlmProvider(inner);
    await Promise.all([tracker.complete('first'), tracker.complete('second')]);
    expect(tracker.getFirstTrace()?.scrubbedPrompt).toBe('scrubbed-first');
  });

  it('falls back to the earliest successful call when the first sent fails', async () => {
    let n = 0;
    const inner: LlmProvider = {
      name: 'stub', model: 'x',
      async complete(prompt: string) {
        n += 1;
        if (n === 1) throw new Error('first failed');
        last = { scrubbedPrompt: `s-${prompt}`, response: `r-${prompt}` };
        return `r-${prompt}`;
      },
      getLastTrace: () => last,
    };
    let last: LlmTrace | undefined;
    const tracker = new UsageTrackingLlmProvider(inner);
    await tracker.complete('a').catch(() => undefined);
    await tracker.complete('b');
    expect(tracker.getFirstTrace()?.scrubbedPrompt).toBe('s-b');
  });
});
