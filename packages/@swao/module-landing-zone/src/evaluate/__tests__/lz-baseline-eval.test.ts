// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- Client LZ Policy Baseline evaluator tests (#3871)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import {
  LzBaselineResultSchema,
  LzLiveScanSchema,
  PolicyBaselineSchema,
  loadPolicyBaseline,
  parseLzLiveScan,
  type LzLiveScan,
  type LzLiveScanInput,
  type LzRegion,
  type PolicyBaseline,
  type PolicyKind,
  POLICY_KINDS,
  POLICY_KIND_CATEGORY,
} from '@swao/core';
import {
  baselineCheckSeverity,
  baselineOverallVerdict,
  baselineServiceDenies,
  evaluateLzBaseline,
  keyCustodyRank,
  observabilityWithoutEvidence,
  readBaselineControls,
  type LzBaselineEvalInput,
} from '../lz-baseline-eval.js';
import { evaluateLzLiveScan, type LzLiveEvalFramework } from '../lz-live-eval.js';
import { computeLzFit, EU_MEMBER_STATES, residencyAllowed } from '../../fit/lz-fit.js';
import { sovereigntyRequirementProvenance } from '../../fit/orchestrate-lz.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHIPPED_DIR = join(__dirname, '..', '..', '..', '..', 'community-frameworks', 'frameworks', 'client-lz-policy-baseline');
const FW = 'CLIENT_LZ_POLICY_BASELINE';
const T = '2026-11-05T10:00:00Z';
const SHA = 'b'.repeat(64);
const API = [{ source: 'api' as const, ref: '/v3/auth/catalog' }];
const POLICY_EVIDENCE = [{ source: 'policy' as const, ref: 'scp-1' }];

type SvcInput = NonNullable<LzLiveScanInput['offering']['services']>[number];
type EstateInput = LzLiveScanInput['estate'];
type RegionInput = NonNullable<LzLiveScanInput['offering']['regions']>[number];

const svc = (code: string, tags: string[], status: 'enabled' | 'available_not_enabled' | 'restricted' | 'not_offered' | 'unknown' = 'enabled', region = 'eu-de'): SvcInput => ({
  code, name: code, capability_tags: tags,
  regions: { [region]: { status, evidence: status === 'restricted' ? POLICY_EVIDENCE : API, observed_at: T } },
});
const region = (id: string, azs = 3, status: RegionInput['status'] = 'enabled'): RegionInput => ({
  id, status, azs: Array.from({ length: azs }, (_, i) => ({ name: `${id}-${i + 1}`, available: true })),
});

function scanOf(opts: { provider?: string; regions?: RegionInput[]; services?: SvcInput[]; estate?: EstateInput } = {}): LzLiveScan {
  const provider = opts.provider ?? 'otc';
  return parseLzLiveScan({
    provider, collection_mode: 'live', confidence: 'observed', scanned_at: T,
    provenance: { source: 'live:lz-a/platform' },
    meta: { lz_id: 'lz-a', provider, scope_id: 'platform', scope_kind: 'platform', observed_at: T, driver_version: '0.1.0', read_only: 'verified', coverage: { readable: [], unreadable: [] } },
    offering: { regions: opts.regions ?? [region('eu-de')], services: opts.services ?? [svc('rds', ['postgresql']), svc('obs', ['object_storage'])] },
    estate: opts.estate ?? {},
  });
}

