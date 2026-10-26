// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- safe client-config writer: rename retry
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3491: on Windows an antivirus scanner or the search indexer can hold the
// target file open for a moment, so the atomic rename fails with EPERM, EACCES
// or EBUSY. The writer retries that rename a bounded number of times. The
// platform and the sleep are injected, so these tests run on every OS and
// never wait. All files live in a temp sandbox.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { NODE_WRITER_FS, applyFilePlan, renameWithRetry, type WriterFs } from './mcp-safe-writer.js';

function fsError(code: string): NodeJS.ErrnoException {
  const e = new Error(`${code}: simulated, rename`) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

/** A rename that fails with `code` for the first `failures` calls, then renames for real. */
function flakyRename(code: string, failures: number): { rename: WriterFs['rename']; calls: () => number } {
  let n = 0;
  return {
    rename: (src, dest) => {
      n++;
      if (n <= failures) throw fsError(code);
      NODE_WRITER_FS.rename(src, dest);
    },
    calls: () => n,
  };
}

describe('renameWithRetry (#3491)', () => {
  const noSleep = (): void => {};

  it.each(['EPERM', 'EACCES', 'EBUSY'])('retries %s on win32 until the rename succeeds', (code) => {
    const delays: number[] = [];
    let n = 0;
    renameWithRetry(() => { if (++n <= 2) throw fsError(code); }, 'a', 'b', { platform: 'win32', sleep: (ms) => delays.push(ms) });
    expect(n).toBe(3);
    expect(delays).toEqual([20, 40]);
  });

  it('gives up after the attempt limit and rethrows the last error', () => {
    let n = 0;
    expect(() => renameWithRetry(() => { n++; throw fsError('EPERM'); }, 'a', 'b', { platform: 'win32', sleep: noSleep })).toThrow(/EPERM/);
    expect(n).toBe(5);
  });

  it('does not retry an error that a retry cannot fix (ENOENT)', () => {
    let n = 0;
    expect(() => renameWithRetry(() => { n++; throw fsError('ENOENT'); }, 'a', 'b', { platform: 'win32', sleep: noSleep })).toThrow(/ENOENT/);
    expect(n).toBe(1);
  });

  it('does not retry an error without a code', () => {
    let n = 0;
    expect(() => renameWithRetry(() => { n++; throw new Error('EBUSY: simulated'); }, 'a', 'b', { platform: 'win32', sleep: noSleep })).toThrow(/EBUSY/);
    expect(n).toBe(1);
  });

  it('does not retry on other platforms, where rename replaces an open file', () => {
    let n = 0;
    expect(() => renameWithRetry(() => { n++; throw fsError('EBUSY'); }, 'a', 'b', { platform: 'linux', sleep: noSleep })).toThrow(/EBUSY/);
    expect(n).toBe(1);
  });

  it('bounds the total wait to a few hundred milliseconds', () => {
    const delays: number[] = [];
    expect(() => renameWithRetry(() => { throw fsError('EBUSY'); }, 'a', 'b', { platform: 'win32', sleep: (ms) => delays.push(ms) })).toThrow();
    expect(delays).toEqual([20, 40, 80, 160]);
  });
});

describe('applyFilePlan with a briefly locked target (#3491)', () => {
  let dir: string;
  let target: string;
  const original = '{\n  "mcpServers": {}\n}\n';
  const updated = '{\n  "mcpServers": {\n    "swao": {}\n  }\n}\n';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'swao-writer-retry-'));
    target = join(dir, 'mcp.json');
    writeFileSync(target, original);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const plan = (): Parameters<typeof applyFilePlan>[0] => ({ kind: 'change', path: target, before: original, after: updated });

  it('writes the file when the rename fails twice with EPERM and then succeeds', () => {
    const flaky = flakyRename('EPERM', 2);
    const r = applyFilePlan(plan(), { dryRun: false, fs: { ...NODE_WRITER_FS, rename: flaky.rename }, renameRetry: { platform: 'win32', sleep: () => {} } });
    expect(r.status).toBe('written');
    expect(flaky.calls()).toBe(3);
    expect(readFileSync(target, 'utf-8')).toBe(updated);
    expect(readdirSync(dir).filter((f) => f.includes('swao-tmp'))).toEqual([]);
  });

  it('reports an error, removes the temp file and leaves the target untouched when the lock persists', () => {
    const flaky = flakyRename('EPERM', Number.POSITIVE_INFINITY);
    const r = applyFilePlan(plan(), { dryRun: false, fs: { ...NODE_WRITER_FS, rename: flaky.rename }, renameRetry: { platform: 'win32', sleep: () => {} } });
    expect(r.status).toBe('error');
    expect(r.status === 'error' && r.message).toMatch(/EPERM/);
    expect(flaky.calls()).toBe(5);
    expect(readFileSync(target, 'utf-8')).toBe(original);
    expect(readdirSync(dir).filter((f) => f.includes('swao-tmp'))).toEqual([]);
  });
});
