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
import { AnthropicLlmProvider, LlmConnectivityError } from './anthropic.js';

vi.mock('@swao/core', () => ({
  redactPreLlm: (text: string) => ({ text, counts: {} }),
  recordRedaction: vi.fn(),
  logPortfolio: vi.fn(),
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
