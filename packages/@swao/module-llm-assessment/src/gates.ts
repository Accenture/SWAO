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
// The tier gate (Consultant/Enterprise) is enforced in llm-type.ts via
// LicenseGuard.requireTier -- the same mechanism as the HTML editor gate
// (#1229) -- and additionally by the module's manifest tier, which keeps
// this module out of the Community binary entirely.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

export type PreconditionFailure = 'no-app' | 'no-runs' | 'no-completed-run';

export interface PreconditionResult {
  ok: boolean;
  reason?: PreconditionFailure;
  /** Operator-facing message; names the fix (092 s3.0). */
  message?: string;
  /** Latest completed run -- the cost-preview token-history source. */
  latestRun?: {
    runTs: string;
    manifestPath: string;
    passStats: NonNullable<RunManifestLite['pass_stats']>;
  };
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
  for (const runTs of [...runDirs].sort().reverse()) {
    const manifestPath = join(runsDir, runTs, 'run-manifest.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = readManifest(manifestPath);
    if (isCompleted(manifest)) {
      return {
        ok: true,
        latestRun: {
          runTs,
          manifestPath,
          passStats: manifest.pass_stats ?? [],
        },
      };
    }
  }

  return {
    ok: false,
    reason: 'no-completed-run',
    message: `App "${appId}" has run directories but no COMPLETED run (manifest with finished_at + executed passes). Re-run \`swao assess --app ${appId}\` to completion first.`,
  };
}
