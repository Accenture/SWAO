// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library -- signal summary helpers (Design 113 section 6.2)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Shared signal-summary helpers so the publication extractor and the portfolio
 * summary compute `signal_counts`, `blocker_count` and `top_findings` from the
 * same code (#3402). Deriving these twice drifted the hub from the publication;
 * both sides now call these. The input is any object carrying a `severity`
 * string, so each caller passes its own signal shape.
 */

/** Severity ordering for the top-findings projection (publication SeveritySchema
 *  order, positives last). Unknown severities sort to the end. */
export const SIGNAL_SEVERITY_RANK: Readonly<Record<string, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  informational: 4,
  positive: 5,
};

/** Count signals by their `severity` value (every severity, matching the
 *  publication summary's `signal_counts`). */
export function countSignalsBySeverity(signals: ReadonlyArray<{ severity: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of signals) counts[s.severity] = (counts[s.severity] ?? 0) + 1;
  return counts;
}

/** Blocker count: signals whose severity is critical or high (any outcome),
 *  matching the publication summary's `blocker_count`. */
export function countBlockerSignals(signals: ReadonlyArray<{ severity: string }>): number {
  return signals.filter((s) => s.severity === 'critical' || s.severity === 'high').length;
}

/** Signals sorted by severity (highest first), stable. Callers slice for the
 *  top-findings list. */
export function sortSignalsBySeverity<T extends { severity: string }>(signals: ReadonlyArray<T>): T[] {
  return [...signals].sort(
    (a, b) => (SIGNAL_SEVERITY_RANK[a.severity] ?? 99) - (SIGNAL_SEVERITY_RANK[b.severity] ?? 99),
  );
}
