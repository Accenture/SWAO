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
// ones. Missing `git` is `fail` only when an app declares a VCS source;
// otherwise `warn` (#3375, ADR-0069: FAIL only when an assessment cannot run).
// Codifies what the sprint-034 Dockerfile fix (#0326 Part B) made implicit.
//
// #3487: also lists the optional Pass 26 code health tools (lizard, jscpd) as
// present / version / absent. They are opt-in (`assessment.code_health.tools`),
// so they never change the probe status; the message names them. Detection
// runs through the Windows-safe async runner in @swao/core (no spawnSync with
// pipes: pip and npm launchers start grandchildren) and is passed in.

import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { listAppConfigs } from '../app-config-walk.js';
import { meterStep } from '../probe-meter.js';
import { fileBackedToolRunner, spawnErrorIsNotFound } from '@swao/core';
import type { DetectedCodeHealthTool, ToolRunner, ToolRunResult } from '@swao/core';

export type PrerequisitesProbeStatus = 'ok' | 'info' | 'warn' | 'fail';

export interface PrerequisitesProbeResult {
  status: PrerequisitesProbeStatus;
  /** Per-tool detection result. `null` version means the tool is not on PATH. */
  tools: Array<{
    name: 'git' | 'ssh' | 'node' | 'gitleaks' | 'osv-scanner' | 'clamav' | 'yara' | 'lizard' | 'jscpd';
    available: boolean;
    version: string | null;
    required: boolean;
    /**
     * #4488: set when the version check gave no answer although the tool may be
     * installed (timeout, a start error other than ENOENT); such a tool is
     * never reported as not found.
     */
    unanswered?: PrerequisiteUnanswered['outcome'];
  }>;
  message: string;
}

/** #4488: the outcome of one version check. Only ENOENT is not_found. */
export type PrerequisiteOutcome = 'found' | 'not_found' | 'timeout' | 'error';

/** #4488: a version check that gave no answer (timeout or error), with the reason for the message. */
export interface PrerequisiteUnanswered {
  outcome: 'timeout' | 'error';
  /** Reads after the tool name: "did not answer within 15 s", "could not be started (EACCES)". */
  detail: string;
}

/**
 * #4488: the reason of a start error for the one-line probe message: the error
 * code, else the first line of the message cut to 60 characters (a multi-line
 * message would break the probe header line the Setup reads).
 */
function startErrorReason(code: string | null | undefined, message: string): string {
  if (code) return code;
  const nl = message.indexOf(String.fromCharCode(10));
  const first = (nl >= 0 ? message.slice(0, nl) : message).trim();
  return first.length > 60 ? `${first.slice(0, 57)}...` : first;
}

/** #4488: the reason text of a timeout after `timeoutMs`. */
function timeoutDetail(timeoutMs: number): string {
  return `did not answer within ${Math.round(timeoutMs / 1000)} s`;
}

/**
 * Run `<cmd> <versionArg>` with a small timeout and return the first
 * line of stdout matching `linePattern` (or the first line when no pattern
 * is given). `line` is null when the tool isn't on PATH, did not answer or
 * gave no version; #4488: `unanswered` says which of the last two it was
 * (a timeout or a start error other than ENOENT is never "not found").
 *
 * `linePattern` is used for node: inside a pkg binary the runtime emits its
 * module-resolution path alongside the version, so scanning all output lines
 * for /^v\d+\.\d+\.\d+/ is more robust than taking the first line (#2896).
 */
