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
import { isValidEndpointAllowEntry } from './endpoint-scanner.js';
import {
  CODE_HEALTH_ALLOWLIST_MAX,
  CODE_HEALTH_TOOL_TIMEOUT_MAX_S,
  CODE_HEALTH_TOOL_TIMEOUT_MIN_S,
  CODE_HEALTH_TOP_N_MAX,
  CODE_HEALTH_TOP_N_MIN,
} from './code-health-config.js';

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

// #3404: `subdir` is read by resolveSourcePath (assess.ts, #1499) to scope every
// pass to a mono-repo subfolder. The block passes through so the other keys the
// clone path reads from the parsed object (token_scheme, git_proxy, ssl_verify,
// #0326 / #2749) are no longer stripped either. They stay undeclared on purpose:
// a strict type would reject configs that only parsed because Zod dropped them.
export const SwaoYmlVcsSchema = z.object({
  type: z.string().optional(),
  url: z.string().optional(),
  ref: z.string().optional(),
  subdir: z.string().optional(),
  // #3439: deadline for the assess clone step in minutes (integer, 1 to 240).
  // Absent means the clone helper's default of 10 minutes (CLONE_TIMEOUT_MS
  // in swao/src/providers/vcs/clone.ts); large mono-repos may need more.
  clone_timeout_minutes: z.number().int().min(1).max(240).optional(),
}).passthrough();

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
  classification_band: z.string().optional(),   // default: "SWAO - Sovereign Workload Assessment & Onboarding"
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

// #3281: LZ catalogue target, `<provider>:<region>` (for example
// `azure:germanywestcentral`). A `{ provider, region }` object is tolerated.
// The schema checks the shape only: an unknown provider or region is not a
// parse error. At run time a known geography (for example `azure:Europe`)
// resolves through the shared geography model of @swao/module-landing-zone
// (the same rule for every catalogue), and any
// other unknown value becomes a skipped target with a valid-region hint.
export const LZ_TARGET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*:\S.*$/;
export const SwaoYmlLzTargetSchema = z.union([
  z.string().regex(LZ_TARGET_PATTERN, {
    message: 'assessment.landing_zone.targets entries must have the form <provider>:<region>, for example azure:germanywestcentral',
  }),
  z.object({ provider: z.string().min(1), region: z.string().min(1) }).passthrough(),
]);

// #3281: assessment.landing_zone. `targets` is the multi-target list read by
// `swao assess --type landing-zone-catalog` and by the inline catalogue fit of
// an Application Assessment (`--lz-cat-targets` wins when given). The single
// `provider` + `region` pair stays supported; `provider` alone drives Pass 23
// (LZR) only.
export const SwaoYmlLandingZoneSchema = z.object({
  provider: z.string().nullish(),
  region: z.string().nullish(),
  targets: z.array(SwaoYmlLzTargetSchema).nullish(),
}).passthrough();

// #3403: assessment.test_code (extended form of assessment.exclude_test_code).
export const SwaoYmlTestCodeSchema = z.object({
  mode: z.enum(['include', 'tag', 'exclude']).optional(),
  // Globs (root-relative, `**` / `*` / `{a,b}`) classified as test code in
  // addition to the built-in rules and the build-file folders.
  extra_patterns: z.array(z.string().min(1)).optional(),
  // Globs never classified as test code (wins over every other rule).
  keep_patterns: z.array(z.string().min(1)).optional(),
}).passthrough();

