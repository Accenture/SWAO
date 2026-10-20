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

// LZ Catalog Assessment run lifecycle (#3223, #3245).
//
// `swao assess --type landing-zone-catalog` used to leave its event sequence
// open and its run dir empty when a target failed: an unknown region (for
// example `azure:Europe`) made assembleLzCatalogWsp return ok:false, and the
// CLI printed `[error]` and called process.exit(1) without a closing event or
// any artefact in wsp/runs/<ts>/. This module owns every exit path of an LZ
// run so each one closes the sequence:
//
//   - lz.assessment.provider.error (error level) naming the failed target
//   - lz.assessment.error, then lz.assessment.complete with status + exit_code
//   - swao.run.complete with type lz-catalog, status and exit_code
//   - run-status.json in the run dir
//     (status started -> complete | partial | failed | aborted)
//
// Owner decision 2026-10-17 (#3223): a failing target does NOT stop the run.
// runLzProviderFits logs it (provider.error + console warning) and continues;
// the run completes as `partial` when at least one target succeeded and fails
// (exit 1) only when every target failed.
//
// run-manifest.json and the latest-* pointers stay completion-only (#1023):
// readers treat their presence as a finished run, so a failed run never
// writes them.

import { logApp as coreLogApp, logPortfolio as coreLogPortfolio, RUN_STATUS_FILE } from '@swao/core';
import { createRunLifecycle } from './run-lifecycle.js';

export const LZ_RUN_STATUS_FILE = RUN_STATUS_FILE;

export type LzRunStatus = 'started' | 'complete' | 'partial' | 'failed' | 'aborted';

/** A target whose fit failed (unknown region, ok:false, or a throw in the fit). */
export interface LzTargetFailure {
  provider: string;
  region: string;
  reason: string;
}

export interface LzTarget {
  provider: string;
  region: string;
}

export interface LzRunStatusMarker {
  schema_version: '1.0';
  assessment_type: 'landing-zone-catalog';
  app: string;
  run_id: string;
  status: LzRunStatus;
  started_at: string;
  finished_at?: string;
  exit_code?: number;
  reason?: string;
  failed_targets?: LzTargetFailure[];
  targets: string[];
  /** #3281: configured geographies resolved to their default region. */
  resolved_targets?: Array<{ requested: string; resolved: string; geography: string }>;
  swao_version: string;
}

export interface LzRunLifecycleOptions {
  app: string;
  runDir: string;
  startedAt: Date;
  targets: LzTarget[];
  swaoVersion: string;
  /** #3281: geographies resolved before the run (recorded in the marker). */
  resolvedTargets?: Array<{ requested: string; resolved: string; geography: string }>;
  logApp?: typeof coreLogApp;
  logPortfolio?: typeof coreLogPortfolio;
  /** Process used for signal / uncaught-exception / exit guards (injectable for tests). */
  proc?: Pick<NodeJS.Process, 'once' | 'on' | 'prependOnceListener' | 'removeListener' | 'exit'>;
}

export interface LzRunFailure {
  status: 'failed' | 'aborted';
  reason: string;
  exitCode: number;
  /** A target that failed after its fit (e.g. schema validation); emits provider.error. */
  target?: LzTarget;
  /** Targets whose fit already failed (provider.error already emitted by the loop). */
  failedTargets?: LzTargetFailure[];
}

export interface LzRunLifecycle {
  /** Write run-status.json with status `started`. Call right after the run dir exists. */
  markStarted(): void;
  /** Close a failed or aborted run. Idempotent: only the first close emits. */
  fail(failure: LzRunFailure): void;
  /** Mark the run complete, or `partial` when failedTargets is non-empty
   *  (status marker only; success events stay with the caller). */
  complete(failedTargets?: LzTargetFailure[]): void;
  /** True once fail() or complete() has run. */
  readonly closed: boolean;
  /** Install SIGINT / SIGTERM / uncaughtException / exit guards. Returns a disposer. */
  installProcessGuards(): () => void;
}

const targetLabel = (t: LzTarget): string => `${t.provider}:${t.region}`;

