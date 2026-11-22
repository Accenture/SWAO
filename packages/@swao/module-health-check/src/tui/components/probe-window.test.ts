// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Doctor module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { UNMEASURED_LIST_LINES } from '@swao/tui-kit';
import { computeProbeWindow } from './probe-window.js';

const TOTAL = 13; // health-check probe count
const ones = (n: number): number[] => Array.from({ length: n }, () => 1);

describe('computeProbeWindow (#1390, #4348 shared height rule)', () => {
  it('shows all probes with no indicators when the budget is large enough', () => {
    expect(computeProbeWindow(0, ones(TOTAL), TOTAL)).toEqual({ start: 0, end: TOTAL, aboveCount: 0, belowCount: 0 });
  });

  it('pages when the rows do not fit; the "more" lines count against the budget', () => {
    const win = computeProbeWindow(0, ones(TOTAL), 12);
    expect(win.start).toBe(0);
    expect(win.end).toBe(11); // 11 rows + the "more" line below
    expect(win.belowCount).toBe(2);
  });

  it('counts the real height of a wrapped row', () => {
    const heights = ones(TOTAL);
    heights[1] = 3; // a fail row whose reason wraps twice
    const win = computeProbeWindow(0, heights, 8);
    // rows 0 to 4 take 1 + 3 + 1 + 1 + 1 = 7 lines, plus the "more" line = 8; row 5 would make 9
    expect(win).toEqual({ start: 0, end: 5, aboveCount: 0, belowCount: TOTAL - 5 });
  });

  it('window is always contiguous, holds the cursor and fits while scrolling', () => {
    for (let cursor = 0; cursor < TOTAL; cursor++) {
      const win = computeProbeWindow(cursor, ones(TOTAL), 9);
      expect(cursor).toBeGreaterThanOrEqual(win.start);
      expect(cursor).toBeLessThan(win.end);
      const used = (win.end - win.start) + (win.aboveCount > 0 ? 1 : 0) + (win.belowCount > 0 ? 1 : 0);
      expect(used).toBeLessThanOrEqual(9);
      expect(win.aboveCount).toBe(win.start);
      expect(win.belowCount).toBe(TOTAL - win.end);
    }
  });

  it('before the first measurement it takes the shared UNMEASURED_LIST_LINES of tui-kit (#4348), "n more" line included', () => {
    const win = computeProbeWindow(99, ones(TOTAL), undefined);
    expect(win.end).toBe(TOTAL);
    expect(win.end - win.start + (win.aboveCount > 0 ? 1 : 0)).toBe(UNMEASURED_LIST_LINES);
    // Wrapped rows count their real lines here too.
    const tall = computeProbeWindow(0, Array.from({ length: TOTAL }, () => 3), undefined);
    expect((tall.end - tall.start) * 3 + (tall.belowCount > 0 ? 1 : 0)).toBeLessThanOrEqual(UNMEASURED_LIST_LINES);
  });

  it('handles the empty list', () => {
    expect(computeProbeWindow(0, [], 30)).toEqual({ start: 0, end: 0, aboveCount: 0, belowCount: 0 });
  });
});
