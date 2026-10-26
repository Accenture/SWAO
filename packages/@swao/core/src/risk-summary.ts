// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library -- risk register summary (Design 113 section 6.2)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Shared risk-register normalisation so the publication extractor and the
 * portfolio summary bucket risks on the same likelihood x impact scale (#3402).
 * Vocabulary matches the extractor (extractor.ts section 9): likelihood collapses
 * to low/medium/high; impact folds `critical` into `high`.
 */

export type RiskLevel = 'low' | 'medium' | 'high';

/** Normalise a risk likelihood to low/medium/high (anything but high/medium -> low). */
export function normalizeRiskLikelihood(v?: unknown): RiskLevel {
  return v === 'high' || v === 'medium' ? v : 'low';
}

/** Normalise a risk impact to low/medium/high (critical folds into high). */
export function normalizeRiskImpact(v?: unknown): RiskLevel {
  return v === 'critical' || v === 'high' ? 'high' : v === 'medium' ? 'medium' : 'low';
}

/**
 * Count risk-register items into `{likelihood}_{impact}` buckets (each low/medium/
 * high), for the Design 113 section 6.2 `risk_counts` field. Returns undefined
 * when there are no items so the hub field stays absent.
 */
export function summariseRiskRegister(
  items: unknown,
): Record<string, number> | undefined {
  if (!Array.isArray(items) || items.length === 0) return undefined;
  const counts: Record<string, number> = {};
  for (const it of items as Array<{ likelihood?: unknown; impact?: unknown }>) {
    const key = `${normalizeRiskLikelihood(it?.likelihood)}_${normalizeRiskImpact(it?.impact)}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.keys(counts).length > 0 ? counts : undefined;
}
