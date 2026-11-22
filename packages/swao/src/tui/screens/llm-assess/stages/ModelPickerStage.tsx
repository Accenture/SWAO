// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- LLM Assessment model-picker stage (#2373)
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
import { SelectInput, TextInput, KEY_HINTS, PICKER_VISIBLE_COUNT, tone, useOptionGuidance, type KeyHint, type SelectOption, MODEL_FILTER_GUIDANCE } from '@swao/tui-kit';
import { LlmStageFrame } from '../stage-frame.js';
import type { PendingLeg } from '../types.js';
import { OTHER_MODEL_OPTION } from '../../../model-label.js';
import { discoveryEnabled, discoveryFallbackText, type LoadedConnector } from '@swao/module-llm-providers';
import { notServedLine, pickerModelList, pickerModelOption, pickerSourceLine } from '../../../model-picker-list.js';
import { useModelRefresh } from '../../../use-model-refresh.js';

/** #4475: above this many rows the picker filters as you type. */
const FILTER_FROM = 12;

/** #4255 (Design 126 section 7.9): Esc goes back to the provider list. */
export const MODEL_PICKER_KEYS: readonly KeyHint[] = KEY_HINTS.picker;
export const MODEL_INPUT_KEYS: readonly KeyHint[] = KEY_HINTS.textInput;

export interface ModelPickerStageProps {
  isCustom: boolean;
  pendingLegCount: number;
  nextLeg: PendingLeg;
  guidanceOpen: boolean;
  onGuidanceOpenChange: (open: boolean) => void;
  onModelSelect: (model: string) => void;
  onCustom: () => void;
  /** #4475: the workspace whose connector file takes the served models. */
  workspacePath?: string;
  /** #4475: the connector with the merged catalogue after a live discovery. */
  onConnectorRefreshed?: (loaded: LoadedConnector) => void;
}

export function ModelPickerStage({
  isCustom,
  pendingLegCount,
  nextLeg,
  onGuidanceOpenChange,
  onModelSelect,
  onCustom,
  workspacePath,
  onConnectorRefreshed,
}: ModelPickerStageProps): React.JSX.Element {
  const activeConn = nextLeg.connector.file.connector;
  // #4475: the served models are read live when the picker opens (5 s); the
  // list puts served models first, marks the ones the platform does not serve
  // and never starts the cursor on them (model-picker-list.ts).
  const discovery = useModelRefresh(nextLeg.connector, workspacePath, !isCustom, onConnectorRefreshed);
  const listed = discovery.refresh?.status === 'live' ? discovery.refresh.loaded.file.connector : activeConn;
  const list = pickerModelList(listed, { current: nextLeg.model, servedIds: discovery.status === 'live' ? discovery.refresh?.servedIds : undefined });
  // #4220: the model in words ("DeepSeek Pro (latest)"), the current or default
  // mark and the price in the dim detail column, the raw id in the guidance.
  const modelOptions: SelectOption[] = [
    OTHER_MODEL_OPTION,
    ...list.models.map((m) => pickerModelOption(m, activeConn.name)),
  ];
  const sourceLine = pickerSourceLine(discovery.status, discovery.refresh?.servedIds.length ?? 0,
    discoveryFallbackText({ status: discovery.status === 'off' ? 'off' : 'catalogue', reason: discovery.refresh?.reason }));
  const stepDetails = [
    { label: 'Default', value: activeConn.models.default },
    { label: 'Current', value: nextLeg.model },
    ...(activeConn.sovereignty?.data_residency
      ? [{ label: 'Residency', value: String(activeConn.sovereignty.data_residency) }]
      : []),
  ];
  // #4230: the box follows the highlighted model; the step entry until the cursor reports.
  const { entry: modelEntry, onCursorChange } = useOptionGuidance({
    title: `Select model: ${activeConn.name}`,
    what: `Pick the model this leg will use. ${discoveryEnabled(activeConn) ? 'SWAO reads the models the platform serves when this list opens; a model the platform no longer serves is marked not served. Without an answer the list is the workspace catalogue, not checked live' : 'The list is the workspace catalogue; live discovery is turned off for this connector'}. Other model lets you type any model id the platform serves. Your choice is written to portfolio .swao.yml.`,
    sections: stepDetails.map((d) => ({ label: d.label, text: d.value })),
  });
  const hasCatalogue = list.models.length > 0;

  if (isCustom) {
    return (
      <LlmStageFrame
        keys={MODEL_INPUT_KEYS}
        guidance={{ title: 'Custom model id', what: 'Type the model identifier exactly as the platform expects it. For aggregators, use the vendor-prefixed id (for example google/gemini-2.0-flash-001 or mistralai/mistral-large).' }}
        onGuidanceOpenChange={onGuidanceOpenChange}
      >
      <Box flexDirection="column">
        <Text bold>LLM Provider {pendingLegCount + 1}: Custom model</Text>
        <Text>  Connector: <Text {...tone('selection')}>{activeConn.name}</Text>  [{nextLeg.connectorId}]</Text>
        <Box marginTop={1}>
          <TextInput
            key={`pick-model-custom-${pendingLegCount}`}
            label={`Model id (leave blank for default: ${activeConn.models.default})`}
            initialValue=""
            onSubmit={(v) => { onModelSelect(v.trim() || activeConn.models.default); }}
          />
        </Box>
      </Box>
      </LlmStageFrame>
    );
  }

  return (
    <LlmStageFrame keys={hasCatalogue ? MODEL_PICKER_KEYS : MODEL_INPUT_KEYS} guidance={modelEntry} onGuidanceOpenChange={onGuidanceOpenChange}>
    <Box flexDirection="column">
      <Text bold>LLM Provider {pendingLegCount + 1}: Select model</Text>
      <Text>  Connector: <Text {...tone('selection')}>{activeConn.name}</Text>  [{nextLeg.connectorId}]</Text>
      <Text {...tone('muted')}>  {sourceLine}</Text>
      {/* #4475: a stored current model the platform does not serve: a line, never an option. */}
      {list.notServedCurrent ? <Text {...tone('warning')}>  {notServedLine(list.notServedCurrent)}</Text> : null}
      {discovery.status === 'running' ? null : !hasCatalogue ? (
        <Box marginTop={1}>
          <TextInput
            key={`pick-model-notxt-${pendingLegCount}`}
            label={`Model id (Enter for default: ${activeConn.models.default})`}
            initialValue={nextLeg.model}
            onSubmit={(v) => { onModelSelect(v.trim() || activeConn.models.default); }}
          />
        </Box>
      ) : (
        <Box marginTop={1}>
          <SelectInput
            key={`pick-model-${discovery.status}-${pendingLegCount}`}
            label="Model"
            options={modelOptions}
            initialIndex={list.initial >= 0 ? list.initial + 1 : 0}
            filter={modelOptions.length > FILTER_FROM}
            itemNoun="models"
            filterGuidance={MODEL_FILTER_GUIDANCE}
            onSelect={(v) => {
              if (v === '__custom__') { onCustom(); return; }
              onModelSelect(v);
            }}
            onCursorChange={onCursorChange}
            active
            visibleCount={PICKER_VISIBLE_COUNT}
            showKeyHints={false}
          />
        </Box>
      )}
    </Box>
    </LlmStageFrame>
  );
}
