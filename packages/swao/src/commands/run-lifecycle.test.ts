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

// #3283: shared run lifecycle (run-status.json) for application, service and
// LZ runs, including injected failures for application and service runs.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunStatusSchema, type RunStatus } from '@swao/core';
import { createRunLifecycle, type RunAssessmentType } from './run-lifecycle.js';
import { selectRunsToDelete } from './run-retention.js';

type Handler = (arg?: unknown) => void;

function fakeProc() {
  const handlers = new Map<string, Handler>();
  const proc = {
    once: vi.fn((ev: string, fn: Handler) => { handlers.set(ev, fn); return proc; }),
    on: vi.fn((ev: string, fn: Handler) => { handlers.set(ev, fn); return proc; }),
    prependOnceListener: vi.fn((ev: string, fn: Handler) => { handlers.set(ev, fn); return proc; }),
    removeListener: vi.fn((ev: string) => { handlers.delete(ev); return proc; }),
    exit: vi.fn(),
  };
  return { proc, handlers };
}

describe('createRunLifecycle (#3283)', () => {
  let runDir: string;
  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), 'swao-run-lifecycle-'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); rmSync(runDir, { recursive: true, force: true }); });

  const marker = (): RunStatus => RunStatusSchema.parse(JSON.parse(readFileSync(join(runDir, 'run-status.json'), 'utf-8')));
  const make = (assessmentType: RunAssessmentType, onFail = vi.fn()) => {
    const { proc, handlers } = fakeProc();
    const lc = createRunLifecycle({
      assessmentType, app: 'demo', runDir, startedAt: new Date('2026-10-17T10:00:00.000Z'), swaoVersion: '1.4.0', proc: proc as never, onFail,
    });
    return { lc, proc, handlers, onFail };
  };

  for (const type of ['application', 'service'] as const) {
    it(`${type}: started -> complete, valid against the core schema`, () => {
      const { lc } = make(type);
      lc.markStarted();
      expect(marker()).toMatchObject({ assessment_type: type, status: 'started', run_id: '2026-10-17T10:00:00.000Z' });
      lc.complete();
      expect(marker()).toMatchObject({ status: 'complete', exit_code: 0 });
      expect(lc.status).toBe('complete');
    });

    it(`${type}: failed passes close the run as partial with the exit code`, () => {
      const { lc } = make(type);
      lc.markStarted();
      lc.complete({ failedPasses: ['compliance'], exitCode: 1 });
      expect(marker()).toMatchObject({ status: 'partial', exit_code: 1, failed_passes: ['compliance'] });
    });

    it(`${type}: #3436 a degraded compliance pass closes the run partial with degraded_passes, exit code unchanged`, () => {
      const { lc } = make(type);
      lc.markStarted();
      lc.complete({
        degradedPasses: [{ pass: 'comp', num: '11', name: 'compliance_evaluation', reason: 'llm_unavailable', regimes: [{ id: 'gdpr', controls_without_verdict: 6 }] }],
        exitCode: 0,
      });
      const m = marker();
      expect(m).toMatchObject({ schema_version: '1.1', status: 'partial', exit_code: 0 });
      expect(m.degraded_passes).toEqual([{ pass: 'comp', num: '11', name: 'compliance_evaluation', reason: 'llm_unavailable', regimes: [{ id: 'gdpr', controls_without_verdict: 6 }] }]);
      expect(m.failed_passes).toBeUndefined();
    });

    it(`${type}: injected process.exit(6) before completion closes the run as failed`, () => {
      const { lc, handlers, onFail } = make(type);
      lc.markStarted();
      lc.installProcessGuards();
      handlers.get('exit')!(6);
      expect(marker()).toMatchObject({ status: 'failed', exit_code: 6, reason: 'process exited with code 6 before the run completed' });
      expect(onFail).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', exitCode: 6 }), expect.anything());
      expect(handlers.size).toBe(0);
    });

    it(`${type}: injected uncaught exception fails with exit 1; SIGINT aborts with 130`, () => {
      const a = make(type);
      a.lc.markStarted();
      a.lc.installProcessGuards();
      a.handlers.get('uncaughtException')!(new Error('pass exploded'));
      expect(a.proc.exit).toHaveBeenCalledWith(1);
      expect(marker()).toMatchObject({ status: 'failed', exit_code: 1, reason: 'uncaught: pass exploded' });

      const b = make(type);
      b.lc.markStarted();
      b.lc.installProcessGuards();
      b.handlers.get('SIGINT')!();
      expect(b.proc.exit).toHaveBeenCalledWith(130);
      expect(marker()).toMatchObject({ status: 'aborted', exit_code: 130, reason: 'SIGINT' });
    });
  }

  it('closing is idempotent and complete() disposes the guards (a later exit does not overwrite)', () => {
    const { lc, handlers, onFail } = make('application');
    lc.markStarted();
    lc.installProcessGuards();
    lc.complete();
    expect(handlers.size).toBe(0);
    lc.fail({ status: 'failed', reason: 'late', exitCode: 1 });
    expect(onFail).not.toHaveBeenCalled();
    expect(marker().status).toBe('complete');
  });

  it('LZ extras (targets) are written on every update', () => {
    const { proc } = fakeProc();
    const lc = createRunLifecycle({
      assessmentType: 'landing-zone-catalog', app: 'demo', runDir, startedAt: new Date(), swaoVersion: '1.4.0', proc: proc as never,
      extra: { targets: ['aws:eu-central-1'] },
    });
    lc.markStarted();
    lc.complete({ failedTargets: [{ provider: 'azure', region: 'Atlantis', reason: 'unknown region' }] });
    expect(marker()).toMatchObject({ status: 'partial', targets: ['aws:eu-central-1'], failed_targets: [{ provider: 'azure', region: 'Atlantis' }] });
  });
});

