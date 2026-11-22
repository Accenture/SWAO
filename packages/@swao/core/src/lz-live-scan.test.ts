// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library -- landing zone live scan (Design 120 section 7.3)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import {
  LzLiveScanSchema,
  LzLiveRegionStatusSchema,
  LzLiveSourceSchema,
  parseLzLiveScan,
  deriveLzScanBaseFields,
  projectLzLiveScan,
  lzLiveStatusesForRegion,
  LZ_LIVE_STATUSES,
  LZ_LIVE_STATUS_PRECEDENCE,
  type LzLiveScanInput,
  type LzLiveStatus,
  LzLiveCheckSchema,
  LzLivePostureSchema,
  LzLiveFactSourceSchema,
  LZ_LIVE_CHECK_STATUSES,
  LZ_LIVE_OBSERVABILITY,
  LZ_LIVE_POSTURE_BLOCKS,
  lzLivePostureEntryKey,
  type LzLivePostureInput,
  LzLiveHierarchySchema,
  LzLiveMergedHierarchySchema,
  LZ_LIVE_HIERARCHY_NODE_KINDS,
  lzLiveHierarchyProblems,
  lzLiveHierarchyRoots,
  type LzLiveHierarchyInput,
} from './lz-live-scan.js';
import { LzScanResultSchema } from './lz-scan-result.js';

const T = '2026-11-02T10:00:00Z';

/** A neutral platform-scope fixture: two regions, one enabled and one not
 *  offered for a service, a permission gap (unknown with 403), one resource. */
export function liveScanFixture(): LzLiveScanInput {
  return {
    provider: 'otc',
    collection_mode: 'live',
    confidence: 'observed',
    scanned_at: T,
    regions: ['eu-de'],
    enabled_services: [{ code: 'ecs', provisioned: true, fulfills: ['vm_compute'], count: 1, status: 'enabled' }],
    guardrails: [],
    quotas: [{ resource: 'instances', remaining: 18 }],
    provenance: { source: 'live:otc-test/platform' },
    meta: {
      lz_id: 'otc-test',
      provider: 'otc',
      scope_id: 'platform',
      scope_kind: 'platform',
      observed_at: T,
      driver_version: '0.1.0',
      read_only: 'refused',
      read_only_overrides: ['accept-write-capable-credentials'],
      coverage: { readable: ['ecs'], unreadable: ['cts'] },
      frameworks: [{ id: 'bsi-c5', version: '2020', sha256: 'a'.repeat(64) }],
      sources: [
        { name: 'ecs', status: 'ok' },
        { name: 'cts', status: 'not_collected', http_status: 403 },
      ],
    },
    offering: {
      regions: [
        { id: 'eu-de', country: 'DE', azs: [{ name: 'eu-de-01', available: true }], status: 'enabled' },
        { id: 'eu-nl', country: 'NL', status: 'available_not_enabled' },
      ],
      services: [
        {
          code: 'ecs', name: 'Elastic Cloud Server', capability_tags: ['vm_compute'],
          regions: {
            'eu-de': { status: 'enabled', evidence: [{ source: 'api', ref: '/v3/auth/catalog', http_status: 200 }], observed_at: T },
          },
          iac: { tool: ['terraform', 'opentofu'], provider: 'opentelekomcloud', level: 'full', resources: ['opentelekomcloud_compute_instance_v2'], source: 'curated' },
          frameworks: { 'bsi-c5': { light: 'green', controls: ['OPS-01'] } },
        },
        {
          code: 'apig', name: 'API Gateway', capability_tags: [],
          regions: {
            'eu-de': { status: 'enabled', evidence: [{ source: 'api', ref: '/v3/auth/catalog' }], observed_at: T },
            'eu-nl': { status: 'not_offered', evidence: [{ source: 'api', ref: '/v3/auth/catalog' }], observed_at: T },
          },
        },
        {
          code: 'cts', name: 'Cloud Trace Service', capability_tags: ['audit_logging'],
          regions: {
            'eu-de': { status: 'unknown', evidence: [{ source: 'api', ref: '/v3/traces', http_status: 403 }], observed_at: T },
          },
        },
      ],
    },
    estate: {
      resources: [{ id: 'res-1', type: 'ecs.instance', service_code: 'ecs', region: 'eu-de' }],
      quotas: [{ resource: 'instances', region: 'eu-de', limit: 20, used: 2, remaining: 18 }],
      activity_summary: { window_days: 7, events_total: 12, by_kind: { create: 2, update: 10 } },
      checks: [{ id: 'LZC-GEN-01', title: 'Resources are tagged', status: 'warn' }],
    },
  };
}

