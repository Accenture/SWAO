// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library -- landing-zone fit summary (Design 113 section 6.2)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { lzCatCheckResult, countLzFitBlockers } from './lz-fit-summary.js';

describe('lzCatCheckResult (#3402, shared with the publication extractor)', () => {
  it('classifies the catalogue verdict vocabulary', () => {
    expect(lzCatCheckResult('SUPPORTED')).toBe('pass');
    expect(lzCatCheckResult('AVAILABLE_NOT_ENABLED')).toBe('not_applicable');
    expect(lzCatCheckResult('NEEDS_VERIFICATION')).toBe('fail');
    expect(lzCatCheckResult('')).toBe('fail');
  });
});

describe('countLzFitBlockers (#3402)', () => {
  it('counts only the failing items (not SUPPORTED or AVAILABLE_NOT_ENABLED)', () => {
    expect(countLzFitBlockers([
      { verdict: 'SUPPORTED' },
      { verdict: 'AVAILABLE_NOT_ENABLED' },
      { verdict: 'NEEDS_VERIFICATION' },
      { verdict: 'BLOCKED' },
    ])).toBe(2);
  });
  it('is zero for no items', () => {
    expect(countLzFitBlockers([])).toBe(0);
    expect(countLzFitBlockers(undefined)).toBe(0);
  });
});
