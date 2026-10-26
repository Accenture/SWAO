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
// #3440: a step that throws logs `assess.post_run.<name>.failed` (level warn,
// status error, error message) instead of `.complete`. The lifetime
// assessment counter runs through `incrementAssessmentCounterStep`, which
// attempts the write once and prints one non-fatal operator warning on failure.

import { logApp as coreLogApp, logPortfolio as coreLogPortfolio, type RunStatusValue } from '@swao/core';

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
  step<T>(name: string, fn: () => T): T;
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
    step<T>(name: string, fn: () => T): T {
      const t0 = now();
      safe(() => logApp(opts.app, 'info', `assess.post_run.${name}.start`, `Post-pass step ${name} starting`, {
        context: { ...base, step: name },
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
        const ctx = status === 'ok'
          ? { ...base, step: name, status, duration_ms }
          : { ...base, step: name, status, duration_ms, error: failure };
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
): T | null {
  if (!status || !PORTFOLIO_REBUILD_STATUSES.includes(status)) return null;
  try {
    return timer.step('portfolio_summary', build);
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
