// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Comparison-engine verification (#1425, Design 092 s5.8).
//
// The matrix maths is verified DETERMINISTICALLY: seeded property-style
// sweeps (monotonicity, direction respect, bounds, spread guard,
// weight scale-invariance) plus hand-computed golden fixtures. Never
// LLM-checked (operator decision 2026-08-06).

import { describe, it, expect } from 'vitest';
import {
  normaliseProperty,
  rankScores,
  groupSubResult,
  finalResult,
  trafficLight,
  DEGENERATE_SPREAD_EPSILON,
  DEFAULT_WEIGHTS,
} from './comparison-engine.js';
import type { MetricDefinition } from './metric-catalogue.js';

function metric(direction: MetricDefinition['direction']): MetricDefinition {
  return {
    id: 'test.metric',
    group: 'performance',
    label: 'Test metric',
    unit: 'ms',
    direction,
    scope: 'per-leg',
    description: 'Synthetic metric used only by the deterministic engine verification tests.',
  };
}

/** Deterministic LCG so "property-style" sweeps never flake (no
 *  Math.random in tests). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

describe('normaliseProperty (#1425)', () => {
  it('golden: lower-is-better latency field from the 092 mockup', () => {
    // p50 latencies: claude 2100ms, deepseek 1400ms, llama 3000ms, ollama 8700ms.
    const r = normaliseProperty(metric('lower'), {
      claude: 2100, deepseek: 1400, llama: 3000, ollama: 8700,
    });
    // Hand-computed: min=1400 (best=100), max=8700 (worst=0);
    // claude = 1 - (2100-1400)/7300 = 0.90411 -> 90.4
    // llama  = 1 - (3000-1400)/7300 = 0.78082 -> 78.1
    expect(r.normalised['deepseek']).toBe(100);
    expect(r.normalised['ollama']).toBe(0);
    expect(r.normalised['claude']).toBe(90.4);
    expect(r.normalised['llama']).toBe(78.1);
    expect(r.degenerate).toBe(false);
  });

  it('golden: higher-is-better grounded rate', () => {
    const r = normaliseProperty(metric('higher'), { a: 97, b: 95, c: 81 });
    // min=81 (0), max=97 (100); b = (95-81)/16 = 0.875 -> 87.5
    expect(r.normalised['a']).toBe(100);
    expect(r.normalised['c']).toBe(0);
    expect(r.normalised['b']).toBe(87.5);
  });

  it('degenerate-spread guard: 99.1 vs 99.6 parse validity is a draw, not 0-vs-100', () => {
    const r = normaliseProperty(metric('higher'), { a: 99.1, b: 99.6 });
    expect(r.degenerate).toBe(true);
    expect(r.normalised['a']).toBe(100);
    expect(r.normalised['b']).toBe(100);
  });

  it('all-equal fields are degenerate draws', () => {
    const r = normaliseProperty(metric('lower'), { a: 5, b: 5, c: 5 });
    expect(r.degenerate).toBe(true);
    expect(Object.values(r.normalised)).toEqual([100, 100, 100]);
  });

  it('neutral metrics are never scored', () => {
    const r = normaliseProperty(metric('neutral'), { a: 1, b: 100 });
    expect(r.normalised['a']).toBeNull();
    expect(r.normalised['b']).toBeNull();
  });

  it('null legs are excluded, not zeroed', () => {
    const r = normaliseProperty(metric('lower'), { a: 100, b: null, c: 300 });
    expect(r.normalised['b']).toBeNull();
    expect(r.normalised['a']).toBe(100);
    expect(r.normalised['c']).toBe(0);
  });

  it('property sweep: bounds + direction respect + monotonicity (seeded)', () => {
    const rand = lcg(42);
    for (let round = 0; round < 200; round++) {
      const n = 2 + Math.floor(rand() * 4); // 2..5 legs
      const raw: Record<string, number | null> = {};
      for (let i = 0; i < n; i++) raw[`leg${i}`] = Math.round(rand() * 10000) / 10;
      const dir = rand() < 0.5 ? 'lower' as const : 'higher' as const;
      const r = normaliseProperty(metric(dir), raw);
      const scored = Object.entries(r.normalised).filter((e): e is [string, number] => e[1] !== null);
      for (const [, v] of scored) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
      if (!r.degenerate) {
        // Direction respect: the best raw value scores 100, the worst 0.
        const entries = Object.entries(raw) as Array<[string, number]>;
        const best = entries.reduce((a, b) => (dir === 'lower' ? (b[1] < a[1] ? b : a) : (b[1] > a[1] ? b : a)));
        const worst = entries.reduce((a, b) => (dir === 'lower' ? (b[1] > a[1] ? b : a) : (b[1] < a[1] ? b : a)));
        expect(r.normalised[best[0]]).toBe(100);
        expect(r.normalised[worst[0]]).toBe(0);
        // Monotonicity: better raw never scores lower.
        const sorted = entries.sort((a, b) => (dir === 'lower' ? a[1] - b[1] : b[1] - a[1]));
        for (let i = 1; i < sorted.length; i++) {
          expect(r.normalised[sorted[i - 1]![0]]!).toBeGreaterThanOrEqual(r.normalised[sorted[i]![0]]!);
        }
      }
    }
  });
});

describe('rankScores + trafficLight (#1425)', () => {
  it('competition ranking with shared ties (1, 1, 3)', () => {
    expect(rankScores({ a: 90, b: 90, c: 40, d: null })).toEqual({ a: 1, b: 1, c: 3, d: null });
  });

  it('traffic light bands per 092 s5.8', () => {
    expect(trafficLight(100)).toBe('ok');
    expect(trafficLight(66)).toBe('ok');
    expect(trafficLight(65.9)).toBe('warn');
    expect(trafficLight(33)).toBe('warn');
    expect(trafficLight(32.9)).toBe('red');
    expect(trafficLight(null)).toBe('none');
  });
});

describe('groupSubResult + finalResult (#1425)', () => {
  const perf = groupSubResult('performance', [
    normaliseProperty(metric('lower'), { fast: 1000, mid: 2000, slow: 4000 }),
    normaliseProperty(metric('higher'), { fast: 50, mid: 30, slow: 10 }),
  ]);

  it('group sub-result is the mean of scored properties with ranks', () => {
    expect(perf.score['fast']).toBe(100);
    expect(perf.score['slow']).toBe(0);
    expect(perf.rank['fast']).toBe(1);
    expect(perf.rank['slow']).toBe(3);
    expect(perf.light['slow']).toBe('red');
  });

  it('absence is not a zero: a leg null on one property averages over the rest', () => {
    const g = groupSubResult('cost', [
      normaliseProperty(metric('lower'), { a: 10, b: 20, local: null }),
      normaliseProperty(metric('lower'), { a: 1, b: 2, local: 3 }),
    ]);
    // local scored only on the second property.
    expect(g.score['local']).not.toBeNull();
    expect(g.score['a']).toBe(100);
  });

  it('final result: weight scale-invariance (x10 weights, identical ranks and scores)', () => {
    const groups = [perf];
    const w1 = finalResult(groups, { performance: 0.15, quality: 0.5, reliability: 0.2, cost: 0.15 });
    const w10 = finalResult(groups, { performance: 1.5, quality: 5, reliability: 2, cost: 1.5 });
    expect(w1.score).toEqual(w10.score);
    expect(w1.rank).toEqual(w10.rank);
  });

  it('final result: missing groups renormalise weights and mark the leg partial', () => {
    const cost = groupSubResult('cost', [
      normaliseProperty(metric('lower'), { fast: 10, mid: 20, slow: null }),
    ]);
    const r = finalResult([perf, cost], DEFAULT_WEIGHTS);
    // slow has no cost score -> partial, weights renormalised over performance.
    expect(r.partial['slow']).toContain('cost');
    expect(r.score['slow']).not.toBeNull();
    // fast leads both groups -> rank 1.
    expect(r.rank['fast']).toBe(1);
    // Published weights are normalised to sum 1.
    const sum = Object.values(r.weights).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 1000)).toBe(1000);
  });

  it('golden final: hand-computed weighted aggregate', () => {
    // One group under 'performance' (weight .15) and one under 'cost'
    // (weight .15); quality/reliability groups absent for ALL legs ->
    // weights renormalise to 0.5/0.5 for every leg.
    const cost = groupSubResult('cost', [
      normaliseProperty(metric('lower'), { fast: 30, mid: 10, slow: 20 }),
    ]);
    const r = finalResult([perf, cost], DEFAULT_WEIGHTS);
    // perf scores: fast 100, mid ~46.6ish? compute: latency: fast100 mid66.7? ->
    // latency: min1000 max4000: mid = 1-(2000-1000)/3000 = 66.7; tput: min10 max50: mid = (30-10)/40 = 50
    // perf mid = (66.7+50)/2 = 58.35 -> 58.4 (rounded per property then mean -> 58.4)
    // cost: min10 max20(mid best100, slow 50? compute: fast30 worst0; slow 1-(20-10)/20=50; mid 100
    // final mid = (58.4 + 100)/2 = 79.2; final fast = (100+0)/2 = 50; final slow = (0? slow perf=0 (worst latency+worst tput) +50)/2 = 25
    expect(r.score['mid']).toBe(79.2);
    expect(r.score['fast']).toBe(50);
    expect(r.score['slow']).toBe(25);
    expect(r.rank['mid']).toBe(1);
  });

  it('spread guard constant is the specified 2%', () => {
    expect(DEGENERATE_SPREAD_EPSILON).toBe(0.02);
  });
});
