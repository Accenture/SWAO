// #3583: scope merge within one landing zone (Design 120 section 11.1).
// Synthetic LzLiveScan fixtures only; no recording or tenant identifier.
import { describe, it, expect } from 'vitest';
import { deriveLzScanBaseFields, LZ_LIVE_SCOPE_MERGE_PRECEDENCE, LZ_LIVE_STALENESS_DAYS, LzLiveMergedSchema, parseLzLiveScan } from '@swao/core';
import type { LzLiveScan } from '@swao/core';
import { mergeLzLiveScopes } from '../merge.js';

type Status = LzLiveScan['offering']['services'][number]['regions'][string]['status'];
const NOW = new Date('2026-11-03T12:00:00Z');

function scan(o: {
  scopeId: string;
  kind?: 'platform' | 'application';
  observedAt?: string;
  lzId?: string;
  regions?: { id: string; status?: 'enabled' | 'not_offered'; azs?: string[] }[];
  services?: { code: string; tags?: string[]; regions: Record<string, Status> }[];
  resources?: { id: string; type?: string }[];
  guardrails?: { type: string; id: string; status: 'pass' | 'fail' | 'unknown' }[];
}): LzLiveScan {
  const observed = o.observedAt ?? '2026-11-03T08:00:00Z';
  const meta = {
    lz_id: o.lzId ?? 'otc-test', provider: 'otc', scope_id: o.scopeId, scope_kind: o.kind ?? 'platform',
    observed_at: observed, driver_version: '0.1.0', read_only: 'verified' as const, read_only_overrides: [],
    coverage: { readable: [], unreadable: [] }, frameworks: [], sources: [],
  };
  const offering = {
    regions: (o.regions ?? [{ id: 'eu-de' }]).map((r) => ({ id: r.id, azs: (r.azs ?? []).map((n) => ({ name: n, available: true })), status: r.status ?? 'enabled' as const })),
    services: (o.services ?? []).map((s) => ({
      code: s.code, name: s.code, capability_tags: s.tags ?? [],
      regions: Object.fromEntries(Object.entries(s.regions).map(([id, status]) => [id, {
        status,
        evidence: status === 'restricted' ? [{ source: 'policy' as const, ref: 'deny' }] : [{ source: 'api' as const, ref: `${o.scopeId}:${s.code}` }],
        observed_at: observed,
      }])),
      frameworks: {},
    })),
  };
  const estate = {
    resources: (o.resources ?? []).map((r) => ({ id: r.id, type: r.type ?? 'vm' })),
    workloads: [], guardrails: o.guardrails ?? [], quotas: [], checks: [],
  };
  return parseLzLiveScan({ ...deriveLzScanBaseFields({ meta, offering, estate }), collection_mode: 'live', confidence: 'observed', meta, offering, estate });
}

const merge = (scans: LzLiveScan[], extra: Partial<Parameters<typeof mergeLzLiveScopes>[0]> = {}) =>
  mergeLzLiveScopes({ lzId: 'otc-test', provider: 'otc', scans, now: NOW, ...extra });

