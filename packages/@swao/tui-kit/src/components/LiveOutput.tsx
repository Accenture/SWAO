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

import { useState, useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import { headerRuleWidth } from './header-width.js';
import { tone } from '../theme.js';

interface LiveOutputProps {
  lines: string[];
  maxLines?: number;
  label?: string;
  /** Cap the display width (characters). Defaults to terminal width. Set to
   *  the header MAX_WIDTH (100) to prevent lines overflowing the banner. */
  maxWidth?: number;
  /** Controls how long lines are handled. 'truncate-end' (default) clips at
   *  the display width. 'wrap' lets Ink wrap the line so the full content
   *  remains readable -- useful for licence request tokens (#2654). */
  wrapMode?: 'truncate-end' | 'wrap';
}

export function LiveOutput({ lines, maxLines = 20, label, maxWidth, wrapMode }: LiveOutputProps): JSX.Element {
  const { stdout } = useStdout();
  // #2563: cap content width to terminal columns so lines wrap at the header
  // width rather than overflowing or being clipped at the terminal edge.
  const [cols, setCols] = useState(stdout?.columns ?? 80);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setCols(stdout.columns ?? 80);
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

  // #4110: never wider than the header rule (shared helper), also on wide terminals.
  const ruleWidth = headerRuleWidth(cols);
  const displayWidth = maxWidth != null ? Math.min(ruleWidth, maxWidth) : ruleWidth;
  const visible = lines.slice(-maxLines);
  return (
    <Box flexDirection="column" marginTop={1} width={displayWidth}>
      {label && <Text {...tone('muted')}>--- {label} ---</Text>}
      {visible.map((line, i) => (
        <Text key={i} wrap={wrapMode ?? 'truncate-end'}>
          {wrapMode === 'wrap' ? line : line.slice(0, displayWidth).trimEnd()}
        </Text>
      ))}
    </Box>
  );
}
