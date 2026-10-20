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

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { createPostRunTimer, rebuildPortfolioSummaryStep } from './post-run-timing.js';

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

  it('records a throwing step as error and re-throws', () => {
    const { timer, events } = harness([0, 5]);
    expect(() => timer.step('pii_scrub', () => { throw new Error('boom'); })).toThrow('boom');
    const done = events.find(e => e.code === 'assess.post_run.pii_scrub.complete' && e.scope === 'app')!;
    expect(done.level).toBe('warn');
    expect(done.context).toMatchObject({ status: 'error', duration_ms: 5 });
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
    for (const step of ['file_counts', 'run_manifest', 'run_context', 'scope_coverage', 'plan_derivation', 'findings', 'pii_scrub', 'assessment_counter', 'run_retention']) {
      expect(src).toContain(`postRun.step('${step}'`);
    }
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
    const done = events.find(e => e.code === 'assess.post_run.portfolio_summary.complete' && e.scope === 'app')!;
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
