// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, abort and cancel confirmation (mockup M-14)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4251 (TUI-07, Design 126 sections 5.2, 7.4 to 7.6, mockup M-14): the one
// confirmation of the key model. Esc on a flow with unsaved input asks
// "Abort the setup? Entered values are not saved."; Esc on a long run asks
// "Cancel the run? Results so far are kept as a cancelled run."; Esc on the
// main menu asks "Exit SWAO?" (Q-03 decided). The dialog owns Enter (abort,
// cancel or exit) and Esc (stay) while it is shown: it is the only place
// where Esc means stay (section 7.5 step 2). The box has the width of the
// guidance box (header rule minus 2), so both boxes align.

import { useCallback, useRef } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { tone, tokenColor } from '../theme.js';
import { KeyHints, KEY_HINTS, type KeyHint } from './KeyHints.js';
import { useHeaderWidth } from './header-width.js';

/** What the dialog confirms: abort a setup or assessment flow, cancel a run, exit SWAO. */
export type AbortDialogKind = 'setup' | 'assessment' | 'run' | 'exit';

/** The question and the key hints of each kind (M-14; Q-03 for exit). */
export const ABORT_DIALOG_TEXT: Readonly<Record<AbortDialogKind, { question: string; keys: readonly KeyHint[] }>> = {
  setup: { question: 'Abort the setup? Entered values are not saved.', keys: KEY_HINTS.abortDialog },
  assessment: { question: 'Abort the assessment? Entered values are not saved.', keys: KEY_HINTS.abortDialog },
  run: { question: 'Cancel the run? Results so far are kept as a cancelled run.', keys: KEY_HINTS.cancelDialog },
  exit: { question: 'Exit SWAO?', keys: KEY_HINTS.exitDialog },
};

export interface AbortDialogProps {
  what: AbortDialogKind;
  /** Enter: abort the flow, cancel the run or exit. */
  onAbort(): void;
  /** Esc: close the dialog and stay. */
  onStay(): void;
  /** Keys are read only while active (default true). */
  active?: boolean;
}

export function AbortDialog({ what, onAbort, onStay, active = true }: AbortDialogProps): JSX.Element {
  const width = useHeaderWidth() - 2;
  const text = ABORT_DIALOG_TEXT[what];
  // One stable listener with the current callbacks (the SelectInput pattern, #0805).
  const cb = useRef({ onAbort, onStay });
  cb.current = { onAbort, onStay };
  useInput(useCallback((_input: string, key: Key) => {
    if (key.return) cb.current.onAbort();
    else if (key.escape) cb.current.onStay();
  }, []), { isActive: active });
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={tokenColor('border')} paddingX={1} width={width} flexShrink={0}>
      <Text {...tone('warning')} wrap="wrap">{text.question}</Text>
      <Text> </Text>
      <KeyHints hints={text.keys} />
    </Box>
  );
}
