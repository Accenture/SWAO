// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Phase 2 rule -- DYN-03 live API endpoint inventory (#1265)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 083 Section 3.1 DYN-03.
// Converts the apiEndpoints extraction (deduplicated fetch URL path templates)
// into an informational DYN-03 signal. Returns null when no fetch calls
// were observed. The endpoint list feeds the EGR pass as supplementary evidence.

import type { Signal } from '@swao/core';
import type { ExtractedSignals } from '../extractor.js';

export function inventoryApiEndpoints(
  extracted: Pick<ExtractedSignals, 'apiEndpoints'>,
): Signal | null {
  const { apiEndpoints } = extracted;
  if (apiEndpoints.length === 0) return null;

  return {
    id: 'DYN-03',
    source: 'dynamic_analysis',
    category: 'application',
    severity: 'informational',
    derivation:
      `Runtime API surface map: ${apiEndpoints.length} distinct fetch endpoint pattern(s) ` +
      `observed during crawl. Review for data classification and access-control coverage.`,
    evidence: apiEndpoints,
    confidence: 'high',
  };
}
