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

// #4410: one Setup Wizard health-check run, outside React so a stubbed runner
// can drive it in tests. A run the idle watchdog stops is reported and logged
// as incomplete (setup.health-check.timeout, setup.health-check.complete with
// incomplete: true), never as "0 failures".

import { existsSync, statSync, openSync, readSync, closeSync } from 'fs';
import { logPortfolio, resolveWorkspaceRoot, listSinkPaths } from '@swao/core';
import type { SetupScope } from '@swao/core';
import { parseHealthCheckOutput, summariseHealthCheckOutput } from '@swao/module-health-check';

/** #4120: counts of the wizard's health-check run, shown on the Ready step. */
export interface WizardHealthSummary {
  probeCount: number;
  failCount: number;
  warnCount: number;
  /** #4190: probe names behind the counts (set by HealthCheckStep, shown on the branch Ready step). */
  failedProbes?: string[];
  warnedProbes?: string[];
  /** #4410: set when the watchdog stopped the run, e.g. "health check did not finish (stopped after 120 s at probe community_frameworks)". */
  incomplete?: string;
}

/**
 * #1675 / #3170: emit setup.health-check.complete (or .empty) for the wizard's
 * health-check run. fail_count uses the runner's failure definition (read from
 * its summary line), so it equals health-check.complete fail_count; WARN probes
 * stay visible (#2388) as warn_count + warned_probes. Exported for tests.
 */
export function logSetupHealthCheckResult(lines: ReadonlyArray<string>, scope?: SetupScope): WizardHealthSummary {
  const summary = summariseHealthCheckOutput(lines);
  const result: WizardHealthSummary = { probeCount: summary.probeCount, failCount: summary.failCount, warnCount: summary.warnCount };
  if (summary.probeCount === 0) {
    logPortfolio('warn', 'setup.health-check.empty', 'Setup Wizard health-check: zero probes parsed, output may be corrupt or binary mismatch', scope ? { context: { scope } } : undefined);
    return result;
  }
  logPortfolio(
    'info',
    'setup.health-check.complete',
    `Setup Wizard health-check finished: ${summary.probeCount} probes, ${summary.failCount} failure(s), ${summary.warnCount} warning(s)`,
    {
      context: {
        probe_count: summary.probeCount,
        fail_count: summary.failCount,
        failed_probes: summary.failedProbes,
        warn_count: summary.warnCount,
        warned_probes: summary.warnedProbes,
        ...(scope ? { scope } : {}),
      },
    },
  );
  return result;
}

/** #4410: idle watchdog of the wizard's health check (no output for this long stops the runner). */
export const HEALTH_CHECK_IDLE_LIMIT_MS = 120_000;

/** The child process the controller drives (a spawned `swao health-check`, or a test stub). */
export interface HealthCheckChild {
  stdout: NodeJS.EventEmitter | null;
  stderr: NodeJS.EventEmitter | null;
  on(event: 'error', cb: (err: Error) => void): unknown;
  on(event: 'close', cb: () => void): unknown;
  kill(): unknown;
}

/** #4410: where the runner was when the watchdog stopped it. */
export interface HealthCheckStopInfo {
  /** Probe key of the last `health-check.probe.start` of this run in the portfolio log, else null. */
  lastProbeStarted: string | null;
  /** Name and position of the last probe that printed its result line, else null. */
  lastProbeFinished: { name: string; num: number; total: number } | null;
  idleMs: number;
  elapsedMs: number;
}

/** "health check did not finish (stopped after 120 s at probe community_frameworks)". */
export const HEALTH_CHECK_INCOMPLETE_PREFIX = 'health check did not finish';

/** The incomplete text of a summary: its `incomplete` field, else a failed-probe entry the stop added. */
export function healthIncompleteText(h: { incomplete?: string; failedProbes?: readonly string[] } | undefined): string | undefined {
  return h?.incomplete ?? h?.failedProbes?.find((n) => n.startsWith(HEALTH_CHECK_INCOMPLETE_PREFIX));
}

