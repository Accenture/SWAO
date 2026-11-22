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

// #4470: the stall watchdog is a real stall detector (reset by leg activity),
// the total cap is separate, and a leg ended by either has no live process
// afterwards (tree-kill by PID, also when the leg ignores its parent).
// #4469: the leg's pass and retry events reach the run log while it runs, and
// the heartbeat names the current pass and attempt.
// #4474: a failed leg gets no score and no rank.
// Times are scaled down (a 30 min window becomes a few hundred ms).

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orchestrateLegs, type ResolvedLeg, type LegSpawnResult } from './orchestrator.js';
import { LEG_ENV } from './leg-recorder.js';
import { sizeBucket } from './call-record.js';

const APP = 'wd-app';
const LEGS: ResolvedLeg[] = [
  { id: 'wd-a', connector: 'openrouter', model: 'model-a', primary: true, costSource: 'billed' },
  { id: 'wd-b', connector: 'openrouter', model: 'model-b', primary: false, costSource: 'billed' },
];
const ENV_KEYS = ['SWAO_LEG_STALL_TIMEOUT_MS', 'SWAO_LEG_MAX_MS', 'SWAO_LEG_POLL_MS', 'SWAO_LEG_HEARTBEAT_MS', 'SWAO_LEG_KILL_GRACE_MS'] as const;
const savedEnv: Record<string, string | undefined> = {};
let ws = '';