function detectToolSync(cmd: string, versionArg: string, linePattern?: RegExp): { line: string | null; unanswered?: PrerequisiteUnanswered } {
  try {
    const result = spawnSync(cmd, [versionArg], {
      encoding: 'utf-8',
      timeout: PREREQUISITE_PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ETIMEDOUT') return { line: null, unanswered: { outcome: 'timeout', detail: timeoutDetail(PREREQUISITE_PROBE_TIMEOUT_MS) } };
    if (result.error) return code === 'ENOENT' ? { line: null } : { line: null, unanswered: { outcome: 'error', detail: `could not be started (${startErrorReason(code, result.error.message)})` } };
    if (result.status !== 0 && result.signal === null) {
      // Some tools (ssh -V) write to stderr and exit 0 / non-zero; combine.
      const merged = (result.stdout ?? '') + (result.stderr ?? '');
      if (!merged) return { line: null, unanswered: { outcome: 'error', detail: `exited with code ${String(result.status)} without a version` } };
      const lines = merged.split('\n').map(l => l.trim()).filter(Boolean);
      return { line: (linePattern ? lines.find(l => linePattern.test(l)) : lines[0]) ?? null };
    }
    if (result.status === null) return { line: null, unanswered: { outcome: 'error', detail: 'ended without an exit code' } };
    const out = (result.stdout ?? result.stderr ?? '').toString();
    const lines = out.split('\n').map(l => l.trim()).filter(Boolean);
    return { line: (linePattern ? lines.find(l => linePattern.test(l)) : lines[0]) ?? null };
  } catch (err) {
    return { line: null, unanswered: { outcome: 'error', detail: `could not be started (${startErrorReason((err as NodeJS.ErrnoException | null)?.code, err instanceof Error ? err.message : String(err))})` } };
  }
}

/** The version line of detectToolSync (null when absent, unanswered or without a version). */
function detectTool(cmd: string, versionArg: string, linePattern?: RegExp): string | null {
  return detectToolSync(cmd, versionArg, linePattern).line;
}

/**
 * #4461: the version probes of buildCorePrerequisites, in its order. The
 * health check runs them concurrently ahead of the probe through the
 * Windows-safe async runner (file-backed stdio, timeout with a tree-kill by
 * PID), instead of seven serial spawnSync calls (owner dev10: 11.3 s, almost
 * all waiting).
 */
export const PREREQUISITE_VERSION_PROBES: ReadonlyArray<{ cmd: string; versionArg: string }> = [
  { cmd: 'git', versionArg: '--version' },
  { cmd: 'ssh', versionArg: '-V' },
  { cmd: 'node', versionArg: '--version' },
  { cmd: 'gitleaks', versionArg: 'version' },
  { cmd: 'osv-scanner', versionArg: '--version' },
  { cmd: 'clamscan', versionArg: '--version' },
  { cmd: 'yara', versionArg: '--version' },
];

/** #4461: the timeout of one version probe (as the spawnSync timeout before). */
export const PREREQUISITE_PROBE_TIMEOUT_MS = 5_000;

/** #4488: the timeout of the single retry of a version probe that timed out among the concurrent ones. */
export const PREREQUISITE_RETRY_TIMEOUT_MS = 15_000;

export interface PrerequisiteDetections {
  /** A detect function for buildPrerequisitesProbe that answers from the finished probes. */
  detect: (cmd: string, versionArg: string, linePattern?: RegExp) => string | null;
  /** #4488: why a probe gave no answer (timeout or error after its retry); undefined when it answered or was not found. */
  unanswered: (cmd: string) => PrerequisiteUnanswered | undefined;
  /** Wall clock of each version probe (the concurrent attempt). */
  ms: Record<string, number>;
  /** #4488: the outcome of each version probe after its retry. */
  outcome: Record<string, PrerequisiteOutcome>;
  /** #4488: wall clock of the single retry of each probe that timed out at first. */
  retryMs: Record<string, number>;
  /** #4488: the probes that still timed out after their retry. */
  timedOut: string[];
  /** Wall clock of all probes together (retries included). */
  totalMs: number;
}

/** The first line of the tool output matching `linePattern` (or the first line), the detectTool rules. */
function versionLine(r: ToolRunResult, linePattern?: RegExp): string | null {
  if (r.spawnError !== null || r.timedOut || r.exitCode === null) return null;
  // A non-zero exit (ssh -V on some builds) still names the version on stderr; an exit 0 uses stdout, else stderr.
  const text = r.exitCode !== 0 ? r.stdout + r.stderr : (r.stdout.trim() ? r.stdout : r.stderr);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (linePattern) return lines.find((l) => linePattern.test(l)) ?? null;
  return lines[0] ?? null;
}

/** #4488: the outcome of one run; only a spawn error ENOENT is not_found. */
function classifyRun(r: ToolRunResult | null, timeoutMs: number): { outcome: PrerequisiteOutcome; unanswered?: PrerequisiteUnanswered } {
  if (r === null) return { outcome: 'error', unanswered: { outcome: 'error', detail: 'could not be checked (the runner failed)' } };
  if (r.timedOut) return { outcome: 'timeout', unanswered: { outcome: 'timeout', detail: timeoutDetail(timeoutMs) } };
  if (r.spawnError !== null) {
    if (spawnErrorIsNotFound(r)) return { outcome: 'not_found' };
    return { outcome: 'error', unanswered: { outcome: 'error', detail: `could not be started (${startErrorReason(r.spawnErrorCode, r.spawnError)})` } };
  }
  if (r.exitCode === null) return { outcome: 'error', unanswered: { outcome: 'error', detail: 'ended without an exit code' } };
  if (versionLine(r) === null) return { outcome: 'error', unanswered: { outcome: 'error', detail: `exited with code ${r.exitCode} without a version` } };
  return { outcome: 'found' };
}

/**
 * #4461: runs every version probe at once with `runner` (default the
 * file-backed runner of @swao/core) and returns their answers. Never rejects;
 * a tool that is absent, fails or times out answers null.
 * #4488: a probe that timed out is run once more on its own with
 * `retryTimeoutMs` (15 s) before it is reported; the outcome tells a timeout
 * or an error from not found (ENOENT only).
 */
export async function detectPrerequisiteTools(runner: ToolRunner = fileBackedToolRunner, opts: { timeoutMs?: number; retryTimeoutMs?: number; clock?: () => number; cwd?: string } = {}): Promise<PrerequisiteDetections> {
  const clock = opts.clock ?? Date.now;
  const t0 = clock();
  const timeoutMs = opts.timeoutMs ?? PREREQUISITE_PROBE_TIMEOUT_MS;
  const retryTimeoutMs = opts.retryTimeoutMs ?? PREREQUISITE_RETRY_TIMEOUT_MS;
  const cwd = opts.cwd ?? tmpdir();
  const ms: Record<string, number> = {};
  const retryMs: Record<string, number> = {};
  const outcome: Record<string, PrerequisiteOutcome> = {};
  const unanswered = new Map<string, PrerequisiteUnanswered>();
  const results = new Map<string, ToolRunResult | null>();
  const runOnce = async (cmd: string, versionArg: string, limit: number): Promise<ToolRunResult | null> => {
    try { return await runner({ command: cmd, args: [versionArg], cwd, timeoutMs: limit }); } catch { return null; }
  };
  // Inside a pkg binary node is embedded and not looked up on PATH (buildCorePrerequisites).
  const isBinary = Object.prototype.hasOwnProperty.call(process, 'pkg');
  const probes = PREREQUISITE_VERSION_PROBES.filter((p) => !(isBinary && p.cmd === 'node'));
  await Promise.all(probes.map(async ({ cmd, versionArg }) => {
    const start = clock();
    const r = await runOnce(cmd, versionArg, timeoutMs);
    ms[cmd] = clock() - start;
    results.set(`${cmd} ${versionArg}`, r);
  }));
  // #4488: each probe that timed out among the concurrent ones once more, alone.
  for (const { cmd, versionArg } of probes) {
    const key = `${cmd} ${versionArg}`;
    const first = results.get(key);
    let limit = timeoutMs;
    if (first?.timedOut) {
      const start = clock();
      results.set(key, await runOnce(cmd, versionArg, retryTimeoutMs));
      retryMs[cmd] = clock() - start;
      limit = retryTimeoutMs;
    }
    const c = classifyRun(results.get(key) ?? null, limit);
    outcome[cmd] = c.outcome;
    if (c.unanswered) unanswered.set(cmd, c.unanswered);
  }
  return {
    detect: (cmd, versionArg, linePattern) => {
      const r = results.get(`${cmd} ${versionArg}`);
      if (r === undefined) return detectTool(cmd, versionArg, linePattern); // not one of the probes: as before
      return r === null ? null : versionLine(r, linePattern);
    },
    unanswered: (cmd) => unanswered.get(cmd),
    ms,
    outcome,
    retryMs,
    timedOut: Object.keys(outcome).filter((c) => outcome[c] === 'timeout'),
    totalMs: clock() - t0,
  };
}

/**
 * #3375: app ids under apps/ whose .swao.yml declares a VCS source (source.vcs with url or type).
 * #4461: from the shared walk of the app configs.
 */
export function findVcsSourcedApps(workspacePath?: string): string[] {
  if (!workspacePath) return [];
  const out: string[] = [];
  for (const cfg of [...listAppConfigs(workspacePath)].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (cfg.parseError) continue; // unreadable app config: not counted
    const raw = cfg.doc as Record<string, any> | null | undefined;
    const vcs = raw?.['source']?.['vcs'];
    if (vcs && typeof vcs === 'object' && (typeof vcs['url'] === 'string' || typeof vcs['type'] === 'string')) out.push(cfg.id);
  }
  return out;
}

export function buildPrerequisitesProbe(
  workspacePath?: string,
  opts: {
    detect?: (cmd: string, versionArg: string, linePattern?: RegExp) => string | null;
    /** #4488: why a tool gave no answer (PrerequisiteDetections.unanswered); with the default detect, from its own spawnSync run. */
    unanswered?: (cmd: string) => PrerequisiteUnanswered | undefined;
    /** #3487: detected Pass 26 code health tools (detectCodeHealthTools); listed, never status-relevant. */
    codeHealthTools?: readonly DetectedCodeHealthTool[];
  } = {},
): PrerequisitesProbeResult {
  // #4461: each tool detection is a named step of the probe meter.
  // #4488: the default detect records why a tool gave no answer, so a timeout is never "not found".
  const own = new Map<string, PrerequisiteUnanswered>();
  const detect = opts.detect ?? ((cmd: string, versionArg: string, linePattern?: RegExp): string | null => {
    const r = detectToolSync(cmd, versionArg, linePattern);
    if (r.unanswered) own.set(cmd, r.unanswered);
    return r.line;
  });
  const unanswered = opts.unanswered ?? (opts.detect ? (): undefined => undefined : (cmd: string) => own.get(cmd));
  const timed = (cmd: string, versionArg: string, linePattern?: RegExp): string | null =>
    meterStep(`detect ${cmd}`, () => detect(cmd, versionArg, linePattern));
  const result = buildCorePrerequisites(workspacePath, timed, unanswered);
  const ch = opts.codeHealthTools ?? [];
  if (ch.length === 0) return result;
  return {
    ...result,
    tools: [...result.tools, ...ch.map((t) => ({ name: t.name, available: t.status !== 'absent', version: t.version, required: false }))],
    message: `${result.message} ${codeHealthToolsMessage(ch)}`,
  };
}

/** #3487: one sentence naming each code health tool: version, unsupported version, or not found. */
export function codeHealthToolsMessage(tools: readonly DetectedCodeHealthTool[]): string {
  const parts = tools.map((t) => {
    switch (t.status) {
      case 'present': return `${t.name} ${t.version ?? ''}`.trim();
      case 'unsupported_version': return `${t.name} ${t.version ?? '(version unknown)'} (unsupported, needs ${t.supported_range})`;
      case 'absent': return `${t.name} not found`;
      default: {
        const never: never = t.status;
        throw new Error(`unknown tool status: ${String(never)}`);
      }
    }
  });
  return `Optional code health tools (Pass 26, opt-in via assessment.code_health.tools): ${parts.join(', ')}.`;
}

/** The command of each tool of the probe (clamav is checked as clamscan). */
const TOOL_COMMAND: Record<string, string> = { clamav: 'clamscan' };

/** #4488: one sentence naming the tools that gave no answer; they are not reported as missing. */
function unansweredMessage(tools: PrerequisitesProbeResult['tools'], unanswered: (cmd: string) => PrerequisiteUnanswered | undefined): string {
  const parts = tools.filter((t) => t.unanswered).map((t) => `\`${t.name}\` ${unanswered(TOOL_COMMAND[t.name] ?? t.name)?.detail ?? 'did not answer'}`);
  return `${parts.join('; ')}. Not reported as missing: run the Health Check again when the machine is less busy.`;
}

function buildCorePrerequisites(
  workspacePath: string | undefined,
  detect: (cmd: string, versionArg: string, linePattern?: RegExp) => string | null,
  unanswered: (cmd: string) => PrerequisiteUnanswered | undefined = () => undefined,
): PrerequisitesProbeResult {
  // #2964 Part C: when running as a pkg binary, Node is embedded -- it will
  // never appear on PATH. Skip the `node` PATH check to avoid a false-positive
  // 'not on PATH' result that confuses operators into thinking something is wrong.
  const isBinary = Object.prototype.hasOwnProperty.call(process, 'pkg');
  // `git --version` -> "git version 2.43.0"
  const gitVersion = detect('git', '--version');
  // `ssh -V` -> "OpenSSH_9.0p1, OpenSSL ..." (writes to stderr)
  const sshVersion = detect('ssh', '-V');
  // `node --version` -> "v22.11.0"; scan all lines because pkg binaries may
  // emit extra module-path lines alongside the version string (#2896).
  // In binary mode, Node is embedded and will not appear on PATH.
  const nodeVersion = isBinary ? process.version : detect('node', '--version', /^v\d+\.\d+\.\d+/);
  // Pass 14 malware scan tools -- optional; warn when any are absent so operators
  // know what to install before running `swao assess --passes malware`.
  // gitleaks uses a positional `version` subcommand rather than `--version`.
  const gitleaksVersion = detect('gitleaks', 'version');
  const osvVersion = detect('osv-scanner', '--version');
  // ClamAV: probe `clamscan` (one-shot binary, always present when clamav is installed)
  const clamavVersion = detect('clamscan', '--version');
  const yaraVersion = detect('yara', '--version');

  const tools: PrerequisitesProbeResult['tools'] = [
    { name: 'git',        available: gitVersion   !== null, version: gitVersion,   required: true  },
    { name: 'ssh',        available: sshVersion   !== null, version: sshVersion,   required: false },
    { name: 'node',       available: nodeVersion  !== null, version: nodeVersion,  required: false },
    { name: 'gitleaks',   available: gitleaksVersion !== null, version: gitleaksVersion, required: false },
    { name: 'osv-scanner',available: osvVersion   !== null, version: osvVersion,   required: false },
    { name: 'clamav',     available: clamavVersion !== null, version: clamavVersion, required: false },
    { name: 'yara',       available: yaraVersion  !== null, version: yaraVersion,  required: false },
  ];
  // #4488: a tool without a version that did not answer (timeout, start error) is marked, never "not found".
  for (const t of tools) {
    if (t.available || (t.name === 'node' && isBinary)) continue;
    const u = unanswered(TOOL_COMMAND[t.name] ?? t.name);
    if (u) t.unanswered = u.outcome;
  }
  const anyUnanswered = tools.some((t) => t.unanswered);

  if (!tools[0].available && tools[0].unanswered) {
    // #4488: git may be installed; an assessment that clones finds out. Warn, never fail.
    return { status: 'warn', tools, message: unansweredMessage(tools, unanswered) };
  }

  if (!tools[0].available) {
    const install = 'Install git: brew install git (macOS), apt-get install git (Debian/Ubuntu), or https://git-scm.com/downloads (Windows).';
    const vcsApps = findVcsSourcedApps(workspacePath);
    if (vcsApps.length > 0) {
      return {
        status: 'fail',
        tools,
        message: `\`git\` not found on PATH. Required for \`swao assess\` of the VCS-sourced app(s) ${vcsApps.join(', ')}. ${install}`,
      };
    }
    // #3375: no app clones from a repository, so assessments still run.
    return {
      status: 'warn',
      tools,
      message: `\`git\` not found on PATH. Only needed for apps with a VCS source (none configured); local folders, uploads, service and LZ assessments work without it. ${install}`,
    };
  }

  // Malware tools are optional but surfaced as WARN so the TUI shows yellow and
  // the operator knows which tools to install before running `--passes malware`.
  // #3487: selected by name, so tools appended later are never read as malware tools.
  const MALWARE_TOOLS = new Set(['gitleaks', 'osv-scanner', 'clamav', 'yara']);
  const missingMalware = tools.filter((t) => MALWARE_TOOLS.has(t.name) && !t.available && !t.unanswered);
  const suffix = anyUnanswered ? ` ${unansweredMessage(tools, unanswered)}` : '';
  if (missingMalware.length > 0) {
    const names = missingMalware.map((t) => `\`${t.name}\``).join(', ');
    // #3419: Gitleaks drives the default secret scan (pass key `secrets`, in
    // every default pass profile), so its absence affects every assessment,
    // not only an opt-in `--passes malware` run.
    const gitleaksMissing = !tools[3].available && !tools[3].unanswered;
    return {
      status: 'warn',
      tools,
      message: (gitleaksMissing
        ? `${names} not found on PATH. \`gitleaks\` is needed by the default secret scan (Pass 14 \`secrets\`): without it assessments record MAL-00 and list the secret scan under "Passes not executed". The other tools enable the opt-in full Pass 14 malware scan.`
        : `${names} not found on PATH. Install to enable Pass 14 malware scan.`) + suffix,
    };
  }
  // #4488: an unanswered malware tool or ssh is a warn of its own (its presence is not known).
  if (anyUnanswered) return { status: 'warn', tools, message: unansweredMessage(tools, unanswered) };

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
