// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3864: estate.posture through the scan assembler, the scope merge and the
// run diff; check status unverified in the portfolio rank; the tag-key
// privacy rule that `required_tags` relies on (Design 123 sections 5.3, 9.1, 12).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore, LZ_LIVE_CHECK_STATUSES, deriveLzScanBaseFields, parseLzLiveScan } from '@swao/core';
import type { LzLivePostureInput, LzLiveScan } from '@swao/core';
import { runLzLiveScan } from '../scan.js';
import { mergeLzLiveScopes } from '../merge.js';
import { mergeLzLivePosture, scrubPostureAttributes } from '../posture.js';
import { LZ_LIVE_CHECK_RANK } from '../portfolio.js';
import { formatLzDiff, lzPostureChangeCounts } from '../run-diff.js';
import { pseudonymiseTags } from '../privacy.js';
import { LiveSourceUnavailableError } from '../errors.js';
import { registerLiveLzDriver, unregisterLiveLzDriver } from '../registry.js';
import { computeLzLiveDiff, computeLzLivePostureChanges } from '../../evaluate/lz-live-diff.js';
import { VERIFIED, makeFakeDriver, makeTransport } from './fake-driver.js';

const NOW = new Date('2026-11-05T12:00:00Z');

function scan(o: { scopeId: string; kind?: 'platform' | 'application'; observedAt?: string; posture?: LzLivePostureInput }): LzLiveScan {
  const observed = o.observedAt ?? '2026-11-05T08:00:00Z';
  const meta = {
    lz_id: 'otc-test', provider: 'otc', scope_id: o.scopeId, scope_kind: o.kind ?? 'platform',
    observed_at: observed, driver_version: '0.1.0', read_only: 'verified' as const, read_only_overrides: [],
    coverage: { readable: [], unreadable: [] }, frameworks: [], sources: [],
  };
  const offering = { regions: [{ id: 'eu-de', azs: [], status: 'enabled' as const }], services: [] };
  const estate = { resources: [], workloads: [], guardrails: [], quotas: [], checks: [], ...(o.posture ? { posture: o.posture } : {}) };
  return parseLzLiveScan({ ...deriveLzScanBaseFields({ meta, offering, estate: { ...estate, posture: undefined } }), collection_mode: 'live', confidence: 'observed', meta, offering, estate });
}

const enc = (id: string, custody: 'provider-managed' | 'customer-managed' = 'customer-managed') => ({ resource_id: id, layer: 'at_rest' as const, encrypted: true, key_custody: custody });
const SRC = (call: string) => ({ calls: [call] });

