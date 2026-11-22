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

// #4471: a slow non-streaming call (headers at once, body after 130 s) is not
// cut off on every attempt by the 120 s body idle limit: after a body idle
// timeout the next attempt waits longer (120, 240, 360 s, capped), and each
// attempt event names the limit in use (idle_limit_ms).
// #4469: the retry counter of @swao/core counts the attempts and retries of
// a call (the LLM Assessment recorder reads it for reliability.retries).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { originalGlobalFetch } = vi.hoisted(() => ({ originalGlobalFetch: globalThis.fetch }));

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return {
    ...actual,
    fetch: (...args: Parameters<typeof globalThis.fetch>) => {
      if (globalThis.fetch === originalGlobalFetch) throw new Error('network access blocked in tests (#3159)');
      return globalThis.fetch(...args);
    },
  };
});

vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return { ...actual, logPortfolio: vi.fn(), logApp: vi.fn() };
});

import { logPortfolio, withLlmRetryCounter, type LlmRetryCounter } from '@swao/core';
import { OpenLlmProvider } from './open-llm-provider.js';
import { requestLlmWithRetry, growingIdleLimitMs, LLM_IDLE_GROWTH_CAP_MS, DEFAULT_LLM_IDLE_TIMEOUT_MS } from './llm-request.js';

type Call = [string, string, string, { context?: Record<string, unknown> }?];
const eventsOf = (code: string): Call[] => (vi.mocked(logPortfolio).mock.calls as unknown as Call[]).filter((c) => c[1] === code);
const ctxOf = (c: Call | undefined): Record<string, unknown> => c?.[3]?.context ?? {};

/** A chat/completions response whose body arrives `bodyMs` after the headers. */
function slowBody(bodyMs: number, text: string): unknown {
  return {
    ok: true, status: 200,
    json: () => new Promise((resolve) => setTimeout(() => resolve({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }), bodyMs)),
  };
}

beforeEach(() => {
  vi.mocked(logPortfolio).mockClear();
  delete process.env['SWAO_LLM_IDLE_TIMEOUT_MS'];
  delete process.env['SWAO_ANTHROPIC_IDLE_TIMEOUT_MS'];
});
afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalGlobalFetch;
});

describe('growingIdleLimitMs (#4471)', () => {
  it('grows by one base limit per body idle timeout, capped', () => {
    expect(growingIdleLimitMs(120_000, 0)).toBe(120_000);
    expect(growingIdleLimitMs(120_000, 1)).toBe(240_000);
    expect(growingIdleLimitMs(120_000, 2)).toBe(360_000);
    expect(growingIdleLimitMs(120_000, 5)).toBe(LLM_IDLE_GROWTH_CAP_MS);
    // A base above the cap is never lowered.
    expect(growingIdleLimitMs(500_000, 3)).toBe(500_000);
  });
});

describe('slow non-streaming body (#4471)', () => {
  it('open-llm-provider: body after 130 s succeeds on attempt 2 with a 240 s idle limit', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(slowBody(130_000, '{"slow":true}')));
    globalThis.fetch = fetchMock as typeof fetch;
    const p = new OpenLlmProvider('tok-1234', 'mistralai/mistral-large', 'https://gateway.example.com', '', 0, undefined, undefined, { appId: 'demo-app' });
    let counter: LlmRetryCounter | undefined;
    const done = withLlmRetryCounter((c) => { counter = c; return p.complete('prompt'); });
    // Attempt 1: the body idle limit of 120 s ends it; 3 s back-off.
    await vi.advanceTimersByTimeAsync(120_000 + 3_000);
    // Attempt 2: the 240 s limit lets the 130 s body arrive.
    await vi.advanceTimersByTimeAsync(130_000);
    expect(await done).toBe('{"slow":true}');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const attempts = eventsOf('provider.llm.open-llm-provider.attempt');
    expect(attempts.map((a) => ctxOf(a)['idle_limit_ms'])).toEqual([DEFAULT_LLM_IDLE_TIMEOUT_MS, 2 * DEFAULT_LLM_IDLE_TIMEOUT_MS]);
    expect(ctxOf(attempts[1])['idle_limit_base_ms']).toBe(DEFAULT_LLM_IDLE_TIMEOUT_MS);
    const timeouts = eventsOf('provider.llm.open-llm-provider.timeout');
    expect(timeouts).toHaveLength(1);
    expect(ctxOf(timeouts[0])).toMatchObject({ phase: 'body', limit: 'idle', limit_ms: 120_000 });
    expect(eventsOf('provider.llm.open-llm-provider.ok')).toHaveLength(1);
    // #4469: two attempts, one retry.
    expect(counter).toMatchObject({ attempts: 2, retries: 1 });
  });

  it('the growth applies only after a body idle timeout, not after an HTTP error', async () => {
    vi.useFakeTimers();
    let n = 0;
    const limits: number[] = [];
    const done = requestLlmWithRetry({
      provider: 'fake', label: 'fake', model: 'm', kind: 'text', endpoint: 'https://fake.example.com',
      limiterKey: 'fake-4471', streaming: false, promptChars: 1,
      run: async (wd) => {
        n += 1;
        if (n === 1) throw new (await import('./llm-request.js')).LlmHttpStatusError('503', 503);
        wd.setPhase('body');
        wd.touch(0);
        return { value: 'ok', status: 200, okContext: {} };
      },
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await done).toBe('ok');
    for (const a of eventsOf('provider.llm.fake.attempt')) limits.push(ctxOf(a)['idle_limit_ms'] as number);
    expect(limits).toEqual([DEFAULT_LLM_IDLE_TIMEOUT_MS, DEFAULT_LLM_IDLE_TIMEOUT_MS]);
  });

  it('streaming calls keep the base idle limit (a gap in a stream is a real stall)', async () => {
    vi.useFakeTimers();
    let n = 0;
    const done = requestLlmWithRetry({
      provider: 'fakes', label: 'fakes', model: 'm', kind: 'text', endpoint: 'https://fake.example.com',
      limiterKey: 'fake-4471-s', streaming: true, promptChars: 1,
      run: async (wd) => {
        n += 1;
        wd.setPhase('body');
        wd.touch(1);
        if (n === 1) await wd.race(new Promise(() => { /* stalls */ }));
        return { value: 'ok', status: 200, okContext: {} };
      },
    });
    await vi.advanceTimersByTimeAsync(120_000 + 3_000);
    expect(await done).toBe('ok');
    expect(eventsOf('provider.llm.fakes.attempt').map((a) => ctxOf(a)['idle_limit_ms'])).toEqual([DEFAULT_LLM_IDLE_TIMEOUT_MS, DEFAULT_LLM_IDLE_TIMEOUT_MS]);
  });
});
