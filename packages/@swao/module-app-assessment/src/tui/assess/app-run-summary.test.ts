// #4301: assess.app.complete context keys of the TUI app run.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { APP_RUN_CALLER, createAppRunSummary, readLatestRunId, readRunType } from './app-run-summary.js';
import { formatPassMarker } from '@swao/core';
import { createPassLineTracker } from './pass-line-tracker.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('createAppRunSummary (#4301)', () => {
  it('pins the context keys: caller, exit_code, status, run_id, duration_ms, passes, signals', () => {
    const times = [0, 125_000];
    const s = createAppRunSummary('static,security,dynamic', () => times.shift() ?? 0);
    s.observe({ code: 'assess.app.pass.start', message: '', context: { pass: 'static', run_id: '2026-11-10T08-53-21' } });
    s.observe({ code: 'assess.app.pass.complete', message: '', context: { pass: 'static', status: 'ok', signals: 40, run_id: '2026-11-10T08-53-21' } });
    s.observe({ code: 'assess.app.pass.complete', message: '', context: { pass: 'security', status: 'failed', signals: 2 } });
    const done = s.complete(0, 'ignored-when-markers-name-the-run');
    expect(Object.keys(done.context).sort()).toEqual(['assessment_type', 'caller', 'duration_ms', 'exit_code', 'passes_failed', 'passes_not_run', 'passes_requested', 'passes_run', 'run_id', 'signals', 'status']);
    expect(done.context).toEqual({
      caller: APP_RUN_CALLER, assessment_type: 'application', exit_code: 0, status: 'complete', run_id: '2026-11-10T08-53-21', duration_ms: 125_000,
      passes_requested: 3, passes_run: 2, passes_not_run: ['dynamic'], passes_failed: ['security'], signals: 42,
    });
    expect(done.level).toBe('info');
    expect(done.message).toBe('Application assessment complete: 2 of 3 pass(es) run, 42 signal(s), 2.1 min');
  });

  it('a failed run warns, says the exit code and does not borrow the previous run id', () => {
    const s = createAppRunSummary('static', () => 0);
    const done = s.complete(1, 'previous-run');
    expect(done.level).toBe('warn');
    expect(done.context).toMatchObject({ exit_code: 1, status: 'failed', passes_run: 0, passes_not_run: ['static'], signals: 0 });
    expect(done.context['run_id']).toBeUndefined();
    expect(done.message).toContain('ended with exit code 1');
    expect(createAppRunSummary('static', () => 0).complete(0, 'run-a').context['run_id']).toBe('run-a');
  });

  it('works with the events of the pass tracker (marker lines)', () => {
    const tracker = createPassLineTracker(() => 0);
    const s = createAppRunSummary('inv,dynamic', () => 0);
    const lines = [
      formatPassMarker({ kind: 'start', num: '01', key: 'inv', name: 'inventory', pass_id: 'p1', run_id: 'r1' }),
      formatPassMarker({ kind: 'done', num: '01', key: 'inv', name: 'inventory', pass_id: 'p1', run_id: 'r1', status: 'degraded', signals: 5 }),
    ];
    for (const line of lines) for (const ev of tracker.consume(line).events) s.observe(ev);
    expect(s.complete(0).context).toMatchObject({ run_id: 'r1', passes_run: 1, passes_not_run: ['dynamic'], signals: 5 });
    expect(s.complete(0).context['passes_failed']).toBeUndefined();
  });

  it('compares pass keys case-insensitively and de-duplicates the request (the CLI lowercases --passes)', () => {
    const s = createAppRunSummary('INV,inv,Dynamic', () => 0);
    s.observe({ code: 'assess.app.pass.complete', message: '', context: { pass: 'inv', status: 'ok', signals: 1 } });
    expect(s.complete(0).context).toMatchObject({ passes_requested: 2, passes_run: 1, passes_not_run: ['dynamic'] });
  });

  it('readLatestRunId returns the folder name of wsp/latest.txt', () => {
    const d = mkdtempSync(join(tmpdir(), 'swao-app-run-'));
    tmp.push(d);
    expect(readLatestRunId(d)).toBeNull();
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'latest.txt'), 'runs/2026-11-10T08-53-21\n');
    expect(readLatestRunId(d)).toBe('2026-11-10T08-53-21');
  });
});

describe('the run type comes from the run (#4400)', () => {
  it('a service run is named a service assessment', () => {
    const done = createAppRunSummary('ctx', () => 0).complete(0, 'r1', 'service');
    expect(done.message).toMatch(/^Service assessment complete/);
    expect(done.context['assessment_type']).toBe('service');
  });

  it('readRunType reads assessment_type of run-status.json, application otherwise', () => {
    const d = mkdtempSync(join(tmpdir(), 'swao-run-type-'));
    tmp.push(d);
    mkdirSync(join(d, 'runs', 'r1'), { recursive: true });
    writeFileSync(join(d, 'runs', 'r1', 'run-status.json'), JSON.stringify({ assessment_type: 'service' }));
    expect(readRunType(d, 'r1')).toBe('service');
    expect(readRunType(d, 'missing')).toBe('application');
    expect(readRunType(d, null)).toBe('application');
  });
});

describe('#4464 the run summary counts the Pass 10 signals', () => {
  it('a pass.complete sequence including Pass 10 gives the manifest total', () => {
    const passes = [['01', 'inv', 7], ['04', 'ctx', 6], ['10', 'dynamic', 7], ['11', 'comp', 45]] as const;
    const summary = createAppRunSummary(passes.map(p => p[1]).join(','), () => 0);
    const tracker = createPassLineTracker(() => 0);
    for (const [num, key, signals] of passes) {
      const line = formatPassMarker({ kind: 'done', num, key, name: key, pass_id: `r-p${num}`, status: 'ok', duration_ms: 1, signals });
      for (const ev of tracker.consume(line).events) summary.observe({ code: ev.code, context: ev.context });
    }
    const done = summary.complete(0, 'r');
    expect(done.message).toContain('65 signal(s)');
  });
});
