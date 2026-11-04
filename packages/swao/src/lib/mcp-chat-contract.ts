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
 * Host-side contract for the Enterprise MCP server (F-105) and SWAO Chat
 * (F-112), #3348 B-01 / B-02 step 2a (Design 122, #3604).
 *
 * The shared host code (bootstrap.ts, the TUI, `swao init --mcp`, the Setup
 * Wizard) uses these types and slots only and never imports
 * `@swao/module-mcp`, `commands/chat.js` or `tui/screens/ChatScreen.js`. The
 * tier entries fill the slots: the Enterprise entry with the real modules
 * (tiers/mcp-chat-enterprise.ts, where tsc checks the real exports against
 * this contract), the Community and Consultant entries with
 * src/tiers/premium-stubs/. Pinned by mcp-chat-boundary.test.ts.
 *
 * The types mirror the module's exports (module-mcp client-install.ts,
 * agent-templates.ts, start-prompt.ts, server.ts, commands/mcp.ts).
 */

import type { Command } from 'commander';
import type { SWAO_MCP_PROFILE_NAMES } from '@swao/core';

export type McpClientName = 'claude-desktop' | 'claude-code' | 'kilo' | 'cursor' | 'vscode';
export type McpInstallScope = 'user' | 'project';
export type McpTransport = 'stdio' | 'http';
export type McpProfileName = (typeof SWAO_MCP_PROFILE_NAMES)[number];
/** Clients that take an agent file. */
export type AgentClient = 'kilo' | 'claude-code';

/** Same literal as module-mcp client-install.ts; pinned by mcp-chat-boundary.test.ts. */
export const DEFAULT_MCP_HTTP_URL = 'http://localhost:3737/mcp';

/** One TUI main menu entry for the MCP `start` prompt (Design 116 REQ-12.3). */
export interface MainMenuEntry {
  key: string;
  label: string;
  detail: string;
  what: string;
  comingSoon?: boolean;
}

/** The swao CLI the MCP server spawns for tool calls; computed by the tier entry. */
export interface McpHostDeps {
  swaoCliPath: string;
  cliIsScript: boolean;
  mainMenu?: () => ReadonlyArray<MainMenuEntry>;
}

export interface McpInstallBinary {
  path: string;
  args: ReadonlyArray<string>;
}

/** What the host's writer receives for one `swao mcp install --client` run. */
export interface McpClientInstallRequest {
  client: McpClientName;
  scope: McpInstallScope;
  profile: McpProfileName;
  profileExplicit: boolean;
  tools: ReadonlyArray<string>;
  transport: McpTransport;
  url: string;
  agent: boolean;
  dryRun: boolean;
  uninstall: boolean;
  workspace?: string;
  binary?: McpInstallBinary;
  projectDir: string;
  version: string;
}

export interface McpClientInstallResult {
  exitCode: 0 | 1 | 2;
  out: string[];
  err: string[];
}

export interface McpInstallOutcome {
  path: string;
  result: 'patched' | 'already_present' | 'error';
}

export interface McpBinaryResolution {
  path: string;
  args?: ReadonlyArray<string>;
  copyError?: string;
}

/** Host dependencies of `swao mcp install` (module-mcp McpInstallDeps). */
export interface McpInstallDeps {
  requireLicence?: () => void;
  patchAll: (binaryPath: string, args?: ReadonlyArray<string>) => McpInstallOutcome[];
  resolveBinary?: () => McpBinaryResolution;
  installClient?: (request: McpClientInstallRequest) => McpClientInstallResult;
}

export interface AgentTemplateInput {
  serverKey: string;
  profile: string;
  tools: ReadonlyArray<string>;
  version: string;
}

/** CLI slot in BootstrapDeps: registered at the historical positions in buildProgram. */
export interface McpChatCommands {
  registerMcp: (program: Command, deps: McpHostDeps, version: string, installDeps?: McpInstallDeps) => void;
  registerChat: (program: Command) => void;
}

/** Client-config helpers used by the Setup Wizard and the per-client installer. */
export interface McpClientHelpers {
  defaultTransport: (client: McpClientName) => McpTransport;
  profileToolNames: (profile: McpProfileName) => readonly string[];
  clientDisplayName: (client: McpClientName) => string;
  isSwaoGeneratedAgent: (text: string) => boolean;
  renderAgentTemplate: (client: AgentClient, input: AgentTemplateInput) => string;
}

let helpers: McpClientHelpers | undefined;

/** Called once by each tier entry before the program parses. */
export function registerMcpClientHelpers(impl: McpClientHelpers): void {
  helpers = impl;
}

/** The registered helpers; throws when no tier entry registered them. */
export function mcpClientHelpers(): McpClientHelpers {
  if (!helpers) throw new Error('MCP client helpers are not registered (tier entry did not call registerMcpClientHelpers)');
  return helpers;
}
