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

// #3487: Windows-safe external tool runner (Design 117 section 10.1).
//
// `spawnSync` with pipe stdio is not a deadline on win32 when the child starts
// grandchildren (pip launchers start python.exe, npm shims start node.exe):
// the grandchild inherits the pipe and the parent hangs past the timeout.
// This runner uses async `spawn` with file-backed stdio, a timeout and a
// tree-kill by PID (`taskkill /PID <pid> /T /F` on Windows, the process group
// on POSIX). Never a shell, never an image-name kill, never a port lookup.
//
// The runner is injectable (`ToolRunner`), so passes and probes test every
// outcome (success, timeout, non-zero exit, bad version, malformed output)
// with fakes and never need the real tool.

import { execFileSync, spawn } from 'child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { selfSpawnEnv } from './self-spawn.js';

export interface ToolRunRequest {
  /** Executable name or absolute path. Never run through a shell. */
  command: string;
  /** Fixed argument vector; each element is passed verbatim. */
  args: readonly string[];
  /** Working directory (a SWAO-owned temp directory for analysis tools). */
  cwd: string;
  /** Hard ceiling; the process tree is killed when it is reached. */
  timeoutMs: number;
  /** Child environment; defaults to the parent environment. */
  env?: NodeJS.ProcessEnv;
}

export interface ToolRunResult {
  /** Exit code; null when the process was killed or never started. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Spawn failure (`ENOENT` when the command is not on PATH), else null. */
  spawnError: string | null;
  /**
   * #4488: the error code of a spawn failure (`ENOENT` only when the command is
   * not on PATH; `EACCES`, a temp directory failure and others differ). Absent
   * from fakes and older runners; read it with spawnErrorIsNotFound.
   */
  spawnErrorCode?: string | null;
}

/**
 * #4488: true only when a spawn failure means "command not found" (ENOENT).
 * A timeout, a permission error or a temp directory failure is not "not found".
 */
export function spawnErrorIsNotFound(r: Pick<ToolRunResult, 'spawnError' | 'spawnErrorCode'>): boolean {
  if (r.spawnError === null) return false;
  if (r.spawnErrorCode !== undefined && r.spawnErrorCode !== null) return r.spawnErrorCode === 'ENOENT';
  return r.spawnError.includes('ENOENT');
}

export type ToolRunner = (req: ToolRunRequest) => Promise<ToolRunResult>;

/** Bytes of stdout / stderr kept per run (larger output is truncated). */
export const TOOL_OUTPUT_MAX_BYTES = 64 * 1024 * 1024;

/** Tree-kill one PID (never an image name). Resolves when the kill was issued. */
export function treeKillPid(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    return new Promise<void>((resolve) => {
      try {
        const k = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        k.once('exit', () => resolve());
        k.once('error', () => resolve());
      } catch {
        resolve();
      }
    });
  }
  // A process group leader (a child spawned with `detached`) and its group.
  try { process.kill(-pid, 'SIGKILL'); return Promise.resolve(); } catch { /* not a group leader */ }
  // #4470: a child spawned without `detached` (the LLM leg and challenge
  // processes) shares the parent's group, so the group kill fails. Snapshot
  // all descendants before any kill (a killed parent reparents its children
  // to init and the link is lost), then kill the root and every descendant.
  const descendants = posixDescendants(pid);
  try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  for (const d of descendants) {
    try { process.kill(d, 'SIGKILL'); } catch { /* already gone */ }
  }
  return Promise.resolve();
}

/** Parent PID map of all processes from /proc (Linux); null when /proc is not readable. */
function procParentMap(): Map<number, number[]> | null {
  let entries: string[];
  try { entries = readdirSync('/proc'); } catch { return null; }
  const children = new Map<number, number[]>();
  for (const e of entries) {
    const p = Number(e);
    if (!Number.isInteger(p) || p <= 0) continue;
    let stat: string;
    try { stat = readFileSync(`/proc/${e}/stat`, 'utf-8'); } catch { continue; }
    // The command name (field 2) may contain spaces and parentheses: the
    // fields after the last ")" are state, then the parent PID.
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ppid = Number(rest[1]);
    if (!Number.isInteger(ppid)) continue;
    const list = children.get(ppid);
    if (list) list.push(p); else children.set(ppid, [p]);
  }
  return children;
}

/** Direct children of one PID via `pgrep -P` (macOS and other POSIX systems without /proc). */
function pgrepChildren(pid: number): number[] {
  try {
    const out = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf-8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split(/\s+/).map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return []; // exit 1 = no children; a missing pgrep leaves only the root kill
  }
}

