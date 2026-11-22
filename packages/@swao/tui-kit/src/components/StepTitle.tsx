// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, step title and section title (mockup M-03)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4248 (TUI-04, Design 126 section 5.2): promoted from the local StepTitle of
// swao/src/setup/steps/step-ui.tsx, which cut both lines at the header width.
// Here both lines wrap within the header width and are never cut (section 8
// rule 5). The title equals the step bar label: no number, no inline hint
// (#4235 rule 2). `level={2}` is a section title such as "Output", which
// replaces the dash rule headings (rule 11).

import { Box, Text } from 'ink';
import { tone } from '../theme.js';
import { useHeaderWidth } from './header-width.js';

export interface StepTitleProps {
  title: string;
  /** One dim purpose line (level 1 only). */
  subtitle?: string;
  /** 1: step title (brand, bold) with subtitle; 2: section title (brand without bold). */
  level?: 1 | 2;
}

export function StepTitle({ title, subtitle, level = 1 }: StepTitleProps): JSX.Element {
  const width = useHeaderWidth();
  if (level === 2) {
    return (
      <Box width={width}>
        <Text {...tone('brand', { bold: false })} wrap="wrap">{title}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" width={width}>
      <Text {...tone('brand')} wrap="wrap">{title}</Text>
      {subtitle && <Text {...tone('muted')} wrap="wrap">{subtitle}</Text>}
    </Box>
  );
}
