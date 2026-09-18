// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health-check module -- probe-list windowing tests (#1390)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { computeProbeWindow, CHROME_RESERVED, MIN_VISIBLE } from './probe-window.js';

const TOTAL = 13; // health-check probe count

describe('computeProbeWindow (#1390)', () => {
  it('shows all probes with no indicators when the terminal is tall enough', () => {
    const win = computeProbeWindow(0, TOTAL, TOTAL + CHROME_RESERVED);
    expect(win).toEqual({ start: 0, end: TOTAL, aboveCount: 0, belowCount: 0 });
  });

  it('windows the list on a 30-row terminal (the reported failure size)', () => {
    // 30 - 18 = 12 visible of 13 -- paging MUST engage (previously all 13
    // rendered and the frame overflowed, corrupting middle rows).
    const win = computeProbeWindow(0, TOTAL, 30);
    expect(win.end - win.start).toBe(12);
    expect(win.aboveCount + win.belowCount).toBe(1);
  });

  it('never renders fewer than MIN_VISIBLE rows on tiny terminals', () => {
    const win = computeProbeWindow(0, TOTAL, 10);
    expect(win.end - win.start).toBe(MIN_VISIBLE);
    expect(win.belowCount).toBe(TOTAL - MIN_VISIBLE);
  });

  it('window is always contiguous and within bounds while scrolling', () => {
    for (let cursor = 0; cursor < TOTAL; cursor++) {
      const win = computeProbeWindow(cursor, TOTAL, 25); // 7 visible
      expect(win.start).toBeGreaterThanOrEqual(0);
      expect(win.end).toBeLessThanOrEqual(TOTAL);
      expect(win.end - win.start).toBe(7);
      // Cursor always inside the visible slice -- no invisible cursor rows.
      expect(cursor).toBeGreaterThanOrEqual(win.start);
      expect(cursor).toBeLessThan(win.end);
      expect(win.aboveCount).toBe(win.start);
      expect(win.belowCount).toBe(TOTAL - win.end);
    }
  });

  it('clamps an out-of-range cursor instead of producing a broken window', () => {
    const win = computeProbeWindow(99, TOTAL, 25);
    expect(win.end).toBe(TOTAL);
    expect(win.end - win.start).toBe(7);
  });

  it('handles the empty list', () => {
    const win = computeProbeWindow(0, 0, 30);
    expect(win).toEqual({ start: 0, end: 0, aboveCount: 0, belowCount: 0 });
  });
});
