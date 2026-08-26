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

import { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { Header } from '../components/Header.js';
import { MultiSelect } from '@swao/tui-kit';
import { TextInput } from '@swao/tui-kit';
import { GuidanceBox } from '@swao/tui-kit';
import {
  loadAvailableRegimes,
  readRegimesActive,
  writeRegimesActive,
  regimePickerRow,
} from '../../compliance/regime-picker.js';
import { join } from 'path';

interface RegimeSelectorScreenProps {
  workspacePath: string;
  contextHints?: string[];
  onDone: (regimes: string[]) => void;
}

export function RegimeSelectorScreen({
  workspacePath,
  contextHints = [],
  onDone,
}: RegimeSelectorScreenProps) {
  const swaoYmlPath = join(workspacePath, '.swao.yml');
  const available = loadAvailableRegimes(workspacePath);
  const availableIds = available.map((r) => r.entry.id);
  const initial = readRegimesActive(swaoYmlPath);
  // #0259.C3 -- CLI parity. Default to the interactive picker; allow the
  // operator to switch to a comma-separated text input that mirrors the
  // CLI `regime-select --regimes "GDPR,SOC_2"` non-interactive path.
  const [phase, setPhase] = useState<'pick' | 'text-pick' | 'done'>('pick');
  const [chosen, setChosen] = useState<string[]>(initial);
  const [textInvalid, setTextInvalid] = useState<string>('');

  const guidanceOpenRef = useRef(false);

  // 'T' toggles to text-input mode; Escape from text-input returns to picker.
  useInput((input, key) => {
    if (guidanceOpenRef.current) return;
    if (phase === 'pick' && (input === 't' || input === 'T')) {
      setPhase('text-pick');
      setTextInvalid('');
    }
    if (phase === 'text-pick' && key.escape) {
      setPhase('pick');
      setTextInvalid('');
    }
  });

  if (available.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Header />
        <Text color="yellow">
          No regime catalogues found. Run `swao init` first to scaffold
          catalogs/standard/.
        </Text>
      </Box>
    );
  }

  const options = [
    { label: 'All frameworks (recommended)', value: 'all' },
    ...available.map((r) => {
      const row = regimePickerRow(r, contextHints);
      return {
        label: row.hinted ? `${row.label}  (likely applicable)` : row.label,
        value: row.value,
      };
    }),
  ];

  const handleConfirm = (values: string[]) => {
    writeRegimesActive(swaoYmlPath, values);
    setChosen(values);
    setPhase('done');
    onDone(values);
  };

  // #0259.C3 -- parse comma-separated text input, validate each id against
  // the loaded catalogue, persist iff every id resolves. Invalid ids land
  // in textInvalid for operator feedback (mirrors the CLI's behaviour of
  // erroring on unknown regimes).
  const handleTextSubmit = (raw: string) => {
    const ids = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      setTextInvalid('Empty list -- type at least one regime id, or Escape to use the picker.');
      return;
    }
    const unknown = ids.filter((id) => !availableIds.includes(id));
    if (unknown.length > 0) {
      setTextInvalid(
        `Unknown regime id(s): ${unknown.join(', ')}. Known: ${availableIds.join(', ')}`,
      );
      return;
    }
    handleConfirm(ids);
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header />
      {phase === 'pick' && (
        <>
          <MultiSelect
            label="Select community frameworks (space to toggle, Enter to confirm)"
            options={options}
            initialSelected={initial.length > 0 ? initial : ['all']}
            allValue="all"
            onConfirm={handleConfirm}
          />
          <GuidanceBox
            title="Community Frameworks"
            what="Select frameworks for compliance evaluation (Pass 11)."
            details={[{ label: 'Available', value: options.map(o => o.value).join(', ') }]}
            affordances={['Space -- toggle  |  A -- all  |  Enter -- confirm  |  Ctrl+G -- guidance']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </>
      )}
      {phase === 'text-pick' && (
        <Box flexDirection="column">
          <Text dimColor>
            Available regimes: <Text color="cyanBright">{availableIds.join(', ')}</Text>
          </Text>
          <Box marginTop={1}>
            <TextInput
              key="regime-text"
              label="Comma-separated regime ids"
              placeholder="GDPR,SOC_2,DORA"
              onSubmit={handleTextSubmit}
              active
            />
          </Box>
          {textInvalid && (
            <Box marginTop={1}>
              <Text color="red">{textInvalid}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Escape to return to the interactive picker.</Text>
          </Box>
        </Box>
      )}
      {phase === 'done' && (
        <Box flexDirection="column">
          <Text color="green">
            Saved {chosen.length} regime(s) to .swao.yml: {chosen.join(', ')}
          </Text>
        </Box>
      )}
    </Box>
  );
}
