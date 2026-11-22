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

// Post-pass step timing for `swao assess` (#3224).
//
// After the last pass, an application or service run still writes the run
// manifest, run context and scope coverage, derives wsp-plan.yaml, scrubs PII, bumps the
// assessment counter and applies run retention. UAT on 2026-10-11 showed up
// to 80 s in that window with no log event, and swao.run.complete
// duration_ms stopped at the end of the passes. Each step now runs through
// `step()`, which logs `assess.post_run.<name>.start` and
// `assess.post_run.<name>.complete` (with duration_ms and status) so the log
// shows which step takes the time; `summary()` feeds post_pass_ms and the
// per-step breakdown into swao.run.complete.
//
// #3309: once the run is closed (run-status.json `complete` or `partial`), the
// workspace portfolio summary is rebuilt through `rebuildPortfolioSummaryStep`
// (step `portfolio_summary`). It runs after the close because the combined view
// (#3280) only reads usable runs, so a rebuild while the marker still says
// `started` would miss the run that just finished.
//
// #4271: the portfolio_summary start event carries apps_total; a rebuild logs
// `assess.post_run.portfolio_summary.progress` every 10 s
// (createPortfolioProgressLogger), and the summary itself reuses unchanged
// per-app rows from a cache, so a single-app run no longer re-reads the
// whole portfolio.
//
// #3440: a step that throws logs `assess.post_run.<name>.failed` (level warn,
// status error, error message) instead of `.complete`. The lifetime
// assessment counter runs through `incrementAssessmentCounterStep`, which
// attempts the write once and prints one non-fatal operator warning on failure.

import { formatPostStepLine, logApp as coreLogApp, logPortfolio as coreLogPortfolio, postStepLabel, type RunStatusValue } from '@swao/core';

export type PostRunStepStatus = 'ok' | 'error';

export interface PostRunStepTiming {
  step: string;
  duration_ms: number;
  status: PostRunStepStatus;
}

export interface PostRunTimerOptions {
  app: string;
  runId: string;
  assessmentType: string;
  /** #4498: prints "[post] <Step>" when a step starts (the run screen names it); off when unset. */
  print?: (line: string) => void;
  /** Injected for tests; defaults to the @swao/core loggers. */
  logApp?: typeof coreLogApp;
  logPortfolio?: typeof coreLogPortfolio;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
}

export interface PostRunTimer {
  /**
   * Run one post-pass step, logging start and complete events. The step's
   * own result is returned; a throw is logged as `.failed` with status
   * 'error' (#3440) and re-thrown so the caller's existing try/catch
   * semantics are unchanged.
   */
  step<T>(name: string, fn: () => T, startContext?: Record<string, unknown>, completeContext?: () => Record<string, unknown>): T;
  /** Time spent in post-pass steps so far, plus the per-step breakdown. */
  summary(): { post_pass_ms: number; post_pass_steps: PostRunStepTiming[] };
}

export function createPostRunTimer(opts: PostRunTimerOptions): PostRunTimer {
  const logApp = opts.logApp ?? coreLogApp;
  const logPortfolio = opts.logPortfolio ?? coreLogPortfolio;
  const now = opts.now ?? Date.now;
  const steps: PostRunStepTiming[] = [];
  const base = { run_id: opts.runId, assessment_type: opts.assessmentType };

  const safe = (fn: () => void): void => { try { fn(); } catch { /* logging is best-effort */ } };

  return {
    step<T>(name: string, fn: () => T, startContext?: Record<string, unknown>, completeContext?: () => Record<string, unknown>): T {
      const t0 = now();
      // #4498: the step by name on stdout, so the run screen does not stand on the last pass.
      if (opts.print) safe(() => opts.print!(formatPostStepLine(postStepLabel(name))));
      // #4271: a step may add context to its start event (portfolio_summary: apps_total).
      safe(() => logApp(opts.app, 'info', `assess.post_run.${name}.start`, `Post-pass step ${name} starting`, {
        context: { ...base, step: name, ...(startContext ?? {}) },
      }));
      let status: PostRunStepStatus = 'ok';
      let failure = '';
      try {
        return fn();
      } catch (e) {
        status = 'error';
        failure = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        throw e;
      } finally {
        const duration_ms = now() - t0;
        steps.push({ step: name, duration_ms, status });
        // #3440: a throwing step logs `.failed` (level warn, with the error
        // message), never `.complete` with status error, so a failure is
        // visible by event name in execution-trace.ndjson.
        // #4412: a step may add context to its complete event (portfolio_summary: cache and phase timings).
        let extra: Record<string, unknown> = {};
        try { extra = completeContext?.() ?? {}; } catch { /* best effort */ }
        const ctx = status === 'ok'
          ? { ...base, step: name, status, duration_ms, ...extra }
          : { ...base, step: name, status, duration_ms, error: failure, ...extra };
        const code = `assess.post_run.${name}.${status === 'ok' ? 'complete' : 'failed'}`;
        const level = status === 'ok' ? 'info' : 'warn';
        const message = status === 'ok' ? `Post-pass step ${name} complete` : `Post-pass step ${name} failed`;
        safe(() => logApp(opts.app, level, code, message, { context: ctx }));
        safe(() => logPortfolio(level, code, message, { context: { ...ctx, app: opts.app } }));
      }
    },
    summary() {
      return {
        post_pass_ms: steps.reduce((sum, s) => sum + s.duration_ms, 0),
        post_pass_steps: steps.map((s) => ({ ...s })),
      };
    },
  };
}

