// #4384: awaitChild streams output, resolves with the exit code, and on abort
// kills the child tree by PID and resolves cancelled.

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { awaitChild, type CancellableChild } from './cancellable-child.js';

function fakeChild(pid: number | undefined = 4242): CancellableChild & { emit: (ev: string, ...a: unknown[]) => boolean; out: EventEmitter; err: EventEmitter } {
  const ee = new EventEmitter();
  const out = new EventEmitter();
  const err = new EventEmitter();
  return Object.assign(ee, { pid, stdout: out, stderr: err, out, err }) as never;
}

describe('awaitChild (#4384)', () => {
  it('streams stdout and stderr and resolves with the exit code', async () => {
    const child = fakeChild();
    const chunks: string[] = [];
    const p = awaitChild(child, { onChunk: (c) => chunks.push(c.toString()) });
    child.out.emit('data', Buffer.from('a'));
    child.err.emit('data', Buffer.from('b'));
    child.emit('close', 3);
    await expect(p).resolves.toEqual({ code: 3, cancelled: false });
    expect(chunks).toEqual(['a', 'b']);
  });

  it('an abort kills the tree by PID once and resolves cancelled when the child closes', async () => {
    const child = fakeChild(777);
    const kill = vi.fn();
    const ac = new AbortController();
    const p = awaitChild(child, { signal: ac.signal, kill });
    ac.abort();
    ac.abort();
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(777);
    child.emit('close', 1);
    await expect(p).resolves.toEqual({ code: null, cancelled: true });
  });

  it('an already aborted signal kills at once; an abort after close changes nothing', async () => {
    const ac = new AbortController();
    ac.abort();
    const kill = vi.fn();
    const first = fakeChild(1);
    const p1 = awaitChild(first, { signal: ac.signal, kill });
    expect(kill).toHaveBeenCalledWith(1);
    first.emit('close', null);
    await expect(p1).resolves.toEqual({ code: null, cancelled: true });

    const ac2 = new AbortController();
    const kill2 = vi.fn();
    const second = fakeChild(2);
    const p2 = awaitChild(second, { signal: ac2.signal, kill: kill2 });
    second.emit('close', 0);
    await expect(p2).resolves.toEqual({ code: 0, cancelled: false });
    ac2.abort();
    expect(kill2).not.toHaveBeenCalled();
  });

  it('a spawn error resolves with code null, not cancelled', async () => {
    const child = fakeChild(undefined);
    const p = awaitChild(child);
    child.emit('error', new Error('ENOENT'));
    await expect(p).resolves.toEqual({ code: null, cancelled: false });
  });

  it('stops a real long-running child through the default tree kill', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const ac = new AbortController();
    const p = awaitChild(child, { signal: ac.signal });
    setTimeout(() => ac.abort(), 200);
    await expect(p).resolves.toEqual({ code: null, cancelled: true });
  }, 30_000);
});
