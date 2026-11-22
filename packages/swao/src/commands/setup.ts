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

// #4197 SET-08 (Design 125 section 8, Q-03): `swao setup` opens the setup
// wizard; `swao setup --type <type>` runs one assessment type's branch, and
// with `--non-interactive` (or without a terminal) prints that branch's
// scoped health result and what is missing, records the branch state in
// workspace.setup_state and exits 1 when the branch needs attention.

import type { Command } from 'commander';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { findWorkspace, parseSetupAssessmentType, SETUP_ASSESSMENT_TYPES, isSetupTypeAvailable, SETUP_ASSESSMENT_TYPE_MIN_TIER, type SetupAssessmentType } from '@swao/core';
import { runTuiInAltScreen } from '../tui/run-app.js';
import { LicenseGuard } from '../license/license-guard.js';
import { defaultSetupRegistry } from '../setup/index.js';
import { checkBranch, formatBranchCheck, type BranchCheckResult } from '../setup/branch-check.js';
import { migrateAssessmentTypes } from '../setup/workspace-state.js';

export interface SetupCommandDeps {
  /** Opens the TUI wizard (default: the alt-screen TUI). */
  openTui?: (type: SetupAssessmentType | undefined) => Promise<void>;
  /** Non-interactive branch check (default: checkBranch with the shipped registry). */
  check?: (workspaceRoot: string, type: SetupAssessmentType) => Promise<BranchCheckResult>;
  isTty?: () => boolean;
  tier?: () => 'community' | 'consultant' | 'enterprise';
}

function defaultTier(): 'community' | 'consultant' | 'enterprise' {
  try { return LicenseGuard.load().state.tier; } catch { return 'community'; }
}

export function registerSetup(program: Command, deps: SetupCommandDeps = {}): void {
  const openTui = deps.openTui ?? ((type) => runTuiInAltScreen('setup', type ? { setupMode: { kind: 'branch', type } } : undefined));
  const check = deps.check ?? ((ws, type) => checkBranch(defaultSetupRegistry(), ws, type));
  const isTty = deps.isTty ?? (() => Boolean(process.stdin.isTTY));
  const tier = deps.tier ?? defaultTier;
  program
    .command('setup')
    .description('Guided setup wizard: workspace setup, then the setup of each assessment type with its health check.')
    .option('--type <type>', `Set up one assessment type: ${SETUP_ASSESSMENT_TYPES.join(', ')}`)
    .option('--non-interactive', 'With --type: print the scoped health result and the missing items instead of opening the wizard')
    .option('--workspace <path>', 'Workspace path (default: the workspace of the current directory)')
    .option('--json', 'With --non-interactive: print the result as JSON')
    .action(async (opts: { type?: string; nonInteractive?: boolean; workspace?: string; json?: boolean }) => {
      const type = opts.type === undefined ? undefined : parseSetupAssessmentType(opts.type);
      if (opts.type !== undefined && type === undefined) {
        console.error(`[error] unknown --type ${opts.type}; expected one of ${SETUP_ASSESSMENT_TYPES.join(', ')}`);
        process.exit(2);
      }
      if (opts.nonInteractive && type === undefined) {
        console.error('[error] --non-interactive needs --type <type>');
        process.exit(2);
      }
      if (type !== undefined && !isSetupTypeAvailable(type, tier())) {
        console.error(`[LICENSE] the ${type} assessment needs the ${SETUP_ASSESSMENT_TYPE_MIN_TIER[type]} tier; its setup is shown greyed out in the wizard`);
        process.exit(2);
      }
      const interactive = !opts.nonInteractive && isTty();
      const findWs = (): string => {
        const ws = opts.workspace ? resolve(opts.workspace) : findWorkspace(process.cwd());
        if (!ws || !existsSync(resolve(ws, '.swao.yml'))) {
          console.error('[error] no workspace found (.swao.yml); run swao init first or pass --workspace');
          process.exit(2);
        }
        return ws;
      };
      if (interactive) {
        // A branch needs a workspace (its steps write to it); the plain wizard starts with Init.
        if (type !== undefined) {
          const ws = findWs();
          if (opts.workspace) process.chdir(ws); // the wizard finds the workspace from the working directory
        }
        await openTui(type);
        return;
      }
      if (type === undefined) {
        console.error('  swao setup requires an interactive terminal (TTY); use --type <type> --non-interactive for a branch check.');
        process.exit(1);
      }
      const ws = findWs();
      migrateAssessmentTypes(ws);
      const result = await check(ws, type);
      if (opts.json) console.log(JSON.stringify(result, null, 2));
      else for (const line of formatBranchCheck(result)) console.log(line);
      process.exit(result.state === 'needs-attention' ? 1 : 0);
    });
}
