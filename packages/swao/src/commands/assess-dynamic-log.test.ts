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

// #4272: dynamic.start is logged only when Pass 10 crawls, inside the run
// (after swao.run.start), with the Chromium path profile-relative; every
// Pass 10 log line carries the run_id; a run without a crawl writes a
// dynamic.skip with its reason, a service run (dynamic not applicable) none.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = readFileSync(join(HERE, 'assess.ts'), 'utf-8');

describe('Pass 10 event placement in assess.ts (#4272 source pin)', () => {
  it('writes dynamic.start once, after swao.run.start, inside the crawl branch', () => {
    const starts = [...SRC.matchAll(/'dynamic\.start'/g)];
    expect(starts).toHaveLength(1);
    const at = starts[0]!.index!;
    const appRunStart = SRC.indexOf("logApp(opts.app!, 'info', 'swao.run.start'");
    expect(appRunStart).toBeGreaterThan(0);
    expect(at).toBeGreaterThan(appRunStart);
    // The crawl branch: after the "Running Pass 10" console line, before the crawl starts.
    const crawlLine = SRC.indexOf("console.log('[info] Running Pass 10, dynamic_analysis (Playwright crawl)...')");
    expect(at).toBeGreaterThan(crawlLine);
    expect(at).toBeLessThan(SRC.indexOf('const crawlStart = Date.now();', crawlLine));
  });

  it('logs the Chromium path profile-relative and carries run_id on every Pass 10 line', () => {
    expect(SRC).toMatch(/chromium_path: shortenProfilePath\(chromiumPath\)/);
    expect(SRC).not.toMatch(/chromium_path: chromiumPath\b/);
    for (const code of ['dynamic.start', 'dynamic.complete', 'dynamic.error', 'dynamic.skip']) {
      const lines = SRC.split('\n').map((l, i) => ({ l, i })).filter(({ l }) => l.includes(`'${code}'`));
      expect(lines.length, code).toBeGreaterThan(0);
      for (const { i } of lines) {
        const window = SRC.split('\n').slice(i, i + 4).join('\n');
        expect(window, `${code} at line ${i + 1}`).toMatch(/run_id: runId/);
      }
    }
  });
});

// End-to-end through the CLI (dist-backed, skipped when dist is not built).
const CLI = join(HERE, '..', '..', 'dist', 'index.js');

describe.skipIf(!existsSync(CLI))('swao assess Pass 10 log lines (#4272)', () => {
  let ws: string;
  const assess = (app: string, extra: string[]) => spawnSync(process.execPath, [
    CLI, 'assess', '--app', app, '--workspace', ws, '--skip-llm', ...extra,
  ], { cwd: ws, encoding: 'utf-8', timeout: 240_000, env: { ...process.env, SWAO_LICENSE_TIER_OVERRIDE: 'community' } });
  const appEvents = (app: string) => {
    const logs = join(ws, 'apps', app, 'wsp', 'logs');
    return readdirSync(logs).filter(f => f.startsWith('app-events-'))
      .flatMap(f => readFileSync(join(logs, f), 'utf-8').split('\n').filter(Boolean))
      .map(l => JSON.parse(l) as { code: string; run_id?: string; context?: Record<string, unknown> });
  };

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'swao-dynamic-log-'));
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
    const app = join(ws, 'apps', 'webapp');
    mkdirSync(join(app, 'wsp', 'inputs', 'source'), { recursive: true });
    writeFileSync(join(app, '.swao.yml'), 'wsp_version: "0.9"\napp_id: webapp\nsource:\n  path: wsp/inputs/source/\n');
    writeFileSync(join(app, 'wsp', 'inputs', 'source', 'index.js'), "const http = require('http');\nhttp.createServer(() => {}).listen(8080);\n");
    const svc = join(ws, 'apps', 'hosapp001');
    mkdirSync(join(svc, 'ingestion', 'binary', 'config'), { recursive: true });
    writeFileSync(join(svc, '.swao.yml'), 'wsp_version: "0.9"\napp_id: hosapp001\nassessment:\n  type: service\nvendor_type: on-premises\n');
    writeFileSync(join(svc, 'ingestion', 'binary', 'config', 'app.ini'), 'hash=md5\n');
  });
  afterEach(() => { rmSync(ws, { recursive: true, force: true }); });

  it('a service run (dynamic not applicable) writes no dynamic.start and no dynamic.skip', () => {
    expect(assess('hosapp001', ['--passes', 'inv,dynamic']).status).toBe(0);
    const codes = appEvents('hosapp001').map(e => e.code);
    expect(codes).toContain('swao.run.start');
    expect(codes.filter(c => c.startsWith('dynamic.'))).toEqual([]);
  }, 300_000);

  it('an application run without a crawl target writes one dynamic.skip with the run_id and no dynamic.start', () => {
    expect(assess('webapp', ['--passes', 'inv,dynamic']).status).toBe(0);
    const ev = appEvents('webapp');
    const runStart = ev.findIndex(e => e.code === 'swao.run.start');
    expect(runStart).toBeGreaterThanOrEqual(0);
    expect(ev.some(e => e.code === 'dynamic.start')).toBe(false);
    const skips = ev.map((e, i) => ({ e, i })).filter(({ e }) => e.code === 'dynamic.skip');
    expect(skips).toHaveLength(1);
    expect(skips[0]!.i).toBeGreaterThan(runStart);
    expect(skips[0]!.e.run_id).toBe(ev[runStart]!.run_id);
    expect(skips[0]!.e.context).toMatchObject({ reason: 'no_target_url' });
  }, 300_000);
});
