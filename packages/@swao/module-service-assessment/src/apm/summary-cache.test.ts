// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4271: the per-app row cache of the portfolio summary rebuild.
// #4288: earlier run folders keep their apm-score.json untouched.
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump } from 'js-yaml';
import { buildPortfolioSummary, type PortfolioBuildProgress, type PortfolioBuildStats } from './score.js';
import { PORTFOLIO_ROW_CACHE_FILE, cacheKeyDifference, countPortfolioApps, fingerprintDifference, portfolioCacheKey, readPortfolioRowCacheDetailed, serviceAppFingerprint } from './summary-cache.js';
import { loadApmFramework } from './framework.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const NOW = new Date('2026-11-09T12:00:00Z');

function serviceApp(ws: string, id: string, eolMonths: number): void {
  const r = join(ws, 'apps', id, 'wsp', 'inputs', 'research');
  mkdirSync(r, { recursive: true });
  writeFileSync(join(ws, 'apps', id, '.swao.yml'), dump({ app_id: id, app_name: id.toUpperCase(), assessment: { type: 'service' }, vendor: { name: 'Example Vendor GmbH' }, disposition: { operational_status: 'active' } }));
  writeFileSync(join(r, 'cve-summary.md'), `---\n${dump({ topic: 'cve-summary', cve: { source: 'nvd', critical_count: 0, high_count: 1, kev_match: false } })}---\n`);
  writeFileSync(join(r, 'eol-status.md'), `---\n${dump({ topic: 'eol-status', eol: { source: 'endoflife.date', is_eol: false, months_until_eol: eolMonths } })}---\n`);
}

/** A finished service run: passes, manifest and the latest-service pointer. */
function serviceRun(ws: string, id: string, runId: string): string {
  const run = join(ws, 'apps', id, 'wsp', 'runs', runId);
  mkdirSync(join(run, 'passes'), { recursive: true });
  writeFileSync(join(run, 'passes', '01-data.yaml'), dump({ signals: [{ id: 'DATA-01', severity: 'low', outcome: 'positive', derivation: 'fixture' }] }));
  writeFileSync(join(run, 'run-manifest.json'), JSON.stringify({ assessed_at: NOW.toISOString() }));
  writeFileSync(join(ws, 'apps', id, 'wsp', 'latest-service.txt'), `runs/${runId}`);
  return run;
}

function workspace(n: number): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-4271-'));
  dirs.push(ws);
  writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
  for (let i = 0; i < n; i += 1) serviceApp(ws, `app${String(i).padStart(3, '0')}`, 24 + i);
  return ws;
}

const PAST = new Date('2026-01-01T00:00:00Z');
const strip = (s: ReturnType<typeof buildPortfolioSummary>) => ({ ...s, generated_at: '' });

