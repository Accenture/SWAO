// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4410: the Setup Wizard reported "2 probes, 0 failure(s)" after its idle
// watchdog stopped a health check that hung in the third probe, and logged
// nothing about the stop. A stubbed runner that prints two probes and then
// stays silent must produce setup.health-check.timeout and an incomplete
// summary.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { logged } = vi.hoisted(() => ({
  logged: [] as Array<{ level: string; code: string; message: string; context?: Record<string, unknown> }>,
}));

vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return {
    ...actual,
    logPortfolio: (level: string, code: string, message: string, opts?: { context?: Record<string, unknown> }) => {
      logged.push({ level, code, message, context: opts?.context });
    },
  };
});

import {
  runWizardHealthCheck,
  lastProbeStartedInLog,
  healthCheckStopText,
  healthIncompleteText,
  HEALTH_CHECK_IDLE_LIMIT_MS,
  type WizardHealthSummary,
} from './health-check-run.js';
import { formatReadyHealthLine } from './ReadyStep.js';
import { healthRow, readyHealthLevel } from '../../../../setup/ready-rows.js';

class StubChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill(): boolean { this.killed = true; return true; }
}

const TWO_PROBES = '  [1/26] License...............  ok    Enterprise\n  [2/26] SWAO-MCP..............  ok    configured\n';

beforeEach(() => { logged.length = 0; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('#4410 watchdog stop of the wizard health check', () => {
  it('two probes, then silence: timeout event, incomplete summary, runner stopped', () => {
    const child = new StubChild();
    let clock = 1_000_000;
    let done: WizardHealthSummary | undefined | null = null;
    const lines: string[] = [];
    runWizardHealthCheck({
      spawnChild: () => child,
      onLines: (l) => lines.push(...l),
      onDone: (s) => { done = s; },
      scope: 'generic',
      now: () => clock,
      lastProbeStarted: () => 'community_frameworks',
    });
    child.stdout.emit('data', Buffer.from('Running swao health-check...\n'));
    clock += 2_000;
    child.stdout.emit('data', Buffer.from(TWO_PROBES));
    clock += HEALTH_CHECK_IDLE_LIMIT_MS;
    vi.advanceTimersByTime(HEALTH_CHECK_IDLE_LIMIT_MS);

    expect(child.killed).toBe(true);
    const timeout = logged.find((e) => e.code === 'setup.health-check.timeout');
    expect(timeout?.level).toBe('warn');
    expect(timeout?.context).toMatchObject({
      last_probe_started: 'community_frameworks',
      last_probe_finished: 'SWAO-MCP',
      probes_finished: 2,
      probes_total: 26,
      idle_ms: 120_000,
      elapsed_ms: 122_000,
      scope: 'generic',
    });
    const complete = logged.find((e) => e.code === 'setup.health-check.complete');
    expect(complete?.level).toBe('warn');
    expect(complete?.context).toMatchObject({ incomplete: true, probe_count: 2, fail_count: 1 });
    expect(complete?.message).not.toMatch(/0 failure/);

    const summary = done as unknown as WizardHealthSummary;
    expect(summary.incomplete).toBe('health check did not finish (stopped after 120 s at probe community_frameworks)');
    expect(summary.failCount).toBe(1);
    expect(summary.failedProbes).toContain(summary.incomplete);

    // A late close after the kill does not log a second, clean result.
    child.emit('close');
    expect(logged.filter((e) => e.code === 'setup.health-check.complete')).toHaveLength(1);
  });

  it('a normal run closes with the clean summary and no timeout event', () => {
    const child = new StubChild();
    let done: WizardHealthSummary | undefined | null = null;
    runWizardHealthCheck({ spawnChild: () => child, onLines: () => {}, onDone: (s) => { done = s; }, lastProbeStarted: () => null });
    child.stdout.emit('data', Buffer.from(TWO_PROBES + 'All probes passed.\n'));
    child.emit('close');
    vi.advanceTimersByTime(HEALTH_CHECK_IDLE_LIMIT_MS * 2);
    expect(logged.map((e) => e.code)).toEqual(['setup.health-check.complete']);
    expect((done as unknown as WizardHealthSummary).incomplete).toBeUndefined();
    expect(child.killed).toBe(false);
  });

  it('without a logged probe start the text names the last finished probe', () => {
    expect(healthCheckStopText({ lastProbeStarted: null, lastProbeFinished: { name: 'SWAO-MCP', num: 2, total: 26 }, idleMs: 120_000, elapsedMs: 125_000 }))
      .toBe('health check did not finish (stopped after 120 s after probe 2 of 26 (SWAO-MCP))');
    expect(healthCheckStopText({ lastProbeStarted: null, lastProbeFinished: null, idleMs: 120_000, elapsedMs: 120_000 }))
      .toBe('health check did not finish (stopped after 120 s before the first probe)');
  });
});

describe('#4410 last probe start from the portfolio log', () => {
  it('returns the last health-check.probe.start of this run, null for an older run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-4410-'));
    try {
      const log = join(dir, 'portfolio-events.ndjson');
      const ev = (ts: string, code: string, probe?: string) => JSON.stringify({ ts, level: 'info', code, message: '', ...(probe ? { context: { probe } } : {}) });
      writeFileSync(log, [
        ev('2026-11-14T15:18:51.528Z', 'health-check.probe.start', 'license'),
        ev('2026-11-14T15:18:51.540Z', 'health-check.probe.complete', 'license'),
        ev('2026-11-14T15:18:53.739Z', 'health-check.probe.start', 'community_frameworks'),
        '',
      ].join('\n'));
      expect(lastProbeStartedInLog(log, Date.parse('2026-11-14T15:18:48.808Z'))).toBe('community_frameworks');
      expect(lastProbeStartedInLog(log, Date.parse('2026-11-14T16:00:00Z'))).toBeNull();
      expect(lastProbeStartedInLog(join(dir, 'absent.ndjson'), 0)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('#4410 Ready step: an incomplete health check is not a clean result', () => {
  const text = 'health check did not finish (stopped after 120 s at probe community_frameworks)';
  // The shape SetupWizard passes on (counts and probe names only).
  const passedOn = { scope: 'generic' as const, probeCount: 2, failCount: 1, warnCount: 0, failedProbes: [text], warnedProbes: [] };

  it('the Ready line names the stop', () => {
    expect(formatReadyHealthLine(passedOn)).toBe(`${text}; run Health Check from the main menu`);
    expect(healthIncompleteText(passedOn)).toBe(text);
  });

  it('the branch Ready row is a failure and does not repeat the text', () => {
    expect(readyHealthLevel(passedOn)).toBe('fail');
    expect(readyHealthLevel({ ...passedOn, probeCount: 0 })).toBe('fail');
    const row = healthRow(passedOn);
    expect(JSON.stringify(row).split(text).length - 1).toBeGreaterThanOrEqual(1);
    expect(formatReadyHealthLine({ scope: 'generic', probeCount: 2, failCount: 0, warnCount: 0, failedProbes: [], warnedProbes: [] })).toBe('2 probes, 0 failures, 0 warnings');
  });
});
