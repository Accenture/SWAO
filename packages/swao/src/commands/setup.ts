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

import type { Command } from 'commander';
import { runTuiInAltScreen } from '../tui/run-app.js';

export function registerSetup(program: Command): void {
  program
    .command('setup')
    .description('Guided setup wizard: initialise workspace, configure credentials, and run health check.')
    .action(async () => {
      if (!process.stdin.isTTY) {
        console.error('  swao setup requires an interactive terminal (TTY).');
        process.exit(1);
      }
      await runTuiInAltScreen('setup');
    });
}
