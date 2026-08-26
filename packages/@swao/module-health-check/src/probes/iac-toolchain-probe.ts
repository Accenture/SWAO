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

function detectTool(cmd: string, versionArgs: string[]): string | null {
  try {
    const result = spawnSync(cmd, versionArgs, {
      encoding: 'utf-8',
      timeout: 3_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status === null) return null;
    const out = ((result.stdout ?? '') + (result.stderr ?? '')).toString();
    const firstLine = out.split('\n')[0]?.trim();
    return firstLine && firstLine.length > 0 ? firstLine : null;
  } catch {
    return null;
  }
}

export function buildIaCToolchainProbe(): IaCToolchainProbeResult {
  const tools: IaCToolEntry[] = TOOL_DEFS.map(({ name, cmd, versionArgs }) => {
    const version = detectTool(cmd, versionArgs);
    return { name, available: version !== null, version, required: false as const };
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
    .map((t) => `${t.name} ${t.version}`)
    .join(', ');
  const missing = absent.map((t) => t.name);
  const status: IaCToolchainStatus = absent.length > 0 ? 'warn' : 'ok';
  const message =
    absent.length > 0
      ? `IaC toolchain (partial): ${found}. Not found: ${missing.join(', ')}.`
      : `IaC toolchain ready: ${found}.`;

  return { status, tools, message };
}
