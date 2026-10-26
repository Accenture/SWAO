// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// run-status.json: per-run lifecycle marker (#3245, #3281, #3283).
//
// One marker for application, service and LZ catalogue runs (owner decision
// 2026-10-17, #3283 Option B). Written into wsp/runs/<ts>/ at run start
// (`started`) and closed on every exit path:
//
//   complete  the run finished normally
//   partial   the run finished, but some LZ targets were skipped
//             (`failed_targets`), some passes failed (`failed_passes`) or
//             some passes are not fully evaluated (`degraded_passes`, #3436)
//   failed    the run stopped before completion (error, gate exit, every LZ
//             target failed); no run-manifest.json is written
//   aborted   SIGINT / SIGTERM
//
// The marker is a separate file so the core run-context schema and the
// meaning of run-manifest.json ("completed", #1023) stay unchanged. Readers
// use isRunUsable(): with a marker only `complete` and `partial` runs count;
// a run without a marker (older runs) keeps the manifest-based rule.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { PassDegradedEntrySchema } from './pass-coverage.js';

export const RUN_STATUS_FILE = 'run-status.json';

export const RunStatusValueSchema = z.enum(['started', 'complete', 'partial', 'failed', 'aborted']);
export type RunStatusValue = z.infer<typeof RunStatusValueSchema>;

/** A target skipped by the run (unknown region, a failed fit or schema check). */
export const RunStatusFailedTargetSchema = z.object({
  provider: z.string(),
  region: z.string(),
  reason: z.string(),
}).passthrough();
export type RunStatusFailedTarget = z.infer<typeof RunStatusFailedTargetSchema>;

/** A configured geography resolved to its default region (#3281). */
export const RunStatusResolvedTargetSchema = z.object({
  requested: z.string(),
  resolved: z.string(),
  geography: z.string(),
}).passthrough();
export type RunStatusResolvedTarget = z.infer<typeof RunStatusResolvedTargetSchema>;

/** #3436: schema_version the writer emits; 1.1 adds degraded_passes (additive). */
export const RUN_STATUS_SCHEMA_VERSION = '1.1' as const;

export const RunStatusSchema = z.object({
  schema_version: z.union([z.literal('1.0'), z.literal('1.1')]),
  assessment_type: z.enum(['application', 'service', 'landing-zone-catalog']),
  app: z.string(),
  run_id: z.string(),
  status: RunStatusValueSchema,
  started_at: z.string(),
  finished_at: z.string().optional(),
  exit_code: z.number().int().optional(),
  reason: z.string().optional(),
  failed_targets: z.array(RunStatusFailedTargetSchema).optional(),
  targets: z.array(z.string()).optional(),
  resolved_targets: z.array(RunStatusResolvedTargetSchema).optional(),
  /** #3283: passes that failed in a `partial` application or service run. */
  failed_passes: z.array(z.string()).optional(),
  /**
   * #3436 (1.1): passes that ran but are not fully evaluated (Pass 11 with
   * controls that have no model verdict). Non-empty makes the run `partial`:
   * the result is usable, but compliance was not fully evaluated.
   */
  degraded_passes: z.array(PassDegradedEntrySchema).optional(),
  swao_version: z.string(),
}).passthrough();
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** The marker of a run dir; undefined when absent or not valid (older runs have none). */
export function readRunStatus(runDir: string): RunStatus | undefined {
  const p = join(runDir, RUN_STATUS_FILE);
  if (!existsSync(p)) return undefined;
  try {
    const r = RunStatusSchema.safeParse(JSON.parse(readFileSync(p, 'utf-8')));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

/** Targets skipped by a `partial` run (empty for any other status or no marker). */
export function readSkippedTargets(runDir: string): RunStatusFailedTarget[] {
  const s = readRunStatus(runDir);
  return s?.status === 'partial' ? (s.failed_targets ?? []) : [];
}

/** Statuses whose run produced a usable result (#3283). */
export const USABLE_RUN_STATUSES: readonly RunStatusValue[] = ['complete', 'partial'];

/** Default age after which a run still marked `started` counts as stale (6 hours). */
export const RUN_STATUS_STALE_MS = 6 * 60 * 60 * 1000;

/**
 * Whether a run dir holds a usable result. With a marker: status `complete`
 * or `partial`. Without a marker (runs before #3283, or an unreadable
 * marker): today's rule, a run-manifest.json exists.
 */
export function isRunUsable(runDir: string): boolean {
  const s = readRunStatus(runDir);
  if (s) return USABLE_RUN_STATUSES.includes(s.status);
  // No marker, or one that does not parse: the manifest rule.
  return existsSync(join(runDir, 'run-manifest.json'));
}

/** True when a run has been `started` for longer than `staleMs` without closing. */
export function isRunStale(status: RunStatus, now: Date = new Date(), staleMs = RUN_STATUS_STALE_MS): boolean {
  if (status.status !== 'started') return false;
  const t = Date.parse(status.started_at);
  return Number.isFinite(t) && now.getTime() - t > staleMs;
}
