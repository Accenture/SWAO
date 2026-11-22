// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- LLM Assessment leg-builder stage (#2373)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import React from 'react';
import { Box, Text } from 'ink';
import { SelectInput, KEY_HINTS, PICKER_VISIBLE_COUNT, tone, useOptionGuidance, type GuidanceEntry, type KeyHint, type SelectOption } from '@swao/tui-kit';
import { LlmStageFrame } from '../stage-frame.js';
import { modelLabel } from '../../../model-label.js';
import type { PendingLeg } from '../types.js';

export interface LegBuilderStageProps {
  noLegs: boolean;
  pendingLegs: PendingLeg[];
  buildLegOptions: SelectOption[];
  buildError: string;
  guidanceOpen: boolean;
  onGuidanceOpenChange: (open: boolean) => void;
  prevLegHint: string;
  minLegs: number;
  maxLegs: number;
  onConnectorSelect: (id: string) => void;
}

/** The list entry that removes the last LLM Provider (#4255: was the Esc key). */
export const LLM_REMOVE_LAST = '__remove_last__';

/**
 * #4255 (Design 126 sections 7.2, 7.4 and 7.9): the standard picker line; the
 * left arrow goes back to the application, Esc aborts the flow. Removing a
 * provider is the list entry "Remove the last LLM Provider" (no key).
 */
export function legBuilderKeys(): readonly KeyHint[] {
  return KEY_HINTS.picker;
}

/** #4255: the keys of the dead end without connectors: back to the application, or leave. */
export const LLM_NO_LEGS_KEYS: readonly KeyHint[] = [{ key: '←', verb: 'back' }, { key: 'Esc', verb: 'abort' }];

/** #4255: the list entry that removes the last provider, with its guidance. */
export function removeLastLegOption(pendingLegs: number, last: string): SelectOption {
  return {
    label: 'Remove the last LLM Provider',
    value: LLM_REMOVE_LAST,
    detail: last,
    guidance: {
      title: 'Remove the last LLM Provider',
      what: `Takes ${last} off the list (${pendingLegs} LLM Provider(s) now); add another one or select Done.`,
    },
  };
}

/** #4230: the guidance of the provider step, shown until an option is highlighted. */
export function legBuilderGuidance(minLegs: number, maxLegs: number, prevLegHint: string): GuidanceEntry {
  return {
    title: 'Select LLM Providers',
    what: `Add LLM Providers one at a time. Each provider is one connector and one model. Add the same connector (for example OpenRouter) more than once with different models to compare them head to head. Minimum ${minLegs}, maximum ${maxLegs} providers.`,
    sections: [
      { label: 'Auth', text: 'Keys are per connector and are set in Setup. A connector without a key fails the connectivity check.' },
      { label: 'Previous', text: prevLegHint },
      { label: 'Remove', text: 'The entry Remove the last LLM Provider takes the last one off the list.' },
    ],
  };
}

export function LegBuilderStage({
  noLegs,
  pendingLegs,
  buildLegOptions,
  buildError,
  onGuidanceOpenChange,
  prevLegHint,
  minLegs,
  maxLegs,
  onConnectorSelect,
}: LegBuilderStageProps): React.JSX.Element {
  const { entry, onCursorChange } = useOptionGuidance(legBuilderGuidance(minLegs, maxLegs, prevLegHint));
  if (noLegs) {
    return (
      <LlmStageFrame
        keys={LLM_NO_LEGS_KEYS}
        guidance={{
          title: 'No LLM connectors',
          what: 'The LLM Assessment compares several LLM Providers on the pass suite of your application. It needs at least two connectors in the workspace (wsp/inputs/llm-gateway/), configured in Setup.',
          cli: 'swao setup --type llm',
        }}
        onGuidanceOpenChange={onGuidanceOpenChange}
      >
        <Box flexDirection="column">
          <Text {...tone('warning')}>No LLM connectors configured in this workspace.</Text>
          <Text>Configure at least two LLM connectors in Setup, then try again.</Text>
        </Box>
      </LlmStageFrame>
    );
  }

  const keys = legBuilderKeys();
  return (
    <LlmStageFrame keys={keys} guidance={entry} onGuidanceOpenChange={onGuidanceOpenChange}>
    <Box flexDirection="column">
      {pendingLegs.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>LLM Providers ({pendingLegs.length}/{maxLegs}):</Text>
          {pendingLegs.map((leg, i) => (
            <Text key={i} {...tone('ok')}>  {i + 1}. {leg.connectorId} / {modelLabel(leg.model)}</Text>
          ))}
        </Box>
      )}
      {buildError && (
        <Box marginBottom={1}><Text {...tone('warning')}>{buildError}</Text></Box>
      )}
      <SelectInput
        label={pendingLegs.length === 0
          ? 'Select connector for LLM Provider 1:'
          : `Add LLM Provider ${pendingLegs.length + 1}, or select Done:`}
        options={buildLegOptions}
        onSelect={onConnectorSelect}
        onCursorChange={onCursorChange}
        visibleCount={PICKER_VISIBLE_COUNT}
        showKeyHints={false}
        active
      />
    </Box>
    </LlmStageFrame>
  );
}
