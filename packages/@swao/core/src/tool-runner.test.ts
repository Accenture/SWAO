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

// #3487: the Windows-safe tool runner, exercised with the Node runtime itself
// (always present) as the child. The timeout case starts a grandchild that
// holds the inherited stdio, which hangs spawnSync with pipes on win32.

import { describe, it, expect } from 'vitest';
import { tmpdir } from 'os';
import { fileBackedToolRunner } from './tool-runner.js';

const node = process.execPath;

describe('fileBackedToolRunner (#3487)', () => {
  it('captures stdout, stderr and the exit code', async () => {
    const r = await fileBackedToolRunner({
      command: node,
      args: ['-e', 'process.stdout.write("out-1"); process.stderr.write("err-1"); process.exit(0)'],
      cwd: tmpdir(),
      timeoutMs: 20_000,
    });
    expect(r).toEqual({ exitCode: 0, stdout: 'out-1', stderr: 'err-1', timedOut: false, spawnError: null });
  });

  it('reports a non-zero exit', async () => {
    const r = await fileBackedToolRunner({ command: node, args: ['-e', 'process.exit(3)'], cwd: tmpdir(), timeoutMs: 20_000 });
    expect(r.exitCode).toBe(3);
    expect(r.timedOut).toBe(false);
  });

  it('passes arguments verbatim (no shell interpretation)', async () => {
    const tricky = '"; echo injected & rem $(whoami) `id` | more';
    const r = await fileBackedToolRunner({
      command: node,
      args: ['-e', 'process.stdout.write(process.argv[1])', tricky],
      cwd: tmpdir(),
      timeoutMs: 20_000,
    });
    expect(r.stdout).toBe(tricky);
  });

  it('reports a missing command as spawnError, never throws', async () => {
    const r = await fileBackedToolRunner({ command: 'swao-no-such-tool-3487', args: ['--version'], cwd: tmpdir(), timeoutMs: 5_000 });
    expect(r.spawnError).toBeTruthy();
    expect(r.exitCode).toBeNull();
  });

  it('kills the process tree on timeout, including a grandchild holding stdio', async () => {
    const script = [
      'const { spawn } = require("child_process");',
      'spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "inherit" });',
      'setTimeout(() => {}, 60000);',
    ].join(' ');
    const started = Date.now();
    const r = await fileBackedToolRunner({ command: node, args: ['-e', script], cwd: tmpdir(), timeoutMs: 1_500 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBeNull();
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 30_000);
});
