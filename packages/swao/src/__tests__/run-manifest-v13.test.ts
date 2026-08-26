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
import { RunManifestSchema } from '../schema/run-manifest.js';

const baseManifest = {
  schema_version: '1.3' as const,
  run_id: 'r-1',
  app: 'demo',
  iter: 1,
  assessed_at: '2026-05-10',
  started_at: '2026-05-10T13:00:00.000Z',
  finished_at: '2026-05-10T13:02:34.000Z',
  duration_ms: 154000,
  passes_executed: ['inventory'],
  total_signals_emitted: 12,
  pass_stats: [
    { pass: 'inventory', num: '01', wall_clock_ms: 2000, signals_emitted: 12 },
  ],
};

describe('RunManifestSchema v1.3 (#0153 landing-zone weights)', () => {
  it('accepts a v1.3 manifest with landing_zone_weights populated', () => {
    const v13 = {
      ...baseManifest,
      landing_zone_weights: {
        sovereign_score: 0.5,
        service_coverage: 0.35,
        portability: 0.1,
        cost_tier: 0.05,
      },
    };
    expect(RunManifestSchema.safeParse(v13).success).toBe(true);
  });

  it('landing_zone_weights is optional', () => {
    expect(RunManifestSchema.safeParse(baseManifest).success).toBe(true);
  });

  it('accepts a v1.2 manifest unchanged (back-compat)', () => {
    const v12 = { ...baseManifest, schema_version: '1.2' as const };
    expect(RunManifestSchema.safeParse(v12).success).toBe(true);
  });

  it('rejects a weight outside [0, 1]', () => {
    const bad = {
      ...baseManifest,
      landing_zone_weights: {
        sovereign_score: 1.5,
        service_coverage: 0.35,
        portability: 0.1,
        cost_tier: 0.05,
      },
    };
    expect(RunManifestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects landing_zone_weights with a missing dimension', () => {
    const bad = {
      ...baseManifest,
      landing_zone_weights: {
        sovereign_score: 0.5,
        service_coverage: 0.35,
        portability: 0.1,
      },
    };
    expect(RunManifestSchema.safeParse(bad).success).toBe(false);
  });
});
