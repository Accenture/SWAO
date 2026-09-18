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

import type { Signal, SignalOutcome, Assessor } from './plugin-types.js';

export interface EnrichOptions {
  assessor: Assessor;
  assessedAt: string;
}

/**
 * Apply v0.10 auditor-grade fields to a list of signals (ADR-0025; design 020).
 *
 * Defaults applied (only when missing):
 * - `assessor`: from options (rule_engine for deterministic passes; llm for
 *   LLM-backed passes).
 * - `assessed_at`: ISO timestamp from options.
 * - `outcome`: inferred from severity per the v0.10 default mapping:
 *     positive   -> outcome=positive
 *     informational -> outcome=neutral
 *     critical|high|medium|low -> outcome=negative
 *     missing     -> outcome=indeterminate
 *
 * False-positive narrative (false_positive_considered + ruled_out) is
 * NOT defaulted: doctor probe (#0170) warns when it is missing on a
 * negative-outcome signal at severity >= medium during the v0.10 window.
 * v0.11 will tighten to required.
 *
 * derivation_chain is also not defaulted: it carries pass-specific
 * semantics that the engine knows; this enricher does not invent links.
 */
export function inferOutcomeFromSeverity(
  severity: Signal['severity'],
): SignalOutcome {
  if (severity === 'positive') return 'positive';
  if (severity === 'informational') return 'neutral';
  if (severity === 'critical' || severity === 'high' || severity === 'medium' || severity === 'low') {
    return 'negative';
  }
  return 'indeterminate';
}

export function enrichSignal(signal: Signal, options: EnrichOptions): Signal {
  const next: Signal = { ...signal };
  if (next.outcome === undefined) {
    next.outcome = inferOutcomeFromSeverity(next.severity);
  }
  if (next.assessor === undefined) {
    next.assessor = options.assessor;
  }
  if (next.assessed_at === undefined) {
    next.assessed_at = options.assessedAt;
  }
  return next;
}

export function enrichSignals(signals: Signal[], options: EnrichOptions): Signal[] {
  return signals.map((s) => enrichSignal(s, options));
}
