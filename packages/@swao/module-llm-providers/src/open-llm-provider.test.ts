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

// Contract tests for OpenLlmProvider + OpenLlmEmbeddingProvider
// (Design 082 -- open-llm-provider driver, issue #1221).
//
// No live HTTP calls; all network interaction is intercepted by stubbing
// global fetch.  Covers:
//   - URL construction (with and without modelPrefix)
//   - Empty-string modelPrefix disables path routing
//   - Auth header injection (Bearer token)
//   - costPerToken calculation (non-zero result)
//   - 200 success path
//   - 429 / 503 retry path
//   - Missing model throws; missing baseUrl throws
//   - Multi-env resolution via SWAO_LLM_ENV + factory resolveEnvConfig
//   - TEI 1.8 embed request and flat/batch response parsing

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenLlmProvider, OpenLlmEmbeddingProvider } from './open-llm-provider.js';
import { LlmConnectivityError } from './anthropic.js';
import { createLlmProvider } from './factory.js';

const ORIGINAL_FETCH = global.fetch;

// ---------------------------------------------------------------------------
// Fetch stub helpers
// ---------------------------------------------------------------------------

function mockFetchOnce(
  response: Partial<Response> & { json?: () => Promise<unknown>; text?: () => Promise<string> },
): void {
  global.fetch = vi.fn().mockResolvedValueOnce(response as unknown as Response);
}

function mockFetchSequence(
  responses: Array<Partial<Response> & { json?: () => Promise<unknown>; text?: () => Promise<string> }>,
): void {
  const mock = vi.fn();
  for (const r of responses) mock.mockResolvedValueOnce(r as unknown as Response);
  global.fetch = mock;
}

function okCompletions(
  content: string,
  usage = { prompt_tokens: 200, completion_tokens: 100 },
): Partial<Response> {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }], usage }),
  };
}

function errorResponse(status: number, body: string): Partial<Response> {
  return { ok: false, status, text: async () => body };
}

// ---------------------------------------------------------------------------
// Construction tests
// ---------------------------------------------------------------------------

describe('OpenLlmProvider construction', () => {
  beforeEach(() => {
    delete process.env['SWAO_OPEN_LLM_MODEL'];
    delete process.env['SWAO_OPEN_LLM_URL'];
    delete process.env['SWAO_OPEN_LLM_API_KEY'];
    delete process.env['SWAO_LLM_ENV'];
  });

  it('throws when model is not provided via arg or env var', () => {
    expect(() => new OpenLlmProvider(undefined, undefined, 'https://host.example.com')).toThrow(
      /no model configured/,
    );
    expect(() => new OpenLlmProvider(undefined, undefined, 'https://host.example.com')).toThrow(
      /SWAO_OPEN_LLM_MODEL/,
    );
  });

  it('throws when baseUrl is not provided via arg or env var', () => {
    expect(() => new OpenLlmProvider(undefined, 'my-model', undefined)).toThrow(
      /no baseUrl configured/,
    );
    expect(() => new OpenLlmProvider(undefined, 'my-model', undefined)).toThrow(
      /SWAO_OPEN_LLM_URL/,
    );
  });

  it('resolves model from SWAO_OPEN_LLM_MODEL env var', () => {
    process.env['SWAO_OPEN_LLM_MODEL'] = 'env-model';
    const p = new OpenLlmProvider(undefined, undefined, 'https://host.example.com');
    expect(p.model).toBe('env-model');
  });

  it('resolves baseUrl from SWAO_OPEN_LLM_URL env var', () => {
    process.env['SWAO_OPEN_LLM_URL'] = 'https://env-host.example.com';
    const p = new OpenLlmProvider(undefined, 'my-model', undefined);
    expect(p.model).toBe('my-model');
  });

  it('name field returns open-llm-provider', () => {
    const p = new OpenLlmProvider(undefined, 'test-model', 'https://host.example.com');
    expect(p.name).toBe('open-llm-provider');
  });
});

// ---------------------------------------------------------------------------
// URL construction tests
// ---------------------------------------------------------------------------

