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

// Client LZ Policy Baseline evaluation result of one live scope (#3871,
// Design 123 sections 8.1 to 8.3 and 9.1). Written next to the scope's
// lz-live-scan.json as `<lz>.<scope>.lz-baseline.json`; the estate side of each
// policy is also in `estate.checks[]` of the scan, the offering verdict only
// here (the scan has no field for it). Read by the portfolio comparison
// (#3872) and the publication blocks (#3874).

import { z } from 'zod';
import { LzLiveCheckStatusSchema, LzLiveObservabilitySchema } from './lz-live-scan.js';
import type { LzLiveCheckStatus, LzLiveObservability } from './lz-live-scan.js';
import { POLICY_CATEGORIES, POLICY_KINDS } from './policy-baseline.js';
import type { PolicyCategory, PolicyKind } from './policy-baseline.js';

export const LZ_BASELINE_RESULT_SCHEMA = 'lz-baseline-result/1';
export const LZ_BASELINE_RESULT_SUFFIX = '.lz-baseline.json';

/** Offering verdicts reuse the LZ overall verdict vocabulary (Design 123 section 8.1; no new values). */
export const LZ_BASELINE_OFFERING_VERDICTS = ['READY', 'READY_WITH_CHANGES', 'NEEDS_VERIFICATION', 'BLOCKED', 'SOVEREIGNTY_BLOCKED'] as const;
export const LzBaselineOfferingVerdictSchema = z.enum(LZ_BASELINE_OFFERING_VERDICTS);
export type LzBaselineOfferingVerdict = z.infer<typeof LzBaselineOfferingVerdictSchema>;

/** Check severity of a baseline finding, from the control's severity_default (Design 123 section 8.2). */
export const LzBaselineSeveritySchema = z.enum(['blocker', 'warning', 'info']);

export const LzBaselinePolicyResultSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(POLICY_KINDS),
  category: z.enum(POLICY_CATEGORIES),
  control: z.string().min(1),
  severity: LzBaselineSeveritySchema,
  /** Can this CSP meet the policy here (offering, catalogue, governance)? */
  offering: LzBaselineOfferingVerdictSchema,
  /** Is the tenant compliant now? Same status as the estate check of the scan. */
  estate: LzLiveCheckStatusSchema,
  observability: LzLiveObservabilitySchema,
  /** Counts and reasons only: never tag values or resource ids. */
  detail: z.string().min(1),
  /** #3874: citation of the policy's default or the literal `assumption` (policy-baseline.yaml default_source, D-05). Optional: results written before #3874 lack it. */
  default_source: z.string().min(1).optional(),
}).strict();
export type LzBaselinePolicyResult = z.infer<typeof LzBaselinePolicyResultSchema>;

/** One merged sovereignty requirement value and the frameworks that contributed it (D-11). */
export const LzRequirementProvenanceSchema = z.object({
  requirement: z.enum(['residency_country', 'operator_jurisdiction', 'forbid_exposure', 'certification']),
  value: z.string().min(1),
  frameworks: z.array(z.string().min(1)).min(1),
}).strict();
export type LzRequirementProvenance = z.infer<typeof LzRequirementProvenanceSchema>;

