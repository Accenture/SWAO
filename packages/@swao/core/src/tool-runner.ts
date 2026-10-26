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

import { spawn } from 'child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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
  try { process.kill(-pid, 'SIGKILL'); } catch {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  return Promise.resolve();
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
    resolve({ exitCode: null, stdout: '', stderr: '', timedOut: false, spawnError: err instanceof Error ? err.message : String(err) });
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
      env: { ...(req.env ?? process.env), PKG_EXECPATH: '' },
      stdio: ['ignore', outFd, errFd],
      windowsHide: true,
      shell: false,
      // POSIX: own process group, so the tree-kill reaches grandchildren.
      detached: process.platform !== 'win32',
    });
  } catch (err) {
    closeFds();
    const { stdout, stderr } = collect();
    resolve({ exitCode: null, stdout, stderr, timedOut: false, spawnError: err instanceof Error ? err.message : String(err) });
    return;
  }
  // The child holds its own copies of the descriptors.
  closeFds();

  const pid = child.pid;
  let timedOut = false;
  let settled = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (pid !== undefined) void treeKillPid(pid);
  }, Math.max(1, req.timeoutMs));

  const finish = (code: number | null, spawnError: string | null): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    // POSIX: release grandchildren left in the group.
    if (pid !== undefined && process.platform !== 'win32') { try { process.kill(-pid, 'SIGKILL'); } catch { /* group gone */ } }
    const { stdout, stderr } = collect();
    resolve({ exitCode: timedOut ? null : code, stdout, stderr, timedOut, spawnError });
  };
  child.once('exit', (code) => finish(code, null));
  child.once('error', (err) => finish(null, err.message));
});