describe('portfolio summary row cache (#4271)', () => {
  it('a warm rebuild serves every unchanged service app from the cache with the same summary', () => {
    const ws = workspace(12);
    const cold: PortfolioBuildProgress[] = [];
    const first = buildPortfolioSummary(ws, { now: NOW, onProgress: (p) => cold.push(p) });
    expect(existsSync(join(ws, PORTFOLIO_ROW_CACHE_FILE))).toBe(true);
    expect(cold.at(-1)).toEqual({ done: 12, total: 12, cached: 0 });

    const warm: PortfolioBuildProgress[] = [];
    const second = buildPortfolioSummary(ws, { now: NOW, onProgress: (p) => warm.push(p) });
    expect(warm.at(-1)).toEqual({ done: 12, total: 12, cached: 12 });
    expect(strip(second)).toEqual(strip(first));
  });

  it('recomputes only the app whose inputs changed (a new run of one app in a batch)', () => {
    const ws = workspace(8);
    buildPortfolioSummary(ws, { now: NOW });
    serviceRun(ws, 'app003', '2026-11-09T12-00-00');
    const progress: PortfolioBuildProgress[] = [];
    const s = buildPortfolioSummary(ws, { now: NOW, apmScoreFor: 'app003', onProgress: (p) => progress.push(p) });
    expect(progress.at(-1)).toEqual({ done: 8, total: 8, cached: 7 });
    const me = s.apps.find((a) => a.id === 'app003')!;
    expect(me.assessed).toBe(true);
    expect(me.run).toBe('runs/2026-11-09T12-00-00');
    // The cached result equals a full rebuild without the cache.
    expect(strip(buildPortfolioSummary(ws, { now: NOW, cache: false, write: false }))).toEqual(strip(s));
  });

  it('picks up a changed research stub of another app', () => {
    const ws = workspace(4);
    const before = buildPortfolioSummary(ws, { now: NOW }).apps.find((a) => a.id === 'app001')!;
    const stub = join(ws, 'apps', 'app001', 'wsp', 'inputs', 'research', 'cve-summary.md');
    writeFileSync(stub, `---\n${dump({ topic: 'cve-summary', cve: { source: 'nvd', critical_count: 0, high_count: 0, kev_match: true } })}---\n`);
    utimesSync(stub, NOW, new Date(NOW.getTime() + 5000));
    const after = buildPortfolioSummary(ws, { now: NOW }).apps.find((a) => a.id === 'app001')!;
    expect(before.time_quadrant).not.toBe('Migrate-Critical');
    expect(after.time_quadrant).toBe('Migrate-Critical');
    expect(after.kev_match).toBe(true);
  });

  // #4412 (owner decision 2026-11-16): evidence keyed by inputs, re-scored on every rebuild.
  it('stays warm on the next day and re-scores with the new date (no daily cold start)', () => {
    const ws = workspace(3);
    const yml = join(ws, 'apps', 'app001', '.swao.yml');
    writeFileSync(yml, dump({ app_id: 'app001', app_name: 'APP001', assessment: { type: 'service' }, vendor: { name: 'Example Vendor GmbH', contract_expiry: '2026-11-10' }, disposition: { operational_status: 'active' } }));
    const day1 = buildPortfolioSummary(ws, { now: NOW }).apps.find((a) => a.id === 'app001')!;
    let stats: PortfolioBuildStats | null = null;
    const nextDay = new Date('2026-11-11T12:00:00Z');
    const day2 = buildPortfolioSummary(ws, { now: nextDay, onStats: (s) => { stats = s; } }).apps.find((a) => a.id === 'app001')!;
    expect(stats!).toMatchObject({ cache: 'warm', service_rows_cached: 3, service_rows_computed: 0 });
    // The contract expired between the two days: the re-score sees it.
    expect(day2.domain_scores).not.toEqual(day1.domain_scores);
    // The warm re-score equals a fresh read on that day.
    expect(strip(buildPortfolioSummary(ws, { now: nextDay, write: false }))).toEqual(strip(buildPortfolioSummary(ws, { now: nextDay, cache: false, write: false })));
  });

  it('stays warm with another framework and scores with it', () => {
    const ws = workspace(3);
    const fw = loadApmFramework({ workspacePath: ws });
    const before = buildPortfolioSummary(ws, { now: NOW, framework: fw });
    const domains = Object.keys(fw.domainWeights) as Array<keyof typeof fw.domainWeights>;
    const skewed = { ...fw, domainWeights: Object.fromEntries(domains.map((d, i) => [d, i === 0 ? 90 : 1])) as typeof fw.domainWeights };
    let stats: PortfolioBuildStats | null = null;
    const after = buildPortfolioSummary(ws, { now: NOW, framework: skewed, onStats: (s) => { stats = s; } });
    expect(stats!).toMatchObject({ cache: 'warm', service_rows_computed: 0 });
    expect(after.apps.map((a) => a.risk_score)).not.toEqual(before.apps.map((a) => a.risk_score));
    expect(strip(after)).toEqual(strip(buildPortfolioSummary(ws, { now: NOW, framework: skewed, cache: false, write: false })));
  });

  it('a date value the YAML loader returns as Date scores the same from the cache as from the file', () => {
    const ws = workspace(2);
    const yml = join(ws, 'apps', 'app000', '.swao.yml');
    writeFileSync(yml, ['app_id: app000', 'app_name: APP000', 'assessment: { type: service }', 'vendor: { name: Example Vendor GmbH, contract_expiry: 2026-11-10 }', 'security: { last_audit_date: 2026-01-15 }', ''].join(String.fromCharCode(10)));
    const cold = buildPortfolioSummary(ws, { now: NOW });
    const warm = buildPortfolioSummary(ws, { now: NOW });
    expect(strip(warm)).toEqual(strip(cold));
    expect(strip(warm)).toEqual(strip(buildPortfolioSummary(ws, { now: NOW, cache: false, write: false })));
  });

  it('#4412: a changed research stub of one app reads only that app again; the others come from the cached evidence', () => {
    const ws = workspace(5);
    buildPortfolioSummary(ws, { now: NOW });
    const stub = join(ws, 'apps', 'app003', 'wsp', 'inputs', 'research', 'eol-status.md');
    writeFileSync(stub, `---\n${dump({ topic: 'eol-status', eol: { source: 'endoflife.date', is_eol: true } })}---\n`);
    utimesSync(stub, NOW, new Date(NOW.getTime() + 9000));
    let stats: PortfolioBuildStats | null = null;
    const s = buildPortfolioSummary(ws, { now: new Date('2026-11-12T08:00:00Z'), onStats: (x) => { stats = x; } });
    expect(stats!).toMatchObject({ cache: 'warm', service_rows_cached: 4, service_rows_computed: 1, rows_recomputed_by: { 'changed:eol-status.md': 1 } });
    expect(s.apps.find((a) => a.id === 'app003')!.eol_signal).not.toBe(s.apps.find((a) => a.id === 'app002')!.eol_signal);
  });

  it('a new app joins and a removed app leaves the summary', () => {
    const ws = workspace(3);
    buildPortfolioSummary(ws, { now: NOW });
    serviceApp(ws, 'app900', 30);
    rmSync(join(ws, 'apps', 'app000'), { recursive: true, force: true });
    const ids = buildPortfolioSummary(ws, { now: NOW }).apps.map((a) => a.id);
    expect(ids).toEqual(['app001', 'app002', 'app900']);
  });

  it('the fingerprint is stat-only and changes with a pass file of the run', () => {
    const ws = workspace(1);
    const run = serviceRun(ws, 'app000', '2026-11-09T10-00-00');
    const a = serviceAppFingerprint(ws, 'app000', 'runs/2026-11-09T10-00-00');
    writeFileSync(join(run, 'passes', '09-synth.yaml'), dump({ assessment: { seven_r_label: 'Rehost' } }));
    expect(serviceAppFingerprint(ws, 'app000', 'runs/2026-11-09T10-00-00')).not.toBe(a);
  });

  it('countPortfolioApps counts the app folders', () => {
    expect(countPortfolioApps(workspace(5))).toBe(5);
    expect(countPortfolioApps(join(tmpdir(), 'swao-4271-missing'))).toBe(0);
  });
});

