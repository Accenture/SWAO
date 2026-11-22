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

// #4453: the challenge of a leg and the synthesis report their progress:
// status lines while a challenge runs (with the elapsed time), one
// "challenges finished" progress line per leg, and one status line per
// synthesis step.

import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orchestrateLegs, statusElapsed, CHALLENGES_FINISHED, type ResolvedLeg } from './orchestrator.js';
import { LEG_ENV } from './leg-recorder.js';
import { sizeBucket } from './call-record.js';

function record(legId: string, passId: string): string {
  return JSON.stringify({
    leg: { id: legId, connector: 'c', model: 'm' },
    pass_id: passId, call_site: 'site', call_index: 0,
    prompt: { sha256: 'p', chars: 400, tokens_est: 100, size_bucket: sizeBucket(100) },
    timing: { started: '2026-11-10T12:00:00Z', total_ms: 100 },
    tokens: { prompt: 100, completion: 30 },
    cost_usd: { computed: 0.01, source: 'billed' },
    quality: { parse_valid: true, schema_conform: true, truncated: false, refusal_detected: false },
    reliability: { retries: 0, rate_limited: false, dnf: false },
    security: { redaction_marker_altered: false, foreign_path_count: 0, pii_reproduction_detected: false, prompt_injection_detected: false },
    response_sha256: 'r',
  }) + '\n';
}

const legs: ResolvedLeg[] = [
  { id: 'anthropic--model-a', connector: 'anthropic', model: 'model-a', primary: true, costSource: 'billed' },
  { id: 'openrouter--model-b', connector: 'openrouter', model: 'model-b', primary: false, costSource: 'billed' },
];

describe('statusElapsed (#4453)', () => {
  it('seconds below a minute, minutes and seconds above', () => {
    expect(statusElapsed(34_200)).toBe('34s');
    expect(statusElapsed(115_000)).toBe('1m 55s');
    expect(statusElapsed(-5)).toBe('0s');
  });
});

describe('leg challenge and synthesis progress (#4453)', () => {
  let ws: string;
  const prevTick = process.env['SWAO_LLM_STATUS_TICK_MS'];
  beforeEach(() => {
    process.env['SWAO_LLM_STATUS_TICK_MS'] = '20';
    ws = mkdtempSync(join(tmpdir(), 'swao-4453-'));
    writeFileSync(join(ws, '.swao.yml'), 'workspace: {}\n', 'utf-8');
    const app = join(ws, 'apps', 'demo-app');
    mkdirSync(join(app, 'src'), { recursive: true });
    writeFileSync(join(app, 'src', 'main.ts'), 'export const x = 1;\n', 'utf-8');
    mkdirSync(join(app, 'wsp'), { recursive: true });
  });
  afterEach(() => {
    if (prevTick === undefined) delete process.env['SWAO_LLM_STATUS_TICK_MS'];
    else process.env['SWAO_LLM_STATUS_TICK_MS'] = prevTick;
    rmSync(ws, { recursive: true, force: true });
  });

  it('names the running challenge with its elapsed time, ends each leg with challenges finished, then the synthesis steps', async () => {
    const events: string[] = [];
    await orchestrateLegs({
      workspaceRoot: ws, appId: 'demo-app', legs, execution: 'serial', repeat: 1, weights: { quality: 1 },
      keepLegWsp: false, passSuiteVersion: 'v158', timestamp: () => '2026-11-10T12:00:00.000Z',
      onProgress: (m) => events.push(`progress ${m}`),
      onStatus: (s) => events.push(`status ${s ?? '(clear)'}`),
      spawnLeg: async (leg: ResolvedLeg, legWs: string, env: Record<string, string>) => {
        mkdirSync(join(legWs, 'apps', 'demo-app', 'wsp', 'runs', '2026-11-10T12-00-05'), { recursive: true });
        writeFileSync(join(legWs, 'apps', 'demo-app', 'wsp', 'runs', '2026-11-10T12-00-05', 'wsp.yaml'), 'overall: {}\n', 'utf-8');
        appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, '03-data'));
        return { exitCode: 0, durationMs: 5 };
      },
      spawnChallenge: async () => {
        await new Promise((r) => setTimeout(r, 1100));
        return { completed_at: '', agents: [{ agent_id: 'cto', calls: 1, dnf: false, duration_ms: 1 }], exit_code: 0 };
      },
    });
    for (const leg of legs) {
      const end = events.indexOf(`progress leg ${leg.id}: complete (1 calls)`);
      const start = events.indexOf(`progress leg ${leg.id}: running stakeholder challenge...`);
      const finished = events.findIndex((e) => e.startsWith(`progress leg ${leg.id}: ${CHALLENGES_FINISHED} (`));
      const tick = events.findIndex((e) => e.startsWith(`status leg ${leg.id}: challenge running, `));
      expect(end).toBeGreaterThanOrEqual(0);
      expect(start).toBeGreaterThan(end);
      expect(tick).toBeGreaterThan(start);
      expect(finished).toBeGreaterThan(tick);
      expect(events[tick]).toMatch(/challenge running, \d+s$/);
    }
    const lastFinished = events.findIndex((e) => e.startsWith(`progress leg ${legs[1]!.id}: ${CHALLENGES_FINISHED}`));
    const synth = events.map((e, i) => [e, i] as const).filter(([e]) => e.startsWith('status Synthesising: '));
    expect(synth.length).toBeGreaterThanOrEqual(2);
    expect(synth[0]![1]).toBeGreaterThan(lastFinished);
    expect(synth.map(([e]) => e.replace(/, \d+s$/, ''))).toContain('status Synthesising: comparing the results');
    expect(synth.map(([e]) => e.replace(/, \d+s$/, ''))).toContain('status Synthesising: writing the run folder');
    expect(events[events.length - 1]).toBe('status (clear)');
    for (const e of events) expect(e).not.toMatch(/ -- /);
  });
});
