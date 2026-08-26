// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Doctor module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

export function claudeDesktopConfigPath(): string {
  const home = homedir();
  if (process.platform === 'win32')
    return join(process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  if (process.platform === 'darwin')
    return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

export type McpProbeStatus = 'ok' | 'missing_entry' | 'binary_not_found' | 'not_installed';

export interface McpProbeResult {
  status: McpProbeStatus;
  configPath: string;
  commandPath: string | null;
}

export function buildMcpProbe(): McpProbeResult {
  const configPath = claudeDesktopConfigPath();

  // #0154: when this probe runs inside a subprocess spawned by the SWAO
  // MCP server, MCP is demonstrably working (the request that triggered
  // the probe arrived via MCP). Skip the config-file inspection -- it's
  // vacuously true here and would otherwise produce false WARN results
  // when the Claude Desktop config has stale paths from a prior binary
  // location.
  if (process.env['SWAO_MCP_CONTEXT'] === '1') {
    return { status: 'ok', configPath, commandPath: process.execPath };
  }

  if (!existsSync(configPath)) {
    return { status: 'not_installed', configPath, commandPath: null };
  }
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return { status: 'missing_entry', configPath, commandPath: null };
  }
  const servers = config['mcpServers'] as Record<string, unknown> | undefined;

  // Accept any key whose command path contains 'swao' -- the key name is user-chosen
  let swaoEntry: { command?: string } | undefined;
  if (servers) {
    const exact = servers['swao'] as { command?: string } | undefined;
    if (exact) {
      swaoEntry = exact;
    } else {
      for (const entry of Object.values(servers)) {
        const e = entry as { command?: string };
        if (e?.command?.toLowerCase().includes('swao')) { swaoEntry = e; break; }
      }
    }
  }

  if (!swaoEntry?.command) {
    return { status: 'missing_entry', configPath, commandPath: null };
  }
  const commandPath = swaoEntry.command;
  if (!existsSync(commandPath)) {
    return { status: 'binary_not_found', configPath, commandPath };
  }
  return { status: 'ok', configPath, commandPath };
}
