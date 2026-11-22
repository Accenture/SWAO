// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, colour palette legend (Design 126 mockup M-00)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4258 (TUI-16): mockup M-00 as a component: one row per token with its Ink
// style and a sample rendered in the token. Used by the theme test and by
// the owner re-test to confirm the palette on the real terminal scheme.

import { Box, Text } from 'ink';
import { TOKENS, TOKEN_NAMES, inkStyleName, tone, type Token } from '../theme.js';
import { useHeaderWidth } from './header-width.js';

/** The sample text of each token (mockup M-00). */
export const COLOUR_LEGEND_SAMPLES: Readonly<Record<Token, string>> = {
  brand: 'Application Assessment',
  text: 'The application the assessment analyses.',
  muted: 'Scanners and IaC tools on this machine.',
  selection: '❯ Claude Desktop',
  accent: 'apps/sovereign-health/wsp/runs/2026-11-09T15-14-37',
  ok: '[ok] gitleaks',
  info: '[info] opentofu',
  warning: '[warn] write-capable, accepted for this run; SWAO only reads',
  error: '[fail] probe failed',
  progressRunning: '[##########..............]',
  progressDone: '[########################]',
  border: '+--------+',
};

const TOKEN_COL = 19;
const INK_COL = 13;

export function ColourLegend(): JSX.Element {
  const width = useHeaderWidth();
  const sampleWidth = Math.max(1, width - TOKEN_COL - INK_COL);
  return (
    <Box flexDirection="column" width={width}>
      <Text {...tone('brand', { bold: false })}>{'Token'.padEnd(TOKEN_COL)}{'Ink'.padEnd(INK_COL)}Sample</Text>
      {TOKEN_NAMES.map((t) => (
        <Box key={t}>
          <Box width={TOKEN_COL}><Text>{t}</Text></Box>
          <Box width={INK_COL}><Text {...tone('muted')}>{inkStyleName(TOKENS[t])}</Text></Box>
          <Box width={sampleWidth}><Text {...tone(t)} wrap="wrap">{COLOUR_LEGEND_SAMPLES[t]}</Text></Box>
        </Box>
      ))}
    </Box>
  );
}