describe('apm-score.json stays in its own run folder (#4288)', () => {
  it('two consecutive service runs: the first run folder is unchanged after the second', () => {
    const ws = workspace(3);
    const runA = serviceRun(ws, 'app000', '2026-11-09T15-14-37');
    buildPortfolioSummary(ws, { now: NOW, apmScoreFor: 'app000' });
    const scoreA = join(runA, 'apm-score.json');
    expect(existsSync(scoreA)).toBe(true);
    // Move the first run's files into the past so a rewrite is visible on any clock resolution.
    for (const f of ['apm-score.json', 'run-manifest.json']) utimesSync(join(runA, f), PAST, PAST);
    const before = { score: statSync(scoreA).mtimeMs, manifest: statSync(join(runA, 'run-manifest.json')).mtimeMs, content: readFileSync(scoreA, 'utf-8') };

    const runB = serviceRun(ws, 'app001', '2026-11-09T15-18-55');
    buildPortfolioSummary(ws, { now: NOW, apmScoreFor: 'app001' });
    expect(existsSync(join(runB, 'apm-score.json'))).toBe(true);
    expect(statSync(scoreA).mtimeMs).toBe(before.score);
    expect(statSync(join(runA, 'run-manifest.json')).mtimeMs).toBe(before.manifest);
    expect(readFileSync(scoreA, 'utf-8')).toBe(before.content);
  });

  it('a rebuild without apmScoreFor rewrites no existing apm-score.json', () => {
    const ws = workspace(2);
    const runA = serviceRun(ws, 'app000', '2026-11-09T15-14-37');
    buildPortfolioSummary(ws, { now: NOW, apmScoreFor: 'app000' });
    utimesSync(join(runA, 'apm-score.json'), PAST, PAST);
    const mtime = statSync(join(runA, 'apm-score.json')).mtimeMs;
    buildPortfolioSummary(ws, { now: NOW });
    expect(statSync(join(runA, 'apm-score.json')).mtimeMs).toBe(mtime);
  });

  it('the run that just finished gets a fresh apm-score.json', () => {
    const ws = workspace(1);
    const runA = serviceRun(ws, 'app000', '2026-11-09T15-14-37');
    buildPortfolioSummary(ws, { now: NOW, apmScoreFor: 'app000' });
    utimesSync(join(runA, 'apm-score.json'), PAST, PAST);
    buildPortfolioSummary(ws, { now: NOW, apmScoreFor: 'app000' });
    expect(statSync(join(runA, 'apm-score.json')).mtimeMs).toBeGreaterThan(PAST.getTime());
  });
});

