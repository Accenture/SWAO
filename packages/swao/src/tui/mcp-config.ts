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

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import {
  SWAO_BIN_RE,
  FEATURE_GATES,
  LicenseGuard,
  LicenseInvalidError,
  LicenseTierError,
  findSwaoServerKey,
  logPortfolio,
  resolveClaudeDesktopConfigs,
  selectClaudeDesktopPatchTargets,
  type ClaudeDesktopConfigCandidate,
  type ClaudeDesktopConfigKind,
  type FeatureKey,
  type LicenseTier,
} from '@swao/core';
import { formatLicenseGateError, printLicenseInvalidError } from '../lib/license-gate-error.js';

// #3163: the config resolver (MSIX virtualised path + conventional %APPDATA%
// path, Design 024 MSIX) and SWAO_BIN_RE now live in @swao/core so the wizard,
// `swao init --mcp`, `swao mcp install` and the health-check probe share them.

/**
 * #2908 / #3217: stable binary name registered in Claude Desktop by the
 * Enterprise Windows binary. Claude Desktop holds the registered exe open
 * while it runs, so registering the build output path makes the next rebuild
 * fail with EPERM; registering a stable sibling copy avoids that.
 * #3341 (Design 110 D-09 amendment): the stable name carries the tier of the
 * running binary on every platform (stableBinaryName). This constant is the
 * Enterprise Windows name only; a Community or Consultant binary never maps to it.
 */
export const STABLE_BINARY_NAME = 'swao-enterprise-win-x64.exe';

/** MCP server arguments registered after the binary (or after the script on source runs). */
export const MCP_SERVER_ARGS: readonly string[] = ['mcp'];

/** #3286: the Node.js interpreter, i.e. a source run (`node dist/index.js`). */
const NODE_EXEC_RE = /^node(?:\.exe)?$/i;

/** Tier assumed for a legacy un-tiered binary name when SWAO_BINARY_TIER is not set. */
const DEFAULT_STABLE_TIER: LicenseTier = 'enterprise';

const TIER_RANK: Record<LicenseTier, number> = { community: 0, consultant: 1, enterprise: 2 };

function asTier(raw: string | undefined): LicenseTier | undefined {
  return raw === 'community' || raw === 'consultant' || raw === 'enterprise' ? raw : undefined;
}

/**
 * #3341: the tier encoded in a SWAO release binary name
 * (`swao-<tier>-<os>...`), or undefined for a legacy un-tiered name such as
 * swao-win-x64.exe or swao-linux-x64.
 */
export function binaryNameTier(execBasename: string): LicenseTier | undefined {
  const m = /swao-(enterprise|consultant|community)-(?:win|linux|darwin|macos)/.exec(execBasename);
  return m ? asTier(m[1]) : undefined;
}

/**
 * #3286 (Design 110 D-09) / #3341: stable copy name for a running SWAO release
 * binary, `swao-<tier>-<os>-<arch>[.exe]`, on every platform. The tier is the
 * running binary's own tier: from its name when the name carries one (a tiered
 * release binary therefore maps to its own name and is never copied), else
 * `fallbackTier` (SWAO_BINARY_TIER set by the tier entry, enterprise when
 * unset). A Community or Consultant binary therefore never maps to the
 * Enterprise name. Returns undefined when the name is not a SWAO release
 * binary (SWAO_BIN_RE).
 */
export function stableBinaryName(
  execBasename: string,
  fallbackTier: LicenseTier = asTier(process.env['SWAO_BINARY_TIER']) ?? DEFAULT_STABLE_TIER,
): string | undefined {
  if (!SWAO_BIN_RE.test(execBasename)) return undefined;
  const tier = binaryNameTier(execBasename) ?? fallbackTier;
  if (/\.exe$/i.test(execBasename)) return `swao-${tier}-win-x64.exe`;
  const m = /swao-(?:(?:enterprise|consultant|community)-)?(linux|darwin|macos)-(x64|arm64)$/.exec(execBasename);
  if (!m) return undefined;
  return `swao-${tier}-${m[1]}-${m[2]}`;
}