// #3306: the inline LZ catalogue fit of an application run records its targets
// after the marker was started.
describe('createRunLifecycle recordTargets (#3306)', () => {
  let runDir: string;
  beforeEach(() => { runDir = mkdtempSync(join(tmpdir(), 'swao-run-lifecycle-rec-')); });
  afterEach(() => { vi.restoreAllMocks(); rmSync(runDir, { recursive: true, force: true }); });

  const marker = (): RunStatus => RunStatusSchema.parse(JSON.parse(readFileSync(join(runDir, 'run-status.json'), 'utf-8')));
  const make = () => {
    const { proc, handlers } = fakeProc();
    const lc = createRunLifecycle({
      assessmentType: 'application', app: 'demo', runDir, startedAt: new Date('2026-10-18T10:00:00.000Z'), swaoVersion: '1.4.0', proc: proc as never,
    });
    return { lc, handlers };
  };
  const resolved = [{ requested: 'azure:Europe', resolved: 'azure:germanywestcentral', geography: 'europe' }];
  const skipped = [{ provider: 'aws', region: 'Atlantis', reason: 'Region "Atlantis" not found' }];

  it('writes targets and resolved_targets to the open marker at once', () => {
    const { lc } = make();
    lc.markStarted();
    lc.recordTargets({ targets: ['azure:germanywestcentral'], resolvedTargets: resolved });
    expect(marker()).toMatchObject({ status: 'started', targets: ['azure:germanywestcentral'], resolved_targets: resolved });
  });

  it('skipped targets close the application run partial, with targets kept', () => {
    const { lc } = make();
    lc.markStarted();
    lc.recordTargets({ targets: ['azure:germanywestcentral', 'aws:Atlantis'], resolvedTargets: resolved, failedTargets: skipped });
    lc.complete({ exitCode: 0 });
    expect(marker()).toMatchObject({
      status: 'partial', exit_code: 0,
      targets: ['azure:germanywestcentral', 'aws:Atlantis'], resolved_targets: resolved, failed_targets: skipped,
    });
  });

  it('skipped targets and failed passes are both reported', () => {
    const { lc } = make();
    lc.markStarted();
    lc.recordTargets({ targets: ['aws:Atlantis'], failedTargets: skipped });
    lc.complete({ failedPasses: ['compliance'], exitCode: 1 });
    expect(marker()).toMatchObject({ status: 'partial', failed_targets: skipped, failed_passes: ['compliance'] });
  });

  it('only resolved targets (no skips) keep the run complete', () => {
    const { lc } = make();
    lc.markStarted();
    lc.recordTargets({ targets: ['azure:germanywestcentral'], resolvedTargets: resolved, failedTargets: [] });
    lc.complete();
    const m = marker();
    expect(m.status).toBe('complete');
    expect(m.resolved_targets).toEqual(resolved);
    expect(m.failed_targets).toBeUndefined();
  });

  it('a later process exit keeps the recorded targets on the failed marker', () => {
    const { lc, handlers } = make();
    lc.markStarted();
    lc.installProcessGuards();
    lc.recordTargets({ targets: ['aws:Atlantis'], failedTargets: skipped });
    handlers.get('exit')!(6);
    expect(marker()).toMatchObject({ status: 'failed', exit_code: 6, targets: ['aws:Atlantis'], failed_targets: skipped });
  });

  it('is ignored once the run is closed', () => {
    const { lc } = make();
    lc.markStarted();
    lc.complete();
    lc.recordTargets({ targets: ['aws:Atlantis'], failedTargets: skipped });
    const m = marker();
    expect(m.status).toBe('complete');
    expect(m.targets).toBeUndefined();
  });
});

