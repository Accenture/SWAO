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
import { DataSourceSchema } from '../../schema/wsp-pass.js';
import { RunManifestSchema } from '../../schema/run-manifest.js';

// #0474 -- C-16 / C-17: data_source block in pass YAMLs + run-manifest provenance.

describe('DataSourceSchema (C-16)', () => {
  it('accepts a full data_source block', () => {
    const ds = {
      llm_provider: 'anthropic',
      llm_model: 'claude-sonnet-4-6',
      llm_temperature: 0,
      llm_seed: null,
      cassette_hit: false,
      placeholder_inputs: [],
      false_positive_flags: 0,
      assessed_at: '2026-06-03T10:00:00Z',
    };
    expect(() => DataSourceSchema.parse(ds)).not.toThrow();
  });

  it('accepts data_source with cassette_hit: true and placeholder_inputs', () => {
    const ds = {
      llm_provider: 'openai',
      llm_model: 'gpt-5',
      llm_temperature: 0,
      llm_seed: 42,
      cassette_hit: true,
      placeholder_inputs: ['workshops/workshop-sample.md'],
      false_positive_flags: 2,
      assessed_at: '2026-06-03T10:00:00Z',
    };
    const result = DataSourceSchema.parse(ds);
    expect(result.cassette_hit).toBe(true);
    expect(result.placeholder_inputs).toHaveLength(1);
    expect(result.false_positive_flags).toBe(2);
  });

  it('rejects a data_source block missing required fields', () => {
    expect(() => DataSourceSchema.parse({ llm_provider: 'anthropic' })).toThrow();
  });
});

describe('RunManifestSchema provenance block (C-17)', () => {
  const base = {
    schema_version: '1.4' as const,
    run_id: 'r-prov-test',
    app: 'test-app',
    iter: 1,
    assessed_at: '2026-06-03T10:00:00Z',
    started_at: '2026-06-03T10:00:00.000Z',
    finished_at: '2026-06-03T10:01:00.000Z',
    duration_ms: 60000,
    passes_executed: ['context_ingestion'],
    total_signals_emitted: 3,
    pass_stats: [
      { pass: 'context_ingestion', num: '04', wall_clock_ms: 12000, signals_emitted: 3 },
    ],
  };

  it('accepts v1.4 manifest with provenance block', () => {
    const manifest = {
      ...base,
      provenance: {
        temperature: 0,
        cassette_hits: [],
        placeholder_inputs: [],
        false_positive_flags: 0,
        lzr_input_type: 'none' as const,
        crawl_type: 'none' as const,
        swao_version: '0.2.3',
      },
    };
    expect(() => RunManifestSchema.parse(manifest)).not.toThrow();
  });

  it('provenance block is optional (back-compat with v1.3)', () => {
    const manifest = { ...base, schema_version: '1.3' as const };
    expect(() => RunManifestSchema.parse(manifest)).not.toThrow();
  });

  it('provenance captures cassette hits and placeholder inputs', () => {
    const manifest = {
      ...base,
      provenance: {
        temperature: 0,
        cassette_hits: ['context_ingestion', 'synthesis'],
        placeholder_inputs: ['workshops/workshop-sample.md'],
        false_positive_flags: 1,
        lzr_input_type: 'snapshot' as const,
        lzr_snapshot_file: 'wsp/inputs/terraform/lz-azure-snapshot.json',
        lzr_snapshot_age_days: 3,
        lzr_snapshot_fabricated: false,
        crawl_type: 'none' as const,
        swao_version: '0.2.3',
      },
    };
    const result = RunManifestSchema.parse(manifest);
    expect(result.provenance?.cassette_hits).toEqual(['context_ingestion', 'synthesis']);
    expect(result.provenance?.placeholder_inputs).toEqual(['workshops/workshop-sample.md']);
    expect(result.provenance?.false_positive_flags).toBe(1);
    expect(result.provenance?.lzr_input_type).toBe('snapshot');
  });

  it('rejects provenance with unknown lzr_input_type', () => {
    const manifest = {
      ...base,
      provenance: {
        temperature: 0,
        cassette_hits: [],
        placeholder_inputs: [],
        false_positive_flags: 0,
        lzr_input_type: 'unknown_type',
        crawl_type: 'none',
        swao_version: '0.2.3',
      },
    };
    expect(() => RunManifestSchema.parse(manifest)).toThrow();
  });
});
