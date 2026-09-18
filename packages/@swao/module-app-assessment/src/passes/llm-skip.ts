// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import type { PassResult, Signal } from '@swao/core';

/** Marker written to a pass's `assessment` block when the pass degraded
 *  because no LLM provider was configured. swao doctor and the HTML report
 *  health section detect this uniformly across all LLM-dependent passes
 *  (#0550). LLM-optional alignment, Principle 10. */
export const NO_LLM_REASON = 'no_llm_provider';

/** Marker written to a pass's `assessment` block when the pass degraded
 *  because the LLM provider exhausted all retry attempts due to a connectivity
 *  failure (#0716). Distinct from NO_LLM_REASON so the TUI can surface the
 *  difference ("provider unreachable" vs "provider not configured"). */
export const CONNECTIVITY_FAILURE_REASON = 'connectivity_failure';

export interface LlmSkipOptions {
  /** Numeric pass id (PassHeader.id), e.g. 3 for DATA. */
  id: number;
  /** Canonical pass name, e.g. 'data_classification'. */
  name: string;
  /** Signal prefix, e.g. 'DATA'. */
  signalPrefix: string;
  iter: number;
  assessedAt: string;
  /** Extra assessment fields to merge alongside the skip marker. */
  assessment?: Record<string, unknown>;
}

/**
 * Build the graceful-skip PassResult an LLM-dependent pass returns when
 * `ctx.llm` is absent. The pass completes (the assessment is not aborted);
 * it emits a single informational PREFIX-00 signal explaining the skip and
 * records `skipped: true` + `skipped_reason: 'no_llm_provider'` in its
 * assessment block so downstream tooling can surface it.
 *
 * Pattern aligned with Pass 12 (BLOCKS) / Pass 11 (COMP), which already
 * degrade gracefully without an LLM (#0550).
 */
/**
 * Build the graceful-degradation PassResult an LLM-dependent pass returns when
 * the LLM provider exhausted all retry attempts due to connectivity issues (#0716).
 * The assessment is not aborted; the pass emits a single critical PREFIX-00 signal
 * explaining the connectivity failure.
 */
export function llmConnectivityFailureResult(opts: LlmSkipOptions): PassResult {
  const skipSignal: Signal = {
    id: `${opts.signalPrefix}-00`,
    source: 'static_analysis',
    category: 'application',
    severity: 'informational',
    derivation:
      `Pass ${opts.name} degraded: the LLM provider exhausted all retry attempts due to connectivity failure. ` +
      'Check the assessment log for retry details. Re-run assess when network access is restored.',
    evidence: [],
    confidence: 'high',
    outcome: 'indeterminate',
  };
  return {
    pass: {
      id: opts.id,
      name: opts.name,
      signal_prefix: opts.signalPrefix,
      status: 'not_applicable',
      iter: opts.iter,
      assessed_at: opts.assessedAt,
    },
    signals: [skipSignal],
    assessment: {
      ...opts.assessment,
      skipped: true,
      skipped_reason: CONNECTIVITY_FAILURE_REASON,
    },
  };
}

export function llmSkipResult(opts: LlmSkipOptions): PassResult {
  const skipSignal: Signal = {
    id: `${opts.signalPrefix}-00`,
    source: 'static_analysis',
    category: 'application',
    severity: 'informational',
    derivation:
      `Pass ${opts.name} requires an LLM provider and was skipped: no LLM provider is configured. ` +
      'Set providers.llm.primary in .swao.yml or export SWAO_LLM_PROVIDER to enable this pass.',
    evidence: [],
    confidence: 'high',
    outcome: 'indeterminate',
  };
  return {
    pass: {
      id: opts.id,
      name: opts.name,
      signal_prefix: opts.signalPrefix,
      status: 'not_applicable',
      iter: opts.iter,
      assessed_at: opts.assessedAt,
    },
    signals: [skipSignal],
    assessment: {
      ...opts.assessment,
      skipped: true,
      skipped_reason: NO_LLM_REASON,
    },
  };
}
