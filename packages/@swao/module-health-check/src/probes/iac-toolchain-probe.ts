// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health-check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 085 OI-05: IaC toolchain probe for swao doctor (#1328).
//
// Detects whether the IaC toolchains SWAO can use are installed on the host.
// All tools are optional -- tool-not-found returns `warn` (not `fail`) because
// SWAO can still read pre-existing .tfstate / Pulumi stack export files without
// the CLI installed.

import { spawnSync } from 'child_process';
import { readdirSync } from 'fs';
import { basename, join } from 'path';
import { meterStep } from '../probe-meter.js';

/** #4224: `info` = no tool found and no IaC source in the workspace (nothing to validate). */
export type IaCToolchainStatus = 'ok' | 'warn' | 'info';

export interface IaCToolEntry {
  name: 'terraform' | 'opentofu' | 'pulumi' | 'checkov' | 'kics';
  available: boolean;
  version: string | null;
  required: false;
}

export interface IaCToolchainProbeResult {
  status: IaCToolchainStatus;
  tools: IaCToolEntry[];
  message: string;
}

const TOOL_DEFS: Array<{ name: IaCToolEntry['name']; cmd: string; versionArgs: string[] }> = [
  { name: 'terraform', cmd: 'terraform', versionArgs: ['version', '-json'] },
  { name: 'opentofu',  cmd: 'tofu',      versionArgs: ['version', '-json'] },
  { name: 'pulumi',    cmd: 'pulumi',     versionArgs: ['version'] },
  { name: 'checkov',   cmd: 'checkov',    versionArgs: ['--version'] },
  { name: 'kics',      cmd: 'kics',       versionArgs: ['version'] },
];

/**
 * Extract a printable version from a tool's version output (#3172).
 *
 * `terraform version -json` and `tofu version -json` print a multi-line JSON
 * object whose first line is a bare "{"; taking the first line rendered the
 * health-check message as "terraform {.". JSON output (stdout only) is parsed
 * for its `terraform_version` field (OpenTofu uses the same key) or `version`
 * and returned as "v1.9.8". Plain-text output keeps its first non-empty line,
 * as before. Returns null when no version text can be recovered.
 */
export function parseToolVersion(stdout: string, stderr = ''): string | null {
  const out = stdout.trim();
  if (out.startsWith('{')) {
    try {
      const doc = JSON.parse(out) as Record<string, unknown>;
      const raw = doc['terraform_version'] ?? doc['version'];
      if (typeof raw === 'string' && raw.trim().length > 0) {
        const v = raw.trim();
        return /^\d/.test(v) ? `v${v}` : v;
      }
      return null;
    } catch {
      // Truncated or otherwise invalid JSON: scan for the version field.
      const m = /"(?:terraform_)?version"\s*:\s*"v?(\d+\.\d+[^"]*)"/.exec(out.slice(0, 4096));
      return m ? `v${m[1]}` : null;
    }
  }
  const text = out.length > 0 ? out : stderr.trim();
  const firstLine = text.split('\n')[0]?.trim();
  return firstLine && firstLine.length > 0 ? firstLine : null;
}

/** Message fragment: "terraform v1.9.8", or "terraform (version unknown)" when no version number is present. */
export function formatToolVersion(name: string, version: string | null): string {
  const m = version ? /v?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.]+)?)/.exec(version.slice(0, 256)) : null;
  return m ? `${name} v${m[1]}` : `${name} (version unknown)`;
}

