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

import { basename, dirname, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import {
  resolveClaudeDesktopConfigs,
  claudeDesktopConfigPath as resolveEffectiveConfigPath,
  SWAO_BIN_RE,
  findSwaoServerKey,
  type ClaudeDesktopConfigCandidate,
} from '@swao/core';

/** The config Claude Desktop reads (MSIX when present). #3163: delegates to the shared @swao/core resolver. */
export function claudeDesktopConfigPath(): string {
  return resolveEffectiveConfigPath();
}

export type McpProbeStatus = 'ok' | 'missing_entry' | 'binary_not_found' | 'binary_unreachable' | 'binary_slow' | 'stale_entry' | 'not_installed';

/** #3163: a SWAO entry, in any Claude Desktop config, that will not launch the running SWAO. */
export interface McpStaleEntry {
  configPath: string;
  kind: ClaudeDesktopConfigCandidate['kind'];
  commandPath: string;
  reason: 'binary_not_found' | 'not_running_binary';
}

export interface McpProbeResult {
  status: McpProbeStatus;
  /** The effective config (the one Claude Desktop reads). */
  configPath: string;
  commandPath: string | null;
  /** #3163: every existing config that was checked (effective first). */
  configsChecked?: string[];
  /** #3163: stale SWAO entries across all configs; non-empty means the probe warns. */
  staleEntries?: McpStaleEntry[];
  /** #3163: operator-facing summary of staleEntries. */
  message?: string;
}

/**
 * #3333: outcome of `<binary> --version`. 'slow' means every attempt hit the
 * timeout (the binary exists but answers slowly, typically a cold start of a
 * large pkg binary under load); 'failed' means it exited non-zero or could not
 * be started.
 */
export type VersionCheckOutcome = 'ok' | 'slow' | 'failed';

/** #3333: was 5 s, which a cold 280 MB binary under load exceeded (6.3 s measured). */
export const VERSION_CHECK_TIMEOUT_MS = 20_000;

export interface VersionCheckOpts {
  /** Per-attempt timeout; defaults to VERSION_CHECK_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Attempts in total; a retry happens only after a timeout (the second start is warm). Default 2. */
  attempts?: number;
  /** Arguments placed before `--version` (tests: run `node <script> --version`). */
  argsPrefix?: string[];
}

/**
 * Run `<binaryPath> --version`. Output is never read, so stdio is ignored (no
 * pipes for a grandchild to hold open on win32). A timeout is retried once;
 * any other failure is final.
 */
export function runVersionCheck(binaryPath: string, opts: VersionCheckOpts = {}): VersionCheckOutcome {
  const timeout = opts.timeoutMs ?? VERSION_CHECK_TIMEOUT_MS;
  const attempts = Math.max(1, opts.attempts ?? 2);
  for (let i = 0; i < attempts; i++) {
    try {
      const result = spawnSync(binaryPath, [...(opts.argsPrefix ?? []), '--version'], {
        timeout,
        stdio: 'ignore',
        windowsHide: true,
      });
      const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
      if (timedOut) continue;
      return !result.error && result.status === 0 ? 'ok' : 'failed';
    } catch {
      return 'failed';
    }
  }
  return 'slow';
}

function toOutcome(v: boolean | VersionCheckOutcome): VersionCheckOutcome {
  if (v === true) return 'ok';
  if (v === false) return 'failed';
  return v;
}

export interface BuildMcpProbeOpts {
  /** Check exactly this one config (tests); disables the multi-config scan. */
  configPathOverride?: string;
  /** #3163: the configs to check; defaults to resolveClaudeDesktopConfigs(). */
  configCandidates?: ClaudeDesktopConfigCandidate[];
  /**
   * #3163: the running SWAO binary. Defaults to process.execPath when that is a
   * SWAO release binary (SWAO_BIN_RE); null disables the "not the running
   * binary" check (dev runs under node, tests).
   */
  runningBinary?: string | null;
  /** Defaults to runVersionCheck. A boolean is read as ok (true) / failed (false). */
  versionRunner?: (cmd: string) => boolean | VersionCheckOutcome;
}

/**
 * The key name is user-chosen: the entry is the `swao` key, else the first
 * entry that launches SWAO (a release binary or, #3295, node with a SWAO entry
 * script as its first argument, via findSwaoServerKey), else any entry whose
 * command path contains 'swao'. For a node-registered entry `script` is that
 * first argument, so the probe can check the script exists.
 * `binCommand` is the command of the first SWAO release binary entry
 * (SWAO_BIN_RE). Only binCommand entries are checked for staleness (#3163):
 * the folder comparison with the running binary does not apply to a node
 * command, so flagging it would raise a warning the patcher cannot clear.
 */
function readSwaoEntry(configPath: string): { parsed: boolean; command: string | null; script: string | null; binCommand: string | null } {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return { parsed: false, command: null, script: null, binCommand: null };
  }
  const raw = config['mcpServers'];
  const servers = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined;
  const commandOf = (e: unknown): string | undefined => {
    const c = (e as { command?: unknown } | null)?.command;
    return typeof c === 'string' ? c : undefined;
  };
  let binCommand: string | null = null;
  let swaoEntry: unknown;
  if (servers) {
    binCommand = Object.values(servers).map(commandOf).find((c) => c !== undefined && SWAO_BIN_RE.test(c)) ?? null;
    const key = findSwaoServerKey(servers);
    swaoEntry = servers['swao']
      ?? (key !== undefined ? servers[key] : undefined)
      ?? Object.values(servers).find((e) => commandOf(e)?.toLowerCase().includes('swao'));
  }
  const command = commandOf(swaoEntry) ?? null;
  // A node-registered SWAO entry: findSwaoServerKey matches it and its command is not a binary.
  const nodeRegistered = command !== null && !SWAO_BIN_RE.test(command)
    && findSwaoServerKey({ entry: swaoEntry }) !== undefined;
  const script = nodeRegistered ? ((swaoEntry as { args: string[] }).args[0] ?? null) : null;
  return { parsed: true, command, script, binCommand };
}

