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

// Unit tests for LLM prompt trace capture (#1709).
//
// Security property (CLAUDE.md §5.7): the stored scrubbedPrompt MUST contain
// only post-redaction bytes -- [REDACTED...] markers in place of secrets.
// These tests verify the interface contract using a controlled mock provider
// that simulates the post-redaction trace the real providers produce.

import { describe, it, expect } from 'vitest';
import { UsageTrackingLlmProvider } from './usage-tracker.js';
import type { LlmProvider, LlmTrace } from './types.js';

class MockTraceProvider implements LlmProvider {
  readonly name = 'stub' as const;
  readonly model = 'mock-trace';
  private _trace: LlmTrace | undefined;

  setNextTrace(scrubbedPrompt: string, response: string): void {
    this._trace = { scrubbedPrompt, response };
  }

  async complete(_rawPrompt: string): Promise<string> {
    return this._trace?.response ?? 'mock-response';
  }

  getLastTrace(): LlmTrace | undefined {
    return this._trace;
  }
}

class NoTraceProvider implements LlmProvider {
  readonly name = 'stub' as const;
  readonly model = 'no-trace';
  async complete(_prompt: string): Promise<string> { return 'ok'; }
}

describe('UsageTrackingLlmProvider first-trace capture (#1709)', () => {
  it('getFirstTrace returns undefined before any complete() call', () => {
    const wrapper = new UsageTrackingLlmProvider(new MockTraceProvider());
    expect(wrapper.getFirstTrace()).toBeUndefined();
  });

  it('getFirstTrace is undefined when inner provider has no getLastTrace', async () => {
    const wrapper = new UsageTrackingLlmProvider(new NoTraceProvider());
    await wrapper.complete('prompt');
    expect(wrapper.getFirstTrace()).toBeUndefined();
  });

  it('getFirstTrace captures the first call trace', async () => {
    const inner = new MockTraceProvider();
    inner.setNextTrace('the post-redaction prompt', 'the response');
    const wrapper = new UsageTrackingLlmProvider(inner);
    await wrapper.complete('raw prompt');
    expect(wrapper.getFirstTrace()?.scrubbedPrompt).toBe('the post-redaction prompt');
    expect(wrapper.getFirstTrace()?.response).toBe('the response');
  });

  it('getFirstTrace is NOT overwritten by subsequent complete() calls', async () => {
    const inner = new MockTraceProvider();
    inner.setNextTrace('first-call-scrubbed', 'first-response');
    const wrapper = new UsageTrackingLlmProvider(inner);
    await wrapper.complete('prompt-1');
    inner.setNextTrace('second-call-scrubbed', 'second-response');
    await wrapper.complete('prompt-2');
    expect(wrapper.getFirstTrace()?.scrubbedPrompt).toBe('first-call-scrubbed');
  });

  it('getFirstTrace resets to undefined after reset()', async () => {
    const inner = new MockTraceProvider();
    inner.setNextTrace('some-scrubbed-prompt', 'some-response');
    const wrapper = new UsageTrackingLlmProvider(inner);
    await wrapper.complete('prompt');
    expect(wrapper.getFirstTrace()).toBeDefined();
    wrapper.reset();
    expect(wrapper.getFirstTrace()).toBeUndefined();
  });

  it('new pass session after reset() captures the new first call', async () => {
    const inner = new MockTraceProvider();
    inner.setNextTrace('pass-1-prompt', 'pass-1-response');
    const wrapper = new UsageTrackingLlmProvider(inner);
    await wrapper.complete('prompt-pass-1');
    wrapper.reset();
    inner.setNextTrace('pass-2-prompt', 'pass-2-response');
    await wrapper.complete('prompt-pass-2');
    expect(wrapper.getFirstTrace()?.scrubbedPrompt).toBe('pass-2-prompt');
  });

  it('security: scrubbedPrompt contains [REDACTED] marker, not the original secret', async () => {
    // This is the load-bearing security property from #1709 / CLAUDE.md §5.7.
    // The provider's complete() runs redactPreLlm internally; it stores the
    // post-redaction prompt in _lastTrace. The raw prompt (with the secret)
    // must never appear in the stored trace.
    const SECRET = 'api-key=MY_REAL_SECRET_VALUE_9001';
    const REDACTED = 'api-key=[REDACTED-by-gitleaks]';
    const inner = new MockTraceProvider();
    // Simulate what AnthropicLlmProvider/OpenAiLlmProvider do: store ONLY the
    // post-redaction text in lastTrace, even if complete() was called with the
    // raw (pre-redaction) prompt.
    inner.setNextTrace(REDACTED, '{"findings": []}');
    const wrapper = new UsageTrackingLlmProvider(inner);
    await wrapper.complete(SECRET);
    const trace = wrapper.getFirstTrace()!;
    expect(trace.scrubbedPrompt).not.toContain(SECRET);
    expect(trace.scrubbedPrompt).toContain('[REDACTED');
    expect(trace.scrubbedPrompt).toBe(REDACTED);
  });
});
