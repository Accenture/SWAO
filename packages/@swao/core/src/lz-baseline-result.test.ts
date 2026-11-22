// #3871: lz-baseline-result/1 schema (Design 123 sections 8.1 and 9.1).

import { describe, it, expect } from 'vitest';
import { LzBaselineResultSchema, LZ_BASELINE_RESULT_SCHEMA, baselineTieAtCut, compareBaselineWorstFirst, sameBaselineRank } from './lz-baseline-result.js';

const base = {
  schema: LZ_BASELINE_RESULT_SCHEMA,
  lz_id: 'lz-a', scope_id: 'platform', provider: 'otc',
  framework: 'CLIENT_LZ_POLICY_BASELINE', baseline_of: 'CLIENT_LZ_POLICY_BASELINE', catalogue_version: '1.0.0',
  sha256: 'a'.repeat(64), overall: 'NEEDS_VERIFICATION',
};
const row = {
  id: 'CPB-RES-01', kind: 'region_residency', category: 'data_residency', control: 'CPB-RES-01', severity: 'blocker',
  offering: 'READY', estate: 'pass', observability: 'observed', detail: '3 resources in 1 region, all allowed',
};

describe('LzBaselineResultSchema (#3871)', () => {
  it('accepts a result with policies, not reviewed, disabled and provenance', () => {
    const r = LzBaselineResultSchema.parse({
      ...base, policies: [row], not_reviewed: [{ id: 'CPB-LOG-03', kind: 'audit_trail', params: { all_regions: true } }],
      disabled: ['CPB-SVC-01'], requirement_provenance: [{ requirement: 'residency_country', value: 'DE', frameworks: ['CLIENT_LZ_POLICY_BASELINE'] }],
    });
    expect(r.policies).toHaveLength(1);
    expect(LzBaselineResultSchema.parse(base).policies).toEqual([]);
  });

  it('rejects new verdict values, unknown kinds, unknown keys and a wrong schema tag', () => {
    expect(LzBaselineResultSchema.safeParse({ ...base, overall: 'FIT' }).success).toBe(false);
    expect(LzBaselineResultSchema.safeParse({ ...base, policies: [{ ...row, kind: 'quantum' }] }).success).toBe(false);
    expect(LzBaselineResultSchema.safeParse({ ...base, policies: [{ ...row, resource_ids: [] }] }).success).toBe(false);
    expect(LzBaselineResultSchema.safeParse({ ...base, schema: 'lz-baseline-result/2' }).success).toBe(false);
    expect(LzBaselineResultSchema.safeParse({ ...base, requirement_provenance: [{ requirement: 'residency_country', value: 'DE', frameworks: [] }] }).success).toBe(false);
  });
});

// #4052 (Design 123 section 9.6): worst-first order of baseline policies.
describe('compareBaselineWorstFirst (#4052)', () => {
  const k = (id: string, estate: 'fail' | 'warn' | 'pass', severity: 'blocker' | 'warning' | 'info', offering: 'READY' | 'READY_WITH_CHANGES' | 'NEEDS_VERIFICATION' | 'BLOCKED' | 'SOVEREIGNTY_BLOCKED') => ({ id, estate, severity, offering });

  it('orders estate, then severity, then offering (blocked first), then id', () => {
    const list = [
      k('A-01', 'fail', 'blocker', 'READY_WITH_CHANGES'),
      k('B-01', 'fail', 'blocker', 'NEEDS_VERIFICATION'),
      k('C-01', 'fail', 'blocker', 'BLOCKED'),
      k('D-01', 'fail', 'blocker', 'SOVEREIGNTY_BLOCKED'),
      k('E-01', 'fail', 'warning', 'BLOCKED'),
      k('F-01', 'warn', 'blocker', 'BLOCKED'),
      k('G-01', 'fail', 'blocker', 'READY'),
    ];
    expect([...list].sort(compareBaselineWorstFirst).map((x) => x.id)).toEqual(['D-01', 'C-01', 'B-01', 'A-01', 'G-01', 'E-01', 'F-01']);
  });

  it('reports a cut inside a group of equal rank, not a cut between ranks', () => {
    const ranked = [k('Z-01', 'fail', 'blocker', 'BLOCKED'), k('A-01', 'fail', 'blocker', 'READY_WITH_CHANGES'), k('B-01', 'fail', 'blocker', 'READY_WITH_CHANGES'), k('C-01', 'fail', 'blocker', 'READY_WITH_CHANGES')].sort(compareBaselineWorstFirst);
    expect(baselineTieAtCut(ranked, 2)).toMatchObject({ size: 3, shown: 1, key: { offering: 'READY_WITH_CHANGES' } });
    expect(baselineTieAtCut(ranked, 1)).toBeNull();
    expect(baselineTieAtCut(ranked, 4)).toBeNull();
    expect(sameBaselineRank(ranked[1]!, ranked[2]!)).toBe(true);
    expect(sameBaselineRank(ranked[0]!, ranked[1]!)).toBe(false);
  });
});
