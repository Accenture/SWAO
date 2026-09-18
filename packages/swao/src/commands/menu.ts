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

type Screen = 'type-select' | 'main' | 'setup' | 'doctor' | 'assess' | 'report' | 'generate-tf' | 'license' | 'credentials';

const VALID_SCREENS: Screen[] = ['type-select', 'main', 'setup', 'doctor', 'assess', 'report', 'generate-tf', 'license', 'credentials'];

export function registerMenu(program: Command): void {
  program
    .command('menu')
    .description('Open the interactive SWAO TUI (setup wizard, assess, report, license, credentials).')
    .option('--screen <name>', `Start on a specific screen (${VALID_SCREENS.join(', ')})`, 'main')
    .action(async (opts: { screen: string }) => {
      if (!process.stdin.isTTY) {
        console.error('  swao menu requires an interactive terminal (TTY).');
        process.exit(1);
      }
      const screen = VALID_SCREENS.includes(opts.screen as Screen)
        ? (opts.screen as Screen)
        : 'main';
      await runTuiInAltScreen(screen);
    });
}
