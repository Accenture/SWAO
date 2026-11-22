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

// #4091 (Design 120 section 6.3): a scope that reads through the landing
// zone's log archive scope (#3975) stamps the archive's read-only gate into
// its own run record (`meta.sources`, `log-archive:<scope id>`), so a
// write-capable archive login accepted with --accept-write-capable-credentials
// is visible even when only the reading scope is run (`--scope platform`).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from '@swao/core';
import type { LzLiveScan } from '@swao/core';
import { runLzLiveScan } from '../scan.js';
import { runLzLiveAssessment } from '../assess.js';
import { registerLiveLzDriver, unregisterLiveLzDriver } from '../registry.js';
import { REFUSED, VERIFIED, makeFakeDriver, makeTransport } from './fake-driver.js';

describe('log archive gate in the reading scope run record (#4091)', () => {
  const tmp: string[] = [];
  const dir = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); tmp.push(d); return d; };
  beforeEach(() => unregisterLiveLzDriver());
  afterEach(() => { unregisterLiveLzDriver(); for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

  /** platform reads verified; the log archive login is write-capable; the posture collector opens the archive when `openArchive`. */
  async function setup(o: { openArchive: boolean; framework?: boolean }): Promise<{ ws: string; store: CredentialStore }> {
    registerLiveLzDriver(makeFakeDriver(async (ctx) => (ctx.scopeId === 'log-archive' ? REFUSED : VERIFIED), {
      listPosture: async (ctx) => {
        if (o.openArchive) await ctx.logArchive?.open();
        return {};
      },
    }));
    const ws = dir('swao-la-gate-ws-');
    const scope = (id: string, kind: string, extra: string[] = []): string[] => [`      - id: ${id}`, `        kind: ${kind}`, '        auth: aksk', '        regions: [eu-de]', ...extra];
    writeFileSync(join(ws, '.swao.yml'), ['name: demo', 'landing_zones:', '  - id: fake-prod', '    provider: fakecsp', '    scopes:', ...scope('platform', 'platform'), ...scope('log-archive', 'application', ['        purpose: log-archive']), ''].join('\n'));
    if (o.framework) {
      const fw = join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'bsi-c5');
      mkdirSync(fw, { recursive: true });
      writeFileSync(join(fw, 'framework-meta.yaml'), 'framework:\n  id: BSI_C5\n  name: "BSI C5 test"\n  version: "2020"\n');
      writeFileSync(join(fw, 'controls.yaml'), 'regime_meta:\n  id: BSI_C5\n  version: "2020"\ncontrols: []\n');
      writeFileSync(join(fw, 'service-controls.yaml'), 'schema_version: "0.1"\nframework: BSI_C5\nmappings: []\n');
    }
    const store = new CredentialStore(dir('swao-la-gate-vault-'));
    for (const s of ['platform', 'log-archive']) {
      await store.set(`lz:fake-prod:${s}:access-key-id`, ['fake', 'ak', s].join('-'));
      await store.set(`lz:fake-prod:${s}:secret-access-key`, ['fake', 'sk', s].join('-'));
    }
    return { ws, store };
  }

  async function run(o: { acceptWriteCapable: boolean; openArchive: boolean }): Promise<LzLiveScan> {
    const { ws, store } = await setup(o);
    const out = await runLzLiveScan({ workspaceRoot: ws, lzId: 'fake-prod', scopeId: 'platform', store, env: {}, fetchImpl: makeTransport([]), ...(o.acceptWriteCapable ? { acceptWriteCapableCredentials: true } : {}) });
    expect(out.results).toHaveLength(1);
    return out.results[0]!.scan!;
  }

  /** #4059: `swao assess --type landing-zone-live --scope platform`; returns the platform entry of manifest.json. */
  async function manifestScope(o: { acceptWriteCapable: boolean; openArchive: boolean }): Promise<Record<string, unknown>> {
    const { ws, store } = await setup({ ...o, framework: true });
    const out = await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'fake-prod', scopeIds: ['platform'], frameworks: 'BSI_C5', checks: [], store, env: {}, fetchImpl: makeTransport([]), now: () => new Date('2026-11-09T08:00:00Z'), ...(o.acceptWriteCapable ? { acceptWriteCapableCredentials: true } : {}) });
    expect(out.status).toBe('complete');
    const manifest = JSON.parse(readFileSync(join(out.runDir, 'manifest.json'), 'utf-8')) as { scopes: Record<string, unknown>[] };
    expect(manifest.scopes).toHaveLength(1);
    return manifest.scopes[0]!;
  }

  const archiveSources = (s: LzLiveScan) => s.meta.sources.filter((x) => x.name.startsWith('log-archive:'));

  it('a write-capable archive login accepted with the flag: the platform scan records the probe result, the override and the reason', async () => {
    const s = await run({ acceptWriteCapable: true, openArchive: true });
    expect(s.meta.scope_id).toBe('platform');
    expect(s.meta.read_only).toBe('verified');
    expect(archiveSources(s)).toEqual([{ name: 'log-archive:log-archive', status: 'ok', reason: 'read_only refused; overrides accept-write-capable-credentials; write-capable credential accepted by operator' }]);
    // the probe reason of the archive (it can name roles or actions) is not copied
    expect(JSON.stringify(s.meta.sources)).not.toContain(REFUSED.reason);
  });

  it('without the flag the gate stops the archive, and the platform scan records why', async () => {
    const s = await run({ acceptWriteCapable: false, openArchive: true });
    expect(archiveSources(s)).toEqual([{ name: 'log-archive:log-archive', status: 'not_collected', reason: 'read_only_refused (read_only refused)' }]);
  });

  it('an archive no collector opened leaves no entry', async () => {
    const s = await run({ acceptWriteCapable: true, openArchive: false });
    expect(archiveSources(s)).toEqual([]);
  });

  describe('in the run manifest (#4059)', () => {
    it('a write-capable archive login accepted with the flag: the reading scope entry records the archive scope, the gate result, the override and the reason', async () => {
      const m = await manifestScope({ acceptWriteCapable: true, openArchive: true });
      expect(m).toMatchObject({ scope_id: 'platform', read_only: 'verified', read_only_overrides: [] });
      expect(m['log_archive']).toEqual({ scope_id: 'log-archive', opened: true, read_only: 'refused', read_only_overrides: ['accept-write-capable-credentials'], read_only_reason: 'write-capable credential accepted by operator' });
      // no role names, actions or identities of the archive's probe
      const archive = JSON.stringify(m['log_archive']);
      for (const leak of [REFUSED.reason!, REFUSED.identity, ...REFUSED.write_actions_allowed]) expect(archive).not.toContain(leak);
    });

    it('without the flag the gate stops the archive, and the reading scope entry records why', async () => {
      const m = await manifestScope({ acceptWriteCapable: false, openArchive: true });
      expect(m['log_archive']).toEqual({ scope_id: 'log-archive', opened: false, unavailable: 'read_only_refused', read_only: 'refused' });
    });

    it('an archive no collector opened leaves no log_archive entry', async () => {
      const m = await manifestScope({ acceptWriteCapable: true, openArchive: false });
      expect(m).not.toHaveProperty('log_archive');
    });
  });
});
