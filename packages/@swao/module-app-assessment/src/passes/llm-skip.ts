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

/** Marker written to a pass's `assessment` block when the LLM answered but the
 *  answer could not be used (not JSON, truncated, or failing the pass's
 *  validation). Distinct from NO_LLM_REASON so operators are not told to
 *  configure a provider that is already configured (#3158). */
export const INVALID_LLM_RESPONSE_REASON = 'invalid_llm_response';

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

/**
 * Build the graceful-degradation PassResult an LLM-dependent pass returns when
 * the LLM answered but the answer is unusable (#3158). Same shape as
 * llmSkipResult (`status: 'not_applicable'` + one PREFIX-00 signal) so the
 * assessment continues instead of aborting or writing a 0-signal stub.
 */
export function llmInvalidResponseResult(opts: LlmSkipOptions & { detail: string }): PassResult {
  const skipSignal: Signal = {
    id: `${opts.signalPrefix}-00`,
    source: 'static_analysis',
    category: 'application',
    severity: 'informational',
    derivation:
      `Pass ${opts.name} degraded: the LLM response could not be used (${opts.detail}). ` +
      'No signals were derived from it. Re-run the assessment, or select a model with a larger output limit.',
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
      skipped_reason: INVALID_LLM_RESPONSE_REASON,
      invalid_response_detail: opts.detail,
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

/**
 * `--skip-llm` (#3158): the host withholds the LLM provider from every pass,
 * so LLM-dependent passes that stay in the run (DATA, SYNTH) return the
 * llmSkipResult shape. The "no provider is configured" wording would be
 * misleading when a provider IS configured but the operator opted out, so the
 * host rewrites the PREFIX-00 derivation and adds `skip_llm_flag: true`.
 * `skipped_reason` stays NO_LLM_REASON so doctor, the HTML health section and
 * run-manifest.provenance.llm_skipped_passes keep detecting the skip uniformly.
 * Results that are not an llmSkipResult are returned unchanged.
 */
export function markSkippedByFlag(result: PassResult): PassResult {
  if (result.assessment?.['skipped_reason'] !== NO_LLM_REASON) return result;
  const prefix = result.pass.signal_prefix;
  return {
    ...result,
    signals: result.signals.map((s) =>
      prefix && s.id === `${prefix}-00`
        ? {
            ...s,
            derivation:
              `Pass ${result.pass.name} requires an LLM and was skipped because --skip-llm (alias --no-llm) was set. ` +
              'Re-run without the flag to evaluate this pass.',
          }
        : s,
    ),
    assessment: { ...result.assessment, skip_llm_flag: true },
  };
}
