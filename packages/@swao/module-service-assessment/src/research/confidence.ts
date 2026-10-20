// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Research confidence model (#3091, Design 103 §4.4, §6.2.6).
 *
 *   high    direct API match including the version
 *   medium  product match without a version
 *   low     API error, no slug / vendor match, or extrapolated
 *
 * A topic's confidence is the minimum over its source blocks that ran
 * (skipped blocks do not count); the app composite is the minimum over
 * researched topics.
 */

import type { ResearchConfidence } from './schema.js';

const RANK: Record<ResearchConfidence, number> = { low: 0, medium: 1, high: 2 };

export function minConfidence(values: ReadonlyArray<ResearchConfidence | null | undefined>): ResearchConfidence | null {
  const present = values.filter((v): v is ResearchConfidence => v === 'high' || v === 'medium' || v === 'low');
  if (present.length === 0) return null;
  return present.reduce((a, b) => (RANK[b] < RANK[a] ? b : a));
}

/** Topic confidence from its blocks; a block with `skipped_reason` is excluded. */
export function topicConfidence(blocks: ReadonlyArray<{ confidence: ResearchConfidence | null; skipped_reason?: string }>): ResearchConfidence | null {
  return minConfidence(blocks.filter((b) => !b.skipped_reason).map((b) => b.confidence));
}

export interface ConfidenceDistribution { high: number; medium: number; low: number; none: number }

export function distribution(values: ReadonlyArray<ResearchConfidence | null>): ConfidenceDistribution {
  const d: ConfidenceDistribution = { high: 0, medium: 0, low: 0, none: 0 };
  for (const v of values) d[v ?? 'none']++;
  return d;
}

export function formatDistribution(d: ConfidenceDistribution): string {
  return `high: ${d.high}, medium: ${d.medium}, low: ${d.low}${d.none > 0 ? `, nothing to look up: ${d.none}` : ''}`;
}
