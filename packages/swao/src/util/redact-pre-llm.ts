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

// Pre-LLM egress redactor relocated to @swao/core (#0591). Re-exported here for
// the existing '../util/redact-pre-llm.js' import sites (assess, doctor-pii,
// the LLM providers, report-scrub, redaction-report, tests). The process-global
// redaction state lives in the single @swao/core instance, so setAllowlist /
// setScrubPersonName from swao and redactPreLlm from a module share one state.
export {
  emptyPreLlmCounts,
  setAllowlist,
  setScrubPersonName,
  _resetForTests,
  redactPreLlm,
  redactForReport,
} from '@swao/core';
export type { PreLlmRedactionCounts } from '@swao/core';
