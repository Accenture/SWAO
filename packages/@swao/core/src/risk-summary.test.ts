// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library -- risk register summary (Design 113 section 6.2)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { normalizeRiskLikelihood, normalizeRiskImpact, summariseRiskRegister } from './risk-summary.js';

describe('risk normalisation (#3402, shared with the publication extractor)', () => {
  it('collapses likelihood to low/medium/high', () => {
    expect(normalizeRiskLikelihood('high')).toBe('high');
    expect(normalizeRiskLikelihood('medium')).toBe('medium');
    expect(normalizeRiskLikelihood('low')).toBe('low');
    expect(normalizeRiskLikelihood('unknown')).toBe('low');
    expect(normalizeRiskLikelihood(undefined)).toBe('low');
  });
  it('folds impact critical into high', () => {
    expect(normalizeRiskImpact('critical')).toBe('high');
    expect(normalizeRiskImpact('high')).toBe('high');
    expect(normalizeRiskImpact('medium')).toBe('medium');
    expect(normalizeRiskImpact('low')).toBe('low');
    expect(normalizeRiskImpact('nonsense')).toBe('low');
  });
});

describe('summariseRiskRegister (#3402)', () => {
  it('buckets by {likelihood}_{impact}', () => {
    expect(summariseRiskRegister([
      { likelihood: 'high', impact: 'critical' },
      { likelihood: 'high', impact: 'high' },
      { likelihood: 'medium', impact: 'low' },
      { likelihood: 'bogus', impact: 'medium' },
    ])).toEqual({ high_high: 2, medium_low: 1, low_medium: 1 });
  });
  it('returns undefined for no items', () => {
    expect(summariseRiskRegister([])).toBeUndefined();
    expect(summariseRiskRegister(undefined)).toBeUndefined();
  });
});
