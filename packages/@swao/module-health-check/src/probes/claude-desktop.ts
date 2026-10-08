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
import { join, dirname } from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';

export function claudeDesktopConfigPath(): string {
  const home = homedir();
  if (process.platform === 'win32') {
    const conventional = join(process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
    // MSIX installs use a virtualized path under %LOCALAPPDATA%\Packages\Claude_*\
    const localAppData = process.env['LOCALAPPDATA'];
    if (localAppData) {
      const pkgsDir = join(localAppData, 'Packages');
      try {
        const claudePkg = readdirSync(pkgsDir).find(d => /^Claude_/.test(d));
        if (claudePkg) {
          const msixCfg = join(pkgsDir, claudePkg, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json');
          if (existsSync(dirname(msixCfg))) return msixCfg;
        }
      } catch { /* fall through */ }
    }
    return conventional;
  }
  if (process.platform === 'darwin')
    return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

export type McpProbeStatus = 'ok' | 'missing_entry' | 'binary_not_found' | 'binary_unreachable' | 'not_installed';

export interface McpProbeResult {
  status: McpProbeStatus;
  configPath: string;
  commandPath: string | null;
}

function runVersionCheck(binaryPath: string): boolean {
  try {
    const result = spawnSync(binaryPath, ['--version'], {
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

export interface BuildMcpProbeOpts {
  configPathOverride?: string;
  versionRunner?: (cmd: string) => boolean;
}

export function buildMcpProbe(opts?: BuildMcpProbeOpts): McpProbeResult {
  const configPath = opts?.configPathOverride ?? claudeDesktopConfigPath();

  const checkVersion = opts?.versionRunner ?? runVersionCheck;

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
  if (!checkVersion(commandPath)) {
    return { status: 'binary_unreachable', configPath, commandPath };
  }
  return { status: 'ok', configPath, commandPath };
}
