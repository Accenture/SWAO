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

// #4190 SET-01 (Design 125 section 4): the plan the wizard engine walks
// through, and the step bar for the current entry. Pure functions, so the
// step order per branch is unit-tested without rendering.

import { SETUP_ASSESSMENT_TYPES, SETUP_SCOPE_LABELS } from '@swao/core';
import type { SetupScope } from '@swao/core';
import type { SetupRegistry } from './registry.js';
import type { SetupPlanEntry, SetupRunMode, SetupStepContext } from './types.js';

/** Step bar labels of the entries the engine adds. */
export const HEALTH_CHECK_LABEL = 'Health Check';
export const TYPE_SELECTION_LABEL = 'Assessments';
export const READY_LABEL = 'Ready';

/** The applicability context for a scope, without the session-specific fields. */
export type SetupPlanContext = Omit<SetupStepContext, 'scope' | 'scopeLabel'>;

function scopeEntries(reg: SetupRegistry, scope: SetupScope, ctx: SetupPlanContext | undefined): SetupPlanEntry[] {
  const stepCtx = ctx ? { ...ctx, scope, scopeLabel: SETUP_SCOPE_LABELS[scope] } : undefined;
  return reg.steps(scope)
    .filter((s) => !stepCtx || !s.isApplicable || s.isApplicable(stepCtx))
    .map((step) => ({ kind: 'step', scope, step }) as const);
}

/**
 * The plan of a run (Design 125 section 4):
 * - first run: generic steps, generic health check, type selection, then per
 *   selected branch (in branch order): its steps, its health check, its Ready;
 *   with no branch selected the run ends with the generic Ready;
 * - branch: the branch steps, its health check, its Ready;
 * - generic: the generic steps, the generic health check, the generic Ready.
 * Every branch's health check comes after its last configuration step (#4120).
 */
export function buildSetupPlan(reg: SetupRegistry, mode: SetupRunMode, ctx?: SetupPlanContext): SetupPlanEntry[] {
  const branchPlan = (type: SetupScope): SetupPlanEntry[] => [
    ...scopeEntries(reg, type, ctx),
    { kind: 'health-check', scope: type },
    { kind: 'ready', scope: type },
  ];
  switch (mode.kind) {
    case 'branch':
      return branchPlan(mode.type);
    case 'generic':
      return branchPlan('generic');
    case 'first-run': {
      const selected = SETUP_ASSESSMENT_TYPES.filter((t) => mode.selected.includes(t));
      const head: SetupPlanEntry[] = [
        ...scopeEntries(reg, 'generic', ctx),
        { kind: 'health-check', scope: 'generic' },
        { kind: 'type-selection' },
      ];
      if (selected.length === 0) return [...head, { kind: 'ready', scope: 'generic' }];
      return [...head, ...selected.flatMap((t) => branchPlan(t))];
    }
    default: {
      const never: never = mode;
      throw new Error(`unknown setup run mode: ${JSON.stringify(never)}`);
    }
  }
}

/** The scope an entry belongs to (type selection belongs to the generic setup). */
export function entryScope(entry: SetupPlanEntry): SetupScope {
  return entry.kind === 'type-selection' ? 'generic' : entry.scope;
}

/** Step bar label of an entry. */
export function entryLabel(entry: SetupPlanEntry): string {
  switch (entry.kind) {
    case 'step': return entry.step.label;
    case 'health-check': return HEALTH_CHECK_LABEL;
    case 'type-selection': return TYPE_SELECTION_LABEL;
    case 'ready': return READY_LABEL;
    default: {
      const never: never = entry;
      throw new Error(`unknown plan entry: ${JSON.stringify(never)}`);
    }
  }
}

export interface SetupStepBar {
  labels: string[];
  currentIndex: number;
  /** The scope of the current entry, for the subtitle "Setup: <label>". */
  scope: SetupScope;
}

/**
 * The step bar for plan entry `index` (Design 125 section 4): the generic
 * entries of the plan plus the entries of the active branch only; no other
 * branch is shown. While a branch runs, the finished workspace part is shown
 * as one `Workspace` entry so the bar stays within the header width (#4110).
 * In a single branch run the plan has no generic entries, so the bar is the
 * branch.
 */
export function stepBarFor(plan: readonly SetupPlanEntry[], index: number): SetupStepBar {
  const current = plan[Math.max(0, Math.min(index, plan.length - 1))];
  if (!current) return { labels: [], currentIndex: 0, scope: 'generic' };
  const scope = entryScope(current);
  const visible = plan
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => entryScope(e) === scope);
  const hasGeneric = scope !== 'generic' && plan.some((e) => entryScope(e) === 'generic');
  const labels = [...(hasGeneric ? [WORKSPACE_LABEL] : []), ...visible.map(({ e }) => entryLabel(e))];
  return {
    labels,
    currentIndex: Math.max(0, visible.findIndex(({ i }) => i === index)) + (hasGeneric ? 1 : 0),
    scope,
  };
}

// #4254: the step bar is fitted by the central ScreenLayout (tui-kit fitStepBar);
// the local copy of #4110 is removed.

/** Step bar entry standing for the finished workspace part while a branch runs. */
export const WORKSPACE_LABEL = 'Workspace';

/** Labels the engine uses; a step may not take one (the step bar keys by label). */
export const RESERVED_STEP_LABELS: readonly string[] = [HEALTH_CHECK_LABEL, TYPE_SELECTION_LABEL, READY_LABEL, WORKSPACE_LABEL];

/** The screen subtitle (Design 125 section 4): "Workspace Setup" or "Setup: <branch label>". */
export function setupSubtitle(scope: SetupScope): string {
  return scope === 'generic' ? 'Workspace Setup' : `Setup: ${SETUP_SCOPE_LABELS[scope]}`;
}
