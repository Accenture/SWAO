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

// #0257 / #3416: absence statements in `signals[].evidence[]`.
//
// A pass that has nothing to evidence sometimes writes a sentence such as
// "0 source files scanned" or "No application code provided" into the
// evidence list. These are not evidence: derive-plan drops them from
// `evidence_catalogue` / `evidence_index` (they never become an EVD- key),
// and the publication renders them as plain text without counting them as
// unresolved evidence refs. Both sides share this one predicate so the
// catalogue and the publish-time check cannot drift apart.

const ABSENCE_SENTINEL_RE = /^(no [a-z]|0 source files|n\/a|none|missing|undetermined)/i;

/** True when an evidence ref is an absence statement, not a reference to evidence. */
export function isAbsenceEvidenceRef(ref: string): boolean {
  return ABSENCE_SENTINEL_RE.test(ref.trim());
}
