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

// #3439: `git clone` wrapper for source.vcs repositories.
//
// Three field failures from the 2026-10-23 support bundle drive this module:
//
//   1. Long paths. Git for Windows refuses to check out files whose full path
//      exceeds MAX_PATH ("Filename too long", "Clone succeeded, but checkout
//      failed"). The clone runs with `-c core.longpaths=true`. The flag is
//      passed on every platform: `core.longpaths` is a Git for Windows
//      setting that other git builds ignore as an unknown key, so it is
//      harmless elsewhere and keeps the argument list platform-independent
//      (one code path, one test). It is a top-level `-c` (before `clone`), so
//      it applies to this invocation only and is NOT persisted into the
//      cloned repository's .git/config.
//
//   2. Interactive credential prompts. In SWAO's non-TTY spawn, Git
//      Credential Manager opened a GUI dialog and git then tried /dev/tty.
//      The clone env forces GIT_TERMINAL_PROMPT=0 and GCM_INTERACTIVE=never
//      (plus `-c credential.interactive=never`, the config-key equivalent GCM
//      also honours) so a missing or rejected credential fails fast; the
//      stderr is then classified by `diagnoseCloneFailure` (auth.ts) into an
//      operator hint naming the credential key to configure.
//
//   3. Hangs. git spawns grandchildren (git-remote-https, GCM) that inherit
//      the stdio pipes; spawnSync blocks on pipe EOF past its own timeout on
//      Windows (#1415, see health-check/vcs-auth-probe.ts). The clone runs
//      via async spawn, resolves on direct-child exit and tree-kills on a
//      deadline.
//
// The clone URL may carry a PAT in its userinfo (buildAuthenticatedCloneUrl).
// Nothing in this module logs the argument list; telemetry must go through
// `redactVcsUrl`.

import { spawn, spawnSync } from 'child_process';

/** Environment variables forced onto every clone spawn (#3439). */
export const NON_INTERACTIVE_GIT_ENV: Readonly<Record<string, string>> = Object.freeze({
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
});

/** Default wall-clock ceiling for a shallow clone (large monorepos on slow links). */
export const CLONE_TIMEOUT_MS = 10 * 60_000;

/**
 * #3439: clone deadline from `source.vcs.clone_timeout_minutes` in the app
 * .swao.yml. SwaoYmlVcsSchema (@swao/core) validates the value at load time
 * (integer, 1 to 240); this only converts it, and falls back to
 * CLONE_TIMEOUT_MS (10 minutes) when the key is absent or not a positive
 * finite number (defensive: callers hand in the parsed block as unknown).
 */
export function cloneTimeoutMsFromVcs(minutes: unknown): number {
  return typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0
    ? minutes * 60_000
    : CLONE_TIMEOUT_MS;
}

export interface CloneArgsInput {
  /** Clone URL as handed to git (may carry a token; never log it). */
  cloneUrl: string;
  targetPath: string;
  ref?: string;
}

/**
 * Build the `git` argument vector for a shallow source clone.
 * Top-level `-c` options must precede the `clone` sub-command.
 */
export function buildCloneArgs({ cloneUrl, targetPath, ref }: CloneArgsInput): string[] {
  const args = [
    '-c', 'core.longpaths=true',
    '-c', 'credential.interactive=never',
    // --quiet suppresses the per-tick "Updating files: N%" progress flood
    // (#0619); errors still surface on stderr.
    'clone', '--depth', '1', '--quiet',
  ];
  if (ref) args.push('--branch', ref);
  args.push(cloneUrl, targetPath);
  return args;
}

/**
 * Merge the clone env: the caller's base env (normally process.env), then the
 * per-clone GIT_CONFIG_* proxy/TLS entries (#2749), then the non-interactive
 * variables LAST so neither the operator's shell nor a config block can
 * re-enable a prompt that would hang the non-TTY spawn.
 */
export function buildCloneEnv(
  baseEnv: NodeJS.ProcessEnv,
  gitConfigEnv: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return { ...baseEnv, ...gitConfigEnv, ...NON_INTERACTIVE_GIT_ENV };
}

export type VcsUrlScheme = 'https' | 'http' | 'ssh' | 'scp' | 'git' | 'file' | 'local-path' | 'unknown';

/**
 * Classify the transport of a VCS URL for telemetry (#3439). Previously the
 * clone-failed entry reported the token scheme ('none' when no PAT was
 * stored) under `scheme`, which read as "no URL scheme" for https:// URLs.
 */
export function parseVcsUrlScheme(url: string): VcsUrlScheme {
  const u = url.trim();
  if (!u) return 'unknown';
  // Windows drive letters parse as a one-letter URL protocol ("c:"), so
  // detect local paths before trying a URL parse.
  if (/^[a-zA-Z]:[\\/]/.test(u) || u.startsWith('\\\\') || u.startsWith('/') || u.startsWith('./') || u.startsWith('../')) {
    return 'local-path';
  }
  const proto = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(u);
  if (proto) {
    const p = proto[1].toLowerCase();
    switch (p) {
      case 'https': return 'https';
      case 'http': return 'http';
      case 'ssh':
      case 'git+ssh':
      case 'ssh+git': return 'ssh';
      case 'git': return 'git';
      case 'file': return 'file';
      default: return 'unknown';
    }
  }
  // scp-like syntax: [user@]host:path (no "://", no slash before the colon).
  if (/^(?:[^@/\\\s]+@)?[^@/\\:\s]+:[^\s]/.test(u)) return 'scp';
  return 'unknown';
}

/**
 * Strip credentials from a VCS URL before it reaches a log or the console.
 * URL forms drop userinfo entirely (user, password or a token-as-username);
 * scp-like forms keep the user (e.g. `git@`), which carries no secret.
 */
export function redactVcsUrl(url: string): string {
  return url.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@\s]*@/, '$1');
}

export interface GitCloneRun {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Run `git <args>` with the given env via async spawn (#3439, pattern from
 * #1415 runGitLsRemote). Resolves when the DIRECT child exits, so a
 * grandchild that still holds the inherited pipes cannot block; on the
 * deadline the whole process tree is killed. `cmd` is injectable for tests.
 */
export function runGitClone(
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number = CLONE_TIMEOUT_MS,
  cmd = 'git',
): Promise<GitCloneRun> {
  return new Promise((resolvePromise) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env, windowsHide: true });
    const settle = (status: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Release the pipes so a lingering grandchild (GCM, git-remote-https)
      // holding them cannot keep the assess event loop alive.
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolvePromise({ status, stdout, stderr, timedOut });
    };
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }
      stderr += `\ngit clone timed out after ${Math.round(timeoutMs / 1000)} s`;
      settle(null);
    }, timeoutMs);
    child.on('error', (err: NodeJS.ErrnoException) => {
      stderr += `\n${err.code === 'ENOENT' ? 'git is not installed or not on PATH' : err.message}`;
      settle(null);
    });
    // Resolve on EXIT, not 'close': a surviving grandchild can keep the pipes
    // open long after git itself has returned. Give buffered output a tick
    // to drain before settling.
    child.on('exit', (code) => { setTimeout(() => settle(code), 50); });
  });
}
