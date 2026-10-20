// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * `wsp/portfolio-summary.json` (Design 103 §7.2, §21.2, #3101): workspace-level
 * SWAO_APM results for every service app, rebuilt after each service
 * assessment or research run. Also the base for delta tracking (Phase 7).
 * Since #3280 (Design 103 §22) it is the combined portfolio view: application
 * apps of the same workspace are listed too, each entry with `assessment_type`.
 *
 * Scales: `domain_scores` and `health_score` are HEALTH scores (100 = healthy);
 * `risk_score` = 100 - health_score (100 = highest risk).
 */

import { z } from 'zod';

export const TIME_QUADRANTS = ['Tolerate', 'Invest', 'Migrate', 'Migrate-Critical', 'Eliminate'] as const;
export const TimeQuadrantSchema = z.enum(TIME_QUADRANTS);
export type TimeQuadrant = z.infer<typeof TimeQuadrantSchema>;

const Score = z.number().min(0).max(100);

/** #3280: the two assessment types the combined portfolio view holds. */
export const PORTFOLIO_ASSESSMENT_TYPES = ['application', 'service'] as const;
export const PortfolioAssessmentTypeSchema = z.enum(PORTFOLIO_ASSESSMENT_TYPES);
export type PortfolioAssessmentType = z.infer<typeof PortfolioAssessmentTypeSchema>;

/** #3280: assessment type of a summary entry; entries written before the combined view are service apps. */
export function portfolioAppType(a: { assessment_type?: string | null }): PortfolioAssessmentType {
  return a.assessment_type === 'application' ? 'application' : 'service';
}

export const PortfolioAppSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  time_quadrant: TimeQuadrantSchema,
  time_reason: z.string(),
  /** The analyst's own TIME judgement from the intake (`disposition.gartner_time`), never overwritten. */
  analyst_time: z.string().nullable(),
  risk_score: Score.nullable(),
  health_score: Score.nullable(),
  domain_scores: z.record(z.string(), Score.nullable()),
  controls_scored: z.number().int().nonnegative(),
  controls_unknown: z.number().int().nonnegative(),
  eol_date: z.string().nullable(),
  cve_critical_count: z.number().int().nonnegative().nullable(),
  kev_match: z.boolean(),
  vendor_canonical_name: z.string().nullable(),
  infra_category: z.string().nullable(),
  site: z.string().nullable(),
  operational_status: z.string().nullable(),
  run: z.string().nullable(),
  // Phase 7 (Design 103 §21.2-§21.5), optional so pre-Phase-7 snapshots still parse.
  os: z.string().nullable().optional(),
  /** BLOCKED = past end of life, AMBER = within 18 months, GREEN = later (§6.2.2). */
  eol_signal: z.enum(['BLOCKED', 'AMBER', 'GREEN']).nullable().optional(),
  migration_candidate: z.boolean().nullable().optional(),
  cve_high_count: z.number().int().nonnegative().nullable().optional(),
  fan_in: z.number().int().nonnegative().optional(),
  blast_radius_score: z.number().nonnegative().optional(),
  blast_radius_tier: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  wave: z.number().int().min(1).max(5).optional(),
  effort_days: z.number().nonnegative().optional(),
  est_cloud_cost_eur_mo: z.number().nonnegative().nullable().optional(),
  // Sprint 151 (#3196, #3197), optional so older summaries still parse.
  /** True when the app has a service assessment run; false = intake and research only. */
  assessed: z.boolean().optional(),
  /**
   * `insufficient` when neither the end-of-life nor the CVE status is known and the operational status does not decide the TIME label.
   * `not_assessed` (#3241) when the app has no service assessment run: its scores come from the scaffold and research only.
   */
  evidence: z.enum(['sufficient', 'insufficient', 'not_assessed']).optional(),
  /** Evidence that was missing for the TIME decision (for example `end_of_life`, `cve`). */
  evidence_missing: z.array(z.string()).optional(),
  // #3280 (Design 103 §22), optional so summaries written before the combined view still parse.
  /** Assessment type of the app; absent in older summaries, which hold service apps only (read as `service`). */
  assessment_type: PortfolioAssessmentTypeSchema.optional(),
  /** Application apps: the 7R verdict of the latest application run (`wsp.yaml` overall.seven_r_label); null when unknown. */
  seven_r_label: z.string().nullable().optional(),
});
export type PortfolioApp = z.infer<typeof PortfolioAppSchema>;

export const PortfolioSummarySchema = z.object({
  generated_at: z.string(),
  framework: z.object({ id: z.string(), version: z.string(), status: z.string() }),
  domain_weights: z.record(z.string(), z.number().int().nonnegative()),
  app_count: z.number().int().nonnegative(),
  /** Mean of the app risk scores that could be computed, over assessed apps with sufficient evidence (#3196, #3241); null when none could. */
  portfolio_risk_score: Score.nullable(),
  /** #3241: the apps the headline figures (portfolio_risk_score, time_distribution) are computed over. */
  headline_basis: z.enum(['assessed_apps']).optional(),
  /** Apps with a service assessment run (#3197). */
  assessed_count: z.number().int().nonnegative().optional(),
  /** Apps whose TIME label rests on insufficient evidence (#3196). */
  insufficient_evidence_count: z.number().int().nonnegative().optional(),
  /** TIME quadrant counts over assessed apps only (#3241); unassessed apps are counted in app_count, not here. */
  time_distribution: z.record(TimeQuadrantSchema, z.number().int().nonnegative()),
  /**
   * #3280: the headline figures split per assessment type (same rules as the
   * workspace figures above). Written only when the workspace holds application
   * apps, so a service-only summary is unchanged.
   */
  by_assessment_type: z.record(PortfolioAssessmentTypeSchema, z.object({
    app_count: z.number().int().nonnegative(),
    assessed_count: z.number().int().nonnegative(),
    portfolio_risk_score: Score.nullable(),
    time_distribution: z.record(TimeQuadrantSchema, z.number().int().nonnegative()),
  })).optional(),
  apps: z.array(PortfolioAppSchema),
  /** Design 103 §21.5. */
  vendor_consolidation: z.array(z.object({
    vendor: z.string(),
    matched: z.boolean(),
    app_count: z.number().int().positive(),
    apps: z.array(z.string()),
    categories: z.array(z.string()),
    time_summary: z.record(z.string(), z.number().int().nonnegative()),
    opportunity_score: z.number().int().min(0).max(100),
    opportunity_tier: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  })).optional(),
  /** Design 103 §21.3: app IDs per wave, in schedule order. */
  waves: z.array(z.object({
    wave: z.number().int().min(1).max(5),
    label: z.string(),
    horizon: z.string(),
    apps: z.array(z.string()),
    effort_days: z.number().nonnegative(),
  })).optional(),
});
export type PortfolioSummary = z.infer<typeof PortfolioSummarySchema>;
