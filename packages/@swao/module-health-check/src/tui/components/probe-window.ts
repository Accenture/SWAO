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
 * Probe-list viewport windowing (#1347, corrected by #1390).
 *
 * useStdout().rows is the FULL terminal height; the wizard header, step
 * title, guidance box, and footer all render in the same Ink frame as the
 * probe list. The original #1347 budget reserved only 8 rows, so with 13
 * probes on a ~30-row terminal the frame overflowed the terminal and Ink
 * corrupted the render (middle rows vanished with no paging indicator).
 *
 * CHROME_RESERVED matches the pass-picker budget (AssessScreen.tsx
 * passVisibleCount = max(4, rows - 18)) so the window shrinks BEFORE the
 * frame can overflow and the paging indicators become mandatory whenever
 * the list does not fit.
 */

export const CHROME_RESERVED = 18;
export const MIN_VISIBLE = 4;

export interface ProbeWindow {
  start: number;      // first visible index (inclusive)
  end: number;        // last visible index (exclusive)
  aboveCount: number; // probes hidden above the window
  belowCount: number; // probes hidden below the window
}

export function computeProbeWindow(cursor: number, total: number, terminalRows: number): ProbeWindow {
  const maxVisible = Math.max(MIN_VISIBLE, terminalRows - CHROME_RESERVED);
  if (total <= maxVisible) {
    return { start: 0, end: total, aboveCount: 0, belowCount: 0 };
  }
  const clampedCursor = Math.max(0, Math.min(cursor, total - 1));
  const start = Math.max(0, Math.min(
    clampedCursor - Math.floor(maxVisible / 2),
    total - maxVisible,
  ));
  const end = Math.min(total, start + maxVisible);
  return { start, end, aboveCount: start, belowCount: total - end };
}
