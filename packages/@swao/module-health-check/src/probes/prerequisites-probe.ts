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

// Sprint 036 Phase C (#0326): doctor `prerequisites` probe.
//
// Verifies that the host system has the binary prerequisites SWAO needs at
// runtime: `git` (for VCS clone in `swao assess`), `ssh` (for SSH-key clone
// paths), and Node.js (the runtime itself; sanity check the version).
//
// Doesn't fail-hard on missing tools -- reports `warn` for the optional
// ones and `fail` only for `git` (which is the most common dependency).
// Codifies what the sprint-034 Dockerfile fix (#0326 Part B) made implicit.

import { spawnSync } from 'child_process';

export type PrerequisitesProbeStatus = 'ok' | 'info' | 'warn' | 'fail';

export interface PrerequisitesProbeResult {
  status: PrerequisitesProbeStatus;
  /** Per-tool detection result. `null` version means the tool is not on PATH. */
  tools: Array<{
    name: 'git' | 'ssh' | 'node' | 'gitleaks' | 'osv-scanner' | 'clamav' | 'yara';
    available: boolean;
    version: string | null;
    required: boolean;
  }>;
  message: string;
}

/**
 * Run `<cmd> <versionArg>` with a small timeout and return the first
 * line of stdout (where most CLI tools print "tool version X.Y.Z"). Returns
 * null if the tool isn't on PATH or the call timed out.
 */
function detectTool(cmd: string, versionArg: string): string | null {
  try {
    const result = spawnSync(cmd, [versionArg], {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0 && result.signal === null) {
      // Some tools (ssh -V) write to stderr and exit 0 / non-zero; combine.
      const merged = (result.stdout ?? '') + (result.stderr ?? '');
      if (!merged) return null;
      return merged.split('\n')[0]?.trim() ?? null;
    }
    if (result.error || result.status === null) return null;
    const out = (result.stdout ?? result.stderr ?? '').toString();
    const firstLine = out.split('\n')[0]?.trim();
    return firstLine && firstLine.length > 0 ? firstLine : null;
  } catch {
    return null;
  }
}

export function buildPrerequisitesProbe(): PrerequisitesProbeResult {
  // `git --version` -> "git version 2.43.0"
  const gitVersion = detectTool('git', '--version');
  // `ssh -V` -> "OpenSSH_9.0p1, OpenSSL ..." (writes to stderr)
  const sshVersion = detectTool('ssh', '-V');
  // `node --version` -> "v22.11.0"
  const nodeVersion = detectTool('node', '--version');
  // Pass 14 malware scan tools -- optional; warn when any are absent so operators
  // know what to install before running `swao assess --passes malware`.
  // gitleaks uses a positional `version` subcommand rather than `--version`.
  const gitleaksVersion = detectTool('gitleaks', 'version');
  const osvVersion = detectTool('osv-scanner', '--version');
  // ClamAV: probe `clamscan` (one-shot binary, always present when clamav is installed)
  const clamavVersion = detectTool('clamscan', '--version');
  const yaraVersion = detectTool('yara', '--version');

  const tools: PrerequisitesProbeResult['tools'] = [
    { name: 'git',        available: gitVersion   !== null, version: gitVersion,   required: true  },
    { name: 'ssh',        available: sshVersion   !== null, version: sshVersion,   required: false },
    { name: 'node',       available: nodeVersion  !== null, version: nodeVersion,  required: false },
    { name: 'gitleaks',   available: gitleaksVersion !== null, version: gitleaksVersion, required: false },
    { name: 'osv-scanner',available: osvVersion   !== null, version: osvVersion,   required: false },
    { name: 'clamav',     available: clamavVersion !== null, version: clamavVersion, required: false },
    { name: 'yara',       available: yaraVersion  !== null, version: yaraVersion,  required: false },
  ];

  if (!tools[0].available) {
    return {
      status: 'fail',
      tools,
      message: '`git` not found on PATH. Required for `swao assess` against any VCS-sourced app. Install git: brew install git (macOS), apt-get install git (Debian/Ubuntu), or https://git-scm.com/downloads (Windows).',
    };
  }

  // Malware tools are optional but surfaced as WARN so the TUI shows yellow and
  // the operator knows which tools to install before running `--passes malware`.
  const missingMalware = tools.slice(3).filter((t) => !t.available);
  if (missingMalware.length > 0) {
    const names = missingMalware.map((t) => `\`${t.name}\``).join(', ');
    return {
      status: 'warn',
      tools,
      message: `${names} not found on PATH. Install to enable Pass 14 malware scan.`,
    };
  }

  // ssh and node are optional (required: false). Missing ssh is non-blocking --
  // HTTPS+PAT clones still work. Report INFO not WARN so the TUI shows cyan
  // rather than yellow and the operator is not misled into thinking something
  // is broken.
  const infoMessages: string[] = [];
  if (!tools[1].available) infoMessages.push('`ssh` not on PATH (SSH-key clones will fail; HTTPS+PAT still works)');
  if (!tools[2].available) infoMessages.push('`node` not on PATH (host runtime check)');

  if (infoMessages.length > 0) {
    return {
      status: 'info',
      tools,
      message: infoMessages.join('; '),
    };
  }

  return {
    status: 'ok',
    tools,
    message: `git ${gitVersion} / ssh ${sshVersion} / node ${nodeVersion}`,
  };
}
