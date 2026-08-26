// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Publication render plan builder -- Design 067 Phase 3 + Design 068 §14 (#0790)
 *
 * derivePlanForLzRun() returns the canonical ordered block list for a
 * landing-zone-catalog publication. Analogous to the app-assessment
 * derivePlanForRun() in @swao/module-app-assessment.
 *
 * derivePlanForLlmRun() returns the canonical ordered block list for an
 * LLM Assessment publication (Design 092 s8, L5 #1428).
 */

import type { PublicationModel } from './model.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlockPlan {
  name: string;
  params: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Publication title map (Design 067 Phase 3C)
// ---------------------------------------------------------------------------

export const PUBLICATION_TITLE_MAP: Record<string, string> = {
  'application':            'Application Assessment Report',
  'landing-zone-catalog':   'Landing Zone Assessment Report',
  'lz':                     'Landing Zone Assessment Report',  // latest-lz.html pointer resolves to key 'lz'
  'audit':                  'Audit Assessment Report',
  'llm':                    'LLM Assessment Report',
};

export function resolvePublicationTitle(assessmentType: string | undefined): string {
  if (!assessmentType) return 'SWAO Assessment';
  return PUBLICATION_TITLE_MAP[assessmentType] ?? 'SWAO Assessment';
}

// ---------------------------------------------------------------------------
// LZ-catalog render plan (Design 068 §6 block profile table)
// ---------------------------------------------------------------------------

/**
 * Returns the canonical ordered block plan for a landing-zone-catalog
 * PublicationModel (block_profile: 'lz-catalog').
 *
 * Canonical order (Design 068 §6):
 *   1. lzr-catalog-header       -- assessment header (provider, region, date)
 *   2. lzr-catalog-verdict       -- overall sovereign fit verdict
 *   3. lz-catalog-services       -- service coverage table (#0789)
 *   4. lzr-catalog-findings      -- per-service non-sovereign findings
 *   5. lzr-catalog-remediation   -- recommended actions (when findings present)
 *   6. lzr-catalog-finops        -- FinOps lens (when cost data present; ADR-0039 A6)
 */
export function derivePlanForLzRun(model: PublicationModel): BlockPlan[] {
  const plan: BlockPlan[] = [
    { name: 'lzr-catalog-header',      params: {} },
    { name: 'lzr-catalog-verdict',     params: {} },
    { name: 'lz-catalog-services',     params: {} },
    { name: 'lzr-catalog-findings',    params: {} },
  ];

  const hasFindings = (model.lzr.checks ?? []).some(c => c.result === 'fail');
  if (hasFindings) {
    plan.push({ name: 'lzr-catalog-remediation', params: {} });
  }

  const hasCostData =
    typeof (model.lzr.catalog as Record<string, unknown> | undefined)?.['cost_data'] !== 'undefined';
  if (hasCostData) {
    plan.push({ name: 'lzr-catalog-finops', params: {} });
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Hub render plan (#0794)
// ---------------------------------------------------------------------------

/**
 * Returns the canonical ordered block plan for an engagement hub page
 * (block_profile: 'hub').
 *
 * Canonical order (Design 068 §9):
 *   1. hub.header              -- app name, workspace, last-updated
 *   2. hub.app_list            -- all apps with assessment type badges
 *   3. hub.cross_links         -- links to each latest publication by type
 *   4. hub.workspace_summary   -- aggregate verdict counts
 */
export function derivePlanForHubRun(_model: PublicationModel): BlockPlan[] {
  return [
    { name: 'hub.header',            params: {} },
    { name: 'hub.app_list',          params: {} },
    { name: 'hub.cross_links',       params: {} },
    { name: 'hub.workspace_summary', params: {} },
  ];
}

// ---------------------------------------------------------------------------
// LLM Assessment render plan (#1428, Design 092 s8)
// ---------------------------------------------------------------------------

/**
 * Returns the canonical ordered block plan for an LLM Assessment publication
 * (block_profile: 'llm-assessment').
 *
 * Canonical order (Design 092 s8):
 *   1. llm.header           -- app name, legs, run timestamp
 *   2. llm.narrative         -- AI-generated summary (renders empty string when absent)
 *   3. llm.final-ranking     -- weighted composite ranking table
 *   4. llm.group-breakdown   -- per-dimension group breakdown
 *   5. llm.pass-table        -- per-pass aggregates across legs
 *   6. llm.findings          -- operational findings from the run
 *   7. llm.methodology       -- scoring methodology note
 */
export function derivePlanForLlmRun(_model: PublicationModel): BlockPlan[] {
  return [
    { name: 'llm.header',          params: {} },
    { name: 'llm.narrative',       params: {} },
    { name: 'llm.final-ranking',   params: {} },
    { name: 'llm.group-breakdown', params: {} },
    { name: 'llm.pass-table',      params: {} },
    { name: 'llm.findings',        params: {} },
    { name: 'llm.methodology',     params: {} },
  ];
}
