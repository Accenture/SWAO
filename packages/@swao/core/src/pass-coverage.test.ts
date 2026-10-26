// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import {
  PassNotRunReasonSchema,
  PassCoverageReasonSchema,
  passCoverageReasonLabel,
  PassNotRunEntrySchema,
  PassDegradedEntrySchema,
} from './pass-coverage.js';
import { RunManifestSchema } from './run-manifest.js';
import { evaluateDataQuality } from './data-quality.js';
import { RunStatusSchema, RUN_STATUS_SCHEMA_VERSION } from './run-status.js';
import { DEFAULT_PASS_PROFILE, CANONICAL_DEFAULT_PASS_KEYS, DEFAULT_PASS_NAMES, TOTAL_DEFAULT_PASSES } from './wsp-pass-profile.js';

const MANIFEST_15 = {
  schema_version: '1.5' as const,
  run_id: 'r1',
  app: 'sovereign-health',
  iter: 1,
  assessed_at: '2026-10-23',
  started_at: '2026-10-23T00:00:00Z',
  finished_at: '2026-10-23T00:01:00Z',
  duration_ms: 60000,
  passes_executed: ['inventory', 'compliance_evaluation'],
  total_signals_emitted: 0,
  pass_stats: [],
};

describe('pass coverage vocabulary (#3419 / #3436)', () => {
  it('every reason has a label, the publication vocabulary adds degraded', () => {
    for (const r of PassCoverageReasonSchema.options) {
      expect(passCoverageReasonLabel(r).length).toBeGreaterThan(0);
    }
    expect(PassCoverageReasonSchema.options).toEqual([...PassNotRunReasonSchema.options, 'degraded']);
    expect(passCoverageReasonLabel('degraded')).toBe('Not fully evaluated');
  });

  it('carries the reason codes the issue names', () => {
    for (const r of ['not_in_profile', 'skipped_by_flag', 'tool_missing', 'llm_unavailable']) {
      expect(PassNotRunReasonSchema.safeParse(r).success).toBe(true);
    }
    expect(PassNotRunEntrySchema.safeParse({ pass: 'secrets', reason: 'unknown_reason' }).success).toBe(false);
  });

  it('a degraded entry carries the affected regimes', () => {
    const e = PassDegradedEntrySchema.parse({ pass: 'comp', num: '11', name: 'compliance_evaluation', reason: 'llm_unavailable', regimes: [{ id: 'gdpr', controls_without_verdict: 6 }] });
    expect(e.regimes?.[0]?.controls_without_verdict).toBe(6);
  });
});

describe('run-manifest v1.6 fixture (#3419 / #3436, ADR-0012 additive)', () => {
  it('a v1.5 manifest without the new fields still parses', () => {
    expect(RunManifestSchema.safeParse(MANIFEST_15).success).toBe(true);
  });

  it('a v1.6 manifest with passes_not_run and passes_degraded parses', () => {
    const r = RunManifestSchema.safeParse({
      ...MANIFEST_15,
      schema_version: '1.6',
      passes_not_run: [
        { pass: 'secrets', num: '14', name: 'secret_scan', reason: 'not_in_profile' },
        { pass: 'ctx', reason: 'skipped_by_flag', detail: '--skip-llm' },
      ],
      passes_degraded: [{ pass: 'comp', num: '11', name: 'compliance_evaluation', reason: 'llm_unavailable', regimes: [{ id: 'gdpr', controls_without_verdict: 6 }] }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown reason code', () => {
    const r = RunManifestSchema.safeParse({ ...MANIFEST_15, schema_version: '1.6', passes_not_run: [{ pass: 'x', reason: 'because' }] });
    expect(r.success).toBe(false);
  });
});

describe('run-status 1.1 fixture (#3436)', () => {
  const base = {
    assessment_type: 'application' as const,
    app: 'a',
    run_id: 'r',
    status: 'partial' as const,
    started_at: '2026-10-23T00:00:00Z',
    swao_version: '1.4.1',
  };
  it('the writer version is 1.1 and 1.0 markers still parse', () => {
    expect(RUN_STATUS_SCHEMA_VERSION).toBe('1.1');
    expect(RunStatusSchema.safeParse({ ...base, schema_version: '1.0' }).success).toBe(true);
  });
  it('a 1.1 marker carries degraded_passes', () => {
    const r = RunStatusSchema.safeParse({
      ...base,
      schema_version: '1.1',
      degraded_passes: [{ pass: 'comp', reason: 'llm_unavailable', regimes: [{ id: 'gdpr', controls_without_verdict: 6 }] }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.degraded_passes?.[0]?.pass).toBe('comp');
  });
});

describe('data-quality banner conditions (#3419 / #3436)', () => {
  it('a degraded compliance pass raises "Compliance not fully evaluated" naming the frameworks', () => {
    const m = RunManifestSchema.parse({ ...MANIFEST_15, schema_version: '1.6', passes_degraded: [{ pass: 'comp', name: 'compliance_evaluation', reason: 'llm_unavailable', regimes: [{ id: 'gdpr', controls_without_verdict: 6 }] }] });
    const c = evaluateDataQuality(m);
    expect(c).toHaveLength(1);
    expect(c[0]!.severity).toBe('warn');
    expect(c[0]!.message).toMatch(/^Compliance not fully evaluated: gdpr \(6\)/);
  });

  it('a skipped secret scan or a missing tool is in the banner; an excluded crawl is not', () => {
    const m = RunManifestSchema.parse({
      ...MANIFEST_15,
      schema_version: '1.6',
      passes_not_run: [
        { pass: 'dynamic', name: 'dynamic_analysis', reason: 'not_in_profile' },
        { pass: 'secrets', name: 'secret_scan', reason: 'not_in_profile' },
      ],
    });
    const msg = evaluateDataQuality(m).map((x) => x.message).join('\n');
    expect(msg).toContain('Passes not executed: secret_scan (Not in the pass profile)');
    expect(msg).not.toContain('dynamic_analysis');
  });

  it('a secret scan without input (service run) is not banner-worthy', () => {
    const m = RunManifestSchema.parse({ ...MANIFEST_15, schema_version: '1.6', passes_not_run: [{ pass: 'secrets', reason: 'not_applicable' }] });
    expect(evaluateDataQuality(m)).toEqual([]);
  });

  it('a clean v1.6 manifest raises nothing', () => {
    expect(evaluateDataQuality(RunManifestSchema.parse({ ...MANIFEST_15, schema_version: '1.6' }))).toEqual([]);
  });
});

describe('one default pass list (#3419)', () => {
  it('keys and names come from DEFAULT_PASS_PROFILE and include the secret scan', () => {
    expect(CANONICAL_DEFAULT_PASS_KEYS).toEqual(DEFAULT_PASS_PROFILE.map((p) => p.key));
    expect(DEFAULT_PASS_NAMES).toEqual(DEFAULT_PASS_PROFILE.map((p) => p.name));
    expect(TOTAL_DEFAULT_PASSES).toBe(DEFAULT_PASS_PROFILE.length);
    expect(CANONICAL_DEFAULT_PASS_KEYS).toContain('secrets');
    expect(CANONICAL_DEFAULT_PASS_KEYS).not.toContain('malware');
    expect(DEFAULT_PASS_NAMES).toContain('secret_scan');
  });
});
