// #3888 (Design 123 section 8.4): the rule engine of the Client LZ Policy
// Baseline controls in Application Assessments, per kind and source.
import { describe, it, expect } from 'vitest';
import { BaselineControlDecisionSchema, POLICY_KIND_CATEGORY, PolicyBaselineSchema, type LzBaselineResult, type LzRegion, type PolicyKind } from '@swao/core';
import { evaluateAppBaselineRules, type AppBaselineRulesInput } from '../app-baseline-rules.js';

const FW = 'CLIENT_LZ_POLICY_BASELINE';
const CAT: Record<string, string> = { data_residency: 'RES', service_control: 'SVC', encryption: 'ENC', network_exposure: 'NET', identity: 'IAM', logging: 'LOG', tagging: 'TAG', availability: 'AVL', resilience: 'BCK', cost: 'COST', portability: 'PRT' };
let n = 0;
function policy(kind: PolicyKind, params: Record<string, unknown> = {}, state = 'enabled'): Record<string, unknown> {
  n++;
  const id = `CPB-${CAT[POLICY_KIND_CATEGORY[kind]]}-${String(n).padStart(2, '0')}`;
  return { id, kind, category: POLICY_KIND_CATEGORY[kind], control: id, state, params, default_source: 'assumption' };
}
const baselineOf = (...policies: Record<string, unknown>[]) => PolicyBaselineSchema.parse({ schema_version: '0.1', framework: FW, baseline_of: FW, catalogue_version: '1.0.0', policies });
const region = (id: string, country: string, services: LzRegion['services'] = []): LzRegion => ({
  id, sovereignty: { residency_country: country, operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [], certifications: [] }, services,
});
const svc = (code: string, fulfills: string[], key_custody: string[], source?: 'curated'): LzRegion['services'][number] => ({ code, status: 'ga', capabilities: [], fulfills, key_custody, ...(source ? { source } : {}) } as LzRegion['services'][number]);
const one = (p: Record<string, unknown>, rest: Omit<AppBaselineRulesInput, 'baseline'>) => {
  const b = baselineOf(p);
  return evaluateAppBaselineRules({ baseline: b, ...rest }).get(p['control'] as string)!;
};
const DE = { provider: 'otc', region: 'eu-de', facts: region('eu-de', 'DE', [svc('rds', ['postgresql'], ['provider-managed', 'byok'], 'curated'), svc('obs', ['object_storage'], ['provider-managed'], 'curated')]) };
const US = { provider: 'aws', region: 'us-east-1', facts: region('us-east-1', 'US') };

describe('app baseline rules, catalogue source (#3888)', () => {
  it('region_residency: per target region; worst-of; no facts UNKNOWN; no target UNKNOWN', () => {
    const p = policy('region_residency', { allowed_countries: ['DE'] });
    expect(one(p, { source: 'catalogue', needs: [], targets: [DE] }).outcome).toBe('SATISFIED');
    const both = one(p, { source: 'catalogue', needs: [], targets: [DE, US] });
    expect(both.outcome).toBe('GAP');
    expect(both.rationale).toMatch(/otc\/eu-de allowed, aws\/us-east-1 not allowed/);
    expect(one(p, { source: 'catalogue', needs: [], targets: [{ provider: 'otc', region: 'xx' }] }).outcome).toBe('UNKNOWN');
    expect(one(p, { source: 'catalogue', needs: [], targets: [] }).outcome).toBe('UNKNOWN');
  });

  it('service_deny: a needed forbidden capability is GAP with the baseline evidence; none SATISFIED; needs not derived UNKNOWN', () => {
    const p = policy('service_deny', { capabilities: ['postgresql'] });
    const gap = one(p, { source: 'catalogue', needs: ['postgresql', 'object_storage'], targets: [DE] });
    expect(gap.outcome).toBe('GAP');
    expect(gap.rationale).toContain(`baseline:${p['id'] as string}`);
    expect(one(p, { source: 'catalogue', needs: ['object_storage'], targets: [DE] }).outcome).toBe('SATISFIED');
    expect(one(p, { source: 'catalogue', needs: undefined, targets: [DE] }).outcome).toBe('UNKNOWN');
  });

  it('service_allow_list: every need allow-listed SATISFIED, else GAP', () => {
    const p = policy('service_allow_list', { capabilities: ['object_storage', 'vm_compute'] });
    expect(one(p, { source: 'catalogue', needs: ['object_storage'], targets: [] }).outcome).toBe('SATISFIED');
    expect(one(p, { source: 'catalogue', needs: ['object_storage', 'postgresql'], targets: [] }).outcome).toBe('GAP');
  });

  it('encryption_at_rest: stateful needs against the custody the target offers: PARTIAL, GAP, UNKNOWN, N_A', () => {
    const p = policy('encryption_at_rest', { min_key_custody: 'byok', applies_to: ['postgresql', 'object_storage'] });
    expect(one(p, { source: 'catalogue', needs: ['postgresql'], targets: [DE] }).outcome).toBe('PARTIAL');
    expect(one(p, { source: 'catalogue', needs: ['object_storage'], targets: [DE] }).outcome).toBe('GAP');
    expect(one(p, { source: 'catalogue', needs: ['postgresql'], targets: [US] }).outcome).toBe('UNKNOWN');
    expect(one(p, { source: 'catalogue', needs: ['vm_compute'], targets: [DE] }).outcome).toBe('N_A');
  });

  it('estate-only kinds are UNKNOWN: the static catalogue has no tenant state', () => {
    for (const k of ['audit_trail', 'no_public_exposure', 'min_availability_zones', 'backup_configured', 'required_tags'] as const) {
      const d = one(policy(k, k === 'required_tags' ? { keys: ['owner'] } : {}), { source: 'catalogue', needs: [], targets: [DE] });
      expect(d.outcome, k).toBe('UNKNOWN');
      expect(d.rationale, k).toMatch(/static catalogue has no tenant state/);
    }
  });

  it('disabled is N_A and not_set is UNKNOWN (D-10), whatever the source', () => {
    expect(one(policy('service_deny', { capabilities: ['postgresql'] }, 'disabled'), { source: 'catalogue', needs: ['postgresql'], targets: [DE] }).outcome).toBe('N_A');
    expect(one(policy('service_deny', { capabilities: ['postgresql'] }, 'not_set'), { source: 'catalogue', needs: ['postgresql'], targets: [DE] }).outcome).toBe('UNKNOWN');
  });
});