export interface StableBinaryResolution {
  /** Path to register as the MCP `command`: the stable copy, the running binary, or node on source runs. */
  path: string;
  /** Arguments to register: ['mcp'] for a binary; [<script>, 'mcp'] on source runs (#3286). */
  args: string[];
  /** True when the running binary was copied to the stable path. */
  copied: boolean;
  /** Set when the copy failed (for example EPERM while Claude Desktop holds the stable exe open). */
  copyError?: string;
  /** The running binary the resolution started from. */
  execPath: string;
  /** Stable copy path; undefined on source runs (nothing is copied). */
  stablePath?: string;
  /** True when SWAO runs from source (node plus script), so node plus the script path is registered. */
  sourceRun: boolean;
}

/** Injectable for tests so they never copy the real executable. */
export interface StableBinaryOps {
  execPath?: string;
  /** Entry script on source runs; defaults to process.argv[1]. */
  scriptPath?: string;
  copyFile?: (src: string, dest: string) => void;
  exists?: (p: string) => boolean;
  /** #3341: tier for a legacy un-tiered binary name; defaults to SWAO_BINARY_TIER, else enterprise. */
  binaryTier?: LicenseTier;
}

/**
 * #3217: the single stable-binary resolver used by the Setup Wizard,
 * `swao init --mcp` and `swao mcp install`, so all three register the same
 * `command` and `args`. #3286 (Design 110 D-08): the copy happens only when the
 * running binary matches SWAO_BIN_RE (shared with the health-check probe); a
 * source run (`node dist/index.js`) registers node plus the script path and
 * copies nothing; any other name (a renamed binary such as /usr/local/bin/swao)
 * is registered as is with ['mcp'] and not copied. For a SWAO binary it copies the running binary to its stable
 * name (stableBinaryName) in the same folder (#2908) unless it already has that
 * name, and falls back to the running binary when the stable copy does not
 * exist after a failed copy. #3341: the stable name always carries the running
 * binary's own tier, and a copy whose target name holds a different tier is
 * refused (never overwrite a binary of another tier).
 */
export function resolveStableBinary(ops: StableBinaryOps = {}): StableBinaryResolution {
  const execPath = ops.execPath ?? process.execPath;
  const copyFile = ops.copyFile ?? copyFileSync;
  const exists = ops.exists ?? existsSync;
  const execName = basename(execPath);
  const fallbackTier = ops.binaryTier ?? asTier(process.env['SWAO_BINARY_TIER']) ?? DEFAULT_STABLE_TIER;
  const name = stableBinaryName(execName, fallbackTier);
  const args = [...MCP_SERVER_ARGS];
  if (name === undefined) {
    if (NODE_EXEC_RE.test(execName)) {
      // Source run: node plus the entry script, nothing copied.
      const script = ops.scriptPath ?? process.argv[1];
      const sourceArgs = script ? [resolve(script), ...MCP_SERVER_ARGS] : args;
      return { path: execPath, args: sourceArgs, copied: false, execPath, sourceRun: true };
    }
    // A renamed SWAO binary (for example /usr/local/bin/swao per the runbook):
    // register it as is, no copy, no script argument.
    return { path: execPath, args, copied: false, execPath, sourceRun: false };
  }
  const stablePath = join(dirname(execPath), name);
  // Already the stable name (case-insensitive: Windows file names): nothing to copy.
  if (execName.toLowerCase() === name.toLowerCase()) {
    return { path: execPath, args, copied: false, execPath, stablePath: execPath, sourceRun: false };
  }
  // #3341: defence in depth. stableBinaryName derives the target tier from the
  // running binary, so the two always agree; should they ever differ, refuse
  // the copy rather than overwrite a binary of another tier.
  const runningTier = binaryNameTier(execName) ?? fallbackTier;
  const targetTier = binaryNameTier(name);
  if (targetTier !== runningTier) {
    return {
      path: execPath, args, copied: false, execPath, stablePath, sourceRun: false,
      copyError: `refused to overwrite ${name} (${targetTier ?? 'unknown'} tier) with the ${runningTier} binary`,
    };
  }
  let copied = false;
  let copyError: string | undefined;
  try {
    copyFile(execPath, stablePath);
    copied = true;
  } catch (e) {
    copyError = (e as Error).message;
  }
  const path = exists(stablePath) ? stablePath : execPath;
  return { path, args, copied, execPath, stablePath, sourceRun: false, ...(copyError !== undefined ? { copyError } : {}) };
}

