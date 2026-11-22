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

// #4287 (D-9): the 7R to TIME matching is the single source of the 7R verdict.
import { describe, it, expect } from 'vitest';
import { SEVEN_R_TIME, TIME_TO_SEVEN_R, resolveSevenRVerdict, sevenRMatchesTime, sevenRToTime } from './seven-r-time.js';
import { TIME_QUADRANTS } from './portfolio-summary.js';

describe('7R to TIME matching (#4287)', () => {
  it('every TIME default maps back to its own TIME family (no built-in mismatch)', () => {
    for (const q of TIME_QUADRANTS) {
      if (q === 'Invest') continue; // Invest keeps Retain (Design 113 section 8: keep and develop with the vendor)
      expect(sevenRMatchesTime(TIME_TO_SEVEN_R[q], q), q).toBe(true);
    }
  });

  it('normalises labels', () => {
    expect(sevenRToTime('Re-architect')).toBe('Invest');
    expect(sevenRToTime('REPLATFORM')).toBe('Migrate');
    expect(sevenRToTime('Unknown')).toBeNull();
    expect(Object.keys(SEVEN_R_TIME)).toContain('rehost');
  });

  it('keeps a synthesis verdict that matches TIME; Migrate and Migrate-Critical are one family', () => {
    expect(resolveSevenRVerdict({ time: 'Migrate-Critical', synthesis: 'Replatform' })).toEqual({ label: 'Replatform', source: 'synthesis' });
    expect(resolveSevenRVerdict({ time: 'Eliminate', synthesis: 'Retire' })).toEqual({ label: 'Retire', source: 'synthesis' });
  });

  it('replaces a synthesis verdict that contradicts TIME and keeps it visible', () => {
    const v = resolveSevenRVerdict({ time: 'Migrate-Critical', synthesis: 'Refactor' });
    expect(v).toMatchObject({ label: 'Rehost', source: 'derived_from_time', synthesis: 'Refactor' });
    expect(v.reason).toBe('synthesis verdict Refactor maps to TIME Invest, but the TIME classification is Migrate-Critical');
    expect(resolveSevenRVerdict({ time: 'Tolerate', synthesis: 'Something' }).reason).toBe('synthesis verdict Something has no TIME mapping');
  });

  it('without a synthesis verdict the TIME default; the analyst override always wins', () => {
    expect(resolveSevenRVerdict({ time: 'Migrate', synthesis: null })).toEqual({ label: 'Rehost', source: 'derived_from_time' });
    expect(resolveSevenRVerdict({ time: 'Migrate', synthesis: 'Refactor', analyst: 'Repurchase' })).toEqual({ label: 'Repurchase', source: 'analyst' });
  });
});
