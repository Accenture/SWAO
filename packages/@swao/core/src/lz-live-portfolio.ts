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

// #3584: the portfolio merge across landing zones (Design 120 section 11.2),
// `wsp/lz-live-portfolio/runs/<ts>/lz-live-portfolio.yaml` with the pointer
// `wsp/lz-live-portfolio/latest.txt`. Written by `swao assess --portfolio
// --type landing-zone-live` (module-landing-zone `live/portfolio.ts`); read by
// the portfolio aggregator (`buildPortfolioSummary`, which writes the
// `landing_zones[]` block of `portfolio-summary.json`, section 11.3) and by
// the `lz-live-portfolio` publication (#3586). Counts, statuses and capability
// rows only: no resource ids, tenant, account or person data (section 6.4).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { z } from 'zod';
import { LzLiveCheckStatusSchema, LzLiveMergedHierarchySchema, LzLiveObservabilitySchema, LzLiveReadOnlySchema, LzLiveSimulatedSchema, LzLiveStatusSchema } from './lz-live-scan.js';
import { LzBaselineOfferingVerdictSchema, LzRequirementProvenanceSchema } from './lz-baseline-result.js';
import { LzOrganisationalCountsSchema } from './lz-organisational-result.js';
import type { LandingZoneLiveSummary } from './portfolio-summary.js';

export const LZ_LIVE_PORTFOLIO_DIR = join('wsp', 'lz-live-portfolio');
export const LZ_LIVE_PORTFOLIO_FILE = 'lz-live-portfolio.yaml';
export const LZ_LIVE_PORTFOLIO_LATEST = 'latest.txt';

const LightCountsSchema = z.object({
  green: z.number().int().nonnegative(),
  amber: z.number().int().nonnegative(),
  red: z.number().int().nonnegative(),
  grey: z.number().int().nonnegative(),
}).strict();

export const LzLivePortfolioScopeSchema = z.object({
  scope_id: z.string().min(1),
  scope_kind: z.enum(['platform', 'application']).optional(),
  status: z.enum(['merged', 'stale', 'missing']),
  observed_at: z.string().min(1).optional(),
  age_days: z.number().nonnegative().optional(),
  read_only: LzLiveReadOnlySchema.optional(),
  /** Included simulated scope (`--include-simulated`); `[SIM]` in the matrix. */
  simulated: LzLiveSimulatedSchema.optional(),
}).strict();

export const LzLivePortfolioLzSchema = z.object({
  lz_id: z.string().min(1),
  provider: z.string().min(1),
  /** Run folder of the landing zone the entry was built from (provenance). */
  run_id: z.string().min(1),
  merged_at: z.string().min(1),
  window_days: z.number().int().positive(),
  /** True when at least one included scope is simulated (`[SIM]`). */
  simulated: z.boolean(),
  /** `merged`: the run's lz-live-merged.yaml as is; `re-merged`: merged again without the excluded simulated scopes. */
  merge_basis: z.enum(['merged', 're-merged']),
  scopes: z.array(LzLivePortfolioScopeSchema),
  /** Simulated scopes left out (no `--include-simulated`); listed, never dropped silently. */
  excluded_simulated_scopes: z.array(z.object({
    scope_id: z.string().min(1),
    scenario: z.string().optional(),
    fidelity: z.string().optional(),
  }).strict()).default([]),
  regions_enabled: z.number().int().nonnegative(),
  services_enabled: z.number().int().nonnegative(),
  /** IaC level counts over the enabled services (`unknown`: no iac block, or level `n/a`). */
  iac: z.object({
    full: z.number().int().nonnegative(),
    read: z.number().int().nonnegative(),
    none: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }).strict(),
  /** Governance matrix row: LZ x framework, one light per service (worst over the merged scopes). */
  framework_lights: z.record(z.string(), LightCountsSchema),
  /** Governance matrix row: LZ x baseline check (worst status over the merged scopes). */
  checks: z.record(z.string(), LzLiveCheckStatusSchema), // #3864: shared list incl. unverified
  quotas: z.array(z.object({
    scope_id: z.string().min(1),
    resource: z.string().min(1),
    region: z.string().optional(),
    limit: z.number().nonnegative().optional(),
    used: z.number().nonnegative().optional(),
    remaining: z.number().optional(),
  }).strict()).default([]),
  /** Drift since the previous run of each merged scope (counts of the scan diffs). */
  drift: z.object({
    new: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    status_changes: z.number().int().nonnegative(),
  }).strict(),
  /** #3880: one tenant tree per landing zone (Design 123 section 5.6), the
   *  merged view's `estate.hierarchy`; absent when no scope listed one.
   *  Native ids stay in this WSP artefact and never reach a publication. */
  hierarchy: LzLiveMergedHierarchySchema.optional(),
  /** #4050 (Design 120 section 8.4): organisational controls of the run, decided from the
   *  landing zone ingestion folder; counts per framework, no document name. */
  organisational: z.object({
    documents: z.number().int().nonnegative(),
    frameworks: z.record(z.string(), LzOrganisationalCountsSchema),
  }).strict().optional(),
}).strict();
export type LzLivePortfolioLz = z.infer<typeof LzLivePortfolioLzSchema>;