/** #4498: interval of the portfolio summary progress lines on stdout (the run screen). */
export const PORTFOLIO_PRINT_INTERVAL_MS = 1_000;

/** #4271: interval of the portfolio summary progress lines (a rebuild over 30 s logs at least one). */
export const PORTFOLIO_PROGRESS_INTERVAL_MS = 10_000;

export interface PortfolioProgressLoggerOptions {
  app: string;
  runId: string;
  assessmentType: string;
  intervalMs?: number;
  /** #4498: prints "[post] Portfolio summary: 106 of 235 apps" for the run screen, at most every printIntervalMs. */
  print?: (line: string) => void;
  printIntervalMs?: number;
  /** Injected for tests; defaults to the @swao/core loggers. */
  logApp?: typeof coreLogApp;
  logPortfolio?: typeof coreLogPortfolio;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
}

/**
 * #4271: progress callback for the portfolio summary rebuild. Logs
 * `assess.post_run.portfolio_summary.progress` (apps processed out of total,
 * apps served from the row cache) at most once per interval, so a long cold
 * rebuild is never silent between its start and complete events.
 */
export function createPortfolioProgressLogger(opts: PortfolioProgressLoggerOptions): (p: { done: number; total: number; cached: number }) => void {
  const logApp = opts.logApp ?? coreLogApp;
  const logPortfolio = opts.logPortfolio ?? coreLogPortfolio;
  const now = opts.now ?? Date.now;
  const interval = opts.intervalMs ?? PORTFOLIO_PROGRESS_INTERVAL_MS;
  const t0 = now();
  let last = t0;
  let lastPrint = Number.NEGATIVE_INFINITY;
  const printInterval = opts.printIntervalMs ?? PORTFOLIO_PRINT_INTERVAL_MS;
  return (p) => {
    const t = now();
    if (opts.print && p.total > 0 && (t - lastPrint >= printInterval || p.done >= p.total)) {
      lastPrint = t;
      try { opts.print(formatPostStepLine(postStepLabel('portfolio_summary'), { done: p.done, total: p.total, noun: 'apps' })); } catch { /* best-effort */ }
    }
    if (t - last < interval || p.done >= p.total) return;
    last = t;
    const context = { run_id: opts.runId, assessment_type: opts.assessmentType, step: 'portfolio_summary', apps_done: p.done, apps_total: p.total, apps_cached: p.cached, elapsed_ms: t - t0 };
    const message = `Post-pass step portfolio_summary: ${p.done} of ${p.total} apps`;
    try { logApp(opts.app, 'info', 'assess.post_run.portfolio_summary.progress', message, { context }); } catch { /* best-effort */ }
    try { logPortfolio('info', 'assess.post_run.portfolio_summary.progress', message, { context: { ...context, app: opts.app } }); } catch { /* best-effort */ }
  };
}

/** #4412: a rebuild step at least this long logs its own phase line. */
export const PORTFOLIO_PHASE_LOG_MS = 1_000;

/**
 * #4412: phase callback for the portfolio summary rebuild. A step of at least
 * PORTFOLIO_PHASE_LOG_MS (setup, discover_kinds, service_rows,
 * application_rows, integration_graph, waves, vendors, write) logs
 * `assess.post_run.portfolio_summary.phase` with its name and duration, so a
 * silence between the progress lines and the complete event has a name.
 * `start(phase)` (wired to `onPhaseStart`, the cross-app steps after the
 * per-app loop) logs `assess.post_run.portfolio_summary.phase.start` when the
 * step begins; a step that logged its start always logs its phase line, so
 * the log names the step while it runs and says when it ended.
 */
export type PortfolioPhaseLogger = ((phase: string, durationMs: number) => void) & { start: (phase: string) => void };

