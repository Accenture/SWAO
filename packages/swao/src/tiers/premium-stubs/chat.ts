// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Build-time stand-in for `commands/chat.ts` in the Community and Consultant
 * bundles (#3348 B-02, Design 122). SWAO Chat (F-112) is Enterprise-only and
 * runs on the MCP tools, so build-lib.mjs replaces the chat command for those
 * tiers. Same command name, description and options as the real one, so
 * `swao --help` is unchanged; running it prints the [LICENSE] block and exits 1,
 * as before.
 */

import type { Command } from 'commander';
import { refuseEnterpriseFeature } from './module-mcp.js';

export function registerChat(program: Command): void {
  program
    .command('chat')
    .description('Interactive multi-turn portfolio chat -- discuss assessments with an LLM (Enterprise)')
    .option('--app <id>', 'Application ID to focus context on')
    .option('--workspace <path>', 'Workspace root (default: current directory)')
    .option('--model <name>', 'LLM model override (defaults to connector default)')
    .option('--no-auto-mcp', 'Do not auto-start the MCP HTTP server')
    // Same help text as the real command (commands/chat.ts); pinned by premium-stubs.test.ts.
    .addHelpText('after', `
Examples:
  swao chat
  swao chat --app sovereign-health
  swao chat --workspace /path/to/portfolio --model claude-opus-5

Requires an Enterprise licence and a configured LLM gateway connector.
Run \`swao setup\` to configure the LLM gateway, or \`swao license\` to upgrade.`)
    .action(() => refuseEnterpriseFeature('swao chat', 'SWAO Chat'));
}
