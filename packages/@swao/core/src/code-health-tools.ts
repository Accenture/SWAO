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

// #3487: optional code health tools for Pass 26 (Design 117 section 10.1).
//
// lizard (per-function cyclomatic complexity) and jscpd (token-based clone
// detection). Both are optional and opt-in per workspace
// (`assessment.code_health.tools`); this module owns what is shared by Pass 26
// and the health-check probe: the version pins, how each tool is located
// without a shell, and the version check. Output parsing lives with Pass 26.
//
// Location (fixed argv, no shell, no user-controlled string):
//   - lizard: the `lizard` executable (pip console script), else
//     `python -m lizard` (`python3` on POSIX).
//   - jscpd: on POSIX the `jscpd` executable. On Windows npm installs a
//     `jscpd.cmd` shim, which Node refuses to spawn without a shell; the shim's
//     JavaScript entry (`node_modules/jscpd/bin/jscpd` next to the shim, global
//     or local layout) is resolved and run with `node`. A shim whose entry
//     cannot be resolved counts as absent.

import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join, resolve } from 'path';
import type { ToolRunner } from './tool-runner.js';

export type CodeHealthToolName = 'lizard' | 'jscpd';

export const CODE_HEALTH_TOOL_NAMES: readonly CodeHealthToolName[] = ['jscpd', 'lizard'];

export interface ToolVersionRange {
  /** Lowest supported version (inclusive). */
  min: string;
  /** First unsupported version (exclusive). */
  below: string;
}

/**
 * Supported (tested) version ranges. Output formats were verified against
 * lizard 1.17.13 (`--csv`) and jscpd 4.0.5 (`--reporters json`). Any other
 * version is reported and not run, because an untested output format could
 * be misread silently.
 */
export const CODE_HEALTH_TOOL_VERSIONS: Readonly<Record<CodeHealthToolName, ToolVersionRange>> = {
  lizard: { min: '1.17.0', below: '1.18.0' },
  jscpd: { min: '4.0.0', below: '5.0.0' },
};

/** Ceiling for one `--version` call (a cold `node` start under on-access scanning can take 15 s on Windows). */
export const TOOL_VERSION_TIMEOUT_MS = 30_000;

/** How a tool is started: command plus fixed leading arguments. */
export interface ToolInvocation {
  command: string;
  prefixArgs: string[];
}

export type CodeHealthToolStatus = 'present' | 'absent' | 'unsupported_version';

export interface DetectedCodeHealthTool {
  name: CodeHealthToolName;
  status: CodeHealthToolStatus;
  /** Parsed `major.minor.patch`, or null when absent or unparsable. */
  version: string | null;
  /** Human-readable supported range, for example `>=1.17.0 <1.18.0`. */
  supported_range: string;
  /** Set when `status` is `present` (and for `unsupported_version`, for the record). */
  invocation: ToolInvocation | null;
}

export interface DetectOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** File existence check (tests inject a fake file system). */
  exists?: (path: string) => boolean;
  /** Working directory for the `--version` calls (default: the OS temp directory). */
  cwd?: string;
  /** Ceiling per `--version` call (default TOOL_VERSION_TIMEOUT_MS). */
  versionTimeoutMs?: number;
  /** Retry a timed-out `--version` call once (default true). */
  retryOnTimeout?: boolean;
}

/**
 * Options for the informational health-check listing: the same short ceiling
 * as the other prerequisite probes and no retry, so a slow or hanging
 * interpreter cannot stall `swao health-check`. Assess runs that request a tool
 * keep the longer default.
 */
export const PROBE_DETECT_OPTIONS: Readonly<DetectOptions> = { versionTimeoutMs: 5_000, retryOnTimeout: false };

export function formatVersionRange(r: ToolVersionRange): string {
  return `>=${r.min} <${r.below}`;
}

function versionParts(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (d !== 0) return d;
  }
  return 0;
}

/** True when `version` (`x.y.z`) is inside the range. */
export function isVersionSupported(version: string, range: ToolVersionRange): boolean {
  const v = versionParts(version);
  const lo = versionParts(range.min);
  const hi = versionParts(range.below);
  if (!v || !lo || !hi) return false;
  return compareVersions(v, lo) >= 0 && compareVersions(v, hi) < 0;
}