/** One row of the cross-CSP capability index (Design 120 section 11.2, item 2). */
export const LzLivePortfolioCapabilitySchema = z.object({
  tag: z.string().min(1),
  lz_id: z.string().min(1),
  provider: z.string().min(1),
  region: z.string().min(1),
  country: z.string().optional(),
  geographies: z.array(z.string()).default([]),
  operator_jurisdiction: z.string().optional(),
  service: z.string().min(1),
  status: LzLiveStatusSchema,
  iac_level: z.string().optional(),
  lights: z.record(z.string(), z.enum(['red', 'amber', 'green', 'grey', 'n/a'])).default({}),
  simulated: z.boolean().default(false),
}).strict();
export type LzLivePortfolioCapability = z.infer<typeof LzLivePortfolioCapabilitySchema>;

/**
 * #3822 (Design 120 section 11.2, item 4): the fit of an app named by an
 * application scope (`landing_zones[].scopes[].app`) against that scope's
 * merged scan, per region; `confidence: observed` in the portfolio summary.
 */
export const LzLivePortfolioAppFitSchema = z.object({
  app_id: z.string().min(1),
  lz_id: z.string().min(1),
  scope_id: z.string().min(1),
  provider: z.string().min(1),
  region: z.string().min(1),
  verdict: z.string().min(1),
  blockers: z.number().int().nonnegative(),
  /** The scope was served by a mock CSP and joined through `--include-simulated`. */
  simulated: z.boolean().default(false),
}).strict();
export type LzLivePortfolioAppFit = z.infer<typeof LzLivePortfolioAppFitSchema>;

/**
 * #3872 (Design 123 section 8.3): which CSP fits the client baseline. One
 * policy x landing zone matrix with the offering verdict and the estate status
 * per cell, a fit score per landing zone (READY over the enabled policies;
 * NEEDS_VERIFICATION counted separately, never as fit) and the policies no
 * landing zone meets. Landing zones assessed with another baseline hash than
 * the reference are marked `same_baseline: false` and not ranked.
 */
export const LzLiveBaselineCellSchema = z.object({
  lz_id: z.string().min(1),
  offering: LzBaselineOfferingVerdictSchema,
  estate: LzLiveCheckStatusSchema,
  observability: LzLiveObservabilitySchema,
}).strict();

export const LzLiveBaselineComparisonLzSchema = z.object({
  lz_id: z.string().min(1),
  provider: z.string().min(1),
  simulated: z.boolean(),
  /** framework.id and sha256 of the baseline this landing zone was assessed with. */
  framework: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** False when the hash differs from the reference, or the scopes disagree: shown as "different baseline", not ranked. */
  same_baseline: z.boolean(),
  /** Worst offering verdict over the enabled policies. */
  overall: LzBaselineOfferingVerdictSchema,
  counts: z.object({
    enabled: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    ready_with_changes: z.number().int().nonnegative(),
    needs_verification: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
  }).strict(),
  /** ready / enabled; null when not comparable (different baseline or no enabled policy). */
  fit_score: z.number().min(0).max(1).nullable(),
  /** 1 = best fit among the comparable landing zones with at least one READY policy; null otherwise. */
  rank: z.number().int().positive().nullable(),
  /** #3874: merged sovereignty requirement values of this landing zone's runs with their contributing frameworks (D-11; union over its scopes). */
  requirement_provenance: z.array(LzRequirementProvenanceSchema).optional(),
}).strict();

