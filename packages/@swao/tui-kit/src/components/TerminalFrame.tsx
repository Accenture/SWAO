// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// TerminalFrame -- constant-height root frame for the alt-screen TUI (#4123, #4111).
//
// Root cause of the broken frames after a Ctrl+G collapse (#4123) and the
// overlapping menu text in the embedded LZ Connections step (#4111):
// Ink 4.4.1 (`ink/build/ink.js:157-160`) paints any frame whose height is
// >= stdout.rows with `clearTerminal + output` and returns WITHOUT going
// through log-update. log-update keeps the line count and the output string
// of the last frame it painted itself. The next, shorter frame then erases
// the wrong number of lines (stale header rules, missing items, leftover
// characters of longer lines), or is skipped entirely when it equals
// log-update's stale copy (the expanded box stays on screen).
//
// The per-component workarounds (GuidanceBox ghost padding #0813, the
// rows-20 cap #2349) only hid the symptom for one component. TerminalFrame
// fixes it for every screen: the whole TUI renders inside a box that is
// always exactly `rows - 1` lines tall (log-update appends a newline, so a
// `rows`-tall frame would scroll by one line). Ink therefore never takes the
// clear-terminal path, every frame has the same height, and log-update
// always erases exactly the previous frame. Content taller than the frame
// is clipped at the bottom, so the header stays visible.

import { useEffect, useState, type ReactNode } from 'react';
import { Box, useStdout } from 'ink';
import { headerRuleWidth } from './header-width.js';

export interface TerminalFrameProps {
  children?: ReactNode;
  /** Terminal height override (tests). Defaults to stdout.rows, tracked on resize. */
  rows?: number;
  /** Terminal width override (tests). Defaults to stdout.columns, tracked on resize. */
  columns?: number;
  /**
   * #4379: a one-line status shown on the last row of the frame (the Ctrl+C
   * quit prompt). While it is set the content is clipped one row earlier, so
   * the frame keeps its height and the line is never cut off.
   */
  statusLine?: ReactNode;
}

/**
 * #4110: width of the frame for a terminal of `columns` columns: the header
 * rule plus one column of screen padding on each side, never wider than the
 * terminal. On a wide terminal Ink would otherwise wrap text at the terminal
 * edge, far right of the 100-column rule.
 */
export function terminalFrameWidth(columns: number | undefined): number | undefined {
  if (columns === undefined || !Number.isFinite(columns) || columns < 1) return undefined;
  return Math.min(columns, headerRuleWidth(columns) + 2);
}

/** Height of the frame for a terminal of `rows` lines; undefined when the height is unknown (non-TTY). */
export function terminalFrameHeight(rows: number | undefined): number | undefined {
  if (rows === undefined || !Number.isFinite(rows) || rows < 2) return undefined;
  return rows - 1;
}

export function TerminalFrame({ children, rows, columns, statusLine }: TerminalFrameProps): JSX.Element {
  const { stdout } = useStdout();
  const [stdoutRows, setStdoutRows] = useState<number | undefined>(stdout?.rows);
  const [stdoutCols, setStdoutCols] = useState<number | undefined>(stdout?.columns);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => { setStdoutRows(stdout.rows); setStdoutCols(stdout.columns); };
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

  const height = terminalFrameHeight(rows ?? stdoutRows);
  const hasStatus = statusLine !== undefined && statusLine !== null && statusLine !== false;
  // The children keep the same tree position whether or not the status line
  // shows, so a screen never remounts (and never loses its input) for it.
  if (height === undefined) return <>{children}{hasStatus ? statusLine : null}</>;
  const width = terminalFrameWidth(columns ?? stdoutCols);
  const contentHeight = hasStatus ? Math.max(1, height - 1) : height;
  return (
    <Box flexDirection="column" height={height} width={width} overflow="hidden" flexShrink={0}>
      <Box flexDirection="column" height={contentHeight} overflow="hidden" flexShrink={0}>
        {/* flexShrink 0: yoga must not compress the screen to fit the frame
            (compressed rows overlap, #4111); overflow is clipped instead. */}
        <Box flexDirection="column" flexShrink={0}>
          {children}
        </Box>
      </Box>
      {hasStatus ? <Box height={1} flexShrink={0} overflow="hidden">{statusLine}</Box> : null}
    </Box>
  );
}
