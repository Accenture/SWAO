// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library -- portfolio-summary schema (Design 113 section 6.2)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { PortfolioAppSchema, PortfolioSummarySchema } from './portfolio-summary.js';

// A summary written before the engagement-hub fields existed (#3402). It must
// keep parsing unchanged so older workspaces still load.
const PRE_HUB_APP = {
  id: 'legacy-app',
  name: 'Legacy App',
  time_quadrant: 'Migrate',
  time_reason: 'end of life within 18 months',
  analyst_time: null,
  risk_score: 42,
  health_score: 58,
  domain_scores: { security: 55 },
  controls_scored: 10,
  controls_unknown: 2,
  eol_date: null,
  cve_critical_count: null,
  kev_match: false,
  vendor_canonical_name: null,
  infra_category: null,
  site: null,
  operational_status: null,
  run: '2026-01-01T00-00-00',
};

describe('PortfolioAppSchema -- section 6.2 additive fields (#3402)', () => {
  it('parses a pre-hub app with none of the new fields', () => {
    const r = PortfolioAppSchema.safeParse(PRE_HUB_APP);
    expect(r.success).toBe(true);
    // The new fields are absent, not defaulted, so a round-trip stays byte-stable.
    if (r.success) expect(r.data.coverage_score).toBeUndefined();
  });

  it('parses an app carrying every section 6.2 field', () => {
    const r = PortfolioAppSchema.safeParse({
      ...PRE_HUB_APP,
      seven_r_label: 'Rehost',
      seven_r_source: 'derived_from_time',
      coverage_score: 0.73,
      findings_by_severity: { critical: 1, high: 3, medium: 5, low: 2, info: 0 },
      blocker_count: 1,
      top_findings: [
        { id: 'SEC-07', severity: 'critical', title: 'No encryption at rest' },
        { id: 'OPS-02', severity: 'high', title: 'No backup policy' },
      ],
      portability_score: 0.61,
      cloud_native_score: 0.44,
      confidence: 'high',
      compliance: [{ id: 'bsi-c5', name: 'BSI C5', pass: 12, partial: 3, fail: 1, not_assessed: 4 }],
      risk_counts: { high_high: 1, medium_low: 2 },
      lz_fit: [{ provider: 'otc', region: 'eu-de', verdict: 'fit', blockers: 0 }],
      last_assessed_at: '2026-10-22T07-11-29',
      swao_version: '1.4.2',
      llm_model: 'claude-opus-4-8',
      tags: ['tier-1', 'regulated'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects a coverage_score outside 0..1', () => {
    expect(PortfolioAppSchema.safeParse({ ...PRE_HUB_APP, coverage_score: 73 }).success).toBe(false);
  });

  it('treats portability/cloud_native as 0..1 fractions and confidence as a string', () => {
    // These mirror PublicationSummary: scores are fractions, confidence is a label.
    expect(PortfolioAppSchema.safeParse({ ...PRE_HUB_APP, portability_score: 61 }).success).toBe(false);
    expect(PortfolioAppSchema.safeParse({ ...PRE_HUB_APP, cloud_native_score: 0.44 }).success).toBe(true);
    expect(PortfolioAppSchema.safeParse({ ...PRE_HUB_APP, confidence: 80 }).success).toBe(false);
    expect(PortfolioAppSchema.safeParse({ ...PRE_HUB_APP, confidence: 'medium' }).success).toBe(true);
  });

  it('rejects an unknown seven_r_source', () => {
    expect(PortfolioAppSchema.safeParse({ ...PRE_HUB_APP, seven_r_source: 'guess' }).success).toBe(false);
  });

  it('caps top_findings at three', () => {
    const four = [1, 2, 3, 4].map((n) => ({ id: `F-${n}`, severity: 'low', title: `t${n}` }));
    expect(PortfolioAppSchema.safeParse({ ...PRE_HUB_APP, top_findings: four }).success).toBe(false);
  });

  it('keeps a full pre-hub summary valid', () => {
    const r = PortfolioSummarySchema.safeParse({
      generated_at: '2026-10-22T00-00-00',
      framework: { id: 'apm', version: '1.0', status: 'active' },
      domain_weights: { security: 1 },
      app_count: 1,
      portfolio_risk_score: 42,
      // z.record over the TIME enum is exhaustive: every quadrant must be present.
      time_distribution: { Tolerate: 0, Invest: 0, Migrate: 1, 'Migrate-Critical': 0, Eliminate: 0 },
      apps: [PRE_HUB_APP],
    });
    expect(r.success).toBe(true);
  });
});
