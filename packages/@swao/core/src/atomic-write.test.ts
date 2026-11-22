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

// #3686, #3823, #3820: the shared atomic temp-file-then-rename write. The
// transient Windows lock is simulated deterministically through the
// _atomicWriteIo seam: the rename fails N times and then succeeds, or fails
// on every attempt, so no test depends on a real scanner or on timing.

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _atomicWriteIo,
  atomicTempPath,
  DEFAULT_RENAME_ATTEMPTS,
  renameWithRetrySync,
  writeFileAtomicSync,
} from './atomic-write.js';

const savedIo = { ..._atomicWriteIo };
let dir = '';
let sleeps: number[] = [];

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: operation not permitted, rename (simulated)`), { code });
}

/** A rename that throws the given codes in order, then does the real rename. */
function failingRename(codes: string[]): { attempts: () => number } {
  let attempts = 0;
  const queue = [...codes];
  _atomicWriteIo.rename = (src, dest) => {
    attempts++;
    const code = queue.shift();
    if (code !== undefined) throw errno(code);
    savedIo.rename(src, dest);
  };
  return { attempts: () => attempts };
}

function tmpLeftovers(): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.tmp'));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'swao-atomic-write-'));
  sleeps = [];
  _atomicWriteIo.sleep = (ms) => { sleeps.push(ms); };
  _atomicWriteIo.platform = () => 'win32';
});

afterEach(() => {
  Object.assign(_atomicWriteIo, savedIo);
  rmSync(dir, { recursive: true, force: true });
});

describe('renameWithRetrySync', () => {
  it.each(['EPERM', 'EBUSY', 'EACCES'])('retries a transient %s on win32 until the rename succeeds', (code) => {
    let n = 0;
    renameWithRetrySync('a', 'b', { rename: () => { if (++n <= 2) throw errno(code); } });
    expect(n).toBe(3);
    expect(sleeps).toEqual([25, 50]);
  });

  it('gives up after the bounded attempts with a doubling wait and throws the last error', () => {
    let n = 0;
    expect(() => renameWithRetrySync('a', 'b', { rename: () => { n++; throw errno('EPERM'); } })).toThrow(/EPERM/);
    expect(n).toBe(DEFAULT_RENAME_ATTEMPTS);
    expect(sleeps).toEqual([25, 50, 100, 200]);
  });

  it('honours attempts and baseDelayMs', () => {
    let n = 0;
    expect(() => renameWithRetrySync('a', 'b', { attempts: 3, baseDelayMs: 10, rename: () => { n++; throw errno('EBUSY'); } })).toThrow(/EBUSY/);
    expect(n).toBe(3);
    expect(sleeps).toEqual([10, 20]);
  });

  it('does not retry a non-transient error or an error without a code', () => {
    let n = 0;
    expect(() => renameWithRetrySync('a', 'b', { rename: () => { n++; throw errno('ENOENT'); } })).toThrow(/ENOENT/);
    expect(n).toBe(1);
    n = 0;
    expect(() => renameWithRetrySync('a', 'b', { rename: () => { n++; throw new Error('EBUSY: no code'); } })).toThrow(/EBUSY/);
    expect(n).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('does not retry off win32 (the running platform or an explicit one)', () => {
    let n = 0;
    _atomicWriteIo.platform = () => 'linux';
    expect(() => renameWithRetrySync('a', 'b', { rename: () => { n++; throw errno('EPERM'); } })).toThrow(/EPERM/);
    expect(n).toBe(1);
    _atomicWriteIo.platform = () => 'win32';
    n = 0;
    expect(() => renameWithRetrySync('a', 'b', { platform: 'darwin', rename: () => { n++; throw errno('EPERM'); } })).toThrow(/EPERM/);
    expect(n).toBe(1);
  });

  it('makes each retry observable through onRetry', () => {
    const retries: Array<[number, string]> = [];
    let n = 0;
    renameWithRetrySync('a', 'b', {
      rename: () => { if (++n === 1) throw errno('EPERM'); if (n === 2) throw errno('EBUSY'); },
      onRetry: (attempt, code) => retries.push([attempt, code]),
    });
    expect(retries).toEqual([[1, 'EPERM'], [2, 'EBUSY']]);
  });

  it('uses the _atomicWriteIo seams when no rename or sleep is passed', () => {
    const r = failingRename(['EPERM']);
    writeFileSync(join(dir, 'src.txt'), 'x');
    renameWithRetrySync(join(dir, 'src.txt'), join(dir, 'dest.txt'));
    expect(r.attempts()).toBe(2);
    expect(sleeps).toEqual([25]);
    expect(readFileSync(join(dir, 'dest.txt'), 'utf-8')).toBe('x');
  });
});

describe('writeFileAtomicSync', () => {
  it('writes through a unique temp file in the same directory and leaves no temp file', () => {
    const target = join(dir, 'state.json');
    const seen: Array<[string, string]> = [];
    _atomicWriteIo.rename = (src, dest) => { savedIo.rename(src, dest); seen.push([src, dest]); };
    writeFileAtomicSync(target, '{"a":1}');
    expect(readFileSync(target, 'utf-8')).toBe('{"a":1}');
    expect(seen).toHaveLength(1);
    expect(seen[0]![1]).toBe(target);
    expect(dirname(seen[0]![0])).toBe(dir);
    expect(seen[0]![0]).toMatch(/\.tmp$/);
    expect(tmpLeftovers()).toEqual([]);
  });

  it('replaces an existing target after a transient EPERM then EBUSY (win32)', () => {
    const target = join(dir, 'state.json');
    writeFileSync(target, 'old');
    const r = failingRename(['EPERM', 'EBUSY']);
    writeFileAtomicSync(target, 'new');
    expect(r.attempts()).toBe(3);
    expect(readFileSync(target, 'utf-8')).toBe('new');
    expect(tmpLeftovers()).toEqual([]);
  });

  it('on a persistent lock keeps the old content, removes the temp file and throws', () => {
    const target = join(dir, 'state.json');
    writeFileSync(target, 'old');
    const r = failingRename(Array(10).fill('EPERM'));
    expect(() => writeFileAtomicSync(target, 'new')).toThrow(/EPERM/);
    expect(r.attempts()).toBe(DEFAULT_RENAME_ATTEMPTS);
    expect(readFileSync(target, 'utf-8')).toBe('old');
    expect(tmpLeftovers()).toEqual([]);
  });

  // POSIX permission bits only; Windows has no mode bits to check.
  it.skipIf(process.platform === 'win32')('applies the mode to the written file', () => {
    const target = join(dir, 'vault.json');
    writeFileAtomicSync(target, 'secret', { mode: 0o600 });
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it('gives two writes in the same millisecond different temp paths', () => {
    const target = join(dir, 'state.json');
    const a = atomicTempPath(target);
    const b = atomicTempPath(target);
    expect(a).not.toBe(b);
    expect(dirname(a)).toBe(dir);
  });
});
