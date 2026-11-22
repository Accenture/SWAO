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

// #3224: post-pass steps of `swao assess` log start/complete with duration_ms.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, chmodSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { tmpdir } from 'os';
import { createPostRunTimer, rebuildPortfolioSummaryStep, incrementAssessmentCounterStep, createPortfolioProgressLogger, createPortfolioPhaseLogger } from './post-run-timing.js';
import { LicenseGuard, _paths } from '../license/license-guard.js';

interface Ev { scope: 'app' | 'portfolio'; level: string; code: string; context: Record<string, unknown> }

function harness(ticks: number[]) {
  const events: Ev[] = [];
  let i = 0;
  const timer = createPostRunTimer({
    app: 'hosapp001',
    runId: 'run-1',
    assessmentType: 'service',
    now: () => ticks[Math.min(i++, ticks.length - 1)]!,
    logApp: ((_app: string, level: string, code: string, _m: string, o?: { context?: Record<string, unknown> }) => {
      events.push({ scope: 'app', level, code, context: o?.context ?? {} });
    }) as never,
    logPortfolio: ((level: string, code: string, _m: string, o?: { context?: Record<string, unknown> }) => {
      events.push({ scope: 'portfolio', level, code, context: o?.context ?? {} });
    }) as never,
  });
  return { timer, events };
}

describe('post-run step timing (#3224)', () => {
  it('logs start and complete with duration_ms and returns the step result', () => {
    const { timer, events } = harness([1000, 76000]);
    const out = timer.step('portfolio_summary', () => 42);
    expect(out).toBe(42);
    expect(events.map(e => `${e.scope}:${e.code}`)).toEqual([
      'app:assess.post_run.portfolio_summary.start',
      'app:assess.post_run.portfolio_summary.complete',
      'portfolio:assess.post_run.portfolio_summary.complete',
    ]);
    const done = events[1]!;
    expect(done.context).toMatchObject({ step: 'portfolio_summary', status: 'ok', duration_ms: 75000, run_id: 'run-1', assessment_type: 'service' });
    expect(events[2]!.context['app']).toBe('hosapp001');
  });

  it('records a throwing step as a .failed event (never .complete) and re-throws (#3440)', () => {
    const { timer, events } = harness([0, 5]);
    expect(() => timer.step('pii_scrub', () => { throw new Error('boom'); })).toThrow('boom');
    expect(events.map(e => `${e.scope}:${e.level}:${e.code}`)).toEqual([
      'app:info:assess.post_run.pii_scrub.start',
      'app:warn:assess.post_run.pii_scrub.failed',
      'portfolio:warn:assess.post_run.pii_scrub.failed',
    ]);
    expect(events.some(e => e.code.endsWith('.complete'))).toBe(false);
    expect(events[1]!.context).toMatchObject({ status: 'error', duration_ms: 5, error: 'boom' });
    expect(timer.summary().post_pass_steps).toEqual([{ step: 'pii_scrub', duration_ms: 5, status: 'error' }]);
  });

  it('a successful step carries no error field', () => {
    const { timer, events } = harness([0, 1]);
    timer.step('run_manifest', () => undefined);
    expect(events[1]!.context).not.toHaveProperty('error');
  });

  it('sums post_pass_ms across steps', () => {
    const { timer } = harness([0, 10, 10, 40, 40, 100]);
    timer.step('run_manifest', () => undefined);
    timer.step('portfolio_summary', () => undefined);
    timer.step('plan_derivation', () => undefined);
    const s = timer.summary();
    expect(s.post_pass_ms).toBe(100);
    expect(s.post_pass_steps.map(x => [x.step, x.duration_ms])).toEqual([
      ['run_manifest', 10], ['portfolio_summary', 30], ['plan_derivation', 60],
    ]);
  });

  it('a logger failure never breaks the step', () => {
    const timer = createPostRunTimer({
      app: 'a', runId: 'r', assessmentType: 'application',
      logApp: (() => { throw new Error('disk full'); }) as never,
      logPortfolio: (() => { throw new Error('disk full'); }) as never,
    });
    expect(timer.step('run_context', () => 'ok')).toBe('ok');
  });

  it('assess.ts wires every post-pass step and reports total wall clock in swao.run.complete', () => {
    const src = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'assess.ts'), 'utf-8');
    for (const step of ['file_counts', 'run_manifest', 'run_context', 'scope_coverage', 'plan_derivation', 'findings', 'pii_scrub', 'run_retention']) {
      expect(src).toContain(`postRun.step('${step}'`);
    }
    // #3440: the counter runs through the helper (one attempt, one warning on failure).
    expect(src).toContain('incrementAssessmentCounterStep(postRun, () => LicenseGuard.load().incrementAssessmentCount());');
    expect(src).not.toContain("postRun.step('assessment_counter'");
    // #3440: every lifetime-counter bump in assess.ts goes through the helper
    // (no bare incrementAssessmentCount() in an empty catch, LLM and LZ flows included).
    const bumps = src.match(/\.incrementAssessmentCount\(\)/g) ?? [];
    const helperCalls = src.match(/incrementAssessmentCounterStep\(/g) ?? [];
    expect(bumps.length).toBeGreaterThanOrEqual(3);
    expect(helperCalls.length).toBe(bumps.length);
    expect(src).not.toMatch(/try\s*\{\s*LicenseGuard\.load\(\)\.incrementAssessmentCount\(\);?\s*\}\s*catch/);
    expect(src).toContain("incrementAssessmentCounterStep(undefined, () => LicenseGuard.load().incrementAssessmentCount(), undefined, { app: llmAppId, assessmentType: 'llm' });");
    expect(src).toContain("incrementAssessmentCounterStep(undefined, () => LicenseGuard.load().incrementAssessmentCount(), undefined, { app: opts.app!, assessmentType: 'landing-zone-catalog' });");
    // #3309: portfolio_summary runs through the helper once the run is closed.
    expect(src).toContain('rebuildPortfolioSummaryStep(postRun, runLifecycle.status,');
    expect(src).toMatch(/duration_ms: totalDurationMs,\s*\n\s*passes_duration_ms: durationMs,\s*\n\s*post_pass_ms:/);
  });
});

