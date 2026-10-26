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

// Run lifecycle shared by application, service and LZ catalogue runs (#3283).
//
// Generalised from lz-run-lifecycle.ts (#3223, #3245). Owns run-status.json
// (schema: RunStatusSchema in @swao/core) and every exit path of a run:
//
//   markStarted()            status `started`, right after the run dir exists
//   complete({...})          `complete`, or `partial` with failed targets / passes
//   recordTargets({...})     LZ targets of the run (#3306: the inline catalogue
//                            fit of an application run), kept on every later write
//   fail({...})              `failed` or `aborted`
//   installProcessGuards()   SIGINT -> aborted (130), SIGTERM -> aborted (143),
//                            uncaughtException -> failed (1), and a process
//                            `exit` before the run closed -> failed with the
//                            exit code (process.exit(4|5|6) gates, a rejected
//                            action handled by the host, ...)
//
// Every failing close emits swao.run.complete with status and exit_code
// through the `onFail` hook of the caller (the success event stays with the
// caller, which owns the run statistics). Closing is idempotent.
//
// run-manifest.json and the latest-* pointers stay completion-only (#1023).

import { writeFileSync } from 'fs';
import { join } from 'path';
import { RUN_STATUS_FILE, RUN_STATUS_SCHEMA_VERSION, type RunStatus, type RunStatusValue, type PassDegradedEntry } from '@swao/core';

/** A target skipped by the run (run-status.json failed_targets). */
export interface RunFailedTarget { provider: string; region: string; reason: string }

export type RunAssessmentType = RunStatus['assessment_type'];

export interface RunFailure {
  status: 'failed' | 'aborted';
  reason: string;
  exitCode: number;
  failedTargets?: RunFailedTarget[];
}

/** A configured geography resolved to its default region (run-status.json resolved_targets). */
export interface RunResolvedTarget { requested: string; resolved: string; geography: string }

/** LZ targets recorded on the marker once they are known (#3306). */
export interface RunTargetRecord {
  /** Targets the run fitted or tried, as provider:region labels. */
  targets?: string[];
  /** Geographies resolved to their default region. */
  resolvedTargets?: RunResolvedTarget[];
  /** Targets skipped by the run; a later complete() closes `partial`. */
  failedTargets?: RunFailedTarget[];
}

export interface RunCompletion {
  /** LZ targets skipped by the run; non-empty makes the run `partial`. */
  failedTargets?: RunFailedTarget[];
  /** Passes that failed (application / service); non-empty makes the run `partial`. */
  failedPasses?: string[];
  /**
   * #3436: passes that ran but are not fully evaluated (Pass 11 with controls
   * without a model verdict); non-empty makes the run `partial`. The exit code
   * is unchanged: the result is usable, the marker says it is incomplete.
   */
  degradedPasses?: PassDegradedEntry[];
  exitCode?: number;
}

interface MarkerPatch {
  status: RunStatusValue;
  finished_at?: string;
  exit_code?: number;
  reason?: string;
  failed_targets?: RunFailedTarget[];
  failed_passes?: string[];
  degraded_passes?: PassDegradedEntry[];
}

export interface RunLifecycleOptions {
  assessmentType: RunAssessmentType;
  app: string;
  runDir: string;
  startedAt: Date;
  swaoVersion: string;
  /** Run id; defaults to startedAt.toISOString(). */
  runId?: string;
  /** Extra marker fields written on every update (LZ: targets, resolved_targets). */
  extra?: Record<string, unknown>;
  /** Called once on a failing close, before the marker is written (events). */
  onFail?: (failure: RunFailure, ctx: { elapsedMs: number }) => void;
  /** Process used for the guards (injectable for tests). */
  proc?: Pick<NodeJS.Process, 'once' | 'on' | 'prependOnceListener' | 'removeListener' | 'exit'>;
  /** Console sink for marker write failures (tests). */
  warn?: (line: string) => void;
}

export interface RunLifecycle {
  markStarted(): void;
  fail(failure: RunFailure): void;
  complete(completion?: RunCompletion): void;
  /**
   * Record LZ targets known only after the marker was started (#3306). The
   * fields are merged into every later marker write; failed targets recorded
   * here also make complete() close the run `partial`. Ignored once closed.
   */
  recordTargets(record: RunTargetRecord): void;
  readonly closed: boolean;
  /** The status written last (`started` after markStarted). */
  readonly status: RunStatusValue | undefined;
  installProcessGuards(): () => void;
}

