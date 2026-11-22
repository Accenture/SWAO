// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module -- LZ gap classification tests
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { deriveLzGapType, lzBlockedGapLabel } from './lz-gap-type.js';

describe('deriveLzGapType / lzBlockedGapLabel (#2331, #3569)', () => {
  const v = (...verdicts: string[]) => verdicts.map((verdict) => ({ verdict }));

  it('keeps the existing classifications and labels', () => {
    expect(deriveLzGapType(v('SOVEREIGNTY_GAP'))).toBe('sovereignty');
    expect(deriveLzGapType(v('NOT_AVAILABLE_IN_REGION', 'SUPPORTED'))).toBe('availability');
    expect(deriveLzGapType(v('SOVEREIGNTY_GAP', 'NOT_AVAILABLE_IN_REGION'))).toBe('sovereignty+availability');
    expect(deriveLzGapType(v('SUPPORTED', 'VERSION_MISMATCH'))).toBe('other');
    expect(deriveLzGapType([])).toBe('other');
    expect(lzBlockedGapLabel('sovereignty')).toBe('  BLOCKED (sovereignty)');
    expect(lzBlockedGapLabel('availability')).toBe('  BLOCKED (availability)');
    expect(lzBlockedGapLabel('sovereignty+availability')).toBe('  BLOCKED (sovereignty + availability)');
    expect(lzBlockedGapLabel('other')).toBe('');
  });

  it('classifies BLOCKED_BY_POLICY as a policy gap, not as other', () => {
    expect(deriveLzGapType(v('BLOCKED_BY_POLICY'))).toBe('policy');
    expect(lzBlockedGapLabel('policy')).toBe('  BLOCKED (policy)');
    expect(deriveLzGapType(v('NOT_AVAILABLE_IN_REGION', 'BLOCKED_BY_POLICY'))).toBe('availability+policy');
    expect(lzBlockedGapLabel(deriveLzGapType(v('SOVEREIGNTY_GAP', 'NOT_AVAILABLE_IN_REGION', 'BLOCKED_BY_POLICY'))))
      .toBe('  BLOCKED (sovereignty + availability + policy)');
  });

  it('does not treat UNVERIFIED as a gap', () => {
    expect(deriveLzGapType(v('UNVERIFIED', 'SUPPORTED'))).toBe('other');
  });
});
