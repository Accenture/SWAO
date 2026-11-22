// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- live run diff tests (#3579)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, expect, it } from 'vitest';
import { LzLiveDiffSchema, parseLzLiveScan, type LzLiveScan, type LzLiveScanInput } from '@swao/core';
import { computeLzLiveDiff } from '../lz-live-diff.js';

const API = [{ source: 'api' as const, ref: '/v3/auth/catalog' }];
const POLICY = [{ source: 'policy' as const, ref: 'scp-deny-dms' }];
type St = 'enabled' | 'available_not_enabled' | 'restricted';
const at = (status: St, t: string) => ({ status, evidence: status === 'restricted' ? POLICY : API, observed_at: t });

const run = (t: string, regions: string[], services: Record<string, Record<string, St>>, resources: string[]): LzLiveScan => parseLzLiveScan({
  provider: 'otc', collection_mode: 'live', confidence: 'observed', scanned_at: t,
  provenance: { source: 'live:otc-test/platform' },
  meta: {
    lz_id: 'otc-test', provider: 'otc', scope_id: 'platform', scope_kind: 'platform',
    observed_at: t, driver_version: '0.1.0', read_only: 'verified', coverage: { readable: [], unreadable: [] },
  },
  offering: {
    regions: regions.map((id) => ({ id, status: 'enabled' as const })),
    services: Object.entries(services).map(([code, rs]) => ({
      code, name: code, regions: Object.fromEntries(Object.entries(rs).map(([r, s]) => [r, at(s, t)])),
    })),
  },
  estate: { resources: resources.map((id) => ({ id, type: 'x' })) },
} satisfies LzLiveScanInput);

const T1 = '2026-11-01T10:00:00Z';
const T2 = '2026-11-02T10:00:00Z';
const PREV = run(T1, ['eu-de', 'eu-nl'], { ecs: { 'eu-de': 'enabled', 'eu-nl': 'enabled' }, dms: { 'eu-de': 'enabled' }, rds: { 'eu-de': 'available_not_enabled' } }, ['r-1', 'r-2']);
const CUR = run(T2, ['eu-de', 'eu-ch2'], { ecs: { 'eu-de': 'enabled', 'eu-ch2': 'enabled' }, dms: { 'eu-de': 'restricted' }, rds: { 'eu-de': 'enabled' }, cce: { 'eu-de': 'enabled' } }, ['r-2', 'r-3']);

describe('computeLzLiveDiff on two fixture runs', () => {
  it('lists new and removed regions, services and resources, and status changes', () => {
    const diff = computeLzLiveDiff(CUR, PREV);
    expect(diff).toEqual({
      previous_run: T1,
      new: [{ kind: 'region', ref: 'eu-ch2' }, { kind: 'service', ref: 'cce' }, { kind: 'resource', ref: 'r-3' }],
      removed: [{ kind: 'region', ref: 'eu-nl' }, { kind: 'resource', ref: 'r-1' }],
      status_changes: [
        { service: 'dms', region: 'eu-de', from: 'enabled', to: 'restricted' },
        { service: 'rds', region: 'eu-de', from: 'available_not_enabled', to: 'enabled' },
      ],
    });
    expect(() => LzLiveDiffSchema.parse(diff)).not.toThrow();
  });

  it('a region newly listed for an existing service is not a status change', () => {
    expect(computeLzLiveDiff(CUR, PREV).status_changes.some((c) => c.region === 'eu-ch2')).toBe(false);
  });

  it('uses the given previous run id over the previous observed_at', () => {
    expect(computeLzLiveDiff(CUR, PREV, '2026-11-01T10-00-00Z').previous_run).toBe('2026-11-01T10-00-00Z');
  });

  it('a first run has empty lists and no previous_run', () => {
    expect(computeLzLiveDiff(CUR, undefined)).toEqual({ new: [], removed: [], status_changes: [] });
  });

  it('identical runs give an empty diff, independent of input order', () => {
    const reordered = { ...CUR, offering: { ...CUR.offering, services: [...CUR.offering.services].reverse() } };
    const d = computeLzLiveDiff(reordered, CUR);
    expect(d).toEqual({ previous_run: T2, new: [], removed: [], status_changes: [] });
  });
});
