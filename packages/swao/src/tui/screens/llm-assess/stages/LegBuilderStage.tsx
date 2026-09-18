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
import { SelectInput, GuidanceBox } from '@swao/tui-kit';
import type { PendingLeg } from '../types.js';

export interface LegBuilderStageProps {
  noLegs: boolean;
  pendingLegs: PendingLeg[];
  buildLegOptions: Array<{ label: string; value: string }>;
  buildError: string;
  guidanceOpen: boolean;
  onGuidanceOpenChange: (open: boolean) => void;
  prevLegHint: string;
  minLegs: number;
  maxLegs: number;
  onConnectorSelect: (id: string) => void;
}

export function LegBuilderStage({
  noLegs,
  pendingLegs,
  buildLegOptions,
  buildError,
  guidanceOpen,
  onGuidanceOpenChange,
  prevLegHint,
  minLegs,
  maxLegs,
  onConnectorSelect,
}: LegBuilderStageProps): React.JSX.Element {
  if (noLegs) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">No LLM connectors configured in this workspace.</Text>
        <Text>Run `swao setup` to configure at least two LLM connectors, then try again.</Text>
        <Box marginTop={1}>
          <GuidanceBox
            title="LLM Assessment -- No Connectors"
            what="LLM Assessment compares multiple LLM legs on your application pass suite. You need at least two connectors configured in your workspace (wsp/inputs/llm-gateway/) via `swao setup`."
            affordances={['Esc -- go back']}
            onOpenChange={onGuidanceOpenChange}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {pendingLegs.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>LLM Providers ({pendingLegs.length}/{maxLegs}):</Text>
          {pendingLegs.map((leg, i) => (
            <Text key={i} color="green">  [{i + 1}] {leg.connectorId} / {leg.model}</Text>
          ))}
        </Box>
      )}
      {buildError && (
        <Box marginBottom={1}><Text color="yellow">{buildError}</Text></Box>
      )}
      <SelectInput
        label={pendingLegs.length === 0
          ? 'Select connector for LLM Provider 1:'
          : `Add LLM Provider ${pendingLegs.length + 1} -- or select Done:`}
        options={buildLegOptions}
        onSelect={onConnectorSelect}
        active={!guidanceOpen}
      />
      <GuidanceBox
        title="LLM Assessment -- Select LLM Providers"
        what={`Add LLM Providers one at a time. Each provider is one connector + one model. You can add the same connector (e.g. OpenRouter) multiple times with different models to compare them head-to-head. Minimum ${minLegs}, maximum ${maxLegs} providers.`}
        details={[
          { label: 'Auth',      value: 'Keys are per-connector (set via swao setup). A connector marked [no key] will fail the connectivity check.' },
          { label: 'Previous',  value: prevLegHint },
          { label: 'Remove',    value: 'Esc removes the last provider from the list.' },
        ]}
        affordances={['Enter -- select  |  Esc -- remove last provider / back to app picker']}
        onOpenChange={onGuidanceOpenChange}
      />
    </Box>
  );
}
