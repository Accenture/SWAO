// #4372 (owner decision 2026-11-14): a leg, and a per-pass aggregate, with ANY
// unpriced call is "not measured" for the cost dimension and the cost ranking;
// it is not ranked on its priced calls only. The cost totals keep the priced
// sum plus the unpriced call count.

import { describe, it, expect } from 'vitest';
import { CallRecordSchema, sizeBucket, type CallRecord } from './call-record.js';
import { assembleGroups, legCostUsd, legUnpricedCalls } from './orchestrator.js';
import { finalResult } from './comparison-engine.js';
import { buildPassGroups } from './pass-groups.js';

function rec(leg: string, index: number, cost: { computed: number | null; source: 'billed' | 'configured' | 'unpriced' | 'local' }, pass = '03-data'): CallRecord {
  return CallRecordSchema.parse({
    leg: { id: leg, connector: leg.split('--')[0]!, model: leg.split('--')[1] ?? 'm' },
    pass_id: pass, call_site: 'site', call_index: index,
    prompt: { sha256: 'p', chars: 4000, tokens_est: 1000, size_bucket: sizeBucket(1000) },
    timing: { started: '2026-11-14T10:00:00Z', total_ms: 1000 },
    tokens: { prompt: 6640, completion: 1600 },
    cost_usd: cost,
    quality: { parse_valid: true, schema_conform: true, truncated: false, refusal_detected: false },
    reliability: { retries: 0, rate_limited: false, dnf: false },
    security: { redaction_marker_altered: false, foreign_path_count: 0, pii_reproduction_detected: false, prompt_injection_detected: false },
    response_sha256: 'r',
  });
}

const A = 'anthropic--claude-haiku-4-5';
const B = 'openrouter--mistralai_mistral-large';
const C = 'anthropic--claude-opus-4-7';

describe('cost ranking with partly unpriced legs (#4372 decision 1)', () => {
  // A: 2 priced calls (0.02). B: 1 priced call (0.001, cheapest if ranked on
  // priced calls only) plus 1 unpriced. C: 2 priced calls (0.2).
  const records = [
    rec(A, 0, { computed: 0.01, source: 'configured' }), rec(A, 1, { computed: 0.01, source: 'configured' }),
    rec(B, 0, { computed: 0.001, source: 'billed' }), rec(B, 1, { computed: null, source: 'unpriced' }),
    rec(C, 0, { computed: 0.1, source: 'configured' }), rec(C, 1, { computed: 0.1, source: 'configured' }),
  ];
  const legIds = [A, B, C];

  it('the partly unpriced leg has no cost score and no cost rank; the priced legs are ranked among themselves', () => {
    const cost = assembleGroups(records, {}, legIds).find((g) => g.group === 'cost')!;
    expect(cost.score[B]).toBeNull();
    expect(cost.rank[B]).toBeNull();
    expect(cost.rank[A]).toBe(1);
    expect(cost.rank[C]).toBe(2);
  });

  it('the final result marks the leg partial on cost instead of crediting it as cheapest', () => {
    const final = finalResult(assembleGroups(records, {}, legIds));
    expect(final.partial[B]).toContain('cost');
    expect(final.partial[A]).toBeUndefined();
  });

  it('the totals keep the priced sum and the unpriced count', () => {
    expect(legCostUsd(records, legIds)[B]).toBeCloseTo(0.001, 9);
    expect(legUnpricedCalls(records, legIds)[B]).toBe(1);
  });

  it('a fully priced field still ranks every leg (control)', () => {
    const priced = records.map((r) => (r.cost_usd.source === 'unpriced' ? rec(B, 1, { computed: 0.001, source: 'billed' }) : r));
    const cost = assembleGroups(priced, {}, legIds).find((g) => g.group === 'cost')!;
    expect(cost.rank[B]).toBe(1);
  });

  it('local legs are not unpriced: they stay excluded as before, without counting as unpriced calls', () => {
    const local = [...records, rec('ollama--llama', 0, { computed: null, source: 'local' })];
    expect(legUnpricedCalls(local, [...legIds, 'ollama--llama'])['ollama--llama']).toBe(0);
  });
});

describe('per-pass cost ranking with an unpriced call (#4372 decision 1)', () => {
  // Same latency and parse rate everywhere, so only cost can separate the legs.
  it('a pass aggregate with any unpriced call keeps its priced sum and is not ranked on cost', () => {
    const records = [
      rec(A, 0, { computed: 0.01, source: 'configured' }),
      rec(B, 0, { computed: 0.001, source: 'billed' }), rec(B, 1, { computed: null, source: 'unpriced' }),
    ];
    const g = buildPassGroups(records, [A, B]).find((x) => x.pass_id === '03-data')!;
    expect(g.legs[B]!.cost_usd).toBeCloseTo(0.001, 9);
    expect(g.legs[B]!.unpriced_calls).toBe(1);
    // Ranked on priced calls only, B (0.001) would beat A (0.01); excluded,
    // both legs draw on latency and parse rate.
    expect(g.rank[B]).toBe(g.rank[A]);
  });

  it('control: fully priced, the cheaper leg ranks first in the pass', () => {
    const records = [
      rec(A, 0, { computed: 0.01, source: 'configured' }),
      rec(B, 0, { computed: 0.001, source: 'billed' }), rec(B, 1, { computed: 0.001, source: 'billed' }),
    ];
    const g = buildPassGroups(records, [A, B]).find((x) => x.pass_id === '03-data')!;
    expect(g.rank[B]).toBe(1);
    expect(g.rank[A]).toBe(2);
  });
});
