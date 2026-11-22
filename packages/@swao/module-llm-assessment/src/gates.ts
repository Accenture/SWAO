// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Precondition gate for the LLM Assessment (#1420, Design 092 s3.0).
//
// "No completed App Assessment for an app, no LLM Assessment against it."
// The gate scans apps/<appId>/wsp/runs/ for the latest run whose manifest
// parses and reports a finished pass suite. The latest completed run also
// supplies the per-pass token history the cost preview needs (092 s5.4).
//
// There is no tier gate: the LLM Assessment is available on all tiers
// (FEATURE_GATES['llm-assessment'] = 'community'; #3161, 2026-10-17).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRunStatus } from '@swao/core';

/** Minimal manifest shape the gate needs; tolerant of older manifests. */
interface RunManifestLite {
  finished_at?: string;
  passes_executed?: string[];
  pass_stats?: Array<{
    num?: string;
    pass?: string;
    tokens_in?: number;
    tokens_out?: number;
    cost_usd?: number;
    llm_calls?: number;
  }>;
}

export type PreconditionFailure = 'no-app' | 'no-runs' | 'no-completed-run' | 'no-application-run';

/** #4242: one completed Application Assessment run (newest first in applicationRuns). */
export interface ApplicationRunRef {
  runTs: string;
  manifestPath: string;
  /** Passes the run executed (the suite the LLM comparison refers to). */
  passCount: number;
  finishedAt: string;
}

export interface PreconditionResult {
  ok: boolean;
  reason?: PreconditionFailure;
  /** Operator-facing message; names the fix (092 s3.0). */
  message?: string;
  /** #4242: plain detail for the picker (which run type blocked the app). */
  detail?: string;
  /** Latest completed APPLICATION run (#4242): the suite reference and cost-preview history. */
  latestRun?: {
    runTs: string;
    manifestPath: string;
    passStats: NonNullable<RunManifestLite['pass_stats']>;
    /** #4242: always 'application'; LZ Catalog, LZ Live, service and challenge runs are skipped. */
    assessmentType: 'application';
    passCount: number;
    finishedAt: string;
  };
  /** #4242: every completed application run, newest first. */
  applicationRuns?: ApplicationRunRef[];
}

/**
 * #4242: assessment type of a run directory. run-status.json first, then
 * run-context.yaml (`assessment_type:`), then the run's files: wsp.yaml
 * marks an application run, lz fit pass files an LZ Catalog run. A run
 * without any marker counts as an application run (oldest layouts).
 */
export function runAssessmentType(runDir: string, manifest?: RunManifestLite | null): string {
  try {
    const st = readRunStatus(runDir);
    if (st?.assessment_type) return st.assessment_type;
  } catch { /* fall through */ }
  try {
    const ctx = readFileSync(join(runDir, 'run-context.yaml'), 'utf-8');
    const m = ctx.match(/^assessment_type:\s*['"]?([A-Za-z-]+)/m);
    if (m?.[1]) return m[1];
  } catch { /* no run-context.yaml */ }
  if (existsSync(join(runDir, 'wsp.yaml'))) return 'application';
  try {
    if (readdirSync(join(runDir, 'passes')).some((f) => /^lz-(catalogue-)?fit/.test(f))) return 'landing-zone-catalog';
  } catch { /* no passes dir */ }
  const executed = manifest?.passes_executed ?? [];
  if (executed.length > 0 && executed.every((p) => /^lz[_-]/.test(p))) return 'landing-zone-catalog';
  return 'application';
}

function readManifest(path: string): RunManifestLite | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as RunManifestLite;
  } catch {
    return null;
  }
}

/** A run counts as completed when its manifest parses, records finished_at,
 *  and executed at least one pass. */
function isCompleted(m: RunManifestLite | null): m is RunManifestLite {
  return m !== null
    && typeof m.finished_at === 'string'
    && Array.isArray(m.passes_executed)
    && m.passes_executed.length > 0;
}

/**
 * Design 092 s3.0 precondition 1: the selected app must have at least one
 * completed App Assessment run. Pure function; the caller logs and decides.
 */
export function checkAppAssessmentPrecondition(
  workspacePath: string,
  appId: string,
): PreconditionResult {
  const appDir = join(workspacePath, 'apps', appId);
  if (!existsSync(appDir)) {
    return {
      ok: false,
      reason: 'no-app',
      message: `App "${appId}" not found under apps/. Configure the app first (swao init / TUI setup).`,
    };
  }

  const runsDir = join(appDir, 'wsp', 'runs');
  if (!existsSync(runsDir)) {
    return {
      ok: false,
      reason: 'no-runs',
      message: `App "${appId}" has no assessment runs. Run \`swao assess --app ${appId}\` first -- the LLM Assessment requires a completed Application Assessment (Design 092 s3.0).`,
    };
  }

  let runDirs: string[] = [];
  try {
    runDirs = readdirSync(runsDir).filter((d) => !d.startsWith('.'));
  } catch {
    runDirs = [];
  }

  // Run directories are ISO-timestamp-named; lexicographic sort = newest last.
  // #4242: only APPLICATION runs count. An LZ Catalog run after the
  // application run must not become the suite (2 lz_fit passes instead of 14).
  const applicationRuns: ApplicationRunRef[] = [];
  let latest: NonNullable<PreconditionResult['latestRun']> | undefined;
  let newestOther: { runTs: string; type: string } | undefined;
  for (const runTs of [...runDirs].sort().reverse()) {
    const manifestPath = join(runsDir, runTs, 'run-manifest.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = readManifest(manifestPath);
    if (!isCompleted(manifest)) continue;
    const type = runAssessmentType(join(runsDir, runTs), manifest);
    if (type !== 'application') {
      newestOther ??= { runTs, type };
      continue;
    }
    const ref: ApplicationRunRef = {
      runTs, manifestPath, passCount: manifest.passes_executed?.length ?? 0, finishedAt: manifest.finished_at ?? '',
    };
    applicationRuns.push(ref);
    latest ??= { ...ref, passStats: manifest.pass_stats ?? [], assessmentType: 'application' };
  }
  if (latest) return { ok: true, latestRun: latest, applicationRuns };
  if (newestOther) {
    return {
      ok: false,
      reason: 'no-application-run',
      detail: `only ${newestOther.type} runs (newest ${newestOther.runTs})`,
      message: `App "${appId}" has no completed Application Assessment run; its newest completed run (${newestOther.runTs}) is a ${newestOther.type} run. Run \`swao assess --app ${appId}\` first: the LLM Assessment compares the providers on the application pass suite (Design 092 s3.0).`,
    };
  }

  return {
    ok: false,
    reason: 'no-completed-run',
    message: `App "${appId}" has run directories but no COMPLETED run (manifest with finished_at + executed passes). Re-run \`swao assess --app ${appId}\` to completion first.`,
  };
}