/**
 * #3286 (Design 110 D-10): the copy-failure warning, shared by the wizard so it
 * says what `swao mcp install` and `swao init --mcp` print. Undefined when the
 * copy did not fail.
 */
export function stableCopyWarning(r: StableBinaryResolution, rerunCommand = 'swao mcp install'): string[] | undefined {
  if (r.copyError === undefined) return undefined;
  return [
    `Could not refresh the stable binary copy${r.stablePath ? ` ${r.stablePath}` : ''}: ${r.copyError}`,
    `Registering: ${r.path}`,
    `Quit Claude Desktop (tray icon, Quit) and re-run \`${rerunCommand}\` to register the current binary.`,
  ];
}

// ---------------------------------------------------------------------------
// #3341: MCP registration licence gate, shared by `swao mcp install`,
// `swao init --mcp` and the Setup Wizard MCP step (TUI/CLI parity).
// ---------------------------------------------------------------------------

/** Injectable for tests so they never read the operator's real licence. */
export interface McpRegistrationGateOps {
  /** Running binary; its name decides the binary edition when it carries a tier. Defaults to process.execPath. */
  execPath?: string;
  /** Binary edition set by the tier entry; defaults to SWAO_BINARY_TIER. */
  binaryTier?: string;
  /** Licence loader; defaults to LicenseGuard.load. */
  loadGuard?: () => { requireFeature(key: FeatureKey): void };
}

export type McpRegistrationRefusal =
  /** edition: true when the binary edition, not the licence, refused. */
  | { kind: 'tier'; required: LicenseTier; current: LicenseTier; edition: boolean }
  | { kind: 'invalid'; message: string };

/**
 * #3341: decide whether this process may register the SWAO MCP server
 * (FEATURE_GATES['mcp-server'], licence tier matrix F-105: Enterprise). Refuses when
 * the binary edition is below Enterprise (the tier in the running binary's
 * name or SWAO_BINARY_TIER, the stricter of both) or when the licence is.
 * Returns undefined when registration is allowed. Reads the licence only: no
 * file is copied and no config is written.
 */
export function mcpRegistrationRefusal(ops: McpRegistrationGateOps = {}): McpRegistrationRefusal | undefined {
  const required = FEATURE_GATES['mcp-server'];
  const execName = basename(ops.execPath ?? process.execPath);
  const editions = [
    SWAO_BIN_RE.test(execName) ? binaryNameTier(execName) : undefined,
    asTier(ops.binaryTier ?? process.env['SWAO_BINARY_TIER']),
  ].filter((t): t is LicenseTier => t !== undefined);
  const edition = editions.sort((a, b) => TIER_RANK[a] - TIER_RANK[b])[0];
  if (edition !== undefined && TIER_RANK[edition] < TIER_RANK[required]) {
    return { kind: 'tier', required, current: edition, edition: true };
  }
  try {
    (ops.loadGuard ?? (() => LicenseGuard.load()))().requireFeature('mcp-server');
  } catch (err) {
    if (err instanceof LicenseTierError) return { kind: 'tier', required: err.required, current: err.current, edition: false };
    if (err instanceof LicenseInvalidError) return { kind: 'invalid', message: err.message };
    throw err;
  }
  return undefined;
}

function tierLabel(t: LicenseTier): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** #3341: the refusal as the standard [LICENSE] text (plus an edition hint when the binary refused). */
export function formatMcpRegistrationRefusal(r: McpRegistrationRefusal, feature: string): string {
  if (r.kind === 'invalid') return `[LICENSE] Invalid licence: ${r.message}`;
  const text = formatLicenseGateError(feature, r.required, r.current);
  return r.edition
    ? `${text}\nThis is the ${tierLabel(r.current)} binary; the MCP server ships in the Enterprise binary (swao-enterprise-<os>-<arch>).`
    : text;
}

/**
 * #3341: CLI form of the gate for `swao mcp install` and `swao init --mcp`:
 * on refusal print the [LICENSE] text to stderr and exit non-zero (1 for a
 * tier refusal, 3 for an invalid licence, as printLicenseGateError and
 * printLicenseInvalidError) before anything is copied or written.
 */
