// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4255 / #4257 (Design 126 sections 3 and 5.2): the LLM Assessment renders
// one ScreenLayout (LlmAssessmentScreen.tsx). A stage does not draw the key
// hints and the guidance box; it hands them to the screen through
// `LlmStageFrame` and renders only its content (the pattern of the Setup
// Wizard, setup/setup-frame.tsx). Rendered on its own (a stage test), the
// frame draws the hints and the box itself, so a stage looks the same.

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Box } from 'ink';
import { GuidanceBox, KeyHints, type GuidanceEntry, type KeyHint } from '@swao/tui-kit';

/** What a stage hands to the screen: block 7 and the entry of block 8. */
export interface LlmStageChrome {
  keys: readonly KeyHint[];
  guidance: GuidanceEntry;
}

/** Set by LlmAssessmentScreen; null outside it. */
export const LlmStageChromeContext = createContext<((chrome: LlmStageChrome | null) => void) | null>(null);

function chromeKey(c: LlmStageChrome): string {
  return JSON.stringify({ k: c.keys, g: c.guidance });
}

export interface LlmStageFrameProps extends LlmStageChrome {
  /** Used only outside the screen, where the frame draws the box itself. */
  onGuidanceOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

export function LlmStageFrame({ keys, guidance, onGuidanceOpenChange, children }: LlmStageFrameProps): JSX.Element {
  const report = useContext(LlmStageChromeContext);
  const key = chromeKey({ keys, guidance });
  useEffect(() => {
    if (!report) return undefined;
    report({ keys, guidance });
    return undefined;
    // Compared by value: a stage may build its keys and entry inline.
  }, [report, key]);
  if (report) return <>{children}</>;
  return (
    <Box flexDirection="column">
      {children}
      <Box marginTop={1}><KeyHints hints={keys} /></Box>
      <GuidanceBox entry={guidance} keys={keys} marginTop={0} {...(onGuidanceOpenChange ? { onOpenChange: onGuidanceOpenChange } : {})} />
    </Box>
  );
}
