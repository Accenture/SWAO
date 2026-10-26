// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- Setup Wizard: test-code handling (#3403)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3403: TUI parity for assessment.test_code. The choice is written to the
// workspace .swao.yml (no new config file); an app .swao.yml that sets its
// own value wins at assess time.

import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { WizardTestCodeMode } from '../yaml-helpers.js';

export const TEST_CODE_CHOICES: ReadonlyArray<{ mode: WizardTestCodeMode; label: string; help: string }> = [
  { mode: 'include', label: 'Analyse all code (default)', help: 'Test code is analysed like production code; results as before.' },
  { mode: 'tag', label: 'Analyse all code, mark test-code findings', help: 'Findings that rest only on test code are marked and lowered one severity step.' },
  { mode: 'exclude', label: 'Exclude test code', help: 'Test folders and files are not read. The secret scan still covers them (findings marked).' },
];

export function TestCodeStep({ initial, onNext }: {
  initial?: WizardTestCodeMode;
  /** The chosen mode, or undefined when the operator kept the current value (Esc). */
  onNext: (mode?: WizardTestCodeMode) => void;
}) {
  const [idx, setIdx] = useState(Math.max(0, TEST_CODE_CHOICES.findIndex((c) => c.mode === (initial ?? 'include'))));

  useInput((input, key) => {
    if (key.escape) { onNext(undefined); return; }
    if (key.upArrow) { setIdx((i) => (i + TEST_CODE_CHOICES.length - 1) % TEST_CODE_CHOICES.length); return; }
    if (key.downArrow) { setIdx((i) => (i + 1) % TEST_CODE_CHOICES.length); return; }
    if (key.return) { onNext(TEST_CODE_CHOICES[idx]!.mode); return; }
    const n = Number.parseInt(input, 10);
    if (n >= 1 && n <= TEST_CODE_CHOICES.length) onNext(TEST_CODE_CHOICES[n - 1]!.mode);
  });

  return (
    <Box flexDirection="column">
      <Text bold color="cyanBright">Test code</Text>
      <Text dimColor>How should assessments treat test code (src/test/, *.test.ts, *Test.java, systemtest/, e2e/, ...)?</Text>
      <Box marginTop={1} flexDirection="column">
        {TEST_CODE_CHOICES.map((c, i) => (
          <Box key={c.mode} flexDirection="column">
            <Text color={i === idx ? 'cyanBright' : undefined}>{i === idx ? '> ' : '  '}{i + 1}. {c.label}</Text>
            {i === idx && <Text dimColor>     {c.help}</Text>}
          </Box>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Written to the workspace .swao.yml as <Text bold>assessment.test_code.mode</Text>; an app .swao.yml can override it.</Text>
        <Text dimColor>1-3 or Up/Down + Enter to choose  |  Esc to keep the current setting{initial ? ` (${initial})` : ''}</Text>
      </Box>
    </Box>
  );
}
