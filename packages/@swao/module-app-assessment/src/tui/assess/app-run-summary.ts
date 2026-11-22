// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4301 (Design 098 section 4.1): the context of `assess.app.complete`, the
// TUI app run's completion event. It carries what `swao.run.complete` carries
// (run_id, duration_ms, status, signals) plus the passes run and not run and
// the caller, collected from the assess.app.pass.complete events the pass
// tracker (#4267) writes during the run. The event code stays as it is.

import { readFileSync } from 'fs';
import { basename, join } from 'path';
import type { PassLineEvent } from './pass-line-tracker.js';

export const APP_RUN_CALLER = 'tui.app-assessment';

/** #4400: the assessment type of a run as run-status.json records it. */
export type RunType = 'application' | 'service';

const RUN_TYPE_LABEL: Readonly<Record<RunType, string>> = { application: 'Application assessment', service: 'Service assessment' };

export interface AppRunSummary {
  /** Feed every event of the pass tracker. */
  observe(ev: PassLineEvent): void;
  /** Message and context of assess.app.complete. */
  /** #4400: `runType` is the assessment type of the finished run (run-status.json), not the flow. */
  complete(exitCode: number | null, runIdFallback?: string | null, runType?: RunType): { level: 'info' | 'warn'; message: string; context: Record<string, unknown> };
}

/** `passes` is the --passes value of the run (comma-separated keys). */
export function createAppRunSummary(passes: string, now: () => number = Date.now): AppRunSummary {
  const startedAt = now();
  // The CLI lowercases and de-duplicates --passes (assess.ts, #1054) and the markers carry
  // those keys, so both sides compare in lower case.
  const requested = [...new Set(passes.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean))];
  const done: Array<{ pass: string; status: string; signals: number }> = [];
  let runId: string | undefined;
  return {
    observe(ev) {
      const c = ev.context;
      if (typeof c['run_id'] === 'string' && c['run_id']) runId = c['run_id'];
      if (ev.code !== 'assess.app.pass.complete') return;
      done.push({
        pass: String(c['pass'] ?? '').toLowerCase(),
        status: typeof c['status'] === 'string' ? c['status'] : 'ok',
        signals: typeof c['signals'] === 'number' ? c['signals'] : 0,
      });
    },
    complete(exitCode, runIdFallback, runType = 'application') {
      const durationMs = now() - startedAt;
      const ran = new Set(done.map((d) => d.pass));
      const notRun = requested.filter((p) => !ran.has(p));
      // Marker statuses are ok, skip and degraded (pass-marker.ts); anything else did not finish.
      const failed = done.filter((d) => !['ok', 'skip', 'degraded'].includes(d.status)).map((d) => d.pass);
      const signals = done.reduce((s, d) => s + d.signals, 0);
      const status = exitCode === 0 ? 'complete' : 'failed';
      // latest.txt names this run only when it completed; a failed start can leave the previous run there.
      const id = runId ?? (exitCode === 0 && runIdFallback ? runIdFallback : undefined);
      const minutes = Math.round(durationMs / 6_000) / 10;
      return {
        level: exitCode === 0 ? 'info' : 'warn',
        message: `${RUN_TYPE_LABEL[runType]} ${status === 'complete' ? 'complete' : `ended with exit code ${exitCode ?? 'unknown'}`}: ${done.length} of ${requested.length} pass(es) run, ${signals} signal(s), ${minutes} min`,
        context: {
          caller: APP_RUN_CALLER,
          assessment_type: runType,
          exit_code: exitCode,
          status,
          ...(id ? { run_id: id } : {}),
          duration_ms: durationMs,
          passes_requested: requested.length,
          passes_run: done.length,
          passes_not_run: notRun,
          ...(failed.length > 0 ? { passes_failed: failed } : {}),
          signals,
        },
      };
    },
  };
}

/** Run id (folder name) the app's `wsp/latest.txt` names, or null. */
export function readLatestRunId(appWspDir: string): string | null {
  try {
    const v = readFileSync(join(appWspDir, 'latest.txt'), 'utf-8').trim();
    return v ? basename(v) : null;
  } catch {
    return null;
  }
}

/**
 * #4400: the assessment type of a run, read from its run-status.json
 * (`assessment_type`), so the log names the run as it ran. Defaults to
 * application when the run or the field is missing.
 */
export function readRunType(appWspDir: string, runId: string | null): RunType {
  if (!runId) return 'application';
  try {
    const doc = JSON.parse(readFileSync(join(appWspDir, 'runs', runId, 'run-status.json'), 'utf-8')) as { assessment_type?: unknown };
    return doc.assessment_type === 'service' ? 'service' : 'application';
  } catch {
    return 'application';
  }
}
