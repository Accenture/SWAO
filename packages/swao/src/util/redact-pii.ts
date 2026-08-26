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

// PII log-redactor relocated to @swao/core (#0591). Re-exported here for the
// existing '../util/redact-pii.js' import sites (log.ts, redact-pre-llm, tests).
export { emptyCounts, redactPiiString, redactPiiValue } from '@swao/core';
export type { RedactionCounts } from '@swao/core';
