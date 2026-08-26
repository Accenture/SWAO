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

import { describe, it, expect, vi, afterEach } from 'vitest';
import { FixedLlmProvider } from './fixed.js';
import { OllamaLlmProvider } from './ollama.js';
import { AnthropicLlmProvider, LlmConnectivityError } from './anthropic.js';
import { createLlmProvider } from './factory.js';

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env['SWAO_LLM_PROVIDER'];
  delete process.env['SWAO_OLLAMA_URL'];
  delete process.env['SWAO_OLLAMA_MODEL'];
  delete process.env['SWAO_ANTHROPIC_API_KEY'];
  delete process.env['ANTHROPIC_API_KEY'];
});

// ---------------------------------------------------------------------------
// FixedLlmProvider
// ---------------------------------------------------------------------------

describe('FixedLlmProvider (#0117)', () => {
  it('returns the fixed response regardless of prompt', async () => {
    const llm = new FixedLlmProvider('hello world');
    const result = await llm.complete('any prompt');
    expect(result).toBe('hello world');
  });

  it('returns empty string when constructed with empty string', async () => {
    const llm = new FixedLlmProvider('');
    expect(await llm.complete('prompt')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// OllamaLlmProvider
// ---------------------------------------------------------------------------

describe('OllamaLlmProvider (#0117)', () => {
  it('calls the correct Ollama endpoint and returns response field', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: 'ollama output' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const llm = new OllamaLlmProvider();
    const result = await llm.complete('test prompt');

    expect(result).toBe('ollama output');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/generate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('uses SWAO_OLLAMA_URL and SWAO_OLLAMA_MODEL env vars', async () => {
    process.env['SWAO_OLLAMA_URL'] = 'http://custom-ollama:11434';
    process.env['SWAO_OLLAMA_MODEL'] = 'mistral';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: 'out' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const llm = new OllamaLlmProvider();
    await llm.complete('prompt');

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://custom-ollama:11434/api/generate');
    const body = JSON.parse(opts.body as string) as { model: string };
    expect(body.model).toBe('mistral');
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' }));
    const llm = new OllamaLlmProvider();
    await expect(llm.complete('prompt')).rejects.toThrow('503');
  });

  it('throws when response field is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const llm = new OllamaLlmProvider();
    await expect(llm.complete('prompt')).rejects.toThrow('missing "response"');
  });
});

// ---------------------------------------------------------------------------
// AnthropicLlmProvider
// ---------------------------------------------------------------------------

describe('AnthropicLlmProvider (#0117)', () => {
  it('throws if no API key is available', () => {
    expect(() => new AnthropicLlmProvider()).toThrow('no API key');
  });

  it('accepts an explicit API key parameter', () => {
    expect(() => new AnthropicLlmProvider('sk-test-key')).not.toThrow();
  });

  it('reads SWAO_ANTHROPIC_API_KEY from env', () => {
    process.env['SWAO_ANTHROPIC_API_KEY'] = 'sk-env-key';
    expect(() => new AnthropicLlmProvider()).not.toThrow();
  });

  it('calls the Anthropic messages endpoint and returns text block', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'anthropic output' }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const llm = new AnthropicLlmProvider('sk-test-key');
    const result = await llm.complete('test prompt');

    // Response returned as-is (no prefill since #0216 -- Opus 4.7
    // rejects assistant-message prefill).
    expect(result).toBe('anthropic output');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('scrubs PII from the prompt before sending to the API (#0354 provider boundary)', async () => {
    const captured: { body?: string } = {};
    const mockFetch = vi.fn().mockImplementation((url: string, init: { body: string }) => {
      captured.body = init.body;
      return Promise.resolve({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const llm = new AnthropicLlmProvider('sk-test-key');
    await llm.complete('Contact owner alice@client.example about SSN 123-45-6789');

    expect(captured.body).toBeDefined();
    const parsed = JSON.parse(captured.body!) as { messages: { role: string; content: string }[] };
    const userContent = parsed.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userContent).toContain('[REDACTED-EMAIL]');
    expect(userContent).toContain('[REDACTED-SSN]');
    expect(userContent).not.toContain('alice@client.example');
    expect(userContent).not.toContain('123-45-6789');
  });

  it('throws on non-ok Anthropic response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"invalid_api_key"}',
    }));
    const llm = new AnthropicLlmProvider('sk-bad-key');
    await expect(llm.complete('prompt')).rejects.toThrow('401');
  });
});

// ---------------------------------------------------------------------------
// createLlmProvider factory
// ---------------------------------------------------------------------------

describe('createLlmProvider factory (#0117)', () => {
  it('throws when SWAO_LLM_PROVIDER is unset (no silent default)', () => {
    expect(() => createLlmProvider('ghostfolio', 'test')).toThrow(/No LLM provider configured/);
  });

  it('throws when SWAO_LLM_PROVIDER=stub (#0473: stub deleted from production)', () => {
    process.env['SWAO_LLM_PROVIDER'] = 'stub';
    expect(() => createLlmProvider('ghostfolio', 'test')).toThrow(/Unknown LLM provider/);
  });

  it('returns OllamaLlmProvider when SWAO_LLM_PROVIDER=ollama', () => {
    process.env['SWAO_LLM_PROVIDER'] = 'ollama';
    const llm = createLlmProvider();
    expect(llm).toBeInstanceOf(OllamaLlmProvider);
  });

  it('gateway path honours SWAO_LLM_MODEL when no config model is given (#1409)', () => {
    // The TUI parent passes connector + model to the spawned assess child
    // via env vars; the ollama seed needs no credential to construct.
    process.env['SWAO_LLM_CONNECTOR'] = 'ollama';
    process.env['SWAO_LLM_MODEL'] = 'llama3.3-test';
    try {
      const llm = createLlmProvider('app', 'pass');
      expect(llm.model).toBe('llama3.3-test');
    } finally {
      delete process.env['SWAO_LLM_CONNECTOR'];
      delete process.env['SWAO_LLM_MODEL'];
    }
  });

  it('returns AnthropicLlmProvider when SWAO_LLM_PROVIDER=anthropic', () => {
    process.env['SWAO_LLM_PROVIDER'] = 'anthropic';
    process.env['SWAO_ANTHROPIC_API_KEY'] = 'sk-test';
    const llm = createLlmProvider();
    expect(llm).toBeInstanceOf(AnthropicLlmProvider);
  });

  it('throws (no silent stub substitution) for unknown provider name (#0325)', () => {
    process.env['SWAO_LLM_PROVIDER'] = 'unknown-provider';
    expect(() => createLlmProvider('app', 'pass')).toThrow(/Unknown LLM provider/);
  });

  it("returns OpenAiLlmProvider when SWAO_LLM_PROVIDER=openai (#0330)", async () => {
    // Sprint-034 #0325 Option B shipped the hard-fail; sprint-036 #0330
    // shipped the real driver as Option A. The factory now constructs the
    // OpenAI driver instead of throwing.
    process.env['SWAO_LLM_PROVIDER'] = 'openai';
    process.env['SWAO_OPENAI_API_KEY'] = 'sk-test';
    const { OpenAiLlmProvider } = await import('./openai.js');
    const llm = createLlmProvider();
    expect(llm).toBeInstanceOf(OpenAiLlmProvider);
    expect(llm.name).toBe('openai');
  });

  it("OpenAiLlmProvider throws a clear error when no API key is available (#0330)", async () => {
    // Mirror Anthropic's "no key" behaviour: clear error pointing the
    // operator at the env vars + credential store path.
    process.env['SWAO_LLM_PROVIDER'] = 'openai';
    delete process.env['SWAO_OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    expect(() => createLlmProvider('app', 'pass')).toThrow(/no API key/);
    expect(() => createLlmProvider('app', 'pass')).toThrow(/SWAO_OPENAI_API_KEY|OPENAI_API_KEY/);
  });

  it("OpenAiLlmProvider resolves model from SWAO_OPENAI_MODEL env var (#0330)", async () => {
    process.env['SWAO_LLM_PROVIDER'] = 'openai';
    process.env['SWAO_OPENAI_API_KEY'] = 'sk-test';
    process.env['SWAO_OPENAI_MODEL'] = 'gpt-5-mini';
    const llm = createLlmProvider();
    expect(llm.model).toBe('gpt-5-mini');
    delete process.env['SWAO_OPENAI_MODEL'];
  });

  it("OpenAiLlmProvider resolves model from config.model (overrides env) (#0330)", async () => {
    process.env['SWAO_LLM_PROVIDER'] = 'openai';
    process.env['SWAO_OPENAI_API_KEY'] = 'sk-test';
    process.env['SWAO_OPENAI_MODEL'] = 'gpt-4o-mini';
    const llm = createLlmProvider(undefined, undefined, { type: 'openai', model: 'gpt-5' });
    expect(llm.model).toBe('gpt-5');  // config wins over env
    delete process.env['SWAO_OPENAI_MODEL'];
  });

  it('emits a structured "provider.llm.unknown" log entry for an unrecognised provider (#0325 / #0327)', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env['SWAO_LLM_PROVIDER'] = 'unknown-provider';
    expect(() => createLlmProvider('app', 'pass')).toThrow();
    const lines = errorSpy.mock.calls.map((args) => String(args[0]));
    expect(lines.some((l) => /provider\.llm\.unknown/.test(l))).toBe(true);
    expect(lines.some((l) => /valid options/.test(l))).toBe(true);
    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// temperature=0 default tests (#0466)
// ---------------------------------------------------------------------------

describe('LLM driver temperature defaults (#0466)', () => {
  it('Anthropic driver omits temperature when default (0) -- newer Claude 4.x deprecated it (#0482)', async () => {
    // sprint-051 #0466: temperature defaults to 0 for determinism.
    // sprint-054 #0482: temperature=0 OMITTED from Anthropic request body because
    // claude-opus-4-7+ returns HTTP 400 "temperature is deprecated for this model".
    // Omitting is equivalent to temperature=0 for these models.
    const captured: { body?: string } = {};
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: { body: string }) => {
      captured.body = init.body;
      return Promise.resolve({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }], usage: {} }) });
    }));
    const llm = new AnthropicLlmProvider('sk-test');
    await llm.complete('test');
    const body = JSON.parse(captured.body!) as { temperature?: number };
    // temperature is intentionally absent from the default request
    expect(body.temperature).toBeUndefined();
  });

  it('Anthropic driver sends explicit non-zero temperature when configured', async () => {
    const captured: { body?: string } = {};
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: { body: string }) => {
      captured.body = init.body;
      return Promise.resolve({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }], usage: {} }) });
    }));
    const llm = new AnthropicLlmProvider('sk-test', undefined, 0.7);
    await llm.complete('test');
    const body = JSON.parse(captured.body!) as { temperature?: number };
    expect(body.temperature).toBe(0.7);
  });

  it('Ollama driver sends temperature=0 and seed in options by default', async () => {
    const captured: { body?: string } = {};
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: { body: string }) => {
      captured.body = init.body;
      return Promise.resolve({ ok: true, json: async () => ({ response: 'ok' }) });
    }));
    const llm = new OllamaLlmProvider(undefined, undefined, 0, 42);
    await llm.complete('test');
    const body = JSON.parse(captured.body!) as { options: { temperature: number; seed: number } };
    expect(body.options.temperature).toBe(0);
    expect(body.options.seed).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// LlmConnectivityError (#0716)