describe('portfolio summary timing and cache causes (#4412)', () => {
  const PHASES = ['setup', 'discover_kinds', 'service_rows', 'application_rows', 'integration_graph', 'waves', 'vendors', 'write'];

  it('names every step with its wall clock and reports a cold rebuild with its cause', () => {
    const ws = workspace(5);
    const phases: string[] = [];
    let stats: PortfolioBuildStats | null = null;
    buildPortfolioSummary(ws, { now: NOW, onPhase: (p) => phases.push(p), onStats: (s) => { stats = s; } });
    expect(phases).toEqual(PHASES);
    expect(stats!).toMatchObject({ cache: 'cold', cache_miss_reason: 'absent', service_rows_cached: 0, service_rows_computed: 5, rows_recomputed_by: { no_row: 5 }, application_apps: 0 });
    expect(Object.keys(stats!.phases_ms)).toEqual(PHASES);
  });

  it('each cross-app step reports its start before its end, in order', () => {
    const ws = workspace(3);
    const seen: string[] = [];
    buildPortfolioSummary(ws, { now: NOW, onPhaseStart: (p) => seen.push(`start:${p}`), onPhase: (p) => seen.push(`end:${p}`) });
    expect(seen.filter((e) => e.startsWith('start:'))).toEqual(['integration_graph', 'waves', 'vendors', 'write'].map((p) => `start:${p}`));
    for (const p of ['integration_graph', 'waves', 'vendors', 'write']) {
      expect(seen.indexOf(`start:${p}`)).toBeLessThan(seen.indexOf(`end:${p}`));
      expect(seen.indexOf(`start:${p}`)).toBeGreaterThan(seen.indexOf('end:application_rows'));
    }
  });

  it('a warm rebuild after one changed app names the changed input', () => {
    const ws = workspace(6);
    buildPortfolioSummary(ws, { now: NOW });
    const yml = join(ws, 'apps', 'app002', '.swao.yml');
    writeFileSync(yml, `${readFileSync(yml, 'utf-8')}# edited\n`);
    utimesSync(yml, NOW, new Date(NOW.getTime() + 7000));
    let stats: PortfolioBuildStats | null = null;
    buildPortfolioSummary(ws, { now: NOW, onStats: (s) => { stats = s; } });
    expect(stats!).toMatchObject({ cache: 'warm', service_rows_cached: 5, service_rows_computed: 1, rows_recomputed_by: { 'changed:.swao.yml': 1 } });
    expect(stats!.cache_miss_reason).toBeUndefined();
  });

  it('a cache of an older version is cold with reason version; the injected clock times the steps', () => {
    const ws = workspace(2);
    buildPortfolioSummary(ws, { now: NOW });
    const file = join(ws, PORTFOLIO_ROW_CACHE_FILE);
    // The shape of the cache before #4412 (version 2, key version:framework:day).
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf-8')), version: 2, key: '2:abc:2026-11-09' }));
    let t = 0;
    let stats: PortfolioBuildStats | null = null;
    buildPortfolioSummary(ws, { now: new Date('2026-11-10T12:00:00Z'), clock: () => (t += 100), onStats: (s) => { stats = s; } });
    expect(stats!).toMatchObject({ cache: 'cold', cache_miss_reason: 'version', service_rows_computed: 2 });
    expect(Object.values(stats!.phases_ms).every((ms) => ms >= 100)).toBe(true);
  });

  it('the stats name the parts of setup and write and the bytes of the cache and summary files', () => {
    const ws = workspace(3);
    buildPortfolioSummary(ws, { now: NOW });
    let stats: PortfolioBuildStats | null = null;
    buildPortfolioSummary(ws, { now: NOW, onStats: (st) => { stats = st; } });
    expect(Object.keys(stats!.steps_ms).sort()).toEqual(['apm_scores', 'cache_key', 'cache_read', 'framework', 'integration_graph', 'lz_portfolio', 'row_cache', 'summary_file', 'summary_parse', 'wave_reports']);
    expect(stats!.bytes['row_cache_read']).toBe(statSync(join(ws, PORTFOLIO_ROW_CACHE_FILE)).size);
    expect(stats!.bytes['row_cache']).toBe(statSync(join(ws, PORTFOLIO_ROW_CACHE_FILE)).size);
    expect(stats!.bytes['summary_file']).toBe(statSync(join(ws, 'wsp', 'portfolio-summary.json')).size);
    // Without writes only the setup parts and the parse are timed.
    buildPortfolioSummary(ws, { now: NOW, write: false, onStats: (st) => { stats = st; } });
    expect(Object.keys(stats!.steps_ms).sort()).toEqual(['cache_key', 'cache_read', 'framework', 'lz_portfolio', 'summary_parse']);
  });

  it('the cache key is the cache version only (no framework, no day, no folder)', () => {
    expect(portfolioCacheKey()).toBe('v3');
  });

  it('cacheKeyDifference and fingerprintDifference name the differing part', () => {
    expect(cacheKeyDifference(portfolioCacheKey(), portfolioCacheKey())).toBeNull();
    expect(cacheKeyDifference('2:abc:2026-11-09', portfolioCacheKey())).toBe('version');
    expect(cacheKeyDifference(undefined, portfolioCacheKey())).toBe('version');
    expect(fingerprintDifference('a|b|c', 'a|b|c')).toBeNull();
    expect(fingerprintDifference('1|b|c', '2|b|c')).toBe('.swao.yml');
    expect(fingerprintDifference('a|1|c', 'a|2|c')).toBe('latest-service.txt');
    const many = (x: string) => ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', x].join('|');
    expect(fingerprintDifference(many('01.yaml=1'), many('01.yaml=2'))).toBe('passes');
  });

  it('readPortfolioRowCacheDetailed reports an absent and an unreadable cache', () => {
    const ws = workspace(0);
    expect(readPortfolioRowCacheDetailed(ws, 'k').miss).toBe('absent');
    mkdirSync(join(ws, 'wsp', 'cache'), { recursive: true });
    writeFileSync(join(ws, PORTFOLIO_ROW_CACHE_FILE), '{not json');
    expect(readPortfolioRowCacheDetailed(ws, 'k').miss).toBe('unreadable');
  });
});