function detectTool(cmd: string, versionArgs: string[]): { available: boolean; version: string | null } {
  try {
    const result = spawnSync(cmd, versionArgs, {
      encoding: 'utf-8',
      timeout: 3_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status === null) return { available: false, version: null };
    const stdout = (result.stdout ?? '').toString();
    const stderr = (result.stderr ?? '').toString();
    // A tool that ran and printed anything is available, even when its
    // version cannot be parsed (it then renders as "(version unknown)").
    if ((stdout + stderr).trim().length === 0) return { available: false, version: null };
    return { available: true, version: parseToolVersion(stdout, stderr) };
  } catch {
    return { available: false, version: null };
  }
}

// #4224: file names that make a workspace an IaC workspace (Pass 06 inputs).
const IAC_SOURCE_RE = /\.(tf|tfvars|tfstate)$|\.tf\.json$|^Pulumi\.ya?ml$/i;
const IAC_SCAN_SKIP = new Set(['node_modules', '.git', 'logs', 'dist', 'runs']);
const IAC_SCAN_MAX_DEPTH = 8;
const IAC_SCAN_MAX_ENTRIES = 20_000;

/**
 * #4224: true when the workspace holds at least one IaC source file
 * (.tf, .tfvars, .tfstate, .tf.json, Pulumi.yaml). A bounded walk: depth
 * IAC_SCAN_MAX_DEPTH, at most IAC_SCAN_MAX_ENTRIES entries, skipping
 * node_modules, .git, logs, dist and run folders.
 */
export function workspaceHasIacSources(workspacePath: string, stats?: { dirs: number; entries: number }): boolean {
  let seen = 0;
  // #4461 (owner dev10: IaC source scan 11.4 s of a 15.3 s probe): a `wsp`
  // folder holds what SWAO writes; only its `inputs` (uploaded and cloned
  // sources, terraform) can hold IaC sources, and `inputs/research` holds the
  // research stubs of a service app. Pruning them takes the 234 wsp trees of a
  // service portfolio out of the walk.
  const walk = (dir: string, depth: number, parent: string): boolean => {
    if (depth > IAC_SCAN_MAX_DEPTH) return false;
    let entries: import('fs').Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
    if (stats) stats.dirs += 1;
    for (const e of entries) {
      if (++seen > IAC_SCAN_MAX_ENTRIES) return false;
      if (stats) stats.entries += 1;
      if (e.isFile() && IAC_SOURCE_RE.test(e.name)) return true;
    }
    const here = basename(dir);
    for (const e of entries) {
      if (!e.isDirectory() || IAC_SCAN_SKIP.has(e.name)) continue;
      if (here === 'wsp' && e.name !== 'inputs') continue;
      if (here === 'inputs' && parent === 'wsp' && e.name === 'research') continue;
      if (walk(join(dir, e.name), depth + 1, here)) return true;
    }
    return false;
  };
  return walk(workspacePath, 0, '');
}

/**
 * #1328 / #4224: every IaC tool is optional (Pass 06 reads IaC files without
 * one), as the Tools step of the Application setup rates them. The probe is ok
 * when at least one tool is found (the missing ones named as a note), warns only
 * when none is found and the workspace holds IaC sources, and is info when
 * none is found and there is nothing to validate. Without a workspace path the
 * IaC sources are unknown, so no tool found warns.
 */
export function buildIaCToolchainProbe(workspacePath?: string): IaCToolchainProbeResult {
  const tools: IaCToolEntry[] = TOOL_DEFS.map(({ name, cmd, versionArgs }) => {
    const { available, version } = meterStep(`detect ${cmd}`, () => detectTool(cmd, versionArgs));
    return { name, available, version, required: false as const };
  });

  const absent = tools.filter((t) => !t.available);

  if (absent.length === tools.length) {
    const hasSources = workspacePath === undefined || meterStep('IaC source scan', () => workspaceHasIacSources(workspacePath));
    return hasSources
      ? {
        status: 'warn',
        tools,
        message:
          'No IaC toolchain found on PATH. Install terraform, tofu, pulumi, or checkov to ' +
          'enable IaC source scanning (swao assess --passes iac).',
      }
      : {
        status: 'info',
        tools,
        message:
          'No IaC toolchain found on PATH and no IaC sources in the workspace; nothing to validate. ' +
          'All IaC tools are optional (Pass 06 reads IaC files without them).',
      };
  }

  const found = tools
    .filter((t) => t.available)
    .map((t) => formatToolVersion(t.name, t.version))
    .join(', ');
  const missing = absent.map((t) => t.name);
  const message =
    absent.length > 0
      ? `IaC toolchain ready: ${found}. Not found (optional): ${missing.join(', ')}.`
      : `IaC toolchain ready: ${found}.`;

  return { status: 'ok', tools, message };
}