export function createRunLifecycle(opts: RunLifecycleOptions): RunLifecycle {
  const proc = opts.proc ?? process;
  const warn = opts.warn ?? ((line: string) => console.warn(line));
  const runId = opts.runId ?? opts.startedAt.toISOString();
  let closed = false;
  let status: RunStatusValue | undefined;
  let disposeGuards: (() => void) | undefined;
  let recorded: Record<string, unknown> = {};
  let recordedFailedTargets: RunFailedTarget[] = [];

  const writeMarker = (patch: MarkerPatch): void => {
    const marker = {
      schema_version: RUN_STATUS_SCHEMA_VERSION, // #3436: 1.1 adds degraded_passes
      assessment_type: opts.assessmentType,
      app: opts.app,
      run_id: runId,
      started_at: opts.startedAt.toISOString(),
      ...(opts.extra ?? {}),
      ...recorded,
      swao_version: opts.swaoVersion,
      ...patch,
    };
    status = patch.status;
    try {
      writeFileSync(join(opts.runDir, RUN_STATUS_FILE), JSON.stringify(marker, null, 2) + '\n', 'utf-8');
    } catch (err) {
      // The marker is diagnostic; never let it mask the original failure.
      warn(`[warn] could not write ${RUN_STATUS_FILE}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const lifecycle: RunLifecycle = {
    get closed() { return closed; },
    get status() { return status; },

    markStarted() {
      writeMarker({ status: 'started' });
    },

    recordTargets(record) {
      if (closed) return;
      recorded = {
        ...recorded,
        ...(record.targets && record.targets.length > 0 ? { targets: record.targets } : {}),
        ...(record.resolvedTargets && record.resolvedTargets.length > 0 ? { resolved_targets: record.resolvedTargets } : {}),
      };
      if (record.failedTargets) recordedFailedTargets = [...record.failedTargets];
      // Keep the open marker current so a reader sees the targets while the run continues.
      if (status !== undefined) writeMarker({ status });
    },

    fail(failure) {
      if (closed) return;
      closed = true;
      disposeGuards?.();
      const finishedAt = new Date();
      try {
        opts.onFail?.(failure, { elapsedMs: finishedAt.getTime() - opts.startedAt.getTime() });
      } catch { /* events are best-effort */ }
      writeMarker({
        status: failure.status,
        finished_at: finishedAt.toISOString(),
        exit_code: failure.exitCode,
        reason: failure.reason,
        ...(() => {
          const targets = [...recordedFailedTargets, ...(failure.failedTargets ?? [])];
          return targets.length > 0 ? { failed_targets: targets } : {};
        })(),
      });
    },

    complete(completion = {}) {
      if (closed) return;
      closed = true;
      disposeGuards?.();
      const targets = [...recordedFailedTargets, ...(completion.failedTargets ?? [])];
      const passes = completion.failedPasses ?? [];
      const degraded = completion.degradedPasses ?? [];
      const partial = targets.length > 0 || passes.length > 0 || degraded.length > 0;
      writeMarker({
        status: partial ? 'partial' : 'complete',
        finished_at: new Date().toISOString(),
        exit_code: completion.exitCode ?? 0,
        ...(targets.length > 0 ? { failed_targets: targets } : {}),
        ...(passes.length > 0 ? { failed_passes: passes } : {}),
        ...(degraded.length > 0 ? { degraded_passes: degraded } : {}),
      });
    },

    installProcessGuards() {
      const onSigint = () => { lifecycle.fail({ status: 'aborted', reason: 'SIGINT', exitCode: 130 }); proc.exit(130); };
      const onSigterm = () => { lifecycle.fail({ status: 'aborted', reason: 'SIGTERM', exitCode: 143 }); proc.exit(143); };
      const onUncaught = (err: Error) => {
        lifecycle.fail({ status: 'failed', reason: `uncaught: ${err?.message ?? String(err)}`, exitCode: 1 });
        console.error(`[error] ${err?.message ?? String(err)}`);
        proc.exit(1);
      };
      // Synchronous last resort: any process.exit() (or a natural exit) while
      // the run is still open closes it as failed with that exit code.
      const onExit = (code: number) => {
        if (closed) return;
        lifecycle.fail({ status: 'failed', reason: `process exited with code ${code} before the run completed`, exitCode: code });
      };
      proc.once('SIGINT', onSigint);
      proc.once('SIGTERM', onSigterm);
      // Prepend so this runs before the host crash handler in index.ts, which
      // calls process.exit(1) and would otherwise pre-empt the closing events.
      proc.prependOnceListener('uncaughtException', onUncaught);
      proc.on('exit', onExit);
      let disposed = false;
      disposeGuards = () => {
        if (disposed) return;
        disposed = true;
        proc.removeListener('SIGINT', onSigint);
        proc.removeListener('SIGTERM', onSigterm);
        proc.removeListener('uncaughtException', onUncaught);
        proc.removeListener('exit', onExit);
      };
      return disposeGuards;
    },
  };
  return lifecycle;
}
