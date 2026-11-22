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

// #4384 (Design 126 section 7.6): a TUI operation that runs as a child of the
// running SWAO and is shown with "Esc cancel" must stop when Esc is pressed.
// `awaitChild` waits for a spawned child, streams its output, and on an abort
// signal stops the whole process tree by PID (`treeKillPid`, never an image
// name) and reports the outcome as cancelled, so the screen can show the
// result "Cancelled" instead of a failure.

import { treeKillPid } from './tool-runner.js';

/** The part of a ChildProcess awaitChild needs (fakes in tests). */
export interface CancellableChild {
  pid?: number | undefined;
  stdout?: { on(event: 'data', fn: (chunk: Buffer) => void): unknown } | null;
  stderr?: { on(event: 'data', fn: (chunk: Buffer) => void): unknown } | null;
  once(event: 'close', fn: (code: number | null) => void): unknown;
  once(event: 'error', fn: (err: Error) => void): unknown;
}

export interface ChildOutcome {
  /** Exit code; null when the child was killed or failed to start. */
  code: number | null;
  /** True when the abort signal stopped the child. */
  cancelled: boolean;
}

export interface AwaitChildOptions {
  /** Aborting stops the child tree and resolves with cancelled true. */
  signal?: AbortSignal;
  /** Every stdout and stderr chunk, in arrival order. */
  onChunk?: (chunk: Buffer) => void;
  /** Tree kill by PID; injectable for tests. */
  kill?: (pid: number) => unknown;
}

/** Wait for a child to close; an abort kills its tree and marks the outcome cancelled. */
export function awaitChild(child: CancellableChild, opts: AwaitChildOptions = {}): Promise<ChildOutcome> {
  const kill = opts.kill ?? treeKillPid;
  return new Promise<ChildOutcome>((resolve) => {
    let cancelled = false;
    let settled = false;
    const onAbort = (): void => {
      if (settled || cancelled) return;
      cancelled = true;
      if (child.pid !== undefined) void kill(child.pid);
    };
    const settle = (code: number | null): void => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ code: cancelled ? null : code, cancelled });
    };
    if (opts.onChunk) {
      child.stdout?.on('data', opts.onChunk);
      child.stderr?.on('data', opts.onChunk);
    }
    child.once('close', (code) => settle(code));
    child.once('error', () => settle(null));
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });
  });
}
