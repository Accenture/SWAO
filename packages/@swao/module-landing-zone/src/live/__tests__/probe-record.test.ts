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

// #4233: runLzProbe stores the last probe per scope (no identity, no value);
// the health check reads it and the last run facts without a network call.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@swao/core', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@swao/core')>();
  return { ...orig, logPortfolio: () => undefined };
});

const { CredentialStore } = await import('@swao/core');
const { registerLiveLzDriver, unregisterLiveLzDriver } = await import('../registry.js');
const { runLzProbe } = await import('../session.js');
const { recordLzProbe, readLzProbeRecords, readLzLastRunFacts, LZ_PROBE_RECORD_FILE } = await import('../probe-record.js');
const { makeFakeDriver, makeTransport, REFUSED, VERIFIED } = await import('./fake-driver.js');

const tmp: string[] = [];
const tempDir = (prefix: string): string => { const d = mkdtempSync(join(tmpdir(), prefix)); tmp.push(d); return d; };

const YML = [
  'name: demo',
  'landing_zones:',
  '  - id: fake-prod',
  '    provider: fakecsp',
  '    scopes:',
  '      - id: platform',
  '        kind: platform',
  '        auth: aksk',
  '        regions: [eu-de]',
  '',
].join('\n');

beforeEach(() => unregisterLiveLzDriver());
afterEach(() => {
  unregisterLiveLzDriver();
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('last probe record (#4233)', () => {
  it('runLzProbe records state, coverage counts, caller and time; no identity, no permission names', async () => {
    registerLiveLzDriver(makeFakeDriver(REFUSED));
    const ws = tempDir('swao-lz-probe-rec-ws-');
    writeFileSync(join(ws, '.swao.yml'), YML);
    const store = new CredentialStore(tempDir('swao-lz-probe-rec-vault-'));
    await store.set('lz:fake-prod:platform:access-key-id', ['fake', 'ak'].join('-'));
    await store.set('lz:fake-prod:platform:secret-access-key', ['fake', 'sk'].join('-'));
    await runLzProbe({ workspaceRoot: ws, lzId: 'fake-prod', store, env: {}, fetchImpl: makeTransport([]), caller: 'wizard.lz-live.probe' });
    const rec = readLzProbeRecords(ws, 'fake-prod').get('platform');
    expect(rec).toMatchObject({ read_only: 'refused', readable: 2, unreadable: 0, caller: 'wizard.lz-live.probe' });
    expect(Number.isFinite(Date.parse(rec!.probed_at))).toBe(true);
    const raw = readFileSync(join(ws, 'landing-zones', 'fake-prod', 'wsp', LZ_PROBE_RECORD_FILE), 'utf-8');
    expect(raw).not.toContain('domain-admin');
    expect(raw).not.toContain('fake-ak');
  });

  it('merges scopes, keeps the newest probe per scope and ignores unsafe keys', () => {
    const ws = tempDir('swao-lz-probe-rec-merge-');
    const t1 = new Date('2026-11-01T08:00:00Z');
    const t2 = new Date('2026-11-10T08:00:00Z');
    expect(recordLzProbe({ workspaceRoot: ws, lzId: 'otc-prod', scopeId: 'platform', probe: REFUSED, caller: 'lz.probe', now: t1 })).toBe(true);
    recordLzProbe({ workspaceRoot: ws, lzId: 'otc-prod', scopeId: 'app-a', probe: VERIFIED, caller: 'lz.probe', now: t1 });
    recordLzProbe({ workspaceRoot: ws, lzId: 'otc-prod', scopeId: 'platform', probe: VERIFIED, caller: 'lz.connect', now: t2 });
    expect(recordLzProbe({ workspaceRoot: ws, lzId: 'otc-prod', scopeId: '__proto__', probe: VERIFIED, caller: 'lz.probe' })).toBe(false);
    const recs = readLzProbeRecords(ws, 'otc-prod');
    expect([...recs.keys()]).toEqual(['app-a', 'platform']);
    expect(recs.get('platform')).toMatchObject({ read_only: 'verified', readable: 1, unreadable: 1, probed_at: t2.toISOString(), caller: 'lz.connect' });
  });

  it('an unreadable or foreign record file gives no records', () => {
    const ws = tempDir('swao-lz-probe-rec-bad-');
    const dir = join(ws, 'landing-zones', 'otc-prod', 'wsp');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, LZ_PROBE_RECORD_FILE), '{ not json');
    expect(readLzProbeRecords(ws, 'otc-prod').size).toBe(0);
    writeFileSync(join(dir, LZ_PROBE_RECORD_FILE), JSON.stringify({ scopes: { platform: { read_only: 'maybe' } } }));
    expect(readLzProbeRecords(ws, 'otc-prod').size).toBe(0);
  });

  it('last run facts: services and resources read per scope of the run latest-lz-live.txt names', () => {
    const ws = tempDir('swao-lz-last-run-');
    const wsp = join(ws, 'landing-zones', 'otc-prod', 'wsp');
    const run = join(wsp, 'runs', '2026-11-10T08-00-00');
    mkdirSync(run, { recursive: true });
    writeFileSync(join(wsp, 'latest-lz-live.txt'), '2026-11-10T08-00-00\n');
    writeFileSync(join(run, 'otc-prod.platform.lz-live-scan.json'), JSON.stringify({
      meta: { scope_id: 'platform', observed_at: '2026-11-10T08:03:00Z' },
      offering: { services: [{}, {}, {}] },
      estate: { resources: [{}, {}] },
    }));
    writeFileSync(join(run, 'otc-prod.broken.lz-live-scan.json'), '{');
    const facts = readLzLastRunFacts(ws, 'otc-prod');
    expect([...facts.keys()]).toEqual(['platform']);
    expect(facts.get('platform')).toEqual({ run_id: '2026-11-10T08-00-00', observed_at: '2026-11-10T08:03:00Z', services: 3, resources: 2 });
    expect(readLzLastRunFacts(tempDir('swao-lz-no-run-'), 'otc-prod').size).toBe(0);
  });
});
