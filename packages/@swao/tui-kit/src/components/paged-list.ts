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

// #4348 (Design 126 sections 3 and 10): the last per-screen constants of the
// paged lists were their windows before the first measurement (Health Check
// probe list 4 rows, Setup Ready step 8 lines, LZ catalogue lists 10 rows).
// One helper for every paged list: the measured budget of the shared height
// rule (useListBudget, list-window.ts) when it exists, else one shared
// fallback in lines, so no screen keeps its own number and no frame is ever
// taller than the terminal before the measurement arrives.

import { computeListWindow, type ListWindow } from './list-window.js';

/**
 * Lines a paged list may take before ScreenLayout (or ListBudgetScope) has
 * measured its budget, the "n more" lines included. Small enough for the
 * smallest supported terminal (24 rows) with the full chrome around it.
 */
export const UNMEASURED_LIST_LINES = 8;

/**
 * The window of a paged list whose rows have the given wrapped `heights`:
 * `budget` is the measured number of lines (useListBudget, minus any rows the
 * list draws itself), undefined before the first measurement.
 */
export function pagedListWindow(heights: readonly number[], cursor: number, budget: number | undefined): ListWindow {
  return computeListWindow(heights, cursor, budget === undefined ? UNMEASURED_LIST_LINES : Math.max(1, budget));
}

/** Rows to move on PgUp or PgDn: the rows of the current window, at least one. */
export function pagedListStep(win: ListWindow): number {
  return Math.max(1, win.end - win.start);
}