describe('scan assembler passes driver posture through (#3864)', () => {
  const tmp: string[] = [];
  const dir = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); tmp.push(d); return d; };
  beforeEach(() => unregisterLiveLzDriver());
  afterEach(() => { unregisterLiveLzDriver(); for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

  async function workspace(): Promise<{ ws: string; store: CredentialStore }> {
    const ws = dir('swao-posture-ws-');
    writeFileSync(join(ws, '.swao.yml'), ['name: demo', 'landing_zones:', '  - id: fake-prod', '    provider: fakecsp', '    scopes:', '      - id: platform', '        kind: platform', '        auth: aksk', '        regions: [eu-de]', ''].join('\n'));
    const store = new CredentialStore(dir('swao-posture-vault-'));
    await store.set('lz:fake-prod:platform:access-key-id', ['fake', 'ak'].join('-'));
    await store.set('lz:fake-prod:platform:secret-access-key', ['fake', 'sk'].join('-'));
    return { ws, store };
  }
  const run = async () => {
    const { ws, store } = await workspace();
    const out = await runLzLiveScan({ workspaceRoot: ws, lzId: 'fake-prod', store, env: {}, fetchImpl: makeTransport([]) });
    return out.results[0]!.scan!;
  };

  it('a driver without listPosture yields a scan without estate.posture and without a posture source', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const s = await run();
    expect('posture' in s.estate).toBe(false);
    expect(s.meta.sources.some((x) => x.name === 'posture')).toBe(false);
  });

  it('listPosture output lands in estate.posture, validated, with every attributes map through the privacy filter (#3886)', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED, {
      listPosture: async () => ({
        encryption: { source: SRC('kms:ListKeys'), items: [{ ...enc('vol-1'), attributes: { description: 'free text', owner: 'someone@example.com', key_rotation_enabled: true } }] },
        identity: { source: SRC('iam:ListUsers'), privileged_without_mfa: 0, attributes: { note: 'x' } },
      }),
    }));
    const s = await run();
    // free text dropped, the person pseudonymised, the posture fact kept; `note` (free text) empties the identity map
    const owner = s.estate.posture?.encryption?.items[0]?.attributes?.['owner'];
    expect(owner).toMatch(/^Person-[0-9a-f]{10}$/);
    expect(s.estate.posture?.encryption?.items).toEqual([{ resource_id: 'vol-1', layer: 'at_rest', encrypted: true, key_custody: 'customer-managed', attributes: { owner, key_rotation_enabled: true } }]);
    expect(s.estate.posture?.identity).toEqual({ source: { calls: ['iam:ListUsers'], partial: false, status: 'ok' }, privileged_without_mfa: 0, credentials: [] });
    expect(JSON.stringify(s)).not.toContain('example.com');
    expect(s.meta.sources).toContainEqual({ name: 'posture', status: 'ok' });
  });

  it('a posture collector that cannot be served is a not_collected source, not an empty success', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED, { listPosture: async () => { throw new LiveSourceUnavailableError('posture', 403); } }));
    const s = await run();
    expect('posture' in s.estate).toBe(false);
    expect(s.meta.sources).toContainEqual({ name: 'posture', status: 'not_collected', http_status: 403 });
  });

  it('an invalid posture stops the scope with a clear error', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED, { listPosture: async () => ({ encryption: { source: SRC('kms:ListKeys'), items: [{ resource_id: 'v', layer: 'sideways' }] } }) as never }));
    await expect(run()).rejects.toThrow(/invalid posture: encryption\.items\.0\.layer/);
  });

  it('scrubPostureAttributes keeps blocks the driver did not send absent', () => {
    expect(scrubPostureAttributes({ logging: { source: SRC('cts:ListTrackers'), trails: [{ enabled: true, attributes: { a: 1, description: 'x' } }] } }, 's'.repeat(64))).toEqual({
      logging: { source: { calls: ['cts:ListTrackers'], partial: false, status: 'ok' }, trails: [{ enabled: true, attributes: { a: 1 } }] },
    });
    // a map the filter empties is removed
    expect(scrubPostureAttributes({ identity: { source: SRC('iam:ListUsers'), privileged_without_mfa: 0, attributes: { note: 'x' } } }, 's'.repeat(64)).identity).not.toHaveProperty('attributes');
  });
});

describe('scope merge of posture (#3864, Design 123 section 8.3)', () => {
  const merge = (scans: LzLiveScan[]) => mergeLzLiveScopes({ lzId: 'otc-test', provider: 'otc', scans, now: NOW });

  it('no merged scope with posture: the merged estate has no posture key (existing merges unchanged)', () => {
    const m = merge([scan({ scopeId: 'platform' }), scan({ scopeId: 'app-a', kind: 'application' })]);
    expect('posture' in m.estate).toBe(false);
    expect(mergeLzLivePosture([])).toBeUndefined();
  });

  it('per-resource blocks union by entry key, platform first; a block another scope lacks is partial', () => {
    const m = merge([
      scan({ scopeId: 'app-a', kind: 'application', posture: { encryption: { source: SRC('evs:ListVolumes'), items: [enc('vol-1', 'provider-managed'), enc('vol-2')] } } }),
      scan({ scopeId: 'platform', posture: { encryption: { source: SRC('kms:ListKeys'), items: [enc('vol-1')] } } }),
      scan({ scopeId: 'app-b', kind: 'application' }),
    ]);
    const e = m.estate.posture!.encryption!;
    expect(e.items.map((i) => `${i.resource_id}:${i.key_custody}`)).toEqual(['vol-1:customer-managed', 'vol-2:customer-managed']);
    expect(e.source).toEqual({ calls: ['evs:ListVolumes', 'kms:ListKeys'], partial: true, status: 'ok' });
  });

  it('a block read by every merged scope is not partial; a block nobody could read stays not_collected', () => {
    const denied = { calls: ['backup:ListPolicies'], status: 'not_collected' as const, http_status: 403 };
    const m = merge([
      scan({ scopeId: 'platform', posture: { exposure: { source: SRC('vpc:ListPublicIps'), items: [] }, backup: { source: denied, items: [] } } }),
      scan({ scopeId: 'app-a', kind: 'application', posture: { exposure: { source: SRC('vpc:ListPublicIps'), items: [{ resource_id: 'eip-1', exposure: 'public_ip', public: true }] }, backup: { source: denied, items: [] } } }),
    ]);
    expect(m.estate.posture!.exposure!.source.partial).toBe(false);
    expect(m.estate.posture!.exposure!.items).toHaveLength(1);
    expect(m.estate.posture!.backup!.source).toMatchObject({ status: 'not_collected', http_status: 403 });
  });

  it('identity and logging come from the platform scope; without a readable platform block, from an application scope', () => {
    const m = merge([
      scan({ scopeId: 'app-a', kind: 'application', posture: { identity: { source: SRC('iam:ListUsers'), privileged_without_mfa: 5 }, logging: { source: SRC('cts:ListTrackers'), trails: [{ enabled: true }] } } }),
      scan({ scopeId: 'platform', posture: { identity: { source: SRC('iam:ListUsers'), privileged_without_mfa: 0 }, logging: { source: { calls: ['cts:ListTrackers'], status: 'not_collected', http_status: 403 }, trails: [] } } }),
    ]);
    expect(m.estate.posture!.identity!.privileged_without_mfa).toBe(0);
    expect(m.estate.posture!.logging!.trails).toEqual([{ enabled: true }]);
    expect(m.estate.posture!.logging!.source.status).toBe('ok');
  });
});