describe('LzLiveScanSchema (#3565, Design 120 section 7.3)', () => {
  it('parses a complete platform-scope fixture and fills defaults', () => {
    const scan = parseLzLiveScan(liveScanFixture());
    expect(scan.meta.scope_kind).toBe('platform');
    expect(scan.diff).toEqual({ new: [], removed: [], status_changes: [] });
    expect(scan.estate.workloads).toEqual([]);
    expect(scan.offering.services[1]!.frameworks).toEqual({});
  });

  it('validates the service iac block with the shared catalogue rules (LzServiceIacSchema, #3566)', () => {
    const withIac = (iac: unknown) => {
      const f = liveScanFixture() as { offering: { services: Array<Record<string, unknown>> } };
      f.offering.services[0]!.iac = iac;
      return LzLiveScanSchema.safeParse(f).success;
    };
    // level read must not list managed resources (shared superRefine rule)
    expect(withIac({ tool: ['terraform'], provider: 'opentelekomcloud', level: 'read', resources: ['opentelekomcloud_compute_instance_v2'], data_sources: ['opentelekomcloud_compute_instance_v2'], source: 'curated' })).toBe(false);
    // provider-schema provenance requires provider_version
    expect(withIac({ tool: ['terraform'], provider: 'opentelekomcloud', level: 'full', resources: ['opentelekomcloud_compute_instance_v2'], source: 'provider-schema' })).toBe(false);
    expect(withIac({ tool: ['terraform'], provider: 'opentelekomcloud', provider_version: '1.37.11', level: 'full', resources: ['opentelekomcloud_compute_instance_v2'], source: 'provider-schema' })).toBe(true);
    // level none needs no provider (shared rule; the former live-only schema required one)
    expect(withIac({ level: 'none', source: 'curated' })).toBe(true);
  });

  it('is fixed to collection_mode live and confidence observed', () => {
    expect(LzLiveScanSchema.safeParse({ ...liveScanFixture(), collection_mode: 'iac' }).success).toBe(false);
    expect(LzLiveScanSchema.safeParse({ ...liveScanFixture(), confidence: 'declared' }).success).toBe(false);
  });

  it('rejects unknown fields (strict) and an unknown live status', () => {
    expect(LzLiveScanSchema.safeParse({ ...liveScanFixture(), extra: 1 }).success).toBe(false);
    const f = liveScanFixture();
    (f.offering.regions![0] as { status: string }).status = 'available';
    expect(LzLiveScanSchema.safeParse(f).success).toBe(false);
  });

  it('rejects a malformed framework sha256 and an unknown read-only override', () => {
    const f = liveScanFixture();
    f.meta.frameworks = [{ id: 'bsi-c5', version: '2020', sha256: 'not-a-hash' }];
    expect(LzLiveScanSchema.safeParse(f).success).toBe(false);
    const g = liveScanFixture();
    (g.meta as { read_only_overrides: string[] }).read_only_overrides = ['accept-anything'];
    expect(LzLiveScanSchema.safeParse(g).success).toBe(false);
  });

  it('accepts the documented diff block', () => {
    const f = liveScanFixture();
    f.diff = {
      previous_run: '2026-11-01T10:00:00Z',
      new: [{ kind: 'resource', ref: 'res-1' }],
      removed: [],
      status_changes: [{ service: 'apig', region: 'eu-nl', from: 'enabled', to: 'not_offered' }],
    };
    expect(parseLzLiveScan(f).diff.status_changes).toHaveLength(1);
  });
});

