// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health-check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Probe-list viewport windowing (#1347, #1390; #4348).
 *
 * #4348: the fixed CHROME_RESERVED of 18 rows is gone. The window comes from
 * the shared height rule of @swao/tui-kit: the rows ScreenLayout leaves after
 * the measured chrome and the collapsed guidance box (useListBudget), and the
 * real wrapped height of every probe row (statusRowHeight; a warn or fail
 * row with a long reason takes three lines, not two). Before the first
 * measurement the list takes the shared UNMEASURED_LIST_LINES of tui-kit
 * (pagedListWindow, no constant of its own), so no frame is ever taller than
 * the terminal.
 */

import { pagedListWindow, type GuidanceEntry } from '@swao/tui-kit';

/** #4348: the guidance sentence on how the probe list scrolls (Design 126 section 7.10). */
export const PROBE_LIST_SCROLL_TEXT = 'The list scrolls with the Up and Down arrows and pages with PgUp and PgDn; where the terminal passes the mouse wheel on as arrow keys, the wheel moves the selection the same way.';

/** The probe guidance with the List section (how the list scrolls) appended. */
export function withScrollSection(entry: GuidanceEntry): GuidanceEntry {
  return { ...entry, sections: [...(entry.sections ?? []), { label: 'List', text: PROBE_LIST_SCROLL_TEXT }] };
}

export interface ProbeWindow {
  start: number;      // first visible index (inclusive)
  end: number;        // last visible index (exclusive)
  aboveCount: number; // probes hidden above the window
  belowCount: number; // probes hidden below the window
}

/**
 * The probes shown for `cursor`: `heights` are the wrapped row heights,
 * `budget` the rows the list may take (undefined before the first measurement).
 */
export function computeProbeWindow(cursor: number, heights: readonly number[], budget: number | undefined): ProbeWindow {
  const total = heights.length;
  if (total === 0) return { start: 0, end: 0, aboveCount: 0, belowCount: 0 };
  const w = pagedListWindow(heights, cursor, budget);
  return { start: w.start, end: w.end, aboveCount: w.above, belowCount: w.below };
}
