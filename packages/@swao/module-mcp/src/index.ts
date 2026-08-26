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

import type { SwaoModuleManifest } from '@swao/core';

/**
 * @swao/module-mcp -- the SWAO Model Context Protocol server (stdio + HTTP
 * transports) and the `mcp` CLI command (ADR-0048 modular architecture,
 * Phase 4, #0574).
 *
 * The MCP tools spawn the host swao CLI to run assessments / reports / etc.
 * rather than importing host modules, so the package depends only on
 * `@swao/core`, the MCP SDK, commander and js-yaml. Because spawning needs the
 * host CLI path (which `__dirname` no longer resolves after extraction), the
 * host injects it via `McpHostDeps`, mirroring the #0573 doctor DI pattern.
 *
 * `registerMcp` therefore requires the injected deps; like the doctor module,
 * the manifest omits a `commands` contribution (a declarative `register` could
 * not supply the host deps). The host wires `registerMcp(program, deps)` directly
 * in its CLI bootstrap.
 */

export { registerMcp } from './commands/mcp.js';
export { startMcpServer, SWAO_MCP_TOOLS, resolveSpawn } from './server.js';
export type { McpHostDeps } from './server.js';

// Re-exports consumed by the host-side MCP integration tests (host -> module
// imports are allowed). Tool surface + the pure assess-progress helpers.
export {
  handleSignals,
  parseAssessProgress,
  buildAssessAcknowledgement,
  runSwaoAssessAsync,
  handleAssessWithProgress,
} from './server.js';
export type {
  AssessProgressEvent,
  AssessProgressNotifier,
  AssessAcknowledgement,
} from './server.js';

export const manifest: SwaoModuleManifest = {
  id: '@swao/module-mcp',
  version: '0.1.0',
  tier: 'community',
  contributions: {},
};
