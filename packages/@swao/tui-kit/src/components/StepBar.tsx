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

interface StepBarProps {
  steps: string[];
  currentIndex: number;
}

export function StepBar({ steps, currentIndex }: StepBarProps): JSX.Element {
  return (
    <Box marginBottom={1}>
      {steps.map((label, i) => {
        const done    = i < currentIndex;
        const active  = i === currentIndex;
        const bullet  = done ? '●' : active ? '●' : '○';
        const color   = done ? 'green' : active ? 'cyan' : undefined;
        return (
          <Box key={label} marginRight={2}>
            <Text color={color}>{bullet} {label}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
