// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module -- DYN-05 PII form field security rule
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 083 Section 3.2 -- DYN-05 signal: PII form field security.
// Reads PiiFormField[] collected by runDomChecks in extractor.ts.

import type { Signal } from '@swao/core';
import type { PiiFormField } from '../extractor.js';

export function detectPiiFormFields(extracted: { piiForms: PiiFormField[] }): Signal | null {
  if (extracted.piiForms.length === 0) return null;

  const screens = [...new Set(extracted.piiForms.map((f) => f.screen_slug))];
  const evidence = extracted.piiForms.map((f) => `[${f.screen_slug}] ${f.element} -- ${f.issue}`);

  return {
    id: 'DYN-05',
    source: 'dynamic_analysis',
    category: 'application',
    severity: 'medium',
    derivation:
      `${extracted.piiForms.length} form field(s) on ${screens.length} screen(s) are missing ` +
      `required autocomplete attributes (GDPR Art.5(1)(f), BSI C5 IDM-05). ` +
      `Browsers may suppress autofill or warn users when autocomplete is absent on credential/PII fields.`,
    evidence,
    confidence: 'medium',
  };
}