export const LzLiveBaselineComparisonSchema = z.object({
  /** Reference baseline: the hash most landing zones were assessed with. */
  framework: z.string().min(1),
  baseline_of: z.string().min(1),
  catalogue_version: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  landing_zones: z.array(LzLiveBaselineComparisonLzSchema),
  policies: z.array(z.object({
    id: z.string().min(1),
    kind: z.string().min(1),
    category: z.string().min(1),
    /** #3874: citation of the default or `assumption` (D-05), from the results. */
    default_source: z.string().min(1).optional(),
    cells: z.array(LzLiveBaselineCellSchema),
  }).strict()),
  /** Policies no comparable landing zone offers READY. */
  not_met_anywhere: z.array(z.string().min(1)).default([]),
  /** #3874: policies of the reference baseline left at state not_set (shipped default shown, never evaluated, D-10). */
  not_reviewed: z.array(z.object({
    id: z.string().min(1),
    kind: z.string().min(1),
    params: z.record(z.string(), z.unknown()),
    default_source: z.string().min(1).optional(),
  }).strict()).optional(),
  /** #3874: policies of the reference baseline at state disabled. */
  disabled: z.array(z.string().min(1)).optional(),
}).strict();
export type LzLiveBaselineComparison = z.infer<typeof LzLiveBaselineComparisonSchema>;

export const LzLivePortfolioSchema = z.object({
  schema: z.literal('lz-live-portfolio/1'),
  generated_at: z.string().min(1),
  include_simulated: z.boolean(),
  landing_zones: z.array(LzLivePortfolioLzSchema),
  /** Registered landing zones not in the merge, with the reason (no run, all scopes simulated, unreadable). */
  skipped: z.array(z.object({ lz_id: z.string().min(1), reason: z.string().min(1) }).strict()).default([]),
  capabilities: z.array(LzLivePortfolioCapabilitySchema).default([]),
  /** #3822: observed fits of apps linked to an application scope (additive; empty in older merges). */
  app_fits: z.array(LzLivePortfolioAppFitSchema).default([]),
  /** #3872: absent when no merged landing zone was assessed with a client policy baseline (additive, stays lz-live-portfolio/1). */
  baseline_comparison: LzLiveBaselineComparisonSchema.optional(),
}).strict();
export type LzLivePortfolio = z.infer<typeof LzLivePortfolioSchema>;

/**
 * The latest portfolio merge of a workspace, or null when none was written or
 * the file does not parse. Used by the portfolio aggregator on every rebuild,
 * so `landing_zones[]` survives app and service assessments.
 */
