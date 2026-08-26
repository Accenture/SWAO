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
}

export function TextInput({ label, placeholder, initialValue = '', onSubmit, active = true, mask }: TextInputProps): JSX.Element {
  const [value, setValue] = useState(initialValue);
  const [revealed, setRevealed] = useState(false);
  // useRef avoids stale closure in useInput when Ink re-uses the handler (#1815).
  const valueRef = useRef(value);
  valueRef.current = value;

  useInput((input, key) => {
    if (!active) return;
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
  const display = masked
    ? (value.length > 0 ? mask.repeat(value.length) : (placeholder ?? ''))
    : (value.length > 0 ? value : (placeholder ?? ''));
  const dimmed  = value.length === 0;

  return (
    <Box marginBottom={1}>
      <Text bold>{label}: </Text>
      <Text color={dimmed ? undefined : 'cyan'} dimColor={dimmed}>{display}</Text>
      {active && <Text color="cyanBright">|</Text>}
      {active && mask !== undefined && (
        <Text dimColor>{'  Ctrl+E: ' + (revealed ? 'hide' : 'reveal')}</Text>
      )}
    </Box>
  );
}
