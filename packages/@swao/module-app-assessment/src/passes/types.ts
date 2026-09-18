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

// PassContext, PassHeader, PassResult, PassRunner, DataSource moved to @swao/core (#0544).
// Re-exported here for compatibility during the sprint-057 transition window.
export type { PassContext, PassHeader, PassResult, PassRunner, DataSource } from '@swao/core';

/** LLM pass response shape -- internal to LLM-dependent passes; not a plugin
 *  contract type so it stays in @swao/swao rather than moving to @swao/core. */
export interface LlmPassResponse {
  signals: Array<{
    id: string;
    source: string;
    category: string;
    severity?: string;
    derivation: string;
    evidence: string[];
    confidence: string;
    implies?: string[];
    signal_ref?: string;
  }>;
  assessment: Record<string, unknown>;
}
