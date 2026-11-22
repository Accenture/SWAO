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

// #4411 (Design 120 section 6.4): a Landing Zone Live run wrote no log line;
// probe, crawl, evaluate and scope complete went to stdout only. A mock CSP
// run now writes run start, probe, evaluate, scope complete and run complete
// in order, with landing zone and scope ids only.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const events: Array<{ level: string; code: string; message: string; context: Record<string, unknown> }> = [];
vi.mock('@swao/core', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@swao/core')>();
  return {
    ...orig,
    logPortfolio: (level: string, code: string, message: string, opts: { context?: Record<string, unknown> } = {}) => {
      events.push({ level, code, message, context: opts.context ?? {} });
    },
  };
});

const { CredentialStore } = await import('@swao/core');
const { runLzLiveAssessment } = await import('../assess.js');
const { registerBuiltInLiveLzDrivers, UNVERIFIED_DRIVERS_ENV } = await import('../builtin.js');
const { unregisterLiveLzDriver } = await import('../registry.js');
const { ADMIN_ROLE, READONLY_ROLE, makeOtcMock } = await import('../otc/__tests__/otc-mock.js');

const META = 'framework:\n  id: BSI_C5\n  name: "BSI C5 test"\n  version: "2020"\n';
const CONTROLS = 'regime_meta:\n  id: BSI_C5\n  version: "2020"\ncontrols: []\n';

const tmp: string[] = [];
const tempDir = (prefix: string): string => { const d = mkdtempSync(join(tmpdir(), prefix)); tmp.push(d); return d; };

beforeEach(() => { events.length = 0; unregisterLiveLzDriver(); registerBuiltInLiveLzDrivers({ [UNVERIFIED_DRIVERS_ENV]: 'otc' }); });
afterEach(() => {
  unregisterLiveLzDriver();
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function harness(): Promise<{ ws: string; store: InstanceType<typeof CredentialStore> }> {
  const ws = tempDir('swao-lzl-runlog-');
  writeFileSync(join(ws, '.swao.yml'), [
    'name: demo', 'landing_zones:', '  - id: otc-test', '    provider: otc', '    scopes:',
    '      - id: platform', '        kind: platform', '        auth: iam-password-token', '        regions: [eu-de, eu-nl]', '',
  ].join('\n'));
  const dir = join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'bsi-c5');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'framework-meta.yaml'), META);
  writeFileSync(join(dir, 'controls.yaml'), CONTROLS);
  const store = new CredentialStore(tempDir('swao-lzl-runlog-vault-'));
  await store.set('lz:otc-test:platform:username', 'mock-user');
  await store.set('lz:otc-test:platform:password', 'mock-pass-value');
  await store.set('lz:otc-test:platform:domain', 'MOCK-DOMAIN');
  return { ws, store };
}

const LZ_CODES = ['lz.live.run.start', 'lz.live.probe', 'lz.live.scope.complete', 'lz.live.evaluate.complete', 'lz.live.run.complete'];

describe('#4411 Landing Zone Live run log events', () => {
  it('a complete mock run logs start, probe, scope complete, evaluate and run complete in order', async () => {
    const { ws, store } = await harness();
    const mock = makeOtcMock({ roles: [READONLY_ROLE] });
    const out = await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', frameworks: 'BSI_C5', checks: [], store, env: {}, fetchImpl: mock.fetch, now: () => new Date('2026-11-14T15:35:48.021Z') });
    expect(out.status).toBe('complete');
    const lz = events.filter((e) => e.code.startsWith('lz.live.') && LZ_CODES.includes(e.code));
    expect(lz.map((e) => e.code)).toEqual(LZ_CODES);
    const [start, probe, scope, evaluate, done] = lz;
    expect(start!.context).toMatchObject({ lz_id: 'otc-test', provider: 'otc', run_id: '2026-11-14T15-35-48', scopes: ['platform'], frameworks: ['BSI_C5'], build_commit: 'source' });
    expect(probe!.context).toMatchObject({ lz_id: 'otc-test', scope_id: 'platform', caller: 'lz.scan', proceed: true, overrides: [] });
    expect(typeof probe!.context['duration_ms']).toBe('number');
    expect(evaluate!.context).toMatchObject({ lz_id: 'otc-test', scope_id: 'platform', frameworks: ['BSI_C5'] });
    expect(typeof evaluate!.context['findings']).toBe('number');
    expect(scope!.context).toMatchObject({ lz_id: 'otc-test', scope_id: 'platform', run_id: '2026-11-14T15-35-48' });
    expect(typeof scope!.context['services']).toBe('number');
    expect(typeof scope!.context['resources']).toBe('number');
    expect(done!).toMatchObject({ level: 'info', context: { lz_id: 'otc-test', run_id: '2026-11-14T15-35-48', status: 'complete', scopes: [{ scope_id: 'platform', status: 'complete' }] } });
    // Landing zone and scope ids only: no credential value or login name in any line.
    const text = JSON.stringify(lz);
    for (const secret of ['mock-user', 'mock-pass-value', 'MOCK-DOMAIN']) expect(text).not.toContain(secret);
  }, 30_000);

  it('a refused scope logs the stopped probe (warn) and a failed run complete; no scope complete', async () => {
    const { ws, store } = await harness();
    const mock = makeOtcMock({ roles: [ADMIN_ROLE] });
    const out = await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', frameworks: 'BSI_C5', checks: [], store, env: {}, fetchImpl: mock.fetch, now: () => new Date('2026-11-14T15:40:00Z') });
    expect(out.status).toBe('failed');
    const codes = events.map((e) => e.code).filter((c) => c.startsWith('lz.live.'));
    expect(codes).toContain('lz.live.probe');
    expect(codes).not.toContain('lz.live.scope.complete');
    expect(events.find((e) => e.code === 'lz.live.probe')).toMatchObject({ level: 'warn', context: { proceed: false } });
    expect(events.find((e) => e.code === 'lz.live.run.complete')).toMatchObject({ level: 'warn', context: { status: 'failed' } });
  }, 30_000);
  it('a run that throws after its start still closes with lz.live.run.complete failed', async () => {
    const { ws, store } = await harness();
    const mock = makeOtcMock({ roles: [READONLY_ROLE] });
    // A file where the wsp folder goes: the run starts and crawls, then writing the run folder throws.
    const wsp = join(ws, 'landing-zones', 'otc-test');
    mkdirSync(wsp, { recursive: true });
    writeFileSync(join(wsp, 'wsp'), 'not a folder');
    await expect(runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', frameworks: 'BSI_C5', checks: [], store, env: {}, fetchImpl: mock.fetch, now: () => new Date('2026-11-14T15:50:00Z') })).rejects.toThrow();
    const codes = events.map((e) => e.code).filter((c) => c === 'lz.live.run.start' || c === 'lz.live.run.complete');
    expect(codes).toEqual(['lz.live.run.start', 'lz.live.run.complete']);
    expect(events.find((e) => e.code === 'lz.live.run.complete')).toMatchObject({ level: 'warn', context: { status: 'failed' } });
  }, 30_000);
});
