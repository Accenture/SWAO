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

import { describe, it, expect } from 'vitest';
import { UsageTrackingLlmProvider, mergeUsage, anthropicCostUsd } from '@swao/module-llm-providers';
import type { LlmProvider, LlmUsage } from '@swao/module-llm-providers';

class FakeLlmProvider implements LlmProvider {
  readonly name = 'stub' as const;
  readonly model = 'fake-test';
  private next: LlmUsage | undefined;
  private callCount = 0;

  constructor(private readonly responses: Array<{ text: string; usage?: LlmUsage }>) {}

  async complete(_prompt: string): Promise<string> {
    const r = this.responses[this.callCount % this.responses.length]!;
    this.callCount += 1;
    this.next = r.usage;
    return r.text;
  }

  getLastUsage(): LlmUsage | undefined {
    return this.next;
  }
}

class NoUsageProvider implements LlmProvider {
  readonly name = 'stub' as const;
  readonly model = 'fake-no-usage';
  async complete(_prompt: string): Promise<string> {
    return '{}';
  }
  // No getLastUsage -- the wrapper must tolerate this.
}

describe('anthropicCostUsd (#0188)', () => {
  it('computes cost for opus-4-7 from price table', () => {
    // 1k input tokens at $15/MTok = $0.015; 500 output at $75/MTok = $0.0375
    const cost = anthropicCostUsd('claude-opus-4-7', 1000, 500);
    expect(cost).toBeCloseTo(0.015 + 0.0375, 6);
  });

  it('computes cost for sonnet-4-6 from price table', () => {
    const cost = anthropicCostUsd('claude-sonnet-4-6', 10_000, 2_000);
    expect(cost).toBeCloseTo((10_000 * 3 + 2_000 * 15) / 1_000_000, 6);
  });

  it('returns 0 for an unknown model', () => {
    expect(anthropicCostUsd('claude-mystery-9000', 1000, 500)).toBe(0);
  });

  it('handles the dated haiku model id', () => {
    const cost = anthropicCostUsd('claude-haiku-4-5-20251001', 5_000, 1_000);
    expect(cost).toBeCloseTo((5_000 * 1 + 1_000 * 5) / 1_000_000, 6);
  });
});

describe('UsageTrackingLlmProvider (#0188)', () => {
  it('starts with zero accumulator', () => {
    const inner = new FakeLlmProvider([{ text: 'x' }]);
    const tracker = new UsageTrackingLlmProvider(inner);
    expect(tracker.snapshot()).toEqual({ input_tokens: 0, output_tokens: 0, cost_usd: 0, call_count: 0 });
  });

  it('passes complete() through and accumulates one call', async () => {
    const inner = new FakeLlmProvider([{ text: '{"ok": true}', usage: { input_tokens: 1000, output_tokens: 200, cost_usd: 0.013 } }]);
    const tracker = new UsageTrackingLlmProvider(inner);
    const result = await tracker.complete('hello');
    expect(result).toBe('{"ok": true}');
    expect(tracker.snapshot()).toEqual({ input_tokens: 1000, output_tokens: 200, cost_usd: 0.013, call_count: 1 });
  });

  it('accumulates across multiple calls within a pass', async () => {
    const inner = new FakeLlmProvider([
      { text: 'a', usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.001 } },
      { text: 'b', usage: { input_tokens: 200, output_tokens: 80, cost_usd: 0.002 } },
      { text: 'c', usage: { input_tokens: 50, output_tokens: 25, cost_usd: 0.0005 } },
    ]);
    const tracker = new UsageTrackingLlmProvider(inner);
    await tracker.complete('p1');
    await tracker.complete('p2');
    await tracker.complete('p3');
    const acc = tracker.snapshot();
    expect(acc.input_tokens).toBe(350);
    expect(acc.output_tokens).toBe(155);
    expect(acc.cost_usd).toBeCloseTo(0.0035, 6);
    expect(acc.call_count).toBe(3);
  });

  it('reset() clears the accumulator without resetting call history', async () => {
    const inner = new FakeLlmProvider([
      { text: 'a', usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.001 } },
      { text: 'b', usage: { input_tokens: 200, output_tokens: 80, cost_usd: 0.002 } },
    ]);
    const tracker = new UsageTrackingLlmProvider(inner);
    await tracker.complete('p1');
    expect(tracker.snapshot().call_count).toBe(1);
    tracker.reset();
    expect(tracker.snapshot()).toEqual({ input_tokens: 0, output_tokens: 0, cost_usd: 0, call_count: 0 });
    await tracker.complete('p2');
    expect(tracker.snapshot()).toEqual({ input_tokens: 200, output_tokens: 80, cost_usd: 0.002, call_count: 1 });
  });

  it('tolerates a provider without getLastUsage (stays at zero except call_count)', async () => {
    const inner = new NoUsageProvider();
    const tracker = new UsageTrackingLlmProvider(inner);
    await tracker.complete('x');
    await tracker.complete('y');
    expect(tracker.snapshot()).toEqual({ input_tokens: 0, output_tokens: 0, cost_usd: 0, call_count: 2 });
  });

  it('snapshot() returns a copy, not a live reference', async () => {
    const inner = new FakeLlmProvider([{ text: 'a', usage: { input_tokens: 10, output_tokens: 5, cost_usd: 0.0001 } }]);
    const tracker = new UsageTrackingLlmProvider(inner);
    await tracker.complete('x');
    const snap = tracker.snapshot();
    await tracker.complete('y');
    expect(snap.call_count).toBe(1);
    expect(tracker.snapshot().call_count).toBe(2);
  });
});

describe('mergeUsage (#0188)', () => {
  it('sums two accumulators', () => {
    const a = { input_tokens: 100, output_tokens: 50, cost_usd: 0.01, call_count: 1 };
    const b = { input_tokens: 200, output_tokens: 80, cost_usd: 0.02, call_count: 1 };
    expect(mergeUsage(a, b)).toEqual({ input_tokens: 300, output_tokens: 130, cost_usd: 0.03, call_count: 2 });
  });

  it('handles zero accumulators', () => {
    const z = { input_tokens: 0, output_tokens: 0, cost_usd: 0, call_count: 0 };
    expect(mergeUsage(z, z)).toEqual(z);
  });
});