export function requireMcpRegistration(feature: string, ops: McpRegistrationGateOps = {}): void {
  const r = mcpRegistrationRefusal(ops);
  if (r === undefined) return;
  if (r.kind === 'invalid') printLicenseInvalidError(r.message);
  console.error(formatMcpRegistrationRefusal(r, feature));
  try {
    logPortfolio('error', 'licence.gate.error', `${feature} requires an Enterprise licence`, {
      context: { feature, required: r.kind === 'tier' ? r.required : 'enterprise', current: r.kind === 'tier' ? r.current : 'unknown', code: 1 },
    });
  } catch { /* best-effort */ }
  process.exit(1);
}

/**
 * #3217: the dependencies `swao mcp install` receives from the host (see
 * McpInstallDeps in @swao/module-mcp): the shared licence gate (#3341), the
 * shared stable-binary resolver and the shared multi-config patcher,
 * identical to the wizard and `init --mcp`.
 */
export function buildMcpInstallDeps(
  ops: StableBinaryOps = {},
  candidates?: ReadonlyArray<ClaudeDesktopConfigCandidate>,
  gate: McpRegistrationGateOps = {},
): {
  requireLicence: () => void;
  resolveBinary: () => StableBinaryResolution;
  patchAll: (binaryPath: string, args?: ReadonlyArray<string>) => ClaudeDesktopPatchOutcome[];
} {
  const gateOps: McpRegistrationGateOps = { ...gate, execPath: gate.execPath ?? ops.execPath };
  return {
    requireLicence: () => requireMcpRegistration('swao mcp install', gateOps),
    resolveBinary: () => resolveStableBinary(ops),
    patchAll: (binaryPath, args) => patchAllClaudeDesktopConfigs(binaryPath, candidates, args),
  };
}

export type ClaudeDesktopPatchResult = 'patched' | 'already_present' | 'error';

export interface ClaudeDesktopPatchOutcome {
  path: string;
  kind: ClaudeDesktopConfigKind;
  effective: boolean;
  result: ClaudeDesktopPatchResult;
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
  args: ReadonlyArray<string> = MCP_SERVER_ARGS,
): ClaudeDesktopPatchResult {
  // #3163: patches exactly configPath. Choosing which configs to patch (MSIX
  // and/or conventional) is patchAllClaudeDesktopConfigs' job; the former
  // hidden MSIX redirect here meant only one of two configs was ever updated.
  let config: Record<string, unknown> = {};
  try {
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    }
  } catch { /* start from empty */ }
  try {
    const servers = (config['mcpServers'] ?? {}) as Record<string, unknown>;
    const existingKey = findSwaoServerKey(servers);
    const targetKey = existingKey ?? 'swao';
    const existing = servers[targetKey] as { command?: string; args?: unknown } | undefined;
    // #3286: on source runs the command is always node, so the script path in
    // args decides. Existing args that start with the expected args are current
    // (extra operator flags such as --workspace are preserved).
    const existingArgs = Array.isArray(existing?.args) ? (existing.args as unknown[]) : [];
    const argsCurrent = args.every((a, i) => existingArgs[i] === a);
    if (existing?.command === binaryPath && argsCurrent) return 'already_present';
    servers[targetKey] = { command: binaryPath, args: [...args] };
    config['mcpServers'] = servers;
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    return 'patched';
  } catch { return 'error'; }
}

/**
 * Patch every Claude Desktop config that needs the SWAO entry (#3163):
 * the effective config (MSIX when present on Windows), created if needed,
 * plus every other existing config that already holds a SWAO entry, so no
 * config keeps a stale binary path. A conventional config without a SWAO
 * entry is left untouched while MSIX is effective. Returns one outcome per
 * file, effective first, so callers can report each path and result.
 */
export function patchAllClaudeDesktopConfigs(
  binaryPath: string,
  candidates: ReadonlyArray<ClaudeDesktopConfigCandidate> = resolveClaudeDesktopConfigs(),
  args: ReadonlyArray<string> = MCP_SERVER_ARGS,
): ClaudeDesktopPatchOutcome[] {
  return selectClaudeDesktopPatchTargets(candidates).map((c) => ({
    path: c.path,
    kind: c.kind,
    effective: c.effective,
    result: patchClaudeDesktopConfig(c.path, binaryPath, args),
  }));
}
