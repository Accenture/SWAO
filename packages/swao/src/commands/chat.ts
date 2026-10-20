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
// Enterprise-gated (FEATURE_GATES['chat'], licence tier matrix F-112): the gate
// fires before launching the TUI. A failed gate prints the [LICENSE] block via
// the shared printers and exits non-zero (#3318): tier 1, budget 2, invalid
// licence 3. It used to escape as an unhandled LicenseTierError (a pkg stack
// trace and exit 7, or exit 0 on the Enterprise binary).
//
// TTY guard: the Ink TUI requires an interactive terminal; piped/CI
// invocations exit 1 early rather than producing garbled output.
//
// The CLI command routes to the 'chat' screen via runTuiInAltScreen.
// All session logic (MCP, LLM, history) lives in useChatSession.

import type { Command } from 'commander';
import { LicenseGuard, LicenseTierError, LicenseLimitError, LicenseInvalidError } from '@swao/core';
import { runTuiInAltScreen } from '../tui/run-app.js';
import { printLicenseGateError, printLicenseLimitError, printLicenseInvalidError } from '../lib/license-gate-error.js';

/** Human label printed in the [LICENSE] block (#3318). */
export const CHAT_FEATURE_LABEL = 'swao chat';

/**
 * Run the chat licence gate. Returns on success; on failure prints the
 * [LICENSE] block and exits non-zero (never throws a licence error).
 */
export function gateChat(): void {
  try {
    LicenseGuard.load().requireFeature('chat');
  } catch (err) {
    if (err instanceof LicenseTierError) printLicenseGateError(CHAT_FEATURE_LABEL, err.required, err.current);
    if (err instanceof LicenseLimitError) printLicenseLimitError(err);
    if (err instanceof LicenseInvalidError) printLicenseInvalidError(err.message);
    throw err;
  }
}

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
      gateChat();
      if (!process.stdin.isTTY) {
        console.error('[error] swao chat requires an interactive terminal (TTY).');
        console.error('        Use --help to see available options.');
        process.exit(1);
      }
      await runTuiInAltScreen('chat');
    });
}
