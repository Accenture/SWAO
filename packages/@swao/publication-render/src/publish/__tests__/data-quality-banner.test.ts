// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import {
  evaluateDataQuality,
  buildDataQualityBannerHtml,
  buildDataQualityFlagsString,
} from '../data-quality-banner.js';
import type { RunManifest } from '@swao/core';

// #0475 (C-18) -- data quality banner tests.

const cleanManifest: RunManifest = {
  schema_version: '1.4',
  run_id: 'test-run',
  app: 'test-app',
  iter: 1,
  assessed_at: '2026-06-03T10:00:00Z',
  started_at: '2026-06-03T10:00:00.000Z',
  finished_at: '2026-06-03T10:01:00.000Z',
  duration_ms: 60000,
  passes_executed: ['context_ingestion'],
  total_signals_emitted: 0,
  pass_stats: [],
  llm: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  provenance: {
    temperature: 0,
    cassette_hits: [],
    placeholder_inputs: [],
    false_positive_flags: 0,
    lzr_input_type: 'none',
    crawl_type: 'none',
    swao_version: '0.2.3',
  },
};

describe('evaluateDataQuality (#0475)', () => {
  it('returns empty for a clean run (real LLM, temp=0, no placeholders)', () => {
    expect(evaluateDataQuality(cleanManifest)).toHaveLength(0);
  });

  it('returns null-safe (no manifest)', () => {
    expect(evaluateDataQuality(null)).toHaveLength(0);
  });

  it('flags stub provider as error', () => {
    const m: RunManifest = { ...cleanManifest, llm: { provider: 'stub' } };
    const conditions = evaluateDataQuality(m);
    expect(conditions.some((c) => c.severity === 'error' && c.message.includes('stub'))).toBe(true);
  });

  it('flags non-zero temperature as warn', () => {
    const m: RunManifest = {
      ...cleanManifest,
      provenance: { ...cleanManifest.provenance!, temperature: 0.7 },
    };
    const conditions = evaluateDataQuality(m);
    expect(conditions.some((c) => c.message.includes('Temperature'))).toBe(true);
  });

  it('flags placeholder inputs as warn', () => {
    const m: RunManifest = {
      ...cleanManifest,
      provenance: {
        ...cleanManifest.provenance!,
        placeholder_inputs: ['workshops/workshop-sample.md'],
      },
    };
    const conditions = evaluateDataQuality(m);
    expect(conditions.some((c) => c.message.includes('placeholder'))).toBe(true);
  });

  it('flags false positive flags as warn', () => {
    const m: RunManifest = {
      ...cleanManifest,
      provenance: { ...cleanManifest.provenance!, false_positive_flags: 2 },
    };
    const conditions = evaluateDataQuality(m);
    expect(conditions.some((c) => c.message.includes('hallucination'))).toBe(true);
  });

  it('flags LLM-skipped passes as warn naming each pass (#0550)', () => {
    const m: RunManifest = {
      ...cleanManifest,
      llm: undefined,
      provenance: {
        ...cleanManifest.provenance!,
        llm_skipped_passes: ['data_classification', 'context_ingestion', 'synthesis'],
      },
    };
    const conditions = evaluateDataQuality(m);
    const skip = conditions.find((c) => c.message.includes('LLM passes skipped'));
    expect(skip).toBeDefined();
    expect(skip!.severity).toBe('warn');
    expect(skip!.message).toContain('data_classification');
    expect(skip!.message).toContain('no_llm_provider');
  });

  it('does not flag LLM-skipped passes when none were skipped', () => {
    expect(evaluateDataQuality(cleanManifest).some((c) => c.message.includes('LLM passes skipped'))).toBe(false);
  });

  it('flags stale LZR snapshot (>7 days) as warn', () => {
    const m: RunManifest = {
      ...cleanManifest,
      provenance: { ...cleanManifest.provenance!, lzr_snapshot_age_days: 10, lzr_input_type: 'snapshot' },
    };
    const conditions = evaluateDataQuality(m);
    expect(conditions.some((c) => c.message.includes('days old'))).toBe(true);
  });

  it('does not flag fresh LZR snapshot (<=7 days)', () => {
    const m: RunManifest = {
      ...cleanManifest,
      provenance: { ...cleanManifest.provenance!, lzr_snapshot_age_days: 3, lzr_input_type: 'snapshot' },
    };
    expect(evaluateDataQuality(m)).toHaveLength(0);
  });

  it('flags fabricated LZR snapshot as warn', () => {
    const m: RunManifest = {
      ...cleanManifest,
      provenance: { ...cleanManifest.provenance!, lzr_snapshot_fabricated: true, lzr_input_type: 'snapshot' },
    };
    const conditions = evaluateDataQuality(m);
    expect(conditions.some((c) => c.message.includes('fabricated'))).toBe(true);
  });
});

describe('buildDataQualityBannerHtml (#0475)', () => {
  it('returns empty string for clean run', () => {
    expect(buildDataQualityBannerHtml([])).toBe('');
  });

  it('renders a visible banner with [DATA QUALITY WARNING] for stub run', () => {
    const m: RunManifest = { ...cleanManifest, llm: { provider: 'stub' } };
    const conditions = evaluateDataQuality(m);
    const html = buildDataQualityBannerHtml(conditions);
    expect(html).toContain('[DATA QUALITY WARNING]');
    expect(html).toContain('stub');
    expect(html).toContain('role="alert"');
  });

  it('renders warn styling for temperature warning (no error)', () => {
    const m: RunManifest = {
      ...cleanManifest,
      provenance: { ...cleanManifest.provenance!, temperature: 0.5 },
    };
    const conditions = evaluateDataQuality(m);
    const html = buildDataQualityBannerHtml(conditions);
    expect(html).toContain('Temperature');
  });

  it('renders clickable signal links when signal_ids are provided', () => {
    const html = buildDataQualityBannerHtml([{
      severity: 'warn',
      message: 'Possible hallucinations: 2 signal(s) flagged -- evidence file not found',
      signal_ids: ['SIG-01', 'SIG-02'],
    }]);
    expect(html).toContain('href="#signal-SIG-01"');
    expect(html).toContain('href="#signal-SIG-02"');
    expect(html).toContain('SIG-01');
  });

  it('includes derivation tooltip on signal links when signal_derivations provided', () => {
    const html = buildDataQualityBannerHtml([{
      severity: 'warn',
      message: 'Possible hallucinations: 1 signal(s) flagged -- evidence file not found',
      signal_ids: ['SIG-01'],
      signal_derivations: { 'SIG-01': 'Referenced evidence file not found on disk' },
    }]);
    expect(html).toContain('title="Referenced evidence file not found on disk"');
    expect(html).toContain('href="#signal-SIG-01"');
  });
});

describe('buildDataQualityFlagsString (#0475 BI export)', () => {
  it('returns empty string for clean run', () => {
    expect(buildDataQualityFlagsString([])).toBe('');
  });

  it('returns comma-separated flags for multiple conditions', () => {
    const m: RunManifest = { ...cleanManifest, llm: { provider: 'stub' } };
    const conditions = evaluateDataQuality(m);
    const flags = buildDataQualityFlagsString(conditions);
    expect(flags.length).toBeGreaterThan(0);
    expect(flags).toContain('llm');
  });
});
