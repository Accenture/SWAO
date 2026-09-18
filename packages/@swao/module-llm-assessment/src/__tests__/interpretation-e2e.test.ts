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

// Interpretation wiring end-to-end tests -- L6 (#1433).
//
// Covers OrchestratorDeps.interpretation wiring in orchestrateLegs():
//   1. When interpretation:true and a connector is provided, connector.generate()
//      is called and the returned narrative is written into publication-model.json
//      (#1431).
//   2. Connector failure is swallowed: the run still completes and
//      publication-model.json is written without a narrative field.
//   3. When interpretation is falsy the connector is never called.
//   4. When interpretation:true but no connector provided, run completes silently.
//
// NOTE: tier-gate-first and precondition tests are in manifest.test.ts.
//       Publication-tier Consultant gate is in @swao/module-html-report/src/commands/
//       publish.ts; it rides the same shared requireTier() pattern exercised by
//       the manifest.test.ts gate tests -- no separate subprocess test needed.
// NOTE: extractLlmAssessmentPublicationModel extractor tests live in
//       @swao/module-html-report/src/publish/llm-renderer.test.ts (the extractor
//       is in @swao/publication-render, which is not a dep of this module).

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { orchestrateLegs } from '../orchestrator.js';
import type { OrchestratorDeps, ResolvedLeg } from '../orchestrator.js';
import type { CallRecord } from '../call-record.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeCallRecord(legId: string): CallRecord {
  return {
    leg: { id: legId, connector: 'test', model: 'test-model' },
    pass_id: '01-signals',
    call_site: 'site-01',
    call_index: 0,
    prompt: { sha256: 'aabbcc', chars: 200, tokens_est: 100, size_bucket: 'S' },
    timing: { started: '2026-08-06T10:00:00.000Z', total_ms: 150 },
    tokens: { prompt: 100, completion: 80 },
    cost_usd: { computed: 0.0005, source: 'billed' },
    quality: { parse_valid: true, schema_conform: true, truncated: false, refusal_detected: false },
    reliability: { retries: 0, rate_limited: false, dnf: false },
    security: { redaction_marker_altered: false, foreign_path_count: 0, pii_reproduction_detected: false, prompt_injection_detected: false },
  };
}

const LEGS: ResolvedLeg[] = [
  { id: 'leg-a', connector: 'openai',    model: 'gpt-4o',                   primary: true,  costSource: 'billed' },
  { id: 'leg-b', connector: 'anthropic', model: 'claude-3-5-sonnet-20241022', primary: false, costSource: 'billed' },
];

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'swao-tier-e2e-'));
  // Create app dir (hashDirectory handles missing/empty gracefully)
  mkdirSync(join(tmpRoot, 'apps', 'test-app', 'wsp', 'inputs'), { recursive: true });
});

afterAll(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

function makeDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  return {
    workspaceRoot: tmpRoot,
    appId: 'test-app',
    legs: LEGS,
    execution: 'serial',
    repeat: 1,
    weights: { quality: 0.4, performance: 0.3, cost: 0.15, reliability: 0.15 },
    keepLegWsp: false,
    passSuiteVersion: 'test-1.0',
    // spawnLeg writes a single valid call record to the sink and returns ok.
    spawnLeg: async (leg, _legWorkspaceRoot, env) => {
      const sinkPath = env['SWAO_LLM_ASSESSMENT_RECORD'] as string;
      if (sinkPath) {
        const record = makeCallRecord(leg.id);
        writeFileSync(sinkPath, JSON.stringify(record) + '\n', 'utf-8');
      }
      return { exitCode: 0, durationMs: 150 };
    },
    timestamp: () => '2026-08-06T11-00-00',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. interpretation:true -- connector is called, narrative in model
// ---------------------------------------------------------------------------

describe('orchestrateLegs interpretation wiring (#1431)', () => {
  it('calls connector.generate() when interpretation:true and writes narrative', async () => {
    const generate = vi.fn().mockResolvedValue('GPT-4o leads on latency; Claude leads on quality.');
    const deps = makeDeps({
      interpretation: true,
      interpretationConnector: { generate },
    });

    const result = await orchestrateLegs(deps);

    expect(generate).toHaveBeenCalledOnce();
    // The prompt passed to generate should mention the app id
    const promptArg = generate.mock.calls[0]?.[0] as string;
    expect(promptArg).toContain('test-app');

    // publication-model.json must contain the narrative
    const pubModel = JSON.parse(
      readFileSync(join(result.runDir, 'comparison', 'publication-model.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(pubModel['narrative']).toBe('GPT-4o leads on latency; Claude leads on quality.');
  }, 30000);

  it('swallows connector failure and writes model without narrative', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('connector timeout'));
    const deps = makeDeps({
      interpretation: true,
      interpretationConnector: { generate },
    });

    const result = await orchestrateLegs(deps);

    expect(generate).toHaveBeenCalledOnce();
    const pubModel = JSON.parse(
      readFileSync(join(result.runDir, 'comparison', 'publication-model.json'), 'utf-8'),
    ) as Record<string, unknown>;
    // narrative must be absent when connector threw
    expect(pubModel['narrative']).toBeUndefined();
    // run must still have completed normally
    expect(result.findingsCount).toBeGreaterThanOrEqual(0);
  }, 30000);

  it('does not call connector when interpretation is falsy', async () => {
    const generate = vi.fn().mockResolvedValue('should not be called');
    const deps = makeDeps({
      interpretation: false,
      interpretationConnector: { generate },
    });

    const result = await orchestrateLegs(deps);

    expect(generate).not.toHaveBeenCalled();
    const pubModel = JSON.parse(
      readFileSync(join(result.runDir, 'comparison', 'publication-model.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(pubModel['narrative']).toBeUndefined();
  }, 30000);

  it('does not call connector when interpretation:true but no connector provided', async () => {
    // Should complete without error even if interpretation is true but connector is absent
    const deps = makeDeps({ interpretation: true });
    const result = await orchestrateLegs(deps);

    const pubModel = JSON.parse(
      readFileSync(join(result.runDir, 'comparison', 'publication-model.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(pubModel['narrative']).toBeUndefined();
    expect(existsSync(result.runDir)).toBe(true);
  }, 30000);
});
