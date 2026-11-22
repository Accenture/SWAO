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

// #4190 SET-01 (Design 125 sections 3, 11): the step registry. A new type or
// step is added by a branch module, without editing the wizard. The registry
// validates the modules once, at construction, and refuses an inconsistent set.

import { SETUP_ASSESSMENT_TYPES, SETUP_ASSESSMENT_TYPE_LABELS, SETUP_ASSESSMENT_TYPE_MIN_TIER } from '@swao/core';
import type { SetupAssessmentType, SetupScope } from '@swao/core';
import {
  SETUP_STEP_LABEL_MAX,
  type SetupBranchModule,
  type SetupGenericModule,
  type SetupStepDefinition,
} from './types.js';
import { RESERVED_STEP_LABELS } from './plan.js';

export class SetupRegistryError extends Error {
  constructor(public readonly problems: readonly string[]) {
    super(`setup registry: ${problems.join('; ')}`);
    this.name = 'SetupRegistryError';
  }
}

export interface SetupRegistry {
  /** The generic steps, sorted by order. */
  readonly generic: readonly SetupStepDefinition[];
  /** All five branches, in SETUP_ASSESSMENT_TYPES order. */
  branches(): readonly SetupBranchModule[];
  /** One branch (steps sorted by order). */
  branch(type: SetupAssessmentType): SetupBranchModule;
  /** The steps of a scope, sorted by order. */
  steps(scope: SetupScope): readonly SetupStepDefinition[];
  /** Every step of every scope. */
  allSteps(): readonly SetupStepDefinition[];
  /** A step by id. */
  step(id: string): SetupStepDefinition | undefined;
}

const byOrder = (a: SetupStepDefinition, b: SetupStepDefinition): number => a.order - b.order;

/** Problems of one step list for `scope` (empty = valid). Exported for tests. */
export function validateSteps(scope: SetupScope, steps: readonly SetupStepDefinition[], seen: Set<string>): string[] {
  const problems: string[] = [];
  const orders = new Set<number>();
  const labels = new Set<string>();
  for (const s of steps) {
    if (s.assessmentType !== scope) problems.push(`step ${s.id} declares assessmentType ${s.assessmentType} but is registered under ${scope}`);
    if (!s.id.startsWith(`${scope}.`) || s.id.length <= scope.length + 1) problems.push(`step id ${s.id} must start with "${scope}."`);
    if (seen.has(s.id)) problems.push(`duplicate step id ${s.id}`);
    seen.add(s.id);
    const label = s.label.trim();
    if (label.length === 0) problems.push(`step ${s.id} has an empty label`);
    if (label.length > SETUP_STEP_LABEL_MAX) problems.push(`step ${s.id} label "${label}" is longer than ${SETUP_STEP_LABEL_MAX} characters`);
    if (/--|\bswao\s/.test(label) || /--|\bswao\s/.test(s.guidance ?? '')) problems.push(`step ${s.id}: no CLI syntax and no "--" in TUI text (Design 125 section 9)`);
    if (RESERVED_STEP_LABELS.includes(label)) problems.push(`step ${s.id}: label "${label}" is used by the engine`);
    if (labels.has(label)) problems.push(`step ${s.id}: label "${label}" is used twice in ${scope}`);
    labels.add(label);
    if (!Number.isFinite(s.order)) problems.push(`step ${s.id} has no finite order`);
    if (orders.has(s.order)) problems.push(`step ${s.id}: order ${s.order} is used twice in ${scope}`);
    orders.add(s.order);
  }
  return problems;
}

/**
 * Builds and validates the registry. Throws SetupRegistryError when a branch
 * is missing or duplicated, a branch type does not match its label or tier
 * table, or a step is inconsistent (validateSteps).
 */
export function createSetupRegistry(generic: SetupGenericModule, branchModules: readonly SetupBranchModule[]): SetupRegistry {
  const problems: string[] = [];
  const seen = new Set<string>();
  problems.push(...validateSteps('generic', generic.steps, seen));

  const byType = new Map<SetupAssessmentType, SetupBranchModule>();
  for (const m of branchModules) {
    const t = m.branch.type;
    if (byType.has(t)) problems.push(`branch ${t} is registered twice`);
    byType.set(t, m);
    if (m.branch.label !== SETUP_ASSESSMENT_TYPE_LABELS[t]) problems.push(`branch ${t} label must be "${SETUP_ASSESSMENT_TYPE_LABELS[t]}"`);
    if (m.branch.minTier !== SETUP_ASSESSMENT_TYPE_MIN_TIER[t]) problems.push(`branch ${t} minTier must be ${SETUP_ASSESSMENT_TYPE_MIN_TIER[t]} (docs/strategy/012)`);
    if (/--|\bswao\s/.test(m.branch.description)) problems.push(`branch ${t} description: no CLI syntax and no "--" (Design 125 section 9)`);
    problems.push(...validateSteps(t, m.steps, seen));
  }
  for (const t of SETUP_ASSESSMENT_TYPES) if (!byType.has(t)) problems.push(`branch ${t} is not registered`);
  if (problems.length > 0) throw new SetupRegistryError(problems);

  const genericSteps = [...generic.steps].sort(byOrder);
  const branches: SetupBranchModule[] = SETUP_ASSESSMENT_TYPES.map((t) => {
    const m = byType.get(t)!;
    return { branch: m.branch, steps: [...m.steps].sort(byOrder) };
  });
  const all = [...genericSteps, ...branches.flatMap((b) => b.steps)];
  const index = new Map(all.map((s) => [s.id, s] as const));

  const branch = (type: SetupAssessmentType): SetupBranchModule => branches[SETUP_ASSESSMENT_TYPES.indexOf(type)]!;
  return {
    generic: genericSteps,
    branches: () => branches,
    branch,
    steps: (scope) => (scope === 'generic' ? genericSteps : branch(scope).steps),
    allSteps: () => all,
    step: (id) => index.get(id),
  };
}
