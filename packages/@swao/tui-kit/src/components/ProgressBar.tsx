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

import { Box, Text } from 'ink';
import { tone } from '../theme.js';

interface ProgressBarProps {
  value: number;
  total: number;
  label?: string;
  width?: number;
  /** @deprecated Ignored since #4258 (Design 126 section 15.3): the bar takes
   *  the token progressRunning while it runs and progressDone at 100 percent.
   *  Kept so existing call sites compile until the colour sweep (#4259). */
  color?: string;
}

export function ProgressBar({ value, total, label, width = 24 }: ProgressBarProps): JSX.Element {
  const pct    = total === 0 ? 0 : Math.min(1, value / total);
  const filled = Math.round(pct * width);
  const empty  = width - filled;
  const bar    = '█'.repeat(filled) + '░'.repeat(empty);
  const pctStr = `${Math.round(pct * 100)}%`;
  const barTone = tone(pct >= 1 ? 'progressDone' : 'progressRunning');

  return (
    <Box marginTop={1} marginBottom={1}>
      <Text {...barTone}>[{bar}]</Text>
      <Text> {pctStr}</Text>
      {label && <Text {...tone('muted')}>  {label}</Text>}
    </Box>
  );
}