describe('portfolio summary rebuild after a closed run (#3309)', () => {
  it('rebuilds after a complete or partial run as the logged step portfolio_summary', () => {
    for (const status of ['complete', 'partial'] as const) {
      const { timer, events } = harness([0, 20]);
      expect(rebuildPortfolioSummaryStep(timer, status, () => ({ apps: 3 }))).toEqual({ apps: 3 });
      expect(events.map(e => `${e.scope}:${e.code}`)).toEqual([
        'app:assess.post_run.portfolio_summary.start',
        'app:assess.post_run.portfolio_summary.complete',
        'portfolio:assess.post_run.portfolio_summary.complete',
      ]);
      expect(timer.summary().post_pass_steps).toEqual([{ step: 'portfolio_summary', duration_ms: 20, status: 'ok' }]);
    }
  });

  it('skips the rebuild when the run is not closed complete or partial', () => {
    for (const status of [undefined, 'started', 'failed', 'aborted'] as const) {
      const { timer, events } = harness([0]);
      let built = false;
      expect(rebuildPortfolioSummaryStep(timer, status, () => { built = true; return 1; })).toBeNull();
      expect(built).toBe(false);
      expect(events).toEqual([]);
      expect(timer.summary().post_pass_steps).toEqual([]);
    }
  });

  it('a failing rebuild is a warning and an error step, never a throw', () => {
    const { timer, events } = harness([0, 7]);
    const warnings: string[] = [];
    expect(rebuildPortfolioSummaryStep(timer, 'complete', () => { throw new Error('schema mismatch'); }, (l) => warnings.push(l))).toBeNull();
    expect(warnings).toEqual(['[warn] Portfolio summary not updated: schema mismatch']);
    const done = events.find(e => e.code === 'assess.post_run.portfolio_summary.failed' && e.scope === 'app')!;
    expect(done.level).toBe('warn');
    expect(timer.summary().post_pass_steps).toEqual([{ step: 'portfolio_summary', duration_ms: 7, status: 'error' }]);
  });

  it('assess.ts rebuilds after runLifecycle.complete for application and service runs, and after LZ catalogue runs on application apps', () => {
    const src = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'assess.ts'), 'utf-8');
    const close = src.indexOf('runLifecycle.complete({ failedPasses');
    const rebuild = src.indexOf('rebuildPortfolioSummaryStep(postRun, runLifecycle.status,');
    const runComplete = src.indexOf('const postRunSummary = postRun.summary();');
    expect(close).toBeGreaterThan(0);
    expect(rebuild).toBeGreaterThan(close);
    expect(runComplete).toBeGreaterThan(rebuild);
    // Not inside the service-only block any more.
    expect(src).not.toContain("postRun.step('portfolio_summary'");
    // LZ catalogue: rebuild on application apps, before the lz.assessment.complete close event.
    const lzRebuild = src.indexOf('rebuildPortfolioSummaryStep(lzPostRun, lzRunStatus,');
    expect(lzRebuild).toBeGreaterThan(src.indexOf('const lzRunStatus ='));
    expect(lzRebuild).toBeLessThan(src.indexOf("'lz.assessment.complete'"));
    expect(src).toMatch(/discoverApplicationApps\(workspaceRoot\)\.some\(\(a\) => a\.appId === opts\.app\)\)[\s\S]{0,300}rebuildPortfolioSummaryStep\(lzPostRun, lzRunStatus,/);
  });
});

