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

// Claude Desktop MCP config patcher (#1285).
// Extracted from SetupWizard.tsx so the key-scan logic can be unit-tested
// without importing the full Ink component tree.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { dirname, join } from 'path';

// Matches tier-named Windows binaries (swao-enterprise-win-x64.exe, swao-consultant-win-x64.exe,
// swao-community-win-x64.exe) and Unix platform binaries (swao-linux-x64, swao-darwin-arm64).
// The optional -x64 group handles both the versioned release name (win-x64.exe) and any
// legacy rename (win.exe) so the key-scan is forward-compatible with both forms.
const SWAO_BIN_RE = /swao-(?:enterprise|consultant|community)-win(?:-x64)?\.exe$|swao-(?:linux|darwin|macos)-(?:x64|arm64)$/;

// On Windows, Claude Desktop may be installed as an MSIX package. MSIX filesystem
// virtualization means Claude Desktop reads its config from a different path than
// the conventional %APPDATA%\Claude\ location (Design 024 §MSIX). Detect the
// virtualized path and prefer it when present.
function resolveClaudeDesktopConfigPath(conventionalPath: string): string {
  if (process.platform !== 'win32') return conventionalPath;
  const localAppData = process.env['LOCALAPPDATA'];
  if (!localAppData) return conventionalPath;
  const pkgsDir = join(localAppData, 'Packages');
  if (!existsSync(pkgsDir)) return conventionalPath;
  try {
    const claudePkg = readdirSync(pkgsDir).find(d => /^Claude_/.test(d));
    if (!claudePkg) return conventionalPath;
    const msixCfg = join(pkgsDir, claudePkg, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json');
    // Only use MSIX path if the directory already exists (i.e. Claude Desktop has run at least once)
    if (existsSync(dirname(msixCfg))) return msixCfg;
  } catch { /* fall through */ }
  return conventionalPath;
}

/**
 * Write (or update) the SWAO MCP server entry in the Claude Desktop config.
 *
 * Key-scan behaviour (#1285): scans ALL existing mcpServers entries for a
 * command that looks like a swao binary (by filename pattern). If one is found
 * under any key name (e.g. 'swao-mcp'), that entry is updated in-place so the
 * user's chosen key name is preserved. A new 'swao' key is only written when no
 * existing swao binary entry is found.
 */
export function patchClaudeDesktopConfig(
  configPath: string,
  binaryPath: string,
): 'patched' | 'already_present' | 'error' {
  // On Windows MSIX installs, Claude Desktop reads a virtualized path.
  // Resolve the effective write target before touching any file.
  const effectivePath = resolveClaudeDesktopConfigPath(configPath);
  if (effectivePath !== configPath) {
    configPath = effectivePath;
  }
  let config: Record<string, unknown> = {};
  try {
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    }
  } catch { /* start from empty */ }
  try {
    const servers = (config['mcpServers'] ?? {}) as Record<string, unknown>;
    const existingKey = Object.keys(servers).find((k) => {
      const cmd = (servers[k] as { command?: string })?.command ?? '';
      return SWAO_BIN_RE.test(cmd);
    });
    const targetKey = existingKey ?? 'swao';
    const existing = servers[targetKey] as { command?: string } | undefined;
    if (existing?.command === binaryPath) return 'already_present';
    servers[targetKey] = { command: binaryPath, args: ['mcp'] };
    config['mcpServers'] = servers;
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    return 'patched';
  } catch { return 'error'; }
}
