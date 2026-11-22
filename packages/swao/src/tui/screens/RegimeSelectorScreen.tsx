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

// #4257 (TUI-13, Design 126 sections 3, 4, 6 and 7): on ScreenLayout; the
// frameworks through the central MultiSelect (bounded, "likely applicable"
// in the second column, its own hint line off), keys through KeyHints (Tab
// opens the id input instead of the letter T named only in the text), the
// available ids, an invalid entry and the saved result as DetailRow and
// StatusRows; the CLI only in the guidance `cli` field; theme tokens only.

import { useState, useRef } from 'react';
import { useInput } from 'ink';
import {
  DetailRow, MultiSelect, ScreenLayout, StatusRow, TextInput, guidanceOwnsKey, useOptionGuidance,
  type GuidanceEntry, type KeyHint, type MultiSelectOption,
} from '@swao/tui-kit';
import { useScreenHeader } from '../components/screen-header.js';
import {
  loadAvailableRegimes,
  readRegimesActive,
  writeRegimesActive,
  regimePickerRow,
} from '../../compliance/regime-picker.js';
import { join } from 'path';

type Phase = 'pick' | 'text-pick' | 'done';

/** The keys per phase (Design 126 section 7.9). */
export function regimeSelectorKeys(phase: Phase): readonly KeyHint[] {
  if (phase === 'pick') {
    return [
      { key: '↑↓', verb: 'select' }, { key: 'Space', verb: 'toggle' }, { key: 'A', verb: 'toggle', object: 'all' },
      { key: 'Enter', verb: 'confirm' }, { key: 'Tab', verb: 'open', object: 'id input' },
    ];
  }
  if (phase === 'text-pick') return [{ key: 'Enter', verb: 'confirm' }, { key: 'Esc', verb: 'back' }];
  return [];
}

const REGIME_GUIDANCE: GuidanceEntry = {
  title: 'Community Frameworks',
  what: 'Select the frameworks for the compliance evaluation (Pass 11). "All frameworks" evaluates every catalogue of the workspace. The id input takes a comma-separated list of ids instead.',
  cli: 'swao regime-select --regimes "GDPR,SOC_2"',
};

const NO_CATALOGUE_GUIDANCE: GuidanceEntry = {
  title: 'No regime catalogues',
  what: 'The workspace has no regime catalogues yet. Workspace Setup scaffolds catalogs/standard/.',
  cli: 'swao init',
};

/** The picker rows: "All frameworks" first, then one row per catalogue; each row carries its guidance entry (#4213). */
export function regimeOptions(rows: ReadonlyArray<{ label: string; value: string; hinted: boolean; guidance?: GuidanceEntry }>): MultiSelectOption[] {
  return [
    {
      label: 'All frameworks (recommended)',
      value: 'all',
      guidance: { title: 'All frameworks', what: 'Evaluates every regime catalogue of the workspace in the compliance evaluation (Pass 11).' },
    },
    ...rows.map((row) => ({ label: row.label, value: row.value, detail: row.hinted ? 'likely applicable' : undefined, ...(row.guidance ? { guidance: row.guidance } : {}) })),
  ];
}

/** #4213: the guidance entry of one catalogue row: the full framework name and its control count. */
export function regimeRowGuidance(id: string, name: string, controls: number, hinted: boolean): GuidanceEntry {
  return {
    title: name,
    what: `Evaluates the ${controls} controls of ${name} (${id}) in the compliance evaluation (Pass 11).${hinted ? ' The context hints of the workspace suggest it applies.' : ''}`,
    cli: `swao regime-select --regimes "${id}"`,
  };
}

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
  const header = useScreenHeader('Community Frameworks');
  // #0259.C3: CLI parity. Default to the interactive picker; allow the
  // operator to switch to a comma-separated text input that mirrors the
  // CLI `regime-select --regimes "GDPR,SOC_2"` non-interactive path.
  const [phase, setPhase] = useState<Phase>('pick');
  const [chosen, setChosen] = useState<string[]>(initial);
  const [textInvalid, setTextInvalid] = useState<string>('');

  const guidanceOpenRef = useRef(false);
  // #4213 (Design 126 section 9): the guidance box follows the highlighted framework.
  const frameworkGuidance = useOptionGuidance(REGIME_GUIDANCE);

  // Tab opens the id input; Esc from the id input returns to the picker.
  useInput((_input, key) => {
    // Design 126 section 7.8: an open guidance box owns Esc and the pager keys.
    if (guidanceOwnsKey(key, guidanceOpenRef.current)) return;
    if (phase === 'pick' && key.tab && !key.shift) {
      setPhase('text-pick');
      setTextInvalid('');
    }
    if (phase === 'text-pick' && key.escape) {
      setPhase('pick');
      setTextInvalid('');
    }
  });

  const onGuidanceOpen = (open: boolean): void => { guidanceOpenRef.current = open; };

  if (available.length === 0) {
    return (
      <ScreenLayout header={header} title={{ title: 'Community Frameworks' }} keys={[]} guidance={{ entry: NO_CATALOGUE_GUIDANCE, initiallyCollapsed: true, onOpenChange: onGuidanceOpen }}>
        <StatusRow level="missing" label="Catalogues" summary="no regime catalogues found; run Workspace Setup first" />
      </ScreenLayout>
    );
  }

  const options = regimeOptions(available.map((r) => {
    const row = regimePickerRow(r, contextHints);
    return { ...row, guidance: regimeRowGuidance(r.entry.id, r.entry.name, r.entry.controls_count, row.hinted) };
  }));

  const handleConfirm = (values: string[]) => {
    writeRegimesActive(swaoYmlPath, values);
    setChosen(values);
    setPhase('done');
    onDone(values);
  };

  // #0259.C3: parse comma-separated text input, validate each id against
  // the loaded catalogue, persist iff every id resolves. Invalid ids land
  // in textInvalid for operator feedback (mirrors the CLI's behaviour of
  // erroring on unknown regimes).
  const handleTextSubmit = (raw: string) => {
    const ids = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      setTextInvalid('Empty list; type at least one regime id.');
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
    <ScreenLayout
      header={header}
      title={phase === 'pick'
        ? { title: 'Select community frameworks', subtitle: 'The frameworks of the compliance evaluation (Pass 11).' }
        : phase === 'text-pick' ? { title: 'Type the regime ids' }
        : { title: 'Community frameworks saved' }}
      keys={regimeSelectorKeys(phase)}
      guidance={{ entry: phase === 'pick' ? frameworkGuidance.entry : REGIME_GUIDANCE, initiallyCollapsed: true, onOpenChange: onGuidanceOpen }}
    >
      {phase === 'pick' && (
        <MultiSelect
          label="Frameworks"
          options={options}
          initialSelected={initial.length > 0 ? initial : ['all']}
          allValue="all"
          visibleCount={Math.min(options.length, 12)}
          showKeyHints={false}
          onCursorChange={frameworkGuidance.onCursorChange}
          onConfirm={handleConfirm}
        />
      )}
      {phase === 'text-pick' && (
        <>
          <DetailRow label="Available" value={availableIds.join(', ')} />
          <TextInput
            key="regime-text"
            label="Comma-separated regime ids"
            placeholder="GDPR,SOC_2,DORA"
            onSubmit={handleTextSubmit}
            active
          />
          {textInvalid && <StatusRow level="fail" label="Regime ids" summary={textInvalid} />}
        </>
      )}
      {phase === 'done' && (
        <StatusRow level="ok" label="Saved" summary={`${chosen.length} regime(s) to .swao.yml: ${chosen.join(', ')}`} />
      )}
    </ScreenLayout>
  );
}