describe('selectRunsToDelete (#3283 retention)', () => {
  const runs = ['2026-10-01T00-00-00', '2026-10-02T00-00-00', '2026-10-03T00-00-00', '2026-10-04T00-00-00', '2026-10-05T00-00-00'];
  it('keeps the N latest usable runs; failed runs do not count and newer failed runs stay', () => {
    const failed = new Set(['2026-10-04T00-00-00']);
    expect(selectRunsToDelete([...runs, 'notes'], { keepLatest: 2, currentRun: '2026-10-05T00-00-00', isUsable: (n) => !failed.has(n) }))
      .toEqual(['2026-10-01T00-00-00', '2026-10-02T00-00-00']);
  });
  it('never deletes the current run and deletes nothing when within the limit', () => {
    expect(selectRunsToDelete(runs, { keepLatest: 1, currentRun: '2026-10-05T00-00-00', isUsable: () => false }))
      .toEqual(['2026-10-01T00-00-00', '2026-10-02T00-00-00', '2026-10-03T00-00-00', '2026-10-04T00-00-00']);
    expect(selectRunsToDelete(runs, { keepLatest: 5, isUsable: () => true })).toEqual([]);
    expect(selectRunsToDelete(runs, { keepLatest: 0, isUsable: () => true })).toEqual([]);
  });
});

// End-to-end through the CLI (dist-backed, skipped when dist is not built):
// a gate exit (--fail-on) after the passes is an injected failure for an
// application and a service run; a clean run closes `complete`.
const CLI = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'dist', 'index.js');

