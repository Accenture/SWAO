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

// #3301: every call result carries its own usage, so concurrent calls on one
// provider (Pass 11, #3222 / #3284) are attributed correctly. The shared
// getLastUsage() state is kept only as a deprecated fallback.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return { ...actual, logPortfolio: vi.fn(), logApp: vi.fn() };
});

import { UsageTrackingLlmProvider } from '../usage-tracker.js';
import { LlmCacheLayer } from '../cache.js';
import { OllamaLlmProvider } from '../ollama.js';
import { completeWithUsage } from '../completion.js';
import type { LlmCompletion, LlmProvider, LlmTrace, LlmUsage } from '../types.js';

/** Deferred promise helper. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const USAGE_A: LlmUsage = { input_tokens: 100, output_tokens: 10, cost_usd: 0.1 };
const USAGE_B: LlmUsage = { input_tokens: 7000, output_tokens: 700, cost_usd: 7 };

/**
 * Provider whose calls finish when the test resolves them. Like the real
 * drivers it overwrites one shared lastUsage / lastTrace when a call
 * completes, and it returns each call's own usage from completeDetailed().
 */
class GatedProvider implements LlmProvider {
  readonly name = 'stub' as const;
  readonly model = 'gated';
  private lastUsage: LlmUsage | undefined;
  private lastTrace: LlmTrace | undefined;
  readonly gates = new Map<string, ReturnType<typeof deferred<LlmUsage>>>();

  gate(prompt: string): ReturnType<typeof deferred<LlmUsage>> {
    const d = deferred<LlmUsage>();
    this.gates.set(prompt, d);
    return d;
  }

  async complete(prompt: string): Promise<string> {
    return (await this.completeDetailed(prompt)).text;
  }

  async completeDetailed(prompt: string): Promise<LlmCompletion> {
    const usage = await this.gates.get(prompt)!.promise;
    const text = `answer to ${prompt}`;
    const trace = { scrubbedPrompt: prompt, response: text };
    this.lastUsage = usage;
    this.lastTrace = trace;
    return { text, usage, trace };
  }

  getLastUsage(): LlmUsage | undefined { return this.lastUsage; }
  getLastTrace(): LlmTrace | undefined { return this.lastTrace; }
}