// ---------------------------------------------------------------------------

describe('LlmConnectivityError (#0716)', () => {
  it('is exported and is an Error subclass with correct name and message', () => {
    const err = new LlmConnectivityError('connection reset by peer');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LlmConnectivityError);
    expect(err.name).toBe('LlmConnectivityError');
    expect(err.message).toContain('LLM connectivity failure');
    expect(err.message).toContain('connection reset by peer');
  });

  it('AnthropicLlmProvider throws LlmConnectivityError after all retries exhausted', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));
      const llm = new AnthropicLlmProvider('sk-test');
      // Attach catch early to prevent unhandledRejection warning during timer advance
      const caught: { err?: unknown } = {};
      const completionPromise = llm.complete('test prompt').catch((e: unknown) => { caught.err = e; });
      await vi.runAllTimersAsync();
      await completionPromise;
      expect(caught.err).toBeInstanceOf(LlmConnectivityError);
    } finally {
      vi.useRealTimers();
    }
  }, 15000);

  it('AnthropicLlmProvider does not throw LlmConnectivityError for non-retryable network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('some non-retryable programming error')));
    const llm = new AnthropicLlmProvider('sk-test');
    await expect(llm.complete('test')).rejects.toThrow('some non-retryable programming error');
    await expect(llm.complete('test')).rejects.not.toBeInstanceOf(LlmConnectivityError);
  });
});
