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

import { z } from 'zod';

export const SwaoYmlCrawlSchema = z.object({
  // Legacy fields -- accepted for backward compat but must NOT be written by
  // new code. Credentials (target_url, username, password) live in the SWAO
  // credential vault (playwright-url-*, playwright-user-*, playwright-pass-*).
  target_url: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  // Non-sensitive crawl settings -- safe to keep in YAML.
  auth_type: z.enum(['none', 'basic', 'form']).optional(),
  screenshot_quality: z
    .number()
    .int({ message: 'crawl.screenshot_quality must be an integer' })
    .min(0, { message: 'crawl.screenshot_quality must be >= 0' })
    .max(100, { message: 'crawl.screenshot_quality must be <= 100' })
    .optional(),
  viewport_width: z
    .number()
    .int({ message: 'crawl.viewport_width must be an integer' })
    .positive({ message: 'crawl.viewport_width must be positive' })
    .optional(),
  max_turns: z.number().int().positive().optional(),
  exclude_patterns: z.array(z.string()).optional(),
});

export const SwaoYmlVcsSchema = z.object({
  type: z.string().optional(),
  url: z.string().optional(),
  ref: z.string().optional(),
});

// Sprint-038 #0060: per-engagement overrides for the data-migration
// feasibility computation in derive-plan.ts. Both fields optional;
// the computation falls back to the assumed 100 GB/hr transfer rate
// and skips volume entirely if neither operator-supplied nor
// extracted from FinOps / CMDB (sprint-039 follow-up).
export const SwaoYmlMigrationSchema = z.object({
  transfer_rate_gbph: z.number().positive().optional(),
  total_storage_gb_override: z.number().nonnegative().optional(),
  rto_hours_override: z.number().positive().optional(),
});

// Publication config block (Design 041 §12)
export const SwaoYmlPublicationSiteSchema = z.object({
  base_url: z.string().optional(),
  theme: z.string().optional(),
  enable_remediation_board: z.boolean().optional(),
  enable_delta: z.boolean().optional(),
}).passthrough();

export const SwaoYmlPublicationSchema = z.object({
  cover_image: z.string().optional(),
  cover_subtitle: z.string().optional(),
  quote: z.object({
    text: z.string(),
    author: z.string(),
  }).optional(),
  custom_tags: z.array(z.string()).optional(),
  include_appendix_raw_wsp: z.boolean().optional(),
  template_level: z.number().int().min(1).max(4).optional(),
  default_lang: z.string().optional(),    // e.g. "en" | "de" (Design 041 §5 i18n)
  site: SwaoYmlPublicationSiteSchema.optional(),
  // Design 006 §10.2 -- configurable chrome text (no hardcoded strings in templates)
  classification_band: z.string().optional(),   // default: "Accenture Internal, Confidential"
  logo_name: z.string().optional(),             // default: "SWAO"
  logo_sub: z.string().optional(),              // default: "Publication"
  footer_note: z.string().optional(),           // appended to footer
  engagement_lead_label: z.string().optional(), // default: "Engagement Lead"
  engagement_lead: z.string().optional(),       // email/name -- read from .swao.yml (never PII-scrubbed)
  primary_contact_label: z.string().optional(),
  secondary_contact_label: z.string().optional(),
  github_url: z.string().optional(),     // GitHub link shown in publication header/footer
  docs_url: z.string().optional(),       // Documentation link shown in publication header/footer
  // Design 006 §13.5 -- persona portal configuration
  personas: z.array(z.object({
    id: z.string(),
    enabled: z.boolean().optional(),
    display_name: z.string(),
    badge_label: z.string().optional(),
    context_text: z.string().optional(),
    primary_frameworks: z.array(z.string()).optional(),
    primary_signal_prefixes: z.array(z.string()).optional(),
    primary_risk_categories: z.array(z.string()).optional(),
  }).passthrough()).optional(),
}).passthrough();

// Engagement block -- workspace-level engagement metadata (#0722)
export const SwaoYmlEngagementSchema = z.object({
  name: z.string().optional(),
  client_code: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  engagement_id: z.string().optional(),
  description: z.string().optional(),
  partnership_lead: z.string().optional(),
  engagement_lead: z.string().optional(),
  account_executive: z.string().optional(),
  project_manager: z.string().optional(),
}).passthrough();

export type SwaoYmlEngagement = z.infer<typeof SwaoYmlEngagementSchema>;

