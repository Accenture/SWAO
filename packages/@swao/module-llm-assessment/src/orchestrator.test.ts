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

// Orchestrator tests (#1421): fake spawnLeg writes synthetic call
// records, so the full loop (clone, spawn, harvest, discard, compare,
// persist) is verified without any LLM or child process.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orchestrateLegs, listRunDirs, assembleGroups, extractLegVerdict, type ResolvedLeg } from './orchestrator.js';
import { prepareLegWorkspace } from './leg-workspace.js';
import { LEG_ENV } from './leg-recorder.js';
import { CallRecordSchema, sizeBucket } from './call-record.js';

// Built at run time so the source holds no secret shape (secret-detection gate).
const FAKE_KEY = 'sk-' + 'abcdefghijklmnopqrstuvwx';

let ws: string;

function syntheticRecord(legId: string, connector: string, model: string, passId: string, ms: number, cost: number | null): Record<string, unknown> {
  return {
    leg: { id: legId, connector, model },
    pass_id: passId, call_site: 'site', call_index: 0,
    prompt: { sha256: 'p', chars: 4000, tokens_est: 1000, size_bucket: sizeBucket(1000) },
    timing: { started: '2026-08-06T12:00:00Z', total_ms: ms },
    tokens: { prompt: 1000, completion: 300 },
    cost_usd: { computed: cost, source: cost === null ? 'local' : 'billed' },
    quality: { parse_valid: true, schema_conform: true, truncated: false, refusal_detected: false },
    reliability: { retries: 0, rate_limited: false, dnf: false },
    security: { redaction_marker_altered: false, foreign_path_count: 0, pii_reproduction_detected: false, prompt_injection_detected: false },
    response_sha256: 'r',
  };
}

beforeAll(() => {
  ws = mkdtempSync(join(tmpdir(), 'swao-orch-ws-'));
  writeFileSync(join(ws, '.swao.yml'), 'workspace: {}\n', 'utf-8');
  const app = join(ws, 'apps', 'demo-app');
  mkdirSync(join(app, 'src'), { recursive: true });
  mkdirSync(join(app, 'wsp', 'inputs'), { recursive: true });
  mkdirSync(join(app, 'wsp', 'runs', 'old-run'), { recursive: true });
  writeFileSync(join(app, 'src', 'main.ts'), 'export const x = 1;\n', 'utf-8');
  writeFileSync(join(app, 'wsp', 'inputs', 'ctx.md'), 'context\n', 'utf-8');
  writeFileSync(join(app, 'wsp', 'runs', 'old-run', 'run-manifest.json'), '{}', 'utf-8');
  writeFileSync(join(app, '.swao.yml'), 'app:\n  id: demo-app\n', 'utf-8');
});

afterAll(() => {
  if (ws) rmSync(ws, { recursive: true, force: true });
});

