// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Claude Desktop config resolver (#3163). The single place that knows where
// Claude Desktop keeps claude_desktop_config.json. Before #3163 four code paths
// (host bootstrap, the Setup Wizard patcher, `swao mcp install` and the
// health-check MCP probe) each resolved ONE path, so a machine with both a
// classic and an MSIX Claude Desktop install kept a stale SWAO entry in the
// config SWAO did not pick.
//
// On Windows, an MSIX-packaged Claude Desktop reads a virtualised config under
// %LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\ (Design 024
// MSIX). When that folder exists it is the EFFECTIVE config; the conventional
// %APPDATA%\Claude\ config is still returned as a candidate so callers can
// update (patcher) or check (probe) a SWAO entry left there.
//
// Pure path logic plus read-only helpers; writing stays with the callers.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CLAUDE_DESKTOP_CONFIG_FILE = 'claude_desktop_config.json';

// Matches all tier-named release binaries (#2713):
//   Windows : swao-{enterprise,consultant,community}-win[-x64].exe
//   Unix    : swao-{enterprise,consultant,community}-{linux,darwin,macos}-{x64,arm64}
// The tier segment is optional to remain compatible with un-tiered legacy names
// (e.g. swao-linux-x64 from pre-v1.0 deployments).
export const SWAO_BIN_RE = /swao-(?:(?:enterprise|consultant|community)-)?(?:win(?:-x64)?\.exe|(?:linux|darwin|macos)-(?:x64|arm64))$/;

export type ClaudeDesktopConfigKind = 'msix' | 'conventional';

export interface ClaudeDesktopConfigCandidate {
  /** Absolute path to claude_desktop_config.json (the file may not exist). */
  path: string;
  kind: ClaudeDesktopConfigKind;
  /** True for the one config Claude Desktop actually reads. Exactly one candidate is effective. */
  effective: boolean;
}

export interface ClaudeDesktopResolveOptions {
  /** Defaults to process.platform. Tests pass 'win32' explicitly. */
  platform?: NodeJS.Platform;
  /** Defaults to process.env, read at call time. */
  env?: Record<string, string | undefined>;
  /** Defaults to os.homedir(). */
  home?: string;
}

/**
 * Every Claude Desktop config location on this machine, effective first.
 * Windows: the MSIX virtualised config (effective when its folder exists)
 * plus the conventional %APPDATA% config. macOS and Linux: one conventional
 * config.
 */
export function resolveClaudeDesktopConfigs(opts: ClaudeDesktopResolveOptions = {}): ClaudeDesktopConfigCandidate[] {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  if (platform === 'darwin') {
    return [{ path: join(home, 'Library', 'Application Support', 'Claude', CLAUDE_DESKTOP_CONFIG_FILE), kind: 'conventional', effective: true }];
  }
  if (platform !== 'win32') {
    return [{ path: join(home, '.config', 'Claude', CLAUDE_DESKTOP_CONFIG_FILE), kind: 'conventional', effective: true }];
  }
  const conventional = join(env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'Claude', CLAUDE_DESKTOP_CONFIG_FILE);
  const msix: string[] = [];
  const localAppData = env['LOCALAPPDATA'];
  if (localAppData) {
    const pkgsDir = join(localAppData, 'Packages');
    try {
      for (const d of readdirSync(pkgsDir).filter((n) => /^Claude_/.test(n)).sort()) {
        const dir = join(pkgsDir, d, 'LocalCache', 'Roaming', 'Claude');
        // Only when Claude Desktop has run at least once and created the folder.
        if (existsSync(dir)) msix.push(join(dir, CLAUDE_DESKTOP_CONFIG_FILE));
      }
    } catch { /* no Packages folder: classic install only */ }
  }
  const out: ClaudeDesktopConfigCandidate[] = msix.map((p, i) => ({ path: p, kind: 'msix' as const, effective: i === 0 }));
  out.push({ path: conventional, kind: 'conventional', effective: msix.length === 0 });
  return out;
}

/** The config Claude Desktop actually reads (MSIX when present on Windows). */
export function claudeDesktopConfigPath(opts: ClaudeDesktopResolveOptions = {}): string {
  const candidates = resolveClaudeDesktopConfigs(opts);
  return (candidates.find((c) => c.effective) ?? candidates[0]!).path;
}

// #3295: a source run registers { command: <node>, args: [<script>, 'mcp', ...] }
// (#3286). The command is node (node or node.exe, any folder) and the first
// argument is a SWAO entry script: the CLI entry packages/swao/dist/index.js
// or a bundled swao*.js / swao*.cjs / swao*.mjs file.
const NODE_COMMAND_RE = /(?:^|[\\/])node(?:\.exe)?$/i;
const SWAO_SCRIPT_RE = /(?:(?:^|[\\/])packages[\\/]swao[\\/]dist[\\/]index\.js|(?:^|[\\/])swao[^\\/]*\.[cm]?js)$/i;

/**
 * True when an mcpServers entry launches SWAO: either a SWAO release binary
 * (SWAO_BIN_RE) or node with a SWAO entry script as its first argument (#3295).
 */
export function isSwaoServerEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const { command, args } = entry as { command?: unknown; args?: unknown };
  if (typeof command !== 'string') return false;
  if (SWAO_BIN_RE.test(command)) return true;
  if (!NODE_COMMAND_RE.test(command) || !Array.isArray(args)) return false;
  const script = args[0];
  return typeof script === 'string' && SWAO_SCRIPT_RE.test(script);
}

/**
 * Key of the first mcpServers entry that launches SWAO (a release binary or a
 * node-registered source run, #3295), if any.
 */
export function findSwaoServerKey(servers: Record<string, unknown>): string | undefined {
  return Object.keys(servers).find((k) => isSwaoServerEntry(servers[k]));
}

/** True when the config file exists, parses, and holds a SWAO entry (binary or node-registered, #3295). */
export function claudeDesktopConfigHasSwaoEntry(configPath: string): boolean {
  try {
    if (!existsSync(configPath)) return false;
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const servers = config['mcpServers'];
    if (!servers || typeof servers !== 'object') return false;
    return findSwaoServerKey(servers as Record<string, unknown>) !== undefined;
  } catch {
    return false;
  }
}

/**
 * #3163 patching rule: the effective config (created if needed, as before)
 * plus every other existing config that already holds a SWAO entry. A
 * conventional config without a SWAO entry is never created or modified
 * while the MSIX config is the effective one.
 */
export function selectClaudeDesktopPatchTargets(
  candidates: ReadonlyArray<ClaudeDesktopConfigCandidate> = resolveClaudeDesktopConfigs(),
): ClaudeDesktopConfigCandidate[] {
  return candidates.filter((c) => c.effective || claudeDesktopConfigHasSwaoEntry(c.path));
}
