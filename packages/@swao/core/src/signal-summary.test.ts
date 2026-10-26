// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library -- signal summary helpers (Design 113 section 6.2)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { countSignalsBySeverity, countBlockerSignals, sortSignalsBySeverity } from './signal-summary.js';

const S = [
  { id: 'A', severity: 'medium' },
  { id: 'B', severity: 'critical' },
  { id: 'C', severity: 'high' },
  { id: 'D', severity: 'low' },
  { id: 'E', severity: 'high' },
  { id: 'F', severity: 'positive' },
];

describe('signal-summary helpers (#3402, shared with the publication extractor)', () => {
  it('counts every signal by severity (matches summary.signal_counts)', () => {
    expect(countSignalsBySeverity(S)).toEqual({ medium: 1, critical: 1, high: 2, low: 1, positive: 1 });
  });

  it('blocker count is critical + high (any outcome)', () => {
    expect(countBlockerSignals(S)).toBe(3);
  });

  it('sorts by severity, highest first, positives last', () => {
    expect(sortSignalsBySeverity(S).map((s) => s.id)).toEqual(['B', 'C', 'E', 'A', 'D', 'F']);
  });

  it('does not mutate the input', () => {
    const copy = [...S];
    sortSignalsBySeverity(S);
    expect(S).toEqual(copy);
  });

  it('is empty for no signals', () => {
    expect(countSignalsBySeverity([])).toEqual({});
    expect(countBlockerSignals([])).toBe(0);
    expect(sortSignalsBySeverity([])).toEqual([]);
  });
});