const SHA = 'a'.repeat(64);
function result(scope: string, policies: { id: string; kind: PolicyKind; estate: 'pass' | 'fail' | 'warn' | 'na' | 'unverified' }[], sha = SHA): LzBaselineResult {
  return {
    schema: 'lz-baseline-result/1', lz_id: 'lz-a', scope_id: scope, provider: 'otc', framework: FW, baseline_of: FW, catalogue_version: '1.0.0', sha256: sha, overall: 'READY',
    policies: policies.map((p) => ({ id: p.id, kind: p.kind, category: POLICY_KIND_CATEGORY[p.kind], control: p.id, severity: 'warning', offering: 'READY', estate: p.estate, observability: 'observed', detail: 'x' })),
    not_reviewed: [], disabled: [],
  } as LzBaselineResult;
}

describe('app baseline rules, live source (#3888)', () => {
  it('estate status of the live baseline result: pass, fail, warn, na, unverified; worst-of over scopes; stale noted', () => {
    const p = policy('audit_trail');
    const id = p['id'] as string;
    const live = (estates: ('pass' | 'fail' | 'warn' | 'na' | 'unverified')[], stale = false) => ({ runId: 'r1', sha256: SHA, stale, results: estates.map((e, i) => result(`s${i}`, [{ id, kind: 'audit_trail', estate: e }])) });
    expect(one(p, { source: 'live', needs: [], live: live(['pass']) }).outcome).toBe('SATISFIED');
    expect(one(p, { source: 'live', needs: [], live: live(['fail']) }).outcome).toBe('GAP');
    expect(one(p, { source: 'live', needs: [], live: live(['warn']) }).outcome).toBe('PARTIAL');
    expect(one(p, { source: 'live', needs: [], live: live(['na']) }).outcome).toBe('N_A');
    expect(one(p, { source: 'live', needs: [], live: live(['unverified']) }).outcome).toBe('UNKNOWN');
    const mixed = one(p, { source: 'live', needs: [], live: live(['pass', 'fail'], true) });
    expect(mixed.outcome).toBe('GAP');
    expect(mixed.rationale).toMatch(/\(stale\)/);
  });

  it('another baseline version (sha256 differs) is not reused: UNKNOWN; no result for the policy: UNKNOWN', () => {
    const p = policy('audit_trail');
    expect(one(p, { source: 'live', needs: [], live: { runId: 'r1', sha256: SHA, stale: false, results: [result('s0', [{ id: p['id'] as string, kind: 'audit_trail', estate: 'pass' }], 'b'.repeat(64))] } }).rationale).toMatch(/another baseline version/);
    expect(one(p, { source: 'live', needs: [], live: { runId: 'r1', sha256: SHA, stale: false, results: [result('s0', [])] } }).outcome).toBe('UNKNOWN');
  });

  it('service_deny on the live source is decided by the app needs, as on the catalogue', () => {
    const p = policy('service_deny', { capabilities: ['postgresql'] });
    expect(one(p, { source: 'live', needs: ['postgresql'], live: { runId: 'r1', sha256: SHA, stale: false, results: [] } }).outcome).toBe('GAP');
  });
});

