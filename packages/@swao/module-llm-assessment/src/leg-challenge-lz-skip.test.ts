// #4323: the leg LZ challenge is skipped with a reason when the app has no
// LZ Catalog run; a challenge that exits non-zero is logged at warn with its
// output tail; the publication model records the skip reason.

import { describe, it, expect } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orchestrateLegs, stageChallengeRuns, type ResolvedLeg } from './orchestrator.js';
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

type LogLine = { level: string; code: string; message: string; context?: Record<string, unknown> };
const readLog = (runDir: string): LogLine[] =>
  readFileSync(join(runDir, 'log.ndjson'), 'utf-8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as LogLine);

function makeWs(withLzRun: boolean): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-4323-'));
  writeFileSync(join(ws, '.swao.yml'), 'workspace: {}\n', 'utf-8');
  const app = join(ws, 'apps', 'demo-app');
  mkdirSync(join(app, 'src'), { recursive: true });
  writeFileSync(join(app, 'src', 'main.ts'), 'export const x = 1;\n', 'utf-8');
  mkdirSync(join(app, 'wsp'), { recursive: true });
  if (withLzRun) {
    const lzRun = '2026-11-09T16-06-46';
    mkdirSync(join(app, 'wsp', 'runs', lzRun, 'passes'), { recursive: true });
    writeFileSync(join(app, 'wsp', 'runs', lzRun, 'passes', 'lz-fit.yaml'), 'fit: {}\n', 'utf-8');
    writeFileSync(join(app, 'wsp', 'latest-landing-zone-catalog.txt'), `runs/${lzRun}`, 'utf-8');
  }
  return ws;
}

const legs: ResolvedLeg[] = [
  { id: 'anthropic--model-a', connector: 'anthropic', model: 'model-a', primary: true, costSource: 'billed' },
  { id: 'openrouter--model-b', connector: 'openrouter', model: 'model-b', primary: false, costSource: 'billed' },
];

const base = {
  appId: 'demo-app', legs, execution: 'serial' as const, repeat: 1, weights: { quality: 1 },
  keepLegWsp: false, passSuiteVersion: 'v158', timestamp: () => '2026-11-10T12:00:00.000Z',
  spawnLeg: async (leg: ResolvedLeg, legWs: string, env: Record<string, string>) => {
    mkdirSync(join(legWs, 'apps', 'demo-app', 'wsp', 'runs', '2026-11-10T12-00-05'), { recursive: true });
    writeFileSync(join(legWs, 'apps', 'demo-app', 'wsp', 'runs', '2026-11-10T12-00-05', 'wsp.yaml'), 'overall: {}\n', 'utf-8');
    appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, '03-data'));
    return { exitCode: 0, durationMs: 5 };
  },
  spawnChallenge: async () => ({ completed_at: '', agents: [{ agent_id: 'cto', calls: 1, dnf: false, duration_ms: 1 }], exit_code: 0 }),
};

