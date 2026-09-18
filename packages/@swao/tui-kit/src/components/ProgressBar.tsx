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

interface ProgressBarProps {
  value: number;
  total: number;
  label?: string;
  width?: number;
  /** Bar colour. Defaults to cyan; AssessScreen passes "green" when the run
   *  reaches 100 percent so the operator gets a clear visual "done" signal
   *  (#0380, sprint-040). */
  color?: string;
}

export function ProgressBar({ value, total, label, width = 24, color = 'cyan' }: ProgressBarProps): JSX.Element {
  const pct    = total === 0 ? 0 : Math.min(1, value / total);
  const filled = Math.round(pct * width);
  const empty  = width - filled;
  const bar    = '█'.repeat(filled) + '░'.repeat(empty);
  const pctStr = `${Math.round(pct * 100)}%`;

  return (
    <Box marginTop={1} marginBottom={1}>
      <Text color={color}>[{bar}]</Text>
      <Text> {pctStr}</Text>
      {label && <Text dimColor>  {label}</Text>}
    </Box>
  );
}
