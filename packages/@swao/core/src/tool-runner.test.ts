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
import { spawn } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { fileBackedToolRunner, posixDescendants, spawnErrorIsNotFound, treeKillPid } from './tool-runner.js';

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
    // #4488: the code says "not found"; only ENOENT reads as not found.
    expect(r.spawnErrorCode).toBe('ENOENT');
    expect(spawnErrorIsNotFound(r)).toBe(true);
  });

  it('#4488: a child that exited while the event loop was blocked past the timeout is not a timeout', async () => {
    const p = fileBackedToolRunner({ command: node, args: ['-e', 'process.stdout.write("v1")'], cwd: tmpdir(), timeoutMs: 1_500 });
    // Synchronous work longer than the timeout (the health check runs synchronous probes meanwhile).
    const until = Date.now() + 8_000;
    while (Date.now() < until) { /* block the event loop */ }
    const r = await p;
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('v1');
  }, 30_000);

  it('#4488: spawnErrorIsNotFound is true only for ENOENT', () => {
    expect(spawnErrorIsNotFound({ spawnError: null })).toBe(false);
    expect(spawnErrorIsNotFound({ spawnError: 'spawn git EACCES', spawnErrorCode: 'EACCES' })).toBe(false);
    expect(spawnErrorIsNotFound({ spawnError: 'spawn git ENOENT', spawnErrorCode: 'ENOENT' })).toBe(true);
    expect(spawnErrorIsNotFound({ spawnError: 'spawn git ENOENT' })).toBe(true);
    expect(spawnErrorIsNotFound({ spawnError: 'mkdtemp failed', spawnErrorCode: 'TEMPDIR' })).toBe(false);
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

// #4470: a child spawned without `detached` (the LLM leg and challenge
// processes) is not a process group leader; treeKillPid must still end its
// whole tree on Linux and macOS (Windows uses taskkill /T).
describe.skipIf(process.platform === 'win32')('treeKillPid without a process group (#4470)', () => {
  const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  it('kills the child and its grandchild, and finds the grandchild as a descendant', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-tk-'));
    const gcFile = join(dir, 'gc.pid');
    const code = [
      "process.on('SIGTERM', () => {})",
      "const gc = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
      "require('fs').writeFileSync(process.env.GC_FILE, String(gc.pid))",
      'setInterval(() => {}, 1000)',
    ].join(';');
    const child = spawn(process.execPath, ['-e', code], { stdio: 'ignore', env: { ...process.env, GC_FILE: gcFile } });
    const exited = new Promise<void>((r) => child.once('exit', () => r()));
    try {
      for (let i = 0; i < 100 && !existsSync(gcFile); i++) await sleep(50);
      const gc = parseInt(readFileSync(gcFile, 'utf-8'), 10);
      expect(posixDescendants(child.pid!)).toContain(gc);
      await treeKillPid(child.pid!);
      await exited;
      for (let i = 0; i < 40 && alive(gc); i++) await sleep(50);
      expect(alive(gc)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
