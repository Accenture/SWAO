// #4290: LLM run totals include the challenge and LZ challenge calls and
// equal the sums over calls/<leg>.ndjson.

import { describe, it, expect } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orchestrateLegs, callTotals, runCostText, type ResolvedLeg } from './orchestrator.js';
import { LEG_ENV } from './leg-recorder.js';
import { CallRecordSchema, sizeBucket } from './call-record.js';

function record(legId: string, passId: string, cost: number | null, source: 'billed' | 'unpriced' | 'local' = cost === null ? 'unpriced' : 'billed'): string {
  return JSON.stringify({
    leg: { id: legId, connector: 'c', model: 'm' },
    pass_id: passId, call_site: 'site', call_index: 0,
    prompt: { sha256: 'p', chars: 400, tokens_est: 100, size_bucket: sizeBucket(100) },
    timing: { started: '2026-11-09T12:00:00Z', total_ms: 100 },
    tokens: { prompt: 100, completion: 30 },
    cost_usd: { computed: cost, source },
    quality: { parse_valid: true, schema_conform: true, truncated: false, refusal_detected: false },
    reliability: { retries: 0, rate_limited: false, dnf: false },
    security: { redaction_marker_altered: false, foreign_path_count: 0, pii_reproduction_detected: false, prompt_injection_detected: false },
    response_sha256: 'r',
  }) + '\n';
}

function makeWs(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-4290-'));
  writeFileSync(join(ws, '.swao.yml'), 'workspace: {}\n', 'utf-8');
  mkdirSync(join(ws, 'apps', 'demo-app', 'src'), { recursive: true });
  writeFileSync(join(ws, 'apps', 'demo-app', 'src', 'main.ts'), 'export const x = 1;\n', 'utf-8');
  return ws;
}

const sinkSums = (path: string): { calls: number; cost: number } => {
  const recs = readFileSync(path, 'utf-8').split('\n').filter((l) => l.trim()).map((l) => CallRecordSchema.parse(JSON.parse(l)));
  return { calls: recs.length, cost: Math.round(recs.reduce((a, r) => a + (r.cost_usd.computed ?? 0), 0) * 1e6) / 1e6 };
};

interface Pub { run: Record<string, number> & { legs: Record<string, Record<string, number>> } }

