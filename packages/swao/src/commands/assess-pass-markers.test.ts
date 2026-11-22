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

// #4267 (Design 098 section 4.1): with SWAO_PASS_MARKERS=1 `swao assess`
// writes [pass-start] / [pass-done] markers whose key, name and pass_id equal
// the engine assessment.pass.* events, so the TUI's assess.app.pass.* events
// join them; without the opt-in no marker is written.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePassMarker, type PassMarker } from '@swao/core';

const CLI = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'dist', 'index.js');

describe.skipIf(!existsSync(CLI))('swao assess pass markers (#4267)', () => {
  let ws: string;
  let stdout = '';
  beforeAll(() => {
    ws = mkdtempSync(join(tmpdir(), 'swao-pass-markers-'));
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
    const app = join(ws, 'apps', 'webapp');
    mkdirSync(join(app, 'wsp', 'inputs', 'source'), { recursive: true });
    writeFileSync(join(app, '.swao.yml'), 'wsp_version: "0.9"\napp_id: webapp\nsource:\n  path: wsp/inputs/source/\n');
    writeFileSync(join(app, 'wsp', 'inputs', 'source', 'index.js'), "const http = require('http');\nhttp.createServer(() => {}).listen(8080);\n");
    const r = spawnSync(process.execPath, [CLI, 'assess', '--app', 'webapp', '--workspace', ws, '--skip-llm', '--no-crawl', '--passes', 'inv,state'], {
      cwd: ws, encoding: 'utf-8', timeout: 240_000, env: { ...process.env, SWAO_LICENSE_TIER_OVERRIDE: 'community', SWAO_PASS_MARKERS: '1' },
    });
    expect(r.status).toBe(0);
    stdout = r.stdout;
  }, 300_000);
  afterAll(() => { rmSync(ws, { recursive: true, force: true }); });

  it('writes one start and one done marker per pass, matching the engine events', () => {
    const lines = stdout.split(/\r?\n/);
    const markers = lines.map(parsePassMarker).filter((m): m is PassMarker => m !== null);
    expect(markers.map((m) => `${m.kind}:${m.key}`)).toEqual(['start:inv', 'done:inv', 'start:state', 'done:state']);
    const logs = join(ws, 'apps', 'webapp', 'wsp', 'logs');
    const events = readdirSync(logs).filter((f) => f.startsWith('app-events-'))
      .flatMap((f) => readFileSync(join(logs, f), 'utf-8').split('\n').filter(Boolean))
      .map((l) => JSON.parse(l) as { code: string; run_id?: string; context?: Record<string, unknown> });
    const runStart = events.find((e) => e.code === 'swao.run.start')!;
    // #4430: the run start names the build (a source run: commit "source", no date).
    expect(runStart.context).toMatchObject({ build_commit: 'source', build_date: null });
    for (const m of markers) {
      const engine = events.find((e) => e.code === (m.kind === 'start' ? 'assessment.pass.start' : 'assessment.pass.complete') && e.context?.['pass'] === m.key)!;
      expect(engine.context).toMatchObject({ pass: m.key, name: m.name, num: m.num, pass_id: m.pass_id });
      expect(m.run_id).toBe(runStart.run_id);
      if (m.kind === 'done') expect(typeof m.duration_ms).toBe('number');
    }
    // The start marker precedes the operator line of its pass.
    const startInv = lines.findIndex((l) => l.startsWith('[pass-start] num=01'));
    expect(startInv).toBeGreaterThanOrEqual(0);
    expect(lines[startInv + 1]).toMatch(/Running Pass 01, inventory/);
  });

  it('writes no marker without the opt-in (piped stdout of another consumer)', () => {
    const env = { ...process.env, SWAO_LICENSE_TIER_OVERRIDE: 'community' };
    delete env['SWAO_PASS_MARKERS'];
    const r = spawnSync(process.execPath, [CLI, 'assess', '--app', 'webapp', '--workspace', ws, '--skip-llm', '--no-crawl', '--passes', 'inv'], {
      cwd: ws, encoding: 'utf-8', timeout: 240_000, env,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Running Pass 01/);
    expect(r.stdout).not.toMatch(/\[pass-(start|done)\]/);
  }, 300_000);
});