describe('unknown is first-class, an empty success is not representable (Design 120 section 5.3)', () => {
  it('accepts unknown with evidence (the denied read)', () => {
    expect(LzLiveRegionStatusSchema.safeParse({
      status: 'unknown', evidence: [{ source: 'api', ref: '/v3/traces', http_status: 403 }], observed_at: T,
    }).success).toBe(true);
  });

  it('rejects unknown without evidence', () => {
    expect(LzLiveRegionStatusSchema.safeParse({ status: 'unknown', observed_at: T }).success).toBe(false);
  });

  it('rejects restricted without policy evidence: a denied read is unknown, not restricted', () => {
    expect(LzLiveRegionStatusSchema.safeParse({
      status: 'restricted', evidence: [{ source: 'api', ref: '/v3/traces', http_status: 403 }], observed_at: T,
    }).success).toBe(false);
    expect(LzLiveRegionStatusSchema.safeParse({
      status: 'restricted', evidence: [{ source: 'policy', ref: 'scp:deny-cts' }], observed_at: T,
    }).success).toBe(true);
  });

  it('rejects a not_collected source without http_status or reason', () => {
    expect(LzLiveSourceSchema.safeParse({ name: 'cts', status: 'not_collected' }).success).toBe(false);
    expect(LzLiveSourceSchema.safeParse({ name: 'cts', status: 'not_collected', reason: 'token expired' }).success).toBe(true);
    expect(LzLiveSourceSchema.safeParse({ name: 'cts', status: 'not_collected', http_status: 403 }).success).toBe(true);
  });

  it('rejects an HTTP status outside 100..599', () => {
    expect(LzLiveSourceSchema.safeParse({ name: 'cts', status: 'not_collected', http_status: 99 }).success).toBe(false);
  });
});

describe('projection onto LzScanResultSchema (Design 120 section 7.3)', () => {
  it('derives regions, enabled services, quotas, provenance from the live blocks', () => {
    const base = deriveLzScanBaseFields(parseLzLiveScan(liveScanFixture()));
    expect(base.regions).toEqual(['eu-de']);
    // apig is enabled in eu-de (no capability tags, so a mapping gap); cts is unknown, not enabled.
    expect(base.enabled_services.map((s) => s.code)).toEqual(['ecs', 'apig']);
    expect(base.enabled_services[0]).toMatchObject({ provisioned: true, count: 1, fulfills: ['vm_compute'] });
    expect(base.enabled_services[1]).toMatchObject({ provisioned: false, fulfills: [] });
    expect(base.quotas).toEqual([{ resource: 'instances', remaining: 18 }]);
    expect(base.provenance).toEqual({ source: 'live:otc-test/platform' });
  });

  it('keys an enabled service by its catalogue code when mapped', () => {
    const f = liveScanFixture();
    f.offering.services![0]!.catalogue_code = 'ecs-catalogue';
    const base = deriveLzScanBaseFields(parseLzLiveScan(f));
    expect(base.enabled_services[0]!.code).toBe('ecs-catalogue');
  });

  it('projects to a valid LzScanResult with live / observed and no live blocks', () => {
    const projected = projectLzLiveScan(parseLzLiveScan(liveScanFixture()));
    expect(LzScanResultSchema.safeParse(projected).success).toBe(true);
    expect(projected.collection_mode).toBe('live');
    expect(projected.confidence).toBe('observed');
    expect(projected).not.toHaveProperty('meta');
    expect(projected).not.toHaveProperty('offering');
  });

  it('carries lz_framework from meta when detected', () => {
    const f = liveScanFixture();
    f.meta.lz_framework = 'aws-control-tower';
    expect(projectLzLiveScan(parseLzLiveScan(f)).lz_framework).toBe('aws-control-tower');
  });
});

