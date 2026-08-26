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
import { RunManifestSchema } from './run-manifest.js';

// Minimal valid manifest (schema_version 1.4 is the latest).
const BASE_MANIFEST = {
  schema_version: '1.4' as const,
  run_id: 'test-run-001',
  app: 'sovereign-health',
  iter: 1,
  assessed_at: '2026-08-06',
  started_at: '2026-08-06T00:00:00Z',
  finished_at: '2026-08-06T00:01:00Z',
  duration_ms: 60000,
  passes_executed: ['pass-1'],
  total_signals_emitted: 0,
  pass_stats: [],
};

describe('RunManifestSchema -- lz_catalogues field (#1437)', () => {
  it('parses a manifest without lz_catalogues (backward compat)', () => {
    const result = RunManifestSchema.safeParse(BASE_MANIFEST);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.lz_catalogues).toBeUndefined();
  });

  it('parses a manifest with lz_catalogues containing full {origin,sha256,last_updated} entries', () => {
    const manifest = {
      ...BASE_MANIFEST,
      lz_catalogues: {
        aws:   { origin: 'workspace', sha256: 'abc123def456', last_updated: '2026-08-01' },
        azure: { origin: 'bundled',   sha256: '111aaa222bbb' },
        gcp:   { origin: 'bundled',   sha256: '333ccc444ddd', last_updated: '2026-07-15' },
      },
    };
    const result = RunManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lz_catalogues?.['aws']?.origin).toBe('workspace');
      expect(result.data.lz_catalogues?.['aws']?.sha256).toBe('abc123def456');
      expect(result.data.lz_catalogues?.['aws']?.last_updated).toBe('2026-08-01');
      expect(result.data.lz_catalogues?.['azure']?.origin).toBe('bundled');
      expect(result.data.lz_catalogues?.['azure']?.last_updated).toBeUndefined();
    }
  });

  it('rejects lz_catalogues with an invalid origin value', () => {
    const manifest = {
      ...BASE_MANIFEST,
      lz_catalogues: { aws: { origin: 'INVALID', sha256: 'abc123' } },
    };
    const result = RunManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it('rejects lz_catalogues with a plain string (old enum format rejected)', () => {
    const manifest = {
      ...BASE_MANIFEST,
      lz_catalogues: { aws: 'workspace' },
    };
    const result = RunManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it('accepts installed as a valid origin value', () => {
    const manifest = {
      ...BASE_MANIFEST,
      lz_catalogues: { aws: { origin: 'installed', sha256: 'deadbeef1234' } },
    };
    const result = RunManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });
});

// #1702: passes_failed field -- schema v1.5
describe('RunManifestSchema -- passes_failed field (#1702)', () => {
  const V15_MANIFEST = { ...BASE_MANIFEST, schema_version: '1.5' as const };

  it('parses v1.4 manifest without passes_failed (backward compat)', () => {
    const result = RunManifestSchema.safeParse(BASE_MANIFEST);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.passes_failed).toBeUndefined();
  });

  it('parses v1.5 manifest without passes_failed (field is optional)', () => {
    const result = RunManifestSchema.safeParse(V15_MANIFEST);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.passes_failed).toBeUndefined();
  });

  it('parses v1.5 manifest with passes_failed connectivity_failure entries', () => {
    const manifest = {
      ...V15_MANIFEST,
      passes_failed: [
        { pass: 'compliance', reason: 'connectivity_failure' },
        { pass: 'block_assessments', reason: 'connectivity_failure' },
      ],
    };
    const result = RunManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.passes_failed).toHaveLength(2);
      expect(result.data.passes_failed?.[0]?.pass).toBe('compliance');
      expect(result.data.passes_failed?.[0]?.reason).toBe('connectivity_failure');
    }
  });

  it('parses v1.5 manifest with passes_failed provider_error entry', () => {
    const manifest = {
      ...V15_MANIFEST,
      passes_failed: [{ pass: 'data', reason: 'provider_error' }],
    };
    const result = RunManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it('rejects passes_failed with unknown reason', () => {
    const manifest = {
      ...V15_MANIFEST,
      passes_failed: [{ pass: 'compliance', reason: 'network_timeout' }],
    };
    const result = RunManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });
});