export const LzBaselineResultSchema = z.object({
  schema: z.literal(LZ_BASELINE_RESULT_SCHEMA),
  lz_id: z.string().min(1),
  scope_id: z.string().min(1),
  provider: z.string().min(1),
  /** framework.id of the evaluated baseline copy (D-09). */
  framework: z.string().min(1),
  baseline_of: z.string().min(1),
  catalogue_version: z.string().min(1),
  /** sha256 of the policy-baseline.yaml evaluated (same value as the scan's meta.baseline.sha256). */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Worst offering verdict across the enabled policies (Design 123 section 8.2). */
  overall: LzBaselineOfferingVerdictSchema,
  /** Enabled policies, evaluated. */
  policies: z.array(LzBaselinePolicyResultSchema).default([]),
  /** state not_set: listed with the shipped default, never evaluated (D-10). */
  not_reviewed: z.array(z.object({
    id: z.string().min(1),
    kind: z.enum(POLICY_KINDS),
    params: z.record(z.string(), z.unknown()),
    /** #3874: as on the evaluated policies; optional for results written before #3874. */
    default_source: z.string().min(1).optional(),
  }).strict()).default([]),
  /** state disabled: listed, not evaluated. */
  disabled: z.array(z.string().min(1)).default([]),
  /** Every merged sovereignty requirement value with its contributing frameworks (D-11). */
  requirement_provenance: z.array(LzRequirementProvenanceSchema).default([]),
}).strict();
export type LzBaselineResult = z.infer<typeof LzBaselineResultSchema>;
export type LzBaselineResultInput = z.input<typeof LzBaselineResultSchema>;

/** Order of the offering verdicts, worst last (Design 123 section 8.2, as deriveLzOverallVerdict). */
const VERDICT_RANK: Record<LzBaselineOfferingVerdict, number> = {
  READY: 0,
  READY_WITH_CHANGES: 1,
  NEEDS_VERIFICATION: 2,
  BLOCKED: 3,
  SOVEREIGNTY_BLOCKED: 4,
};

/**
 * Worst offering verdict: any blocker blocks (sovereignty first), else
 * NEEDS_VERIFICATION lifts READY and READY_WITH_CHANGES. Moved here from
 * module-landing-zone (#3874) so the publication shares the one roll-up.
 */
export function baselineOverallVerdict(verdicts: readonly LzBaselineOfferingVerdict[]): LzBaselineOfferingVerdict {
  let worst: LzBaselineOfferingVerdict = 'READY';
  for (const v of verdicts) if (VERDICT_RANK[v] > VERDICT_RANK[worst]) worst = v;
  return worst;
}

const ESTATE_RANK: Readonly<Record<LzLiveCheckStatus, number>> = { fail: 0, warn: 1, unverified: 2, pass: 3, na: 4 };

/** Kinds decided on the platform scope (tenant governance, Design 123 section 8.3). */
const GOVERNANCE_KINDS: ReadonlySet<PolicyKind> = new Set<PolicyKind>([
  'region_residency', 'service_deny', 'service_allow_list', 'audit_trail', 'log_retention', 'privileged_mfa', 'credential_age', 'budget_alerts',
]);

/** One scope result of a landing zone, as input to the roll-up. */
export interface BaselineRollUpScope {
  scope_id: string;
  scope_kind: 'platform' | 'application' | undefined;
  result: LzBaselineResult;
}

/** One landing zone's result for one policy (Design 123 section 8.3). */
export interface RolledBaselinePolicy {
  offering: LzBaselineOfferingVerdict;
  estate: LzLiveCheckStatus;
  observability: LzLiveObservability;
  kind: PolicyKind;
  category: PolicyCategory;
  /** The scope whose estate row decided (worst over the deciding scopes). */
  scope_id: string;
  /** detail of the deciding estate row (counts and reasons only). */
  detail: string;
  /** default_source of the policy when the results carry it (#3874). */
  default_source?: string;
}

/**
 * Roll the scope results of one landing zone up per policy id (Design 123
 * section 8.3): governance kinds are decided on the platform scope when there is
 * one, every other kind (and governance without a platform scope) takes the
 * worst over all scopes. Worst is the offering order of baselineOverallVerdict
 * and the estate order fail, warn, unverified, pass, na. Used by the portfolio
 * comparison (#3872) and the lz-live publication (#3874), so both show the same
 * counts.
 */
