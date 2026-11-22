// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4478: the leg challenges (app and LZ) run under a stall watchdog on
// challenge activity (new events in the leg's app event log, new call records
// in the sink) and a total cap. A fired limit kills the challenge process tree
// by PID, records the challenge as failed with the reason, and the run goes on
// (the leg stays complete, the LZ challenge and the next leg still run). A run
// cancel ends a running challenge too. Windows of at least 1.5 s with generous
// slack (the leg-watchdog test was flaky at 300 ms on a loaded machine).

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orchestrateLegs, type ChallengePassResult, type ResolvedLeg, type LegSpawnHooks } from './orchestrator.js';
import { LEG_ENV } from './leg-recorder.js';
import { sizeBucket } from './call-record.js';

const APP = 'cw-app';
const LEGS: ResolvedLeg[] = [
  { id: 'cw-a', connector: 'openrouter', model: 'model-a', primary: true, costSource: 'billed' },
  { id: 'cw-b', connector: 'openrouter', model: 'model-b', primary: false, costSource: 'billed' },
];
const ENV_KEYS = ['SWAO_CHALLENGE_STALL_TIMEOUT_MS', 'SWAO_CHALLENGE_MAX_MS', 'SWAO_LEG_POLL_MS', 'SWAO_LEG_KILL_GRACE_MS'] as const;
const savedEnv: Record<string, string | undefined> = {};
let ws = '';

interface LogLine { ts: string; level: string; code: string; message: string; context?: Record<string, unknown> }
const readRunLog = (runDir: string): LogLine[] =>
  readFileSync(join(runDir, 'log.ndjson'), 'utf-8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as LogLine);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

function record(legId: string, passId: string): string {
  return JSON.stringify({
    leg: { id: legId, connector: 'openrouter', model: 'm' },
    pass_id: passId, call_site: 'site', call_index: 0,
    prompt: { sha256: 'p', chars: 4000, tokens_est: 1000, size_bucket: sizeBucket(1000) },
    timing: { started: '2026-11-16T00:00:00Z', total_ms: 100 },
    tokens: { prompt: 1000, completion: 300 },
    cost_usd: { computed: 0.001, source: 'billed' },
    quality: { parse_valid: true, schema_conform: true, truncated: false, refusal_detected: false },
    reliability: { retries: 0, rate_limited: false, dnf: false },
    security: { redaction_marker_altered: false, foreign_path_count: 0, pii_reproduction_detected: false, prompt_injection_detected: false },
    response_sha256: 'r',
  }) + '\n';
}

/** Append one event to the leg's own app event log (what a challenge process writes). */
function legEvent(legWs: string, code: string, context: Record<string, unknown>): void {
  const now = new Date();
  const dir = join(legWs, 'apps', APP, 'wsp', 'logs');
  mkdirSync(dir, { recursive: true });
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  appendFileSync(join(dir, `app-events-${month}.ndjson`), JSON.stringify({ ts: now.toISOString(), level: 'info', scope: 'app', app_id: APP, code, message: code, context }) + '\n');
}

/** A complete leg with its own application run and an inline LZ fit (so both challenges run). */
const completeLeg = async (leg: ResolvedLeg, legWs: string, env: Record<string, string>): Promise<{ exitCode: number; durationMs: number }> => {
  const run = join(legWs, 'apps', APP, 'wsp', 'runs', '2026-11-16T12-00-05');
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'wsp.yaml'), 'overall: {}\n', 'utf-8');
  writeFileSync(join(run, 'lz-catalogue-fit.yaml'), 'provider: otc\nregion: eu-de\noverall: NEEDS_VERIFICATION\n', 'utf-8');
  appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, '03-data'));
  return { exitCode: 0, durationMs: 5 };
};

const okChallenge = async (): Promise<ChallengePassResult> => ({ completed_at: '', agents: [{ agent_id: 'lz-auditor', calls: 1, dnf: false, duration_ms: 1 }], exit_code: 0 });

/**
 * A fake challenge host that IGNORES its signal: a real node process that
 * ignores SIGTERM and starts a grandchild; only the kill by PID ends it.
 */
