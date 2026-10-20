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

// #3301: usage attribution through the real host composition
// recording(usageTracking(provider)) under concurrent calls (Pass 11 fan-out).
// The provider overwrites one shared lastUsage per completed call, as every
// network driver does; only the per-call result keeps calls apart.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageTrackingLlmProvider } from '@swao/module-llm-providers';
import type { LlmCompletion, LlmProvider, LlmUsage } from '@swao/module-llm-providers';
import { createRecordingProvider, createLegRecorderFromEnv, LEG_ENV } from '@swao/module-llm-assessment';

class GatedProvider implements LlmProvider {
  readonly name = 'stub' as const;
  readonly model = 'gated';
  private lastUsage: LlmUsage | undefined;
  private readonly gates = new Map<string, (u: LlmUsage) => void>();

  release(prompt: string, usage: LlmUsage): void {
    this.gates.get(prompt)!(usage);
  }

  async complete(prompt: string): Promise<string> {
    return (await this.completeDetailed(prompt)).text;
  }

  async completeDetailed(prompt: string): Promise<LlmCompletion> {
    const usage = await new Promise<LlmUsage>((resolve) => { this.gates.set(prompt, resolve); });
    this.lastUsage = usage;
    return { text: `{"answer":"${prompt}"}`, usage };
  }

  getLastUsage(): LlmUsage | undefined { return this.lastUsage; }
}

const SMALL: LlmUsage = { input_tokens: 100, output_tokens: 10, cost_usd: 0.01 };
const LARGE: LlmUsage = { input_tokens: 5000, output_tokens: 500, cost_usd: 0.5 };

describe('usage attribution under concurrency (#3301)', () => {
  let dir: string | undefined;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

  it('recorder over tracker: each concurrent call is recorded with its own tokens and cost', async () => {
    const inner = new GatedProvider();
    const tracker = new UsageTrackingLlmProvider(inner);
    const recording = createRecordingProvider(tracker, {
      leg: { id: 'leg', connector: 'c', model: 'gated' },
      usageSnapshot: () => tracker.snapshot(),
      costSource: 'billed',
      currentContext: () => ({ passId: '11-compliance', callSite: 'batch' }),
      onRecord: () => {},
    });

    // Sent A then B; B finishes first and A last, in the same tick.
    const pA = recording.complete('A');
    const pB = recording.complete('B');
    inner.release('B', LARGE);
    inner.release('A', SMALL);
    await Promise.all([pA, pB]);

    const records = [...recording.records()].sort((x, y) => x.call_index - y.call_index);
    expect(records.map((r) => r.tokens.prompt)).toEqual([100, 5000]);
    expect(records.map((r) => r.tokens.completion)).toEqual([10, 500]);
    expect(records.map((r) => r.cost_usd.computed)).toEqual([0.01, 0.5]);
    expect(tracker.snapshot()).toMatchObject({ input_tokens: 5100, output_tokens: 510, call_count: 2 });
    // The shared state would have given both calls the same usage.
    expect(inner.getLastUsage()).toEqual(SMALL);
  });

  it('leg-mode wrap records completeDetailed() calls too (no bypass via the prototype)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'swao-3301-leg-'));
    const sink = join(dir, 'calls.ndjson');
    const legs = createLegRecorderFromEnv({ [LEG_ENV.RECORD]: sink, [LEG_ENV.COST_SOURCE]: 'billed' })!;
    const inner = new GatedProvider();
    const tracker = new UsageTrackingLlmProvider(inner);
    const wrapped = legs.wrap(tracker, () => tracker.snapshot());

    const p = wrapped.completeDetailed('C');
    inner.release('C', LARGE);
    const r = await p;
    expect(r.usage).toEqual(LARGE);
    const lines = readFileSync(sink, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).tokens).toMatchObject({ prompt: 5000, completion: 500 });
  });
});