export function createPortfolioPhaseLogger(opts: PortfolioProgressLoggerOptions & { minMs?: number }): PortfolioPhaseLogger {
  const logApp = opts.logApp ?? coreLogApp;
  const logPortfolio = opts.logPortfolio ?? coreLogPortfolio;
  const min = opts.minMs ?? PORTFOLIO_PHASE_LOG_MS;
  const started = new Set<string>();
  const start = (phase: string): void => {
    started.add(phase);
    const context = { run_id: opts.runId, assessment_type: opts.assessmentType, step: 'portfolio_summary', phase };
    const message = `Post-pass step portfolio_summary: ${phase.replace(/_/g, ' ')} starting`;
    try { logApp(opts.app, 'info', 'assess.post_run.portfolio_summary.phase.start', message, { context }); } catch { /* best-effort */ }
    try { logPortfolio('info', 'assess.post_run.portfolio_summary.phase.start', message, { context: { ...context, app: opts.app } }); } catch { /* best-effort */ }
  };
  const end = (phase: string, durationMs: number): void => {
    const wasStarted = started.delete(phase);
    if (durationMs < min && !wasStarted) return;
    const context = { run_id: opts.runId, assessment_type: opts.assessmentType, step: 'portfolio_summary', phase, duration_ms: durationMs };
    const message = `Post-pass step portfolio_summary: ${phase.replace(/_/g, ' ')} took ${Math.round(durationMs / 100) / 10} s`;
    try { logApp(opts.app, 'info', 'assess.post_run.portfolio_summary.phase', message, { context }); } catch { /* best-effort */ }
    try { logPortfolio('info', 'assess.post_run.portfolio_summary.phase', message, { context: { ...context, app: opts.app } }); } catch { /* best-effort */ }
  };
  return Object.assign(end, { start });
}

/** Run statuses after which the portfolio summary is rebuilt (#3309). */
export const PORTFOLIO_REBUILD_STATUSES: readonly RunStatusValue[] = ['complete', 'partial'];

/**
 * #3309 (Design 103 §22.1): rebuild `wsp/portfolio-summary.json` after a
 * closed application or service run, as the logged post-run step
 * `portfolio_summary`. Best effort: a failure is logged by the timer
 * (status `error`) and printed as a warning, never re-thrown, so the exit
 * code of the run is unchanged. Returns the build result, or null when the
 * run did not close `complete` / `partial` (skipped) or the build failed.
 */
export function rebuildPortfolioSummaryStep<T>(
  timer: PostRunTimer,
  status: RunStatusValue | undefined,
  build: () => T,
  warn: (line: string) => void = (line) => console.warn(line),
  startContext?: Record<string, unknown>,
  completeContext?: () => Record<string, unknown>,
): T | null {
  if (!status || !PORTFOLIO_REBUILD_STATUSES.includes(status)) return null;
  try {
    return timer.step('portfolio_summary', build, startContext, completeContext);
  } catch (e) {
    warn(`[warn] Portfolio summary not updated: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * #3440: bump the lifetime assessment counter (M18 #0273) as the logged
 * post-run step `assessment_counter`. The write is attempted exactly once:
 * `incrementAssessmentCount()` is a read-modify-write of licence-state.json,
 * so a retry after a write that did land would count the run twice. A failure
 * therefore leaves the persisted count at its previous value (this run is not
 * counted), logs `assess.post_run.assessment_counter.failed` and prints one
 * operator warning. It is never fatal: the run's artefacts are already
 * written, and failing a finished assessment over a bookkeeping write would
 * cost more than an under-count of one. Returns true when the counter was
 * written. `timer` is optional for flows without post-run timing; pass
 * `untimed` there so a failure is still logged by event name.
 */
export function incrementAssessmentCounterStep(
  timer: PostRunTimer | undefined,
  increment: () => void,
  warn: (line: string) => void = (line) => console.warn(line),
  untimed?: UntimedCounterContext,
): boolean {
  try {
    if (timer) timer.step('assessment_counter', increment);
    else increment();
    return true;
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    // #3440: flows without a post-run timer (LLM Assessment, landing-zone
    // catalogue) still log the failure under the same event name.
    if (!timer && untimed) {
      const logApp = untimed.logApp ?? coreLogApp;
      const logPortfolio = untimed.logPortfolio ?? coreLogPortfolio;
      const ctx = { step: 'assessment_counter', status: 'error' as const, assessment_type: untimed.assessmentType, error };
      try { logApp(untimed.app, 'warn', 'assess.post_run.assessment_counter.failed', 'Post-pass step assessment_counter failed', { context: ctx }); } catch { /* best-effort */ }
      try { logPortfolio('warn', 'assess.post_run.assessment_counter.failed', 'Post-pass step assessment_counter failed', { context: { ...ctx, app: untimed.app } }); } catch { /* best-effort */ }
    }
    warn(`[warn] Lifetime assessment counter not updated, this run is not counted: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/**
 * #3440: logging context for `incrementAssessmentCounterStep` in flows that
 * have no post-run timer. A failure is then logged directly as
 * `assess.post_run.assessment_counter.failed` (no start / complete events,
 * no duration), so it is never silent.
 */
export interface UntimedCounterContext {
  app: string;
  assessmentType: string;
  /** Injected for tests; defaults to the @swao/core loggers. */
  logApp?: typeof coreLogApp;
  logPortfolio?: typeof coreLogPortfolio;
}
