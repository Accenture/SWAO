// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Phase 2 rule -- DYN-07 authentication surface mapping (#1267)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 083 Section 3.1 DYN-07.
// Converts the authEndpoints extraction into a DYN-07 signal. Coverage ratio:
//   >= 100% of screens  -> informational (per-screen session validation)
//   >  0% of screens    -> medium (partial session validation)
//   0  screens with auth -> low (session pre-established or token-based)
// Returns null when screensProcessed == 0.

import type { Signal } from '@swao/core';
import type { ExtractedSignals } from '../extractor.js';

export function mapAuthSurface(
  extracted: Pick<ExtractedSignals, 'authEndpoints'>,
  screensProcessed: number,
): Signal | null {
  if (screensProcessed === 0) return null;

  const { authEndpoints } = extracted;

  if (authEndpoints.length === 0) {
    return {
      id: 'DYN-07',
      source: 'dynamic_analysis',
      category: 'application',
      severity: 'low',
      derivation:
        'No authentication endpoint calls detected during crawl. ' +
        'Session may be pre-established or the application uses a stored token not visible in the network log.',
      evidence: [`${screensProcessed} screen(s) crawled -- 0 auth endpoint calls observed`],
      confidence: 'medium',
    };
  }

  const screensWithAuth = new Set(authEndpoints.flatMap((e) => e.screens)).size;
  const coverage = screensWithAuth / screensProcessed;
  const severity = coverage >= 1.0 ? 'informational' : 'medium';

  const evidence = authEndpoints.map(
    (e) => `${e.path} [screens: ${e.screens.join(', ')}]`,
  );

  return {
    id: 'DYN-07',
    source: 'dynamic_analysis',
    category: 'application',
    severity,
    derivation:
      `Auth surface: ${authEndpoints.length} distinct auth endpoint pattern(s) detected ` +
      `across ${screensWithAuth} of ${screensProcessed} screen(s) ` +
      `(${Math.round(coverage * 100)}% coverage).`,
    evidence,
    confidence: 'medium',
  };
}