interface LogLine { ts: string; level: string; code: string; message: string; context?: Record<string, unknown> }
const readRunLog = (runDir: string): LogLine[] =>
  readFileSync(join(runDir, 'log.ndjson'), 'utf-8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as LogLine);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

/** Append one event to the leg's own app event log (what the leg process writes). */
function legEvent(legWs: string, code: string, context: Record<string, unknown>, level = 'info'): void {
  const now = new Date();
  const dir = join(legWs, 'apps', APP, 'wsp', 'logs');
  mkdirSync(dir, { recursive: true });
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  appendFileSync(join(dir, `app-events-${month}.ndjson`), JSON.stringify({ ts: now.toISOString(), level, scope: 'app', app_id: APP, code, message: code, context }) + '\n');
}

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

beforeAll(() => {
  ws = mkdtempSync(join(tmpdir(), 'swao-wd-ws-'));
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
afterAll(() => { rmSync(ws, { recursive: true, force: true }); });

let tsCounter = 0;
const base = () => ({
  workspaceRoot: ws, appId: APP, legs: LEGS, execution: 'serial' as const, repeat: 1,
  weights: { quality: 1, reliability: 1 }, keepLegWsp: false, passSuiteVersion: 'v158',
  // A distinct run folder per test (one second apart).
  timestamp: () => new Date(Date.UTC(2026, 10, 16, 1, 0, tsCounter++)).toISOString(),
});

describe('leg stall watchdog and total cap (#4470)', () => {
  it('a leg with activity inside every window is not ended by the stall watchdog', async () => {
    // Scaled: a call record every 10 "min" (500 ms) for 60 "min" (3 s), window 30 "min" (1.5 s). The slack of
    // 1 s per window keeps the test stable on a loaded runner; the leg still runs twice the window.
    process.env['SWAO_LEG_STALL_TIMEOUT_MS'] = '1500';
    process.env['SWAO_LEG_POLL_MS'] = '50';
    const result = await orchestrateLegs({
      ...base(),
      spawnLeg: async (leg, _legWs, env) => {
        for (let i = 0; i < 6; i++) {
          await sleep(500);
          appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, `0${i + 1}-p`));
        }
        return { exitCode: 0, durationMs: 3000 };
      },
    });
    expect(result.legs.map((l) => l.status)).toEqual(['complete', 'complete']);
    expect(readRunLog(result.runDir).some((l) => l.code === 'leg.stall')).toBe(false);
  }, 40_000);

  it('a leg that ignores its parent is killed by PID with its child; leg.failed names limit, pid and last pass', async () => {
    process.env['SWAO_LEG_STALL_TIMEOUT_MS'] = '400';
    process.env['SWAO_LEG_POLL_MS'] = '20';
    const pids: Array<{ leg: number; grandchild: number }> = [];
    const result = await orchestrateLegs({
      ...base(),
      // The fake leg ignores the leg signal (it never kills its process).
      spawnLeg: (leg, legWs, _env, _signal, hooks) => new Promise<LegSpawnResult>((resolve) => {
        legEvent(legWs, 'assessment.pass.start', { num: '03', name: 'data_classification', pass: 'data', pass_id: 'x-p03-data' });
        const gcFile = join(legWs, `grandchild-${leg.id}.pid`);
        const code = [
          "process.on('SIGTERM', () => {});",
          "const cp = require('child_process');",
          "const gc = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
          `require('fs').writeFileSync(process.env.GC_FILE, String(gc.pid));`,
          'setInterval(() => {}, 1000);',
        ].join('\n');
        const child = spawn(process.execPath, ['-e', code], { stdio: 'ignore', env: { ...process.env, GC_FILE: gcFile } });
        if (child.pid !== undefined) hooks?.onPid?.(child.pid);
        const started = Date.now();
        child.on('exit', (exitCode) => {
          const gc = existsSync(gcFile) ? parseInt(readFileSync(gcFile, 'utf-8'), 10) : NaN;
          pids.push({ leg: child.pid!, grandchild: gc });
          resolve({ exitCode, durationMs: Date.now() - started });
        });
      }),
    });
    expect(result.legs.map((l) => l.status)).toEqual(['failed', 'failed']);
    for (const o of result.legs) {
      expect(o.limit).toBe('stall');
      expect(o.killed).toBe(true);
      expect(typeof o.pid).toBe('number');
      expect(o.reason).toContain('stall watchdog: no leg activity for 400 ms');
      expect(o.reason).toContain('last pass 03 data_classification');
    }
    // No process of either leg is left (leg and grandchild).
    await sleep(300);
    expect(pids).toHaveLength(2);
    for (const p of pids) {
      expect(alive(p.leg)).toBe(false);
      if (Number.isFinite(p.grandchild)) expect(alive(p.grandchild)).toBe(false);
    }
    const log = readRunLog(result.runDir);
    const failed = log.filter((l) => l.code === 'leg.failed');
    expect(failed).toHaveLength(2);
    expect(failed[0]!.context).toMatchObject({ limit: 'stall', killed: true, exited: true, last_pass: '03 data_classification' });
    expect(typeof failed[0]!.context?.['pid']).toBe('number');
    const stall = log.filter((l) => l.code === 'leg.stall');
    expect(stall[0]!.context).toMatchObject({ limit: 'stall', timeout_ms: 400, pass: '03 data_classification' });
    // #4474: failed legs are not scored or ranked.
    expect(result.final.score['wd-a']).toBeUndefined();
    expect(result.final.rank['wd-a']).toBeUndefined();
    expect(result.final.did_not_finish?.['wd-a']).toMatchObject({ status: 'failed', calls: 0 });
  }, 30_000);

  it('the total cap ends a leg that keeps being active, and names itself', async () => {
    process.env['SWAO_LEG_STALL_TIMEOUT_MS'] = '10000';
    process.env['SWAO_LEG_MAX_MS'] = '300';
    process.env['SWAO_LEG_POLL_MS'] = '20';
    const result = await orchestrateLegs({
      ...base(),
      spawnLeg: (leg, legWs, _env, signal) => new Promise<LegSpawnResult>((resolve) => {
        let n = 0;
        const t = setInterval(() => legEvent(legWs, 'assessment.pass.progress', { num: '01', n: n++ }), 30);
        // This fake honours the leg signal (as the hosts do).
        signal?.addEventListener('abort', () => { clearInterval(t); resolve({ exitCode: null, durationMs: 1 }); });
        void leg;
      }),
    });
    for (const o of result.legs) {
      expect(o.status).toBe('failed');
      expect(o.limit).toBe('total');
      expect(o.reason).toContain('leg time limit of 300 ms reached');
    }
  }, 20_000);
});

describe('leg events in the run log while the leg runs (#4469)', () => {
  it('pass, timeout and retry events are forwarded with the pass; the heartbeat names pass and attempt', async () => {
    process.env['SWAO_LEG_POLL_MS'] = '20';
    process.env['SWAO_LEG_HEARTBEAT_MS'] = '40';
    const result = await orchestrateLegs({
      ...base(),
      spawnLeg: async (leg, legWs, env) => {
        legEvent(legWs, 'assessment.pass.start', { num: '03', name: 'data_classification', pass_id: 'r-p03' });
        legEvent(legWs, 'provider.llm.open-llm-provider.attempt', { provider: 'open-llm-provider', model: 'm', attempt: 1, max_attempts: 6, idle_limit_ms: 120000 });
        legEvent(legWs, 'provider.llm.open-llm-provider.timeout', { provider: 'open-llm-provider', attempt: 1, max_attempts: 6, phase: 'body', limit: 'idle', limit_ms: 120000, elapsed_ms: 121000 }, 'warn');
        legEvent(legWs, 'provider.llm.open-llm-provider.retry', { provider: 'open-llm-provider', attempt: 1, next_attempt: 2, max_attempts: 6, reason: 'timeout_idle_body', delay_ms: 3000 }, 'warn');
        legEvent(legWs, 'provider.llm.open-llm-provider.attempt', { provider: 'open-llm-provider', model: 'm', attempt: 2, max_attempts: 6, idle_limit_ms: 240000 });
        // The leg is still running: the parent forwards before the leg ends.
        await sleep(200);
        // A second timeout and retry, then the answer on attempt 3.
        legEvent(legWs, 'provider.llm.open-llm-provider.timeout', { provider: 'open-llm-provider', attempt: 2, max_attempts: 6, phase: 'body', limit: 'idle', limit_ms: 240000, elapsed_ms: 241000 }, 'warn');
        legEvent(legWs, 'provider.llm.open-llm-provider.retry', { provider: 'open-llm-provider', attempt: 2, next_attempt: 3, max_attempts: 6, reason: 'timeout_idle_body', delay_ms: 6000 }, 'warn');
        legEvent(legWs, 'provider.llm.open-llm-provider.attempt', { provider: 'open-llm-provider', model: 'm', attempt: 3, max_attempts: 6, idle_limit_ms: 360000 });
        await sleep(100);
        legEvent(legWs, 'provider.llm.open-llm-provider.ok', { provider: 'open-llm-provider', attempt: 3, max_attempts: 6 });
        legEvent(legWs, 'assessment.pass.complete', { num: '03', name: 'data_classification', wall_clock_ms: 4000 });
        appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, '03-data'));
        return { exitCode: 0, durationMs: 300 };
      },
    });
    const log = readRunLog(result.runDir);
    const a = (code: string) => log.filter((l) => l.code === code && l.context?.['leg_id'] === 'wd-a');
    const retry = a('leg.llm.retry');
    // Two timeouts, then the answer: two retry lines.
    expect(retry).toHaveLength(2);
    expect(retry[0]!.level).toBe('warn');
    expect(retry[0]!.message).toContain('pass 03 data_classification: retry 1 of 5 after a body timeout');
    expect(retry[1]!.message).toContain('pass 03 data_classification: retry 2 of 5 after a body timeout, attempt 3 of 6 in 6 s');
    expect(retry[0]!.context).toMatchObject({ pass: '03 data_classification', reason: 'timeout_idle_body', next_attempt: 2 });
    expect(a('leg.llm.timeout')).toHaveLength(2);
    expect(a('leg.llm.timeout')[0]!.message).toContain('timed out after 121 s (idle limit 120 s, awaiting body)');
    expect(a('leg.pass.start')).toHaveLength(1);
    expect(a('leg.pass.complete')).toHaveLength(1);
    // Forwarded while running: before the leg's leg.complete.
    const completeIdx = log.findIndex((l) => l.code === 'leg.complete' && l.context?.['leg_id'] === 'wd-a');
    expect(log.indexOf(retry[0]!)).toBeLessThan(completeIdx);
    // A heartbeat during the retry names the pass and the attempt.
    const hb = a('leg.heartbeat').find((l) => l.context?.['attempt'] === 2);
    expect(hb?.context).toMatchObject({ pass: '03 data_classification', attempt: 2, max_attempts: 6, last_error: 'timeout_idle_body' });
  }, 20_000);
});

