// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { load } from 'js-yaml';
import { runInvPass } from '../passes/index.js';
import { runStatePass } from '../passes/index.js';
import { runDataPass } from '../passes/index.js';
import { runCtxPass } from '../passes/index.js';
import { runSbomPass } from '../passes/index.js';
import { runTfPass } from '../passes/index.js';
import { runEgrPass } from '../passes/index.js';
import { runCryptoPass } from '../passes/index.js';
import { FixedLlmProvider } from '@swao/module-llm-providers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_SOURCE = join(__dirname, '../passes/fixtures/source');
const FIXTURES_WORKSPACE = join(__dirname, '../passes/fixtures/workspace');
const FIXTURES_LLM_STUBS = join(__dirname, '../passes/fixtures/llm-stubs');
const EXAMPLES_APPS = join(__dirname, '../../../../../examples/portfolio-workspace/portfolio/apps');

function loadStubFixture(appId: string, passName: string): string {
  const p = join(FIXTURES_LLM_STUBS, appId, `${passName}.json`);
  return existsSync(p) ? readFileSync(p, 'utf-8') : '{"signals":[],"assessment":{}}';
}
const NOW = '2026-04-28';
const ITER = 1;

// Only prefixes implemented by the engine (Passes 1-8)
const ENGINE_PASS_PREFIXES = new Set(['INV', 'STATE', 'DATA', 'CTX', 'SBOM', 'TF', 'EGR', 'CRYPTO']);

function sourceCtx(appId: string) {
  return {
    appId,
    sourcePath: join(FIXTURES_SOURCE, appId),
    workspacePath: join(FIXTURES_WORKSPACE, appId),
    iter: ITER,
    assessedAt: NOW,
  };
}

async function runAllPasses(appId: string): Promise<Array<{ id: string }>> {
  const ctx = sourceCtx(appId);
  const llmData = { llm: new FixedLlmProvider(loadStubFixture(appId, 'data')) };
  const llmCtx = { llm: new FixedLlmProvider(loadStubFixture(appId, 'ctx')) };

  const [inv, state, data, ctx4, sbom, tf, egr, crypto] = await Promise.all([
    runInvPass(ctx),
    runStatePass(ctx),
    runDataPass({ ...ctx, ...llmData }),
    runCtxPass({ ...ctx, ...llmCtx }),
    runSbomPass(ctx),
    runTfPass(ctx),
    runEgrPass(ctx),
    runCryptoPass(ctx),
  ]);

  return [inv, state, data, ctx4, sbom, tf, egr, crypto].flatMap(r => r.signals);
}

function loadWozSignalIds(appId: string): Set<string> {
  const wozDir = join(EXAMPLES_APPS, appId, 'wsp', 'passes');
  if (!existsSync(wozDir)) return new Set();

  const files = readdirSync(wozDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  const ids = new Set<string>();

  for (const file of files) {
    const raw = readFileSync(join(wozDir, file), 'utf-8');
    const parsed = load(raw) as { signals?: Array<{ id: string }> } | null;
    if (!parsed?.signals) continue;
    for (const s of parsed.signals) {
      const prefix = s.id?.split('-')[0];
      if (prefix && ENGINE_PASS_PREFIXES.has(prefix)) {
        ids.add(s.id);
      }
    }
  }

  return ids;
}

const FIXTURES = ['ghostfolio', 'medplum', 'sovereign-health'] as const;

for (const appId of FIXTURES) {
  describe(`WoZ benchmark -- ${appId}`, () => {
    it('engine signal ID set matches regression baseline (snapshot)', async () => {
      const signals = await runAllPasses(appId);
      const sortedIds = [...new Set(signals.map(s => s.id))].sort();
      expect(sortedIds).toMatchSnapshot();
    }, 30000);

    it('logs WoZ coverage gaps (WOZ_NOT_YET_COVERED / ENGINE_BEYOND_WOZ)', async () => {
      const signals = await runAllPasses(appId);
      const engineIds = new Set(signals.map(s => s.id));
      const wozIds = loadWozSignalIds(appId);

      const notYetInEngine = [...wozIds].filter(id => !engineIds.has(id)).sort();
      const engineBeyondWoz = [...engineIds].filter(id => !wozIds.has(id)).sort();

      for (const id of notYetInEngine) {
        console.log(`MISSING FROM ENGINE: ${id} (${appId})`);
      }
      if (engineBeyondWoz.length > 0) {
        console.log(`ENGINE_BEYOND_WOZ (${appId}): ${engineBeyondWoz.join(', ')}`);
      }

      const covered = [...wozIds].filter(id => engineIds.has(id)).length;
      const coveragePct = wozIds.size > 0 ? Math.round((covered / wozIds.size) * 100) : 100;
      console.log(`WoZ coverage (${appId}): ${coveragePct}% (${covered}/${wozIds.size} engine-prefix signals covered)`);

      expect(true).toBe(true);
    }, 30000);
  });
}