export function createLzRunLifecycle(opts: LzRunLifecycleOptions): LzRunLifecycle {
  const logApp = opts.logApp ?? coreLogApp;
  const logPortfolio = opts.logPortfolio ?? coreLogPortfolio;
  const targets = opts.targets.map(targetLabel);

  const safe = (fn: () => void): void => {
    try { fn(); } catch { /* logging is best-effort */ }
  };

  // #3283: marker writing and process guards live in the shared run lifecycle;
  // this wrapper adds the LZ events of a failing close.
  const base = createRunLifecycle({
    assessmentType: 'landing-zone-catalog',
    app: opts.app,
    runDir: opts.runDir,
    startedAt: opts.startedAt,
    swaoVersion: opts.swaoVersion,
    extra: {
      targets,
      ...(opts.resolvedTargets && opts.resolvedTargets.length > 0 ? { resolved_targets: opts.resolvedTargets } : {}),
    },
    proc: opts.proc,
    warn: (line) => console.warn(line.replace('[warn] ', '[warn] LZ: ')),
    onFail: (failure, { elapsedMs }) => {
      const failedTargets = failure.failedTargets ?? [];
      const eventStatus = failure.status === 'aborted' ? 'aborted' : 'error';
      const level = failure.status === 'aborted' ? 'warn' : 'error';
      const errMsg = `Landing Zone Catalog Assessment ${failure.status}` +
        (failedTargets.length > 0 ? ` (${failedTargets.map(targetLabel).join(', ')})` : '');
      const closeCtx = {
        status: eventStatus,
        exit_code: failure.exitCode,
        reason: failure.reason,
        ...(failedTargets.length > 0 ? { failed_targets: failedTargets } : {}),
        duration_ms: elapsedMs,
        elapsed_ms: elapsedMs,
      };
      safe(() => logApp(opts.app, level, 'lz.assessment.error', errMsg, {
        context: { app_id: opts.app, lz_targets: targets.join(','), ...closeCtx },
      }));
      safe(() => logPortfolio(level, 'lz.assessment.error', errMsg, {
        context: { app: opts.app, providers: targets, ...closeCtx },
      }));
      safe(() => logApp(opts.app, level, 'lz.assessment.complete', `Landing Zone Catalog Assessment ${failure.status}`, {
        context: { app_id: opts.app, lz_targets: targets.join(','), ...closeCtx },
      }));
      safe(() => logPortfolio(level, 'lz.assessment.complete', `LZ Catalog Assessment ${failure.status}`, {
        context: { app: opts.app, providers_run: targets.length, ...closeCtx },
      }));
      safe(() => logPortfolio(level, 'swao.run.complete', `LZ Catalog Assessment ${failure.status}`, {
        context: { type: 'lz-catalog', app: opts.app, ...closeCtx },
      }));
    },
  });

  return {
    get closed() { return base.closed; },

    markStarted() {
      base.markStarted();
    },

    fail(failure) {
      if (base.closed) return;
      if (failure.target) {
        const { provider, region } = failure.target;
        // Short message: error-level events are mirrored to the console, and the
        // reason (for an unknown region it lists every catalogue region) is in context.
        const msg = `LZ fit failed: ${provider}/${region}`;
        safe(() => logPortfolio('error', 'lz.assessment.provider.error', msg, {
          context: { app: opts.app, provider, region, error: failure.reason },
        }));
        safe(() => logApp(opts.app, 'error', 'lz.assessment.provider.error', msg, {
          context: { app_id: opts.app, provider, region, error: failure.reason },
        }));
      }
      base.fail({
        status: failure.status,
        reason: failure.reason,
        exitCode: failure.exitCode,
        failedTargets: [
          ...(failure.failedTargets ?? []),
          ...(failure.target ? [{ ...failure.target, reason: failure.reason }] : []),
        ],
      });
    },

    complete(failedTargets) {
      base.complete({ failedTargets });
    },

    installProcessGuards() {
      // The fit loop is synchronous, so a signal is serviced only between
      // event-loop turns (before the loop starts or after it ends); a Ctrl+C
      // during a fit still terminates via the default handler once the
      // listener is gone. The guards close runs that are interrupted while
      // awaiting I/O, any uncaught exception that escapes the caller's
      // try/catch, and (#3283) any process exit while the run is open.
      return base.installProcessGuards();
    },
  };
}

export interface LzFitOk<R> { ok: true; value: R; overall: string }
export interface LzFitFail {
  ok: false;
  error: string;
  /** Valid region ids of the provider, when the failure is an unknown region. */
  validRegions?: string[];
}

/** Cap on the region ids listed in provider.error / console output. */
export const LZ_VALID_REGION_HINT_CAP = 10;

/** Up to `cap` region ids, those resembling the requested region first
 *  (e.g. `Europe` -> `northeurope`, `westeurope`). */
export function regionHint(requested: string, valid: string[], cap = LZ_VALID_REGION_HINT_CAP): string[] {
  const needle = requested.toLowerCase().replace(/[^a-z0-9]/g, '');
  const similar = needle ? valid.filter((r) => r.toLowerCase().includes(needle)) : [];
  const rest = valid.filter((r) => !similar.includes(r));
  return [...similar, ...rest].slice(0, cap);
}
export type LzFitOutcome<R> = LzFitOk<R> | LzFitFail;

