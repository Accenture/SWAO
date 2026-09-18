// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module -- DYN-06 third-party script detection rule
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 083 Section 3.2 -- DYN-06 signal: third-party script sources.
// Reads ThirdPartyScript[] collected by runDomChecks in extractor.ts.

import type { Signal } from '@swao/core';
import type { ThirdPartyScript } from '../extractor.js';
import type { AnalyticsDomain } from '../analytics-blocklist.js';

// Categories that indicate data exfiltration risk (HIGH severity).
const HIGH_CATEGORIES = new Set(['analytics', 'social-pixel', 'advertising', 'tag-manager']);

function hostnameSeverity(
  hostname: string,
  blocklist: AnalyticsDomain[],
  blocklistAvailable: boolean,
): { severity: 'high' | 'medium'; category: string } {
  const entry = blocklist.find(
    (b) => hostname === b.domain || hostname.endsWith('.' + b.domain),
  );
  if (entry) {
    return {
      severity: HIGH_CATEGORIES.has(entry.category) ? 'high' : 'medium',
      category: entry.category,
    };
  }
  return {
    severity: blocklistAvailable ? 'high' : 'medium',
    category: 'unknown',
  };
}

export function detectThirdPartyScripts(
  extracted: { thirdPartyScripts: ThirdPartyScript[] },
  blocklist: AnalyticsDomain[] = [],
): Signal | null {
  if (extracted.thirdPartyScripts.length === 0) return null;

  const blocklistAvailable = blocklist.length > 0;
  const byHost = new Map<string, { screens: Set<string>; severity: 'high' | 'medium'; category: string }>();
  for (const script of extracted.thirdPartyScripts) {
    let hostname: string;
    try {
      hostname = new URL(script.src).hostname;
    } catch {
      continue;
    }
    if (!byHost.has(hostname)) {
      byHost.set(hostname, { screens: new Set(), ...hostnameSeverity(hostname, blocklist, blocklistAvailable) });
    }
    byHost.get(hostname)!.screens.add(script.screen_slug);
  }

  if (byHost.size === 0) return null;

  const worstSeverity: 'high' | 'medium' = [...byHost.values()].some((v) => v.severity === 'high') ? 'high' : 'medium';
  const evidence = [...byHost.entries()].map(
    ([hostname, { screens, category }]) =>
      `${hostname} [${category}] on screens: ${[...screens].join(', ')}`,
  );
  const blocklistNote = blocklistAvailable
    ? ''
    : ' Blocklist unavailable -- all external scripts rated MEDIUM (supply chain risk).';

  return {
    id: 'DYN-06',
    source: 'dynamic_analysis',
    category: 'application',
    severity: worstSeverity,
    derivation:
      `${byHost.size} external script host(s) loaded by this application (GDPR Art.44, supply chain risk).` +
      blocklistNote,
    evidence,
    confidence: blocklistAvailable ? 'high' : 'medium',
  };
}
