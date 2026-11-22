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

// #3217: the dependencies `swao mcp install` receives from the host (see
// McpInstallDeps in mcp-chat-contract.ts): the shared licence gate (#3341),
// the shared stable-binary resolver and the shared multi-config patcher,
// identical to the wizard and `init --mcp`. #4213: CLI code, so it lives in
// lib/ and not in the TUI tree (tui/mcp-config.ts keeps the parts the Setup
// Wizard MCP step shares).

import type { ClaudeDesktopConfigCandidate } from '@swao/core';
import type { McpClientInstallRequest, McpClientInstallResult } from './mcp-chat-contract.js';
import { installMcpClient, type McpClientInstallEnv } from './mcp-client-install.js';
import {
  patchAllClaudeDesktopConfigs,
  requireMcpRegistration,
  resolveStableBinary,
  type ClaudeDesktopPatchOutcome,
  type McpRegistrationGateOps,
  type StableBinaryOps,
  type StableBinaryResolution,
} from '../tui/mcp-config.js';

/** The command whose licence gate refuses below Enterprise (named in the [LICENSE] text). */
const MCP_INSTALL_FEATURE = 'swao mcp install';

export function buildMcpInstallDeps(
  ops: StableBinaryOps = {},
  candidates?: ReadonlyArray<ClaudeDesktopConfigCandidate>,
  gate: McpRegistrationGateOps = {},
  clientEnv: McpClientInstallEnv = {},
): {
  requireLicence: () => void;
  resolveBinary: () => StableBinaryResolution;
  patchAll: (binaryPath: string, args?: ReadonlyArray<string>) => ClaudeDesktopPatchOutcome[];
  installClient: (request: McpClientInstallRequest) => McpClientInstallResult;
} {
  const gateOps: McpRegistrationGateOps = { ...gate, execPath: gate.execPath ?? ops.execPath };
  return {
    requireLicence: () => requireMcpRegistration(MCP_INSTALL_FEATURE, gateOps),
    resolveBinary: () => resolveStableBinary(ops),
    patchAll: (binaryPath, args) => patchAllClaudeDesktopConfigs(binaryPath, candidates, args),
    // #3478: per-client safe writer (Design 116 REQ-13); same Claude Desktop candidates as patchAll.
    installClient: (request) =>
      installMcpClient(request, { ...(candidates ? { claudeDesktopCandidates: () => candidates } : {}), ...clientEnv }),
  };
}
