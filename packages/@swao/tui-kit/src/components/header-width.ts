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

// Shared header-rule width (#4110). Owner rule for every TUI screen: no text
// line extends beyond the `=` rule of the header. Screens use these helpers
// instead of per-screen column numbers.

import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

/** Narrowest header rule. */
export const HEADER_MIN_WIDTH = 63;
/** Widest header rule; the rule never grows past 100 columns. */
export const HEADER_MAX_WIDTH = 100;
/** Safety margin so the rule does not wrap at the terminal edge. */
export const HEADER_EDGE_MARGIN = 2;

/** Width of the header `=` rule for a terminal of `columns` columns. */
export function headerRuleWidth(columns: number | undefined): number {
  return Math.min(HEADER_MAX_WIDTH, Math.max(HEADER_MIN_WIDTH, (columns ?? 80) - HEADER_EDGE_MARGIN));
}

/** Current header rule width, updated on terminal resize. */
export function useHeaderWidth(): number {
  const { stdout } = useStdout();
  const [cols, setCols] = useState(stdout?.columns ?? 80);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setCols(stdout.columns ?? 80);
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);
  return headerRuleWidth(cols);
}

/**
 * Fit `text` into `width` columns: unchanged when it fits, else cut with "..."
 * (never longer than `width`). `cut: 'end'` (default) keeps the start;
 * `cut: 'middle'` keeps the start and the end around the ellipsis, so a file
 * name at the end of a path stays visible (#4115).
 */
export function fitToWidth(text: string, width: number, cut: 'end' | 'middle' = 'end'): string {
  if (width <= 0) return '';
  if (text.length <= width) return text;
  if (width <= 3) return '.'.repeat(width);
  if (cut === 'middle') {
    const keep = width - 3;
    const head = Math.ceil(keep * 0.4);
    return `${text.slice(0, head)}...${text.slice(text.length - (keep - head))}`;
  }
  return text.slice(0, width - 3).trimEnd() + '...';
}
