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

// Unit tests for AnthropicLlmProvider.
//
// Covers the short-response overload detection introduced in sprint-097 (#1100):
// HTTP 200 with output_tokens < 20 must be treated as a retryable transient
// failure, not a hard JSON-parse error.
//
// Covers SSE streaming introduced in sprint-118 (#1767): responses are now
// consumed as Server-Sent Events streams rather than parsed via response.json().
//
// No live API calls -- global fetch is stubbed. Retry sleep is skipped via
// vi.useFakeTimers() + vi.runAllTimersAsync().

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AnthropicLlmProvider, LlmConnectivityError, classifyAnthropicHttpStatus } from './anthropic.js';
import { logPortfolio, logApp } from '@swao/core';

vi.mock('@swao/core', () => ({
  redactPreLlm: (text: string) => ({ text, counts: {} }),
  recordRedaction: vi.fn(),
  logPortfolio: vi.fn(),
  logApp: vi.fn(),
}));

const FAKE_KEY = 'sk-ant-test-0000';
const ORIGINAL_FETCH = global.fetch;

// Must be >= 500 chars so the short-response prompt-length guard (#1487) allows
// the heuristic to fire. Real assessment prompts are always far larger; the
// guard only prevents false positives on tiny synthetic prompts.
const LONG_PROMPT = 'Analyse the following workload configuration and respond with JSON. '.repeat(10);

// Build an SSE-format ReadableStream from a list of Anthropic event objects.
// #1767: the provider now reads response.body as a stream of SSE events instead
// of calling response.json(), so test mocks must provide a body stream.
function makeSseStream(events: object[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const payload = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(payload));
      controller.close();
    },
  });
}