describe('LLM run totals (#4290)', () => {
  const legs: ResolvedLeg[] = [
    { id: 'leg-a', connector: 'c', model: 'a', primary: true, costSource: 'billed' },
    { id: 'leg-b', connector: 'c', model: 'b', primary: false, costSource: 'billed' },
  ];

  it('a leg with 0 assessment calls and 9 challenge calls totals 9 calls and their cost', async () => {
    const ws = makeWs();
    const kept: string[] = [];
    try {
      const result = await orchestrateLegs({
        workspaceRoot: ws, appId: 'demo-app', legs, execution: 'serial', repeat: 1, weights: { quality: 1 },
        keepLegWsp: false, passSuiteVersion: 'v158', timestamp: () => '2026-11-09T22:00:00.000Z',
        spawnLeg: async (leg, _w, env) => {
          // The sink holds 5 app challenge and 4 LZ challenge calls (as in the owner run) and no assessment call.
          for (let i = 0; i < 5; i++) appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, `challenge-agent${i}`, 0.1));
          for (let i = 0; i < 4; i++) appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, `challenge-lz-lzca-${i}`, 0.11));
          return { exitCode: 0, durationMs: 5 };
        },
      });
      for (const l of result.legs) if (l.workspace) kept.push(l.workspace);
      const pub = JSON.parse(readFileSync(join(result.runDir, 'comparison', 'publication-model.json'), 'utf-8')) as Pub;
      for (const id of ['leg-a', 'leg-b']) {
        const t = pub.run.legs[id]!;
        const sums = sinkSums(join(result.runDir, 'calls', `${id}.ndjson`));
        expect(t['call_count']).toBe(9);
        expect(t['call_count']).toBe(sums.calls);
        expect(t['cost_usd']).toBe(sums.cost);
        expect(t['cost_usd']).toBeCloseTo(0.94, 6);
        expect(t['assessment_calls']).toBe(0);
        expect(t['challenge_calls']).toBe(5);
        expect(t['lz_challenge_calls']).toBe(4);
      }
      expect(pub.run['call_count']).toBe(18);
      expect(pub.run['cost_usd']).toBeCloseTo(1.88, 6);
      const done = readFileSync(join(result.runDir, 'log.ndjson'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l) as { code: string; message: string; context: Record<string, number> }).pop()!;
      expect(done.code).toBe('run.complete');
      expect(done.context['call_count']).toBe(18);
      expect(done.context['cost_usd']).toBeCloseTo(1.88, 6);
      expect(done.message).toContain('18 calls (0 assessment, 18 challenge)');
    } finally {
      for (const k of kept) rmSync(k, { recursive: true, force: true });
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('successful legs: assessment + challenge calls are both counted; scoring stays assessment-only', async () => {
    const ws = makeWs();
    try {
      const result = await orchestrateLegs({
        workspaceRoot: ws, appId: 'demo-app', legs, execution: 'serial', repeat: 1, weights: { quality: 1 },
        keepLegWsp: false, passSuiteVersion: 'v158', timestamp: () => '2026-11-09T22:05:00.000Z',
        spawnLeg: async (leg, legW, env) => {
          // #4291: the leg writes its own application run.
          mkdirSync(join(legW, 'apps', 'demo-app', 'wsp', 'runs', '2026-11-09T22-05-05'), { recursive: true });
          appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, '03-data', 0.01));
          appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, '09-synth', 0.02));
          return { exitCode: 0, durationMs: 5 };
        },
        spawnChallenge: async (leg, _w, env) => {
          appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, 'challenge-cto', 0.1));
          return { completed_at: '', agents: [{ agent_id: 'cto', calls: 1, dnf: false, duration_ms: 1 }], exit_code: 0 };
        },
      });
      expect(result.records).toHaveLength(4); // assessment records only
      const pub = JSON.parse(readFileSync(join(result.runDir, 'comparison', 'publication-model.json'), 'utf-8')) as Pub;
      expect(pub.run.legs['leg-a']!['call_count']).toBe(3);
      expect(pub.run.legs['leg-a']!['assessment_calls']).toBe(2);
      expect(pub.run.legs['leg-a']!['cost_usd']).toBeCloseTo(0.13, 6);
      expect(pub.run['call_count']).toBe(6);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('callTotals splits by pass_id prefix', () => {
    const recs = [record('x', '03-data', 1), record('x', 'challenge-a', 2), record('x', 'challenge-lz-b', 4)]
      .map((l) => CallRecordSchema.parse(JSON.parse(l)));
    expect(callTotals(recs)).toEqual({
      call_count: 3, cost_usd: 7, assessment_calls: 1, assessment_cost_usd: 1,
      challenge_calls: 1, challenge_cost_usd: 2, lz_challenge_calls: 1, lz_challenge_cost_usd: 4,
      unpriced_calls: 0, assessment_unpriced_calls: 0, challenge_unpriced_calls: 0, lz_challenge_unpriced_calls: 0,
    });
  });

  // #4372 follow-up: unpriced calls are counted, never silently 0 USD.
  it('callTotals counts unpriced calls per split; local calls are not unpriced', () => {
    const recs = [
      record('x', '03-data', 0.5), record('x', '04-sec', null), record('x', '05-ops', null, 'local'),
      record('x', 'challenge-a', null), record('x', 'challenge-lz-b', 0.25), record('x', 'challenge-lz-c', null),
    ].map((l) => CallRecordSchema.parse(JSON.parse(l)));
    const t = callTotals(recs);
    expect(t.call_count).toBe(6);
    expect(t.cost_usd).toBe(0.75);
    expect(t.unpriced_calls).toBe(3);
    expect(t.assessment_unpriced_calls).toBe(1);
    expect(t.challenge_unpriced_calls).toBe(1);
    expect(t.lz_challenge_unpriced_calls).toBe(1);
    expect(runCostText(t)).toBe('0.7500 USD plus 3 unpriced calls');
    expect(runCostText({ call_count: 2, cost_usd: 0, unpriced_calls: 2 })).toBe('not measured');
    expect(runCostText({ call_count: 2, cost_usd: 0.1, unpriced_calls: 0 })).toBe('0.1000 USD');
  });

  it('a run with an unpriced leg: run block, per-leg totals, comparison, result and log line carry the unpriced calls', async () => {
    const ws = makeWs();
    const kept: string[] = [];
    try {
      const result = await orchestrateLegs({
        workspaceRoot: ws, appId: 'demo-app', legs, execution: 'serial', repeat: 1, weights: { quality: 1 },
        keepLegWsp: false, passSuiteVersion: 'v158', timestamp: () => '2026-11-14T09:00:00.000Z',
        spawnLeg: async (leg, _w, env) => {
          // leg-a is priced; leg-b has one priced and two unpriced calls.
          if (leg.id === 'leg-a') {
            appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, '03-data', 0.4));
            appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, '09-synth', 0.4));
          } else {
            appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, '03-data', 0.2));
            appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, '09-synth', null));
            appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, '09-synth', null));
          }
          return { exitCode: 0, durationMs: 5 };
        },
      });
      for (const l of result.legs) if (l.workspace) kept.push(l.workspace);
      const pub = JSON.parse(readFileSync(join(result.runDir, 'comparison', 'publication-model.json'), 'utf-8')) as Pub & {
        passGroups: Array<{ pass_id: string; legs: Record<string, { cost_usd: number | null; unpriced_calls?: number }> }>;
      };
      expect(pub.run['unpriced_calls']).toBe(2);
      expect(pub.run['assessment_unpriced_calls']).toBe(2);
      expect(pub.run.legs['leg-a']!['unpriced_calls']).toBe(0);
      expect(pub.run.legs['leg-b']!['unpriced_calls']).toBe(2);
      // The comparison per pass: the unpriced calls next to the priced sum.
      const synth = pub.passGroups.find((g) => g.pass_id === '09-synth')!;
      expect(synth.legs['leg-b']!.unpriced_calls).toBe(2);
      expect(synth.legs['leg-b']!.cost_usd).toBeNull();
      expect(synth.legs['leg-a']!.unpriced_calls).toBe(0);
      // The orchestration result the TUI renders.
      expect(result.totals?.unpriced_calls).toBe(2);
      expect(result.unpricedCalls).toEqual({ 'leg-a': 0, 'leg-b': 2 });
      expect(result.costUsd?.['leg-b']).toBeCloseTo(0.2, 6);
      const done = readFileSync(join(result.runDir, 'log.ndjson'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l) as { code: string; message: string; context: Record<string, number> }).pop()!;
      expect(done.code).toBe('run.complete');
      expect(done.context['unpriced_calls']).toBe(2);
      expect(done.message).toContain('1.0000 USD plus 2 unpriced calls');
    } finally {
      for (const k of kept) rmSync(k, { recursive: true, force: true });
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