// #3981: per-target and per-scope contributions, ranked worst first; worst-of unchanged.
describe('app baseline rules, ranked contributions (#3981)', () => {
  const NL = { provider: 'otc', region: 'eu-nl', facts: region('eu-nl', 'NL') };
  it('catalogue residency: one contribution per target, ranked worst first, first equals the outcome', () => {
    const p = policy('region_residency', { allowed_countries: ['DE'] });
    const d = one(p, { source: 'catalogue', needs: [], targets: [DE, US, { provider: 'otc', region: 'xx' }] });
    expect(d.outcome).toBe('GAP');
    expect(d.contributions?.map((c) => [c.target, c.outcome])).toEqual([['aws/us-east-1', 'GAP'], ['otc/xx', 'UNKNOWN'], ['otc/eu-de', 'SATISFIED']]);
    expect(d.contributions?.[0]?.outcome).toBe(d.outcome);
    expect(d.contributions?.every((c) => c.scope_id === undefined && c.region !== undefined)).toBe(true);
  });

  it('catalogue encryption_at_rest: worst over the needed capabilities within each target', () => {
    const p = policy('encryption_at_rest', { min_key_custody: 'byok', applies_to: ['postgresql', 'object_storage'] });
    const d = one(p, { source: 'catalogue', needs: ['postgresql', 'object_storage'], targets: [DE, NL] });
    // DE: postgresql PARTIAL, object_storage GAP -> GAP; NL: no custody data -> UNKNOWN.
    expect(d.contributions?.map((c) => [c.target, c.outcome])).toEqual([['otc/eu-de', 'GAP'], ['otc/eu-nl', 'UNKNOWN']]);
    expect(d.outcome).toBe('GAP');
  });

  it('live: one contribution per scope with provider and masked detail, ranked worst first; ties keep the scope order', () => {
    const p = policy('audit_trail');
    const id = p['id'] as string;
    const results = (['pass', 'warn', 'unverified', 'warn'] as const).map((e, i) => result(`s${i}`, [{ id, kind: 'audit_trail', estate: e }]));
    results[1]!.policies[0]!.detail = 'trail arn:aws:cloudtrail:eu-central-1:123456789012:trail/x is off';
    const d = one(p, { source: 'live', needs: [], live: { runId: 'r1', sha256: SHA, stale: false, results } });
    expect(d.outcome).toBe('UNKNOWN');
    expect(d.contributions?.map((c) => [c.scope_id, c.outcome])).toEqual([['s2', 'UNKNOWN'], ['s1', 'PARTIAL'], ['s3', 'PARTIAL'], ['s0', 'SATISFIED']]);
    expect(d.contributions?.every((c) => c.provider === 'otc' && c.target === undefined)).toBe(true);
    const s1 = d.contributions?.find((c) => c.scope_id === 's1');
    expect(s1?.rationale).toContain('[id]');
    expect(s1?.rationale).not.toContain('123456789012');
  });

  it('app-level kinds and single-reason decisions carry no contributions', () => {
    expect(one(policy('service_deny', { capabilities: ['postgresql'] }), { source: 'catalogue', needs: ['postgresql'], targets: [DE, US] }).contributions).toBeUndefined();
    expect(one(policy('audit_trail'), { source: 'catalogue', needs: [], targets: [DE] }).contributions).toBeUndefined();
    expect(one(policy('region_residency', { allowed_countries: ['DE'] }), { source: 'catalogue', needs: [], targets: [] }).contributions).toBeUndefined();
  });

  it('every decision validates against BaselineControlDecisionSchema (strict, additive field)', () => {
    const p = policy('region_residency', { allowed_countries: ['DE'] });
    const d = one(p, { source: 'catalogue', needs: [], targets: [DE, US] });
    expect(BaselineControlDecisionSchema.safeParse(d).success).toBe(true);
    expect(BaselineControlDecisionSchema.safeParse({ ...d, contributions: [{ provider: 'otc', outcome: 'GAP', rationale: 'x' }] }).success).toBe(false);
  });
});
