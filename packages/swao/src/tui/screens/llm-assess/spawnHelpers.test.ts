// #4277: the TUI leg challenges run in the LEG workspace on the given run and
// never read or write the main app folder.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const calls: Array<{ args: string[]; cwd: string }> = [];

vi.mock('child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof import('child_process')>();
  return {
    ...orig,
    spawn: vi.fn((_cmd: string, args: string[], opts: { cwd: string }) => {
      calls.push({ args, cwd: opts.cwd });
      // Behave like `swao challenge` with cwd = the leg workspace.
      const wsp = join(opts.cwd, 'apps', 'demo-app', 'wsp');
      if (args.includes('lz')) {
        mkdirSync(join(wsp, 'challenge-lz', new Date().toISOString().slice(0, 19).replace(/:/g, '-')), { recursive: true });
      } else {
        mkdirSync(join(wsp, 'challenge-app'), { recursive: true });
        writeFileSync(join(wsp, 'challenge-app', 'combined.yaml'), 'reports:\n  - agent_id: cto\n', 'utf-8');
      }
      const child = new EventEmitter() as EventEmitter & { pid: number; stderr?: EventEmitter };
      child.pid = 4242;
      // #4323: a failing challenge writes an error line and exits 1.
      if (args.includes('fail-model')) {
        child.stderr = new EventEmitter();
        setImmediate(() => { child.stderr!.emit('data', Buffer.from('[error] no LZ Catalog run for demo-app\n')); child.emit('exit', 1); });
        return child;
      }
      setImmediate(() => child.emit('exit', 0));
      return child;
    }),
  };
});

import { spawnChallenge, spawnLzChallenge, cleanSkipExit } from './spawnHelpers.js';
import { legChallengeArgs } from '../../../commands/llm-leg-challenge.js';

let mainWs: string;
let legWs: string;

beforeEach(() => {
  calls.length = 0;
  mainWs = mkdtempSync(join(tmpdir(), 'swao-4277-main-'));
  legWs = mkdtempSync(join(tmpdir(), 'swao-4277-leg-'));
  mkdirSync(join(mainWs, 'apps', 'demo-app', 'wsp'), { recursive: true });
});
afterEach(() => {
  rmSync(mainWs, { recursive: true, force: true });
  rmSync(legWs, { recursive: true, force: true });
});

describe('TUI leg challenge spawn (#4277)', () => {
  const leg = { connector: 'anthropic', model: 'model-a' };

  it('legChallengeArgs carries --run for the staged run', () => {
    expect(legChallengeArgs('app', 'demo-app', leg, '2026-11-09T14-08-36')).toEqual([
      'challenge', '--app', 'demo-app', '--all-agents', '--report', '--connector', 'anthropic', '--model', 'model-a', '--run', '2026-11-09T14-08-36',
    ]);
    expect(legChallengeArgs('lz', 'demo-app', { connector: 'c', model: 'default' })).toEqual([
      'challenge', '--type', 'lz', '--app', 'demo-app', '--all-agents', '--connector', 'c',
    ]);
  });

  it('the app challenge runs with cwd = leg workspace and reads only the leg output', async () => {
    const r = await spawnChallenge('demo-app', mainWs, leg, legWs, {}, { runId: '2026-11-09T14-08-36', llmRunId: '2026-11-09T21-00-00' });
    expect(calls[0]!.cwd).toBe(legWs);
    expect(calls[0]!.args).toContain('--run');
    expect(r.agents.map((a) => a.agent_id)).toEqual(['cto']);
    expect(existsSync(join(mainWs, 'apps', 'demo-app', 'wsp', 'challenge-app'))).toBe(false);
  });

  it('#2283: exit 2 without agents is a clean skip (0), as in the CLI host', () => {
    expect(cleanSkipExit(2, 0)).toBe(0);
    expect(cleanSkipExit(2, 3)).toBe(2);
    expect(cleanSkipExit(1, 0)).toBe(1);
    expect(cleanSkipExit(null, 0)).toBeNull();
  });

  it('#4323: a failing challenge returns its exit code and output tail', async () => {
    const r = await spawnLzChallenge('demo-app', mainWs, { connector: 'c', model: 'fail-model' }, legWs, {}, { llmRunId: '2026-11-09T21-00-00' });
    expect(r.exit_code).toBe(1);
    expect(r.output_tail).toContain('no LZ Catalog run');
  });

  it('the LZ challenge runs with cwd = leg workspace; the main challenge-lz stays absent', async () => {
    await spawnLzChallenge('demo-app', mainWs, leg, legWs, {}, { runId: '2026-11-09T16-06-46', llmRunId: '2026-11-09T21-00-00' });
    expect(calls[0]!.cwd).toBe(legWs);
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['--type', 'lz', '--run', '2026-11-09T16-06-46']));
    expect(existsSync(join(mainWs, 'apps', 'demo-app', 'wsp', 'challenge-lz'))).toBe(false);
  });
});