const sov = (residency_country: string, extra: Partial<NonNullable<LzRegion['sovereignty']>> = {}): LzRegion['sovereignty'] => ({
  residency_country, operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [], certifications: ['BSI_C5'], ...extra,
});
const facts = (id: string, s: LzRegion['sovereignty'], services: LzRegion['services'] = []): LzRegion => ({ id, sovereignty: s, services });
const REGIONS = new Map<string, LzRegion>([
  ['eu-de', facts('eu-de', sov('DE'), [
    { code: 'obs', status: 'ga', capabilities: [], fulfills: ['object_storage'], key_custody: ['provider-managed', 'byok'] },
    { code: 'sfs', status: 'ga', capabilities: [], fulfills: ['file_storage'], key_custody: ['provider-managed'], source: 'curated' },
    { code: 'mongo', status: 'ga', capabilities: [], fulfills: ['nosql_database'], key_custody: ['provider-managed'], source: 'pim-api-stackit' },
  ])],
  ['eu-nl', facts('eu-nl', sov('NL'))],
  ['eu-at', facts('eu-at', sov('AT'))],
  ['us-east', facts('us-east', sov('US', { operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act'], certifications: [] }))],
]);

const BASE = { schema_version: '0.1', framework: FW, baseline_of: FW, catalogue_version: '1.0.0' };
const CAT: Record<string, string> = { data_residency: 'RES', service_control: 'SVC', encryption: 'ENC', network_exposure: 'NET', identity: 'IAM', logging: 'LOG', tagging: 'TAG', availability: 'AVL', resilience: 'BCK', cost: 'COST', portability: 'PRT' };
function policy(kind: PolicyKind, params: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const id = `CPB-${CAT[POLICY_KIND_CATEGORY[kind]]}-01`;
  return { id, kind, category: POLICY_KIND_CATEGORY[kind], control: id, state: 'enabled', params, default_source: 'assumption', ...extra };
}
const baselineOf = (...policies: Record<string, unknown>[]): PolicyBaseline => PolicyBaselineSchema.parse({ ...BASE, policies });

function run(scan: LzLiveScan, baseline: PolicyBaseline, decls: LzBaselineEvalInput['sovereigntyDecls'] = []) {
  return evaluateLzBaseline(scan, { framework: FW, baseline, sha256: SHA, controls: new Map(), regions: REGIONS, sovereigntyDecls: decls });
}
const one = (scan: LzLiveScan, p: Record<string, unknown>, decls?: LzBaselineEvalInput['sovereigntyDecls']) => {
  const b = baselineOf(p);
  const baselineDecl = { id: FW, sovereignty_requirements: residencyDecl(b) };
  const out = run(scan, b, decls ?? [baselineDecl]);
  return { ...out.result.policies[0]!, check: out.checks[0]! };
};
function residencyDecl(b: PolicyBaseline) {
  const p = b.policies.find((x) => x.kind === 'region_residency');
  if (!p || p.kind !== 'region_residency') return undefined;
  return {
    ...(p.params.allowed_countries ? { require_residency_country: p.params.allowed_countries } : {}),
    ...(p.params.allowed_operator_jurisdictions ? { require_operator_jurisdiction: p.params.allowed_operator_jurisdictions } : {}),
    ...(p.params.forbid_exposure ? { forbid_exposure: p.params.forbid_exposure } : {}),
    ...(p.params.required_certifications ? { require_certifications: p.params.required_certifications } : {}),
  };
}
const res = (id: string, regionId: string | undefined, service_code?: string, tags?: Record<string, string>) => ({
  id, type: 'any', ...(service_code ? { service_code } : {}), ...(regionId ? { region: regionId } : {}), ...(tags ? { tags } : {}),
});

describe('EU residency matching (#3871)', () => {
  it('expands EU to the 27 member states and keeps exact matches', () => {
    expect(EU_MEMBER_STATES).toHaveLength(27);
    expect(residencyAllowed('AT', ['EU'])).toBe(true);
    expect(residencyAllowed('DE', ['DE'])).toBe(true);
    expect(residencyAllowed('AT', ['DE'])).toBe(false);
    expect(residencyAllowed('CH', ['EU'])).toBe(false);
    expect(residencyAllowed('EU', ['EU'])).toBe(true);
  });
});

describe('region_residency (#3871)', () => {
  const p = policy('region_residency', { allowed_countries: ['DE'] });
  it('pass: every region in use and offered is allowed', () => {
    const r = one(scanOf({ estate: { resources: [res('r1', 'eu-de')] } }), p);
    expect(r).toMatchObject({ offering: 'READY', estate: 'pass', observability: 'observed' });
  });
  it('fail: a resource in a non-DE region; offering READY_WITH_CHANGES when another region is allowed', () => {
    const r = one(scanOf({ regions: [region('eu-de'), region('eu-nl')], estate: { resources: [res('r1', 'eu-nl'), res('r2', 'eu-de')] } }), p);
    expect(r).toMatchObject({ offering: 'READY_WITH_CHANGES', estate: 'fail' });
    expect(r.detail).toContain('1 resource outside the allowed set');
    expect(r.detail).not.toContain('r1');
  });
  it('SOVEREIGNTY_BLOCKED when every offered region fails', () => {
    expect(one(scanOf({ regions: [region('eu-nl')] }), p).offering).toBe('SOVEREIGNTY_BLOCKED');
  });
  it('na without resources; unverified (catalogue) when a region in use has no facts', () => {
    expect(one(scanOf(), p)).toMatchObject({ estate: 'na', offering: 'READY' });
    const r = one(scanOf({ regions: [region('eu-de'), region('xx-1')], estate: { resources: [res('r1', 'xx-1')] } }), p);
    expect(r).toMatchObject({ estate: 'unverified', observability: 'catalogue', offering: 'READY_WITH_CHANGES' });
  });
  it('checks only the keys the policy sets (a countries policy is not failed on jurisdiction)', () => {
    const merged = [{ id: FW, sovereignty_requirements: { require_residency_country: ['DE'], require_operator_jurisdiction: ['NOT-THIS'] } }];
    expect(one(scanOf({ estate: { resources: [res('r1', 'eu-de')] } }), p, merged)).toMatchObject({ estate: 'pass', offering: 'READY' });
  });
  it('D-11 union: baseline DE plus a framework accepting EU passes an AT region, provenance names both', () => {
    const decls = [
      { id: FW, sovereignty_requirements: { require_residency_country: ['DE'] } },
      { id: 'EU_FRAMEWORK', sovereignty_requirements: { require_residency_country: ['EU', 'DE'] } },
    ];
    const b = baselineOf(p);
    const out = run(scanOf({ regions: [region('eu-at')], estate: { resources: [res('r1', 'eu-at')] } }), b, decls);
    expect(out.result.policies[0]).toMatchObject({ estate: 'pass', offering: 'READY' });
    expect(out.result.requirement_provenance).toEqual([
      { requirement: 'residency_country', value: 'DE', frameworks: [FW, 'EU_FRAMEWORK'] },
      { requirement: 'residency_country', value: 'EU', frameworks: ['EU_FRAMEWORK'] },
    ]);
    // without the wider framework the same region fails
    expect(run(scanOf({ regions: [region('eu-at')], estate: { resources: [res('r1', 'eu-at')] } }), b, [decls[0]!]).result.policies[0]!.estate).toBe('fail');
  });
  it('global resources (OTC IAM, region global) are not a region in use', () => {
    expect(one(scanOf({ estate: { resources: [res('u1', 'global'), res('r1', 'eu-de')] } }), p)).toMatchObject({ estate: 'pass' });
    expect(one(scanOf({ estate: { resources: [res('u1', 'global')] } }), p).estate).toBe('na');
  });
  it('jurisdiction and exposure policy against catalogue facts', () => {
    const q = policy('region_residency', { allowed_operator_jurisdictions: ['EU-entity'], forbid_exposure: ['us_cloud_act'] });
    expect(one(scanOf({ regions: [region('us-east')], estate: { resources: [res('r1', 'us-east')] } }), q)).toMatchObject({ offering: 'SOVEREIGNTY_BLOCKED', estate: 'fail' });
  });
});

describe('service_deny and service_allow_list (#3871)', () => {
  const deny = policy('service_deny', { capabilities: ['postgresql'] });
  it('pass and READY: forbidden service restricted, nothing deployed', () => {
    const r = one(scanOf({ services: [svc('rds', ['postgresql'], 'restricted'), svc('obs', ['object_storage'])], estate: { resources: [res('b1', 'eu-de', 'obs')] } }), deny);
    expect(r).toMatchObject({ offering: 'READY', estate: 'pass', observability: 'observed' });
  });
  it('fail: a resource of the forbidden capability is deployed; offering READY_WITH_CHANGES', () => {
    const r = one(scanOf({ estate: { resources: [res('db1', 'eu-de', 'rds')] } }), deny);
    expect(r).toMatchObject({ offering: 'READY_WITH_CHANGES', estate: 'fail' });
  });
  it('warn: enabled but not deployed', () => {
    expect(one(scanOf(), deny)).toMatchObject({ estate: 'warn', offering: 'READY_WITH_CHANGES' });
  });
  it('unverified (not_collected): a resource that does not join to a tagged service', () => {
    const r = one(scanOf({ services: [svc('rds', ['postgresql'], 'restricted')], estate: { resources: [res('x', 'eu-de', 'iaas')] } }), deny);
    expect(r).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
  });
  it('NEEDS_VERIFICATION when the forbidden service status is unknown or no services were collected', () => {
    expect(one(scanOf({ services: [svc('rds', ['postgresql'], 'unknown')] }), deny).offering).toBe('NEEDS_VERIFICATION');
    expect(one(scanOf({ services: [] }), deny)).toMatchObject({ offering: 'NEEDS_VERIFICATION', estate: 'unverified' });
  });
  const allow = policy('service_allow_list', { capabilities: ['object_storage'] });
  it('allow-list: pass, fail, na and unverified', () => {
    expect(one(scanOf({ services: [svc('obs', ['object_storage'])], estate: { resources: [res('b1', 'eu-de', 'obs')] } }), allow)).toMatchObject({ estate: 'pass', offering: 'READY' });
    expect(one(scanOf({ estate: { resources: [res('db1', 'eu-de', 'rds')] } }), allow)).toMatchObject({ estate: 'fail', offering: 'READY_WITH_CHANGES' });
    expect(one(scanOf({ services: [svc('obs', ['object_storage'])] }), allow)).toMatchObject({ estate: 'na', offering: 'READY' });
    expect(one(scanOf({ services: [svc('obs', ['object_storage'])], estate: { resources: [res('x', 'eu-de', 'iaas')] } }), allow)).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
  });
});

describe('service_deny and service_allow_list by resource type (#3931)', () => {
  const typed = (id: string, type: string, service_code?: string) => ({ id, type, region: 'eu01', ...(service_code ? { service_code } : {}) });
  const stackit = (resources: ReturnType<typeof typed>[], services: SvcInput[] = [svc('cloud.stackit.object-storage', ['object_storage'], 'enabled', 'eu01')]) =>
    scanOf({ provider: 'stackit', regions: [region('eu01')], services, estate: { resources } });
  it('a STACKIT iaas resource joins no offering service (service code iaas), but its type maps: decided, not unverified', () => {
    const deny = policy('service_deny', { capabilities: ['vm_compute'] });
    expect(one(stackit([typed('s1', 'iaas.server', 'iaas')]), deny)).toMatchObject({ estate: 'fail', observability: 'observed' });
    expect(one(stackit([typed('v1', 'iaas.volume', 'iaas')]), deny)).toMatchObject({ estate: 'pass', observability: 'observed' });
    const allow = policy('service_allow_list', { capabilities: ['object_storage', 'networking'] });
    expect(one(stackit([typed('sg', 'iaas.security-group', 'iaas')]), allow)).toMatchObject({ estate: 'pass' });
    expect(one(stackit([typed('s1', 'iaas.server', 'iaas')]), allow)).toMatchObject({ estate: 'fail' });
  });
  it('an unmapped type still falls back to the offering service by service code; with neither it stays unverified', () => {
    const deny = policy('service_deny', { capabilities: ['postgresql'] });
    // OTC rds.instances is not mapped (engine not in the type): the rds service tags decide, as before
    expect(one(scanOf({ estate: { resources: [{ id: 'db1', type: 'rds.instances', service_code: 'rds', region: 'eu-de' }] } }), deny)).toMatchObject({ estate: 'fail' });
    expect(one(stackit([typed('x', 'iaas.unknown-kind', 'iaas')], [svc('cloud.stackit.postgres-flex', ['postgresql'], 'restricted', 'eu01')]), deny)).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
  });
  it('the type map takes precedence over a broader service join (OTC EVS volume: block storage)', () => {
    const deny = policy('service_deny', { capabilities: ['vm_compute'] });
    const r = one(scanOf({ services: [svc('evs', ['vm_compute', 'block_storage'])], estate: { resources: [{ id: 'v1', type: 'evs.volumes', service_code: 'evs', region: 'eu-de' }] } }), deny);
    expect(r.estate).not.toBe('fail');
  });
});

describe('audit_trail (#3871)', () => {
  const p = policy('audit_trail', { all_regions: true });
  const audit = svc('cts', ['audit_logging']);
  it('pass: OTC system tracker enabled in every region (guardrails)', () => {
    const r = one(scanOf({ services: [audit], estate: { guardrails: [{ type: 'cts-tracker', id: 'eu-de/system', status: 'pass' }] } }), p);
    expect(r).toMatchObject({ estate: 'pass', offering: 'READY', observability: 'observed' });
  });
  it('fail: a region without an enabled tracker', () => {
    const r = one(scanOf({ regions: [region('eu-de'), region('eu-nl')], estate: { resources: [res('a', 'eu-de'), res('b', 'eu-nl')], guardrails: [{ type: 'cts-tracker', id: 'eu-de/system', status: 'pass' }, { type: 'cts-tracker', id: 'eu-nl', status: 'fail' }] } }), p);
    expect(r).toMatchObject({ estate: 'fail', offering: 'READY_WITH_CHANGES' });
  });
  it('AWS: a passing multi-region trail; posture.logging wins when present', () => {
    expect(one(scanOf({ provider: 'aws', estate: { guardrails: [{ type: 'cloudtrail-trail', id: 'arn:trail', status: 'pass' }] } }), p).estate).toBe('pass');
    const r = one(scanOf({ estate: { posture: { logging: { source: { calls: ['cts:ListTrackers'] }, trails: [{ enabled: false }] } } } }), p);
    expect(r.estate).toBe('fail');
  });
  it('unverified (not_collected) without guardrails or posture; STACKIT not_observable (#3955)', () => {
    expect(one(scanOf({ provider: 'otc' }), p)).toMatchObject({ estate: 'unverified', observability: 'not_collected', offering: 'NEEDS_VERIFICATION' });
    expect(one(scanOf({ provider: 'stackit' }), p)).toMatchObject({ estate: 'unverified', observability: 'not_observable', offering: 'NEEDS_VERIFICATION' });
  });
  it('#3955: a refused audit log read names its status and reason; STACKIT not_observable, OTC not_collected', () => {
    const refused = { logging: { source: { calls: ['/v2/projects/{project_id}'], status: 'not_collected' as const, http_status: 404, reason: 'Audit Log API v2 answers 404' }, trails: [] } };
    const s = one(scanOf({ provider: 'stackit', estate: { posture: refused } }), p);
    expect(s).toMatchObject({ estate: 'unverified', observability: 'not_observable' });
    expect(s.detail).toContain('audit log not read (HTTP 404; Audit Log API v2 answers 404)');
    expect(one(scanOf({ provider: 'otc', estate: { posture: refused } }), p)).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
  });
});

describe('min_availability_zones and required_tags (#3871)', () => {
  const azs = policy('min_availability_zones', { min: 2 });
  it('availability zones: pass, fail and BLOCKED, na, unverified for an empty zone list', () => {
    expect(one(scanOf({ estate: { resources: [res('a', 'eu-de')] } }), azs)).toMatchObject({ estate: 'pass', offering: 'READY' });
    expect(one(scanOf({ regions: [region('eu-de', 1)], estate: { resources: [res('a', 'eu-de')] } }), azs)).toMatchObject({ estate: 'fail', offering: 'BLOCKED' });
    expect(one(scanOf(), azs)).toMatchObject({ estate: 'na' });
    expect(one(scanOf({ regions: [region('eu-de', 0)], estate: { resources: [res('a', 'eu-de')] } }), azs)).toMatchObject({ estate: 'unverified', observability: 'not_collected', offering: 'NEEDS_VERIFICATION' });
  });
  const tags = policy('required_tags', { keys: ['owner', 'data-classification'] });
  it('tags: pass, fail without exposing values, na; an absent tag map is no tags; AWS is a partial source (D-15)', () => {
    expect(one(scanOf({ estate: { resources: [res('a', 'eu-de', 'obs', { owner: 'x', 'data-classification': 'internal' })] } }), tags)).toMatchObject({ estate: 'pass' });
    const f = one(scanOf({ estate: { resources: [res('a', 'eu-de', 'obs', { owner: 'secret-team' })] } }), tags);
    expect(f.estate).toBe('fail');
    expect(f.detail).not.toContain('secret-team');
    expect(one(scanOf(), tags).estate).toBe('na');
    expect(one(scanOf({ estate: { resources: [res('a', 'eu-de', 'obs')] } }), tags).estate).toBe('fail');
    const aws = one(scanOf({ provider: 'aws', estate: { resources: [res('a', 'eu-de', 'obs', { owner: 'x', 'data-classification': 'y' })] } }), tags);
    expect(aws).toMatchObject({ estate: 'unverified', observability: 'not_observable', offering: 'NEEDS_VERIFICATION' });
  });
  it('#3970: STACKIT buckets and MongoDB Flex instances have no labels in their API: not judged, never a fail on them', () => {
    const typed = (id: string, type: string, t?: Record<string, string>) => ({ ...res(id, 'eu01', undefined, t), type });
    const ok = { owner: 'x', 'data-classification': 'y' };
    const blind = one(scanOf({ provider: 'stackit', estate: { resources: [typed('b', 'object-storage.bucket'), typed('m', 'mongodb-flex.instance'), typed('v', 'iaas.volume', ok)] } }), tags);
    expect(blind).toMatchObject({ estate: 'unverified', observability: 'not_observable' });
    expect(blind.detail).toBe('every resource with readable labels (1) carries owner, data-classification; 2 resources of a type without labels in its API not judged');
    const fail = one(scanOf({ provider: 'stackit', estate: { resources: [typed('b', 'object-storage.bucket'), typed('s', 'iaas.server')] } }), tags);
    expect(fail).toMatchObject({ estate: 'fail', detail: '1 resource of 1 without every required tag key (owner, data-classification); 1 resource of a type without labels in its API not judged' });
    // the same type on another provider is judged as before
    expect(one(scanOf({ estate: { resources: [typed('b', 'object-storage.bucket')] } }), tags).estate).toBe('fail');
  });
  it('a resource-based check is never pass or na when the inventory was not collected', () => {
    const gapScan = (estate: EstateInput = {}) => {
      const sc = scanOf({ estate });
      return { ...sc, meta: { ...sc.meta, sources: [{ name: 'inventory:resources', status: 'not_collected' as const, http_status: 403 }] } };
    };
    for (const p of [tags, azs, policy('region_residency', { allowed_countries: ['DE'] }), policy('service_deny', { capabilities: ['postgresql'] }), policy('service_allow_list', { capabilities: ['object_storage'] })]) {
      const r = one(gapScan(), p);
      expect(r, String(p['kind'])).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
      expect(r.detail).toContain('HTTP 403');
    }
  });
});

describe('encryption_at_rest offering via key_custody (#3871)', () => {
  it('READY_WITH_CHANGES when the catalogue offers the custody; estate unverified with catalogue', () => {
    const r = one(scanOf(), policy('encryption_at_rest', { min_key_custody: 'customer-managed', applies_to: ['object_storage'] }));
    expect(r).toMatchObject({ offering: 'READY_WITH_CHANGES', estate: 'unverified', observability: 'catalogue' });
  });
  it('BLOCKED when no service of the tag offers it; NEEDS_VERIFICATION without custody data; READY when nothing applies', () => {
    const hy = one(scanOf(), policy('encryption_at_rest', { min_key_custody: 'hyok', applies_to: ['object_storage'] }));
    expect(hy.offering).toBe('BLOCKED');
    expect(hy.detail).toContain('1 without (object_storage)');
    expect(one(scanOf(), policy('encryption_at_rest', { min_key_custody: 'byok', applies_to: ['postgresql'] })).offering).toBe('NEEDS_VERIFICATION');
    expect(one(scanOf(), policy('encryption_at_rest', { min_key_custody: 'byok', applies_to: ['dns'] })).offering).toBe('READY');
  });
  it('a curated provider-managed-only entry blocks; a generated one is no custody data (fetcher default)', () => {
    const scan = scanOf({ services: [svc('sfs', ['file_storage']), svc('mongo', ['nosql_database'])] });
    expect(one(scan, policy('encryption_at_rest', { min_key_custody: 'customer-managed', applies_to: ['file_storage'] })).offering).toBe('BLOCKED');
    const gen = one(scan, policy('encryption_at_rest', { min_key_custody: 'customer-managed', applies_to: ['nosql_database'] }));
    expect(gen.offering).toBe('NEEDS_VERIFICATION');
    expect(gen.detail).toContain('without custody data (nosql_database)');
  });
  it('maps the catalogue custody strings; an unmapped value is unknown', () => {
    expect(keyCustodyRank('provider-managed')).toBe(0);
    expect(keyCustodyRank('cmk')).toBe(1);
    expect(keyCustodyRank('byok')).toBe(2);
    expect(keyCustodyRank('hyok')).toBe(3);
    expect(keyCustodyRank('operator-managed')).toBeNull();
  });
});

describe('budget_alerts from estate.posture.budgets (#3936)', () => {
  const p = policy('budget_alerts', { required: true });
  const src = { calls: ['budgets:DescribeBudgets'] };
  type Budget = NonNullable<NonNullable<NonNullable<EstateInput['posture']>['budgets']>['items']>[number];
  const budget = (alerts: Budget['alerts']): Budget => ({ resource_id: 'arn:aws:budgets::000000000001:budget/b', amount: 100, currency: 'USD', period: 'monthly', alerts });
  const withBudgets = (items: Budget[], source: Record<string, unknown> = src) => scanOf({ provider: 'aws', estate: { posture: { budgets: { source: source as never, items } } } });
  it('pass: a budget alert with a recipient', () => {
    expect(one(withBudgets([budget([{ threshold: 80, threshold_type: 'percentage', basis: 'actual', recipients: 1 }])]), p)).toMatchObject({ estate: 'pass', observability: 'observed', offering: 'READY' });
  });
  it('fail: no budget, or alerts without a recipient or disabled', () => {
    expect(one(withBudgets([]), p)).toMatchObject({ estate: 'fail', observability: 'observed', offering: 'READY_WITH_CHANGES' });
    expect(one(withBudgets([budget([]), budget([{ threshold: 80, threshold_type: 'percentage', basis: 'actual', recipients: 0 }, { threshold: 90, threshold_type: 'percentage', basis: 'forecasted', recipients: 2, enabled: false }])]), p).estate).toBe('fail');
  });
  it('unverified: recipients not read, a partial read without an alerting budget, a denied read, no block', () => {
    expect(one(withBudgets([budget([{ threshold: 80, threshold_type: 'percentage', basis: 'actual' }])]), p)).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
    expect(one(withBudgets([], { calls: ['budgets:DescribeBudgets'], partial: true }), p).estate).toBe('unverified');
    expect(one(withBudgets([], { calls: ['budgets:DescribeBudgets'], status: 'not_collected', http_status: 400 }), p)).toMatchObject({ estate: 'unverified', observability: 'not_collected', detail: expect.stringContaining('HTTP 400') });
    expect(one(scanOf({ provider: 'aws' }), p)).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
  });
  it('required: false is informational (na)', () => {
    expect(one(withBudgets([]), policy('budget_alerts', { required: false }))).toMatchObject({ estate: 'na', offering: 'READY' });
  });
});

describe('kinds without evidence today (#3871)', () => {
  const later: PolicyKind[] = ['encryption_in_transit', 'no_public_exposure', 'no_open_admin_ingress', 'privileged_mfa', 'credential_age', 'log_retention', 'backup_configured', 'budget_alerts', 'documented_exit'];
  it('are unverified with the section 5.4 observability per CSP, offering NEEDS_VERIFICATION', () => {
    for (const kind of later) {
      const r = one(scanOf(), policy(kind));
      expect(r, kind).toMatchObject({ estate: 'unverified', offering: 'NEEDS_VERIFICATION', observability: observabilityWithoutEvidence('otc', kind) });
    }
    expect(observabilityWithoutEvidence('otc', 'documented_exit')).toBe('not_observable');
    expect(observabilityWithoutEvidence('aws', 'budget_alerts')).toBe('not_collected');
    expect(observabilityWithoutEvidence('otc', 'budget_alerts')).toBe('not_observable');
    expect(observabilityWithoutEvidence('stackit', 'privileged_mfa')).toBe('not_observable');
    expect(observabilityWithoutEvidence('stackit', 'audit_trail')).toBe('not_observable');
    expect(observabilityWithoutEvidence('stackit', 'log_retention')).toBe('not_observable');
    expect(observabilityWithoutEvidence('otc', 'log_retention')).toBe('not_collected');
    expect(observabilityWithoutEvidence('azure', 'credential_age')).toBe('not_observable');
    expect(observabilityWithoutEvidence('aws', 'credential_age')).toBe('not_collected');
  });
  it('every kind of the closed set is handled', () => {
    for (const kind of POLICY_KINDS) expect(() => one(scanOf(), policy(kind, kind === 'region_residency' ? { allowed_countries: ['DE'] } : {}))).not.toThrow();
  });
});

describe('states, verdict order, severity (#3871)', () => {
  it('not_set is never evaluated, even when its evidence would fail; disabled is listed', () => {
    const b = baselineOf(
      policy('service_deny', { capabilities: ['postgresql'] }, { state: 'not_set' }),
      policy('required_tags', { keys: ['owner'] }, { state: 'disabled' }),
    );
    const out = run(scanOf({ estate: { resources: [res('db1', 'eu-de', 'rds')] } }), b);
    expect(out.checks).toEqual([]);
    expect(out.result.policies).toEqual([]);
    // #3874: the default's source travels with the not_set entry so the publication shows every assumption.
    expect(out.result.not_reviewed).toEqual([{ id: 'CPB-SVC-01', kind: 'service_deny', params: { capabilities: ['postgresql'] }, default_source: 'assumption' }]);
    expect(out.result.disabled).toEqual(['CPB-TAG-01']);
    expect(out.result.overall).toBe('READY');
  });
  it('overall: sovereignty first, then blocked, then needs verification over ready', () => {
    expect(baselineOverallVerdict([])).toBe('READY');
    expect(baselineOverallVerdict(['READY', 'READY_WITH_CHANGES'])).toBe('READY_WITH_CHANGES');
    expect(baselineOverallVerdict(['READY_WITH_CHANGES', 'NEEDS_VERIFICATION'])).toBe('NEEDS_VERIFICATION');
    expect(baselineOverallVerdict(['NEEDS_VERIFICATION', 'BLOCKED'])).toBe('BLOCKED');
    expect(baselineOverallVerdict(['BLOCKED', 'SOVEREIGNTY_BLOCKED', 'READY'])).toBe('SOVEREIGNTY_BLOCKED');
  });
  it('control severity: critical and high blocker, medium warning, low and informational info, absent warning', () => {
    expect(['critical', 'high', 'medium', 'low', 'informational', undefined].map((s) => baselineCheckSeverity(s as never))).toEqual(['blocker', 'blocker', 'warning', 'info', 'info', 'warning']);
  });
});

describe('shipped baseline end to end against one scope (#3871)', () => {
  const loaded = loadPolicyBaseline(SHIPPED_DIR, FW);
  const baseline = loaded.baseline!;
  const controls = readBaselineControls(SHIPPED_DIR);
  const scan = scanOf({
    services: [svc('rds', ['postgresql']), svc('obs', ['object_storage']), svc('cts', ['audit_logging'])],
    estate: { resources: [res('db1', 'eu-de', 'rds', { owner: 'a', 'data-classification': 'b' })], guardrails: [{ type: 'cts-tracker', id: 'eu-de/system', status: 'pass' }] },
  });
  const decl = { id: FW, sovereignty_requirements: { require_residency_country: ['DE'], require_operator_jurisdiction: ['EU-entity'], forbid_exposure: ['us_cloud_act', 'fisa_702'], require_certifications: ['BSI_C5'] } };

  it('evaluates the 17 enabled policies, lists the 3 disabled, and the result and scan parse', () => {
    expect(loaded.status).toBe('ok');
    const out = evaluateLzBaseline(scan, { framework: FW, baseline, sha256: SHA, controls, regions: REGIONS, sovereigntyDecls: [decl] });
    expect(out.result.policies).toHaveLength(17);
    expect(out.result.disabled).toEqual(['CPB-SVC-01', 'CPB-SVC-02', 'CPB-SVC-03']);
    expect(LzBaselineResultSchema.parse(out.result).overall).toBe('NEEDS_VERIFICATION');
    expect(out.checks.find((c) => c.id === 'CPB-RES-01')).toMatchObject({ status: 'pass', title: 'Data stays in the allowed countries', controls: ['CPB-RES-01'] });
    expect(out.definitions.find((d) => d.id === 'CPB-NET-02')).toMatchObject({ severity: 'blocker', framework: FW });
    const merged = { ...scan, meta: { ...scan.meta, baseline: { framework: FW, catalogue_version: '1.0.0', sha256: SHA } }, estate: { ...scan.estate, checks: out.checks } };
    expect(() => LzLiveScanSchema.parse(merged)).not.toThrow();
  });

  it('lights: a failing CPB-SVC-03 turns PostgreSQL red in the baseline column only; no unknown checks', () => {
    const enabledDeny = PolicyBaselineSchema.parse({ ...baseline, policies: baseline.policies.map((p) => (p.id === 'CPB-SVC-03' ? { ...p, state: 'enabled' } : p)) });
    const out = evaluateLzBaseline(scan, { framework: FW, baseline: enabledDeny, sha256: SHA, controls, regions: REGIONS, sovereigntyDecls: [decl] });
    expect(out.checks.find((c) => c.id === 'CPB-SVC-03')?.status).toBe('fail');
    const iac = { level: 'full' as const, tool: ['terraform' as const], provider: 'p', resources: ['r'], data_sources: [], source: 'curated' as const };
    const withIac = { ...scan, offering: { ...scan.offering, services: scan.offering.services.map((s) => ({ ...s, iac })) }, estate: { ...scan.estate, checks: out.checks } };
    const baselineFw: LzLiveEvalFramework = {
      id: FW, version: '1.0.0', sha256: SHA, sovereignty_requirements: decl.sovereignty_requirements,
      mapping: { schema_version: '0.1', framework: FW, mappings: [{ capability: 'postgresql', controls: ['CPB-SVC-03'], relevance: 'configure', confidence: 'curated' }] },
    };
    const otherFw: LzLiveEvalFramework = {
      id: 'BSI_C5', version: '2020', sha256: SHA,
      mapping: { schema_version: '0.1', framework: 'BSI_C5', mappings: [{ capability: 'postgresql', controls: ['BSI_C5_CRY-02'], relevance: 'configure', confidence: 'curated' }] },
    };
    const lit = evaluateLzLiveScan(withIac, { frameworks: [baselineFw, otherFw], regions: REGIONS, checks: out.definitions });
    expect(lit.unknown_checks).toEqual([]);
    const pg = lit.scan.offering.services.find((s) => s.code === 'rds')!;
    expect(pg.frameworks[FW]?.light).toBe('red');
    expect(pg.frameworks[FW]?.detail).toContain('CPB-SVC-03');
    expect(pg.frameworks['BSI_C5']?.light).not.toBe('red');
    expect(lit.scope_findings.every((f) => f.framework === FW)).toBe(true);
  });
});

describe('app fit BLOCKED_BY_POLICY (D-12, #3871)', () => {
  it('a needed capability an enabled service_deny forbids is BLOCKED_BY_POLICY with evidence baseline:<id>', () => {
    const b = baselineOf(policy('service_deny', { capabilities: ['postgresql'] }));
    const denies = baselineServiceDenies(b);
    expect([...denies]).toEqual([['postgresql', 'CPB-SVC-01']]);
    const region = facts('eu-de', sov('DE'), [{ code: 'rds', status: 'ga', capabilities: [], fulfills: ['postgresql', 'object_storage'], key_custody: [] }]);
    const fit = computeLzFit({
      requiredServices: [{ code: 'postgresql@16', evidence: ['pom.xml'] }, { code: 'object_storage' }],
      region, scan: { provider: 'otc', collection_mode: 'export', confidence: 'declared', scanned_at: T, regions: ['eu-de'], enabled_services: [], guardrails: [], quotas: [], provenance: { source: 'catalogue' } },
      catalogueMode: true, baselineDenies: denies,
    });
    expect(fit.items[0]).toMatchObject({ verdict: 'BLOCKED_BY_POLICY', evidence: ['pom.xml', 'baseline:CPB-SVC-01'] });
    expect(fit.items[1]?.verdict).toBe('SUPPORTED');
    expect(fit.overall).toBe('BLOCKED');
    expect(baselineServiceDenies(baselineOf(policy('service_deny', { capabilities: ['postgresql'] }, { state: 'disabled' }))).size).toBe(0);
  });
});

describe('requirement provenance (#3871)', () => {
  it('lists every merged value with its frameworks in declaration order', () => {
    expect(sovereigntyRequirementProvenance([
      { id: 'A', sovereignty_requirements: { forbid_exposure: ['us_cloud_act'], require_certifications: ['BSI_C5'] } },
      { id: 'B', sovereignty_requirements: { forbid_exposure: ['us_cloud_act', 'fisa_702'] } },
      { id: 'C' },
    ])).toEqual([
      { requirement: 'forbid_exposure', value: 'us_cloud_act', frameworks: ['A', 'B'] },
      { requirement: 'forbid_exposure', value: 'fisa_702', frameworks: ['B'] },
      { requirement: 'certification', value: 'BSI_C5', frameworks: ['A'] },
    ]);
  });
});
