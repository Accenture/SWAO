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

// swao chat -- interactive multi-turn portfolio chat (#2779).
//
// Enterprise-gated: LicenseGuard.requireTier('enterprise') fires before
// launching the TUI so Community/Consultant binaries exit 1 with a clear
// message rather than opening the screen and failing inside.
//
// TTY guard: the Ink TUI requires an interactive terminal; piped/CI
// invocations exit 1 early rather than producing garbled output.
//
// The CLI command routes to the 'chat' screen via runTuiInAltScreen.
// All session logic (MCP, LLM, history) lives in useChatSession.

import type { Command } from 'commander';
import { LicenseGuard } from '@swao/core';
import { runTuiInAltScreen } from '../tui/run-app.js';

export function registerChat(program: Command): void {
  program
    .command('chat')
    .description('Interactive multi-turn portfolio chat -- discuss assessments with an LLM (Enterprise)')
    .option('--app <id>', 'Application ID to focus context on')
    .option('--workspace <path>', 'Workspace root (default: current directory)')
    .option('--model <name>', 'LLM model override (defaults to connector default)')
    .option('--no-auto-mcp', 'Do not auto-start the MCP HTTP server')
    .addHelpText('after', `
Examples:
  swao chat
  swao chat --app sovereign-health
  swao chat --workspace /path/to/portfolio --model claude-opus-5

Requires an Enterprise licence and a configured LLM gateway connector.
Run \`swao setup\` to configure the LLM gateway, or \`swao license\` to upgrade.`)
    .action(async (_opts: { app?: string; workspace?: string; model?: string; autoMcp: boolean }) => {
      LicenseGuard.load().requireTier('enterprise', { feature: 'swao chat' });
      if (!process.stdin.isTTY) {
        console.error('[error] swao chat requires an interactive terminal (TTY).');
        console.error('        Use --help to see available options.');
        process.exit(1);
      }
      await runTuiInAltScreen('chat');
    });
}
