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
import { SelectInput, TextInput, GuidanceBox, PICKER_VISIBLE_COUNT } from '@swao/tui-kit';
import type { PendingLeg } from '../types.js';

const GW_PICKER_CAP = 40;

function fmtCost(v: number): string {
  return String(+v.toFixed(4));
}

export interface ModelPickerStageProps {
  isCustom: boolean;
  pendingLegCount: number;
  nextLeg: PendingLeg;
  guidanceOpen: boolean;
  onGuidanceOpenChange: (open: boolean) => void;
  onModelSelect: (model: string) => void;
  onCustom: () => void;
}

export function ModelPickerStage({
  isCustom,
  pendingLegCount,
  nextLeg,
  guidanceOpen,
  onGuidanceOpenChange,
  onModelSelect,
  onCustom,
}: ModelPickerStageProps): React.JSX.Element {
  const activeConn = nextLeg.connector.file.connector;
  const catalogue = activeConn.models.catalogue ?? [];
  const modelOptions = [
    { label: 'Other model...  (type any model id the platform serves)', value: '__custom__' },
    ...catalogue.slice(0, GW_PICKER_CAP).map(m => ({
      label: `${m.id}` +
        (m.id === nextLeg.model ? '  (current)' : (m.id === activeConn.models.default ? '  (default)' : '')) +
        (m.cost ? `  [$${fmtCost(m.cost.input_per_million)}/M in, $${fmtCost(m.cost.output_per_million)}/M out]` : ''),
      value: m.id,
    })),
  ];
  const hasCatalogue = catalogue.length > 0;

  if (isCustom) {
    return (
      <Box flexDirection="column">
        <Text bold>LLM Provider {pendingLegCount + 1} -- Custom model</Text>
        <Text>  Connector: <Text color="cyanBright">{activeConn.name}</Text>  [{nextLeg.connectorId}]</Text>
        <Box marginTop={1}>
          <TextInput
            key={`pick-model-custom-${pendingLegCount}`}
            label={`Model id (leave blank for default: ${activeConn.models.default})`}
            initialValue=""
            onSubmit={(v) => { onModelSelect(v.trim() || activeConn.models.default); }}
          />
        </Box>
        <GuidanceBox
          title="Custom model id"
          what="Type the model identifier exactly as the platform expects it. For aggregators, use the vendor-prefixed id (e.g. google/gemini-2.0-flash-001, mistralai/mistral-large)."
          affordances={['Enter -- confirm  |  Esc -- back to leg builder']}
          onOpenChange={onGuidanceOpenChange}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>LLM Provider {pendingLegCount + 1} -- Select model</Text>
      <Text>  Connector: <Text color="cyanBright">{activeConn.name}</Text>  [{nextLeg.connectorId}]</Text>
      {!hasCatalogue ? (
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
            label="Model"
            options={modelOptions}
            onSelect={(v) => {
              if (v === '__custom__') { onCustom(); return; }
              onModelSelect(v);
            }}
            active={!guidanceOpen}
            visibleCount={PICKER_VISIBLE_COUNT}
          />
        </Box>
      )}
      <GuidanceBox
        title={`Select model -- ${activeConn.name}`}
        what={`Pick the model this leg will use. Only models in your workspace catalogue are shown${activeConn.models.discovery_endpoint ? '; "Other..." lets you type any model id the platform serves' : ' -- add more via swao setup'}. Your choice is written to portfolio .swao.yml.`}
        details={[
          { label: 'Default', value: activeConn.models.default },
          { label: 'Current', value: nextLeg.model },
          ...(activeConn.sovereignty?.data_residency
            ? [{ label: 'Residency', value: String(activeConn.sovereignty.data_residency) }]
            : []),
        ]}
        affordances={['Up/Down -- select  |  Enter -- confirm  |  Esc -- back to leg builder']}
        onOpenChange={onGuidanceOpenChange}
      />
    </Box>
  );
}
