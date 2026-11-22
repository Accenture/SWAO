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

// #4190 SET-01 (Design 125 sections 4, 6, 7): the shared vocabulary of the
// setup per assessment type. It lives in @swao/core because three packages
// use it: the workspace `.swao.yml` schema (workspace.assessment_types and
// workspace.setup_state, section 7), the probe registry of
// @swao/module-health-check (`applies_to`, section 6) and the wizard engine
// in @swao/swao (branches, section 4). Additive changes only.

import { z } from 'zod';
import type { AssessmentType, LicenceTier } from './plugin-types.js';

/** The five assessment types that have a setup branch, in branch order (Design 125 section 5). */
export const SETUP_ASSESSMENT_TYPES = ['application', 'service', 'lz-catalog', 'lz-live', 'llm'] as const;
export type SetupAssessmentType = (typeof SETUP_ASSESSMENT_TYPES)[number];

/** A setup scope: the generic workspace setup or one assessment type (probe `applies_to`, step `assessmentType`). */
export const SETUP_SCOPES = ['generic', ...SETUP_ASSESSMENT_TYPES] as const;
export type SetupScope = (typeof SETUP_SCOPES)[number];

export const SetupAssessmentTypeSchema = z.enum(SETUP_ASSESSMENT_TYPES);
export const SetupScopeSchema = z.enum(SETUP_SCOPES);

/** State of one branch, recorded from its scoped health check (Design 125 section 7). */
export const SETUP_BRANCH_STATES = ['not-set-up', 'ready', 'needs-attention'] as const;
export type SetupBranchState = (typeof SETUP_BRANCH_STATES)[number];
export const SetupBranchStateSchema = z.enum(SETUP_BRANCH_STATES);

/** Display names, as used on the menus and in the screen subtitle ("Setup: <label>"). */
export const SETUP_ASSESSMENT_TYPE_LABELS: Readonly<Record<SetupAssessmentType, string>> = {
  application: 'Application Assessment',
  service: 'Service Portfolio Assessment',
  'lz-catalog': 'Landing Zone Catalog Assessment',
  'lz-live': 'Landing Zone Live Assessment',
  llm: 'LLM Assessment',
};

export const SETUP_SCOPE_LABELS: Readonly<Record<SetupScope, string>> = {
  generic: 'Workspace',
  ...SETUP_ASSESSMENT_TYPE_LABELS,
};

export const SETUP_BRANCH_STATE_LABELS: Readonly<Record<SetupBranchState, string>> = {
  'not-set-up': 'not set up',
  ready: 'ready',
  'needs-attention': 'needs attention',
};

/**
 * Lowest tier that can run the assessment of a branch (Design 125 Q-06: gated
 * branches are shown greyed out with the tier). Source: docs/strategy/012
 * F-130 (LLM, all tiers), F-131 (service, all tiers), F-141 (LZ catalogue, all
 * tiers), F-136 (LZ live run, Consultant; connections F-135 stay Community).
 */
export const SETUP_ASSESSMENT_TYPE_MIN_TIER: Readonly<Record<SetupAssessmentType, LicenceTier>> = {
  application: 'community',
  service: 'community',
  'lz-catalog': 'community',
  'lz-live': 'consultant',
  llm: 'community',
};

const TIER_RANK: Readonly<Record<LicenceTier, number>> = { community: 0, consultant: 1, enterprise: 2 };

/** True when `tier` may run the assessment of the branch. */
export function isSetupTypeAvailable(type: SetupAssessmentType, tier: LicenceTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[SETUP_ASSESSMENT_TYPE_MIN_TIER[type]];
}

/** The `assessment.type` / `swao assess --type` value of a setup branch. */
export function setupTypeToAssessmentType(type: SetupAssessmentType): AssessmentType {
  switch (type) {
    case 'application': return 'application';
    case 'service': return 'service';
    case 'lz-catalog': return 'landing-zone-catalog';
    case 'lz-live': return 'landing-zone-live';
    case 'llm': return 'llm';
    default: {
      const never: never = type;
      throw new Error(`unknown setup assessment type: ${String(never)}`);
    }
  }
}