// #3487: assessment.code_health (Pass 26, Design 117 section 2). Every key is
// optional; absent keys keep the defaults, so a run without the block is
// byte-identical to a run before the block existed.
export const SwaoYmlCodeHealthSchema = z.object({
  // Worklist length (default 25).
  top_n: z.number().int().min(CODE_HEALTH_TOP_N_MIN).max(CODE_HEALTH_TOP_N_MAX).optional(),
  // Hosts whose hard-coded literals Pass 26 does not count (exact host,
  // `.suffix`, IPv4 or IPv6 literal). Pass 07 egress and TF-01 ignore it.
  endpoint_allowlist: z.array(z.string().refine(isValidEndpointAllowEntry, {
    message: 'assessment.code_health.endpoint_allowlist entries must be a host name, a .suffix, an IPv4 or an IPv6 literal (no scheme, port or path)',
  })).max(CODE_HEALTH_ALLOWLIST_MAX).optional(),
  // Opt-in tool enrichment (default: none, no external process is started).
  tools: z.array(z.enum(['lizard', 'jscpd'])).optional(),
  // Ceiling per tool run (default 300 s).
  tool_timeout_seconds: z.number().int().min(CODE_HEALTH_TOOL_TIMEOUT_MIN_S).max(CODE_HEALTH_TOOL_TIMEOUT_MAX_S).optional(),
}).passthrough();

export const SwaoYmlAssessmentSchema = z.object({
  // WHICH assessment kind (default: application when absent). Deprecated aliases
  // accepted here and normalised by the assess router: `source-code` ->
  // `application` (am.3), `human` -> `audit` (am.4).
  type: z.enum(['application', 'audit', 'landing-zone', 'landing-zone-catalog', 'landing-zone-customer', 'hybrid', 'llm', 'service', 'source-code', 'human']).optional(),
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
  // #3281: landing zone catalogue targets (see SwaoYmlLandingZoneSchema).
  landing_zone: SwaoYmlLandingZoneSchema.nullish(),
  // #2755, deprecated by #3281: comma-separated `provider:region` pairs written
  // by older TUI versions. Still read when assessment.landing_zone.targets is absent.
  lz_cat_targets: z.string().nullish(),
  // #3403: test-code handling (Design 070 section 2.5, test-code.ts). Default
  // false / include: all code is analysed and results are unchanged.
  exclude_test_code: z.boolean().optional(),
  // #3403: extended form; `mode` wins over exclude_test_code. include | tag
  // (findings in test code marked, severity one step lower) | exclude (test
  // code not read; the secret scan is exempt and only marks its findings).
  test_code: SwaoYmlTestCodeSchema.optional(),
  // #3487: Pass 26 code health settings (see SwaoYmlCodeHealthSchema).
  code_health: SwaoYmlCodeHealthSchema.optional(),
}).passthrough().superRefine((a, ctx) => {
  // #3403: a contradictory pair is an operator error, not a silent pick.
  const mode = a.test_code?.mode;
  if (mode !== undefined && a.exclude_test_code !== undefined
      && (mode === 'exclude') !== a.exclude_test_code) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['test_code', 'mode'],
      message: `assessment.exclude_test_code: ${String(a.exclude_test_code)} contradicts assessment.test_code.mode: ${mode}; keep one of the two`,
    });
  }
});

// #1016: workspace-level settings (run retention, housekeeping)
export const SwaoYmlWorkspaceSchema = z.object({
  run_retention: z.object({
    keep_latest: z.number().int().positive().optional(),
  }).optional(),
}).passthrough();

// #3474: MCP tool profile of the workspace (Design 116 REQ-08.3). Either a
// built-in profile or an explicit tool list, never both. The CLI flag and the
// env (SWAO_MCP_PROFILE / SWAO_MCP_TOOLS) beat this block; tool names are
// checked against the listed tools when the MCP server starts.
export const SWAO_MCP_PROFILE_NAMES = ['starter', 'assess', 'full'] as const;
export const SwaoYmlMcpSchema = z.object({
  profile: z.enum(SWAO_MCP_PROFILE_NAMES).optional(),
  tools: z.array(z.string().min(1)).min(1).optional(),
}).passthrough().refine((m) => !(m.profile !== undefined && m.tools !== undefined), {
  message: 'mcp.profile and mcp.tools are mutually exclusive',
});

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