describe('portfolio_summary start context and progress (#4271)', () => {
  it('the start event carries apps_total', () => {
    const { timer, events } = harness([0, 10]);
    rebuildPortfolioSummaryStep(timer, 'complete', () => 1, () => {}, { apps_total: 235 });
    expect(events[0]!.code).toBe('assess.post_run.portfolio_summary.start');
    expect(events[0]!.context).toMatchObject({ step: 'portfolio_summary', apps_total: 235, run_id: 'run-1' });
  });

  it('logs progress at most once per interval and never for the last app', () => {
    const events: Ev[] = [];
    let t = 0;
    const progress = createPortfolioProgressLogger({
      app: 'hosapp001', runId: 'run-1', assessmentType: 'service', intervalMs: 10_000, now: () => t,
      logApp: ((_a: string, level: string, code: string, _m: string, o?: { context?: Record<string, unknown> }) => { events.push({ scope: 'app', level, code, context: o?.context ?? {} }); }) as never,
      logPortfolio: ((level: string, code: string, _m: string, o?: { context?: Record<string, unknown> }) => { events.push({ scope: 'portfolio', level, code, context: o?.context ?? {} }); }) as never,
    });
    // 235 apps at 0.7 s each: a 164 s cold rebuild.
    for (let done = 1; done <= 235; done += 1) { t = done * 700; progress({ done, total: 235, cached: 0 }); }
    const app = events.filter((e) => e.scope === 'app');
    expect(app.length).toBe(15);
    expect(app.every((e) => e.code === 'assess.post_run.portfolio_summary.progress')).toBe(true);
    expect(app[0]!.context).toMatchObject({ apps_done: 15, apps_total: 235, apps_cached: 0, step: 'portfolio_summary' });
    expect(events.filter((e) => e.scope === 'portfolio')[0]!.context['app']).toBe('hosapp001');
  });

  it('a fast rebuild writes no progress line', () => {
    const events: unknown[] = [];
    let t = 0;
    const progress = createPortfolioProgressLogger({ app: 'a', runId: 'r', assessmentType: 'service', now: () => t, logApp: (() => events.push(1)) as never, logPortfolio: (() => events.push(1)) as never });
    for (let done = 1; done <= 235; done += 1) { t = done * 3; progress({ done, total: 235, cached: done }); }
    expect(events).toEqual([]);
  });

  it('assess.ts passes the run app, the progress logger and apps_total to the rebuild', () => {
    const src = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'assess.ts'), 'utf-8');
    expect(src).toContain('buildPortfolioSummary(workspaceRoot, { apmScoreFor: opts.app, onProgress: portfolioProgress, onPhase: portfolioPhase, onPhaseStart: portfolioPhase.start, onStats: (s) => { portfolioStats = s; } })');
    expect(src).toContain('{ apps_total: countPortfolioApps(workspaceRoot) }');
  });
});