function shortResponse(outputTokens: number, stopReason = 'end_turn'): Partial<Response> {
  return {
    ok: true,
    status: 200,
    body: makeSseStream([
      { type: 'message_start', message: { usage: { input_tokens: 100 } } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{' } },
      { type: 'message_delta', usage: { output_tokens: outputTokens }, delta: { stop_reason: stopReason } },
    ]),
  };
}

function fullResponse(content: string): Partial<Response> {
  return {
    ok: true,
    status: 200,
    body: makeSseStream([
      { type: 'message_start', message: { usage: { input_tokens: 100 } } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: content } },
      { type: 'message_delta', usage: { output_tokens: 50 }, delta: { stop_reason: 'end_turn' } },
    ]),
  };
}

describe('AnthropicLlmProvider construction', () => {
  beforeEach(() => {
    delete process.env['SWAO_ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('throws when no API key is available', () => {
    expect(() => new AnthropicLlmProvider()).toThrow(/no API key/);
  });

  it('accepts key from constructor argument', () => {
    const p = new AnthropicLlmProvider(FAKE_KEY);
    expect(p.name).toBe('anthropic');
  });

  it('picks up SWAO_ANTHROPIC_API_KEY env var', () => {
    process.env['SWAO_ANTHROPIC_API_KEY'] = FAKE_KEY;
    const p = new AnthropicLlmProvider();
    expect(p.name).toBe('anthropic');
  });
});

describe('AnthropicLlmProvider -- short-response overload detection (#1100)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env['SWAO_ANTHROPIC_API_KEY'] = FAKE_KEY;
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    vi.useRealTimers();
    delete process.env['SWAO_ANTHROPIC_API_KEY'];
  });

  it('retries a 6-token response and succeeds on the next attempt', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(shortResponse(6))
      .mockResolvedValueOnce(fullResponse('{"result":"ok"}'));
    global.fetch = fetchMock as typeof global.fetch;

    const provider = new AnthropicLlmProvider(FAKE_KEY);
    const resultPromise = provider.complete(LONG_PROMPT);
    await vi.runAllTimersAsync();

    const result = await resultPromise;
    expect(result).toBe('{"result":"ok"}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws LlmConnectivityError (not a JSON parse error) after all retries exhausted', async () => {
    // MAX_RETRIES = 5 -> 6 total attempts (attempt 0..5)
    // Each attempt must get its own fresh ReadableStream (can't reuse a consumed stream).
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(shortResponse(6)));
    global.fetch = fetchMock as typeof global.fetch;

    const provider = new AnthropicLlmProvider(FAKE_KEY);
    const resultPromise = provider.complete(LONG_PROMPT);
    // Attach rejection handler BEFORE advancing timers so it is handled as
    // soon as the promise rejects (prevents "unhandled rejection" warnings).
    const assertion = expect(resultPromise).rejects.toBeInstanceOf(LlmConnectivityError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('LlmConnectivityError message includes token count and stop_reason', async () => {
    // Each retry attempt needs a fresh ReadableStream.
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(shortResponse(3, 'max_tokens')));
    global.fetch = fetchMock as typeof global.fetch;

    const provider = new AnthropicLlmProvider(FAKE_KEY);
    const resultPromise = provider.complete(LONG_PROMPT);
    const assertion = expect(resultPromise).rejects.toThrow(/suspiciously short.*3 tokens.*max_tokens/);
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('does not retry when output_tokens >= 20', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(fullResponse('{"valid":"json"}'));
    global.fetch = fetchMock as typeof global.fetch;

    const provider = new AnthropicLlmProvider(FAKE_KEY);
    const result = await provider.complete('test prompt');
    expect(result).toBe('{"valid":"json"}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('"terminated" stream error is retried and succeeds on second attempt (#2016)', async () => {
    // Node.js/undici closes the response body mid-stream with Error("terminated")
    // when the server resets the connection. This was not in isRetryable, so the
    // recording-provider saw retries=0 and dnf=true for pass-11-comp call_index=0.
    const terminatedStream = new ReadableStream({
      start(controller) {
        controller.error(new Error('terminated'));
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: terminatedStream })
      .mockResolvedValueOnce(fullResponse('{"compliant":true}'));
    global.fetch = fetchMock as typeof global.fetch;

    const provider = new AnthropicLlmProvider(FAKE_KEY);
    const resultPromise = provider.complete(LONG_PROMPT);
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result).toBe('{"compliant":true}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('output_tokens === 0 with non-empty text is retried and succeeds on second attempt (#2019)', async () => {
    // First attempt: message_delta carries output_tokens=0 (malformed SSE from Anthropic
    // under high load). Fix: treat as retryable so the recorder gets correct token counts.
    // Second attempt uses output_tokens=50 (>= 20) to clear the shortness guard.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        body: makeSseStream([
          { type: 'message_start', message: { usage: { input_tokens: 50 } } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"x":1}' } },
          { type: 'message_delta', usage: { output_tokens: 0 }, delta: { stop_reason: 'end_turn' } },
        ]),
      })
      .mockResolvedValueOnce(fullResponse('{"x":1}'));
    global.fetch = fetchMock as typeof global.fetch;

    const provider = new AnthropicLlmProvider(FAKE_KEY);
    const resultPromise = provider.complete(LONG_PROMPT);
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result).toBe('{"x":1}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(provider.getLastUsage()?.output_tokens).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// #3221 / #3225: shared instrumented request helper
// ---------------------------------------------------------------------------

type LogCall = [string, string, string, { context?: Record<string, unknown> }?];

function eventsOf(code: string): LogCall[] {
  return (vi.mocked(logPortfolio).mock.calls as unknown as LogCall[]).filter(c => c[1] === code);
}

function ctxOf(call: LogCall | undefined): Record<string, unknown> {
  return call?.[3]?.context ?? {};
}

const IMAGE_A = Buffer.from('VISION-IMAGE-BYTES-A');
const IMAGE_B = Buffer.from('VISION-IMAGE-BYTES-B');
const VISION_PROMPT = 'VISION-PROMPT-MARKER describe the screen layout. '.repeat(20);

function assertNoPayloadInEvents(): void {
  const all = JSON.stringify([
    ...vi.mocked(logPortfolio).mock.calls,
    ...vi.mocked(logApp).mock.calls,
  ]);
  expect(all).not.toContain('VISION-PROMPT-MARKER');
  expect(all).not.toContain(IMAGE_A.toString('base64'));
  expect(all).not.toContain(IMAGE_B.toString('base64'));
}

function errorResponse(status: number, text: string): Partial<Response> {
  return { ok: false, status, text: async () => text };
}

/** A body that sends message_start and then goes silent forever. */
function stalledBody(): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 100 } } })}\n\n`));
    },
  });
}

describe('AnthropicLlmProvider -- vision events (#3221)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(logPortfolio).mockClear();
    vi.mocked(logApp).mockClear();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    vi.useRealTimers();
  });

  it('emits attempt and ok events with latency, tokens and cost through the shared helper', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(fullResponse('A login form with two fields.')));
    global.fetch = fetchMock as typeof global.fetch;

    const provider = new AnthropicLlmProvider(FAKE_KEY, 'claude-sonnet-4-6', 0, undefined, undefined, 'demo-app');
    const result = await provider.completeVision(VISION_PROMPT, [IMAGE_A, IMAGE_B]);

    expect(result).toBe('A login form with two fields.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { stream: boolean; messages: Array<{ content: Array<{ type: string }> }> };
    expect(sent.stream).toBe(true);
    expect(sent.messages[0].content.filter(b => b.type === 'image')).toHaveLength(2);

    const attempts = eventsOf('provider.llm.anthropic.attempt');
    expect(attempts).toHaveLength(1);
    expect(attempts[0][0]).toBe('info');
    expect(attempts[0][2]).toContain('attempt 1/6');
    expect(ctxOf(attempts[0])).toMatchObject({
      provider: 'anthropic', model: 'claude-sonnet-4-6', kind: 'vision', image_count: 2,
      attempt: 1, max_attempts: 6, prompt_chars: VISION_PROMPT.length,
    });

    const oks = eventsOf('provider.llm.anthropic.ok');
    expect(oks).toHaveLength(1);
    const okCtx = ctxOf(oks[0]);
    expect(okCtx).toMatchObject({
      kind: 'vision', image_count: 2, http_status: 200, tokens_in: 100, tokens_out: 50, attempt: 1, max_attempts: 6,
    });
    expect(typeof okCtx['latency_ms']).toBe('number');
    expect(okCtx['cost_usd']).toBeGreaterThan(0);
    expect(provider.getLastUsage()).toMatchObject({ input_tokens: 100, output_tokens: 50 });

    // #2002 parity: app-events dual log for the vision success too.
    const appOk = vi.mocked(logApp).mock.calls.filter(c => c[2] === 'provider.llm.anthropic.ok');
    expect(appOk).toHaveLength(1);
    assertNoPayloadInEvents();
  });

  it('logs an error-level http-error with status and classified reason before throwing on a non-200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(400, '{"type":"error","error":{"type":"invalid_request_error","message":"image too large"}}'));
    global.fetch = fetchMock as typeof global.fetch;

    const provider = new AnthropicLlmProvider(FAKE_KEY, 'claude-sonnet-4-6');
    await expect(provider.completeVision(VISION_PROMPT, [IMAGE_A])).rejects.toThrow(/vision request failed: 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const errs = eventsOf('provider.llm.anthropic.http-error');
    expect(errs).toHaveLength(1);
    expect(errs[0][0]).toBe('error');
    expect(ctxOf(errs[0])).toMatchObject({
      kind: 'vision', image_count: 1, http_status: 400, reason: 'bad_request', attempt: 1, max_attempts: 6,
    });
    // Not double-logged as a generic error.
    expect(eventsOf('provider.llm.anthropic.error')).toHaveLength(0);
    assertNoPayloadInEvents();
  });

  it('retries network failures and logs connectivity-failure at error level after 6 attempts', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.reject(new TypeError('fetch failed')));
    global.fetch = fetchMock as typeof global.fetch;

    const provider = new AnthropicLlmProvider(FAKE_KEY, 'claude-sonnet-4-6');
    const p = provider.completeVision(VISION_PROMPT, [IMAGE_A]);
    const assertion = expect(p).rejects.toBeInstanceOf(LlmConnectivityError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(6);
    const retries = eventsOf('provider.llm.anthropic.retry');
    expect(retries.map(r => ctxOf(r)['attempt'])).toEqual([1, 2, 3, 4, 5]);
    for (const r of retries) {
      expect(ctxOf(r)['max_attempts']).toBe(6);
      expect(ctxOf(r)['kind']).toBe('vision');
    }
    const failure = eventsOf('provider.llm.anthropic.connectivity-failure');
    expect(failure).toHaveLength(1);
    expect(failure[0][0]).toBe('error');
    expect(failure[0][2]).toContain('All 6 Anthropic vision attempts exhausted');
    expect(ctxOf(failure[0])).toMatchObject({ max_attempts: 6, reason: 'network_or_malformed_response' });
    assertNoPayloadInEvents();
  });

  it('classifies HTTP statuses into content-free reasons', () => {
    expect(classifyAnthropicHttpStatus(400)).toBe('bad_request');
    expect(classifyAnthropicHttpStatus(401)).toBe('auth');
    expect(classifyAnthropicHttpStatus(403)).toBe('auth');
    expect(classifyAnthropicHttpStatus(404)).toBe('not_found');
    expect(classifyAnthropicHttpStatus(413)).toBe('payload_too_large');
    expect(classifyAnthropicHttpStatus(429)).toBe('rate_limited');
    expect(classifyAnthropicHttpStatus(529)).toBe('overloaded');
    expect(classifyAnthropicHttpStatus(503)).toBe('server_error');
    expect(classifyAnthropicHttpStatus(418)).toBe('client_error');
  });
});

describe('AnthropicLlmProvider -- retry numbering (#3225)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(logPortfolio).mockClear();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    vi.useRealTimers();
  });

  it('attempt and retry events use one scheme: attempt N/6 everywhere', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errorResponse(529, '{"type":"error","error":{"type":"overloaded_error"}}'))
      .mockResolvedValueOnce(fullResponse('{"ok":true}'));
    global.fetch = fetchMock as typeof global.fetch;

    const provider = new AnthropicLlmProvider(FAKE_KEY);
    const p = provider.complete(LONG_PROMPT);
    await vi.runAllTimersAsync();
    expect(await p).toBe('{"ok":true}');

    const attempts = eventsOf('provider.llm.anthropic.attempt');
    expect(attempts.map(a => a[2])).toEqual([
      expect.stringContaining('attempt 1/6'),
      expect.stringContaining('attempt 2/6'),
    ]);
    const retries = eventsOf('provider.llm.anthropic.retry');
    expect(retries).toHaveLength(1);
    expect(retries[0][2]).toContain('attempt 1/6 failed');
    expect(retries[0][2]).toContain('as attempt 2/6');
    expect(ctxOf(retries[0])).toMatchObject({ attempt: 1, next_attempt: 2, max_attempts: 6, reason: 'overloaded', kind: 'text' });
    expect(ctxOf(retries[0])).not.toHaveProperty('max_retries');
    expect(ctxOf(eventsOf('provider.llm.anthropic.ok')[0])).toMatchObject({ attempt: 2, max_attempts: 6 });
  });
});

describe('AnthropicLlmProvider -- per-attempt stall watchdog (#3225)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(logPortfolio).mockClear();
    delete process.env['SWAO_ANTHROPIC_IDLE_TIMEOUT_MS'];
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    vi.useRealTimers();
    delete process.env['SWAO_ANTHROPIC_IDLE_TIMEOUT_MS'];
  });

  it('a stalled body emits waiting at 60 s, times out at 120 s, aborts the request and retries', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: stalledBody() })
      .mockImplementationOnce(() => Promise.resolve(fullResponse('{"recovered":true}')));
    global.fetch = fetchMock as typeof global.fetch;

    const provider = new AnthropicLlmProvider(FAKE_KEY);
    const p = provider.complete(LONG_PROMPT);
    let settled = false;
    void p.then(() => { settled = true; }, () => { settled = true; });

    await vi.advanceTimersByTimeAsync(59_999);
    expect(eventsOf('provider.llm.anthropic.waiting')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    const waiting = eventsOf('provider.llm.anthropic.waiting');
    expect(waiting).toHaveLength(1);
    expect(waiting[0][0]).toBe('warn');
    expect(ctxOf(waiting[0])).toMatchObject({ phase: 'body', attempt: 1, max_attempts: 6, idle_timeout_ms: 120_000 });

    await vi.advanceTimersByTimeAsync(59_999);
    expect(eventsOf('provider.llm.anthropic.timeout')).toHaveLength(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const timeouts = eventsOf('provider.llm.anthropic.timeout');
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0][0]).toBe('warn');
    expect(ctxOf(timeouts[0])).toMatchObject({ phase: 'body', limit: 'idle', limit_ms: 120_000, attempt: 1, max_attempts: 6 });
    // The real request is aborted, not just abandoned.
    expect((fetchMock.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);

    const retries = eventsOf('provider.llm.anthropic.retry');
    expect(retries).toHaveLength(1);
    expect(ctxOf(retries[0])).toMatchObject({ attempt: 1, next_attempt: 2, max_attempts: 6, reason: 'timeout_idle_body' });

    await vi.advanceTimersByTimeAsync(3_000);
    expect(await p).toBe('{"recovered":true}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Timers from the stalled attempt are disposed: no further waiting events.
    const waitingCount = eventsOf('provider.llm.anthropic.waiting').length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(eventsOf('provider.llm.anthropic.waiting')).toHaveLength(waitingCount);
  });

  it('a request with no response headers times out in the headers phase', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise(() => { /* never resolves */ }))
      .mockImplementationOnce(() => Promise.resolve(fullResponse('{"ok":1}')));
    global.fetch = fetchMock as typeof global.fetch;

    const provider = new AnthropicLlmProvider(FAKE_KEY);
    const p = provider.completeVision(VISION_PROMPT, [IMAGE_A]);
    await vi.advanceTimersByTimeAsync(120_000);
    const timeouts = eventsOf('provider.llm.anthropic.timeout');
    expect(timeouts).toHaveLength(1);
    expect(ctxOf(timeouts[0])).toMatchObject({ phase: 'headers', limit: 'idle', kind: 'vision' });
    expect((fetchMock.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await p).toBe('{"ok":1}');
  });

  it('SSE chunks (pings) reset the idle timer, so a slow but live stream is not cut', async () => {
    const enc = new TextEncoder();
    const ping = enc.encode('event: ping\ndata: {"type": "ping"}\n\n');
    const final = enc.encode([
      { type: 'message_start', message: { usage: { input_tokens: 100 } } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"slow":true}' } },
      { type: 'message_delta', usage: { output_tokens: 50 }, delta: { stop_reason: 'end_turn' } },
    ].map(e => `data: ${JSON.stringify(e)}\n\n`).join(''));
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const t of [50_000, 100_000, 150_000]) setTimeout(() => c.enqueue(ping), t);
        setTimeout(() => { c.enqueue(final); c.close(); }, 200_000);
      },
    });
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, body });
    global.fetch = fetchMock as typeof global.fetch;

    const provider = new AnthropicLlmProvider(FAKE_KEY);
    const p = provider.complete(LONG_PROMPT);
    await vi.advanceTimersByTimeAsync(200_000);
    expect(await p).toBe('{"slow":true}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(eventsOf('provider.llm.anthropic.timeout')).toHaveLength(0);
    // Data kept flowing, so waiting events are info, not warn.
    const waiting = eventsOf('provider.llm.anthropic.waiting');
    expect(waiting.length).toBeGreaterThan(0);
    for (const w of waiting) expect(w[0]).toBe('info');
  });

  it('honours SWAO_ANTHROPIC_IDLE_TIMEOUT_MS', async () => {
    process.env['SWAO_ANTHROPIC_IDLE_TIMEOUT_MS'] = '5000';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: stalledBody() })
      .mockImplementationOnce(() => Promise.resolve(fullResponse('{"ok":2}')));
    global.fetch = fetchMock as typeof global.fetch;

    const provider = new AnthropicLlmProvider(FAKE_KEY);
    const p = provider.complete(LONG_PROMPT);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(eventsOf('provider.llm.anthropic.timeout')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(ctxOf(eventsOf('provider.llm.anthropic.timeout')[0])).toMatchObject({ limit_ms: 5000 });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await p).toBe('{"ok":2}');
  });
});

describe('AnthropicLlmProvider.completeWithTools -- failing tool call (#3312)', () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it('a failing onToolCall is passed to the model as a [Tool error: ...] tool_result', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'swao_risks', input: {} }],
          stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ content: [{ type: 'text', text: 'The tool failed.' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 1 } }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const text = await new AnthropicLlmProvider(FAKE_KEY, 'claude-sonnet-4-6').completeWithTools({
      system: 's', messages: [{ role: 'user', content: 'q' }],
      tools: [{ name: 'swao_risks', description: 'd', input_schema: { type: 'object' } }],
      onToolCall: async () => { throw new Error('MCP timeout after 300000ms'); },
    });

    expect(text).toBe('The tool failed.');
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const msgs = (JSON.parse(init.body as string) as { messages: Array<{ role: string; content: unknown }> }).messages;
    expect(msgs[msgs.length - 1]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '[Tool error: MCP timeout after 300000ms]' }],
    });
  });
});