function stubbornChallenge(pids: Array<{ child: number; grandchild: number }>) {
  return (leg: ResolvedLeg, legWs: string, _env: Record<string, string>, _ctx: unknown, _signal?: AbortSignal, hooks?: LegSpawnHooks): Promise<ChallengePassResult> =>
    new Promise((resolve) => {
      const gcFile = join(legWs, `gc-${leg.id}.pid`);
      const code = [
        "process.on('SIGTERM', () => {});",
        "const gc = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
        'require(\'fs\').writeFileSync(process.env.GC_FILE, String(gc.pid));',
        'setInterval(() => {}, 1000);',
      ].join('\n');
      const child = spawn(process.execPath, ['-e', code], { stdio: 'ignore', env: { ...process.env, GC_FILE: gcFile } });
      if (child.pid !== undefined) hooks?.onPid?.(child.pid);
      child.on('exit', (exitCode) => {
        const gc = existsSync(gcFile) ? parseInt(readFileSync(gcFile, 'utf-8'), 10) : NaN;
        pids.push({ child: child.pid!, grandchild: gc });
        resolve({ completed_at: '', agents: [{ agent_id: 'cto', calls: 1, dnf: false, duration_ms: 1 }], exit_code: exitCode });
      });
    });
}

beforeAll(() => {
  ws = mkdtempSync(join(tmpdir(), 'swao-cw-ws-'));
  writeFileSync(join(ws, '.swao.yml'), 'workspace: {}\n', 'utf-8');
  mkdirSync(join(ws, 'apps', APP, 'src'), { recursive: true });
  mkdirSync(join(ws, 'apps', APP, 'wsp', 'inputs'), { recursive: true });
  writeFileSync(join(ws, 'apps', APP, 'src', 'main.ts'), 'export const x = 1;\n', 'utf-8');
  writeFileSync(join(ws, 'apps', APP, '.swao.yml'), `app:\n  id: ${APP}\n`, 'utf-8');
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});
afterAll(() => { rmSync(ws, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

let tsCounter = 0;
const base = () => ({
  workspaceRoot: ws, appId: APP, legs: LEGS, execution: 'serial' as const, repeat: 1,
  weights: { quality: 1, reliability: 1 }, keepLegWsp: false, passSuiteVersion: 'v158',
  timestamp: () => new Date(Date.UTC(2026, 10, 16, 2, 0, tsCounter++)).toISOString(),
  spawnLeg: completeLeg,
});

describe('challenge stall watchdog and total cap (#4478)', () => {
  it('a stalled app challenge that ignores its signal is killed by PID with its child; the leg stays complete and the run goes on', async () => {
    process.env['SWAO_CHALLENGE_STALL_TIMEOUT_MS'] = '1500';
    process.env['SWAO_LEG_POLL_MS'] = '50';
    process.env['SWAO_LEG_KILL_GRACE_MS'] = '10000';
    const pids: Array<{ child: number; grandchild: number }> = [];
    const lzRan: string[] = [];
    const result = await orchestrateLegs({
      ...base(),
      spawnChallenge: stubbornChallenge(pids),
      spawnLzChallenge: async (leg) => { lzRan.push(leg.id); return okChallenge(); },
    });
    // The legs keep their result; both LZ challenges still ran after the killed app challenge.
    expect(result.legs.map((l) => l.status)).toEqual(['complete', 'complete']);
    expect(lzRan).toEqual(['cw-a', 'cw-b']);
    await sleep(300);
    expect(pids).toHaveLength(2);
    for (const p of pids) {
      expect(alive(p.child)).toBe(false);
      if (Number.isFinite(p.grandchild)) {
        // taskkill /T on Windows; on POSIX only the challenge process itself is killed (documented limit).
        if (process.platform === 'win32') expect(alive(p.grandchild)).toBe(false);
        else if (alive(p.grandchild)) process.kill(p.grandchild, 'SIGKILL');
      }
    }
    for (const leg of LEGS) {
      const saved = JSON.parse(readFileSync(join(result.runDir, 'calls', leg.id, 'challenge-results.json'), 'utf-8')) as ChallengePassResult;
      expect(saved.limit).toBe('stall');
      expect(saved.failure_reason).toContain('challenge stall watchdog: no challenge activity for 2 s');
      expect(saved.exit_code).not.toBe(0);
      expect(saved.agents.every((a) => a.dnf)).toBe(true);
    }
    const log = readRunLog(result.runDir);
    const stall = log.filter((l) => l.code === 'leg.challenge.stall');
    expect(stall).toHaveLength(2);
    expect(stall[0]!.level).toBe('warn');
    expect(stall[0]!.context).toMatchObject({ leg_id: 'cw-a', limit: 'stall', timeout_ms: 1500 });
    expect(typeof stall[0]!.context?.['pid']).toBe('number');
    const complete = log.filter((l) => l.code === 'leg.challenge.complete');
    expect(complete).toHaveLength(2);
    expect(complete[0]!.level).toBe('warn');
    expect(complete[0]!.message).toContain('challenge failed: challenge stall watchdog');
    expect(complete[0]!.context).toMatchObject({ limit: 'stall', killed: true, exited: true });
    expect(log.filter((l) => l.code === 'leg.challenge-lz.complete' && l.level === 'info')).toHaveLength(2);
  }, 90_000);

  it('a challenge with activity inside every window is not ended by the stall watchdog', async () => {
    // A call record every 500 ms for 3.5 s, window 1.5 s: each challenge runs over twice the window.
    process.env['SWAO_CHALLENGE_STALL_TIMEOUT_MS'] = '1500';
    process.env['SWAO_LEG_POLL_MS'] = '50';
    const result = await orchestrateLegs({
      ...base(),
      spawnChallenge: async (leg, _legWs, env) => {
        for (let i = 0; i < 7; i++) {
          await sleep(500);
          appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, 'challenge-cto'));
        }
        return { completed_at: '', agents: [{ agent_id: 'cto', calls: 7, dnf: false, duration_ms: 3500 }], exit_code: 0 };
      },
    });
    const log = readRunLog(result.runDir);
    expect(log.some((l) => l.code === 'leg.challenge.stall')).toBe(false);
    const saved = JSON.parse(readFileSync(join(result.runDir, 'calls', 'cw-a', 'challenge-results.json'), 'utf-8')) as ChallengePassResult;
    expect(saved.failure_reason).toBeUndefined();
    expect(saved.exit_code).toBe(0);
  }, 60_000);

  it('the total cap ends an LZ challenge that keeps being active, and names itself', async () => {
    process.env['SWAO_CHALLENGE_STALL_TIMEOUT_MS'] = '60000';
    process.env['SWAO_CHALLENGE_MAX_MS'] = '1500';
    process.env['SWAO_LEG_POLL_MS'] = '50';
    const result = await orchestrateLegs({
      ...base(),
      spawnChallenge: okChallenge,
      // This fake keeps writing events and honours the challenge signal (as the hosts do).
      spawnLzChallenge: (_leg, legWs, _env, _ctx, signal) => new Promise<ChallengePassResult>((resolve) => {
        let n = 0;
        const t = setInterval(() => legEvent(legWs, 'provider.llm.openrouter.attempt', { attempt: 1, max_attempts: 6, n: n++ }), 100);
        signal?.addEventListener('abort', () => { clearInterval(t); resolve({ completed_at: '', agents: [{ agent_id: 'lz-auditor', calls: 1, dnf: false, duration_ms: 1 }], exit_code: null }); });
      }),
    });
    expect(result.legs[0]!.status).toBe('complete');
    const saved = JSON.parse(readFileSync(join(result.runDir, 'calls', 'cw-a', 'lz-challenge-results.json'), 'utf-8')) as ChallengePassResult;
    expect(saved.limit).toBe('total');
    expect(saved.failure_reason).toContain('LZ challenge time limit of 2 s reached');
    expect(saved.agents[0]!.dnf).toBe(true);
    const log = readRunLog(result.runDir);
    expect(log.find((l) => l.code === 'leg.challenge-lz.stall')?.context).toMatchObject({ limit: 'total', timeout_ms: 1500 });
    expect(log.find((l) => l.code === 'leg.challenge-lz.complete')?.context).toMatchObject({ limit: 'total', killed: true, exited: true });
  }, 60_000);

  it('a run cancel ends a running challenge that ignores its signal (kill by PID)', async () => {
    process.env['SWAO_LEG_POLL_MS'] = '50';
    process.env['SWAO_LEG_KILL_GRACE_MS'] = '10000';
    const ac = new AbortController();
    const pids: Array<{ child: number; grandchild: number }> = [];
    const stubborn = stubbornChallenge(pids);
    const started = Date.now();
    const result = await orchestrateLegs({
      ...base(),
      signal: ac.signal,
      spawnChallenge: (leg, legWs, env, ctx, signal, hooks) => {
        setTimeout(() => ac.abort(), 1500);
        return stubborn(leg, legWs, env, ctx, signal, hooks);
      },
    });
    expect(Date.now() - started).toBeLessThan(30_000);
    await sleep(300);
    expect(pids).toHaveLength(1);
    expect(alive(pids[0]!.child)).toBe(false);
    if (Number.isFinite(pids[0]!.grandchild) && alive(pids[0]!.grandchild)) {
      if (process.platform === 'win32') expect(alive(pids[0]!.grandchild)).toBe(false);
      else process.kill(pids[0]!.grandchild, 'SIGKILL');
    }
    const saved = JSON.parse(readFileSync(join(result.runDir, 'calls', 'cw-a', 'challenge-results.json'), 'utf-8')) as ChallengePassResult;
    expect(saved.failure_reason).toBe('run cancelled');
    expect(saved.exit_code).toBeNull();
    expect(readRunLog(result.runDir).find((l) => l.code === 'leg.challenge.complete')?.context).toMatchObject({ cancelled: true, exited: true });
  }, 60_000);
});
