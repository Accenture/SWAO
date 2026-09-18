// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Phase 2 rule -- DYN-04 HTTP error responses (#1266)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 083 Section 3.1 DYN-04.
// Converts the httpErrors extraction into a DYN-04 signal. Severity is
// HIGH for 5xx responses (backend failure), MEDIUM for 404 (broken reference),
// LOW for other 4xx / null-status. Aggregate severity = highest class found.

import type { Signal } from '@swao/core';
import type { ExtractedSignals } from '../extractor.js';

export function detectHttpErrors(
  extracted: Pick<ExtractedSignals, 'httpErrors'>,
): Signal | null {
  const { httpErrors } = extracted;
  if (httpErrors.length === 0) return null;

  const has5xx = httpErrors.some((e) => e.status >= 500);
  const has404 = httpErrors.some((e) => e.status === 404);
  const severity = has5xx ? 'high' : has404 ? 'medium' : 'low';

  // Deduplicate by URL, merging screen references.
  const byUrl = new Map<string, { status: number; screens: Set<string> }>();
  for (const err of httpErrors) {
    if (!byUrl.has(err.url)) byUrl.set(err.url, { status: err.status, screens: new Set() });
    byUrl.get(err.url)!.screens.add(err.screen_slug);
  }

  const evidence = [...byUrl.entries()]
    .slice(0, 10)
    .map(([url, data]) => `HTTP ${data.status}: ${url} [screens: ${[...data.screens].join(', ')}]`);

  return {
    id: 'DYN-04',
    source: 'dynamic_analysis',
    category: 'application',
    severity,
    derivation:
      `HTTP error responses detected: ${byUrl.size} distinct URL(s) returned error status ` +
      `during crawl. 5xx = backend failure; 404 = broken reference; other 4xx = client or auth error.`,
    evidence,
    confidence: 'high',
  };
}
