// #4021: an unhandled rejection ends the CLI with exit 1 after the crash line
// is written (before the fix it was logged and the process ended with 0).
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { onUncaughtException, onUnhandledRejection, type CrashHandlerDeps } from './crash-handlers.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', '..', 'dist', 'index.js');
const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

function recorder(listeners = 1): { deps: CrashHandlerDeps; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      write: (label, detail) => { calls.push(`write:${label}:${detail.split('\n')[0]}`); },
      exit: (code) => { calls.push(`exit:${code}`); },
      setExitCode: (code) => { calls.push(`exitCode:${code}`); },
      rejectionListeners: () => listeners,
    },
  };
}

describe('crash handlers (#4021)', () => {
  it('an unhandled rejection writes the crash line, then exits 1', () => {
    const r = recorder();
    onUnhandledRejection(new Error('boom'), r.deps);
    expect(r.calls).toEqual(['write:unhandledRejection:Error: boom', 'exitCode:1', 'exit:1']);
  });

  it('a non-Error reason is logged as text and still exits 1', () => {
    const r = recorder();
    onUnhandledRejection('plain reason', r.deps);
    expect(r.calls).toEqual(['write:unhandledRejection:plain reason', 'exitCode:1', 'exit:1']);
  });

  it('with a later handler registered (the TUI crash handler) it sets exit code 1 and leaves the exit to that handler', () => {
    const r = recorder(2);
    onUnhandledRejection(new Error('boom'), r.deps);
    expect(r.calls).toEqual(['write:unhandledRejection:Error: boom', 'exitCode:1']);
  });

  it('an uncaught exception still writes the crash line and exits 1', () => {
    const r = recorder();
    onUncaughtException(new Error('bang'), r.deps);
    expect(r.calls).toEqual(['write:uncaughtException:Error: bang', 'exit:1']);
  });

  it('#4345: with the TUI handler registered after it, an uncaught exception sets exit code 1 and leaves the rest to the TUI handler', () => {
    const r = recorder();
    r.deps.exceptionListeners = () => 2;
    onUncaughtException(new Error('bang'), r.deps);
    expect(r.calls).toEqual(['write:uncaughtException:Error: bang', 'exitCode:1']);
  });

  // The compiled CLI: a preload rejects a promise once the entry has installed
  // its handlers; the command (a local catalogue read, async) ends with 0
  // without the trigger. `license status` is no use here: it exits
  // synchronously before any queued callback runs. The crash log in the
  // (temporary) cwd proves the SWAO handler, not the Node default, answered.
  it.skipIf(!existsSync(cli))('the compiled CLI ends with exit 1 and writes swao-crash.log', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'swao-4021-'));
    tmp.push(cwd);
    const preload = join(cwd, 'reject.mjs');
    writeFileSync(preload, [
      'let armed = false;',
      "process.on('newListener', (ev) => {",
      "  if (ev !== 'uncaughtException' || armed) return;",
      '  armed = true;',
      "  setImmediate(() => { Promise.reject(new Error('swao-4021-trigger')); });",
      '});',
      '',
    ].join('\n'));
    const env = { ...process.env, HOME: cwd, USERPROFILE: cwd, APPDATA: cwd, LOCALAPPDATA: cwd, XDG_CONFIG_HOME: cwd };
    const baseline = spawnSync(process.execPath, [cli, 'lz', 'catalogue', 'list'], { cwd, env, encoding: 'utf-8', timeout: 60_000 });
    expect(baseline.status, baseline.stderr).toBe(0);
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, cli, 'lz', 'catalogue', 'list'], { cwd, env, encoding: 'utf-8', timeout: 60_000 });
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('unhandledRejection');
    expect(r.stderr).toContain('swao-4021-trigger');
    const log = readFileSync(join(cwd, 'swao-crash.log'), 'utf-8');
    expect(log).toContain('unhandledRejection');
    expect(log).toContain('swao-4021-trigger');
  }, 120_000);
});