export function rollUpBaselineScopes(scopes: readonly BaselineRollUpScope[]): Map<string, RolledBaselinePolicy> {
  const byPolicy = new Map<string, { kind: PolicyKind; category: PolicyCategory; default_source?: string; platform: Array<{ scope_id: string; p: LzBaselinePolicyResult }>; all: Array<{ scope_id: string; p: LzBaselinePolicyResult }> }>();
  for (const sc of scopes) {
    for (const p of sc.result.policies) {
      const e = byPolicy.get(p.id) ?? { kind: p.kind, category: p.category, platform: [], all: [] };
      if (e.default_source === undefined && p.default_source !== undefined) e.default_source = p.default_source;
      e.all.push({ scope_id: sc.scope_id, p });
      if (sc.scope_kind === 'platform') e.platform.push({ scope_id: sc.scope_id, p });
      byPolicy.set(p.id, e);
    }
  }
  const out = new Map<string, RolledBaselinePolicy>();
  for (const [id, e] of byPolicy) {
    const deciding = GOVERNANCE_KINDS.has(e.kind) && e.platform.length > 0 ? e.platform : e.all;
    const worst = deciding.reduce((a, b) => (ESTATE_RANK[b.p.estate] < ESTATE_RANK[a.p.estate] ? b : a));
    out.set(id, {
      offering: baselineOverallVerdict(deciding.map((r) => r.p.offering)),
      estate: worst.p.estate,
      observability: worst.p.observability,
      kind: e.kind,
      category: e.category,
      scope_id: worst.scope_id,
      detail: worst.p.detail,
      ...(e.default_source !== undefined ? { default_source: e.default_source } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// #4052 (Design 123 section 9.6): worst-first order of baseline policies
// ---------------------------------------------------------------------------

/** What a worst-first list ranks a baseline policy by; the id only breaks a full tie. */
export interface BaselineRankKey {
  id: string;
  estate: LzLiveCheckStatus;
  severity?: z.infer<typeof LzBaselineSeveritySchema>;
  offering?: LzBaselineOfferingVerdict;
}

const SEVERITY_RANK: Readonly<Record<z.infer<typeof LzBaselineSeveritySchema>, number>> = { blocker: 0, warning: 1, info: 2 };

/** Rank parts without the id: estate, then severity, then offering (worst first; a missing value ranks last). */
function rankParts(k: BaselineRankKey): [number, number, number] {
  return [
    ESTATE_RANK[k.estate],
    k.severity !== undefined ? SEVERITY_RANK[k.severity] : 3,
    k.offering !== undefined ? -VERDICT_RANK[k.offering] : 1,
  ];
}

/**
 * Worst first: estate status (fail, warn, unverified, pass, na), then severity
 * (blocker, warning, info), then the offering verdict (SOVEREIGNTY_BLOCKED,
 * BLOCKED, NEEDS_VERIFICATION, READY_WITH_CHANGES, READY), then the policy id.
 * The offering breaks ties among equal estate and severity, so a policy this
 * CSP cannot meet ranks before configuration-only gaps (#4052).
 */
export function compareBaselineWorstFirst(a: BaselineRankKey, b: BaselineRankKey): number {
  const pa = rankParts(a);
  const pb = rankParts(b);
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2] || a.id.localeCompare(b.id);
}

/** Same rank: equal estate, severity and offering (only the id differs). */
export function sameBaselineRank(a: BaselineRankKey, b: BaselineRankKey): boolean {
  const pa = rankParts(a);
  const pb = rankParts(b);
  return pa[0] === pb[0] && pa[1] === pb[1] && pa[2] === pb[2];
}

/**
 * When the cut of a ranked list at `limit` falls inside a group of equal rank:
 * the group size, how many of it are shown, and the shared key. Null when the
 * cut falls between two ranks or the list is not cut.
 */
export function baselineTieAtCut<T extends BaselineRankKey>(ranked: readonly T[], limit: number): { size: number; shown: number; key: T } | null {
  if (limit <= 0 || limit >= ranked.length) return null;
  const last = ranked[limit - 1] as T;
  if (!sameBaselineRank(last, ranked[limit] as T)) return null;
  const group = ranked.filter((r) => sameBaselineRank(r, last));
  return { size: group.length, shown: ranked.slice(0, limit).filter((r) => sameBaselineRank(r, last)).length, key: last };
}
