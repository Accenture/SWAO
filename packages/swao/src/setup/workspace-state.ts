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

// #4191 SET-02 (Design 125 sections 7 and 10): the workspace record of the
// setup per assessment type in the existing workspace .swao.yml:
//   workspace:
//     assessment_types: [application, lz-live]
//     setup_state: { application: { state: ready, checked_at: ..., fail_count: 0, warn_count: 1 } }
// Both keys are written as one flow-style line each inside the `workspace:`
// block through the minimal-patch writer (#4283), so every other line and
// comment of the file is kept; a commented `# workspace:` template is adopted
// in place (#4280).

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  SETUP_ASSESSMENT_TYPES,
  SetupAssessmentTypeSchema,
  SetupStateRecordSchema,
  branchStateFromHealth,
  patchSwaoYmlFile,
  setupBranchStateNote,
  type SetupAssessmentType,
  type SetupBranchRecord,
  type SetupBranchState,
  type SetupHealthCounts,
  type SetupStateRecord,
} from '@swao/core';
import { readWorkspaceYml } from './defaults.js';

function workspaceBlock(workspaceRoot: string): Record<string, unknown> {
  const w = readWorkspaceYml(workspaceRoot)['workspace'];
  return w && typeof w === 'object' && !Array.isArray(w) ? (w as Record<string, unknown>) : {};
}

/** `workspace.assessment_types`, in branch order; undefined when the field is absent or invalid. */
export function readAssessmentTypes(workspaceRoot: string): SetupAssessmentType[] | undefined {
  const raw = workspaceBlock(workspaceRoot)['assessment_types'];
  if (!Array.isArray(raw)) return undefined;
  const valid = raw.map((v) => SetupAssessmentTypeSchema.safeParse(v)).filter((r) => r.success).map((r) => r.data!);
  return SETUP_ASSESSMENT_TYPES.filter((t) => valid.includes(t));
}

/** `workspace.setup_state`; {} when absent or invalid. */
export function readSetupState(workspaceRoot: string): SetupStateRecord {
  const r = SetupStateRecordSchema.safeParse(workspaceBlock(workspaceRoot)['setup_state'] ?? {});
  return r.success ? r.data : {};
}

/** The state of one branch: the recorded state, else `not-set-up`. */
export function branchState(workspaceRoot: string, type: SetupAssessmentType): SetupBranchState {
  return readSetupState(workspaceRoot)[type]?.state ?? 'not-set-up';
}

/** #4282: the recorded state of every branch with its cause ("needs attention: waiting for Intake workbook"). */
export function branchStateNotes(workspaceRoot: string): Partial<Record<SetupAssessmentType, string>> {
  const rec = readSetupState(workspaceRoot);
  const out: Partial<Record<SetupAssessmentType, string>> = {};
  for (const t of SETUP_ASSESSMENT_TYPES) { const r = rec[t]; if (r) out[t] = setupBranchStateNote(r); }
  return out;
}

/** The recorded state of every branch (absent = not recorded). */
export function branchStates(workspaceRoot: string): Partial<Record<SetupAssessmentType, SetupBranchState>> {
  const rec = readSetupState(workspaceRoot);
  const out: Partial<Record<SetupAssessmentType, SetupBranchState>> = {};
  for (const t of SETUP_ASSESSMENT_TYPES) { const r = rec[t]; if (r) out[t] = r.state; }
  return out;
}

function hasChildDir(dir: string): boolean {
  try { return readdirSync(dir, { withFileTypes: true }).some((d) => d.isDirectory()); } catch { return false; }
}

/**
 * Design 125 section 10: the types a workspace already uses, from its content:
 * apps with runs (Application), a `service_portfolio` block (Service),
 * `assessment.landing_zone.targets` (LZ Catalog), `landing_zones` (LZ Live),
 * LLM Assessment runs (LLM).
 */