describe('prepareLegWorkspace (#1421, #4243)', () => {
  it('copies sources + inputs, excludes generated artefacts', async () => {
    const prepared = await prepareLegWorkspace({ workspaceRoot: ws, appId: 'demo-app', legId: 'or--x' });
    const clone = prepared.path;
    try {
      expect(existsSync(join(clone, 'apps', 'demo-app', 'src', 'main.ts'))).toBe(true);
      expect(existsSync(join(clone, 'apps', 'demo-app', 'wsp', 'inputs', 'ctx.md'))).toBe(true);
      expect(existsSync(join(clone, 'apps', 'demo-app', 'wsp', 'runs'))).toBe(false);
      expect(existsSync(join(clone, '.swao.yml'))).toBe(true);
      expect(prepared.stats.files).toBeGreaterThan(0);
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  });

  it('never copies logs, cache or the app challenge folders (#2004, #4277)', async () => {
    const tmpWs = mkdtempSync(join(tmpdir(), 'swao-clone-2004-'));
    try {
      writeFileSync(join(tmpWs, '.swao.yml'), 'workspace: {}\n', 'utf-8');
      const app = join(tmpWs, 'apps', 'demo-app');
      mkdirSync(join(app, 'src'), { recursive: true });
      writeFileSync(join(app, 'src', 'main.ts'), 'export const x = 1;\n', 'utf-8');
      mkdirSync(join(app, 'wsp', 'inputs'), { recursive: true });
      writeFileSync(join(app, 'wsp', 'inputs', 'ctx.md'), 'context\n', 'utf-8');
      for (const d of ['logs', 'cache', 'challenge-app', 'challenge-lz']) {
        mkdirSync(join(app, 'wsp', d), { recursive: true });
        writeFileSync(join(app, 'wsp', d, 'x.yaml'), 'x: 1\n', 'utf-8');
      }
      const prepared = await prepareLegWorkspace({ workspaceRoot: tmpWs, appId: 'demo-app', legId: 'test-2004' });
      try {
        const legApp = join(prepared.path, 'apps', 'demo-app');
        expect(existsSync(join(legApp, 'src', 'main.ts'))).toBe(true);
        expect(existsSync(join(legApp, 'wsp', 'inputs', 'ctx.md'))).toBe(true);
        for (const d of ['logs', 'cache', 'challenge-app', 'challenge-lz']) expect(existsSync(join(legApp, 'wsp', d))).toBe(false);
      } finally {
        rmSync(prepared.path, { recursive: true, force: true });
      }
    } finally {
      rmSync(tmpWs, { recursive: true, force: true });
    }
  });

  it('copies only source.vcs.subdir of a monorepo clone, without .git (#4243)', async () => {
    const mono = makeMonorepoWs(40);
    try {
      const prepared = await prepareLegWorkspace({ workspaceRoot: mono.ws, appId: 'mono-app', legId: 'mono-leg' });
      try {
        const legSrc = join(prepared.path, 'apps', 'mono-app', 'wsp', 'inputs', 'source');
        expect(existsSync(join(legSrc, 'apps', 'health', 'mono-app', 'src', 'index.ts'))).toBe(true);
        expect(existsSync(join(legSrc, 'apps', 'other'))).toBe(false);
        expect(existsSync(join(legSrc, '.git'))).toBe(false);
        expect(existsSync(join(legSrc, 'apps', 'health', 'mono-app', '.git'))).toBe(false);
        expect(existsSync(join(prepared.path, 'apps', 'mono-app', 'wsp', 'inputs', 'notes.md'))).toBe(true);
        expect(prepared.source.subdir).toBe('apps/health/mono-app');
        expect(prepared.source_copied).toBe(true);
        // Only the subdir files plus the app's own files, not the 40 sibling-app files or .git.
        expect(prepared.stats.files).toBeLessThan(10);
      } finally {
        rmSync(prepared.path, { recursive: true, force: true });
      }
    } finally {
      rmSync(mono.ws, { recursive: true, force: true });
    }
  });
});

/** #4243 fixture: an app whose source is a monorepo clone under wsp/inputs/source with vcs.subdir set. */
function makeMonorepoWs(siblingFiles: number): { ws: string } {
  const mws = mkdtempSync(join(tmpdir(), 'swao-mono-'));
  writeFileSync(join(mws, '.swao.yml'), 'workspace: {}\n', 'utf-8');
  const app = join(mws, 'apps', 'mono-app');
  mkdirSync(join(app, 'wsp', 'inputs'), { recursive: true });
  writeFileSync(join(app, '.swao.yml'),
    'app:\n  id: mono-app\nsource:\n  path: wsp/inputs/source\n  vcs:\n    url: https://example.invalid/org/monorepo.git\n    subdir: apps/health/mono-app\n', 'utf-8');
  writeFileSync(join(app, 'wsp', 'inputs', 'notes.md'), 'operator notes\n', 'utf-8');
  const clone = join(app, 'wsp', 'inputs', 'source');
  mkdirSync(join(clone, '.git', 'objects'), { recursive: true });
  writeFileSync(join(clone, '.git', 'objects', 'pack'), 'x'.repeat(1000), 'utf-8');
  mkdirSync(join(clone, 'apps', 'health', 'mono-app', 'src'), { recursive: true });
  writeFileSync(join(clone, 'apps', 'health', 'mono-app', 'src', 'index.ts'), 'export const app = 1;\n', 'utf-8');
  mkdirSync(join(clone, 'apps', 'other'), { recursive: true });
  for (let i = 0; i < siblingFiles; i++) writeFileSync(join(clone, 'apps', 'other', `f${i}.ts`), `export const v${i} = ${i};\n`, 'utf-8');
  return { ws: mws };
}

describe('extractLegVerdict (#1483)', () => {
  it('returns null when runs dir absent', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-ev-'));
    try {
      expect(extractLegVerdict(tmp, 'demo-app')).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns null when wsp.yaml has no seven_r_label', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-ev-'));
    try {
      const runDir = join(tmp, 'apps', 'demo-app', 'wsp', 'runs', '2026-08-09T10-00-00');
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, 'wsp.yaml'), 'seven_r_verdict: READY\n', 'utf-8');
      expect(extractLegVerdict(tmp, 'demo-app')).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('extracts seven_r_label from the latest run dir', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-ev-'));
    try {
      const older = join(tmp, 'apps', 'demo-app', 'wsp', 'runs', '2026-08-08T10-00-00');
      const newer = join(tmp, 'apps', 'demo-app', 'wsp', 'runs', '2026-08-09T10-00-00');
      mkdirSync(older, { recursive: true });
      mkdirSync(newer, { recursive: true });
      writeFileSync(join(older, 'wsp.yaml'), 'seven_r_label: Retire\n', 'utf-8');
      writeFileSync(join(newer, 'wsp.yaml'), 'seven_r_label: Refactor\n', 'utf-8');
      expect(extractLegVerdict(tmp, 'demo-app')).toBe('Refactor');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns null gracefully on filesystem error', () => {
    expect(extractLegVerdict('/nonexistent/path/xyz', 'demo-app')).toBeNull();
  });
});

