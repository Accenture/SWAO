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

// #4192 SET-03 (Design 125 section 5.2): the Tools step of the Application
// branch. It lists the scanners of the `prerequisites` probe (gitleaks,
// osv-scanner, clamav, yara; @swao/module-health-check
// probes/prerequisites-probe.ts:160-165) and the IaC tools of the
// `iac_toolchain` probe (terraform, tofu, pulumi, checkov, kics;
// probes/iac-toolchain-probe.ts:41-47), each with what it enables and what
// is lost without it. Detection here is a PATH lookup only: no process is
// started, so the TUI never blocks (the probes use spawnSync) and the
// non-interactive check stays a pure read. The scoped health check at the end
// of the branch runs both probes with version detection.

import { existsSync, statSync } from 'node:fs';
import type { SetupCheckItem } from './types.js';

export type ApplicationToolGroup = 'scanner' | 'code-health' | 'iac';

export interface ApplicationTool {
  /** Name as the health-check probe reports it. */
  name: string;
  /** Executable looked up on PATH. */
  command: string;
  group: ApplicationToolGroup;
  /** The health-check probe that verifies the tool. */
  probe: 'prerequisites' | 'iac_toolchain';
  /** What the tool enables (short, for the list). */
  enables: string;
  /** What is lost without it (guidance). */
  without: string;
  /** True when its absence affects every Application Assessment (not only an opt-in pass). */
  affectsDefaultRun: boolean;
}

export const APPLICATION_TOOLS: readonly ApplicationTool[] = [
  {
    name: 'gitleaks', command: 'gitleaks', group: 'scanner', probe: 'prerequisites', affectsDefaultRun: true,
    enables: 'secret scan in every run',
    without: 'The default secret scan (Pass 14 secrets) cannot run: every assessment records MAL-00 and lists the secret scan under the passes not executed.',
  },
  {
    name: 'osv-scanner', command: 'osv-scanner', group: 'scanner', probe: 'prerequisites', affectsDefaultRun: false,
    enables: 'known-vulnerability scan of dependencies',
    without: 'The full Pass 14 malware scan runs without the dependency vulnerability lookup.',
  },
  {
    name: 'clamav', command: 'clamscan', group: 'scanner', probe: 'prerequisites', affectsDefaultRun: false,
    enables: 'malware signature scan',
    without: 'The full Pass 14 malware scan runs without antivirus signatures.',
  },
  {
    name: 'yara', command: 'yara', group: 'scanner', probe: 'prerequisites', affectsDefaultRun: false,
    enables: 'malware pattern rules',
    without: 'The full Pass 14 malware scan runs without pattern rules.',
  },
  // #4223: the optional Pass 26 code health tools the prerequisites probe lists (prerequisites-probe.ts:27-28, #3487).
  {
    name: 'lizard', command: 'lizard', group: 'code-health', probe: 'prerequisites', affectsDefaultRun: false,
    enables: 'complexity metrics (Pass 26, opt-in)',
    without: 'Nothing is lost in a default run: Pass 26 is opt-in (assessment.code_health.tools); without lizard it reports no complexity metrics.',
  },
  {
    name: 'jscpd', command: 'jscpd', group: 'code-health', probe: 'prerequisites', affectsDefaultRun: false,
    enables: 'duplicate code detection (Pass 26, opt-in)',
    without: 'Nothing is lost in a default run: Pass 26 is opt-in (assessment.code_health.tools); without jscpd it reports no duplicate code.',
  },
  {
    name: 'terraform', command: 'terraform', group: 'iac', probe: 'iac_toolchain', affectsDefaultRun: false,
    enables: 'Terraform state export here',
    without: 'Nothing is lost in the assessment: SWAO reads Terraform sources and the .tfstate files placed in the app inputs without the tool. Without it, the state is exported on another machine.',
  },
  {
    name: 'opentofu', command: 'tofu', group: 'iac', probe: 'iac_toolchain', affectsDefaultRun: false,
    enables: 'OpenTofu state export here',
    without: 'Nothing is lost in the assessment: SWAO reads OpenTofu sources and state files placed in the app inputs without the tool.',
  },
  {
    name: 'pulumi', command: 'pulumi', group: 'iac', probe: 'iac_toolchain', affectsDefaultRun: false,
    enables: 'Pulumi stack export here',
    without: 'Nothing is lost in the assessment: SWAO reads Pulumi stack export files placed in the app inputs without the tool.',
  },
  {
    name: 'checkov', command: 'checkov', group: 'iac', probe: 'iac_toolchain', affectsDefaultRun: false,
    enables: 'IaC security scan',
    without: 'The IaC security scan uses kics instead; with neither tool the scan is skipped and the run log records it.',
  },
  {
    name: 'kics', command: 'kics', group: 'iac', probe: 'iac_toolchain', affectsDefaultRun: false,
    enables: 'IaC security scan (fallback)',
    without: 'Used only when checkov is missing; with neither tool the IaC security scan is skipped.',
  },
];

