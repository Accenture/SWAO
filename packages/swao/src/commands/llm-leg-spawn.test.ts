// #4470: the shared leg spawn of the CLI and the TUI reports the PID at once
// and stops the leg process TREE by PID when the leg signal is aborted (run
// cancel or a fired leg limit), also when the leg ignores SIGTERM and has a
// child of its own. The leg is a plain node script (no SWAO, no LLM).

import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedLeg } from '@swao/module-llm-assessment';
import { spawnLegProcess } from './llm-leg-spawn.js';

const leg: ResolvedLeg = { id: 'spawn-a', connector: 'openrouter', model: 'm', primary: true, costSource: 'billed' };
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('spawnLegProcess (#4470)', () => {
  it('an aborted leg that ignores SIGTERM is killed with its child; the result carries the PID', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-legspawn-'));
    try {
      const gcFile = join(dir, 'gc.pid');
      const code = [
        "process.on('SIGTERM', () => {});",
        "const gc = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
        'require(\'fs\').writeFileSync(process.env.GC_FILE, String(gc.pid));',
        "console.log('leg running');",
        'setInterval(() => {}, 1000);',
      ].join('\n');
      const ac = new AbortController();
      let reported: number | undefined;
      const done = spawnLegProcess({
        appId: 'app', leg, legWorkspaceRoot: dir, legEnv: {}, crawl: false, signal: ac.signal,
        hooks: { onPid: (p) => { reported = p; } },
        command: { command: process.execPath, args: ['-e', code], env: { ...process.env, GC_FILE: gcFile } },
      });
      expect(typeof reported).toBe('number');
      const end = Date.now() + 10_000;
      while (!existsSync(gcFile) && Date.now() < end) await sleep(25);
      const gc = parseInt(readFileSync(gcFile, 'utf-8'), 10);
      expect(alive(reported!)).toBe(true);
      expect(alive(gc)).toBe(true);
      ac.abort();
      const r = await done;
      expect(r.pid).toBe(reported);
      expect(r.outputTail).toContain('leg running');
      await sleep(300);
      expect(alive(reported!)).toBe(false);
      // The grandchild goes with the tree (taskkill /T on Windows; POSIX kills the leg only).
      if (process.platform === 'win32') expect(alive(gc)).toBe(false);
      else if (alive(gc)) process.kill(gc, 'SIGKILL');
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 30_000);

  it('a leg that exits on its own resolves with its exit code and no kill', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-legspawn-'));
    try {
      const r = await spawnLegProcess({
        appId: 'app', leg, legWorkspaceRoot: dir, legEnv: {}, crawl: false,
        command: { command: process.execPath, args: ['-e', 'process.exit(3)'], env: process.env },
      });
      expect(r.exitCode).toBe(3);
      expect(typeof r.pid).toBe('number');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
