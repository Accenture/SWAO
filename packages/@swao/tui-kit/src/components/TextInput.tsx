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

import { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

interface TextInputProps {
  label: string;
  placeholder?: string;
  initialValue?: string;
  onSubmit: (value: string) => void;
  active?: boolean;
  /** When set, each typed character is displayed as this string (e.g. '*' for passwords).
   *  Ctrl+E toggles reveal/hide while typing. */
  mask?: string;
  /** Render the label on its own line above the input instead of inline. */
  labelAbove?: boolean;
  /** When set, the displayed value is truncated to this many characters + '...' so it
   *  does not overflow the terminal width. The full value is still held in state. */
  maxValueWidth?: number;
}

export function TextInput({ label, placeholder, initialValue = '', onSubmit, active = true, mask, labelAbove = false, maxValueWidth }: TextInputProps): JSX.Element {
  const [value, setValue] = useState(initialValue);
  const [revealed, setRevealed] = useState(false);
  // useRef avoids stale closure in useInput when Ink re-uses the handler (#1815).
  const valueRef = useRef(value);
  valueRef.current = value;
  // #2631: bracketed paste buffer for Windows Terminal ESC[200~...ESC[201~ sequences.
  const pasteBufferRef = useRef('');
  const inPasteRef     = useRef(false);

  useInput((input, key) => {
    if (!active) return;

    // Handle bracketed paste protocol (Windows Terminal, modern terminals).
    // ESC[200~ opens the paste; ESC[201~ closes it. All content between the
    // markers is applied atomically so key.meta guards do not drop characters.
    if (inPasteRef.current) {
      const combined = pasteBufferRef.current + input;
      const closeIdx = combined.indexOf('\x1b[201~');
      if (closeIdx >= 0) {
        setValue(v => v + combined.slice(0, closeIdx));
        pasteBufferRef.current = '';
        inPasteRef.current = false;
      } else {
        pasteBufferRef.current = combined;
      }
      return;
    }
    const openIdx = input.indexOf('\x1b[200~');
    if (openIdx >= 0) {
      const after = input.slice(openIdx + 7); // 7 = len('\x1b[200~')
      const closeIdx = after.indexOf('\x1b[201~');
      if (closeIdx >= 0) {
        setValue(v => v + after.slice(0, closeIdx));
      } else {
        inPasteRef.current = true;
        pasteBufferRef.current = after;
      }
      return;
    }

    if (key.backspace || key.delete) {
      setValue(v => v.slice(0, -1));
    } else if (key.return) {
      onSubmit(valueRef.current.trim());
    } else if (key.ctrl && input === 'e' && mask !== undefined) {
      setRevealed(r => !r);
    } else if (input && !key.ctrl && !key.meta) {
      setValue(v => v + input);
    }
  });

  const masked = mask !== undefined && !revealed;
  const rawDisplay = masked
    ? (value.length > 0 ? mask.repeat(value.length) : (placeholder ?? ''))
    : (value.length > 0 ? value : (placeholder ?? ''));
  const dimmed  = value.length === 0;
  const display = (maxValueWidth !== undefined && !dimmed && rawDisplay.length > maxValueWidth)
    ? rawDisplay.slice(0, maxValueWidth - 3) + '...'
    : rawDisplay;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {labelAbove && <Text bold>{label}:</Text>}
      <Box>
        {!labelAbove && <Text bold>{label}: </Text>}
        <Text color={dimmed ? undefined : 'cyan'} dimColor={dimmed}>{display}</Text>
        {active && <Text color="cyanBright">|</Text>}
        {active && mask !== undefined && (
          <Text dimColor>{'  Ctrl+E: ' + (revealed ? 'hide' : 'reveal')}</Text>
        )}
      </Box>
    </Box>
  );
}
