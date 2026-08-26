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

interface PasswordInputProps {
  label: string;
  onSubmit: (value: string) => void;
  active?: boolean;
}

export function PasswordInput({ label, onSubmit, active = true }: PasswordInputProps): JSX.Element {
  const [value, setValue] = useState('');
  // useRef avoids stale closure in useInput when Ink re-uses the handler (#1815).
  const valueRef = useRef(value);
  valueRef.current = value;

  useInput((input, key) => {
    if (!active) return;
    if (key.backspace || key.delete) {
      setValue(v => v.slice(0, -1));
    } else if (key.return) {
      onSubmit(valueRef.current);
    } else if (input && !key.ctrl && !key.meta) {
      setValue(v => v + input);
    }
  });

  return (
    <Box marginBottom={1}>
      <Text bold>{label}: </Text>
      <Text color="cyanBright">{'*'.repeat(value.length)}</Text>
      {active && value.length === 0 && <Text dimColor>(type or paste, then Enter)</Text>}
      {active && <Text color="cyanBright">|</Text>}
    </Box>
  );
}