// Assessment block -- Design 043 §2.1 (pass profiles) + Design 049 §3 (type)
//
// Three orthogonal fields (see Design 043 v2 §2):
//   type         WHICH assessment kind (application | audit | landing-zone | hybrid | llm)
//   frameworks   WHAT to evaluate against  (community framework IDs; alias for regimes:)
//   pass_profile WHICH passes to run       (Prism profiles; application type only)
//
// Backwards compatibility:
//   type: source-code  deprecated alias for `application` (ADR-0039 amendment 3);
//                      normalised by the @swao/core assess router; removed at v2.0.0
//   lenses             deprecated alias for pass_profile (accepted, emits no warning yet)
//   regimes:           top-level key, unioned with assessment.frameworks at runtime
export const SwaoYmlAssessmentSchema = z.object({
  // WHICH assessment kind (default: application when absent). Deprecated aliases
  // accepted here and normalised by the assess router: `source-code` ->
  // `application` (am.3), `human` -> `audit` (am.4).
  type: z.enum(['application', 'audit', 'landing-zone', 'landing-zone-catalog', 'landing-zone-customer', 'hybrid', 'llm', 'source-code', 'human']).optional(),
  // WHAT: community frameworks to evaluate (alias for top-level regimes:)
  frameworks: z.array(z.string()).optional(),
  // WHICH: analysis pass profiles to run (source-code mode only)
  pass_profile: z.array(z.string()).optional(),
  // deprecated alias for pass_profile; accepted for backwards compatibility
  lenses: z.array(z.string()).optional(),
  lens_version: z.string().optional(),
  // #0800: per-app display metadata for reports and the TUI wizard
  display_name: z.string().optional(),
  description: z.string().optional(),
  // #1802: vision analysis of Playwright screenshots via configured LLM connector.
  // Off by default; enabling sends JPEG screenshots to the configured LLM -- cloud
  // connectors (anthropic, openai) will receive raw screen data. Set to true only
  // after reviewing the data-sovereignty implications.
  vision_analysis: z.boolean().optional(),
  vision_max_screens: z.number().int().positive().optional(),
}).passthrough();

// #1016: workspace-level settings (run retention, housekeeping)
export const SwaoYmlWorkspaceSchema = z.object({
  run_retention: z.object({
    keep_latest: z.number().int().positive().optional(),
  }).optional(),
}).passthrough();

// #1322: IaC provider config -- Pulumi Cloud API ingestion
export const SwaoYmlIacPulumiStackSchema = z.object({
  org: z.string(),
  project: z.string(),
  stack: z.string(),
});

export const SwaoYmlIacSchema = z.object({
  pulumi: z.object({
    stacks: z.array(SwaoYmlIacPulumiStackSchema).optional(),
  }).optional(),
}).passthrough();

// #1419 (Design 092 s4): LLM Assessment for SWAO -- portfolio-level config.
// The target app is chosen at run time (--app / TUI picker, which lists only
// apps with a completed App Assessment run); default_app may pin a default.
export const SwaoYmlLlmAssessmentLegSchema = z.object({
  connector: z.string().min(1),
  // Model id within the connector's catalogue; omitted = connector default.
  model: z.string().optional(),
  // Exactly one leg may be primary; when absent, the first leg is primary.
  primary: z.boolean().optional(),
});

export const SwaoYmlLlmAssessmentSchema = z.object({
  default_app: z.string().optional(),
  legs: z.array(SwaoYmlLlmAssessmentLegSchema).min(2).max(5).optional(),
  execution: z.enum(['serial', 'parallel']).optional(),
  repeat: z.number().int().positive().max(10).optional(),
  prompt_size_probe: z.boolean().optional(),
  // Leg WSPs are working data, discarded after metric extraction (092 s7.2);
  // true retains them for debugging only.
  keep_leg_wsp: z.boolean().optional(),
  // LLM-written interpretation of the final comparison (092 s9.2).
  interpretation: z.boolean().optional(),
  // Final-result weights (092 s5.8); published next to every final result.
  weights: z.object({
    quality: z.number().nonnegative().optional(),
    reliability: z.number().nonnegative().optional(),
    performance: z.number().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
    security: z.number().nonnegative().optional(),
  }).optional(),
}).passthrough()
  .superRefine((val, ctx) => {
    const primaries = (val.legs ?? []).filter((l) => l.primary === true).length;
    if (primaries > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['legs'],
        message: `at most one leg may set primary: true (found ${primaries})`,
      });
    }
  });

export const SwaoYmlSchema = z
  .object({
    source: z
      .object({
        path: z.string().optional(),
        vcs: SwaoYmlVcsSchema.optional(),
      })
      .passthrough()
      .optional(),
    crawl: SwaoYmlCrawlSchema.nullish(),
    context_inputs: z.array(z.object({}).passthrough()).optional(),
    workspace: SwaoYmlWorkspaceSchema.optional(),
    engagement: SwaoYmlEngagementSchema.optional(),
    assessment: SwaoYmlAssessmentSchema.optional(),
    migration: SwaoYmlMigrationSchema.optional(),
    publication: SwaoYmlPublicationSchema.optional(),
    iac: SwaoYmlIacSchema.optional(),
    llm_assessment: SwaoYmlLlmAssessmentSchema.optional(),
  })
  .passthrough();

export type SwaoYml = z.infer<typeof SwaoYmlSchema>;
export type SwaoYmlCrawl = z.infer<typeof SwaoYmlCrawlSchema>;
export type SwaoYmlAssessment = z.infer<typeof SwaoYmlAssessmentSchema>;
export type SwaoYmlPublication = z.infer<typeof SwaoYmlPublicationSchema>;
export type SwaoYmlWorkspace = z.infer<typeof SwaoYmlWorkspaceSchema>;
export type SwaoYmlIac = z.infer<typeof SwaoYmlIacSchema>;
export type SwaoYmlLlmAssessment = z.infer<typeof SwaoYmlLlmAssessmentSchema>;
export type SwaoYmlLlmAssessmentLeg = z.infer<typeof SwaoYmlLlmAssessmentLegSchema>;
