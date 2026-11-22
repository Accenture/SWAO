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
// lenses through the central MultiSelect (Space toggles, Enter saves, the
// passes and auto frameworks in the second column, one guidance entry per
// lens, bounded); after saving, the pass union as a DetailRow and the next
// step as a numbered menu ("Run Assessment now", "Back to Tools") instead of
// the letter keys A, R and B; results as StatusRows; theme tokens only.

import { useMemo, useRef, useState } from 'react';
import { useInput } from 'ink';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import {
  DetailRow, MultiSelect, ScreenLayout, SelectInput, StatusRow,
  guidanceOwnsKey, useOptionGuidance,
  type GuidanceEntry, type KeyHint, type MultiSelectOption, type SelectOption,
} from '@swao/tui-kit';
import { findWorkspace } from '@swao/core';
import { useScreenHeader } from '../components/screen-header.js';
import {
  listLenses,
  readWorkspaceLenses,
  writeWorkspaceLenses,
  type LensDef,
} from '../../commands/lenses.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the controls/lenses directory robustly: try multiple candidate
// paths to handle both development (src/) and binary (pkg snapshot) layouts.
function resolveLensesDir(): string {
  const candidates = [
    join(__dirname, '../../../../../controls/lenses'),  // dist/tui/screens -> swao/
    join(__dirname, '../../../../controls/lenses'),      // alt depth
    join(__dirname, '../../../../../../controls/lenses'),// pkg snapshot extra level
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p) && readdirSync(p).some(f => f.endsWith('.yaml'))) return p;
    } catch { /* skip */ }
  }
  return candidates[0]; // fallback; listLenses will return []
}

const LENSES_DIR = resolveLensesDir();

type Phase = 'pick' | 'saved';

const LENSES_GUIDANCE: GuidanceEntry = {
  title: 'Assessment Lenses',
  what: 'Lenses select which analysis passes run and which compliance frameworks are applied automatically. The selection is saved to the workspace .swao.yml.',
  sections: [{ label: 'After saving', text: 'Run Assessment uses the saved lenses.' }],
  cli: 'swao lenses set <id> [<id>...]',
};

/** The keys per phase. */
export function lensesKeys(phase: Phase): readonly KeyHint[] {
  return phase === 'pick'
    ? [{ key: '↑↓', verb: 'select' }, { key: 'Space', verb: 'toggle' }, { key: 'Enter', verb: 'save' }, { key: 'Esc', verb: 'back' }]
    : [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'open' }, { key: 'Esc', verb: 'back' }];
}

/** One MultiSelect row per lens: the id, its passes and auto frameworks in the second column. */
export function lensOptions(defs: readonly LensDef[]): MultiSelectOption[] {
  return defs.map((def) => {
    const fw = def.auto_frameworks.length > 0 ? `; auto: ${def.auto_frameworks.join(', ')}` : '';
    return {
      label: def.id,
      value: def.id,
      detail: `passes: ${def.passes.join(', ')}${fw}`,
      guidance: {
        title: def.id,
        what: `Runs the passes ${def.passes.join(', ')}.`,
        sections: def.auto_frameworks.length > 0 ? [{ label: 'Frameworks', text: def.auto_frameworks.join(', ') }] : undefined,
      },
    };
  });
}

/** The union of the passes of the chosen lenses, in lens order. */
export function passUnion(defs: readonly LensDef[], chosen: readonly string[]): string[] {
  return Array.from(new Set(defs.filter((d) => chosen.includes(d.id)).flatMap((d) => d.passes)));
}

const NEXT_OPTIONS: SelectOption[] = [
  { label: 'Run Assessment now', value: 'run', guidance: { title: 'Run Assessment now', what: 'Opens Run Assessment with the saved lenses.' } },
  { label: 'Back to Tools', value: 'back', guidance: { title: 'Back to Tools', what: 'The lenses stay saved for the next assessment.' } },
];

interface LensesScreenProps {
  onBack: () => void;
  onRunAssessment?: () => void;
}

export function LensesScreen({ onBack, onRunAssessment }: LensesScreenProps) {
  const workspace = findWorkspace(process.cwd());
  const swaoYmlPath = workspace ? join(workspace, '.swao.yml') : null;
  const header = useScreenHeader('Manage Assessment Lenses');

  const defs = useMemo(() => listLenses(LENSES_DIR), []);
  const active = useMemo(() => (swaoYmlPath ? readWorkspaceLenses(swaoYmlPath) : []), [swaoYmlPath]);
  const options = useMemo(() => lensOptions(defs), [defs]);

  const [phase, setPhase] = useState<Phase>('pick');
  const [chosen, setChosen] = useState<string[]>(active);
  const [error, setError] = useState('');
  const guidanceOpenRef = useRef(false);
  const lensGuidance = useOptionGuidance(LENSES_GUIDANCE);
  // #4213: the Next picker of the saved phase has its own cursor entry.
  const nextGuidance = useOptionGuidance(LENSES_GUIDANCE);

  // Saves the selection to .swao.yml; the error shows as a StatusRow.
  const save = (values: string[]): void => {
    setChosen(values);
    if (!swaoYmlPath) {
      setError('No workspace found; open SWAO in a workspace directory first.');
      return;
    }
    try {
      writeWorkspaceLenses(swaoYmlPath, values);
      setError('');
      setPhase('saved');
    } catch (err) {
      setError(`Error saving: ${(err as Error).message}`);
    }
  };

  useInput((_input, key) => {
    // Design 126 section 7.8: an open guidance box owns Esc and the pager keys.
    if (guidanceOwnsKey(key, guidanceOpenRef.current)) return;
    if (key.escape) onBack();
  });

  const union = passUnion(defs, chosen);

  return (
    <ScreenLayout
      header={header}
      title={phase === 'pick'
        ? { title: 'Assessment Lenses', subtitle: 'Select which analysis passes run and which compliance frameworks are applied.' }
        : { title: 'Lenses saved' }}
      keys={lensesKeys(phase)}
      guidance={{ entry: phase === 'pick' ? lensGuidance.entry : nextGuidance.entry, initiallyCollapsed: true, onOpenChange: (open) => { guidanceOpenRef.current = open; } }}
    >
      {phase === 'pick' && defs.length === 0 && (
        <StatusRow level="fail" label="Lenses" summary="none available; please report this as a bug" />
      )}
      {phase === 'pick' && defs.length > 0 && (
        <MultiSelect
          label="Lenses"
          options={options}
          initialSelected={active}
          allowEmptyConfirm
          visibleCount={Math.min(options.length, 12)}
          showKeyHints={false}
          onCursorChange={lensGuidance.onCursorChange}
          onConfirm={save}
        />
      )}
      {phase === 'pick' && error !== '' && <StatusRow level="fail" label="Save" summary={error} />}
      {phase === 'saved' && (
        <>
          <StatusRow level="ok" label="Saved" summary={`${chosen.length} lens(es): ${chosen.join(', ') || 'none'}`} />
          <DetailRow label="Passes" value={union.length > 0 ? union.join(', ') : 'none selected'} />
          <SelectInput
            label="Next"
            options={NEXT_OPTIONS}
            numbered
            visibleCount={NEXT_OPTIONS.length}
            showKeyHints={false}
            onCursorChange={nextGuidance.onCursorChange}
            onSelect={(value) => { if (value === 'run' && onRunAssessment) onRunAssessment(); else onBack(); }}
          />
        </>
      )}
    </ScreenLayout>
  );
}
