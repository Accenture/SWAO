// #4277: a leg challenge never touches the real app folder.
//
// The fake challenge spawners behave like `swao challenge` started with
// cwd = the root they are given: they write challenge-app/combined.yaml and
// challenge-lz/<ts>/LZCA_*.yaml under that root. After a two-leg run the
// main app's challenge-app/ and challenge-lz/ must be byte-identical, and
// the leg outputs must sit under llm-assessments/swao/<run>/challenge/<leg>/.

import { describe, it, expect } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { orchestrateLegs, type ResolvedLeg, type LegChallengeContext } from './orchestrator.js';
import { LEG_ENV } from './leg-recorder.js';
import { sizeBucket } from './call-record.js';

function record(legId: string, passId: string): string {
  return JSON.stringify({
    leg: { id: legId, connector: 'c', model: 'm' },
    pass_id: passId, call_site: 'site', call_index: 0,
    prompt: { sha256: 'p', chars: 400, tokens_est: 100, size_bucket: sizeBucket(100) },
    timing: { started: '2026-11-09T12:00:00Z', total_ms: 100 },
    tokens: { prompt: 100, completion: 30 },
    cost_usd: { computed: 0.01, source: 'billed' },
    quality: { parse_valid: true, schema_conform: true, truncated: false, refusal_detected: false },
    reliability: { retries: 0, rate_limited: false, dnf: false },
    security: { redaction_marker_altered: false, foreign_path_count: 0, pii_reproduction_detected: false, prompt_injection_detected: false },
    response_sha256: 'r',
  }) + '\n';
}

/** sha256 over every file (relative path + bytes) under dir; '' when absent. */
function treeDigest(dir: string): string {
  if (!existsSync(dir)) return '';
  const h = createHash('sha256');
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else { h.update(relative(dir, abs)); h.update(readFileSync(abs)); }
    }
  };
  walk(dir);
  return h.digest('hex');
}

