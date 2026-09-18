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
import { RunManifestSchema, PassStatSchema } from '../schema/run-manifest.js';

const baseManifest = {
  schema_version: '1.1' as const,
  run_id: 'r-1',
  app: 'demo',
  iter: 1,
  assessed_at: '2026-05-09',
  started_at: '2026-05-09T13:00:00.000Z',
  finished_at: '2026-05-09T13:02:34.000Z',
  duration_ms: 154000,
  passes_executed: ['inventory', 'state_analysis'],
  total_signals_emitted: 32,
  pass_stats: [
    { pass: 'inventory', num: '01', wall_clock_ms: 2000, signals_emitted: 12 },
    { pass: 'state_analysis', num: '02', wall_clock_ms: 1500, signals_emitted: 9 },
  ],
};

describe('RunManifestSchema v1.2 (#0175 stretch)', () => {
  it('accepts a v1.1 manifest unchanged (back-compat)', () => {
    expect(RunManifestSchema.safeParse(baseManifest).success).toBe(true);
  });

  it('accepts a v1.2 manifest with the llm block populated', () => {
    const v12 = {
      ...baseManifest,
      schema_version: '1.2' as const,
      llm: {
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        total_tokens_in: 12_500,
        total_tokens_out: 4_200,
        total_cost_usd: 0.42,
        call_count: 3,
      },
    };
    expect(RunManifestSchema.safeParse(v12).success).toBe(true);
  });

  it('accepts a v1.2 manifest with llm.provider only (cost/tokens deferred to #0188)', () => {
    const v12 = {
      ...baseManifest,
      schema_version: '1.2' as const,
      llm: { provider: 'anthropic', model: 'claude-opus-4-7' },
    };
    expect(RunManifestSchema.safeParse(v12).success).toBe(true);
  });

  it('accepts the files_assessed block', () => {
    const v12 = {
      ...baseManifest,
      schema_version: '1.2' as const,
      files_assessed: { inventory_count: 12, source_files_total: 287, imports_files_total: 6 },
    };
    expect(RunManifestSchema.safeParse(v12).success).toBe(true);
  });

  it('rejects a negative cost_usd on a per-pass stat', () => {
    const stat = {
      pass: 'inventory',
      num: '01',
      wall_clock_ms: 2000,
      signals_emitted: 12,
      cost_usd: -1,
    };
    expect(PassStatSchema.safeParse(stat).success).toBe(false);
  });

  it('accepts per-pass tokens_in / tokens_out / cost_usd', () => {
    const stat = {
      pass: 'data_classification',
      num: '03',
      wall_clock_ms: 8500,
      signals_emitted: 6,
      tokens_in: 4200,
      tokens_out: 1100,
      cost_usd: 0.075,
    };
    expect(PassStatSchema.safeParse(stat).success).toBe(true);
  });

  it('rejects an invalid schema_version literal', () => {
    expect(
      RunManifestSchema.safeParse({ ...baseManifest, schema_version: '1.0' }).success,
    ).toBe(false);
  });

  it('llm and files_assessed are both optional in v1.2', () => {
    const v12 = { ...baseManifest, schema_version: '1.2' as const };
    expect(RunManifestSchema.safeParse(v12).success).toBe(true);
  });
});
