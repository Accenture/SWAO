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

// #4254 TUI-10 (Design 126 sections 3 and 4.5): the Setup Wizard renders one
// ScreenLayout (header, step bar, step title, content, key hints, guidance
// box). A step does not draw that frame; it hands its title, its input kind
// and its guidance entry to the wizard through `SetupStepFrame`, and renders
// only its content. Rendered outside the wizard (a step test, an embedding
// screen), the frame draws the title, the hints and the box itself, so a step
// looks the same on its own.

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { Box } from 'ink';
import { GuidanceBox, KeyHints, KEY_HINTS, StepTitle, useGuidanceOpen, type FlowStepKind, type GuidanceEntry, type KeyHint } from '@swao/tui-kit';

/** What a step hands to the wizard frame. */
export interface SetupChrome {
  /** Step title (the step bar label, section 4.5) and one purpose line. */
  title?: string;
  subtitle?: string;
  /** The input kind of the step; the wizard derives the standard hint line from it (section 7.9). */
  kind?: FlowStepKind;
  /** A hint line of its own (a result view, a sub-screen); wins over `kind`. */
  keys?: readonly KeyHint[];
  /** The guidance of the current sub-step or of the highlighted option (#4230). */
  guidance?: GuidanceEntry;
  /**
   * The step goes back itself (a sub-step inside the step): Left arrow and
   * Shift+Tab call this instead of returning to the previous wizard step.
   */
  back?: () => void;
}

/** Set by the wizard; null outside it. */
export const SetupChromeContext = createContext<((chrome: SetupChrome | null) => void) | null>(null);

function chromeKey(c: SetupChrome): string {
  return JSON.stringify({ t: c.title, s: c.subtitle, k: c.kind, h: c.keys, g: c.guidance, b: !!c.back });
}

/** The standard hints of a kind outside a flow (no step position known). */
export function standaloneHints(kind: FlowStepKind | undefined): readonly KeyHint[] {
  return KEY_HINTS[kind ?? 'confirm'];
}

/**
 * The frame of a setup step. Inside the wizard it reports the chrome and
 * renders the content only; outside it renders title, content, hints and box.
 */
export function SetupStepFrame({ children, ...chrome }: SetupChrome & { children?: ReactNode }): JSX.Element {
  const report = useContext(SetupChromeContext);
  // #4394: outside the wizard the box of this frame feeds the guidance open
  // state the step reads (useGuidanceOpen: the nearest owner, else the default).
  const guidance = useGuidanceOpen();
  const key = chromeKey(chrome);
  // A step passes `back` inline (a new function per render): the wizard gets a
  // stable wrapper that calls the latest one, so a report never causes another.
  const backRef = useRef(chrome.back);
  backRef.current = chrome.back;
  const stableBack = useCallback(() => { backRef.current?.(); }, []);
  useEffect(() => {
    if (!report) return undefined;
    report({ ...chrome, back: chrome.back ? stableBack : undefined });
    return () => report(null);
    // The chrome is compared by value (key, which includes whether back is set).
  }, [report, key, stableBack]);
  if (report) return <>{children}</>;
  const keys = chrome.keys ?? standaloneHints(chrome.kind);
  return (
    <Box flexDirection="column">
      {chrome.title && <StepTitle title={chrome.title} subtitle={chrome.subtitle} />}
      <Box flexDirection="column" marginTop={chrome.title ? 1 : 0}>{children}</Box>
      <Box marginTop={1}><KeyHints hints={keys} /></Box>
      {chrome.guidance && <GuidanceBox entry={chrome.guidance} keys={keys} marginTop={0} onOpenChange={guidance.setOpen} />}
    </Box>
  );
}
