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

import type { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { findWorkspace } from '@swao/core';

// ---------------------------------------------------------------------------
// Accepted-run file schema
// ---------------------------------------------------------------------------

export interface AcceptedRun {
  run_id: string;
  accepted_at: string;
  accepted_by?: string;
  note?: string;
}

export const ACCEPTED_RUN_FILENAME = 'accepted-run.json';

export function resolveAcceptedRunPath(workspaceAppDir: string): string {
  return join(workspaceAppDir, 'wsp', ACCEPTED_RUN_FILENAME);
}

export function loadAcceptedRun(workspaceAppDir: string): AcceptedRun | null {
  const p = resolveAcceptedRunPath(workspaceAppDir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as AcceptedRun;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerAccept(program: Command): void {
  program
    .command('accept')
    .description('Lock an assessment run as the accepted result. Subsequent swao assess runs will warn before overwriting.')
    .option('--run <ts>', 'Run timestamp to accept (defaults to latest run)')
    .option('--app <id>', 'App workspace to accept (required for multi-app workspaces)')
    .option('--workspace <path>', 'Workspace path (default: current directory)')
    .option('--note <text>', 'Optional note explaining the acceptance decision')
    .option('--unset', 'Remove the accepted-run lock (returns workspace to normal)')
    .action((opts: { run?: string; app?: string; workspace?: string; note?: string; unset?: boolean }) => {
      const workspaceRoot = opts.workspace ? opts.workspace : (findWorkspace(process.cwd()) ?? process.cwd());
      const workspaceAppDir = opts.app ? join(workspaceRoot, 'apps', opts.app) : workspaceRoot;
      const acceptedRunPath = resolveAcceptedRunPath(workspaceAppDir);

      if (opts.unset) {
        if (!existsSync(acceptedRunPath)) {
          console.log('[info] No accepted run set -- nothing to unset.');
          return;
        }
        unlinkSync(acceptedRunPath);
        console.log('[ok] Accepted run cleared. swao assess will proceed without guard.');
        return;
      }

      // Resolve the run timestamp to accept
      const runsDir = join(workspaceAppDir, 'wsp', 'runs');
      let runTs = opts.run;
      if (!runTs) {
        if (!existsSync(runsDir)) {
          console.error('[error] No runs found. Run swao assess first.');
          process.exit(1);
        }
        const runs = readdirSync(runsDir)
          .filter((name) => /^\d{4}-\d{2}-\d{2}T/.test(name))
          .sort()
          .reverse();
        runTs = runs[0];
        if (!runTs) {
          console.error('[error] No assessment runs found in wsp/runs/.');
          process.exit(1);
        }
      }

      const runDir = join(runsDir, runTs);
      if (!existsSync(runDir)) {
        console.error(`[error] Run directory not found: ${runDir}`);
        process.exit(1);
      }

      const accepted: AcceptedRun = {
        run_id: runTs,
        accepted_at: new Date().toISOString(),
        accepted_by: process.env['GIT_AUTHOR_NAME'] ?? process.env['USERNAME'] ?? 'unknown',
        note: opts.note,
      };

      writeFileSync(acceptedRunPath, JSON.stringify(accepted, null, 2), 'utf-8');
      console.log(`[ok]  Run ${runTs} accepted as canonical result.`);
      console.log(`      wsp/accepted-run.json written.`);
      if (opts.note) console.log(`      Note: ${opts.note}`);
      console.log(`\n      Run swao assess --force to override this lock.`);
    });
}
