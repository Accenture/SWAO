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

// Run retention (#1016) honouring run-status.json (#3283).
//
// `workspace.run_retention.keep_latest: N` keeps the N latest USABLE runs:
// runs whose marker says `complete` or `partial`, or (older runs without a
// marker) runs with a run-manifest.json. Failed, aborted and stale started
// runs never count towards N, so a burst of failed runs cannot push the last
// good result out. Everything older than the oldest kept run is removed,
// whatever its status; unusable runs newer than that stay for diagnosis
// (the health check flags them). The current run is always kept.

import { readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { isRunUsable } from '@swao/core';

const RUN_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}/;

/** Run dir names to delete (pure; `isUsable` is injected for tests). */
export function selectRunsToDelete(
  runNames: readonly string[],
  opts: { keepLatest: number; currentRun?: string; isUsable: (name: string) => boolean },
): string[] {
  if (!(opts.keepLatest > 0)) return [];
  const runs = runNames.filter((n) => RUN_DIR_PATTERN.test(n)).sort();
  // Within the limit (all runs counted): nothing to do, as before #3283.
  if (runs.length <= opts.keepLatest) return [];
  const usable = runs.filter((n) => n === opts.currentRun || opts.isUsable(n));
  // No usable run at all: the pre-#3283 count rule over every run.
  if (usable.length === 0) return runs.slice(0, runs.length - opts.keepLatest);
  const oldestKept = usable[Math.max(0, usable.length - opts.keepLatest)]!;
  return runs.filter((n) => n < oldestKept && n !== opts.currentRun);
}

/** Apply retention to `<wspDir>/runs`; returns the removed run dir names. */
export function applyRunRetention(wspDir: string, keepLatest: number, currentRun?: string): string[] {
  const runsDir = join(wspDir, 'runs');
  const toDelete = selectRunsToDelete(readdirSync(runsDir), {
    keepLatest,
    currentRun,
    isUsable: (name) => isRunUsable(join(runsDir, name)),
  });
  for (const dir of toDelete) rmSync(join(runsDir, dir), { recursive: true, force: true });
  return toDelete;
}