export interface LzFitLoopResult<R> {
  target: LzTarget;
  idx: number;
  value: R;
  overall: string;
  fitMs: number;
}

/**
 * Run the per-target fit loop with provider.start / provider.complete events.
 * A target that returns ok:false or throws emits lz.assessment.provider.error
 * (error level, both scopes; for an unknown region with up to 10 valid region
 * ids) and a console `[warning]`, and the loop continues with the next target
 * (owner decision 2026-10-17, #3223). The loop never closes the run: the
 * caller completes it as `partial` when some targets succeeded, or calls
 * `lifecycle.fail` with the failures when none did.
 */
export function runLzProviderFits<R>(args: {
  app: string;
  targets: LzTarget[];
  fit: (target: LzTarget, idx: number) => LzFitOutcome<R>;
  logApp?: typeof coreLogApp;
  logPortfolio?: typeof coreLogPortfolio;
}): { results: LzFitLoopResult<R>[]; failures: LzTargetFailure[] } {
  const logApp = args.logApp ?? coreLogApp;
  const logPortfolio = args.logPortfolio ?? coreLogPortfolio;
  const results: LzFitLoopResult<R>[] = [];
  const failures: LzTargetFailure[] = [];
  for (let idx = 0; idx < args.targets.length; idx++) {
    const target = args.targets[idx]!;
    const { provider: lzP, region: lzR } = target;
    try {
      logPortfolio('info', 'lz.assessment.provider.start', `LZ fit starting: ${lzP}/${lzR}`, {
        context: { app: args.app, provider: lzP, region: lzR },
      });
    } catch { /* best-effort */ }
    // #2288: mirror provider.start to app-events for cross-file correlation.
    try {
      logApp(args.app, 'info', 'lz.assessment.provider.start', `LZ fit starting: ${lzP}/${lzR}`, {
        context: { app_id: args.app, provider: lzP, region: lzR },
      });
    } catch { /* best-effort */ }
    const fitStart = Date.now();
    let outcome: LzFitOutcome<R>;
    try {
      outcome = args.fit(target, idx);
    } catch (err) {
      outcome = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    const fitMs = Date.now() - fitStart;
    if (!outcome.ok) {
      const valid = outcome.validRegions ?? [];
      const hint = valid.length > 0 ? regionHint(lzR, valid) : undefined;
      // The catalogue error lists every region (87 for azure); keep the reason
      // short and carry the capped hint separately.
      const reason = hint ? outcome.error.replace(/\s*Available:[\s\S]*$/, '') : outcome.error;
      const hintText = hint
        ? ` Valid regions include: ${hint.join(', ')}` +
          (valid.length > hint.length ? ` (${valid.length} in total; see \`swao lz catalogue list\`).` : '.')
        : '';
      const ctx = {
        provider: lzP,
        region: lzR,
        error: reason,
        elapsed_ms: fitMs,
        ...(hint ? { valid_regions: hint, valid_region_count: valid.length } : {}),
      };
      const msg = `LZ fit failed: ${lzP}/${lzR}: ${reason}${hintText}`;
      try {
        logPortfolio('error', 'lz.assessment.provider.error', msg, { context: { app: args.app, ...ctx } });
      } catch { /* best-effort */ }
      try {
        logApp(args.app, 'error', 'lz.assessment.provider.error', msg, { context: { app_id: args.app, ...ctx } });
      } catch { /* best-effort */ }
      console.warn(`[warning] LZ target ${lzP}:${lzR} failed and was skipped: ${reason}${hintText} Continuing with the remaining targets.`);
      failures.push({ provider: lzP, region: lzR, reason });
      continue;
    }
    const overall = outcome.overall;
    try {
      logPortfolio('info', 'lz.assessment.provider.complete', `LZ fit complete: ${lzP}/${lzR} -- ${overall}`, {
        context: { app: args.app, provider: lzP, region: lzR, verdict: overall, duration_ms: fitMs, elapsed_ms: fitMs },
      });
    } catch { /* best-effort */ }
    // #2288: mirror provider.complete to app-events for cross-file correlation.
    try {
      logApp(args.app, 'info', 'lz.assessment.provider.complete', `LZ fit complete: ${lzP}/${lzR} -- ${overall}`, {
        context: { app_id: args.app, provider: lzP, region: lzR, verdict: overall, elapsed_ms: fitMs },
      });
    } catch { /* best-effort */ }
    results.push({ target, idx, value: outcome.value, overall, fitMs });
  }
  return { results, failures };
}