describe('lzLiveStatusesForRegion (#3609, Design 120 section 5.3)', () => {
  const T0 = '2026-11-02T10:00:00Z';
  const obs = (status: LzLiveStatus) => ({
    status,
    evidence: status === 'restricted'
      ? [{ source: 'policy' as const, ref: 'org-policy/deny' }]
      : [{ source: 'api' as const, ref: '/v3/auth/catalog' }],
    observed_at: T0,
  });
  const svc = (code: string, tags: string[], regions: Record<string, LzLiveStatus>) => ({
    code, name: code, capability_tags: tags, frameworks: {},
    regions: Object.fromEntries(Object.entries(regions).map(([r, s]) => [r, obs(s)])),
  });

  it('maps every capability tag of a service to its status in the region', () => {
    const m = lzLiveStatusesForRegion({ services: [svc('rds', ['postgres', 'mysql'], { 'eu-de': 'restricted' })] }, 'eu-de');
    expect(Object.fromEntries(m)).toEqual({ postgres: 'restricted', mysql: 'restricted' });
  });

  it('leaves capabilities out that have no observation in the region', () => {
    const m = lzLiveStatusesForRegion({ services: [svc('obs', ['object_storage'], { 'eu-nl': 'enabled' })] }, 'eu-de');
    expect(m.size).toBe(0);
  });

  it('ignores services without capability tags (mapping gap)', () => {
    const m = lzLiveStatusesForRegion({ services: [svc('apig', [], { 'eu-de': 'restricted' })] }, 'eu-de');
    expect(m.size).toBe(0);
  });

  it('resolves several services for one capability by precedence, independent of order', () => {
    const pairs: Array<[LzLiveStatus, LzLiveStatus, LzLiveStatus]> = [
      ['restricted', 'enabled', 'enabled'],
      ['unknown', 'available_not_enabled', 'available_not_enabled'],
      ['restricted', 'unknown', 'unknown'],
      ['not_offered', 'restricted', 'restricted'],
    ];
    for (const [a, b, want] of pairs) {
      for (const order of [[a, b], [b, a]] as const) {
        const m = lzLiveStatusesForRegion({
          services: [svc('s1', ['vm_compute'], { 'eu-de': order[0] }), svc('s2', ['vm_compute'], { 'eu-de': order[1] })],
        }, 'eu-de');
        expect(m.get('vm_compute')).toBe(want);
      }
    }
  });

  it('ranks the whole status vocabulary', () => {
    expect([...LZ_LIVE_STATUS_PRECEDENCE].sort()).toEqual([...LZ_LIVE_STATUSES].sort());
  });
});

