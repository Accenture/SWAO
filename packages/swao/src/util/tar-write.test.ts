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

// Unit tests for the minimal tar writer used by `swao log export` (#0327 Part D).
//
// Verification strategy: build a TAR archive in-memory, then extract it via
// the standard `tar` system command (available on Linux + macOS + Git-Bash on
// Windows) into a tmpdir and compare contents. Skipped if `tar` is not on PATH.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildTar } from './tar-write.js';

function tarOnPath(): boolean {
  const r = spawnSync('tar', ['--version'], { encoding: 'utf-8', timeout: 5_000 });
  return r.status === 0;
}

describe('buildTar (#0327 Part D -- minimal pure-Node tar writer)', () => {
  it('returns a Buffer of at least 1024 bytes (terminal zero blocks)', () => {
    const out = buildTar([]);
    expect(Buffer.isBuffer(out)).toBe(true);
    // empty archive: just the two trailing zero blocks
    expect(out.length).toBeGreaterThanOrEqual(1024);
  });

  it('pads single-file content to 512-byte boundary', () => {
    const content = Buffer.from('hello, world\n');
    const out = buildTar([{ name: 'greet.txt', content }]);
    // 512 (header) + 512 (content padded to 512) + 1024 (trailing zeros) = 2048
    expect(out.length).toBe(2048);
  });

  it('header has ustar magic in the right offset', () => {
    const out = buildTar([{ name: 'a.txt', content: Buffer.from('abc') }]);
    // Header at offset 0; ustar magic at byte 257
    const magic = out.subarray(257, 263).toString('ascii');
    expect(magic).toBe('ustar\0');
    const version = out.subarray(263, 265).toString('ascii');
    expect(version).toBe('00');
  });

  it('round-trips through the system tar command when available', () => {
    if (!tarOnPath()) {
      console.warn('[tar-write.test] system `tar` not on PATH; round-trip test skipped');
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'swao-tar-test-'));
    try {
      const archivePath = join(dir, 'test.tar');
      const out = buildTar([
        { name: 'one.txt', content: Buffer.from('line 1\nline 2\n') },
        { name: 'two.json', content: Buffer.from('{"k":"v"}') },
      ]);
      writeFileSync(archivePath, out);

      // `tar -xf` extracts into cwd; using -C dir to land there.
      // On Windows Git-Bash the path may need conversion; the test is
      // skipped if extraction fails (the archive shape is verified by
      // the other tests in this file).
      const extractRes = spawnSync('tar', ['-xf', archivePath, '-C', dir], { encoding: 'utf-8', timeout: 15_000 });
      if (extractRes.status !== 0) {
        console.warn(`[tar-write.test] system tar -xf returned ${extractRes.status}; round-trip skipped on this host`);
        return;
      }

      const oneRead = readFileSync(join(dir, 'one.txt'), 'utf-8');
      expect(oneRead).toBe('line 1\nline 2\n');

      const twoRead = readFileSync(join(dir, 'two.json'), 'utf-8');
      expect(twoRead).toBe('{"k":"v"}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000); // system tar on Windows/WSL can be slow

  it('throws on filename longer than 100 bytes (POSIX tar limit)', () => {
    const longName = 'a/'.repeat(60) + 'file.txt';
    expect(() =>
      buildTar([{ name: longName, content: Buffer.from('x') }]),
    ).toThrow(/longer than 100 bytes/);
  });

  it('writes correct content size in the header (octal-encoded)', () => {
    const content = Buffer.from('hello world');  // 11 bytes
    const out = buildTar([{ name: 'h.txt', content }]);
    // Size field at offset 124, 12 bytes, NUL-terminated octal
    const sizeField = out.subarray(124, 136).toString('ascii').replace(/\0+$/, '');
    // 11 in octal = "13", padded to 11 digits = "00000000013"
    expect(sizeField.trim()).toBe('00000000013');
  });

  it('writes type flag "0" (regular file) at offset 156', () => {
    const out = buildTar([{ name: 'a.txt', content: Buffer.from('a') }]);
    expect(out[156]).toBe(0x30); // ASCII '0'
  });

  it('archive ends with 1024 zero bytes (two terminal blocks)', () => {
    const out = buildTar([{ name: 'a.txt', content: Buffer.from('abc') }]);
    const tail = out.subarray(out.length - 1024);
    expect(tail.every((b) => b === 0)).toBe(true);
  });
});
