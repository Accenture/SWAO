// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3416: shared absence-statement predicate (derive-plan + publication).

import { describe, it, expect } from 'vitest';
import { isAbsenceEvidenceRef } from './evidence-absence.js';

describe('isAbsenceEvidenceRef (#3416)', () => {
  it.each([
    '0 source files scanned',
    'No application code provided',
    '  no dockerfile found',
    'N/A',
    'none',
    'Missing deployment manifest',
    'Undetermined',
  ])('treats %j as an absence statement', (ref) => {
    expect(isAbsenceEvidenceRef(ref)).toBe(true);
  });

  it.each([
    'src/main/resources/application.yml',
    'pom.xml',
    'wsp/inputs/cmdb/export.csv',
    'research/vendor-notes.md',
    'EVD-POM-XML',
    'No.1 release notes.md',
  ])('treats %j as a real evidence ref', (ref) => {
    expect(isAbsenceEvidenceRef(ref)).toBe(false);
  });
});
