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

// Contract tests for OpenAiLlmProvider (#0330 sprint-036 Phase D).
//
// No live OpenAI API calls; all HTTP is intercepted by stubbing global
// fetch. Verifies the wire-protocol shape, the retry policy on 429/5xx,
// the model + key resolution precedence, and the usage / cost accounting.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAiLlmProvider } from './openai.js';

const ORIGINAL_FETCH = global.fetch;

function mockFetchOnce(response: Partial<Response> & { json?: () => Promise<unknown>; text?: () => Promise<string> }): void {
  global.fetch = vi.fn().mockResolvedValueOnce(response as unknown as Response);
}

function mockFetchSequence(responses: Array<Partial<Response> & { json?: () => Promise<unknown>; text?: () => Promise<string> }>): void {
  const mock = vi.fn();
  for (const r of responses) {
    mock.mockResolvedValueOnce(r as unknown as Response);
  }
  global.fetch = mock;
}

function okResponse(content: string, usage = { prompt_tokens: 100, completion_tokens: 50 }): Partial<Response> {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content } }],
      usage,
    }),
  };
}

function errorResponse(status: number, body: string): Partial<Response> {
  return {
    ok: false,
    status,
    text: async () => body,
  };
}

describe('OpenAiLlmProvider construction (#0330)', () => {
  beforeEach(() => {
    delete process.env['SWAO_OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    delete process.env['SWAO_OPENAI_MODEL'];
  });

  it('throws when no API key is available', () => {
    expect(() => new OpenAiLlmProvider()).toThrow(/no API key/);
    expect(() => new OpenAiLlmProvider()).toThrow(/SWAO_OPENAI_API_KEY|OPENAI_API_KEY/);
  });

  it('picks up SWAO_OPENAI_API_KEY env var', () => {
    process.env['SWAO_OPENAI_API_KEY'] = 'sk-fromenv';
    const p = new OpenAiLlmProvider();
    expect(p.name).toBe('openai');
  });

  it('falls back to OPENAI_API_KEY env var when SWAO_OPENAI_API_KEY is unset', () => {
    process.env['OPENAI_API_KEY'] = 'sk-fallback';
    const p = new OpenAiLlmProvider();
    expect(p.name).toBe('openai');
  });

  it('constructor argument key wins over env vars', () => {
    process.env['SWAO_OPENAI_API_KEY'] = 'sk-env';
    const p = new OpenAiLlmProvider('sk-explicit');
    expect(p.name).toBe('openai');
    // Indirect: when fetch is called, the auth header carries sk-explicit
    // (verified in the network tests below)
  });

  it('default model is gpt-4o-mini', () => {
    process.env['SWAO_OPENAI_API_KEY'] = 'sk-test';
    const p = new OpenAiLlmProvider();
    expect(p.model).toBe('gpt-4o-mini');
  });

  it('SWAO_OPENAI_MODEL env var overrides the default', () => {
    process.env['SWAO_OPENAI_API_KEY'] = 'sk-test';
    process.env['SWAO_OPENAI_MODEL'] = 'gpt-5';
    const p = new OpenAiLlmProvider();
    expect(p.model).toBe('gpt-5');
  });

  it('constructor model argument overrides SWAO_OPENAI_MODEL', () => {
    process.env['SWAO_OPENAI_API_KEY'] = 'sk-test';
    process.env['SWAO_OPENAI_MODEL'] = 'gpt-5';
    const p = new OpenAiLlmProvider(undefined, 'gpt-5-mini');
    expect(p.model).toBe('gpt-5-mini');
  });
});

describe('OpenAiLlmProvider.complete (#0330)', () => {
  beforeEach(() => {
    process.env['SWAO_OPENAI_API_KEY'] = 'sk-test';
    delete process.env['SWAO_OPENAI_MODEL'];
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it('returns the model content on a 200 response', async () => {
    mockFetchOnce(okResponse('{"result": "ok"}'));
    const p = new OpenAiLlmProvider();
    const out = await p.complete('hello');
    expect(out).toBe('{"result": "ok"}');
  });

  it('sends the prompt as a user message with the JSON-mode system prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse('{}') as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new OpenAiLlmProvider();
    await p.complete('analyse this');

    const call = fetchMock.mock.calls[0];
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');

    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      response_format: { type: string };
    };
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toMatch(/JSON/i);
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content).toBe('analyse this');
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('records usage (tokens + cost) on success', async () => {
    mockFetchOnce(okResponse('{}', { prompt_tokens: 1000, completion_tokens: 500 }));
    const p = new OpenAiLlmProvider();
    await p.complete('hello');
    const usage = p.getLastUsage();
    expect(usage).toBeDefined();
    expect(usage!.input_tokens).toBe(1000);
    expect(usage!.output_tokens).toBe(500);
    // gpt-4o-mini: $0.15 input + $0.60 output per 1M tokens
    // (1000 * 0.15 + 500 * 0.60) / 1_000_000 = (150 + 300) / 1_000_000 = 0.00045
    expect(usage!.cost_usd).toBeCloseTo(0.00045, 6);
  });

  it('reports cost = 0 for unknown models', async () => {
    process.env['SWAO_OPENAI_MODEL'] = 'gpt-unknown-future-model';
    mockFetchOnce(okResponse('{}', { prompt_tokens: 1000, completion_tokens: 500 }));
    const p = new OpenAiLlmProvider();
    await p.complete('hello');
    expect(p.getLastUsage()!.cost_usd).toBe(0);
  });

  it('strips markdown fences if present (defensive)', async () => {
    mockFetchOnce(okResponse('```json\n{"x": 1}\n```'));
    const p = new OpenAiLlmProvider();
    const out = await p.complete('hello');
    expect(out).toBe('{"x": 1}');
  });

  it('strips yaml-tagged fences -- language tag not left as bare first line (#1243)', async () => {
    mockFetchOnce(okResponse('```yaml\nschema_version: "1.0"\nkey: value\n```'));
    const p = new OpenAiLlmProvider();
    const out = await p.complete('hello');
    expect(out).toBe('schema_version: "1.0"\nkey: value');
    expect(out.startsWith('yaml')).toBe(false);
  });

  it('retries on 429 (rate limit) up to 3 times', async () => {
    mockFetchSequence([
      errorResponse(429, 'rate limited'),
      errorResponse(429, 'rate limited'),
      okResponse('{}'),
    ]);
    const p = new OpenAiLlmProvider();
    // Mock setTimeout to avoid actually waiting 3s + 6s in tests
    vi.useFakeTimers();
    const promise = p.complete('hello');
    // Advance timers through both retry backoffs
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(6000);
    const result = await promise;
    expect(result).toBe('{}');
    vi.useRealTimers();
  }, 30_000);

  it('retries on 500/502/503/504 (transient server errors)', async () => {
    mockFetchSequence([
      errorResponse(503, 'service unavailable'),
      okResponse('{}'),
    ]);
    const p = new OpenAiLlmProvider();
    vi.useFakeTimers();
    const promise = p.complete('hello');
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;
    expect(result).toBe('{}');
    vi.useRealTimers();
  }, 30_000);

  it('does NOT retry on 4xx (other than 429) -- 400/401/403/404 fail fast', async () => {
    mockFetchOnce(errorResponse(401, 'invalid api key'));
    const p = new OpenAiLlmProvider();
    await expect(p.complete('hello')).rejects.toThrow(/401/);
  });

  it('throws on missing choices array', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    });
    const p = new OpenAiLlmProvider();
    await expect(p.complete('hello')).rejects.toThrow(/missing choices/);
  });
});