describe('a failed leg is not ranked (#4474)', () => {
  it('one complete and one failed leg: only the complete leg has a score and rank 1', async () => {
    const result = await orchestrateLegs({
      ...base(),
      spawnLeg: async (leg, _legWs, env) => {
        appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, '03-data'));
        return { exitCode: leg.id === 'wd-b' ? 1 : 0, durationMs: 10, outputTail: leg.id === 'wd-b' ? '[error] boom' : '' };
      },
    });
    expect(result.status).toBe('partial');
    expect(result.final.rank['wd-a']).toBe(1);
    expect(typeof result.final.score['wd-a']).toBe('number');
    expect(result.final.score['wd-b']).toBeUndefined();
    expect(result.final.rank['wd-b']).toBeUndefined();
    expect(result.final.did_not_finish).toEqual({ 'wd-b': { status: 'failed', reason: 'exit 1: [error] boom', calls: 1 } });
    for (const g of result.groups) expect(Object.keys(g.score)).not.toContain('wd-b');
    const pub = JSON.parse(readFileSync(join(result.runDir, 'comparison', 'publication-model.json'), 'utf-8')) as { final: { did_not_finish?: Record<string, unknown> } };
    expect(pub.final.did_not_finish?.['wd-b']).toMatchObject({ status: 'failed', calls: 1 });
  }, 20_000);
});

describe('synthesis progress in the run log (#4472)', () => {
  it('each synthesis step writes run.synthesis.progress', async () => {
    const result = await orchestrateLegs({
      ...base(),
      spawnLeg: async (leg, _legWs, env) => {
        appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, '03-data'));
        return { exitCode: 0, durationMs: 10 };
      },
    });
    const steps = readRunLog(result.runDir).filter((l) => l.code === 'run.synthesis.progress').map((l) => l.context?.['step']);
    expect(steps).toContain('comparing the results');
    expect(steps).toContain('writing the run folder');
  }, 20_000);
});