/** First `x.y.z` in a `--version` output (lizard prints `1.17.13`, jscpd `4.0.5`). */
export function parseToolVersionNumber(output: string): string | null {
  const m = /(?:^|[^\d.])(\d{1,4}\.\d{1,4}\.\d{1,6})(?![\d])/.exec(output.slice(0, 4096));
  return m ? (m[1] as string) : null;
}

function pathDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const raw = env['PATH'] ?? env['Path'] ?? env['path'] ?? '';
  const sep = platform === 'win32' ? ';' : delimiter;
  return raw.split(sep).map((d) => d.trim().replace(/^"(.*)"$/, '$1')).filter((d) => d.length > 0);
}

/**
 * Windows: the JavaScript entry behind an npm `jscpd.cmd` shim on PATH.
 * Global layout: `<dir>/jscpd.cmd` + `<dir>/node_modules/jscpd/bin/jscpd`;
 * local layout: `<pkg>/node_modules/.bin/jscpd.cmd` + `<pkg>/node_modules/jscpd/bin/jscpd`.
 */
export function resolveJscpdShimEntry(env: NodeJS.ProcessEnv, exists: (p: string) => boolean): string | null {
  for (const dir of pathDirs(env, 'win32')) {
    if (!exists(join(dir, 'jscpd.cmd'))) continue;
    for (const candidate of [join(dir, 'node_modules', 'jscpd', 'bin', 'jscpd'), resolve(dir, '..', 'jscpd', 'bin', 'jscpd')]) {
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/** Candidate invocations, in the order they are tried. */
export function toolInvocationCandidates(name: CodeHealthToolName, opts: DetectOptions = {}): ToolInvocation[] {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const exists = opts.exists ?? existsSync;
  switch (name) {
    case 'lizard':
      return [
        { command: 'lizard', prefixArgs: [] },
        { command: platform === 'win32' ? 'python' : 'python3', prefixArgs: ['-m', 'lizard'] },
      ];
    case 'jscpd': {
      if (platform !== 'win32') return [{ command: 'jscpd', prefixArgs: [] }];
      const entry = resolveJscpdShimEntry(env, exists);
      return entry ? [{ command: 'node', prefixArgs: [entry] }] : [];
    }
    default: {
      const never: never = name;
      throw new Error(`unknown code health tool: ${String(never)}`);
    }
  }
}

/**
 * Locate one tool and check its version. Each candidate is asked for
 * `--version`; the first one that exits 0 decides. A version outside the
 * pinned range (or no parsable version) is `unsupported_version`: the tool is
 * listed but never run.
 */
export async function detectCodeHealthTool(
  name: CodeHealthToolName,
  runner: ToolRunner,
  opts: DetectOptions = {},
): Promise<DetectedCodeHealthTool> {
  const range = CODE_HEALTH_TOOL_VERSIONS[name];
  const supported_range = formatVersionRange(range);
  const cwd = opts.cwd ?? tmpdir();
  for (const inv of toolInvocationCandidates(name, opts)) {
    const req = { command: inv.command, args: [...inv.prefixArgs, '--version'], cwd, timeoutMs: opts.versionTimeoutMs ?? TOOL_VERSION_TIMEOUT_MS, env: opts.env };
    let r = await runner(req);
    // A first start can exceed the ceiling while on-access scanning inspects
    // the tool's files; one retry, then the candidate counts as unusable.
    if (r.timedOut && opts.retryOnTimeout !== false) r = await runner(req);
    if (r.spawnError !== null || r.timedOut || r.exitCode !== 0) continue;
    const version = parseToolVersionNumber(`${r.stdout}\n${r.stderr}`);
    const ok = version !== null && isVersionSupported(version, range);
    return { name, status: ok ? 'present' : 'unsupported_version', version, supported_range, invocation: inv };
  }
  return { name, status: 'absent', version: null, supported_range, invocation: null };
}

/** Detect several tools, in CODE_HEALTH_TOOL_NAMES order (deterministic). */
export async function detectCodeHealthTools(
  runner: ToolRunner,
  names: readonly CodeHealthToolName[] = CODE_HEALTH_TOOL_NAMES,
  opts: DetectOptions = {},
): Promise<DetectedCodeHealthTool[]> {
  const out: DetectedCodeHealthTool[] = [];
  for (const n of CODE_HEALTH_TOOL_NAMES) {
    if (names.includes(n)) out.push(await detectCodeHealthTool(n, runner, opts));
  }
  return out;
}