describe.skipIf(!existsSync(CLI))('swao assess writes run-status.json for application and service runs (#3283)', () => {
  let ws: string;
  const assess = (app: string, extra: string[] = []) => spawnSync(process.execPath, [
    CLI, 'assess', '--app', app, '--workspace', ws, '--skip-llm', '--no-crawl', ...extra,
  ], { cwd: ws, encoding: 'utf-8', timeout: 240_000, env: { ...process.env, SWAO_LICENSE_TIER_OVERRIDE: 'community' } });
  const newestRun = (app: string) => {
    const runsDir = join(ws, 'apps', app, 'wsp', 'runs');
    return join(runsDir, readdirSync(runsDir).sort().reverse()[0]!);
  };
  const markerOf = (run: string) => RunStatusSchema.parse(JSON.parse(readFileSync(join(run, 'run-status.json'), 'utf-8')));
  const appEvents = (app: string) => {
    const logs = join(ws, 'apps', app, 'wsp', 'logs');
    return readdirSync(logs).filter(f => f.startsWith('app-events-'))
      .flatMap(f => readFileSync(join(logs, f), 'utf-8').split('\n').filter(Boolean))
      .map(l => JSON.parse(l) as { level: string; code: string; context?: Record<string, unknown> });
  };

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'swao-run-status-cli-'));
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

  it('application: a clean run closes complete; an injected --fail-on gate exit closes failed without a manifest', () => {
    expect(assess('webapp').status).toBe(0);
    const ok = newestRun('webapp');
    expect(markerOf(ok)).toMatchObject({ assessment_type: 'application', status: 'complete', exit_code: 0 });
    const done = appEvents('webapp').filter(e => e.code === 'swao.run.complete').pop()!;
    expect(done.context).toMatchObject({ status: 'complete', exit_code: 0 });

    const t0 = Date.now(); while (Date.now() - t0 < 1100) { /* next run dir name */ }
    const r = assess('webapp', ['--fail-on', 'severity=high']);
    expect(r.status).toBe(6);
    const failedRun = newestRun('webapp');
    expect(failedRun).not.toBe(ok);
    expect(markerOf(failedRun)).toMatchObject({ assessment_type: 'application', status: 'failed', exit_code: 6 });
    expect(markerOf(failedRun).reason).toMatch(/^--fail-on severity=high: \d+ signal\(s\) matched$/);
    expect(existsSync(join(failedRun, 'run-manifest.json'))).toBe(false);
    const closed = appEvents('webapp').filter(e => e.code === 'swao.run.complete').pop()!;
    expect(closed.level).toBe('error');
    expect(closed.context).toMatchObject({ status: 'failed', exit_code: 6 });
  }, 600_000);

  it('service: an injected --fail-on gate exit closes the service run as failed', () => {
    const r = assess('hosapp001', ['--fail-on', 'severity=high']);
    expect(r.status).toBe(6);
    const run = newestRun('hosapp001');
    expect(markerOf(run)).toMatchObject({ assessment_type: 'service', status: 'failed', exit_code: 6 });
    expect(existsSync(join(run, 'run-manifest.json'))).toBe(false);
    const ev = appEvents('hosapp001');
    expect(ev.filter(e => e.code === 'swao.run.complete').pop()!.context).toMatchObject({ status: 'failed', exit_code: 6, assessment_type: 'service' });
    // swao.run.aborted keeps its #2391 meaning (signals, uncaught errors), not gate exits.
    expect(ev.some(e => e.code === 'swao.run.aborted')).toBe(false);
  }, 600_000);

  // #3306: the inline LZ catalogue fit records requested, resolved and skipped
  // targets in the application run's marker; a skipped target closes it partial.
  it('application: inline LZ fit with a skipped target closes partial with targets recorded', () => {
    const r = assess('webapp', ['--lz-cat-targets', 'azure:Europe,azure:Atlantis']);
    expect(r.status).toBe(0);
    const run = newestRun('webapp');
    const m = markerOf(run);
    expect(m).toMatchObject({ assessment_type: 'application', status: 'partial', exit_code: 0 });
    expect(m.targets).toEqual(['azure:germanywestcentral', 'azure:Atlantis']);
    expect(m.resolved_targets).toEqual([{ requested: 'azure:Europe', resolved: 'azure:germanywestcentral', geography: 'europe' }]);
    expect(m.failed_targets).toHaveLength(1);
    expect(m.failed_targets![0]).toMatchObject({ provider: 'azure', region: 'Atlantis' });
    expect(existsSync(join(run, 'run-manifest.json'))).toBe(true);
    expect(existsSync(join(run, 'lz-catalogue-fit-azure-germanywestcentral.yaml'))).toBe(true);
    expect(appEvents('webapp').some(e => e.code === 'lz.assessment.provider.error' && e.context?.['region'] === 'Atlantis')).toBe(true);
  }, 600_000);
});
