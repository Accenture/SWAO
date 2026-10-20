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

export type IaCToolchainStatus = 'ok' | 'warn';

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

export function buildIaCToolchainProbe(): IaCToolchainProbeResult {
  const tools: IaCToolEntry[] = TOOL_DEFS.map(({ name, cmd, versionArgs }) => {
    const { available, version } = detectTool(cmd, versionArgs);
    return { name, available, version, required: false as const };
  });

  const absent = tools.filter((t) => !t.available);

  if (absent.length === tools.length) {
    return {
      status: 'warn',
      tools,
      message:
        'No IaC toolchain found on PATH. Install terraform, tofu, pulumi, or checkov to ' +
        'enable IaC source scanning (swao assess --passes iac).',
    };
  }

  const found = tools
    .filter((t) => t.available)
    .map((t) => formatToolVersion(t.name, t.version))
    .join(', ');
  const missing = absent.map((t) => t.name);
  const status: IaCToolchainStatus = absent.length > 0 ? 'warn' : 'ok';
  const message =
    absent.length > 0
      ? `IaC toolchain (partial): ${found}. Not found: ${missing.join(', ')}.`
      : `IaC toolchain ready: ${found}.`;

  return { status, tools, message };
}