// Design 106 s6: per-workspace context configuration (#2968).
// allocations: per-pass char limit overrides (integer 10,000-500,000).
// categories: per-category relevance multipliers (float 0.0-1.0) applied on top
//   of per-pass code defaults in context-file-weights.ts.
// #3429: infra_roles declares whether an infrastructure input under wsp/inputs/
// describes the CURRENT platform (contradictions vs docs are findings; feeds
// INV service_dep) or a TARGET landing zone (mismatches are target-platform
// gaps; feeds LZR only). path is relative to wsp/inputs/: a file, a directory
// prefix, or a glob (* within a segment, ** across segments). First match wins.
// Without an entry the defaults apply: infra/current/** = current,
// infra/target/** = target, lz-*-snapshot.json = target, *.tfstate and other
// terraform/ or pulumi/ files = current (Design 088 section 7).
export const InfraRoleEntrySchema = z.object({
  path: z.string().min(1),
  role: z.enum(['current', 'target']),
});

export type InfraRoleEntry = z.infer<typeof InfraRoleEntrySchema>;

export const SwaoYmlContextSchema = z.object({
  allocations: z.record(z.string(), z.number().int().min(10_000).max(500_000)).optional(),
  categories: z.record(z.string(), z.number().min(0).max(1)).optional(),
  infra_roles: z.array(InfraRoleEntrySchema).optional(),
});

export type SwaoYmlContext = z.infer<typeof SwaoYmlContextSchema>;

// #3284 (Design 110 D-14): providers.llm. Only the keys SWAO validates are
// declared; primary / secondary / environments and every other providers.*
// block pass through unchanged (read by assess.ts and the LLM factory).
export const SwaoYmlProvidersLlmSchema = z
  .object({
    // In-flight LLM request limit per endpoint, shared by all passes. Default 4;
    // a gateway connector may set its own max_concurrency, this value wins.
    max_concurrency: z.number().int().min(1).max(64).optional(),
  })
  .passthrough();

export const SwaoYmlProvidersSchema = z
  .object({
    llm: SwaoYmlProvidersLlmSchema.nullish(),
  })
  .passthrough();

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
    // Design 104 Q-CODE-7: applies_when evaluation context (sprint-138 #2817).
    // Key-value map matched against RegimeControl.applies_when at assessment time;
    // controls whose applies_when keys are absent or mismatched are N_A
    // (not-applicable RAG), decided by Pass 11 without an LLM call (#3425).
    // A catalogue value may list alternatives with `|` (e.g. "energy|water").
    // Known keys: has_ot_systems ("true"), kritis_sector (energy, water,
    // health, finance, transport, ict).
    framework_context: z.record(z.string(), z.string()).optional(),
    workspace: SwaoYmlWorkspaceSchema.optional(),
    engagement: SwaoYmlEngagementSchema.optional(),
    assessment: SwaoYmlAssessmentSchema.optional(),
    migration: SwaoYmlMigrationSchema.optional(),
    publication: SwaoYmlPublicationSchema.optional(),
    iac: SwaoYmlIacSchema.optional(),
    llm_assessment: SwaoYmlLlmAssessmentSchema.optional(),
    context: SwaoYmlContextSchema.optional(),
    providers: SwaoYmlProvidersSchema.nullish(),
    mcp: SwaoYmlMcpSchema.optional(), // #3474
  })
  .passthrough();

export type SwaoYml = z.infer<typeof SwaoYmlSchema>;
export type SwaoYmlCrawl = z.infer<typeof SwaoYmlCrawlSchema>;
export type SwaoYmlMcp = z.infer<typeof SwaoYmlMcpSchema>;
export type SwaoYmlAssessment = z.infer<typeof SwaoYmlAssessmentSchema>;
export type SwaoYmlLandingZone = z.infer<typeof SwaoYmlLandingZoneSchema>;
export type SwaoYmlPublication = z.infer<typeof SwaoYmlPublicationSchema>;
export type SwaoYmlWorkspace = z.infer<typeof SwaoYmlWorkspaceSchema>;
export type SwaoYmlIac = z.infer<typeof SwaoYmlIacSchema>;
export type SwaoYmlLlmAssessment = z.infer<typeof SwaoYmlLlmAssessmentSchema>;
export type SwaoYmlLlmAssessmentLeg = z.infer<typeof SwaoYmlLlmAssessmentLegSchema>;
