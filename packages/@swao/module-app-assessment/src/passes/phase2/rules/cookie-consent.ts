// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module -- DYN-08 cookie consent absence rule
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 083 Section 3.2 -- DYN-08 signal: cookie consent absence.
// Reads cookieConsentPresent flag from ExtractedSignals (set by runDomChecks).

import type { Signal } from '@swao/core';

export function detectCookieConsentAbsence(
  extracted: { cookieConsentPresent: boolean },
  screensProcessed: number,
): Signal | null {
  if (screensProcessed === 0) return null;
  if (extracted.cookieConsentPresent) return null;

  return {
    id: 'DYN-08',
    source: 'dynamic_analysis',
    category: 'application',
    severity: 'medium',
    derivation:
      `No cookie consent or privacy control UI element was detected on any of the ` +
      `${screensProcessed} crawled screen(s). GDPR Art.7 requires freely given, specific, ` +
      `and informed consent before cookies or similar tracking mechanisms are activated.`,
    evidence: [
      `Cookie consent banner absent across ${screensProcessed} crawled screen(s). ` +
      `Checked for: OneTrust, Cookiebot, Usercentrics, CookieYes, and generic consent/cookie class/id patterns.`,
    ],
    confidence: 'low',
  };
}