export function healthCheckStopText(info: HealthCheckStopInfo): string {
  const secs = Math.round(info.idleMs / 1000);
  const f = info.lastProbeFinished;
  const at = info.lastProbeStarted
    ? `at probe ${info.lastProbeStarted}`
    : f
      ? `after probe ${f.num} of ${f.total} (${f.name})`
      : 'before the first probe';
  return `${HEALTH_CHECK_INCOMPLETE_PREFIX} (stopped after ${secs} s ${at})`;
}

/**
 * #4410: the probe key of the last `health-check.probe.start` written to the
 * portfolio log at or after `sinceMs` (the run start). Reads only the tail of
 * the file. Null when the log is absent or the run logged no probe start.
 */
export function lastProbeStartedInLog(logPath: string, sinceMs: number, tailBytes = 256 * 1024): string | null {
  try {
    if (!existsSync(logPath)) return null;
    const size = statSync(logPath).size;
    const fd = openSync(logPath, 'r');
    try {
      const len = Math.min(size, tailBytes);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      const lines = buf.toString('utf-8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = (lines[i] ?? '').trim();
        if (!line.includes('"health-check.probe.start"')) continue;
        let ev: { ts?: string; code?: string; context?: { probe?: unknown } };
        try { ev = JSON.parse(line) as typeof ev; } catch { continue; }
        if (ev.code !== 'health-check.probe.start') continue;
        const ts = ev.ts ? Date.parse(ev.ts) : NaN;
        if (!Number.isFinite(ts) || ts < sinceMs) return null;
        return typeof ev.context?.probe === 'string' ? ev.context.probe : null;
      }
    } finally {
      closeSync(fd);
    }
  } catch { /* best-effort */ }
  return null;
}

function lastFinishedProbe(lines: ReadonlyArray<string>): HealthCheckStopInfo['lastProbeFinished'] {
  const probes = parseHealthCheckOutput(lines);
  const last = probes[probes.length - 1];
  return last ? { name: last.name, num: last.num, total: last.total } : null;
}

/**
 * #4410: summary of a run the watchdog stopped. The run is incomplete, never
 * "0 failures": the stop counts as one failure named by its text, so the Ready
 * step and the branch state (needs attention) never show a clean result, also
 * where only the counts and the failed probe names are passed on.
 */
export function incompleteHealthSummary(lines: ReadonlyArray<string>, info: HealthCheckStopInfo): WizardHealthSummary {
  const parsed = summariseHealthCheckOutput(lines);
  const text = healthCheckStopText(info);
  return {
    probeCount: parsed.probeCount,
    failCount: parsed.failCount + 1,
    warnCount: parsed.warnCount,
    failedProbes: [...parsed.failedProbes, text],
    warnedProbes: parsed.warnedProbes,
    incomplete: text,
  };
}

/** #4410: log the watchdog stop (warn) and the incomplete result; returns the summary. */
export function logSetupHealthCheckTimeout(lines: ReadonlyArray<string>, info: HealthCheckStopInfo, scope?: SetupScope): WizardHealthSummary {
  const summary = incompleteHealthSummary(lines, info);
  const text = summary.incomplete ?? healthCheckStopText(info);
  const context = {
    last_probe_started: info.lastProbeStarted,
    last_probe_finished: info.lastProbeFinished?.name ?? null,
    probes_finished: summary.probeCount,
    probes_total: info.lastProbeFinished?.total ?? null,
    idle_ms: info.idleMs,
    elapsed_ms: info.elapsedMs,
    ...(scope ? { scope } : {}),
  };
  try { logPortfolio('warn', 'setup.health-check.timeout', `Setup Wizard ${text}`, { context }); } catch { /* best-effort */ }
  try {
    logPortfolio('warn', 'setup.health-check.complete', `Setup Wizard ${text}: ${summary.probeCount} probes finished`, {
      context: {
        incomplete: true,
        probe_count: summary.probeCount,
        fail_count: summary.failCount,
        failed_probes: summary.failedProbes,
        warn_count: summary.warnCount,
        warned_probes: summary.warnedProbes,
        ...context,
      },
    });
  } catch { /* best-effort */ }
  return summary;
}

/**
 * Drive one wizard health-check run: collect the output lines, stop the runner
 * after `idleLimitMs` without output, and hand the summary to `onDone` exactly
 * once (normal close, spawn error or watchdog stop). Returns the cleanup that
 * stops the runner.
 */