describe('mergeLzLiveScopes (#3583, Design 120 section 11.1)', () => {
  it('pins the precedence order and the default staleness window', () => {
    expect(LZ_LIVE_SCOPE_MERGE_PRECEDENCE).toEqual(['restricted', 'enabled', 'available_not_enabled', 'not_offered', 'unknown']);
    expect(LZ_LIVE_STALENESS_DAYS).toBe(7);
  });

  it('restricted > enabled > available_not_enabled > not_offered > unknown, per service and region', () => {
    const pairs: [Status, Status, Status][] = [
      ['restricted', 'enabled', 'restricted'],
      ['enabled', 'available_not_enabled', 'enabled'],
      ['available_not_enabled', 'not_offered', 'available_not_enabled'],
      ['not_offered', 'unknown', 'not_offered'],
    ];
    for (const [a, b, want] of pairs) {
      for (const [x, y] of [[a, b], [b, a]] as const) {
        const m = merge([
          scan({ scopeId: 'platform', services: [{ code: 'ecs', regions: { 'eu-de': x } }] }),
          scan({ scopeId: 'app-a', kind: 'application', services: [{ code: 'ecs', regions: { 'eu-de': y } }] }),
        ]);
        expect(m.offering.services[0]!.regions['eu-de']!.status, `${x} vs ${y}`).toBe(want);
      }
    }
  });

  it('unknown from one scope never overrides an observed status from another; the winning scope is named', () => {
    const m = merge([
      scan({ scopeId: 'platform', services: [{ code: 'rds', regions: { 'eu-de': 'unknown', 'eu-nl': 'unknown' } }] }),
      scan({ scopeId: 'app-a', kind: 'application', services: [{ code: 'rds', regions: { 'eu-de': 'not_offered' } }] }),
    ]);
    const rds = m.offering.services[0]!;
    expect(rds.regions['eu-de']).toMatchObject({ status: 'not_offered', scope_id: 'app-a', evidence: [{ source: 'api', ref: 'app-a:rds' }] });
    // Only one scope saw eu-nl: its unknown stays.
    expect(rds.regions['eu-nl']).toMatchObject({ status: 'unknown', scope_id: 'platform' });
  });

  it('unions regions, services and capability tags', () => {
    const m = merge([
      scan({ scopeId: 'platform', regions: [{ id: 'eu-de', azs: ['eu-de-01'] }], services: [{ code: 'ecs', tags: ['vm_compute'], regions: { 'eu-de': 'enabled' } }] }),
      scan({ scopeId: 'app-a', kind: 'application', regions: [{ id: 'eu-de', azs: ['eu-de-02'] }, { id: 'eu-nl' }], services: [{ code: 'ecs', tags: ['gpu_compute'], regions: { 'eu-nl': 'enabled' } }, { code: 'obs', regions: { 'eu-nl': 'enabled' } }] }),
    ]);
    expect(m.offering.regions.map((r) => r.id)).toEqual(['eu-de', 'eu-nl']);
    expect(m.offering.regions[0]!.azs.map((a) => a.name)).toEqual(['eu-de-01', 'eu-de-02']);
    expect(m.offering.services.map((s) => s.code)).toEqual(['ecs', 'obs']);
    expect(m.offering.services[0]).toMatchObject({ capability_tags: ['vm_compute', 'gpu_compute'] });
    expect(Object.keys(m.offering.services[0]!.regions)).toEqual(['eu-de', 'eu-nl']);
  });

  it('deduplicates resources by provider resource id with seen_by per scope', () => {
    const m = merge([
      scan({ scopeId: 'platform', resources: [{ id: 'r-1' }, { id: 'r-2' }] }),
      scan({ scopeId: 'app-a', kind: 'application', resources: [{ id: 'r-2' }, { id: 'r-3' }] }),
      scan({ scopeId: 'app-b', kind: 'application', resources: [{ id: 'r-2' }] }),
    ]);
    expect(m.estate.resources.map((r) => [r.id, r.seen_by])).toEqual([
      ['r-1', ['platform']],
      ['r-2', ['platform', 'app-a', 'app-b']],
      ['r-3', ['app-a']],
    ]);
  });

  it('takes guardrails from the platform scope and adds application scope policy as local', () => {
    const m = merge([
      scan({ scopeId: 'app-a', kind: 'application', guardrails: [{ type: 'cts', id: 'app-trail', status: 'pass' }] }),
      scan({ scopeId: 'platform', guardrails: [{ type: 'cts', id: 'system', status: 'pass' }] }),
    ]);
    expect(m.estate.guardrails).toEqual([
      { type: 'cts', id: 'system', status: 'pass', scope_id: 'platform', origin: 'platform' },
      { type: 'cts', id: 'app-trail', status: 'pass', scope_id: 'app-a', origin: 'local' },
    ]);
  });

  it('uses the latest scan per scope only', () => {
    const m = merge([
      scan({ scopeId: 'platform', observedAt: '2026-11-01T08:00:00Z', services: [{ code: 'ecs', regions: { 'eu-de': 'restricted' } }] }),
      scan({ scopeId: 'platform', observedAt: '2026-11-03T08:00:00Z', services: [{ code: 'ecs', regions: { 'eu-de': 'enabled' } }] }),
    ]);
    expect(m.scopes).toEqual([{ scope_id: 'platform', scope_kind: 'platform', status: 'merged', observed_at: '2026-11-03T08:00:00Z', age_days: expect.any(Number) }]);
    expect(m.offering.services[0]!.regions['eu-de']!.status).toBe('enabled');
  });

  it('lists a stale scope and does not merge it; lists a registered scope without a scan as missing', () => {
    const m = merge([
      scan({ scopeId: 'platform', services: [{ code: 'ecs', regions: { 'eu-de': 'enabled' } }], resources: [{ id: 'r-1' }] }),
      scan({ scopeId: 'app-a', kind: 'application', observedAt: '2026-10-20T08:00:00Z', services: [{ code: 'ecs', regions: { 'eu-de': 'restricted' } }], resources: [{ id: 'r-9' }] }),
    ], { registeredScopes: [{ id: 'platform', kind: 'platform' }, { id: 'app-a', kind: 'application' }, { id: 'app-b', kind: 'application' }] });
    expect(m.scopes.map((s) => [s.scope_id, s.status])).toEqual([['platform', 'merged'], ['app-a', 'stale'], ['app-b', 'missing']]);
    expect(m.scopes[1]).toMatchObject({ observed_at: '2026-10-20T08:00:00Z', age_days: 14.16 });
    expect(m.scopes[2]).toEqual({ scope_id: 'app-b', scope_kind: 'application', status: 'missing' });
    // The stale scope's restricted status and resource are not merged.
    expect(m.offering.services[0]!.regions['eu-de']!.status).toBe('enabled');
    expect(m.estate.resources.map((r) => r.id)).toEqual(['r-1']);
  });

  it('honours a configured window and refuses an invalid one', () => {
    const old = scan({ scopeId: 'platform', observedAt: '2026-10-20T08:00:00Z' });
    expect(merge([old], { windowDays: 30 }).scopes[0]!.status).toBe('merged');
    expect(merge([old], { windowDays: 30 }).window_days).toBe(30);
    expect(() => merge([old], { windowDays: 0 })).toThrow(/staleness window/);
  });

  it('refuses a scan of another landing zone', () => {
    expect(() => merge([scan({ scopeId: 'platform', lzId: 'otc-other' })])).toThrow(/cannot be merged/);
  });

  it('the output passes LzLiveMergedSchema', () => {
    const m = merge([scan({ scopeId: 'platform', services: [{ code: 'ecs', regions: { 'eu-de': 'enabled' } }] })]);
    expect(LzLiveMergedSchema.safeParse(JSON.parse(JSON.stringify(m))).success).toBe(true);
    expect(m).toMatchObject({ lz_id: 'otc-test', provider: 'otc', merged_at: NOW.toISOString(), window_days: 7 });
  });
});
