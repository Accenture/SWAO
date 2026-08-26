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

interface LiveOutputProps {
  lines: string[];
  maxLines?: number;
  label?: string;
}

export function LiveOutput({ lines, maxLines = 20, label }: LiveOutputProps): JSX.Element {
  const visible = lines.slice(-maxLines);
  return (
    <Box flexDirection="column" marginTop={1}>
      {label && <Text dimColor>--- {label} ---</Text>}
      {visible.map((line, i) => (
        <Text key={i} wrap="wrap">{line.trimEnd()}</Text>
      ))}
    </Box>
  );
}
