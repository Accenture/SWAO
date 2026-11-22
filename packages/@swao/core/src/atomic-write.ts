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

// #3686, #3823, #3820: one atomic temp-file-then-rename write for every state
// file SWAO owns (credential vault, licence state, MCP client configs). On
// Windows an antivirus scanner or the search indexer can hold the freshly
// written file open for a moment, so the rename over the target fails with
// EPERM, EACCES or EBUSY. Those codes are retried a bounded number of times
// with a doubling pause; every other error, and every error off Windows, is
// thrown at once. Only the rename is retried, never the caller's
// read-modify-write, so a retry cannot apply a change twice.

import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** Rename error codes a retry can fix: on Windows another process briefly holds the file open. */
export const TRANSIENT_RENAME_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Default total rename attempts on Windows, the first included. */
export const DEFAULT_RENAME_ATTEMPTS = 5;
/** Default wait before the first retry; doubles on each retry (25, 50, 100, 200 ms, 375 ms in total). */
export const DEFAULT_RENAME_BASE_DELAY_MS = 25;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Filesystem seams of the helper. Production code never changes them; tests
 * swap `rename` to fail N times (or permanently) without touching file ACLs,
 * and `sleep` so they never pause.
 */
export const _atomicWriteIo = {
  rename: (src: string, dest: string): void => renameSync(src, dest),
  sleep: (ms: number): void => sleepSync(ms),
  platform: (): NodeJS.Platform => process.platform,
};

export interface RenameRetryOptions {
  /** Platform whose rename semantics apply (default `_atomicWriteIo.platform()`, the running one). Retries happen on win32 only. */
  platform?: NodeJS.Platform;
  /** Total attempts on win32, the first included (default 5). */
  attempts?: number;
  /** Wait before the first retry; doubles on each retry (default 25 ms). */
  baseDelayMs?: number;
  /** Rename implementation (default `_atomicWriteIo.rename`, looked up per call). */
  rename?: (src: string, dest: string) => void;
  /** Synchronous wait (default `_atomicWriteIo.sleep`, looked up per call). */
  sleep?: (ms: number) => void;
  /** Called before each retry with the failed attempt number and error code, so a retry is observable. */
  onRetry?: (attempt: number, code: string) => void;
}

/**
 * Renames `src` to `dest`, retrying a transient Windows lock (EPERM, EACCES,
 * EBUSY) with a doubling wait. Throws the last error when the attempts run out,
 * and any non-transient error (or any error off win32, or one without a
 * `code`) at once.
 */
export function renameWithRetrySync(src: string, dest: string, opts: RenameRetryOptions = {}): void {
  const attempts = (opts.platform ?? _atomicWriteIo.platform()) === 'win32'
    ? Math.max(1, opts.attempts ?? DEFAULT_RENAME_ATTEMPTS)
    : 1;
  const rename = opts.rename ?? _atomicWriteIo.rename;
  const sleep = opts.sleep ?? _atomicWriteIo.sleep;
  let delay = opts.baseDelayMs ?? DEFAULT_RENAME_BASE_DELAY_MS;
  for (let attempt = 1; ; attempt++) {
    try {
      rename(src, dest);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= attempts || code === undefined || !TRANSIENT_RENAME_CODES.has(code)) throw e;
      opts.onRetry?.(attempt, code);
      sleep(delay);
      delay *= 2;
    }
  }
}

export interface AtomicWriteOptions extends RenameRetryOptions {
  /** File mode of the temp file, kept by the rename (for example 0o600 for the credential vault). */
  mode?: number;
}

let tmpCounter = 0;

/**
 * Unique temp path next to `target` (same directory, so the same volume and an
 * atomic rename). Hidden, ends in `.tmp`; pid plus a per-process counter plus
 * the time keep two writers (two processes, or two writes in one millisecond)
 * from sharing a temp file.
 */
export function atomicTempPath(target: string): string {
  tmpCounter = (tmpCounter + 1) % 1_000_000;
  return join(dirname(target), `.${basename(target)}.${process.pid}.${Date.now()}.${tmpCounter}.tmp`);
}

/**
 * Writes `data` to `target` atomically: the bytes go to a unique temp file in
 * the same directory, which is then renamed over the target with
 * `renameWithRetrySync`. A crash or a full disk mid-write leaves the previous
 * file intact. On failure the temp file is removed (best effort) and the error
 * is re-thrown, so no partial copy of the content is left behind.
 */
export function writeFileAtomicSync(target: string, data: string, opts: AtomicWriteOptions = {}): void {
  const tmp = atomicTempPath(target);
  try {
    writeFileSync(tmp, data, opts.mode === undefined ? { encoding: 'utf-8' } : { encoding: 'utf-8', mode: opts.mode });
    renameWithRetrySync(tmp, target, opts);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw e;
  }
}
