// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, the height of a paged list
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4348: the shared height rule of paged lists.

import { describe, it, expect } from 'vitest';
import { computeListWindow, listBudget, GUIDANCE_COLLAPSED_ROWS } from './list-window.js';
import { statusRowHeight } from './StatusLabel.js';

describe('listBudget (#4348)', () => {
  it('is the frame minus the measured chrome (blocks above without the list) and the rows below', () => {
    // 29 frame rows; 30 rows above the guidance box, 20 of them the list; collapsed box below.
    expect(listBudget({ frameRows: 29, above: 30, below: GUIDANCE_COLLAPSED_ROWS }, 20)).toBe(29 - (30 - 20 + 4));
  });

  it('is unknown before the measurement or without a terminal height, and never below one row', () => {
    expect(listBudget({ frameRows: undefined, above: 30, below: 4 }, 20)).toBeUndefined();
    expect(listBudget({ frameRows: 29, above: undefined, below: 4 }, 20)).toBeUndefined();
    expect(listBudget({ frameRows: 10, above: 40, below: 4 }, 1)).toBe(1);
  });
});

describe('computeListWindow (#4348)', () => {
  it('shows every row without "more" lines when they fit', () => {
    expect(computeListWindow([1, 2, 1], 0, 4)).toEqual({ start: 0, end: 3, above: 0, below: 0 });
  });

  it('counts wrapped rows and the "more" lines, keeps the cursor visible', () => {
    const heights = [1, 1, 3, 1, 1, 1, 1, 1];
    for (let cursor = 0; cursor < heights.length; cursor++) {
      const w = computeListWindow(heights, cursor, 6);
      expect(cursor).toBeGreaterThanOrEqual(w.start);
      expect(cursor).toBeLessThan(w.end);
      const used = heights.slice(w.start, w.end).reduce((a, h) => a + h, 0) + (w.above > 0 ? 1 : 0) + (w.below > 0 ? 1 : 0);
      expect(used).toBeLessThanOrEqual(6);
    }
  });

  it('shows the cursor row even when it alone is taller than the budget', () => {
    expect(computeListWindow([1, 9, 1], 1, 3)).toEqual({ start: 1, end: 2, above: 1, below: 1 });
  });

  it('handles the empty list', () => {
    expect(computeListWindow([], 0, 10)).toEqual({ start: 0, end: 0, above: 0, below: 0 });
  });
});

describe('statusRowHeight (#4348)', () => {
  it('one line without a detail, more when the detail wraps under the label column', () => {
    expect(statusRowHeight({ level: 'ok', label: 'Licence' }, 98)).toBe(1);
    expect(statusRowHeight({ level: 'warn', label: 'gitleaks', detail: 'not found' }, 98)).toBe(2);
    const long = 'Service workspace: no app folder for the services of the intake yet; the Service Portfolio Assessment imports the intake workbook first and creates one app folder per service';
    expect(statusRowHeight({ level: 'fail', label: 'Service workspace', detail: long }, 98)).toBe(4); // the detail wraps to three lines, as the probe list renders it
    expect(statusRowHeight({ level: 'fail', label: 'Service workspace', detail: long }, 60)).toBeGreaterThan(4);
  });
});