describe('leg challenge isolation (#4277)', () => {
  it('two legs: apps/<app>/wsp/challenge-app and challenge-lz stay byte-identical; outputs go to the run folder', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-4277-'));
    try {
      writeFileSync(join(ws, '.swao.yml'), 'workspace: {}\n', 'utf-8');
      const app = join(ws, 'apps', 'demo-app');
      mkdirSync(join(app, 'src'), { recursive: true });
      writeFileSync(join(app, 'src', 'main.ts'), 'export const x = 1;\n', 'utf-8');
      // The owner's main runs and challenges.
      const appRun = '2026-11-09T14-08-36';
      const lzRun = '2026-11-09T16-06-46';
      mkdirSync(join(app, 'wsp', 'runs', appRun), { recursive: true });
      writeFileSync(join(app, 'wsp', 'runs', appRun, 'wsp.yaml'), 'overall: {}\n', 'utf-8');
      mkdirSync(join(app, 'wsp', 'runs', lzRun, 'passes'), { recursive: true });
      writeFileSync(join(app, 'wsp', 'runs', lzRun, 'passes', 'lz-fit.yaml'), 'fit: {}\n', 'utf-8');
      writeFileSync(join(app, 'wsp', 'latest-landing-zone-catalog.txt'), `runs/${lzRun}`, 'utf-8');
      mkdirSync(join(app, 'wsp', 'challenge-app', '2026-11-09T14-14-10'), { recursive: true });
      writeFileSync(join(app, 'wsp', 'challenge-app', 'combined.yaml'), 'assessed_at: owner\n', 'utf-8');
      writeFileSync(join(app, 'wsp', 'challenge-app', '2026-11-09T14-14-10', 'AA_cto.yaml'), 'agent_id: cto\n', 'utf-8');
      mkdirSync(join(app, 'wsp', 'challenge-lz', '2026-11-09T16-11-31'), { recursive: true });
      writeFileSync(join(app, 'wsp', 'challenge-lz', '2026-11-09T16-11-31', 'LZCA_lzca-ciso-security.yaml'), 'x: 1\n', 'utf-8');
      const before = { app: treeDigest(join(app, 'wsp', 'challenge-app')), lz: treeDigest(join(app, 'wsp', 'challenge-lz')) };

      const legs: ResolvedLeg[] = [
        { id: 'anthropic--model-a', connector: 'anthropic', model: 'model-a', primary: true, costSource: 'billed' },
        { id: 'openrouter--model-b', connector: 'openrouter', model: 'model-b', primary: false, costSource: 'billed' },
      ];
      const seen: Array<{ kind: string; root: string; ctx: LegChallengeContext; runPresent: boolean; refStaged: boolean }> = [];
      // #4291: each leg writes its own application run (the leg copy has no wsp/runs).
      const legRun = '2026-11-09T21-00-10';
      const result = await orchestrateLegs({
        workspaceRoot: ws, appId: 'demo-app', legs,
        execution: 'serial', repeat: 1, weights: { quality: 1 }, keepLegWsp: false, passSuiteVersion: 'v158',
        timestamp: () => '2026-11-09T21:00:00.000Z',
        suiteRun: { runTs: appRun, assessmentType: 'application', passCount: 14 },
        spawnLeg: async (leg, legWs, env) => {
          mkdirSync(join(legWs, 'apps', 'demo-app', 'wsp', 'runs', legRun), { recursive: true });
          writeFileSync(join(legWs, 'apps', 'demo-app', 'wsp', 'runs', legRun, 'wsp.yaml'), `leg: ${leg.id}\n`, 'utf-8');
          appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, '03-data'));
          return { exitCode: 0, durationMs: 5 };
        },
        spawnChallenge: async (leg, legWs, env, ctx) => {
          const wsp = join(legWs, 'apps', 'demo-app', 'wsp');
          seen.push({ kind: 'app', root: legWs, ctx, runPresent: existsSync(join(wsp, 'runs', ctx.runId ?? 'none', 'wsp.yaml')), refStaged: existsSync(join(wsp, 'runs', appRun)) });
          mkdirSync(join(wsp, 'challenge-app'), { recursive: true });
          writeFileSync(join(wsp, 'challenge-app', 'combined.yaml'), `assessed_at: ${leg.id}\n`, 'utf-8');
          appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, 'challenge-cto'));
          return { completed_at: '', agents: [{ agent_id: 'cto', calls: 1, dnf: false, duration_ms: 1 }], exit_code: 0 };
        },
        spawnLzChallenge: async (leg, legWs, env, ctx) => {
          const wsp = join(legWs, 'apps', 'demo-app', 'wsp');
          seen.push({ kind: 'lz', root: legWs, ctx, runPresent: existsSync(join(wsp, 'runs', ctx.runId ?? 'none', 'passes', 'lz-fit.yaml')), refStaged: existsSync(join(wsp, 'runs', appRun)) });
          mkdirSync(join(wsp, 'challenge-lz', '2026-11-09T21-00-30'), { recursive: true });
          writeFileSync(join(wsp, 'challenge-lz', '2026-11-09T21-00-30', 'LZCA_lzca-ciso-security.yaml'), `leg: ${leg.id}\n`, 'utf-8');
          appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, 'challenge-lz-lzca-ciso-security'));
          return { completed_at: '', agents: [{ agent_id: 'lzca-ciso-security', calls: 1, dnf: false, duration_ms: 1 }], exit_code: 0 };
        },
      });

      // The real app folder is untouched.
      expect(treeDigest(join(app, 'wsp', 'challenge-app'))).toBe(before.app);
      expect(treeDigest(join(app, 'wsp', 'challenge-lz'))).toBe(before.lz);
      expect(readdirSync(join(app, 'wsp', 'challenge-lz'))).toEqual(['2026-11-09T16-11-31']);

      // Each challenge ran in its leg workspace: the stakeholder challenge on
      // the leg's own run (#4291), the LZ challenge on the staged LZ run.
      expect(seen).toHaveLength(4);
      for (const s of seen) {
        expect(s.root.startsWith(ws)).toBe(false);
        expect(s.ctx.llmRunId).toBe('2026-11-09T21-00-00');
        expect(s.runPresent).toBe(true);
      }
      expect(seen.filter((s) => s.kind === 'app').every((s) => s.ctx.runId === legRun)).toBe(true);
      // #4291: the main workspace's reference application run is never staged.
      expect(seen.every((s) => !s.refStaged)).toBe(true);
      expect(seen.filter((s) => s.kind === 'lz').every((s) => s.ctx.runId === lzRun)).toBe(true);

      // Outputs kept per leg in the LLM run folder.
      for (const id of ['anthropic--model-a', 'openrouter--model-b']) {
        const dir = join(result.runDir, 'challenge', id);
        expect(readFileSync(join(dir, 'app', 'combined.yaml'), 'utf-8')).toContain(id);
        expect(readFileSync(join(dir, 'lz', '2026-11-09T21-00-30', 'LZCA_lzca-ciso-security.yaml'), 'utf-8')).toContain(id);
      }

      // Challenge events carry leg_id and llm_run_id.
      const lines = readFileSync(join(result.runDir, 'log.ndjson'), 'utf-8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as { code: string; context?: Record<string, unknown> });
      // #4291: leg.challenge.start names the leg's own run, not the reference run.
      expect(lines.filter((l) => l.code === 'leg.challenge.start').map((l) => l.context?.['challenged_run'])).toEqual([legRun, legRun]);
      for (const code of ['leg.challenge.start', 'leg.challenge.complete', 'leg.challenge-lz.start', 'leg.challenge-lz.complete']) {
        const evs = lines.filter((l) => l.code === code);
        expect(evs).toHaveLength(2);
        for (const e of evs) {
          expect(typeof e.context?.['leg_id']).toBe('string');
          expect(e.context?.['llm_run_id']).toBe('2026-11-09T21-00-00');
        }
      }
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
