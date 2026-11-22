// #4291: each leg's stakeholder challenge challenges the application run the
// leg produced itself, never the staged reference run of the main workspace.

import { describe, it, expect } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legOwnRunId, orchestrateLegs, type LegChallengeContext, type ResolvedLeg } from './orchestrator.js';
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

const REF_RUN = '2026-11-10T08-53-21';
const legs: ResolvedLeg[] = [
  { id: 'anthropic--model-a', connector: 'anthropic', model: 'model-a', primary: true, costSource: 'billed' },
  { id: 'openrouter--model-b', connector: 'openrouter', model: 'model-b', primary: false, costSource: 'billed' },
];
const legRunOf: Record<string, string> = { 'anthropic--model-a': '2026-11-10T10-29-36', 'openrouter--model-b': '2026-11-10T10-41-32' };

function makeWs(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-4291-'));
  writeFileSync(join(ws, '.swao.yml'), 'workspace: {}\n', 'utf-8');
  const app = join(ws, 'apps', 'demo-app');
  mkdirSync(join(app, 'src'), { recursive: true });
  writeFileSync(join(app, 'src', 'main.ts'), 'export const x = 1;\n', 'utf-8');
  mkdirSync(join(app, 'wsp', 'runs', REF_RUN), { recursive: true });
  writeFileSync(join(app, 'wsp', 'runs', REF_RUN, 'wsp.yaml'), 'overall: {}\n', 'utf-8');
  writeFileSync(join(app, 'wsp', 'latest-application.txt'), `runs/${REF_RUN}`, 'utf-8');
  return ws;
}

type LogLine = { level: string; code: string; context?: Record<string, unknown> };
const readLog = (runDir: string): LogLine[] =>
  readFileSync(join(runDir, 'log.ndjson'), 'utf-8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as LogLine);

const base = {
  appId: 'demo-app', legs, execution: 'serial' as const, repeat: 1, weights: { quality: 1 },
  keepLegWsp: false, passSuiteVersion: 'v158', timestamp: () => '2026-11-10T12:00:00.000Z',
  suiteRun: { runTs: REF_RUN, assessmentType: 'application', passCount: 14 },
};

describe('leg stakeholder challenge on the leg run (#4291)', () => {
  it('legOwnRunId: newest run folder of the leg workspace; undefined without runs', () => {
    const leg = mkdtempSync(join(tmpdir(), 'swao-4291-leg-'));
    try {
      expect(legOwnRunId(leg, 'demo-app')).toBeUndefined();
      for (const id of ['2026-11-10T10-29-36', '2026-11-10T10-31-00']) mkdirSync(join(leg, 'apps', 'demo-app', 'wsp', 'runs', id), { recursive: true });
      mkdirSync(join(leg, 'apps', 'demo-app', 'wsp', 'runs', 'not-a-run'), { recursive: true });
      expect(legOwnRunId(leg, 'demo-app')).toBe('2026-11-10T10-31-00');
    } finally {
      rmSync(leg, { recursive: true, force: true });
    }
  });

  it('the challenge run id equals the leg run id; the reference run is not staged; main workspace unchanged', async () => {
    const ws = makeWs();
    try {
      const mainRunsBefore = readdirSync(join(ws, 'apps', 'demo-app', 'wsp', 'runs'));
      const seen: Array<{ legId: string; ctx: LegChallengeContext; refStaged: boolean }> = [];
      const result = await orchestrateLegs({
        ...base, workspaceRoot: ws,
        spawnLeg: async (leg, legWs, env) => {
          const run = join(legWs, 'apps', 'demo-app', 'wsp', 'runs', legRunOf[leg.id]!);
          mkdirSync(run, { recursive: true });
          writeFileSync(join(run, 'wsp.yaml'), 'overall: {}\n', 'utf-8');
          appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, '03-data'));
          return { exitCode: 0, durationMs: 5 };
        },
        spawnChallenge: async (leg, legWs, _env, ctx) => {
          seen.push({ legId: leg.id, ctx, refStaged: existsSync(join(legWs, 'apps', 'demo-app', 'wsp', 'runs', REF_RUN)) });
          return { completed_at: '', agents: [{ agent_id: 'cto', calls: 1, dnf: false, duration_ms: 1 }], exit_code: 0 };
        },
      });
      expect(seen.map((s) => [s.legId, s.ctx.runId])).toEqual(legs.map((l) => [l.id, legRunOf[l.id]]));
      expect(seen.every((s) => !s.refStaged)).toBe(true);
      const starts = readLog(result.runDir).filter((l) => l.code === 'leg.challenge.start');
      expect(starts.map((l) => l.context?.['challenged_run'])).toEqual(legs.map((l) => legRunOf[l.id]));
      // run.suite stays as information.
      const runStart = readLog(result.runDir).find((l) => l.code === 'run.start')!;
      expect((runStart.context?.['suite'] as { run: string }).run).toBe(REF_RUN);
      // #4277: the main workspace's runs are unchanged.
      expect(readdirSync(join(ws, 'apps', 'demo-app', 'wsp', 'runs'))).toEqual(mainRunsBefore);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('a leg without its own run gets no stakeholder challenge (no fallback to the reference run)', async () => {
    const ws = makeWs();
    try {
      let spawns = 0;
      const result = await orchestrateLegs({
        ...base, workspaceRoot: ws,
        spawnLeg: async (leg, _legWs, env) => {
          appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, '03-data'));
          return { exitCode: 0, durationMs: 5 };
        },
        spawnChallenge: async () => { spawns++; return { completed_at: '', agents: [], exit_code: 0 }; },
      });
      expect(spawns).toBe(0);
      const skips = readLog(result.runDir).filter((l) => l.code === 'leg.challenge.skip');
      expect(skips).toHaveLength(2);
      expect(skips.every((l) => l.context?.['reason'] === 'no-leg-run' && l.level === 'warn')).toBe(true);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
