// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library -- compliance regime summary (Design 113 section 6.2)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import type { z } from 'zod';
import type { ComplianceControlOutcomeSchema } from './wsp-compliance.js';

/**
 * Shared compliance classifier so the publication extractor and the portfolio
 * summary map `wsp-plan.yaml` compliance.regimes controls to the same RAG status
 * and the hub's per-framework counts equal the report's (#3402). The authoritative
 * source and vocabulary are the extractor's (extractor.ts section 10): each
 * control's `status` string.
 *
 * #3425: the classifier runs in two steps so every consumer (extractor, hub
 * summary, APP-REG-01 in #3407, the GAP post-checks in #3426/#3414) shares one
 * vocabulary:
 *   1. `normaliseComplianceOutcome` folds the raw string onto the Pass 11
 *      outcome union (SATISFIED / PARTIAL / GAP / UNKNOWN / N_A) through
 *      `COMPLIANCE_OUTCOME_ALIASES` (extend that table, not the switches).
 *   2. `complianceOutcomeRag` maps the outcome to a RAG bucket with an
 *      exhaustive switch: SATISFIED -> pass, PARTIAL -> partial,
 *      UNKNOWN -> not-assessed, N_A -> not-applicable, GAP -> fail.
 * A missing or unrecognised status still classifies as `fail` (unchanged
 * behaviour; #3407 may revisit once the persisted vocabulary is confirmed).
 */

/** Canonical Pass 11 control outcome (the WSP `ComplianceControlOutcomeSchema`). */
export type ComplianceOutcome = z.infer<typeof ComplianceControlOutcomeSchema>;

/** RAG bucket. #3425: `not-applicable` is distinct from `fail` and `not-assessed`. */
export type ComplianceRag = 'pass' | 'partial' | 'fail' | 'not-assessed' | 'not-applicable';

/** Every RAG bucket, in display order (fail first). */
export const COMPLIANCE_RAG_VALUES: readonly ComplianceRag[] = ['fail', 'partial', 'pass', 'not-assessed', 'not-applicable'];

/**
 * Raw status spellings (upper-cased, `-`, `/` and spaces folded to `_`) mapped
 * onto the canonical outcome. #3425 added the not-applicable spellings.
 */
export const COMPLIANCE_OUTCOME_ALIASES: Readonly<Record<string, ComplianceOutcome>> = {
  SATISFIED: 'SATISFIED',
  PASS: 'SATISFIED',
  PARTIAL: 'PARTIAL',
  GAP: 'GAP',
  FAIL: 'GAP',
  UNKNOWN: 'UNKNOWN',
  N_A: 'N_A',
  NA: 'N_A',
  NOT_APPLICABLE: 'N_A',
  // #3407: the example-workspace plan vocabulary (`status: compliant / non_compliant`).
  COMPLIANT: 'SATISFIED',
  NON_COMPLIANT: 'GAP',
};

/** Fold a raw control status onto the canonical outcome; null when unrecognised. */
export function normaliseComplianceOutcome(status?: string | null): ComplianceOutcome | null {
  if (typeof status !== 'string' || status.trim() === '') return null;
  const key = status.trim().toUpperCase().replace(/[\s/-]+/g, '_');
  return COMPLIANCE_OUTCOME_ALIASES[key] ?? null;
}

/** Map a canonical outcome to its RAG bucket (exhaustive over the union). */
export function complianceOutcomeRag(outcome: ComplianceOutcome): ComplianceRag {
  switch (outcome) {
    case 'SATISFIED': return 'pass';
    case 'PARTIAL': return 'partial';
    case 'GAP': return 'fail';
    case 'UNKNOWN': return 'not-assessed';
    case 'N_A': return 'not-applicable';
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}

/** Classify a compliance control `status` string into a RAG bucket. */
export function complianceRagStatus(status?: string | null): ComplianceRag {
  const outcome = normaliseComplianceOutcome(status);
  return outcome === null ? 'fail' : complianceOutcomeRag(outcome);
}

/** Per-bucket control counts. */
export interface ComplianceRagTally {
  pass: number;
  partial: number;
  fail: number;
  not_assessed: number;
  not_applicable: number;
}

/** Tally control statuses into RAG buckets with the shared classifier. */
export function tallyComplianceRag(statuses: Iterable<string | null | undefined>): ComplianceRagTally {
  const t: ComplianceRagTally = { pass: 0, partial: 0, fail: 0, not_assessed: 0, not_applicable: 0 };
  for (const s of statuses) addRag(t, complianceRagStatus(s));
  return t;
}

/** Add one RAG bucket to a tally (exhaustive over the union). */
export function addRag(t: ComplianceRagTally, rag: ComplianceRag): void {
  switch (rag) {
    case 'pass': t.pass += 1; return;
    case 'partial': t.partial += 1; return;
    case 'fail': t.fail += 1; return;
    case 'not-assessed': t.not_assessed += 1; return;
    case 'not-applicable': t.not_applicable += 1; return;
    default: {
      const unreachable: never = rag;
      return unreachable;
    }
  }
}

/**
 * #3425 compliance score rule (0..100, two decimals):
 *   (100 * pass + 50 * partial) / (pass + partial + fail)
 * Not-applicable and not-assessed controls are excluded from the denominator,
 * so marking a control N/A can neither raise nor lower the score. Returns null
 * when no control was assessed pass/partial/fail. Same formula as APP-REG-01
 * (`module-service-assessment` application.ts) so #3407 can adopt it.
 */
export function complianceScore(t: Pick<ComplianceRagTally, 'pass' | 'partial' | 'fail'>): number | null {
  const denominator = t.pass + t.partial + t.fail;
  if (denominator === 0) return null;
  return Math.round(((t.pass * 100 + t.partial * 50) / denominator) * 100) / 100;
}

/** A raw compliance regime as read from `wsp-plan.yaml` `compliance.regimes[]`. */
export interface RawComplianceRegime {
  id?: unknown;
  name?: unknown;
  controls?: Array<{ status?: unknown }> | unknown;
}

/** Per-framework compliance tally for the Design 113 section 6.2 hub field. */
export interface ComplianceFrameworkSummary extends ComplianceRagTally {
  id: string;
  name: string;
}

/**
 * Summarise `wsp-plan.yaml` compliance regimes into per-framework pass/partial/
 * fail/not_assessed/not_applicable counts, using the shared classifier
 * (#3425: N/A no longer counts as fail). Returns undefined when there are no
 * regimes with controls so the hub field stays absent.
 */
export function summariseRegimeCompliance(regimes: unknown): ComplianceFrameworkSummary[] | undefined {
  if (!Array.isArray(regimes)) return undefined;
  const out: ComplianceFrameworkSummary[] = [];
  for (const r of regimes as RawComplianceRegime[]) {
    const controls = Array.isArray(r?.controls) ? (r.controls as Array<{ status?: unknown }>) : [];
    if (controls.length === 0) continue;
    const tally: ComplianceFrameworkSummary = {
      id: String(r?.id ?? 'UNKNOWN').toUpperCase(),
      name: typeof r?.name === 'string' ? r.name : String(r?.id ?? 'UNKNOWN'),
      ...tallyComplianceRag(controls.map((c) => (typeof c?.status === 'string' ? c.status : null))),
    };
    out.push(tally);
  }
  return out.length > 0 ? out : undefined;
}
