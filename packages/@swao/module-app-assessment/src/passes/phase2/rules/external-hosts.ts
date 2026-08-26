// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Phase 2 rule -- DYN-02 external host calls (#1264)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 083 Section 3.1 DYN-02.
// Converts the externalHosts extraction from runNetworkRules() into a
// canonical DYN-02 signal. Severity is HIGH when any external request used
// resourceType 'fetch' (data exchange); MEDIUM for static assets only.

import type { Signal } from '@swao/core';
import type { ExtractedSignals } from '../extractor.js';

export function detectExternalHosts(
  extracted: Pick<ExtractedSignals, 'externalHosts'>,
): Signal | null {
  const { externalHosts } = extracted;
  if (externalHosts.length === 0) return null;

  const hasFetch = externalHosts.some((h) => h.resource_types.includes('fetch'));

  const evidence = externalHosts.map(
    (h) => `${h.hostname}: ${h.request_count} request(s) [types: ${h.resource_types.join(', ')}]`,
  );

  return {
    id: 'DYN-02',
    source: 'dynamic_analysis',
    category: 'application',
    severity: hasFetch ? 'high' : 'medium',
    derivation:
      `${externalHosts.length} distinct external host(s) contacted during crawl. ` +
      `GDPR Art.44 international transfer risk applies where non-EU hosts are involved.`,
    evidence,
    confidence: 'high',
  };
}