describe('run diff of posture (#3864)', () => {
  const p = (items: ReturnType<typeof enc>[]): LzLivePostureInput => ({ encryption: { source: SRC('kms:ListKeys'), items } });

  it('new, removed and changed entries per block, sorted; identity is one entry', () => {
    const cur = scan({ scopeId: 'platform', posture: { ...p([enc('vol-1', 'provider-managed'), enc('vol-3')]), identity: { source: SRC('iam:ListUsers'), privileged_without_mfa: 1 } } });
    const prev = scan({ scopeId: 'platform', posture: { ...p([enc('vol-1'), enc('vol-2')]), identity: { source: { calls: ['iam:ListUsers', 'iam:ListMFADevices'] }, privileged_without_mfa: 1 } } });
    const d = computeLzLiveDiff(cur, prev);
    expect(d.posture_changes).toEqual([
      { block: 'encryption', change: 'changed', ref: 'vol-1#at_rest' },
      { block: 'encryption', change: 'new', ref: 'vol-3#at_rest' },
      { block: 'encryption', change: 'removed', ref: 'vol-2#at_rest' },
    ]);
    expect(lzPostureChangeCounts(d.posture_changes!)).toEqual({ encryption: { new: 1, removed: 1, changed: 1 } });
  });

  it('two scans without posture: no posture_changes key; a block one run did not collect is not compared', () => {
    expect('posture_changes' in computeLzLiveDiff(scan({ scopeId: 'platform' }), scan({ scopeId: 'platform' }))).toBe(false);
    expect(computeLzLivePostureChanges(undefined, undefined)).toBeUndefined();
    const denied = { encryption: { source: { calls: ['kms:ListKeys'], status: 'not_collected' as const, http_status: 403 }, items: [] } };
    const cur = scan({ scopeId: 'platform', posture: denied });
    const prev = scan({ scopeId: 'platform', posture: p([enc('vol-1')]) });
    expect(computeLzLiveDiff(cur, prev).posture_changes).toEqual([]);
  });

  it('swao lz diff prints posture changes as counts, never refs', () => {
    const lines = formatLzDiff({ lz_id: 'otc-test', to_run: 'b', first_scans: [], scopes: [{
      scope_id: 'platform', from_run: 'a', to_run: 'b', simulated: false, new_regions: [], new_services: [], new_resources: 0,
      removed_regions: [], removed_services: [], removed_resources: 0, status_changes: [],
      posture_changes: { encryption: { new: 1, removed: 0, changed: 2 } },
    }] });
    expect(lines).toContain('  posture changes: encryption new 1, removed 0, changed 2');
  });
});

describe('portfolio check rank with unverified (#3864)', () => {
  it('covers every status: fail < warn < unverified < pass < na', () => {
    expect(Object.keys(LZ_LIVE_CHECK_RANK).sort()).toEqual([...LZ_LIVE_CHECK_STATUSES].sort());
    const order = [...LZ_LIVE_CHECK_STATUSES].sort((a, b) => LZ_LIVE_CHECK_RANK[a] - LZ_LIVE_CHECK_RANK[b]);
    expect(order).toEqual(['fail', 'warn', 'unverified', 'pass', 'na']);
  });
});

describe('required_tags stays observable under the privacy mode (Design 123 section 12)', () => {
  it('pseudonymiseTags keeps every tag key and replaces only person values', () => {
    const tags = { owner: 'Some Person', 'cost-center': 'cc-42', environment: 'prod', contact: 'someone@example.com', note: 'login-x was here' };
    const out = pseudonymiseTags(tags, 's'.repeat(64), ['login-x']);
    expect(Object.keys(out)).toEqual(Object.keys(tags));
    expect(out['cost-center']).toBe('cc-42');
    expect(out['environment']).toBe('prod');
    for (const k of ['owner', 'contact', 'note'] as const) expect(out[k]).toMatch(/^Person-[0-9a-f]{10}$/);
  });
});
