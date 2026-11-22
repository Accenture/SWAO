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

// #4348 (Design 126 sections 3 and 10): one height rule for every paged list
// instead of a constant per screen (the Health Check probe list reserved a
// fixed 18 rows and counted a wrapped warn row as two lines, so the frame grew
// past the terminal and the guidance box fell below the window).
//
//   budget = frame rows (terminal rows minus 1, TerminalFrame)
//          - the measured chrome: every row ScreenLayout draws above the
//            guidance box except the list itself (header, licence line, step
//            bar, title, the other content, key hints)
//          - the collapsed guidance box (it is always drawn; ScreenLayout
//            bounds the expanded box to the rows left, section 9.5)
//          - the footer
//
// ScreenLayout provides the measured numbers through ListBudgetContext; the
// list measures its own height with `useListBudget(ref)` and pages with
// `computeListWindow`, which counts the real (wrapped) height of every row
// and the "n more" lines.

import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Box, measureElement, useStdout, type DOMElement } from 'ink';
import { terminalFrameHeight } from './TerminalFrame.js';

/** Rows of the collapsed guidance box: border, title line, first explanation line, border. */
export const GUIDANCE_COLLAPSED_ROWS = 4;

/** What ScreenLayout knows about the frame (undefined until measured or without a terminal height). */
export interface ListBudgetFrame {
  /** Rows of the frame (terminal rows minus 1). */
  frameRows: number | undefined;
  /** Measured rows of blocks 1 to 7 (header to key hints), the list included. */
  above: number | undefined;
  /** Rows the screen draws under the key hints besides the list: guidance box and footer. */
  below: number;
}

export const ListBudgetContext = createContext<ListBudgetFrame | null>(null);

/** The rows a list may use, from the frame and the list's own measured height. Pure, for tests. */
export function listBudget(frame: ListBudgetFrame, ownRows: number): number | undefined {
  if (frame.frameRows === undefined || frame.above === undefined) return undefined;
  const chrome = frame.above - ownRows + frame.below;
  return Math.max(1, frame.frameRows - chrome);
}

/**
 * The rows the list behind `ref` may take on this screen, or undefined before
 * the first measurement. Outside a ScreenLayout (a component test, an
 * embedding without the frame) the list may take the whole frame height.
 */
export function useListBudget(ref: RefObject<DOMElement>): number | undefined {
  const frame = useContext(ListBudgetContext);
  const { stdout } = useStdout();
  const [own, setOwn] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!ref.current) return;
    const h = measureElement(ref.current).height;
    if (h !== own) setOwn(h);
  });
  if (!frame) return terminalFrameHeight(stdout?.rows);
  if (own === undefined) return undefined;
  return listBudget(frame, own);
}

export interface ListWindow {
  /** First visible index (inclusive) and last (exclusive). */
  start: number;
  end: number;
  /** Rows hidden above and below (the "n more" lines). */
  above: number;
  below: number;
}

/**
 * The window of a list of rows with the given heights that fits `budget`
 * lines, the "n more" line above or below included when rows are hidden. The
 * cursor row is always visible (even when it alone is taller than the budget).
 * The window grows downwards from the cursor first, then upwards.
 */
export function computeListWindow(heights: readonly number[], cursor: number, budget: number): ListWindow {
  const n = heights.length;
  if (n === 0) return { start: 0, end: 0, above: 0, below: 0 };
  const total = heights.reduce((a, h) => a + h, 0);
  if (total <= budget) return { start: 0, end: n, above: 0, below: 0 };
  const c = Math.max(0, Math.min(cursor, n - 1));
  const cost = (s: number, e: number, rows: number): number => rows + (s > 0 ? 1 : 0) + (e < n ? 1 : 0);
  let start = c;
  let end = c + 1;
  let rows = heights[c]!;
  // Keep the cursor away from the edge: grow one row below, then one above, while it fits.
  let grew = true;
  while (grew) {
    grew = false;
    if (end < n && cost(start, end + 1, rows + heights[end]!) <= budget) { rows += heights[end]!; end++; grew = true; }
    if (start > 0 && cost(start - 1, end, rows + heights[start - 1]!) <= budget) { start--; rows += heights[start]!; grew = true; }
  }
  return { start, end, above: start, below: n - end };
}

/**
 * #4348: the frame of a screen measured from the block behind `ref` (all rows
 * above the guidance box, the list included) and the rows the screen draws
 * outside that block (`below`). ScreenLayout and ListBudgetScope use it, so a
 * list on either measures its budget the same way.
 */
export function useListBudgetFrame(ref: RefObject<DOMElement>, below: number): ListBudgetFrame {
  const { stdout } = useStdout();
  const [above, setAbove] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!ref.current) return;
    const h = measureElement(ref.current).height;
    if (h !== above) setAbove(h);
  });
  const frameRows = terminalFrameHeight(stdout?.rows);
  return useMemo<ListBudgetFrame>(() => ({ frameRows, above, below }), [frameRows, above, below]);
}

export interface ListBudgetScopeProps {
  /** Rows the screen draws outside this block: padding, the collapsed guidance box, a footer. */
  outside: number;
  children?: ReactNode;
}

/**
 * #4348: the height rule for a screen that is not on ScreenLayout (the app
 * pickers): wrap the rows above the guidance box, pass the rows outside, and
 * a paged list inside (SelectInput, MultiSelect, useListBudget) never makes
 * the frame taller than the terminal.
 */
export function ListBudgetScope({ outside, children }: ListBudgetScopeProps): JSX.Element {
  const ref = useRef<DOMElement>(null);
  const frame = useListBudgetFrame(ref, outside);
  return createElement(Box, { ref, flexDirection: 'column', flexShrink: 0 },
    createElement(ListBudgetContext.Provider, { value: frame }, children));
}

/**
 * #4348: the option rows a picker may show inside its budget. `fixed` is the
 * picker's own rows besides the options (title, filter line, hint line,
 * margin); when the options do not fit, two "n more" lines are always counted
 * so the window does not flip as they appear. Undefined budget: no bound.
 */
export function pickerBudgetRows(budget: number | undefined, fixed: number, needed: number): number | undefined {
  if (budget === undefined) return undefined;
  if (needed + fixed <= budget) return undefined;
  return Math.max(1, budget - fixed - 2);
}