export function inferAssessmentTypes(workspaceRoot: string): SetupAssessmentType[] {
  const yml = readWorkspaceYml(workspaceRoot);
  const found = new Set<SetupAssessmentType>();
  const appsDir = join(workspaceRoot, 'apps');
  try {
    for (const d of readdirSync(appsDir, { withFileTypes: true })) {
      if (d.isDirectory() && hasChildDir(join(appsDir, d.name, 'wsp', 'runs'))) { found.add('application'); break; }
    }
  } catch { /* no apps */ }
  if (yml['service_portfolio'] !== undefined && yml['service_portfolio'] !== null) found.add('service');
  const assessment = yml['assessment'];
  const lz = assessment && typeof assessment === 'object' ? (assessment as Record<string, unknown>)['landing_zone'] : undefined;
  const targets = lz && typeof lz === 'object' ? (lz as Record<string, unknown>)['targets'] : undefined;
  if (Array.isArray(targets) && targets.length > 0) found.add('lz-catalog');
  if (Array.isArray(yml['landing_zones']) && yml['landing_zones'].length > 0) found.add('lz-live');
  if (hasChildDir(join(workspaceRoot, 'llm-assessments', 'swao'))) found.add('llm');
  return SETUP_ASSESSMENT_TYPES.filter((t) => found.has(t));
}

/**
 * Sets `workspace.<key>` in the workspace .swao.yml through the central
 * minimal-patch writer (#4283), keeping every other line. #4280: when the
 * file has no live `workspace:` key but the commented template `swao init`
 * ships (`# workspace:` / `#   run_retention:`), the template header becomes
 * the live key in place, so there is exactly one `workspace:` key and
 * uncommenting `run_retention` later keeps the file valid. Returns false when
 * the file is missing or the patch is refused.
 */
export function setWorkspaceKey(workspaceRoot: string, key: string, value: unknown): boolean {
  const p = join(workspaceRoot, '.swao.yml');
  if (!existsSync(p)) return false;
  return patchSwaoYmlFile(p, [{ path: ['workspace', key], value, style: 'flow' }], { adoptCommentedTemplates: true }).ok;
}

/** Writes `workspace.assessment_types` (in branch order, no duplicates). */
export function writeAssessmentTypes(workspaceRoot: string, types: readonly SetupAssessmentType[]): boolean {
  const ordered = SETUP_ASSESSMENT_TYPES.filter((t) => types.includes(t));
  return setWorkspaceKey(workspaceRoot, 'assessment_types', ordered);
}

/** Adds one type to `workspace.assessment_types` (a branch that was set up is a chosen type). */
export function addAssessmentType(workspaceRoot: string, type: SetupAssessmentType): boolean {
  const current = readAssessmentTypes(workspaceRoot) ?? [];
  if (current.includes(type)) return false;
  return writeAssessmentTypes(workspaceRoot, [...current, type]);
}

/** #4282 (D-8): why a branch without failures needs attention. */
export interface SetupBranchCause {
  missing?: readonly string[];
  waiting?: readonly string[];
}

/**
 * Records the state of one branch from its scoped health result (Design 125
 * section 7) and, when given, the cause: the `missing` and `waiting` Ready
 * items (#4282).
 */
export function recordBranchHealth(workspaceRoot: string, type: SetupAssessmentType, health: SetupHealthCounts | undefined, now: Date = new Date(), state?: SetupBranchState, cause: SetupBranchCause = {}): SetupBranchRecord {
  const record: SetupBranchRecord = {
    state: state ?? branchStateFromHealth(health),
    checked_at: now.toISOString(),
    ...(health ? { fail_count: health.failCount, warn_count: health.warnCount } : {}),
    ...(cause.missing && cause.missing.length > 0 ? { missing: [...cause.missing] } : {}),
    ...(cause.waiting && cause.waiting.length > 0 ? { waiting: [...cause.waiting] } : {}),
  };
  const next: SetupStateRecord = { ...readSetupState(workspaceRoot), [type]: record };
  // One flow-style line in branch order (Design 125 section 7), emitted by js-yaml.
  const ordered = Object.fromEntries(SETUP_ASSESSMENT_TYPES.filter((t) => next[t]).map((t) => [t, next[t]]));
  setWorkspaceKey(workspaceRoot, 'setup_state', ordered);
  return record;
}

/**
 * Design 125 section 10: on first start after the change, a workspace without
 * `workspace.assessment_types` gets the inferred types recorded. Returns the
 * recorded types, or undefined when the field already existed or the
 * workspace has no .swao.yml. Nothing else changes.
 */
export function migrateAssessmentTypes(workspaceRoot: string): SetupAssessmentType[] | undefined {
  if (!existsSync(join(workspaceRoot, '.swao.yml'))) return undefined;
  if (readAssessmentTypes(workspaceRoot) !== undefined) return undefined;
  const inferred = inferAssessmentTypes(workspaceRoot);
  return writeAssessmentTypes(workspaceRoot, inferred) ? inferred : undefined;
}