/** All descendant PIDs of one PID (POSIX), breadth first. */
export function posixDescendants(pid: number): number[] {
  const map = procParentMap();
  const childrenOf = (p: number): number[] => (map ? map.get(p) ?? [] : pgrepChildren(p));
  const seen = new Set<number>([pid]);
  const out: number[] = [];
  const queue = [pid];
  while (queue.length > 0) {
    const p = queue.shift()!;
    for (const c of childrenOf(p)) {
      if (seen.has(c)) continue;
      seen.add(c);
      out.push(c);
      queue.push(c);
    }
  }
  return out;
}

/** The `code` of a Node system error (ENOENT, EACCES), else undefined. */
function errCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

function readCapped(path: string): string {
  if (!existsSync(path)) return '';
  try {
    const buf = readFileSync(path);
    return (buf.length > TOOL_OUTPUT_MAX_BYTES ? buf.subarray(0, TOOL_OUTPUT_MAX_BYTES) : buf).toString('utf-8');
  } catch {
    return '';
  }
}

/**
 * The production runner: async spawn, file-backed stdout / stderr in a fresh
 * temp directory, timeout with tree-kill. Never rejects. When SWAO runs as a
 * pkg binary, `PKG_EXECPATH` is cleared in the child environment so a child
 * `node` is not mistaken for the binary itself.
 */
export const fileBackedToolRunner: ToolRunner = (req) => new Promise<ToolRunResult>((resolve) => {
  let dir: string;
  try {
    dir = mkdtempSync(join(tmpdir(), 'swao-tool-'));
  } catch (err) {
    resolve({ exitCode: null, stdout: '', stderr: '', timedOut: false, spawnError: err instanceof Error ? err.message : String(err), spawnErrorCode: 'TEMPDIR' });
    return;
  }
  const outPath = join(dir, 'stdout.txt');
  const errPath = join(dir, 'stderr.txt');
  let outFd: number | undefined;
  let errFd: number | undefined;
  const closeFds = (): void => {
    if (outFd !== undefined) { try { closeSync(outFd); } catch { /* ignore */ } outFd = undefined; }
    if (errFd !== undefined) { try { closeSync(errFd); } catch { /* ignore */ } errFd = undefined; }
  };
  const collect = (): { stdout: string; stderr: string } => {
    const out = { stdout: readCapped(outPath), stderr: readCapped(errPath) };
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    return out;
  };

  let child: ReturnType<typeof spawn>;
  try {
    outFd = openSync(outPath, 'w');
    errFd = openSync(errPath, 'w');
    child = spawn(req.command, [...req.args], {
      cwd: req.cwd,
      env: selfSpawnEnv(req.env ?? process.env),
      stdio: ['ignore', outFd, errFd],
      windowsHide: true,
      shell: false,
      // POSIX: own process group, so the tree-kill reaches grandchildren.
      detached: process.platform !== 'win32',
    });
  } catch (err) {
    closeFds();
    const { stdout, stderr } = collect();
    resolve({ exitCode: null, stdout, stderr, timedOut: false, spawnError: err instanceof Error ? err.message : String(err), spawnErrorCode: errCode(err) ?? null });
    return;
  }
  // The child holds its own copies of the descriptors.
  closeFds();

  const pid = child.pid;
  let timedOut = false;
  let settled = false;
  // #4488: the deadline is decided in the check phase, after the poll phase has
  // delivered an exit that is already pending. When the caller blocks the event
  // loop with synchronous work for longer than the timeout (the health check
  // runs synchronous probes while the version checks run), the timer fires in
  // the timers phase before the exit of a child that ended long ago is read;
  // deciding there marked every tool as timed out (dev11: git "not found").
  const timer = setTimeout(() => {
    setImmediate(() => {
      if (settled) return;
      timedOut = true;
      if (pid !== undefined) void treeKillPid(pid);
    });
  }, Math.max(1, req.timeoutMs));

  const finish = (code: number | null, spawnError: string | null, spawnErrorCode: string | null = null): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    // POSIX: release grandchildren left in the group.
    if (pid !== undefined && process.platform !== 'win32') { try { process.kill(-pid, 'SIGKILL'); } catch { /* group gone */ } }
    const { stdout, stderr } = collect();
    resolve({ exitCode: timedOut ? null : code, stdout, stderr, timedOut, spawnError, ...(spawnErrorCode !== null ? { spawnErrorCode } : {}) });
  };
  child.once('exit', (code) => finish(code, null));
  child.once('error', (err) => finish(null, err.message, errCode(err) ?? null));
});
