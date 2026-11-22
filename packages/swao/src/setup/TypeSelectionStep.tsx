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

// #4191 SET-02 (Design 125 sections 4, 5.1, Q-06): "Which assessments will
// you run?" A multi-select of the five types with their setup state. Types the
// tier cannot run are shown greyed out with the tier and cannot be chosen.

import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { KEY_HINTS, PickerRow, StatusLabel, optionNumber, tone, withLabelColon, type GuidanceEntry, type KeyHint, type StatusLevel } from '@swao/tui-kit';
import {
  SETUP_ASSESSMENT_TYPES,
  SETUP_ASSESSMENT_TYPE_LABELS,
  SETUP_ASSESSMENT_TYPE_MIN_TIER,
  isSetupTypeAvailable,
  type LicenceTier,
  type SetupAssessmentType,
  type SetupBranchState,
} from '@swao/core';
import { SetupStepFrame } from './setup-frame.js';
import { branchStateWord } from './ready-rows.js';

const TIER_NAME: Readonly<Record<LicenceTier, string>> = { community: 'Community', consultant: 'Consultant', enterprise: 'Enterprise' };

export interface TypeSelectionStepProps {
  tier: LicenceTier;
  /** Types ticked at start (workspace.assessment_types or the inferred types). */
  initial: readonly SetupAssessmentType[];
  /** Setup state per type, shown next to the name. */
  states: Readonly<Partial<Record<SetupAssessmentType, SetupBranchState>>>;
  /** #4282: the recorded state with its cause ("needs attention: waiting for Intake workbook"); wins over `states`. */
  notes?: Readonly<Partial<Record<SetupAssessmentType, string>>>;
  /** The chosen types in branch order; undefined when Esc kept the current choice. */
  onNext: (selected: SetupAssessmentType[] | undefined) => void;
  /** Title line; defaults to the first-run question. */
  title?: string;
  /** Single choice (main menu "Set up an assessment type"): Enter picks the highlighted type. */
  single?: boolean;
}
// #4341 (run 9): Esc is never the step's. Inside the wizard flow it aborts;
// on the Setup menu's type picker SetupWizard.tsx returns to the menu. Enter
// with the ticks unchanged keeps the recorded choice.

/**
 * #4294: the parts of one type line: mark and name, the state word with its
 * status level (Design 126 section 6: ready ok, needs attention warn, not set
 * up waiting, a type of a higher tier info) and the rest of the note (the
 * cause of needs attention). Exported for tests.
 */
export function typeSelectionParts(type: SetupAssessmentType, tier: LicenceTier, ticked: boolean, state: SetupBranchState | undefined, single: boolean, stateNote?: string): { head: string; word: string; level: StatusLevel; rest: string } {
  const available = isSetupTypeAvailable(type, tier);
  const mark = single ? '' : available ? (ticked ? '[x] ' : '[ ] ') : '[-] ';
  const head = `${mark}${SETUP_ASSESSMENT_TYPE_LABELS[type]}`;
  if (!available) return { head, word: `needs ${TIER_NAME[SETUP_ASSESSMENT_TYPE_MIN_TIER[type]]}`, level: 'info', rest: '' };
  const w = branchStateWord(state ?? 'not-set-up');
  const note = stateNote ?? w.text;
  // The recorded note starts with the state word ("needs attention: waiting for Intake workbook").
  if (note.startsWith(w.text)) return { head, word: w.text, level: w.level, rest: note.slice(w.text.length) };
  return { head, word: note, level: w.level, rest: '' };
}

/** #4254: the number column of a type row, as a numbered SelectInput draws it ("1  "); the marker is PickerRow's. */
export function typeRowNumber(index: number): string {
  return optionNumber(index).padEnd(3);
}

/** The menu line of one type: mark, name, state or tier note. Exported for tests. */
export function typeSelectionLine(type: SetupAssessmentType, tier: LicenceTier, ticked: boolean, state: SetupBranchState | undefined, single: boolean, stateNote?: string): string {
  const p = typeSelectionParts(type, tier, ticked, state, single, stateNote);
  return `${p.head}  (${p.word}${p.rest})`;
}

