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

// #4190 SET-01 (Design 125 sections 4, 5, 8): the contract of the setup per
// assessment type. The generic workspace setup and each branch are a list of
// step definitions; the wizard engine appends the scoped health check and the
// Ready step to every branch, so a branch only declares its configuration
// steps. API stability: additive changes only (other lanes build on it).
//
// Ownership (sprint 157 night run): each branch module lives in its own file
// under ./branches/ and only that file changes when a branch gains steps; the
// registry (./registry.ts), the plan (./plan.ts) and SetupWizard.tsx stay with
// the engine.

import type { ComponentType } from 'react';
import type { LicenceTier, SetupAssessmentType, SetupHealthCounts, SetupScope } from '@swao/core';
import type { SetupState } from '../tui/screens/wizard/shared.js';

export type { SetupAssessmentType, SetupScope } from '@swao/core';

/** What a step knows when it renders. */
export interface SetupStepContext {
  /** The workspace root (set by the Init step; '.' before it). */
  workspaceRoot: string;
  /** Effective licence tier. */
  tier: LicenceTier;
  /** The scope being set up: `generic` or the active branch. */
  scope: SetupScope;
  /** Display name of the scope ("Workspace", "Landing Zone Live Assessment"). */
  scopeLabel: string;
  /** Values earlier steps of this run produced (engagement, LLM provider, ...). */
  session: Readonly<SetupState>;
}

/** How a step ended; the Ready step and the wizard.step events read it. */
export interface SetupStepResult {
  /** `done`: a value was set; `kept`: the current value was kept (Enter or Esc); `skipped`: the step did nothing. */
  status: 'done' | 'kept' | 'skipped';
  /** One short line for the Ready summary, for example "2 landing zones registered". */
  summary?: string;
}

/** Props the engine passes to every step component. */
export interface SetupStepProps {
  ctx: SetupStepContext;
  /** 1-based position of this step in the current step bar, and the bar length. */
  stepNumber: number;
  stepCount: number;
  /** Advance to the next plan entry. */
  onNext: (result?: SetupStepResult) => void;
  /** Merge values into the run session (visible to later steps through ctx.session). */
  updateSession: (patch: Partial<SetupState>) => void;
  /**
   * A step that embeds a screen with its own Esc handling (the Landing Zone
   * Connections screen, #3589) sets true while that screen owns Esc, so the
   * wizard's Esc does not return to the main menu. Reset on every step change.
   */
  setEscapeCaptured: (captured: boolean) => void;
  /** Report the central GuidanceBox open state (Ctrl+G), so Esc closes the box first (#0760). */
  setGuidanceOpen: (open: boolean) => void;
}

/** One line of a non-interactive check: what is set up and what is missing. */
export interface SetupCheckItem {
  label: string;
  /**
   * Design 126 section 6: `missing` is a required input that is absent (red);
   * `waiting` is input the operator still has to give, nothing is wrong
   * (yellow, #4225). Both keep the branch from running, so both make it
   * `needs-attention` (owner decision D-8, Design 125 section 7); `warn` and
   * `info` never do. #4496: `fail` is a check that failed (a landing zone
   * login that is refused), red and needs-attention as `missing`, worded as
   * the Probe step shows it.
   */
  state: 'ok' | 'missing' | 'waiting' | 'warn' | 'info' | 'fail';
  /** Short detail; no CLI syntax in TUI-facing text (Design 125 section 9). */
  detail?: string;
  /**
   * #4223: the short value of the Ready row ("not found", "1 app:
   * sovereign-health"); the full `detail` moves into the guidance box. The
   * CLI summary keeps the full detail. Absent: the Ready row shows `detail`.
   */
  short?: string;
  /**
   * #4223: items of one group (Security tools, IaC tools) share one Ready row;
   * each item becomes a section of the row's guidance.
   */
  group?: { label: string; what: string };
}

/** A step of the generic setup or of one branch. */
export interface SetupStepDefinition {
  /**
   * Unique id, namespaced by scope: `generic.init`, `application.playwright`,
   * `lz-live.connections`. The registry refuses duplicates and a wrong prefix.
   */
  id: string;
  /** Step bar label: short, at most SETUP_STEP_LABEL_MAX characters. */
  label: string;
  /** The scope this step serves (Design 125 section 4: every step says which type it serves). */
  assessmentType: SetupScope;
  /** Position within its scope, ascending. Convention: steps in tens (10, 20, 30, ...). */
  order: number;
  /** Optional one-line purpose, shown in the central guidance. */
  guidance?: string;
  /** When false the engine skips the step (for example a tier-gated step). Default: applicable. */
  isApplicable?: (ctx: SetupStepContext) => boolean;
  /** The interactive step. */
  component: ComponentType<SetupStepProps>;
  /**
   * Non-interactive check of what this step sets up (Design 125 section 8:
   * the TUI and `swao setup --type <type> --non-interactive` call the same
   * functions). Feeds the Ready step's "what is missing" list. Pure read.
   */
  check?: (workspaceRoot: string) => SetupCheckItem[];
}

/** The result of a scoped health check (Design 125 section 6). */
export interface SetupHealthResult extends SetupHealthCounts {
  scope: SetupScope;
  failedProbes: string[];
  warnedProbes: string[];
  /** #4410: set when the watchdog stopped the run ("health check did not finish ..."). */
  incomplete?: string;
}

/** The branch of one assessment type. */
export interface SetupBranchDefinition {
  type: SetupAssessmentType;
  /** Display name, SETUP_ASSESSMENT_TYPE_LABELS[type]. */
  label: string;
  /** One short menu line without CLI syntax (Design 125 section 9). */
  description: string;
  /** Lowest tier that runs the assessment; lower tiers see the branch greyed out (Q-06). */
  minTier: LicenceTier;
  /**
   * Ready step lines: what can run now and what is missing. Receives the
   * branch's scoped health result. When absent the engine lists the `check`
   * results of the branch steps.
   */
  readySummary?: (workspaceRoot: string, health: SetupHealthResult | undefined) => SetupCheckItem[];
  /**
   * #4346: what the branch's steps do on entry without asking (for example
   * creating a folder), run by the non-interactive branch check before its
   * health check, so `swao setup --type <type> --non-interactive` leaves the
   * workspace as the TUI branch does. Idempotent.
   */
  prepareNonInteractive?: (workspaceRoot: string) => void;
}

/** One branch file under ./branches/ exports one of these. */
export interface SetupBranchModule {
  branch: SetupBranchDefinition;
  steps: readonly SetupStepDefinition[];
}

/** The generic workspace setup (./branches/generic.tsx). */
export interface SetupGenericModule {
  steps: readonly SetupStepDefinition[];
}

/** The entries the engine walks through. */
export type SetupPlanEntry =
  | { kind: 'step'; scope: SetupScope; step: SetupStepDefinition }
  | { kind: 'health-check'; scope: SetupScope }
  | { kind: 'type-selection' }
  | { kind: 'ready'; scope: SetupScope };

/**
 * What the wizard runs:
 * - `first-run`: generic setup, generic health check, type selection, then the selected branches;
 * - `branch`: one branch (main menu "Set up an assessment type", `swao setup --type`);
 * - `generic`: the generic setup only (re-run of the workspace part).
 */
export type SetupRunMode =
  | { kind: 'first-run'; selected: readonly SetupAssessmentType[] }
  | { kind: 'branch'; type: SetupAssessmentType }
  | { kind: 'generic' };

/** Maximum step bar label length. */
export const SETUP_STEP_LABEL_MAX = 16;