describe('OpenLlmProvider URL construction', () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it('builds URL with default prefix /<model> when modelPrefix is not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okCompletions('{}') as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new OpenLlmProvider(undefined, 'Mistral-Small-24B', 'https://preme.example.com');
    await p.complete('test');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://preme.example.com/Mistral-Small-24B/v1/chat/completions');
  });

  it('uses explicit modelPrefix instead of /<model>', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okCompletions('{}') as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new OpenLlmProvider(
      undefined,
      'Mistral-Small-24B',
      'https://preme.example.com',
      '/custom-prefix',
    );
    await p.complete('test');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://preme.example.com/custom-prefix/v1/chat/completions');
  });

  it('empty-string modelPrefix disables path routing (body model field only)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okCompletions('{}') as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    // modelPrefix = '' (empty string, valid -- not undefined)
    const p = new OpenLlmProvider(undefined, 'Mistral-Small-24B', 'https://preme.example.com', '');
    await p.complete('test');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    // With empty prefix: baseUrl + '' + /v1/chat/completions
    expect(url).toBe('https://preme.example.com/v1/chat/completions');
  });
});

// ---------------------------------------------------------------------------
// Auth header tests
// ---------------------------------------------------------------------------

describe('OpenLlmProvider auth header injection', () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
    delete process.env['SWAO_OPEN_LLM_API_KEY'];
  });

  it('injects Bearer token in Authorization header when apiKey is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okCompletions('{}') as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new OpenLlmProvider('test-token', 'my-model', 'https://host.example.com');
    await p.complete('hello');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
  });

  it('resolves apiKey from SWAO_OPEN_LLM_API_KEY env var when no arg provided', async () => {
    process.env['SWAO_OPEN_LLM_API_KEY'] = 'env-token';
    const fetchMock = vi.fn().mockResolvedValueOnce(okCompletions('{}') as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new OpenLlmProvider(undefined, 'my-model', 'https://host.example.com');
    await p.complete('hello');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer env-token');
  });

  it('omits Authorization header when no apiKey is available (unauthenticated endpoint)', async () => {
    delete process.env['SWAO_OPEN_LLM_API_KEY'];
    const fetchMock = vi.fn().mockResolvedValueOnce(okCompletions('{}') as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new OpenLlmProvider(undefined, 'my-model', 'https://host.example.com');
    await p.complete('hello');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// costPerToken calculation
// ---------------------------------------------------------------------------

describe('OpenLlmProvider costPerToken calculation', () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it('calculates non-zero cost when costPerToken is configured', async () => {
    mockFetchOnce(okCompletions('{}', { prompt_tokens: 1000, completion_tokens: 500 }));
    const p = new OpenLlmProvider('tok', 'my-model', 'https://host.example.com', undefined, 0, undefined, {
      inputPerMillion: 0.10,
      outputPerMillion: 0.40,
    });
    await p.complete('hello');
    const usage = p.getLastUsage();
    expect(usage).toBeDefined();
    expect(usage!.input_tokens).toBe(1000);
    expect(usage!.output_tokens).toBe(500);
    // (1000 * 0.10 + 500 * 0.40) / 1_000_000 = (100 + 200) / 1_000_000 = 0.0003
    expect(usage!.cost_usd).toBeCloseTo(0.0003, 7);
  });

  it('records cost_usd = 0 when costPerToken is absent', async () => {
    mockFetchOnce(okCompletions('{}', { prompt_tokens: 1000, completion_tokens: 500 }));
    const p = new OpenLlmProvider('tok', 'my-model', 'https://host.example.com');
    await p.complete('hello');
    expect(p.getLastUsage()!.cost_usd).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// complete() success path
// ---------------------------------------------------------------------------

describe('OpenLlmProvider.complete', () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it('returns the model content on a 200 response', async () => {
    mockFetchOnce(okCompletions('{"result": "pass"}'));
    const p = new OpenLlmProvider('tok', 'my-model', 'https://host.example.com');
    const out = await p.complete('analyse this');
    expect(out).toBe('{"result": "pass"}');
  });

  it('sends a JSON body with model, messages, and response_format', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okCompletions('{}') as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new OpenLlmProvider('tok', 'vllm-model', 'https://host.example.com');
    await p.complete('analyse this');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      response_format: { type: string };
    };
    expect(body.model).toBe('vllm-model');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content).toBe('analyse this');
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('strips markdown code fences when present (defensive)', async () => {
    mockFetchOnce(okCompletions('```json\n{"x": 1}\n```'));
    const p = new OpenLlmProvider('tok', 'my-model', 'https://host.example.com');
    const out = await p.complete('hello');
    expect(out).toBe('{"x": 1}');
  });

  it('strips yaml-tagged fences -- language tag not left as bare first line (#1243)', async () => {
    mockFetchOnce(okCompletions('```yaml\nschema_version: "1.0"\nkey: value\n```'));
    const p = new OpenLlmProvider('tok', 'my-model', 'https://host.example.com');
    const out = await p.complete('hello');
    expect(out).toBe('schema_version: "1.0"\nkey: value');
    expect(out.startsWith('yaml')).toBe(false);
  });

  it('throws when response is missing choices[0].message.content', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    });
    const p = new OpenLlmProvider('tok', 'my-model', 'https://host.example.com');
    await expect(p.complete('hello')).rejects.toThrow(/missing content/);
  });

  it('retries on 429 (rate limit) up to 3 times', async () => {
    mockFetchSequence([
      errorResponse(429, 'rate limited'),
      errorResponse(429, 'rate limited'),
      okCompletions('{}'),
    ]);
    const p = new OpenLlmProvider('tok', 'my-model', 'https://host.example.com');
    vi.useFakeTimers();
    const promise = p.complete('hello');
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.advanceTimersByTimeAsync(6_000);
    const result = await promise;
    expect(result).toBe('{}');
    vi.useRealTimers();
  }, 30_000);

  it('retries on 503 (transient server error)', async () => {
    mockFetchSequence([errorResponse(503, 'unavailable'), okCompletions('{}')]);
    const p = new OpenLlmProvider('tok', 'my-model', 'https://host.example.com');
    vi.useFakeTimers();
    const promise = p.complete('hello');
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await promise;
    expect(result).toBe('{}');
    vi.useRealTimers();
  }, 30_000);

  it('does NOT retry on 4xx (other than 429) -- fails fast', async () => {
    mockFetchOnce(errorResponse(401, 'unauthorised'));
    const p = new OpenLlmProvider('tok', 'my-model', 'https://host.example.com');
    await expect(p.complete('hello')).rejects.toThrow(/401/);
  });

  it('throws LlmConnectivityError when all retries exhausted on 429', async () => {
    mockFetchSequence([
      errorResponse(429, 'rate limited'),
      errorResponse(429, 'rate limited'),
      errorResponse(429, 'rate limited'),
      errorResponse(429, 'rate limited'),
    ]);
    const p = new OpenLlmProvider('tok', 'my-model', 'https://host.example.com');
    vi.useFakeTimers();
    const promise = p.complete('hello');
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.advanceTimersByTimeAsync(6_000);
    await vi.advanceTimersByTimeAsync(12_000);
    await expect(promise).rejects.toBeInstanceOf(LlmConnectivityError);
    vi.useRealTimers();
  }, 30_000);

  it('throws LlmConnectivityError when all retries exhausted on 503', async () => {
    mockFetchSequence([
      errorResponse(503, 'unavailable'),
      errorResponse(503, 'unavailable'),
      errorResponse(503, 'unavailable'),
      errorResponse(503, 'unavailable'),
    ]);
    const p = new OpenLlmProvider('tok', 'my-model', 'https://host.example.com');
    vi.useFakeTimers();
    const promise = p.complete('hello');
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.advanceTimersByTimeAsync(6_000);
    await vi.advanceTimersByTimeAsync(12_000);
    await expect(promise).rejects.toBeInstanceOf(LlmConnectivityError);
    vi.useRealTimers();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Multi-env resolution via factory.ts createLlmProvider (Design 082 §4.4)
// ---------------------------------------------------------------------------

describe('Multi-env resolution via createLlmProvider (Design 082 §4.4)', () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
    delete process.env['SWAO_LLM_ENV'];
  });

  const envConfig = {
    type: 'open-llm-provider' as const,
    environments: {
      dev: {
        type: 'open-llm-provider',
        baseUrl: 'https://dev.example.com',
        model: 'dev-model',
      },
      prod: {
        type: 'open-llm-provider',
        baseUrl: 'https://prod.example.com',
        model: 'prod-model',
      },
    },
    activeEnv: 'prod',
  };

  it('picks the prod block when SWAO_LLM_ENV=prod', async () => {
    process.env['SWAO_LLM_ENV'] = 'prod';
    const provider = createLlmProvider(undefined, undefined, envConfig);
    expect(provider.model).toBe('prod-model');
  });

  it('picks the dev block when SWAO_LLM_ENV=dev', async () => {
    process.env['SWAO_LLM_ENV'] = 'dev';
    const provider = createLlmProvider(undefined, undefined, envConfig);
    expect(provider.model).toBe('dev-model');
  });

  it('falls back to activeEnv when SWAO_LLM_ENV is not set', () => {
    delete process.env['SWAO_LLM_ENV'];
    const provider = createLlmProvider(undefined, undefined, envConfig);
    expect(provider.model).toBe('prod-model');
  });

  it('throws a clear error when SWAO_LLM_ENV names a missing environment', () => {
    process.env['SWAO_LLM_ENV'] = 'staging';
    expect(() => createLlmProvider(undefined, undefined, envConfig)).toThrow(
      /SWAO_LLM_ENV='staging' not found/,
    );
  });
});

// ---------------------------------------------------------------------------
// OpenLlmEmbeddingProvider -- TEI 1.8 /embed (Design 082 §5.3)
// ---------------------------------------------------------------------------

describe('OpenLlmEmbeddingProvider', () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  function makeEmbedProvider(apiKey?: string): OpenLlmEmbeddingProvider {
    return new OpenLlmEmbeddingProvider(
      'https://preme.example.com',
      'nomic-embed-text-v15',
      apiKey,
    );
  }

  it('sends a TEI 1.8 /embed request with { inputs: text }', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [0.1, 0.2, 0.3],
    } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    await makeEmbedProvider('tok').embed('hello world');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://preme.example.com/nomic-embed-text-v15/embed');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
    const body = JSON.parse(init.body as string) as { inputs: string };
    expect(body.inputs).toBe('hello world');
  });

  it('parses a flat number[] vector response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [0.1, 0.2, 0.3],
    } as unknown as Response) as unknown as typeof fetch;

    const result = await makeEmbedProvider().embed('test');
    expect(result.vector).toEqual([0.1, 0.2, 0.3]);
    expect(result.input_tokens).toBe(0);
    expect(result.cost_usd).toBe(0);
  });

  it('parses a number[][] batch response and returns the first vector', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [[0.4, 0.5, 0.6], [0.7, 0.8, 0.9]],
    } as unknown as Response) as unknown as typeof fetch;

    const result = await makeEmbedProvider().embed('test');
    expect(result.vector).toEqual([0.4, 0.5, 0.6]);
  });

  it('throws on non-2xx response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'unavailable',
    } as unknown as Response) as unknown as typeof fetch;

    await expect(makeEmbedProvider().embed('test')).rejects.toThrow(/503/);
  });

  it('embedBatch makes sequential embed calls for each text', async () => {
    const responses = [
      { ok: true, status: 200, json: async () => [0.1, 0.2] },
      { ok: true, status: 200, json: async () => [0.3, 0.4] },
    ];
    const mock = vi.fn();
    for (const r of responses) mock.mockResolvedValueOnce(r as unknown as Response);
    global.fetch = mock as unknown as typeof fetch;

    const results = await makeEmbedProvider().embedBatch(['text a', 'text b']);
    expect(results).toHaveLength(2);
    expect(results[0].vector).toEqual([0.1, 0.2]);
    expect(results[1].vector).toEqual([0.3, 0.4]);
    expect(mock).toHaveBeenCalledTimes(2);
  });
});