function defaultRunningBinary(): string | null {
  return SWAO_BIN_RE.test(basename(process.execPath)) ? process.execPath : null;
}

/**
 * A command is "the running SWAO" when it lives in the running binary's
 * folder: the wizard writes the stable sibling name (swao-enterprise-win-x64.exe)
 * next to the running binary (#2908), so an exact-path match would warn
 * straight after a correct patch.
 */
function isRunningBinary(commandPath: string, runningBinary: string): boolean {
  const folder = (p: string): string => {
    const d = dirname(resolve(p));
    return process.platform === 'win32' ? d.toLowerCase() : d;
  };
  return folder(commandPath) === folder(runningBinary);
}

/** "<kind> config <path> points at <command> (binary not found | not the running SWAO binary)". */
export function formatStaleEntry(e: McpStaleEntry): string {
  const why = e.reason === 'binary_not_found' ? 'binary not found' : 'not the running SWAO binary';
  return `${e.kind} config ${e.configPath} points at ${e.commandPath} (${why})`;
}

export function buildMcpProbe(opts?: BuildMcpProbeOpts): McpProbeResult {
  const candidates: ClaudeDesktopConfigCandidate[] = opts?.configPathOverride
    ? [{ path: opts.configPathOverride, kind: 'conventional', effective: true }]
    : (opts?.configCandidates ?? resolveClaudeDesktopConfigs());
  const effective = candidates.find((c) => c.effective) ?? candidates[0]!;
  const configPath = effective.path;

  const checkVersion = opts?.versionRunner ?? runVersionCheck;
  const runningBinary = opts && 'runningBinary' in opts ? (opts.runningBinary ?? null) : defaultRunningBinary();

  // #0154: when this probe runs inside a subprocess spawned by the SWAO
  // MCP server, MCP is demonstrably working (the request that triggered
  // the probe arrived via MCP). Skip the config-file inspection -- it's
  // vacuously true here and would otherwise produce false WARN results
  // when the Claude Desktop config has stale paths from a prior binary
  // location.
  if (process.env['SWAO_MCP_CONTEXT'] === '1') {
    return { status: 'ok', configPath, commandPath: process.execPath };
  }

  // #3163: check every config, not only the effective one, so a SWAO entry
  // left in the other config (classic vs MSIX install) is reported.
  const staleEntries: McpStaleEntry[] = [];
  const configsChecked: string[] = [];
  let effectiveExists = false;
  let effectiveEntry: { parsed: boolean; command: string | null; script: string | null } = { parsed: false, command: null, script: null };
  for (const c of candidates) {
    if (!existsSync(c.path)) continue;
    configsChecked.push(c.path);
    const entry = readSwaoEntry(c.path);
    if (c === effective) { effectiveExists = true; effectiveEntry = entry; }
    const cmd = entry.binCommand;
    if (!cmd) continue;
    if (!existsSync(cmd)) {
      // A missing binary in the effective config is reported by the main status.
      if (c !== effective) staleEntries.push({ configPath: c.path, kind: c.kind, commandPath: cmd, reason: 'binary_not_found' });
    } else if (runningBinary && !isRunningBinary(cmd, runningBinary)) {
      staleEntries.push({ configPath: c.path, kind: c.kind, commandPath: cmd, reason: 'not_running_binary' });
    }
  }

  const base = {
    configPath,
    configsChecked,
    staleEntries,
    ...(staleEntries.length > 0 ? { message: staleEntries.map(formatStaleEntry).join('; ') } : {}),
  };
  const stale = staleEntries.length > 0;

  if (!effectiveExists) {
    return { ...base, status: stale ? 'stale_entry' : 'not_installed', commandPath: staleEntries[0]?.commandPath ?? null };
  }
  if (!effectiveEntry.parsed || !effectiveEntry.command) {
    return { ...base, status: 'missing_entry', commandPath: null };
  }
  const commandPath = effectiveEntry.command;
  if (!existsSync(commandPath)) {
    return { ...base, status: 'binary_not_found', commandPath };
  }
  // #3295: a node-registered entry also needs its SWAO entry script.
  if (effectiveEntry.script !== null && !existsSync(effectiveEntry.script)) {
    return { ...base, status: 'binary_not_found', commandPath: effectiveEntry.script };
  }
  const version = toOutcome(checkVersion(commandPath));
  if (version === 'failed') {
    return { ...base, status: 'binary_unreachable', commandPath };
  }
  // #3333: a slow binary is still a working binary, so stale entries keep the
  // headline (the verdict no longer flips between runs with machine load);
  // otherwise report it as slow, not as unreachable.
  if (version === 'slow' && !stale) {
    return { ...base, status: 'binary_slow', commandPath };
  }
  return { ...base, status: stale ? 'stale_entry' : 'ok', commandPath };
}