/** #4230: the guidance entry of one assessment type row (what it assesses, its state or tier, where the choice is saved). */
export function typeSelectionGuidance(type: SetupAssessmentType, tier: LicenceTier, single: boolean, state: SetupBranchState | undefined, stateNote?: string): GuidanceEntry {
  const available = isSetupTypeAvailable(type, tier);
  const st = typeSelectionParts(type, tier, false, state, true, stateNote);
  return {
    title: SETUP_ASSESSMENT_TYPE_LABELS[type],
    what: `${TYPE_PURPOSE[type]} ${single
      ? 'Its setup steps, health check and Ready summary follow.'
      : 'Each ticked type gets its setup steps, health check and Ready summary.'}`,
    sections: [
      // #4294: the recorded state with its cause in the detail of the highlighted type.
      ...(available ? [{ label: 'State', text: `${st.word}${st.rest}` }] : []),
      ...(available ? [] : [{ label: 'Licence', text: `This type needs the ${TIER_NAME[SETUP_ASSESSMENT_TYPE_MIN_TIER[type]]} tier; it is shown greyed out.` }]),
      { label: 'Saved as', text: 'workspace.assessment_types in the workspace .swao.yml.' },
    ],
  };
}

export function TypeSelectionStep({ tier, initial, states, notes, onNext, title, single = false }: TypeSelectionStepProps) {
  const [idx, setIdx] = useState(0);
  const [ticked, setTicked] = useState<Set<SetupAssessmentType>>(() => new Set(initial.filter((t) => isSetupTypeAvailable(t, tier))));
  const types = SETUP_ASSESSMENT_TYPES;

  useInput((input, key) => {
    if (key.upArrow) { setIdx((i) => (i + types.length - 1) % types.length); return; }
    if (key.downArrow) { setIdx((i) => (i + 1) % types.length); return; }
    const n = Number.parseInt(input, 10);
    const target = n >= 1 && n <= types.length ? n - 1 : -1;
    if (target >= 0) setIdx(target);
    const at = types[target >= 0 ? target : idx]!;
    if (single) {
      if ((key.return || target >= 0) && isSetupTypeAvailable(at, tier)) onNext([at]);
      return;
    }
    if (input === ' ' || target >= 0) {
      if (!isSetupTypeAvailable(at, tier)) return;
      setTicked((s) => { const c = new Set(s); if (c.has(at)) c.delete(at); else c.add(at); return c; });
      return;
    }
    if (key.return) onNext(types.filter((t) => ticked.has(t)));
  });

  const current = types[idx]!;
  const guidance = typeSelectionGuidance(current, tier, single, states[current], notes?.[current]);
  const keys: readonly KeyHint[] = single ? KEY_HINTS.picker : KEY_HINTS.multiSelect;
  return (
    <SetupStepFrame title={title ?? 'Which assessments will you run?'} subtitle={single ? 'Choose the assessment type to set up.' : 'Tick the assessment types this engagement runs.'} keys={keys} guidance={guidance}>
      {/* #4254 (Design 126 section 3 margin): the rows sit two columns under their label with the
          marker and the number in the geometry of a numbered SelectInput ("❯ 1  Application
          Assessment"); the rows are PickerRows because the state word keeps its status colour (#4294). */}
      <Box flexDirection="column">
        <Text bold>{withLabelColon(single ? 'Assessment type' : 'Assessment types')}</Text>
        {types.map((t, i) => {
          const ok = isSetupTypeAvailable(t, tier);
          const style = !ok ? tone('muted') : i === idx ? tone('selection') : tone('text');
          const p = typeSelectionParts(t, tier, ticked.has(t), states[t], single, notes?.[t]);
          // #4294: the state word in its status colour; name and cause keep the row colour.
          return (
            <PickerRow key={t} selected={i === idx} wrap="wrap">
              <Text {...style}>
                {typeRowNumber(i)}{p.head}{'  ('}<StatusLabel level={p.level} form="summary" text={p.word} />{p.rest}{')'}
              </Text>
            </PickerRow>
          );
        })}
      </Box>
    </SetupStepFrame>
  );
}

/** What each assessment type assesses (the guidance of its row, #4230). */
const TYPE_PURPOSE: Readonly<Record<SetupAssessmentType, string>> = {
  application: 'Application Assessment: reads the source of one application and scores its sovereignty, security and migration readiness.',
  service: 'Service Portfolio Assessment: scores a portfolio of services from an intake workbook, one row per service.',
  'lz-catalog': 'Landing Zone Catalog Assessment: compares the published service catalogues of the cloud providers against the controls, without a login.',
  'lz-live': 'Landing Zone Live Assessment: reads a client landing zone through a read-only login and checks it against the controls.',
  llm: 'LLM Assessment: compares LLM models and providers on sovereignty, cost and quality for the engagement.',
};