describe('orchestrateLegs (#1421)', () => {
  const legs: ResolvedLeg[] = [
    { id: 'or--fast', connector: 'openrouter', model: 'fast/model', primary: true, costSource: 'billed' },
    { id: 'or--slow', connector: 'openrouter', model: 'slow/model', primary: false, costSource: 'billed' },
    { id: 'ollama--local', connector: 'ollama', model: 'llama', primary: false, costSource: 'local' },
  ];

  it('runs the full loop: spawn per leg, harvest, discard, compare, persist', async () => {
    const spawned: string[] = [];
    const result = await orchestrateLegs({
      workspaceRoot: ws, appId: 'demo-app', legs,
      execution: 'serial', repeat: 1,
      weights: { quality: 0.5, reliability: 0.2, performance: 0.15, cost: 0.15 },
      keepLegWsp: false, passSuiteVersion: 'v14',
      timestamp: () => '2026-08-06T12:00:00.000Z',
      spawnLeg: async (leg, legWs, env) => {
        spawned.push(leg.id);
        // The child would assess inside legWs; here we only assert the env
        // contract and write synthetic records to the sink.
        expect(existsSync(join(legWs, 'apps', 'demo-app', 'src', 'main.ts'))).toBe(true);
        expect(env[LEG_ENV.LEG_ID]).toBe(leg.id);
        expect(env[LEG_ENV.COST_SOURCE]).toBe(leg.costSource);
        const sink = env[LEG_ENV.RECORD]!;
        const ms = leg.id === 'or--fast' ? 1000 : leg.id === 'or--slow' ? 3000 : 8000;
        const cost = leg.costSource === 'local' ? null : leg.id === 'or--fast' ? 0.01 : 0.002;
        for (const pass of ['03-data', '09-synth']) {
          appendFileSync(sink, JSON.stringify(syntheticRecord(leg.id, leg.connector, leg.model, pass, ms, cost)) + '\n');
        }
        return { exitCode: 0, durationMs: ms * 3 };
      },
    });

    expect(spawned).toEqual(['or--fast', 'or--slow', 'ollama--local']);
    expect(result.records).toHaveLength(6);

    // Persistence layout (092 s7).
    expect(existsSync(result.manifestPath)).toBe(true);
    expect(existsSync(join(result.runDir, 'comparison', 'comparison.json'))).toBe(true);
    expect(existsSync(join(result.runDir, 'comparison', 'publication-model.json'))).toBe(true);
    expect(existsSync(join(result.runDir, 'findings.yaml'))).toBe(true);
    expect(existsSync(join(result.runDir, 'log.ndjson'))).toBe(true);
    expect(readFileSync(join(ws, 'llm-assessments', 'swao', 'latest.txt'), 'utf-8').trim()).toBe('2026-08-06T12-00-00');

    // Comparison sanity: fast leg leads performance; local leg has no cost rank.
    const perf = result.groups.find((g) => g.group === 'performance')!;
    expect(perf.rank['or--fast']).toBe(1);
    const cost = result.groups.find((g) => g.group === 'cost')!;
    expect(cost.score['ollama--local']).toBeNull();
    expect(result.final.partial['ollama--local']).toContain('cost');
    // Hand-computed final: quality/reliability/security are degenerate draws
    // (100 all), so the .15 cost knob decides between fast (5x pricier,
    // cost score 0 -> 85.0) and slow (cost score 100, perf ~71 -> ~85.7):
    // the cheaper model legitimately ranks 1st at these synthetic numbers.
    expect(result.final.rank['or--slow']).toBe(1);
    expect(result.final.rank['or--fast']).toBe(2);
    expect(result.final.rank['ollama--local']).toBe(3);

    // Manifest carries the comparability key + analysis mode field (3 legs).
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf-8')) as Record<string, unknown>;
    expect(manifest['analysis_mode']).toBe('field');
    expect(String(manifest['comparability_key'])).toMatch(/^[0-9a-f]{64}$/);

    expect(listRunDirs(ws)).toContain('2026-08-06T12-00-00');
  });

  it('security group is present with 5 properties and no score contribution', () => {
    // 3 existing + 2 new security metrics; security weight=0 => no final rank impact.
    const groups = assembleGroups(
      [
        CallRecordSchema.parse({
          leg: { id: 'leg-a', connector: 'c', model: 'm' },
          pass_id: '03-data', call_site: 'site', call_index: 0,
          prompt: { sha256: 'p', chars: 400, tokens_est: 100, size_bucket: 'S' },
          timing: { started: '2026-08-06T12:00:00Z', total_ms: 500 },
          tokens: { prompt: 100, completion: 80 },
          cost_usd: { computed: 0.001, source: 'billed' },
          quality: { parse_valid: true, schema_conform: true, truncated: false, refusal_detected: false },
          reliability: { retries: 0, rate_limited: false, dnf: false },
          security: { redaction_marker_altered: false, foreign_path_count: 0, pii_reproduction_detected: false, prompt_injection_detected: false },
          response_sha256: 'r',
        }),
      ],
      {},
      ['leg-a'],
    );
    const sec = groups.find((g) => g.group === 'security');
    expect(sec).toBeDefined();
    // All 5 security metrics should yield a score (even if 0).
    expect(Object.keys(sec!.score)).toContain('leg-a');
  });

  it('assembleGroups security: pii and injection flags are collected and affect relative scores', () => {
    const makeRec = (
      legId: string,
      pii: boolean,
      inj: boolean,
      altered: boolean,
    ) => CallRecordSchema.parse({
      leg: { id: legId, connector: 'c', model: 'm' },
      pass_id: '03-data', call_site: 'site', call_index: 0,
      prompt: { sha256: 'p', chars: 400, tokens_est: 100, size_bucket: 'S' },
      timing: { started: '2026-08-06T12:00:00Z', total_ms: 500 },
      tokens: { prompt: 100, completion: 80 },
      cost_usd: { computed: 0.001, source: 'billed' },
      quality: { parse_valid: true, schema_conform: true, truncated: false, refusal_detected: false },
      reliability: { retries: 0, rate_limited: false, dnf: false },
      security: { redaction_marker_altered: altered, foreign_path_count: 0, pii_reproduction_detected: pii, prompt_injection_detected: inj },
      response_sha256: 'r',
    });

    // leg-a clean; leg-b has all security flags set -- leg-a should rank higher.
    const records = [
      makeRec('leg-a', false, false, false),
      makeRec('leg-b', true, true, true),
    ];
    const groups = assembleGroups(records, {}, ['leg-a', 'leg-b']);
    const sec = groups.find((g) => g.group === 'security')!;
    expect(sec).toBeDefined();
    // Clean leg ranks better (lower count = better for 'lower' direction metrics).
    expect(sec.rank['leg-a']).toBe(1);
    expect(sec.rank['leg-b']).toBe(2);
  });

  it('a failing leg and an empty sink produce findings, not silence', async () => {
    const result = await orchestrateLegs({
      workspaceRoot: ws, appId: 'demo-app',
      legs: legs.slice(0, 2),
      execution: 'serial', repeat: 1,
      weights: { quality: 1 }, keepLegWsp: false, passSuiteVersion: 'v14',
      timestamp: () => '2026-08-06T13:00:00.000Z',
      spawnLeg: async (leg, _ws2, env) => {
        if (leg.id === 'or--fast') {
          appendFileSync(env[LEG_ENV.RECORD]!, JSON.stringify(syntheticRecord(leg.id, leg.connector, leg.model, '03-data', 900, 0.01)) + '\n');
          return { exitCode: 0, durationMs: 3000 };
        }
        return { exitCode: 1, durationMs: 100 }; // failed leg, nothing recorded
      },
    });
    expect(result.findingsCount).toBeGreaterThanOrEqual(2); // leg-failed + no-calls-recorded
    const findingsYaml = readFileSync(join(result.runDir, 'findings.yaml'), 'utf-8');
    expect(findingsYaml).toContain('leg-failed');
    expect(findingsYaml).toContain('no-calls-recorded');
  });

  it('relay only forwards events from the current run -- not historical log content (#2004)', async () => {
    // Use a fresh workspace so events from other tests do not bleed in.
    const relayWs = mkdtempSync(join(tmpdir(), 'swao-relay-ts-'));
    try {
      writeFileSync(join(relayWs, '.swao.yml'), 'workspace: {}\n', 'utf-8');
      const app = join(relayWs, 'apps', 'demo-app');
      mkdirSync(join(app, 'src'), { recursive: true });
      writeFileSync(join(app, 'src', 'main.ts'), 'export const x = 1;\n', 'utf-8');
      mkdirSync(join(app, 'wsp', 'inputs'), { recursive: true });

      // Run timestamp is 2026-08-06T14:00:00.000Z -- events before this are historical.
      const runStart = '2026-08-06T14:00:00.000Z';
      const now = new Date();
      const monthSlug = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      const mainLogPath = join(relayWs, 'apps', 'demo-app', 'wsp', 'logs', `app-events-${monthSlug}.ndjson`);

      const relayLegs: ResolvedLeg[] = [
        { id: 'relay-leg-a', connector: 'openrouter', model: 'fast', primary: true, costSource: 'billed' },
        { id: 'relay-leg-b', connector: 'openrouter', model: 'slow', primary: false, costSource: 'billed' },
      ];
      await orchestrateLegs({
        workspaceRoot: relayWs, appId: 'demo-app',
        legs: relayLegs,
        execution: 'serial', repeat: 1,
        weights: { quality: 1 }, keepLegWsp: true, passSuiteVersion: 'v14',
        timestamp: () => runStart,
        spawnLeg: async (leg, legWs, env) => {
          appendFileSync(env[LEG_ENV.RECORD]!, JSON.stringify(syntheticRecord(leg.id, leg.connector, leg.model, '03-data', 500, 0.005)) + '\n');
          // Only seed historical log content for the first leg (to keep assertions simple).
          if (leg.id === 'relay-leg-a') {
            // Simulate historical log content copied into leg workspace (cpSync filter bypass).
            const legLogDir = join(legWs, 'apps', 'demo-app', 'wsp', 'logs');
            mkdirSync(legLogDir, { recursive: true });
            const legLogPath = join(legLogDir, `app-events-${monthSlug}.ndjson`);
            // Historical event (before run start -- must NOT be relayed)
            appendFileSync(legLogPath, JSON.stringify({ ts: '2026-08-05T10:00:00.000Z', code: 'provider.llm.gateway.ok', level: 'info', scope: 'app' }) + '\n', 'utf-8');
            // Current-run event (at run start time -- must be relayed)
            appendFileSync(legLogPath, JSON.stringify({ ts: runStart, code: 'provider.llm.gateway.ok', level: 'info', scope: 'app' }) + '\n', 'utf-8');
          }
          return { exitCode: 0, durationMs: 500 };
        },
      });

      // Main workspace log should contain only the current-run event, not the historical one.
      expect(existsSync(mainLogPath)).toBe(true);
      const mainLogContent = readFileSync(mainLogPath, 'utf-8');
      const mainLines = mainLogContent.split('\n').filter((l) => l.trim());
      const gatewayLines = mainLines.filter((l) => l.includes('provider.llm.gateway.ok'));
      expect(gatewayLines).toHaveLength(1);
      expect(gatewayLines[0]).toContain(runStart);
      expect(gatewayLines[0]).not.toContain('2026-08-05T10:00:00.000Z');
    } finally {
      rmSync(relayWs, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// #1708: stakeholder challenge phase (spawnChallenge optional hook)
// ---------------------------------------------------------------------------

describe('orchestrateLegs spawnChallenge (#1708)', () => {
  const twoLegs: ResolvedLeg[] = [
    { id: 'c1-leg-a', connector: 'openrouter', model: 'haiku', primary: true, costSource: 'billed' },
    { id: 'c1-leg-b', connector: 'openrouter', model: 'sonnet', primary: false, costSource: 'billed' },
  ];

  it('writes challenge-results.json per leg when spawnChallenge is provided', async () => {
    let challengeCallCount = 0;
    const result = await orchestrateLegs({
      workspaceRoot: ws, appId: 'demo-app',
      legs: twoLegs,
      execution: 'serial', repeat: 1,
      weights: { quality: 1 }, keepLegWsp: false, passSuiteVersion: 'v15',
      timestamp: () => '2026-08-14T10:00:00.000Z',
      spawnLeg: async (leg, legWs2, env) => {
        // #4291: the leg writes its own application run (challenged by its stakeholder challenge).
        mkdirSync(join(legWs2, 'apps', 'demo-app', 'wsp', 'runs', '2026-08-14T10-00-05'), { recursive: true });
        appendFileSync(env[LEG_ENV.RECORD]!, JSON.stringify(syntheticRecord(leg.id, leg.connector, leg.model, '03-data', 500, 0.005)) + '\n');
        return { exitCode: 0, durationMs: 1000 };
      },
      spawnChallenge: async (leg, _legWs, _legEnv) => {
        challengeCallCount++;
        return {
          completed_at: new Date().toISOString(),
          agents: [
            { agent_id: 'app-architect', calls: 3, dnf: false, duration_ms: 12000 },
            { agent_id: 'grc-officer', calls: 2, dnf: false, duration_ms: 8000 },
          ],
          exit_code: 0,
        };
      },
    });
    // spawnChallenge was called once per leg (2 legs)
    expect(challengeCallCount).toBe(2);
    // challenge-results.json written inside calls/<leg-id>/ dir for first leg
    const challengeFile = join(result.runDir, 'calls', 'c1-leg-a', 'challenge-results.json');
    expect(existsSync(challengeFile)).toBe(true);
    const parsed = JSON.parse(readFileSync(challengeFile, 'utf-8')) as {
      agents: Array<{ agent_id: string }>;
      exit_code: number;
    };
    expect(parsed.exit_code).toBe(0);
    expect(parsed.agents.map((a) => a.agent_id)).toContain('app-architect');
    // #1774: challengePassGroups must be non-empty in publication-model.json
    // when spawnChallenge returns populated agents.
    const pubModel = JSON.parse(
      readFileSync(join(result.runDir, 'comparison', 'publication-model.json'), 'utf-8'),
    ) as { challengePassGroups?: unknown[] };
    expect(Array.isArray(pubModel.challengePassGroups)).toBe(true);
    expect((pubModel.challengePassGroups ?? []).length).toBeGreaterThan(0);
  });

  it('logs a warning but does not abort when spawnChallenge throws', async () => {
    const twoLegsB: ResolvedLeg[] = [
      { id: 'c1-fail-a', connector: 'openrouter', model: 'slow', primary: true, costSource: 'billed' },
      { id: 'c1-fail-b', connector: 'openrouter', model: 'fast', primary: false, costSource: 'billed' },
    ];
    const result = await orchestrateLegs({
      workspaceRoot: ws, appId: 'demo-app',
      legs: twoLegsB,
      execution: 'serial', repeat: 1,
      weights: { quality: 1 }, keepLegWsp: false, passSuiteVersion: 'v15',
      timestamp: () => '2026-08-14T11:00:00.000Z',
      spawnLeg: async (leg, legWs2, env) => {
        mkdirSync(join(legWs2, 'apps', 'demo-app', 'wsp', 'runs', '2026-08-14T11-00-05'), { recursive: true });
        appendFileSync(env[LEG_ENV.RECORD]!, JSON.stringify(syntheticRecord(leg.id, leg.connector, leg.model, '03-data', 700, 0.002)) + '\n');
        return { exitCode: 0, durationMs: 1500 };
      },
      spawnChallenge: async () => {
        throw new Error('challenge subprocess failed');
      },
    });
    // Assessment still produced results (no abort)
    expect(result.records.length).toBeGreaterThan(0);
    // log.ndjson should contain a challenge warning
    const logContent = readFileSync(join(result.runDir, 'log.ndjson'), 'utf-8');
    expect(logContent).toContain('leg.challenge.error');
  });

  it('skips challenge phase silently when spawnChallenge is not provided', async () => {
    const twoLegsC: ResolvedLeg[] = [
      { id: 'c1-skip-a', connector: 'openrouter', model: 'mini', primary: true, costSource: 'billed' },
      { id: 'c1-skip-b', connector: 'openrouter', model: 'nano', primary: false, costSource: 'billed' },
    ];
    const result = await orchestrateLegs({
      workspaceRoot: ws, appId: 'demo-app',
      legs: twoLegsC,
      execution: 'serial', repeat: 1,
      weights: { quality: 1 }, keepLegWsp: false, passSuiteVersion: 'v15',
      timestamp: () => '2026-08-14T12:00:00.000Z',
      spawnLeg: async (leg, _ws2, env) => {
        appendFileSync(env[LEG_ENV.RECORD]!, JSON.stringify(syntheticRecord(leg.id, leg.connector, leg.model, '03-data', 600, 0.003)) + '\n');
        return { exitCode: 0, durationMs: 1200 };
      },
      // No spawnChallenge -- should complete without error
    });
    expect(result.records.length).toBeGreaterThan(0);
    // No challenge-results.json should exist
    const challengeFile = join(result.runDir, 'calls', 'c1-skip-a', 'challenge-results.json');
    expect(existsSync(challengeFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #2008: stall watchdog -- spawnLeg wrapped in Promise.race so orchestrator
// never hangs forever when a child process stalls.
// ---------------------------------------------------------------------------

describe('orchestrateLegs stall watchdog (#2008)', () => {
  function makeStallWs(): string {
    const stallWs = mkdtempSync(join(tmpdir(), 'swao-stall-'));
    writeFileSync(join(stallWs, '.swao.yml'), 'workspace: {}\n', 'utf-8');
    const app = join(stallWs, 'apps', 'demo-app');
    mkdirSync(join(app, 'src'), { recursive: true });
    writeFileSync(join(app, 'src', 'main.ts'), 'export const x = 1;\n', 'utf-8');
    mkdirSync(join(app, 'wsp', 'inputs'), { recursive: true });
    return stallWs;
  }

  it('resolves with findings.yaml + manifest when spawnLeg exceeds timeout', async () => {
    const stallWs = makeStallWs();
    const orig = process.env['SWAO_LEG_STALL_TIMEOUT_MS'];
    process.env['SWAO_LEG_STALL_TIMEOUT_MS'] = '50'; // 50 ms for test speed
    try {
      // Two legs required by analysisMode guard; both stall so both watchdogs fire.
      const stallLegs: ResolvedLeg[] = [
        { id: 'stall-a', connector: 'openrouter', model: 'test-a', primary: true,  costSource: 'billed' },
        { id: 'stall-b', connector: 'openrouter', model: 'test-b', primary: false, costSource: 'billed' },
      ];
      const result = await orchestrateLegs({
        workspaceRoot: stallWs, appId: 'demo-app',
        legs: stallLegs, execution: 'serial', repeat: 1,
        weights: { quality: 1 }, keepLegWsp: false, passSuiteVersion: 'v14',
        timestamp: () => '2026-08-24T10:00:00.000Z',
        spawnLeg: async () => {
          // Stall for 500 ms -- watchdog fires at 50 ms; background timer drains after test.
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
          return { exitCode: 0, durationMs: 500 };
        },
      });
      // Orchestrator must complete (not hang) and still write output artefacts.
      expect(existsSync(join(result.runDir, 'findings.yaml'))).toBe(true);
      expect(existsSync(result.manifestPath)).toBe(true);
      // Watchdog resolves with exitCode:1 -- orchestrator records leg-failed findings.
      const findingsYaml = readFileSync(join(result.runDir, 'findings.yaml'), 'utf-8');
      expect(findingsYaml).toContain('leg-failed');
    } finally {
      if (orig === undefined) { delete process.env['SWAO_LEG_STALL_TIMEOUT_MS']; }
      else { process.env['SWAO_LEG_STALL_TIMEOUT_MS'] = orig; }
      rmSync(stallWs, { recursive: true, force: true });
    }
  }, 10_000);

  it('does not record a stall finding when spawnLeg completes before timeout', async () => {
    const fastWs = makeStallWs();
    const orig = process.env['SWAO_LEG_STALL_TIMEOUT_MS'];
    process.env['SWAO_LEG_STALL_TIMEOUT_MS'] = '5000'; // generous timeout
    try {
      const fastLegs: ResolvedLeg[] = [
        { id: 'fast-a', connector: 'openrouter', model: 'fast', primary: true,  costSource: 'billed' },
        { id: 'fast-b', connector: 'openrouter', model: 'slow', primary: false, costSource: 'billed' },
      ];
      const result = await orchestrateLegs({
        workspaceRoot: fastWs, appId: 'demo-app',
        legs: fastLegs, execution: 'serial', repeat: 1,
        weights: { quality: 1 }, keepLegWsp: false, passSuiteVersion: 'v14',
        timestamp: () => '2026-08-24T11:00:00.000Z',
        spawnLeg: async (leg, _legWs, env) => {
          appendFileSync(env[LEG_ENV.RECORD]!, JSON.stringify(syntheticRecord(leg.id, leg.connector, leg.model, '03-data', 100, 0.001)) + '\n');
          return { exitCode: 0, durationMs: 100 };
        },
      });
      // Normal completion: no leg-failed finding; one record per leg.
      const findingsYaml = readFileSync(join(result.runDir, 'findings.yaml'), 'utf-8');
      expect(findingsYaml).not.toContain('leg-failed');
      expect(result.records).toHaveLength(2);
    } finally {
      if (orig === undefined) { delete process.env['SWAO_LEG_STALL_TIMEOUT_MS']; }
      else { process.env['SWAO_LEG_STALL_TIMEOUT_MS'] = orig; }
      rmSync(fastWs, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// #4243: preparation events, failure capture, status, timing, challenge skip,
// cancel, preflight hook.
// ---------------------------------------------------------------------------

interface LogLine { ts: string; level: string; code: string; message: string; context?: Record<string, unknown> }
const readRunLog = (runDir: string): LogLine[] =>
  readFileSync(join(runDir, 'log.ndjson'), 'utf-8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as LogLine);

describe('orchestrateLegs run lifecycle (#4243)', () => {
  const twoLegs: ResolvedLeg[] = [
    { id: 'lc-a', connector: 'anthropic', model: 'model-a', primary: true, costSource: 'billed' },
    { id: 'lc-b', connector: 'openrouter', model: 'model-b', primary: false, costSource: 'billed' },
  ];
  const base = { appId: 'mono-app', execution: 'serial' as const, repeat: 1, weights: { quality: 1 }, keepLegWsp: false, passSuiteVersion: 'v158' };

  it('#4404: a slow hash writes run.prepare.progress between prepare start and complete (stepping clock)', async () => {
    const mono = makeMonorepoWs(40);
    // Every Date.now read advances 20 s, so the 15 s interval passes during the hash.
    let clock = Date.parse('2026-11-14T17:27:26.646Z');
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => (clock += 20_000));
    try {
      const result = await orchestrateLegs({
        ...base, workspaceRoot: mono.ws, legs: twoLegs,
        timestamp: () => '2026-11-14T17:27:26.646Z',
        spawnLeg: async (leg, _legWs, env) => {
          appendFileSync(env[LEG_ENV.RECORD]!, JSON.stringify(syntheticRecord(leg.id, leg.connector, leg.model, '03-data', 100, 0.001)) + '\n');
          return { exitCode: 0, durationMs: 10 };
        },
      });
      spy.mockRestore();
      const lines = readRunLog(result.runDir);
      const start = lines.findIndex((l) => l.code === 'run.prepare.start');
      const done = lines.findIndex((l) => l.code === 'run.prepare.complete');
      const progress = lines.slice(start, done).filter((l) => l.code === 'run.prepare.progress');
      expect(start).toBeGreaterThanOrEqual(0);
      expect(progress.length).toBeGreaterThan(0);
      for (const p of progress) {
        expect(p.context).toMatchObject({ step: 'hash' });
        expect(typeof p.context?.['files']).toBe('number');
        expect(typeof p.context?.['bytes']).toBe('number');
        expect(typeof p.context?.['elapsed_ms']).toBe('number');
      }
    } finally {
      spy.mockRestore();
      rmSync(mono.ws, { recursive: true, force: true });
    }
  });

  it('logs run.start first, then hash and copy preparation events with size and duration, scoped to the subdir', async () => {
    const mono = makeMonorepoWs(40);
    try {
      const statusLines: Array<string | null> = [];
      const result = await orchestrateLegs({
        ...base, workspaceRoot: mono.ws, legs: twoLegs,
        timestamp: () => '2026-11-09T20:00:00.000Z',
        suiteRun: { runTs: '2026-11-09T14-08-36', assessmentType: 'application', passCount: 14 },
        onStatus: (l) => statusLines.push(l),
        spawnLeg: async (leg, legWs, env) => {
          expect(existsSync(join(legWs, 'apps', 'mono-app', 'wsp', 'inputs', 'source', 'apps', 'other'))).toBe(false);
          appendFileSync(env[LEG_ENV.RECORD]!, JSON.stringify(syntheticRecord(leg.id, leg.connector, leg.model, '03-data', 100, 0.001)) + '\n');
          return { exitCode: 0, durationMs: 10 };
        },
      });
      const lines = readRunLog(result.runDir);
      expect(lines[0]!.code).toBe('run.start');
      expect(lines[0]!.context?.['suite']).toEqual({ run: '2026-11-09T14-08-36', assessment_type: 'application', passes: 14 });
      expect((lines[0]!.context?.['legs'] as unknown[]).length).toBe(2);
      const hashDone = lines.find((l) => l.code === 'run.prepare.complete')!;
      expect(hashDone.context?.['source_files']).toBe(1); // only the subdir file
      expect(typeof hashDone.context?.['duration_ms']).toBe('number');
      // inputs hash prunes the clone: notes.md only.
      expect(hashDone.context?.['inputs_files']).toBe(1);
      const copyDone = lines.filter((l) => l.code === 'leg.prepare.complete');
      expect(copyDone).toHaveLength(2);
      expect(copyDone[0]!.context?.['files']).toBeGreaterThan(0);
      expect(copyDone[0]!.context?.['source_subdir']).toBe('apps/health/mono-app');
      expect(lines.some((l) => l.code === 'leg.prepare.start')).toBe(true);
      expect(statusLines.some((l) => typeof l === 'string' && l.includes('preparing the leg workspace'))).toBe(true);
      expect(result.status).toBe('complete');
      const done = lines[lines.length - 1]!;
      expect(done.code).toBe('run.complete');
      expect(done.context?.['status']).toBe('complete');
      expect(done.level).toBe('info');
    } finally {
      rmSync(mono.ws, { recursive: true, force: true });
    }
  });

  it('measures preparation with the subdir scope on a large monorepo fixture', async () => {
    // Before #4243 the leg copy took the whole clone (here 400 sibling files plus .git).
    const mono = makeMonorepoWs(400);
    try {
      const prepared = await prepareLegWorkspace({ workspaceRoot: mono.ws, appId: 'mono-app', legId: 'timing' });
      try {
        expect(prepared.stats.files).toBeLessThan(10);
        expect(prepared.duration_ms).toBeGreaterThanOrEqual(0);
      } finally {
        rmSync(prepared.path, { recursive: true, force: true });
      }
    } finally {
      rmSync(mono.ws, { recursive: true, force: true });
    }
  });

  it('a leg that exits 1 is failed: stderr tail stored and logged, workspace kept, no challenge, run failed', async () => {
    const mono = makeMonorepoWs(2);
    const keptPaths: string[] = [];
    try {
      let challengeCalls = 0;
      const result = await orchestrateLegs({
        ...base, workspaceRoot: mono.ws, legs: twoLegs,
        timestamp: () => '2026-11-09T20:05:00.000Z',
        spawnLeg: async (_leg, legWs) => {
          const logDir = join(legWs, 'apps', 'mono-app', 'wsp', 'logs');
          mkdirSync(logDir, { recursive: true });
          writeFileSync(join(logDir, 'app-events-2026-11.ndjson'), JSON.stringify({ ts: new Date().toISOString(), code: 'dynamic.start' }) + '\n', 'utf-8');
          return {
            exitCode: 1, durationMs: 5,
            outputTail: '[info] Pass 10 dynamic_analysis starting\n[error] --lz-source live: landing zone lz-prod has no usable live run\napi_key=' + FAKE_KEY + '\n',
          };
        },
        spawnChallenge: async () => { challengeCalls++; return { completed_at: '', agents: [], exit_code: 0 }; },
        spawnLzChallenge: async () => { challengeCalls++; return { completed_at: '', agents: [], exit_code: 0 }; },
      });
      for (const l of result.legs) if (l.workspace) keptPaths.push(l.workspace);
      expect(challengeCalls).toBe(0);
      expect(result.status).toBe('failed');
      expect(result.legs.map((l) => l.status)).toEqual(['failed', 'failed']);
      expect(result.legs[0]!.reason).toContain('no usable live run');
      expect(result.legs[0]!.last_phase).toBe('dynamic.start');
      // Workspace of a failed leg is kept and named.
      expect(result.legs[0]!.workspace && existsSync(result.legs[0]!.workspace)).toBe(true);
      // stderr tail stored (redacted).
      const stderrLog = readFileSync(join(result.runDir, 'calls', 'lc-a.stderr.log'), 'utf-8');
      expect(stderrLog).toContain('no usable live run');
      expect(stderrLog).not.toContain(FAKE_KEY);
      const lines = readRunLog(result.runDir);
      const failed = lines.find((l) => l.code === 'leg.failed')!;
      expect(failed.level).toBe('error');
      expect(failed.context?.['exit']).toBe(1);
      expect(failed.context?.['last_phase']).toBe('dynamic.start');
      expect(String(failed.context?.['stderr_tail'])).toContain('no usable live run');
      const complete = lines.find((l) => l.code === 'leg.complete')!;
      expect(complete.context?.['status']).toBe('failed');
      expect(complete.context?.['exit']).toBe(1);
      expect(complete.level).toBe('error');
      expect(lines.some((l) => l.code === 'leg.challenge.skip')).toBe(true);
      expect(lines.some((l) => l.code === 'leg.challenge.start')).toBe(false);
      // F-2 says the leg died before its first call, not "check the connector".
      const findingsYaml = readFileSync(join(result.runDir, 'findings.yaml'), 'utf-8');
      expect(findingsYaml).toContain('failed before its first call');
      expect(findingsYaml).not.toContain('check the connector configuration');
      const done = lines[lines.length - 1]!;
      expect(done.code).toBe('run.complete');
      expect(done.level).toBe('error');
      expect(done.context?.['status']).toBe('failed');
      const status = JSON.parse(readFileSync(join(result.runDir, 'status.json'), 'utf-8')) as { status: string };
      expect(status.status).toBe('failed');
      const pub = JSON.parse(readFileSync(join(result.runDir, 'comparison', 'publication-model.json'), 'utf-8')) as { run: { status: string; legs: Record<string, { status: string }> } };
      expect(pub.run.status).toBe('failed');
      expect(pub.run.legs['lc-a']!.status).toBe('failed');
    } finally {
      for (const p of keptPaths) rmSync(p, { recursive: true, force: true });
      rmSync(mono.ws, { recursive: true, force: true });
    }
  });

  it('one complete and one failed leg is partial; F-2 for a clean exit with no calls names the connector', async () => {
    const mono = makeMonorepoWs(2);
    try {
      const result = await orchestrateLegs({
        ...base, workspaceRoot: mono.ws, legs: twoLegs,
        timestamp: () => '2026-11-09T20:10:00.000Z',
        spawnLeg: async (leg, _ws2, env) => {
          if (leg.id === 'lc-a') appendFileSync(env[LEG_ENV.RECORD]!, JSON.stringify(syntheticRecord(leg.id, leg.connector, leg.model, '03-data', 100, 0.001)) + '\n');
          return { exitCode: 0, durationMs: 5 };
        },
      });
      for (const l of result.legs) if (l.workspace) rmSync(l.workspace, { recursive: true, force: true });
      expect(result.status).toBe('partial');
      expect(result.legs[1]!.status).toBe('failed');
      const findingsYaml = readFileSync(join(result.runDir, 'findings.yaml'), 'utf-8');
      expect(findingsYaml).toContain('check the connector configuration');
      const done = readRunLog(result.runDir).pop()!;
      expect(done.level).toBe('warn');
      expect(done.message).toContain('comparison is incomplete');
    } finally {
      rmSync(mono.ws, { recursive: true, force: true });
    }
  });

  it('leg.complete wall_clock_ms matches the leg interval; no heartbeat after leg.complete; run duration from run.start', async () => {
    const mono = makeMonorepoWs(2);
    const orig = process.env['SWAO_LEG_HEARTBEAT_MS'];
    process.env['SWAO_LEG_HEARTBEAT_MS'] = '20';
    try {
      const result = await orchestrateLegs({
        ...base, workspaceRoot: mono.ws, legs: twoLegs,
        timestamp: () => '2026-11-09T20:15:00.000Z',
        spawnLeg: async (leg, _ws2, env) => {
          await new Promise<void>((r) => setTimeout(r, 120));
          appendFileSync(env[LEG_ENV.RECORD]!, JSON.stringify(syntheticRecord(leg.id, leg.connector, leg.model, '03-data', 100, 0.001)) + '\n');
          return { exitCode: 0, durationMs: 1 }; // host-reported duration is NOT the leg wall clock
        },
      });
      await new Promise<void>((r) => setTimeout(r, 100));
      const lines = readRunLog(result.runDir);
      for (const id of ['lc-a', 'lc-b']) {
        const start = lines.find((l) => l.code === 'leg.start' && l.context?.['leg_id'] === id)!;
        const doneIdx = lines.findIndex((l) => l.code === 'leg.complete' && l.context?.['leg_id'] === id);
        const done = lines[doneIdx]!;
        const interval = Date.parse(done.ts) - Date.parse(start.ts);
        expect(Math.abs(Number(done.context?.['wall_clock_ms']) - interval)).toBeLessThan(1000);
        expect(Number(done.context?.['wall_clock_ms'])).toBeGreaterThanOrEqual(100);
        expect(lines.slice(doneIdx + 1).some((l) => l.code === 'leg.heartbeat' && l.context?.['leg_id'] === id)).toBe(false);
      }
      expect(lines.some((l) => l.code === 'leg.heartbeat')).toBe(true);
      const runStart = lines.find((l) => l.code === 'run.start')!;
      const runDone = lines.find((l) => l.code === 'run.complete')!;
      const runInterval = Date.parse(runDone.ts) - Date.parse(runStart.ts);
      expect(Math.abs(Number(runDone.context?.['duration_ms']) - runInterval)).toBeLessThan(1000);
    } finally {
      if (orig === undefined) delete process.env['SWAO_LEG_HEARTBEAT_MS']; else process.env['SWAO_LEG_HEARTBEAT_MS'] = orig;
      rmSync(mono.ws, { recursive: true, force: true });
    }
  });

  it('abort cancels the running leg, skips the next one and marks the run folder cancelled', async () => {
    const mono = makeMonorepoWs(2);
    try {
      const ac = new AbortController();
      const spawned: string[] = [];
      const result = await orchestrateLegs({
        ...base, workspaceRoot: mono.ws, legs: twoLegs,
        timestamp: () => '2026-11-09T20:20:00.000Z',
        signal: ac.signal,
        spawnLeg: (leg, _ws2, _env, signal) => new Promise((resolve) => {
          spawned.push(leg.id);
          // The host kills its child on abort; here the child never ends otherwise.
          signal?.addEventListener('abort', () => resolve({ exitCode: null, durationMs: 1 }));
          setTimeout(() => ac.abort(), 30);
        }),
      });
      expect(spawned).toEqual(['lc-a']);
      expect(result.status).toBe('cancelled');
      expect(result.legs.map((l) => l.status)).toEqual(['cancelled', 'cancelled']);
      const lines = readRunLog(result.runDir);
      expect(lines.some((l) => l.code === 'run.cancelled')).toBe(true);
      const status = JSON.parse(readFileSync(join(result.runDir, 'status.json'), 'utf-8')) as { status: string };
      expect(status.status).toBe('cancelled');
      expect(lines.pop()!.context?.['status']).toBe('cancelled');
    } finally {
      rmSync(mono.ws, { recursive: true, force: true });
    }
  });

  it('a failed preflightLeg ends the leg before any copy (hook for #4244)', async () => {
    const mono = makeMonorepoWs(2);
    try {
      const spawned: string[] = [];
      const result = await orchestrateLegs({
        ...base, workspaceRoot: mono.ws, legs: twoLegs,
        timestamp: () => '2026-11-09T20:25:00.000Z',
        preflightLeg: (leg) => (leg.id === 'lc-a' ? { ok: false, reason: 'no usable live run' } : { ok: true }),
        spawnLeg: async (leg, _ws2, env) => {
          spawned.push(leg.id);
          appendFileSync(env[LEG_ENV.RECORD]!, JSON.stringify(syntheticRecord(leg.id, leg.connector, leg.model, '03-data', 100, 0.001)) + '\n');
          return { exitCode: 0, durationMs: 5 };
        },
      });
      expect(spawned).toEqual(['lc-b']);
      expect(result.legs[0]!.status).toBe('failed');
      expect(result.legs[0]!.reason).toContain('preflight failed: no usable live run');
      const lines = readRunLog(result.runDir);
      expect(lines.some((l) => l.code === 'leg.preflight.failed')).toBe(true);
      expect(lines.filter((l) => l.code === 'leg.prepare.start' && l.context?.['leg_id'] === 'lc-a')).toHaveLength(0);
      expect(lines.filter((l) => l.code === 'leg.complete')).toHaveLength(2);
      expect(result.status).toBe('partial');
    } finally {
      rmSync(mono.ws, { recursive: true, force: true });
    }
  });

  it('relays dynamic.skip and dynamic.vision events from the leg (#1997 guard)', async () => {
    const mono = makeMonorepoWs(2);
    try {
      const runStart = '2026-11-09T20:30:00.000Z';
      const now = new Date();
      const monthSlug = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      await orchestrateLegs({
        ...base, workspaceRoot: mono.ws, legs: twoLegs,
        timestamp: () => runStart,
        spawnLeg: async (leg, legWs, env) => {
          appendFileSync(env[LEG_ENV.RECORD]!, JSON.stringify(syntheticRecord(leg.id, leg.connector, leg.model, '03-data', 100, 0.001)) + '\n');
          const logDir = join(legWs, 'apps', 'mono-app', 'wsp', 'logs');
          mkdirSync(logDir, { recursive: true });
          const code = leg.id === 'lc-a' ? 'dynamic.skip' : 'dynamic.vision.complete';
          writeFileSync(join(logDir, `app-events-${monthSlug}.ndjson`), JSON.stringify({ ts: new Date().toISOString(), code }) + '\n', 'utf-8');
          return { exitCode: 0, durationMs: 5 };
        },
      });
      const mainLog = readFileSync(join(mono.ws, 'apps', 'mono-app', 'wsp', 'logs', `app-events-${monthSlug}.ndjson`), 'utf-8');
      expect(mainLog).toContain('"code":"dynamic.skip"');
      expect(mainLog).toContain('"code":"dynamic.vision.complete"');
    } finally {
      rmSync(mono.ws, { recursive: true, force: true });
    }
  });
});
