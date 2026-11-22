// #4478: the shared challenge spawn of the CLI and the TUI (app and LZ
// challenge) reports the PID at once and stops the challenge process TREE by
// PID when the challenge signal is aborted (run cancel or a fired challenge
// limit), also when the challenge ignores SIGTERM and has a child of its own.
// The challenge is a plain node script (no SWAO, no LLM).

import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLegChallenge, spawnChallengeProcess } from './llm-challenge-spawn.js';

const leg = { connector: 'openrouter', model: 'm' };
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('spawnChallengeProcess (#4478)', () => {
  it('an aborted challenge that ignores SIGTERM is killed with its child; the result carries the PID', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-chspawn-'));
    try {
      const gcFile = join(dir, 'gc.pid');
      const code = [
        "process.on('SIGTERM', () => {});",
        "const gc = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
        'require(\'fs\').writeFileSync(process.env.GC_FILE, String(gc.pid));',
        "console.log('challenge running');",
        'setInterval(() => {}, 1000);',
      ].join('\n');
      const ac = new AbortController();
      let reported: number | undefined;
      const done = spawnChallengeProcess({
        args: [], cwd: dir, env: process.env, signal: ac.signal,
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
      expect(r.outputTail).toContain('challenge running');
      await sleep(300);
      expect(alive(reported!)).toBe(false);
      // The grandchild goes with the tree (taskkill /T on Windows; POSIX kills the challenge only).
      if (process.platform === 'win32') expect(alive(gc)).toBe(false);
      else if (alive(gc)) process.kill(gc, 'SIGKILL');
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 30_000);

  it('an already aborted signal kills the challenge at once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-chspawn-'));
    try {
      const ac = new AbortController();
      ac.abort();
      const started = Date.now();
      const r = await spawnChallengeProcess({
        args: [], cwd: dir, env: process.env, signal: ac.signal,
        command: { command: process.execPath, args: ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], env: process.env },
      });
      expect(r.exitCode).not.toBe(0);
      expect(Date.now() - started).toBeLessThan(15_000);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 30_000);
});

describe('runLegChallenge (#4478)', () => {
  it('reads the agents the challenge wrote in the leg workspace and keeps the exit code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-chrun-'));
    try {
      const out = join(dir, 'apps', 'demo-app', 'wsp', 'challenge-app');
      mkdirSync(out, { recursive: true });
      const target = join(out, 'combined.yaml');
      const script = join(dir, 'fake-challenge.js');
      writeFileSync(script, [
        "const fs = require('fs');",
        'fs.writeFileSync(process.env.OUT_FILE, "reports:\\n  - agent_id: cto\\n");',
        "console.error('[error] one agent failed');",
        'process.exit(1);',
      ].join('\n'), 'utf-8');
      let reported: number | undefined;
      const run = await runLegChallenge({
        kind: 'app', appId: 'demo-app', leg, legWorkspaceRoot: dir, legEnv: {},
        hooks: { onPid: (p) => { reported = p; } },
        command: { command: process.execPath, args: [script], env: { ...process.env, OUT_FILE: target } },
      });
      expect(typeof reported).toBe('number');
      expect(run.result.exit_code).toBe(1);
      expect(run.result.agents.map((a) => [a.agent_id, a.dnf])).toEqual([['cto', true]]);
      expect(run.result.output_tail).toContain('one agent failed');
      expect(run.noAgentsConfigured).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 30_000);
});
