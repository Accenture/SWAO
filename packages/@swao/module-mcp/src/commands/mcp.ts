// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  MCP module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import type { Command } from 'commander';
import { startMcpServer, type McpHostDeps } from '../server.js';

export function registerMcp(program: Command, deps: McpHostDeps): void {
  program
    .command('mcp')
    .description(
      'Start the SWAO MCP server. ' +
      'Default (no flags): stdio transport for Claude Desktop. ' +
      'Use --http to run an HTTP server on localhost for Claude Code.',
    )
    .option('--http', 'Use HTTP transport instead of stdio')
    .option('--port <port>', 'HTTP server port', '3737')
    .option(
      '--workspace <path>',
      'Pin the workspace root path (overrides cwd-based detection). ' +
      'Useful when launching the MCP server from a different directory than the workspace.',
    )
    .action(async (opts: { http?: boolean; port: string; workspace?: string }) => {
      // #0574: the host injects the resolved swao CLI invocation (McpHostDeps)
      // so the MCP tools spawn the correct entry after this module's extraction.
      // #1203: workspace option pins the workspace for all workspace-dependent tools.
      await startMcpServer(
        { http: opts.http ?? false, port: parseInt(opts.port, 10), workspace: opts.workspace },
        deps,
      );
    });
}