describe('assessment counter post-run step (#3440)', () => {
  // A read-only state file makes writeFileSync fail (EPERM on Windows, EACCES
  // on POSIX) while reads still succeed. root ignores the mode bits.
  const runsAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const saved = { ..._paths };
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'swao-3440-'));
    _paths.statePath = join(dir, 'licence-state.json');
    _paths.licensePath = join(dir, 'licence.json');
    _paths.legacyLicencePath = join(dir, 'licence-legacy.json');
  });

  afterEach(() => {
    try { chmodSync(dir, 0o755); } catch { /* already removed */ }
    try { chmodSync(_paths.statePath, 0o644); } catch { /* not created */ }
    Object.assign(_paths, saved);
    rmSync(dir, { recursive: true, force: true });
  });

  const count = (): number => (JSON.parse(readFileSync(_paths.statePath, 'utf-8')) as { assessment_count: number }).assessment_count;

  it('a successful write logs .complete, no warning, and counts the run once', () => {
    LicenseGuard.load();
    const { timer, events } = harness([0, 3]);
    const warnings: string[] = [];
    expect(incrementAssessmentCounterStep(timer, () => LicenseGuard.load().incrementAssessmentCount(), (l) => warnings.push(l))).toBe(true);
    expect(count()).toBe(1);
    expect(warnings).toEqual([]);
    expect(events.map(e => `${e.scope}:${e.code}`)).toEqual([
      'app:assess.post_run.assessment_counter.start',
      'app:assess.post_run.assessment_counter.complete',
      'portfolio:assess.post_run.assessment_counter.complete',
    ]);
  });

  it.skipIf(runsAsRoot)('a failed write logs .failed, warns once, never throws, and leaves the count accurate', () => {
    // Two counted runs before the failure.
    LicenseGuard.load().incrementAssessmentCount();
    LicenseGuard.load().incrementAssessmentCount();
    expect(count()).toBe(2);

    // #3440: the state write is temp file + rename. A read-only file alone
    // still blocks it on Windows (EPERM on the rename); on POSIX the rename
    // depends on the directory, so the directory is made read-only too.
    chmodSync(_paths.statePath, 0o444);
    if (process.platform !== 'win32') chmodSync(dir, 0o555);
    const { timer, events } = harness([0, 4]);
    const warnings: string[] = [];
    let attempts = 0;
    const ok = incrementAssessmentCounterStep(timer, () => { attempts++; LicenseGuard.load().incrementAssessmentCount(); }, (l) => warnings.push(l));

    expect(ok).toBe(false);
    expect(attempts).toBe(1); // no retry, so no double count
    expect(count()).toBe(2); // the failed run is not counted; earlier counts are intact
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^\[warn\] Lifetime assessment counter not updated, this run is not counted: /);
    expect(events.map(e => `${e.scope}:${e.level}:${e.code}`)).toEqual([
      'app:info:assess.post_run.assessment_counter.start',
      'app:warn:assess.post_run.assessment_counter.failed',
      'portfolio:warn:assess.post_run.assessment_counter.failed',
    ]);
    expect(events[1]!.context).toMatchObject({ step: 'assessment_counter', status: 'error' });
    expect(String(events[1]!.context['error'])).not.toBe('');

    // The next run, once the file is writable again, counts exactly one more.
    if (process.platform !== 'win32') chmodSync(dir, 0o755);
    chmodSync(_paths.statePath, 0o644);
    const next = harness([0, 1]);
    expect(incrementAssessmentCounterStep(next.timer, () => LicenseGuard.load().incrementAssessmentCount(), () => undefined)).toBe(true);
    expect(count()).toBe(3);
  });
});

