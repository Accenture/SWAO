// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, the window of a paged list
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4348: one window helper for every paged list, measured or not.

import { describe, it, expect } from 'vitest';
import { pagedListStep, pagedListWindow, UNMEASURED_LIST_LINES } from './paged-list.js';
import { computeListWindow } from './list-window.js';

const ones = (n: number): number[] => Array.from({ length: n }, () => 1);
const lines = (heights: number[], w: { start: number; end: number; above: number; below: number }): number =>
  heights.slice(w.start, w.end).reduce((a, h) => a + h, 0) + (w.above > 0 ? 1 : 0) + (w.below > 0 ? 1 : 0);

describe('pagedListWindow (#4348)', () => {
  it('with a measured budget it is the shared height rule', () => {
    const heights = [1, 3, 1, 2, 1, 1, 4, 1, 1, 1];
    for (const budget of [3, 5, 8, 12, 40]) {
      for (let c = 0; c < heights.length; c++) expect(pagedListWindow(heights, c, budget)).toEqual(computeListWindow(heights, c, budget));
    }
  });

  it('before the first measurement it never takes more than UNMEASURED_LIST_LINES lines (one tall cursor row aside)', () => {
    const heights = [1, 2, 1, 3, 1, 1, 2, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4, 1];
    for (let c = 0; c < heights.length; c++) {
      const w = pagedListWindow(heights, c, undefined);
      expect(c).toBeGreaterThanOrEqual(w.start);
      expect(c).toBeLessThan(w.end);
      if (heights[c]! + 2 <= UNMEASURED_LIST_LINES) expect(lines(heights, w)).toBeLessThanOrEqual(UNMEASURED_LIST_LINES);
    }
  });

  it('a short list shows every row, measured or not', () => {
    expect(pagedListWindow(ones(5), 4, undefined)).toEqual({ start: 0, end: 5, above: 0, below: 0 });
    expect(pagedListWindow(ones(5), 0, 5)).toEqual({ start: 0, end: 5, above: 0, below: 0 });
  });

  it('a budget of zero or less still shows the cursor row', () => {
    const w = pagedListWindow(ones(10), 6, 0);
    expect(w.start).toBe(6);
    expect(w.end).toBe(7);
  });

  it('PgUp and PgDn move by the rows of the window, at least one', () => {
    expect(pagedListStep({ start: 3, end: 9, above: 3, below: 1 })).toBe(6);
    expect(pagedListStep({ start: 0, end: 0, above: 0, below: 0 })).toBe(1);
  });
});