export function readLatestLzLivePortfolio(workspaceRoot: string): LzLivePortfolio | null {
  const dir = join(workspaceRoot, LZ_LIVE_PORTFOLIO_DIR);
  const ptr = join(dir, LZ_LIVE_PORTFOLIO_LATEST);
  if (!existsSync(ptr)) return null;
  const runId = readFileSync(ptr, 'utf-8').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/.test(runId)) return null;
  const file = join(dir, 'runs', runId, LZ_LIVE_PORTFOLIO_FILE);
  if (!existsSync(file)) return null;
  try {
    const r = LzLivePortfolioSchema.safeParse(yamlLoad(readFileSync(file, 'utf-8')));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/**
 * #3822: the observed `lz_fit[]` entries of one app from the portfolio merge
 * (Design 120 section 11.2, item 4). A simulated entry carries `simulated: true`.
 */
export function lzLivePortfolioAppFitEntries(p: LzLivePortfolio, appId: string): Array<{ provider: string; region: string; verdict: string; blockers: number; confidence: 'observed'; lz_id: string; scope_id: string; simulated?: true }> {
  return p.app_fits
    .filter((f) => f.app_id === appId)
    .map((f) => ({ provider: f.provider, region: f.region, verdict: f.verdict, blockers: f.blockers, confidence: 'observed' as const, lz_id: f.lz_id, scope_id: f.scope_id, ...(f.simulated ? { simulated: true as const } : {}) }));
}

/** Section 11.3: the `landing_zones[]` block of `portfolio-summary.json`, one entry per merged landing zone. */
/**
 * #3873 (Design 123 section 9.2): node counts per kind and the number of levels
 * of a merged tenant tree (a lone root is depth 1). Ids, labels and native kinds
 * stay out. A parent chain longer than the node list (never valid after the
 * schema refinement) stops the walk.
 */
export function lzLiveHierarchySummary(h: NonNullable<LzLivePortfolio['landing_zones'][number]['hierarchy']>): NonNullable<LandingZoneLiveSummary['hierarchy']> {
  const nodesByKind: Partial<Record<(typeof h.nodes)[number]['kind'], number>> = {};
  const parent = new Map(h.nodes.map((n) => [n.id, n.parent] as const));
  let depth = 0;
  for (const n of h.nodes) {
    nodesByKind[n.kind] = (nodesByKind[n.kind] ?? 0) + 1;
    let level = 1;
    let up = n.parent;
    while (up !== undefined && level <= h.nodes.length) { level++; up = parent.get(up); }
    if (level > depth) depth = level;
  }
  return { nodes_by_kind: nodesByKind, depth };
}

/** #4050: decided (SATISFIED or PARTIAL) and evaluated (all but N/A) organisational controls over every framework. */
export function lzOrganisationalSummary(o: NonNullable<LzLivePortfolioLz['organisational']>): { documents: number; decided: number; evaluated: number } {
  const all = Object.values(o.frameworks);
  return {
    documents: o.documents,
    decided: all.reduce((n, c) => n + c.satisfied + c.partial, 0),
    evaluated: all.reduce((n, c) => n + c.satisfied + c.partial + c.unknown, 0),
  };
}

export function lzLivePortfolioSummaryEntries(p: LzLivePortfolio): LandingZoneLiveSummary[] {
  const baselineOf = new Map((p.baseline_comparison?.landing_zones ?? []).map((l) => [l.lz_id, l] as const));
  return p.landing_zones.map((lz) => {
    const enabled = lz.services_enabled;
    const checks = Object.values(lz.checks);
    const b = baselineOf.get(lz.lz_id);
    return {
      lz_id: lz.lz_id,
      provider: lz.provider,
      scopes: lz.scopes
        .filter((s) => s.status !== 'missing' && s.observed_at !== undefined && s.read_only !== undefined)
        .map((s) => ({ id: s.scope_id, kind: s.scope_kind ?? 'platform', observed_at: s.observed_at as string, read_only: s.read_only as NonNullable<typeof s.read_only> })),
      regions_enabled: lz.regions_enabled,
      services_enabled: enabled,
      iac_full_pct: enabled > 0 ? Math.round((lz.iac.full / enabled) * 1000) / 10 : 0,
      framework_lights: lz.framework_lights,
      checks: {
        pass: checks.filter((c) => c === 'pass').length,
        fail: checks.filter((c) => c === 'fail').length,
        warn: checks.filter((c) => c === 'warn').length,
        unverified: checks.filter((c) => c === 'unverified').length,
      },
      // #3873: baseline fit and tenant tree summary (Design 123 section 9.2).
      ...(b ? { baseline: { framework: b.framework, fit_ready: b.counts.ready, fit_total: b.counts.enabled, needs_verification: b.counts.needs_verification, blocked: b.counts.blocked, same_baseline: b.same_baseline } } : {}),
      ...(lz.hierarchy && lz.hierarchy.nodes.length > 0 ? { hierarchy: lzLiveHierarchySummary(lz.hierarchy) } : {}),
      // #4050: organisational controls decided from documents, over every framework of the run.
      ...(lz.organisational ? { organisational: lzOrganisationalSummary(lz.organisational) } : {}),
      stale_scopes: lz.scopes.filter((s) => s.status === 'stale').map((s) => s.scope_id),
      ...(lz.scopes.some((s) => s.status === 'missing') ? { missing_scopes: lz.scopes.filter((s) => s.status === 'missing').map((s) => s.scope_id) } : {}),
      ...(lz.simulated ? { simulated: true } : {}),
      ...(lz.excluded_simulated_scopes.length > 0 ? { excluded_simulated_scopes: lz.excluded_simulated_scopes.map((s) => s.scope_id) } : {}),
      run_id: lz.run_id,
    };
  });
}
