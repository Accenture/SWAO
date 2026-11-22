// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- LLM Assessment save-as-default stage (#4198)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4198 (Design 125 section 5.7, owner decision 2026-11-09): the legs of a
// run are run-time values. They become the new default only when the user
// answers yes here; the answer starts on No, so Enter keeps the default.

import React from 'react';
import { Box, Text } from 'ink';
import { SelectInput, KEY_HINTS, tone, useOptionGuidance, type GuidanceEntry, type KeyHint } from '@swao/tui-kit';
import { LlmStageFrame } from '../stage-frame.js';
import type { ResolvedLeg } from '@swao/module-llm-assessment';
import { modelLabel } from '../../../model-label.js';

export const SAVE_DEFAULT_NO  = 'no';
export const SAVE_DEFAULT_YES = 'yes';

/** #4255 (Design 126 section 7.9): the left arrow goes back to the provider list without writing; Esc aborts. */
export const SAVE_DEFAULT_KEYS: readonly KeyHint[] = KEY_HINTS.picker;

/** #4230: the guidance of the save question, shown until an option is highlighted. */
export const SAVE_DEFAULT_GUIDANCE: GuidanceEntry = {
  title: 'Save as Default',
  what: 'The legs above are used for this run. They are not written to .swao.yml unless you save them as the new default.',
};

/** #4230: the guidance of each answer; the setup note when the setup stores candidates. */
export function saveDefaultOptionGuidance(setupCandidates: boolean): { no: GuidanceEntry; yes: GuidanceEntry } {
  const setup = setupCandidates
    ? [{ label: 'Setup', text: 'The workspace setup stores assessment.llm.candidates. Saved legs take their place until the LLM setup saves candidates again.' }]
    : [];
  return {
    no: { title: 'Use them for this run only', what: 'The run uses these legs; the workspace .swao.yml stays exactly as it is.', sections: setup },
    yes: { title: 'Save them as the new default', what: 'Writes the legs to llm_assessment.legs in the workspace .swao.yml, so the next LLM Assessment and the CLI start with them.', sections: setup },
  };
}

export interface SaveDefaultStageProps {
  resolvedLegs: ResolvedLeg[];
  /** True when the workspace setup stores assessment.llm.candidates (they stay the preselection). */
  setupCandidates: boolean;
  guidanceOpen: boolean;
  onGuidanceOpenChange: (open: boolean) => void;
  onAnswer: (save: boolean) => void;
}

export function SaveDefaultStage({
  resolvedLegs,
  setupCandidates,
  onGuidanceOpenChange,
  onAnswer,
}: SaveDefaultStageProps): React.JSX.Element {
  const { entry, onCursorChange } = useOptionGuidance(SAVE_DEFAULT_GUIDANCE);
  const per = saveDefaultOptionGuidance(setupCandidates);
  const keys = SAVE_DEFAULT_KEYS;
  return (
    <LlmStageFrame keys={keys} guidance={entry} onGuidanceOpenChange={onGuidanceOpenChange}>
    <Box flexDirection="column">
      <Text bold>LLM Providers for this run ({resolvedLegs.length}):</Text>
      {resolvedLegs.map((leg) => (
        <Text key={leg.id} {...tone('ok')}>  {leg.connector} / {modelLabel(leg.model)}{leg.primary ? '  [primary]' : ''}</Text>
      ))}
      <Box marginTop={1}>
        <SelectInput
          label="Save these legs as the new default?"
          options={[
            { label: 'No, use them for this run only', value: SAVE_DEFAULT_NO, guidance: per.no },
            { label: 'Yes, save them as the new default (llm_assessment.legs)', value: SAVE_DEFAULT_YES, guidance: per.yes },
          ]}
          initialIndex={0}
          onSelect={(v) => onAnswer(v === SAVE_DEFAULT_YES)}
          onCursorChange={onCursorChange}
          showKeyHints={false}
          active
        />
      </Box>
    </Box>
    </LlmStageFrame>
  );
}
