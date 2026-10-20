// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- assess LLM provider preflight (#2201, #3340)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import type { LlmProvider, LlmProviderConfig } from '@swao/module-llm-providers';

export type LlmProviderFactory = (
  appId?: string,
  passName?: string,
  config?: LlmProviderConfig,
) => LlmProvider;

export type LlmPreflightResult =
  | { available: true }
  | { available: false; reason: string };

/**
 * Construct the configured LLM provider once before any pass runs (#2201,
 * #3340). Provider constructors make no network call; they throw for a
 * missing API key (`AnthropicLlmProvider: no API key`), an unknown connector
 * or environment, or a missing credential. assess.ts turns an unavailable
 * result into `llmConfigured = false`, so every LLM-dependent pass takes the
 * existing graceful-skip path (no_llm_provider signal, llm_skipped_passes in
 * the run manifest) instead of throwing inside the pass loop. Before #3340
 * only connector configs were checked; a `type: anthropic` config without a
 * key threw per pass, and the Enterprise entry's unhandledRejection handler
 * kept the process alive until the caller's timeout.
 */
export function preflightLlmProvider(
  factory: LlmProviderFactory,
  appId: string | undefined,
  config: LlmProviderConfig | undefined,
): LlmPreflightResult {
  try {
    factory(appId, 'gateway-preflight', config);
    return { available: true };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** The console warning assess prints when the preflight fails. */
export function llmUnavailableWarning(reason: string): string {
  return (
    `[warn] LLM provider unavailable: ${reason} ` +
    'LLM-dependent passes (data, ctx, synth, comp, blocks) will be skipped. ' +
    'Pass --skip-llm to run without an LLM on purpose.'
  );
}
