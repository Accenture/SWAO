// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4266: the run heartbeat fires every 30 s with the running pass_id, the
// synchronous pass work reports assessment.pass.progress, Pass 01 names the
// cost of the source walk (files_scanned, dirs_scanned, bytes_scanned), and
// with source.vcs.subdir set the inventory walks only that subdirectory.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appSourceRoot } from '@swao/core';
import { HEARTBEAT_INTERVAL_MS, PASS_PROGRESS_MIN_GAP_MS, resolveSourcePath } from './assess.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = readFileSync(join(HERE, 'assess.ts'), 'utf-8');

describe('heartbeat and progress settings (#4266)', () => {
  it('heartbeat every 30 s or less; progress lines fill the gaps a blocked timer leaves', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBeLessThanOrEqual(30_000);
    expect(PASS_PROGRESS_MIN_GAP_MS).toBeLessThan(HEARTBEAT_INTERVAL_MS);
  });

  it('heartbeat and progress events carry the pass_id of the running pass; the sink is removed at run end', () => {
    const hb = SRC.slice(SRC.indexOf("'assessment.heartbeat'"), SRC.indexOf("'assessment.heartbeat'") + 400);
    expect(hb).toMatch(/pass_id: currentPass\.passId/);
    const pr = SRC.slice(SRC.indexOf("'assessment.pass.progress'"), SRC.indexOf("'assessment.pass.progress'") + 400);
    expect(pr).toMatch(/pass_id: currentPass\.passId/);
    expect(SRC.match(/setPassProgressSink\(null\)/g)?.length).toBe(2);
  });

  it('#4300: one time-based run heartbeat (core createRunHeartbeat) feeds the sink and is stopped on both exit paths', () => {
    expect(SRC).toMatch(/createRunHeartbeat\(\{\s*intervalMs: HEARTBEAT_INTERVAL_MS,\s*progressGapMs: PASS_PROGRESS_MIN_GAP_MS,/);
    expect(SRC).toMatch(/setPassProgressSink\(runHeartbeat\.sink\);\s*runHeartbeat\.start\(\);/);
    expect(SRC.match(/runHeartbeat\.stop\(\);\s*setPassProgressSink\(null\)/g)?.length).toBe(2);
    expect(SRC).not.toMatch(/setInterval\([^)]*HEARTBEAT_INTERVAL_MS/);
  });

  it('resolveSourcePath uses the source-root helper of #4243', () => {
    const appDir = join(tmpdir(), 'swao-4266-app');
    const yml = { source: { path: 'wsp/inputs/source/', vcs: { subdir: 'services/api' } } };
    expect(resolveSourcePath(appDir, yml, undefined)).toBe(appSourceRoot(appDir, yml).root);
  });
});

const CLI = join(HERE, '..', '..', 'dist', 'index.js');

describe.skipIf(!existsSync(CLI))('Pass 01 inventory with source.vcs.subdir (#4266, dist-backed)', () => {
  let ws: string;
  let events: Array<{ code: string; context?: Record<string, unknown> }> = [];
  beforeAll(() => {
    ws = mkdtempSync(join(tmpdir(), 'swao-inv-subdir-'));
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
    const app = join(ws, 'apps', 'mono');
    const clone = join(app, 'wsp', 'inputs', 'source');
    mkdirSync(join(clone, 'svc', 'src'), { recursive: true });
    mkdirSync(join(clone, 'sibling', 'src'), { recursive: true });
    writeFileSync(join(app, '.swao.yml'), 'wsp_version: "0.9"\napp_id: mono\nsource:\n  path: wsp/inputs/source/\n  vcs:\n    subdir: svc\n');
    writeFileSync(join(clone, 'svc', 'package.json'), '{"name":"svc","dependencies":{"express":"^4.0.0"}}\n');
    writeFileSync(join(clone, 'svc', 'src', 'index.js'), "require('express')().listen(8080);\n");
    for (let i = 0; i < 25; i++) writeFileSync(join(clone, 'sibling', 'src', `f${i}.js`), `module.exports = ${i};\n`);
    const r = spawnSync(process.execPath, [CLI, 'assess', '--app', 'mono', '--workspace', ws, '--skip-llm', '--no-crawl', '--passes', 'inv'], {
      cwd: ws, encoding: 'utf-8', timeout: 240_000, env: { ...process.env, SWAO_LICENSE_TIER_OVERRIDE: 'community' },
    });
    expect(r.status, r.stderr).toBe(0);
    const logs = join(app, 'wsp', 'logs');
    events = readdirSync(logs).filter((f) => f.startsWith('app-events-'))
      .flatMap((f) => readFileSync(join(logs, f), 'utf-8').split('\n').filter(Boolean))
      .map((l) => JSON.parse(l) as { code: string; context?: Record<string, unknown> });
  }, 300_000);
  afterAll(() => { rmSync(ws, { recursive: true, force: true }); });

  it('walks only the subdirectory and names the cost on assessment.pass.complete', () => {
    const done = events.find((e) => e.code === 'assessment.pass.complete' && e.context?.['pass'] === 'inv')!;
    expect(done).toBeDefined();
    // svc/package.json and svc/src/index.js; none of the 25 sibling files.
    expect(done.context).toMatchObject({ files_scanned: 2, dirs_scanned: 2 });
    expect(done.context?.['bytes_scanned']).toBeGreaterThan(0);
  });
});