describe('assessment counter without a post-run timer (#3440: LLM and LZ catalogue flows)', () => {
  function sink() {
    const events: Ev[] = [];
    return {
      events,
      logApp: ((_app: string, level: string, code: string, _m: string, o?: { context?: Record<string, unknown> }) => {
        events.push({ scope: 'app', level, code, context: o?.context ?? {} });
      }) as never,
      logPortfolio: ((level: string, code: string, _m: string, o?: { context?: Record<string, unknown> }) => {
        events.push({ scope: 'portfolio', level, code, context: o?.context ?? {} });
      }) as never,
    };
  }

  it('success: counts, no events, no warning', () => {
    const { events, logApp, logPortfolio } = sink();
    const warnings: string[] = [];
    let n = 0;
    expect(incrementAssessmentCounterStep(undefined, () => { n++; }, (l) => warnings.push(l), { app: 'app1', assessmentType: 'llm', logApp, logPortfolio })).toBe(true);
    expect(n).toBe(1);
    expect(events).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('failure: one attempt, logs .failed on app and portfolio scope, warns once, never throws', () => {
    const { events, logApp, logPortfolio } = sink();
    const warnings: string[] = [];
    let attempts = 0;
    const ok = incrementAssessmentCounterStep(undefined, () => { attempts++; throw new Error('EPERM: locked'); }, (l) => warnings.push(l), { app: 'app1', assessmentType: 'landing-zone-catalog', logApp, logPortfolio });
    expect(ok).toBe(false);
    expect(attempts).toBe(1);
    expect(warnings).toEqual(['[warn] Lifetime assessment counter not updated, this run is not counted: EPERM: locked']);
    expect(events.map(e => `${e.scope}:${e.level}:${e.code}`)).toEqual([
      'app:warn:assess.post_run.assessment_counter.failed',
      'portfolio:warn:assess.post_run.assessment_counter.failed',
    ]);
    expect(events[0]!.context).toMatchObject({ step: 'assessment_counter', status: 'error', assessment_type: 'landing-zone-catalog', error: 'EPERM: locked' });
    expect(events[1]!.context['app']).toBe('app1');
  });
});

describe('portfolio_summary phases and cache context (#4412)', () => {
  it('the complete event carries the context of the build (cache state, phases)', () => {
    const { timer, events } = harness([0, 35_390]);
    rebuildPortfolioSummaryStep(timer, 'complete', () => 1, () => {}, { apps_total: 235 }, () => ({ cache: 'cold', cache_miss_reason: 'framework', phases_ms: { application_rows: 24_000 } }));
    const done = events.find((e) => e.code === 'assess.post_run.portfolio_summary.complete')!;
    expect(done.context).toMatchObject({ status: 'ok', duration_ms: 35_390, cache: 'cold', cache_miss_reason: 'framework', phases_ms: { application_rows: 24_000 } });
  });

  it('a step of 1 s or more logs its own phase line, a short one none', () => {
    const events: Array<{ code: string; context: Record<string, unknown> }> = [];
    const phase = createPortfolioPhaseLogger({
      app: 'svc001', runId: 'run-1', assessmentType: 'service',
      logApp: ((_a: string, _l: string, code: string, _m: string, o?: { context?: Record<string, unknown> }) => { events.push({ code, context: o?.context ?? {} }); }) as never,
      logPortfolio: (() => {}) as never,
    });
    phase('service_rows', 400);
    phase('application_rows', 24_980);
    expect(events).toEqual([{ code: 'assess.post_run.portfolio_summary.phase', context: { run_id: 'run-1', assessment_type: 'service', step: 'portfolio_summary', phase: 'application_rows', duration_ms: 24_980 } }]);
  });

  it('a cross-app step logs its start, and then always its phase line, even when short (#4412)', () => {
    const events: Array<{ code: string; context: Record<string, unknown> }> = [];
    const phase = createPortfolioPhaseLogger({
      app: 'svc001', runId: 'run-1', assessmentType: 'service',
      logApp: ((_a: string, _l: string, code: string, _m: string, o?: { context?: Record<string, unknown> }) => { events.push({ code, context: o?.context ?? {} }); }) as never,
      logPortfolio: (() => {}) as never,
    });
    phase.start('integration_graph');
    phase('integration_graph', 25_000);
    phase.start('waves');
    phase('waves', 120);
    phase('vendors', 120);
    expect(events.map((e) => `${e.code}:${String(e.context['phase'])}`)).toEqual([
      'assess.post_run.portfolio_summary.phase.start:integration_graph',
      'assess.post_run.portfolio_summary.phase:integration_graph',
      'assess.post_run.portfolio_summary.phase.start:waves',
      'assess.post_run.portfolio_summary.phase:waves',
    ]);
  });
});

describe('post-pass step lines on stdout (#4498)', () => {
  it('a step prints its name when it starts; the portfolio progress prints "n of m apps" at most every second', () => {
    const printed: string[] = [];
    const noop = (() => undefined) as never;
    const timer = createPostRunTimer({ app: 'a', runId: 'r', assessmentType: 'application', logApp: noop, logPortfolio: noop, print: (l) => printed.push(l) });
    timer.step('portfolio_summary', () => 1);
    expect(printed).toEqual(['[post] Portfolio summary']);
    let t = 0;
    const progress = createPortfolioProgressLogger({ app: 'a', runId: 'r', assessmentType: 'application', now: () => t, logApp: noop, logPortfolio: noop, print: (l) => printed.push(l) });
    progress({ done: 1, total: 235, cached: 0 });
    t = 500; progress({ done: 50, total: 235, cached: 0 });
    t = 1200; progress({ done: 106, total: 235, cached: 0 });
    expect(printed.slice(1)).toEqual(['[post] Portfolio summary: 1 of 235 apps', '[post] Portfolio summary: 106 of 235 apps']);
    const silent = createPostRunTimer({ app: 'a', runId: 'r', assessmentType: 'application', logApp: noop, logPortfolio: noop });
    silent.step('findings', () => 1);
    expect(printed).toHaveLength(3);
  });
});