export interface PathLookupOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** File test; default: an existing regular file. */
  isFile?: (path: string) => boolean;
}

function defaultIsFile(p: string): boolean {
  try { return existsSync(p) && statSync(p).isFile(); } catch { return false; }
}

/** Full path of `command` on PATH (with PATHEXT on Windows), or null. Starts no process. */
export function findOnPath(command: string, opts: PathLookupOptions = {}): string | null {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const isFile = opts.isFile ?? defaultIsFile;
  const pathVar = env['PATH'] ?? env['Path'] ?? '';
  const sep = platform === 'win32' ? ';' : ':';
  const exts = platform === 'win32'
    ? (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const dir of pathVar.split(sep).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = platform === 'win32' ? `${dir.replace(/[\\/]+$/, '')}\\${command}${ext}` : `${dir.replace(/\/+$/, '')}/${command}${ext}`;
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

export interface ApplicationToolStatus {
  tool: ApplicationTool;
  found: boolean;
}

export function detectApplicationTools(opts: PathLookupOptions = {}): ApplicationToolStatus[] {
  return APPLICATION_TOOLS.map((tool) => ({ tool, found: findOnPath(tool.command, opts) !== null }));
}

/** List line state of one tool: a missing tool that affects every run is a warning, other missing tools are information. */
export function toolState(s: ApplicationToolStatus): SetupCheckItem['state'] {
  if (s.found) return 'ok';
  return s.tool.affectsDefaultRun ? 'warn' : 'info';
}

/**
 * #4223: the Ready step shows one row per tool group; the explanation of each
 * tool is a section of the row's guidance.
 */
export const APPLICATION_TOOL_GROUPS: Readonly<Record<ApplicationToolGroup, { label: string; what: string }>> = {
  scanner: { label: 'Security tools', what: 'The scanners of Pass 14 (secrets, dependency vulnerabilities, malware): what each one adds and what is lost without it. The health check verifies them with their versions.' },
  'code-health': { label: 'Code health tools', what: 'The optional tools of the code health pass (Pass 26, opt-in): complexity metrics and duplicate code. A default run does not need them.' },
  iac: { label: 'IaC tools', what: 'The infrastructure-as-code tools: state export on this machine and the IaC security scan. SWAO reads IaC sources and state files without them.' },
};

/** Non-interactive check of the Tools step (Design 125 section 8). */
export function checkApplicationTools(_workspaceRoot: string, opts: PathLookupOptions = {}): SetupCheckItem[] {
  return detectApplicationTools(opts).map((s) => ({
    label: s.tool.name,
    state: toolState(s),
    detail: s.found ? `found: ${s.tool.enables}` : `not found: ${s.tool.without}`,
    short: s.found ? 'found' : 'not found',
    group: APPLICATION_TOOL_GROUPS[s.tool.group],
  }));
}

/** One summary line for the Ready step: "6 of 9 tools found; gitleaks missing". */
export function toolsSummary(statuses: readonly ApplicationToolStatus[]): string {
  const found = statuses.filter((s) => s.found).length;
  const critical = statuses.filter((s) => !s.found && s.tool.affectsDefaultRun).map((s) => s.tool.name);
  return `${found} of ${statuses.length} tools found${critical.length > 0 ? `; ${critical.join(', ')} missing` : ''}`;
}
