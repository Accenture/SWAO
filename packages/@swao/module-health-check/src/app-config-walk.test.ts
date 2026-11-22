// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health-check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listAppConfigs, mapPool, prefetchAppInputs, prefetchedText, sharedAppConfigWalkActive, withSharedAppConfigWalk } from './app-config-walk.js';
import { startProbeMeter, takeProbeMeterReading } from './probe-meter.js';
import { buildResearchCacheProbe, buildServiceWorkspaceProbe, buildPiiScrubAuditProbe } from './probes/service-probes.js';
import { buildCommunityFrameworksProbe } from './probes/compliance-catalogues-probe.js';
import { findVcsSourcedApps } from './probes/prerequisites-probe.js';
import { readWorkspaceLzTargets } from './probes/lz-catalogue-coverage-probe.js';

let ws: string;

function writeApp(id: string, yml: string): void {
  mkdirSync(join(ws, 'apps', id), { recursive: true });
  writeFileSync(join(ws, 'apps', id, '.swao.yml'), yml);
}

function stub(path: string, retrievedAt: string): void {
  writeFileSync(path, `---\nretrieved_at: "${retrievedAt}"\n---\nbody\n`);
}

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'swao-walk-'));
  writeFileSync(join(ws, '.swao.yml'), 'service_portfolio:\n  app_count: 3\n');
  const now = new Date().toISOString();
  for (const id of ['svc-b', 'svc-a', 'svc-c']) {
    writeApp(id, `assessment:\n  type: service\n  regimes_active: [SWAO_APM, UNKNOWN_X]\nlanding_zone:\n  targets: ["otc:germany"]\n`);
    const dir = join(ws, 'apps', id, 'wsp', 'inputs', 'research');
    mkdirSync(dir, { recursive: true });
    stub(join(dir, 'cve-summary.md'), now);
    stub(join(dir, 'eol-status.md'), id === 'svc-c' ? '2020-01-01T00:00:00Z' : now);
    if (id !== 'svc-b') writeFileSync(join(dir, 'confidence.json'), '{}');
  }
  writeApp('code-app', 'source:\n  vcs:\n    url: https://example.invalid/repo.git\n');
  writeApp('broken', 'assessment: [unclosed\n');
  mkdirSync(join(ws, 'apps', 'no-config'), { recursive: true });
  writeFileSync(join(ws, 'apps', 'stray-file.txt'), 'x');
  const catalogs = join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'gdpr');
  mkdirSync(catalogs, { recursive: true });
});

afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

describe('shared app config walk (#4461)', () => {
  it('lists the app folders with a .swao.yml and marks the one that does not parse', () => {
    const ids = listAppConfigs(ws).map((a) => a.id).sort();
    expect(ids).toEqual(['broken', 'code-app', 'svc-a', 'svc-b', 'svc-c']);
    expect(listAppConfigs(ws).find((a) => a.id === 'broken')!.parseError).toBe(true);
  });

  it('gives the same probe results inside the shared walk as outside it', async () => {
    const now = new Date();
    const run = () => ({
      research: buildResearchCacheProbe(ws, now),
      service: buildServiceWorkspaceProbe(ws),
      pii: buildPiiScrubAuditProbe(ws),
      community: buildCommunityFrameworksProbe(ws),
      vcs: findVcsSourcedApps(ws),
      lz: readWorkspaceLzTargets(ws),
    });
    const outside = run();
    const inside = await withSharedAppConfigWalk(async () => run());
    expect(inside).toEqual(outside);
    expect(outside.vcs).toEqual(['code-app']);
    expect(outside.research.message).toContain('svc-c');
  });

  it('reads each app config once inside the walk and afresh outside it', async () => {
    const stop = startProbeMeter();
    try {
      takeProbeMeterReading();
      await withSharedAppConfigWalk(async () => {
        expect(sharedAppConfigWalkActive()).toBe(true);
        listAppConfigs(ws);
        const first = takeProbeMeterReading()!;
        expect(first.files_read).toBe(5);
        // A changed file is not read again within one walk.
        writeApp('svc-a', 'assessment:\n  type: changed\n');
        const again = listAppConfigs(ws);
        expect(takeProbeMeterReading()!.files_read).toBe(0);
        expect((again.find((a) => a.id === 'svc-a')!.doc as { assessment: { type: string } }).assessment.type).toBe('service');
      });
      expect(sharedAppConfigWalkActive()).toBe(false);
      const after = listAppConfigs(ws);
      expect(takeProbeMeterReading()!.files_read).toBe(5);
      expect((after.find((a) => a.id === 'svc-a')!.doc as { assessment: { type: string } }).assessment.type).toBe('changed');
    } finally {
      stop();
    }
  });
});


// #4461: the app configs and research stubs are read once, concurrently, before the probes.
describe('prefetch of the app inputs (#4461)', () => {
  it('reads the configs and the research files of the service apps; the probes then read nothing and give the same results', async () => {
    const now = new Date();
    const outside = { research: buildResearchCacheProbe(ws, now), community: buildCommunityFrameworksProbe(ws), vcs: findVcsSourcedApps(ws) };
    const stop = startProbeMeter();
    try {
      await withSharedAppConfigWalk(async () => {
        const stats = await prefetchAppInputs(ws, { concurrency: 3 });
        // 5 configs (no-config has none), 3 service apps x 2 research stubs; confidence.json by stat (svc-b has none).
        expect(stats).toMatchObject({ apps: 5, service_apps: 3, files_read: 5 + 6, files_absent: 1, files_stat: 3, concurrency: 3 });
        takeProbeMeterReading();
        const inside = { research: buildResearchCacheProbe(ws, now), community: buildCommunityFrameworksProbe(ws), vcs: findVcsSourcedApps(ws) };
        expect(inside).toEqual(outside);
        expect(takeProbeMeterReading()!.files_read).toBe(0);
        expect(prefetchedText(join(ws, 'apps', 'svc-b', 'wsp', 'inputs', 'research', 'confidence.json'))).toEqual({ hit: true, text: null });
        expect(prefetchedText(join(ws, 'apps', 'svc-a', 'other.txt'))).toEqual({ hit: false });
      });
      expect(prefetchedText(join(ws, 'apps', 'svc-a', 'wsp', 'inputs', 'research', 'cve-summary.md'))).toEqual({ hit: false });
    } finally {
      stop();
    }
  });

  it('reads the configs only when the research stubs are not wanted (a scoped run without research_cache)', async () => {
    await withSharedAppConfigWalk(async () => {
      const stats = await prefetchAppInputs(ws, { researchStubs: false });
      expect(stats).toMatchObject({ apps: 5, service_apps: 3, files_read: 5, files_stat: 0 });
      expect(prefetchedText(join(ws, 'apps', 'svc-a', 'wsp', 'inputs', 'research', 'cve-summary.md'))).toEqual({ hit: false });
      // research_cache still reads its stubs itself and gives its result.
      expect(buildResearchCacheProbe(ws, new Date()).message).toContain('svc-c');
    });
  });

  it('does nothing outside a shared walk', async () => {
    expect((await prefetchAppInputs(ws)).files_read).toBe(0);
    expect(listAppConfigs(ws).length).toBe(5);
  });

  it('mapPool keeps at most the limit in flight and the input order', async () => {
    let inFlight = 0;
    let max = 0;
    const out = await mapPool([5, 1, 4, 2, 3, 6, 7], 3, async (n) => {
      inFlight += 1; max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, n * 3));
      inFlight -= 1;
      return n * 10;
    });
    expect(max).toBe(3);
    expect(out).toEqual([50, 10, 40, 20, 30, 60, 70]);
  });
});