export function runWizardHealthCheck(opts: {
  spawnChild: () => HealthCheckChild;
  onLines: (lines: string[]) => void;
  onDone: (summary: WizardHealthSummary | undefined) => void;
  scope?: SetupScope;
  idleLimitMs?: number;
  now?: () => number;
  lastProbeStarted?: (sinceMs: number) => string | null;
}): () => void {
  const idleLimitMs = opts.idleLimitMs ?? HEALTH_CHECK_IDLE_LIMIT_MS;
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const readLastProbe = opts.lastProbeStarted ?? ((since: number): string | null => {
    const root = resolveWorkspaceRoot();
    return root ? lastProbeStartedInLog(listSinkPaths(root).portfolio, since) : null;
  });
  const child = opts.spawnChild();
  // #1147: buffer partial lines across chunk boundaries; strip \r for Windows
  // CRLF so the header pattern always sees complete lines.
  // #1675: separate buffers per stream; a newline-less stderr write must not be
  // prepended to the next stdout chunk (it corrupts the [N/M] header pattern).
  let stdoutBuf = '';
  let stderrBuf = '';
  // #1675 / #3170: every complete line, for the logged summary.
  const hcLines: string[] = [];
  let lastOutputAt = startedAt;
  let finished = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const finish = (summary: WizardHealthSummary | undefined): void => {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    opts.onDone(summary);
  };
  // Idle watchdog: no output for idleLimitMs means the runner is wedged or a
  // probe hangs; stop it and report the run as incomplete (#4410). The timer
  // resets on every chunk, so a slow but active run is not stopped (the runner
  // prints one line per finished probe).
  const resetWatchdog = (): void => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (finished) return;
      const t = now();
      const info: HealthCheckStopInfo = {
        lastProbeStarted: readLastProbe(startedAt),
        lastProbeFinished: lastFinishedProbe(hcLines),
        idleMs: t - lastOutputAt,
        elapsedMs: t - startedAt,
      };
      const summary = logSetupHealthCheckTimeout(hcLines, info, opts.scope);
      try { child.kill(); } catch { /* already gone */ }
      finish(summary);
    }, idleLimitMs);
  };
  const makePush = (getBuf: () => string, setBuf: (v: string) => void) => (chunk: Buffer | string): void => {
    if (finished) return;
    lastOutputAt = now();
    resetWatchdog();
    const text = getBuf() + chunk.toString().replace(/\r/g, '');
    const parts = text.split('\n');
    setBuf(parts.pop() ?? '');
    const completeLines = parts.filter(Boolean);
    hcLines.push(...completeLines);
    if (completeLines.length > 0) opts.onLines(completeLines);
  };
  child.stdout?.on('data', makePush(() => stdoutBuf, (v) => { stdoutBuf = v; }));
  child.stderr?.on('data', makePush(() => stderrBuf, (v) => { stderrBuf = v; }));
  // #2367: guard against spawn failures (ENOENT, EACCES); an unhandled 'error'
  // event would crash the TUI without a useful crash log.
  child.on('error', (err: Error) => {
    if (finished) return;
    opts.onLines([`[spawn error] ${err.message}`]);
    finish(undefined);
  });
  resetWatchdog();
  child.on('close', () => {
    if (finished) return;
    const tail = [stdoutBuf, stderrBuf].filter((v) => v.trim());
    if (tail.length > 0) opts.onLines(tail);
    // #1675: setup.health-check.complete / .empty, so the monitors can confirm
    // the wizard health-check step ran and detect silent failures.
    let summary: WizardHealthSummary | undefined;
    try {
      if (stdoutBuf.trim()) hcLines.push(stdoutBuf);
      const parsed = summariseHealthCheckOutput(hcLines);
      summary = { ...logSetupHealthCheckResult(hcLines, opts.scope), failedProbes: parsed.failedProbes, warnedProbes: parsed.warnedProbes };
    } catch { /* best-effort */ }
    finish(summary);
  });
  return () => {
    clearTimeout(watchdog);
    finished = true;
    try { child.kill(); } catch { /* already gone */ }
  };
}