/** Parses a CLI or YAML value; accepts the setup ids and the `assessment.type` ids. */
export function parseSetupAssessmentType(value: string): SetupAssessmentType | undefined {
  const v = value.trim().toLowerCase();
  if ((SETUP_ASSESSMENT_TYPES as readonly string[]).includes(v)) return v as SetupAssessmentType;
  switch (v) {
    case 'landing-zone-catalog':
    case 'landing-zone':
      return 'lz-catalog';
    case 'landing-zone-live':
      return 'lz-live';
    case 'source-code':
      return 'application';
    default:
      return undefined;
  }
}

/** One recorded branch state in `workspace.setup_state.<type>`. */
export const SetupBranchRecordSchema = z.object({
  state: SetupBranchStateSchema,
  /** ISO timestamp of the scoped health check that set the state. */
  checked_at: z.string().optional(),
  fail_count: z.number().int().nonnegative().optional(),
  warn_count: z.number().int().nonnegative().optional(),
  /**
   * #4282 (owner decision D-8, Design 125 section 7): why a branch without
   * failures needs attention. Labels of the Ready items that are `missing`
   * (required input absent) and `waiting` (operator input expected).
   */
  missing: z.array(z.string()).optional(),
  waiting: z.array(z.string()).optional(),
}).passthrough();
export type SetupBranchRecord = z.infer<typeof SetupBranchRecordSchema>;

/** `workspace.setup_state`: one optional record per branch. */
export const SetupStateRecordSchema = z.object({
  application: SetupBranchRecordSchema.optional(),
  service: SetupBranchRecordSchema.optional(),
  'lz-catalog': SetupBranchRecordSchema.optional(),
  'lz-live': SetupBranchRecordSchema.optional(),
  llm: SetupBranchRecordSchema.optional(),
}).passthrough();
export type SetupStateRecord = z.infer<typeof SetupStateRecordSchema>;

/** The result of a scoped health check, reduced to what the branch state needs. */
export interface SetupHealthCounts {
  probeCount: number;
  failCount: number;
  warnCount: number;
}

/**
 * Branch state from its scoped health check: no result is `not-set-up`, any
 * failure is `needs-attention`, otherwise `ready`. Warnings do not block a run
 * (the health-check failure definition, computeFailedProbes, #3170), so they
 * keep the branch `ready`; the Ready step lists them.
 */
export function branchStateFromHealth(h: SetupHealthCounts | undefined): SetupBranchState {
  if (!h || h.probeCount === 0) return 'not-set-up';
  return h.failCount > 0 ? 'needs-attention' : 'ready';
}

/**
 * #4282 (D-8): the state of a recorded branch with its cause, for the Setup
 * menu and `swao setup --type --non-interactive`: "needs attention: missing
 * Source x; waiting for Intake workbook", or "needs attention: 2 failed
 * check(s)". Labels only, never a value.
 */
export function setupBranchStateNote(record: Pick<SetupBranchRecord, 'state' | 'fail_count' | 'missing' | 'waiting'> | undefined): string {
  const state = record?.state ?? 'not-set-up';
  const label = SETUP_BRANCH_STATE_LABELS[state];
  if (state !== 'needs-attention' || !record) return label;
  const parts: string[] = [];
  if ((record.fail_count ?? 0) > 0) parts.push(`${record.fail_count} failed check(s)`);
  if (record.missing && record.missing.length > 0) parts.push(`missing ${record.missing.join(', ')}`);
  if (record.waiting && record.waiting.length > 0) parts.push(`waiting for ${record.waiting.join(', ')}`);
  return parts.length > 0 ? `${label}: ${parts.join('; ')}` : label;
}