describe('leg LZ challenge skip (#4323)', () => {
  it('stageChallengeRuns names the reason: no pointer, pointer to a missing run', async () => {
    const ws = makeWs(false);
    const leg = mkdtempSync(join(tmpdir(), 'swao-4323-leg-'));
    try {
      expect((await stageChallengeRuns(ws, leg, 'demo-app')).lzSkipReason).toBe('no-lz-catalog-run');
      writeFileSync(join(ws, 'apps', 'demo-app', 'wsp', 'latest-landing-zone-catalog.txt'), 'runs/2026-01-01T00-00-00', 'utf-8');
      const staged = await stageChallengeRuns(ws, leg, 'demo-app');
      expect(staged.lzRunId).toBeUndefined();
      expect(staged.lzSkipReason).toBe('lz-catalog-run-missing');
    } finally {
      rmSync(ws, { recursive: true, force: true });
      rmSync(leg, { recursive: true, force: true });
    }
  });

  it('no LZ Catalog run: the LZ challenge is not spawned; one skip event per leg; publication model has the reason', async () => {
    const ws = makeWs(false);
    try {
      let lzSpawns = 0;
      const result = await orchestrateLegs({
        ...base, workspaceRoot: ws,
        spawnLzChallenge: async () => { lzSpawns++; return { completed_at: '', agents: [], exit_code: 1 }; },
      });
      expect(lzSpawns).toBe(0);
      const lines = readLog(result.runDir);
      const skips = lines.filter((l) => l.code === 'leg.challenge-lz.skip');
      expect(skips).toHaveLength(2);
      expect(skips[0]!.context?.['reason']).toBe('no-lz-catalog-run');
      expect(skips[0]!.message).toContain('not run: no LZ Catalog run of the app');
      expect(lines.some((l) => l.code === 'leg.challenge-lz.start')).toBe(false);
      const pub = JSON.parse(readFileSync(join(result.runDir, 'comparison', 'publication-model.json'), 'utf-8')) as Record<string, unknown>;
      expect(pub['lzChallengeSkip']).toEqual({
        reason: 'no-lz-catalog-run',
        message: 'not run: no LZ Catalog run of the app and no inline LZ fit in the leg run',
        legs: { 'anthropic--model-a': 'no-lz-catalog-run', 'openrouter--model-b': 'no-lz-catalog-run' },
      });
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('a spawned LZ challenge exiting 1 is logged at warn with the exit code and output tail; the tail is not persisted', async () => {
    const ws = makeWs(true);
    try {
      const result = await orchestrateLegs({
        ...base, workspaceRoot: ws,
        spawnLzChallenge: async () => ({ completed_at: '', agents: [], exit_code: 1, output_tail: '[info] loading\n[error] LZ agents failed to load\n' }),
      });
      const lines = readLog(result.runDir);
      expect(lines.filter((l) => l.code === 'leg.challenge-lz.complete')).toHaveLength(2);
      const done = lines.find((l) => l.code === 'leg.challenge-lz.complete')!;
      expect(done.level).toBe('warn');
      expect(done.context?.['exit_code']).toBe(1);
      expect(String(done.context?.['stderr_tail'])).toContain('LZ agents failed to load');
      expect(done.message).toContain('exit code 1');
      const persisted = readFileSync(join(result.runDir, 'calls', 'anthropic--model-a', 'lz-challenge-results.json'), 'utf-8');
      expect(persisted).not.toContain('output_tail');
      // The app challenge exited 0: info.
      expect(lines.find((l) => l.code === 'leg.challenge.complete')!.level).toBe('info');
      const pub = JSON.parse(readFileSync(join(result.runDir, 'comparison', 'publication-model.json'), 'utf-8')) as Record<string, unknown>;
      expect(pub['lzChallengeSkip']).toBeUndefined();
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  // #4441 (owner decision 2026-11-15, as #4390 for the CLI): the inline LZ fit of the leg run.
  it('stageChallengeRuns: no LZ Catalog run but an inline fit in the leg run points latest-application.txt at that run', async () => {
    const ws = makeWs(false);
    const leg = mkdtempSync(join(tmpdir(), 'swao-4441-leg-'));
    try {
      const legRun = join(leg, 'apps', 'demo-app', 'wsp', 'runs', '2026-11-10T12-00-05');
      mkdirSync(legRun, { recursive: true });
      expect((await stageChallengeRuns(ws, leg, 'demo-app', '2026-11-10T12-00-05')).lzSkipReason).toBe('no-lz-catalog-run');
      writeFileSync(join(legRun, 'lz-catalogue-fit.yaml'), 'provider: otc\nregion: eu-de\noverall: NEEDS_VERIFICATION\n', 'utf-8');
      const staged = await stageChallengeRuns(ws, leg, 'demo-app', '2026-11-10T12-00-05');
      expect(staged.lzSkipReason).toBeUndefined();
      expect(staged.lzRunId).toBeUndefined();
      expect(staged.lzInlineFitRunId).toBe('2026-11-10T12-00-05');
      expect(readFileSync(join(leg, 'apps', 'demo-app', 'wsp', 'latest-application.txt'), 'utf-8')).toBe('runs/2026-11-10T12-00-05');
      // A stale LZ Catalog pointer (the run is gone) falls back to the inline fit too.
      writeFileSync(join(ws, 'apps', 'demo-app', 'wsp', 'latest-landing-zone-catalog.txt'), 'runs/2026-01-01T00-00-00', 'utf-8');
      const stale = await stageChallengeRuns(ws, leg, 'demo-app', '2026-11-10T12-00-05');
      expect(stale).toEqual({ lzInlineFitRunId: '2026-11-10T12-00-05' });
    } finally {
      rmSync(ws, { recursive: true, force: true });
      rmSync(leg, { recursive: true, force: true });
    }
  });

  it('no LZ Catalog run, inline fit in each leg run: the LZ challenge runs on the leg run without --run', async () => {
    const ws = makeWs(false);
    try {
      const ctxs: Array<{ runId?: string; legWs: string }> = [];
      const result = await orchestrateLegs({
        ...base, workspaceRoot: ws,
        spawnLeg: async (leg: ResolvedLeg, legWs: string, env: Record<string, string>) => {
          const run = join(legWs, 'apps', 'demo-app', 'wsp', 'runs', '2026-11-10T12-00-05');
          mkdirSync(run, { recursive: true });
          writeFileSync(join(run, 'wsp.yaml'), 'overall: {}\n', 'utf-8');
          writeFileSync(join(run, 'lz-catalogue-fit.yaml'), 'provider: otc\nregion: eu-de\noverall: NEEDS_VERIFICATION\n', 'utf-8');
          appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, '03-data'));
          return { exitCode: 0, durationMs: 5 };
        },
        spawnLzChallenge: async (_leg, legWs, _env, ctx) => {
          ctxs.push({ ...(ctx.runId ? { runId: ctx.runId } : {}), legWs });
          expect(readFileSync(join(legWs, 'apps', 'demo-app', 'wsp', 'latest-application.txt'), 'utf-8')).toBe('runs/2026-11-10T12-00-05');
          return { completed_at: '', agents: [{ agent_id: 'lz-auditor', calls: 1, dnf: false, duration_ms: 1 }], exit_code: 0 };
        },
      });
      expect(ctxs).toHaveLength(2);
      for (const c of ctxs) expect(c.runId).toBeUndefined();
      const lines = readLog(result.runDir);
      expect(lines.some((l) => l.code === 'leg.challenge-lz.skip')).toBe(false);
      const starts = lines.filter((l) => l.code === 'leg.challenge-lz.start');
      expect(starts).toHaveLength(2);
      expect(starts[0]!.context?.['challenged_run']).toBe('2026-11-10T12-00-05');
      expect(starts[0]!.context?.['fit_source']).toBe('application');
      expect(starts[0]!.message).toContain('inline LZ fit of its own run 2026-11-10T12-00-05');
      const pub = JSON.parse(readFileSync(join(result.runDir, 'comparison', 'publication-model.json'), 'utf-8')) as Record<string, unknown>;
      expect(pub['lzChallengeSkip']).toBeUndefined();
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
