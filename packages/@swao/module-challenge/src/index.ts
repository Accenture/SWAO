// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Challenge module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import type {
  SwaoModuleManifest,
  TuiScreenContribution,
} from '@swao/core';

import { ChallengeScreen } from './tui/ChallengeScreen.js';

/**
 * @swao/module-challenge -- the `challenge` command (LLM agents stress-test a
 * WSP assessment from five stakeholder personas) plus its ChallengeScreen and
 * the persona taxonomy (ADR-0048 modular architecture, Phase 5, #0580).
 * Enterprise tier.
 *
 * The runtime gate is `guard.requireTier('enterprise', { feature: 'challenge'
 * })` in challenge.ts (ADR-0049: tier-gating is runtime requireTier; the
 * command stays visible). Enterprise is the PRESERVED current gate (migrated
 * from premium), not a new decision. This module adds no gating logic beyond
 * that gate; it declares `tier: 'enterprise'` in the manifest below.
 *
 * Two host values are injected (the module never imports host code or a sibling
 * module):
 *  - the SWAO version (branding is host-only) is the screen's `version` prop at
 *    the App.tsx call site (the #0573 DoctorScreen dependency-injection pattern);
 *  - the createLlmProvider factory (owned by the sibling @swao/module-llm-providers)
 *    is injected into registerChallenge via ChallengeDeps and wired by the host.
 */

// CLI command register fn. registerChallenge takes a ChallengeDeps object so the
// host can inject createLlmProvider from @swao/module-llm-providers without this
// module importing the sibling. Wired from the host's index.ts bootstrap.
export { registerChallenge } from './challenge.js';
export type { ChallengeDeps, CreateLlmProvider } from './challenge.js';

// Persona taxonomy relocated to @swao/core (#0580) -- re-exported here from core
// so the module's public surface is stable, while the Community `report` command
// imports it directly from @swao/core (NOT from this Enterprise module), keeping
// per-tier builds clean (#0583).
export {
  CANONICAL_AGENT_ORDER,
  PERSONAS,
  AGENT_IDS,
  REPORT_VIEW_ALIASES,
  reportViewToAgentId,
} from '@swao/core';
export type { Persona, AgentId } from '@swao/core';
// Challenge helpers (the relocated challenge.test.ts + any host test use these).
export {
  getPromptBuilder,
  runChallengeReport,
  runAllAgentsReport,
  runChallengeSession,
  validateCombinedReport,
  CONTEXT_TURN_LIMIT,
} from './challenge.js';
export type {
  AgentReportEntry,
  CombinedChallengeReport,
  CombinedReportValidationError,
  ChallengeSessionOpts,
} from './challenge.js';

// WSP summary builder + types (consumed by challenge.ts and host tests).
export { buildWspSummary, buildLzWspSummary } from './challenge/loader.js';
export { formatWspContext, formatLzContext } from './challenge/types.js';
export type { WspSummary, WspSignal, WspBlocker, LzCandidate, LzWspSummary, LzAssessedTarget, LzFitItemSummary } from './challenge/types.js';
// LZ Sovereignty Challenge taxonomy (#1109).
export { LZ_AGENT_IDS, getLzPromptBuilder } from './challenge.js';
export type { LzAgentId } from './challenge.js';

// TUI screen contributed by this module (#0580). The host renders it via direct
// import today (App.tsx) and injects the SWAO version (branding is host-only).
export { ChallengeScreen } from './tui/ChallengeScreen.js';
export { LicenseGate, isAllowed } from '@swao/tui-kit';

export const tuiScreens: TuiScreenContribution[] = [
  { name: 'ChallengeScreen', tier: 'enterprise', component: ChallengeScreen },
];

export const manifest: SwaoModuleManifest = {
  id: '@swao/module-challenge',
  version: '0.1.0',
  tier: 'enterprise',
  contributions: {
    tuiScreens,
  },
};