describe('meta.simulated (#3596, Design 121 section 10)', () => {
  it('is optional: a scan without it parses unchanged', () => {
    const s = parseLzLiveScan(liveScanFixture());
    expect(s.meta.simulated).toBeUndefined();
  });

  it('accepts scenario, fidelity and the evidence list', () => {
    const f = liveScanFixture();
    f.meta.simulated = { scenario: 'minimal-roles', fidelity: 'conformed', evidence: ['header', 'token_claim'] };
    expect(parseLzLiveScan(f).meta.simulated).toEqual({ scenario: 'minimal-roles', fidelity: 'conformed', evidence: ['header', 'token_claim'] });
  });

  it('accepts evidence alone (endpoint override without a mock header)', () => {
    const f = liveScanFixture();
    f.meta.simulated = { evidence: ['endpoint_override'] };
    expect(LzLiveScanSchema.safeParse(f).success).toBe(true);
  });

  it('rejects an empty evidence list, an unknown fidelity and an unknown evidence kind', () => {
    for (const simulated of [
      { evidence: [] },
      { fidelity: 'invented', evidence: ['header'] },
      { evidence: ['guess'] },
    ]) {
      const f = liveScanFixture() as unknown as { meta: Record<string, unknown> };
      f.meta['simulated'] = simulated;
      expect(LzLiveScanSchema.safeParse(f).success).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// #3864: estate.posture, check status unverified, observability, meta.baseline
// (Design 123 sections 5.3, 9.1). Each block below is rejected by the strict
// schema before #3864, so every test here fails without the change.
// ---------------------------------------------------------------------------

const SRC = { calls: ['kms:DescribeKey'] };

/** One entry in every posture sub-block (neutral ids). */
function postureFixture(): LzLivePostureInput {
  return {
    encryption: { source: SRC, items: [
      { resource_id: 'vol-1', type: 'evs.volume', service_code: 'evs', region: 'eu-de', layer: 'at_rest', encrypted: true, key_custody: 'customer-managed', key_id: 'key-1' },
      { resource_id: 'lb-1', type: 'elb.listener', region: 'eu-de', layer: 'in_transit', min_tls_version: '1.2' },
    ] },
    exposure: { source: { calls: ['vpc:ListPublicIps'] }, items: [{ resource_id: 'eip-1', exposure: 'public_ip', public: true, bound_to: 'lb-1' }] },
    ingress_rules: { source: { calls: ['vpc:ListSecurityGroupRules'] }, items: [{ resource_id: 'sg-1', protocol: 'tcp', port_from: 22, port_to: 22, remote_cidr: '0.0.0.0/0' }] },
    identity: { source: { calls: ['iam:ListUsers'], partial: true }, mfa_required_for_privileged: false, privileged_principals: 3, privileged_without_mfa: 1, credentials: [{ kind: 'access_key', active: true, age_days: 400 }] },
    logging: { source: { calls: ['cts:ListTrackers'] }, trails: [{ region: 'eu-de', enabled: true, retention_days: 7 }] },
    backup: { source: { calls: ['backup:ListPolicies'], status: 'not_collected', http_status: 403 }, items: [] },
    budgets: { source: { calls: ['budgets:DescribeBudgets'] }, items: [{ resource_id: 'budget-1', scope: 'account-1', amount: 1000, currency: 'EUR', period: 'monthly', alerts: [{ threshold: 80, threshold_type: 'percentage', basis: 'forecasted', recipients: 2 }] }] },
  };
}

describe('estate.posture (#3864, Design 123 section 9.1)', () => {
  it('a scan with every posture sub-block parses; the old estate rejected the block', () => {
    const f = liveScanFixture();
    f.estate = { ...f.estate, posture: postureFixture() };
    const scan = parseLzLiveScan(f);
    expect(Object.keys(scan.estate.posture ?? {}).sort()).toEqual([...LZ_LIVE_POSTURE_BLOCKS].sort());
    expect(scan.estate.posture?.ingress_rules?.items[0]).toMatchObject({ action: 'allow', port_from: 22 });
    expect(scan.estate.posture?.encryption?.source).toEqual({ calls: ['kms:DescribeKey'], partial: false, status: 'ok' });
    expect(scan.estate.posture?.identity?.source.partial).toBe(true);
  });

  it('#3936: the budgets block keeps counts only; a recipient address or an unknown field is rejected (strict)', () => {
    const base = postureFixture().budgets!.items![0]!;
    expect(LzLivePostureSchema.parse({ budgets: { source: SRC, items: [base] } }).budgets?.items[0]).toMatchObject({ budget_kind: 'cost', alerts: [{ recipients: 2 }] });
    expect(LzLivePostureSchema.safeParse({ budgets: { source: SRC, items: [{ ...base, alerts: [{ threshold: 80, threshold_type: 'percentage', basis: 'actual', contactEmails: ['a@x.invalid'] }] }] } }).success).toBe(false);
    expect(LzLivePostureSchema.safeParse({ budgets: { source: SRC, items: [{ ...base, period: 'weekly' }] } }).success).toBe(false);
    expect(lzLivePostureEntryKey('budgets', base as never)).toBe('budget-1');
  });

  it('a scan without posture keeps its exact shape (additive): no posture, posture_changes or baseline key', () => {
    const scan = parseLzLiveScan(liveScanFixture());
    expect('posture' in scan.estate).toBe(false);
    expect('posture_changes' in scan.diff).toBe(false);
    expect('baseline' in scan.meta).toBe(false);
  });

  it('rejects unknown keys, names in identity, the wrong encryption layer fields and a reversed port range', () => {
    const bad: unknown[] = [
      { encryption: { source: SRC, items: [{ resource_id: 'v', layer: 'in_transit', key_custody: 'byok' }] } },
      { encryption: { source: SRC, items: [{ resource_id: 'v', layer: 'at_rest', min_tls_version: '1.2' }] } },
      { encryption: { source: SRC, items: [{ resource_id: 'v', layer: 'at_rest', key_custody: 'vendor' }] } },
      { ingress_rules: { source: SRC, items: [{ resource_id: 'sg', protocol: 'tcp', port_from: 23, port_to: 22 }] } },
      { identity: { source: SRC, users: ['someone'] } },
      { firewall: { source: SRC, items: [] } },
      { exposure: { items: [] } },
    ];
    for (const b of bad) expect(LzLivePostureSchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
  });

  it('a not_collected source needs http_status or reason; an empty call list is refused', () => {
    expect(LzLiveFactSourceSchema.safeParse({ calls: ['x'], status: 'not_collected' }).success).toBe(false);
    expect(LzLiveFactSourceSchema.safeParse({ calls: ['x'], status: 'not_collected', reason: 'read denied' }).success).toBe(true);
    expect(LzLiveFactSourceSchema.safeParse({ calls: [] }).success).toBe(false);
  });

  it('entry keys: resource plus layer, exposure kind or the whole rule', () => {
    expect(lzLivePostureEntryKey('encryption', { resource_id: 'v', layer: 'at_rest' })).toBe('v#at_rest');
    expect(lzLivePostureEntryKey('exposure', { resource_id: 'e', exposure: 'public_ip', public: true })).toBe('e#public_ip');
    expect(lzLivePostureEntryKey('ingress_rules', { resource_id: 'sg', protocol: 'tcp', port_from: 22, port_to: 22, remote_cidr: '0.0.0.0/0', action: 'allow' })).toBe('sg#tcp#22-22#0.0.0.0/0##allow');
    expect(lzLivePostureEntryKey('backup', { resource_id: 'b', protected: false })).toBe('b');
  });
});

describe('check status unverified and observability (#3864, Design 123 section 5.3)', () => {
  const check = (o: Record<string, unknown>) => LzLiveCheckSchema.safeParse({ id: 'CPB-ENC-01', title: 'Encryption at rest', ...o });

  it('pins the status and observability lists', () => {
    expect(LZ_LIVE_CHECK_STATUSES).toEqual(['pass', 'fail', 'warn', 'na', 'unverified']);
    expect(LZ_LIVE_OBSERVABILITY).toEqual(['observed', 'catalogue', 'not_collected', 'not_observable']);
  });

  it('unverified parses with a non-observed observability, also inside a scan', () => {
    for (const o of ['catalogue', 'not_collected', 'not_observable']) expect(check({ status: 'unverified', observability: o }).success, o).toBe(true);
    const f = liveScanFixture();
    f.estate = { ...f.estate, checks: [{ id: 'CPB-ENC-01', title: 't', status: 'unverified', observability: 'catalogue' }] };
    expect(parseLzLiveScan(f).estate.checks[0]).toMatchObject({ status: 'unverified', observability: 'catalogue' });
  });

  it('unverified without a reason, or with observed evidence, is refused', () => {
    expect(check({ status: 'unverified' }).success).toBe(false);
    expect(check({ status: 'unverified', observability: 'observed' }).success).toBe(false);
  });

  it('evidence that was not observed cannot decide pass, fail or warn; na stays allowed', () => {
    for (const st of ['pass', 'fail', 'warn']) expect(check({ status: st, observability: 'catalogue' }).success, st).toBe(false);
    expect(check({ status: 'na', observability: 'not_observable' }).success).toBe(true);
    expect(check({ status: 'pass', observability: 'observed' }).success).toBe(true);
    // catalogue checks without observability keep parsing
    expect(check({ status: 'fail' }).success).toBe(true);
  });
});

describe('meta.baseline (#3864, Design 123 section 9.1)', () => {
  it('parses framework, catalogue version and hash; a short hash or an extra key is refused', () => {
    const f = liveScanFixture();
    f.meta = { ...f.meta, baseline: { framework: 'CLIENT_LZ_POLICY_BASELINE', catalogue_version: '1.0.0', sha256: 'b'.repeat(64) } };
    expect(parseLzLiveScan(f).meta.baseline).toEqual({ framework: 'CLIENT_LZ_POLICY_BASELINE', catalogue_version: '1.0.0', sha256: 'b'.repeat(64) });
    f.meta = { ...f.meta, baseline: { framework: 'x', catalogue_version: '1', sha256: 'abc' } };
    expect(LzLiveScanSchema.safeParse(f).success).toBe(false);
    f.meta = { ...f.meta, baseline: { framework: 'x', catalogue_version: '1', sha256: 'b'.repeat(64), extra: 1 } as never };
    expect(LzLiveScanSchema.safeParse(f).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #3880: estate.hierarchy (Design 123 section 5.6). Rejected by the strict
// estate before #3880, so every test here fails without the change.
// ---------------------------------------------------------------------------

const TREE_SRC = { calls: ['organizations:ListRoots', 'organizations:ListAccountsForParent'] };
const LABEL = (c: string): string => `Node-${c.repeat(10)}`;

function treeFixture(): LzLiveHierarchyInput {
  return {
    source: TREE_SRC,
    scope_node: 'acct-1',
    nodes: [
      { id: 'org-1', kind: 'organisation', native_kind: 'aws:organization', label: LABEL('a') },
      { id: 'root-1', kind: 'root', native_kind: 'aws:root', parent: 'org-1', label: LABEL('b'), policy_refs: ['p-full'] },
      { id: 'ou-1', kind: 'organisational_unit', native_kind: 'aws:ou', parent: 'root-1', label: LABEL('c'), attributes: { 'status': 'ACTIVE' } },
      { id: 'acct-1', kind: 'account', native_kind: 'aws:account', parent: 'ou-1', label: LABEL('d') },
    ],
    resource_nodes: { 'res-1': 'acct-1' },
  };
}

describe('estate.hierarchy (#3880, Design 123 section 5.6)', () => {
  it('a scan with a four-level tree parses; defaults fill status and policy_refs', () => {
    const f = liveScanFixture();
    f.estate = { ...f.estate, hierarchy: treeFixture(), checks: [{ id: 'CPB-RES-01', title: 'Residency', status: 'pass', node_id: 'acct-1' }] };
    const scan = parseLzLiveScan(f);
    expect(scan.estate.hierarchy?.nodes.map((n) => n.status)).toEqual(['observed', 'observed', 'observed', 'observed']);
    expect(scan.estate.hierarchy?.nodes[0]?.policy_refs).toEqual([]);
    expect(lzLiveHierarchyRoots(scan.estate.hierarchy!.nodes)).toEqual(['org-1']);
    expect(scan.estate.checks[0]?.node_id).toBe('acct-1');
  });

  it('a scan without hierarchy keeps its exact shape', () => {
    const scan = parseLzLiveScan(liveScanFixture());
    expect('hierarchy' in scan.estate).toBe(false);
    expect('hierarchy_changes' in scan.diff).toBe(false);
  });

  it('tree rules: a missing parent, a duplicate id, a cycle and a self-parent are refused', () => {
    const base = treeFixture();
    const cases: [string, LzLiveHierarchyInput][] = [
      ['missing parent', { ...base, nodes: [...base.nodes!, { id: 'acct-2', kind: 'account', parent: 'ou-9' }] }],
      ['duplicate id', { ...base, nodes: [...base.nodes!, { id: 'ou-1', kind: 'organisational_unit', parent: 'root-1' }] }],
      ['cycle', { ...base, nodes: [{ id: 'a', kind: 'folder', parent: 'b' }, { id: 'b', kind: 'folder', parent: 'a' }], scope_node: undefined, resource_nodes: {} }],
      ['self parent', { ...base, nodes: [{ id: 'a', kind: 'folder', parent: 'a' }], scope_node: undefined, resource_nodes: {} }],
    ];
    for (const [name, h] of cases) expect(LzLiveHierarchySchema.safeParse(h).success, name).toBe(false);
    expect(lzLiveHierarchyProblems([{ id: 'a', parent: 'b' }, { id: 'b', parent: 'c' }, { id: 'c', parent: 'a' }])).toEqual(['cycle through node a']);
  });

  it('a forest is valid and every tree has one root', () => {
    const nodes = [{ id: 'r1' }, { id: 'a', parent: 'r1' }, { id: 'r2' }, { id: 'b', parent: 'r2' }];
    expect(lzLiveHierarchyProblems(nodes)).toEqual([]);
    expect(lzLiveHierarchyRoots(nodes)).toEqual(['r1', 'r2']);
  });

  it('labels must be pseudonyms: a native name is refused', () => {
    const h = treeFixture();
    h.nodes![0] = { ...h.nodes![0]!, label: 'Finance Department' };
    expect(LzLiveHierarchySchema.safeParse(h).success).toBe(false);
  });

  it('partial visibility: an unknown node carries id and kind only', () => {
    const app: LzLiveHierarchyInput = { source: { calls: ['organizations:DescribeAccount'], partial: true }, scope_node: 'acct-1', nodes: [
      { id: 'ou-1', kind: 'organisational_unit', status: 'unknown' },
      { id: 'acct-1', kind: 'account', parent: 'ou-1', label: LABEL('d') },
    ] };
    expect(LzLiveHierarchySchema.safeParse(app).success).toBe(true);
    for (const extra of [{ parent: 'x' }, { label: LABEL('e') }, { attributes: { a: 1 } }, { policy_refs: ['p'] }]) {
      const bad = { ...app, nodes: [{ id: 'x', kind: 'root' as const }, { ...app.nodes![0]!, ...extra }, app.nodes![1]!] };
      expect(LzLiveHierarchySchema.safeParse(bad).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it('scope_node, resource_nodes and check node_id must name nodes of the tree', () => {
    expect(LzLiveHierarchySchema.safeParse({ ...treeFixture(), scope_node: 'acct-9' }).success).toBe(false);
    expect(LzLiveHierarchySchema.safeParse({ ...treeFixture(), resource_nodes: { 'res-1': 'acct-9' } }).success).toBe(false);
    const f = liveScanFixture();
    f.estate = { ...f.estate, hierarchy: treeFixture(), checks: [{ id: 'C', title: 't', status: 'pass', node_id: 'acct-9' }] };
    expect(LzLiveScanSchema.safeParse(f).success).toBe(false);
    const g = liveScanFixture();
    g.estate = { ...g.estate, checks: [{ id: 'C', title: 't', status: 'pass', node_id: 'acct-1' }] };
    expect(LzLiveScanSchema.safeParse(g).success).toBe(false);
  });

  it('pins the node kinds and the merged schema rule for scope_nodes', () => {
    expect(LZ_LIVE_HIERARCHY_NODE_KINDS).toEqual(['organisation', 'root', 'folder', 'organisational_unit', 'management_group', 'account', 'subscription', 'project', 'resource_group', 'region']);
    expect(LzLiveMergedHierarchySchema.safeParse({ source: TREE_SRC, nodes: [{ id: 'a', kind: 'account' }], scope_nodes: { platform: 'b' } }).success).toBe(false);
    expect(LzLiveMergedHierarchySchema.safeParse({ source: TREE_SRC, nodes: [{ id: 'a', kind: 'account' }], scope_nodes: { platform: 'a' } }).success).toBe(true);
  });
});