describe('per-call usage (#3301)', () => {
  it('concurrent calls with different usage each carry their own usage; getLastUsage would misattribute', async () => {
    const inner = new GatedProvider();
    const tracker = new UsageTrackingLlmProvider(inner);
    const gateA = inner.gate('A');
    const gateB = inner.gate('B');

    // A is sent first, B second; B finishes first, A last. Both resolve in
    // the same tick, so a getLastUsage() read after either call sees the
    // usage of whichever finished last.
    const pA = tracker.completeDetailed('A');
    const pB = tracker.completeDetailed('B');
    gateB.resolve(USAGE_B);
    gateA.resolve(USAGE_A);
    const [a, b] = await Promise.all([pA, pB]);

    expect(a.usage).toEqual(USAGE_A);
    expect(b.usage).toEqual(USAGE_B);
    expect(a.text).toBe('answer to A');
    expect(b.text).toBe('answer to B');

    // The shared state holds only one of the two: reading it per call (the
    // pre-#3301 behaviour) attributes the same usage to both calls.
    const shared = inner.getLastUsage();
    expect(shared).toEqual(USAGE_A);
    expect(shared).not.toEqual(b.usage);

    // The accumulator is the exact sum, and the first-SENT call's trace is
    // kept as the sample.
    expect(tracker.snapshot()).toEqual({
      input_tokens: 7100,
      output_tokens: 710,
      cost_usd: 7.1,
      call_count: 2,
    });
    expect(tracker.getFirstTrace()?.scrubbedPrompt).toBe('A');
  });

  it('plain complete() through the tracker accumulates per call too', async () => {
    const inner = new GatedProvider();
    const tracker = new UsageTrackingLlmProvider(inner);
    const gates = [inner.gate('x'), inner.gate('y'), inner.gate('z')];
    const calls = ['x', 'y', 'z'].map((p) => tracker.complete(p));
    gates[2]!.resolve({ input_tokens: 3, output_tokens: 30, cost_usd: 0.3 });
    gates[0]!.resolve({ input_tokens: 1, output_tokens: 10, cost_usd: 0.1 });
    gates[1]!.resolve({ input_tokens: 2, output_tokens: 20, cost_usd: 0.2 });
    await Promise.all(calls);
    const s = tracker.snapshot();
    expect(s.input_tokens).toBe(6);
    expect(s.output_tokens).toBe(60);
    expect(s.cost_usd).toBeCloseTo(0.6, 9);
    expect(s.call_count).toBe(3);
  });

  it('falls back to the deprecated getLastUsage() for providers without completeDetailed', async () => {
    const legacy: LlmProvider = {
      name: 'stub',
      model: 'legacy',
      complete: async () => 'legacy answer',
      getLastUsage: () => ({ input_tokens: 5, output_tokens: 6, cost_usd: 0.01 }),
    };
    const r = await completeWithUsage(legacy, 'p');
    expect(r).toEqual({ text: 'legacy answer', usage: { input_tokens: 5, output_tokens: 6, cost_usd: 0.01 }, trace: undefined });
    const tracker = new UsageTrackingLlmProvider(legacy);
    await tracker.complete('p');
    expect(tracker.snapshot()).toEqual({ input_tokens: 5, output_tokens: 6, cost_usd: 0.01, call_count: 1 });
  });

  describe('real driver path (Ollama)', () => {
    const originalFetch = global.fetch;
    afterEach(() => { global.fetch = originalFetch; });

    it('concurrent completeDetailed() calls on one driver return their own usage', async () => {
      const pending: Array<{ body: string; resolve: (r: unknown) => void }> = [];
      global.fetch = vi.fn((_url: unknown, init?: { body?: string }) => new Promise((resolve) => {
        pending.push({ body: init?.body ?? '', resolve });
      })) as unknown as typeof fetch;
      const reply = (promptEval: number, evalCount: number) => ({
        ok: true,
        status: 200,
        json: async () => ({ response: `{"n":${promptEval}}`, prompt_eval_count: promptEval, eval_count: evalCount }),
      });

      const p = new OllamaLlmProvider('llama3', 'http://ollama.test', 0, undefined, { inputPerMillion: 1_000_000, outputPerMillion: 2_000_000 });
      const first = p.completeDetailed('first prompt');
      const second = p.completeDetailed('second prompt');
      await vi.waitFor(() => expect(pending).toHaveLength(2));
      const byPrompt = (s: string) => pending.find((x) => x.body.includes(s))!;
      byPrompt('second prompt').resolve(reply(20, 2));
      byPrompt('first prompt').resolve(reply(10, 1));

      const [r1, r2] = await Promise.all([first, second]);
      expect(r1.usage).toEqual({ input_tokens: 10, output_tokens: 1, cost_usd: 12 });
      expect(r2.usage).toEqual({ input_tokens: 20, output_tokens: 2, cost_usd: 24 });
      expect(r1.trace?.response).toBe(r1.text);
      // complete() keeps returning the text only.
      pending.length = 0;
      const plain = p.complete('third prompt');
      await vi.waitFor(() => expect(pending).toHaveLength(1));
      pending[0]!.resolve(reply(3, 4));
      expect(await plain).toBe('{"n":3}');
    });
  });

  describe('cache layer', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'swao-3301-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('a miss carries the inner call usage, a hit carries zero usage', async () => {
      const inner = new GatedProvider();
      const cache = new LlmCacheLayer(inner, dir, 30, false);
      inner.gate('q').resolve(USAGE_B);
      const miss = await cache.completeDetailed('q');
      expect(miss.usage).toEqual(USAGE_B);
      const hit = await cache.completeDetailed('q');
      expect(hit.text).toBe(miss.text);
      expect(hit.usage).toEqual({ input_tokens: 0, output_tokens: 0, cost_usd: 0 });
    });
  });
});
