// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- LLM Assessment review-config stage (#2373)
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
import { GuidanceBox } from '@swao/tui-kit';
import type { ResolvedLeg } from '@swao/module-llm-assessment';
import type { EligibleApp } from '../types.js';

export interface ReviewConfigStageProps {
  selectedApp: EligibleApp;
  resolvedLegs: ResolvedLeg[];
  costEstimate: number;
  crawlAvailable: boolean;
  includeCrawl: boolean;
  guidanceOpen: boolean;
  onGuidanceOpenChange: (open: boolean) => void;
}

export function ReviewConfigStage({
  selectedApp,
  resolvedLegs,
  costEstimate,
  crawlAvailable,
  includeCrawl,
  onGuidanceOpenChange,
}: ReviewConfigStageProps): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text bold>Review LLM Assessment configuration</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>Application : {selectedApp.id}</Text>
        <Text>LLM Providers ({resolvedLegs.length}):</Text>
        {resolvedLegs.map((leg) => (
          <Text key={leg.id}>  {leg.connector} / {leg.model}{leg.primary ? '  [primary]' : ''}</Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text>
          Estimated cost: ~${costEstimate.toFixed(3)}
          {'  '}({selectedApp.passCount} pass(es) x {resolvedLegs.length} LLM Provider(s) x $0.002)
        </Text>
      </Box>
      {crawlAvailable && (
        <Box marginTop={1}>
          <Text>Vision crawl : {includeCrawl ? 'ON  (screenshots will be captured)' : 'OFF (parity-baseline only)'}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>Enter -- start assessment   Esc -- back to provider builder{crawlAvailable ? '   C -- toggle vision crawl' : ''}</Text>
      </Box>
      <Box marginTop={1}>
        <GuidanceBox
          title="LLM Assessment -- Review Configuration"
          what="Confirm the LLM Providers and cost estimate before starting. Each provider will run the full pass suite independently; results are compared with weighted dimension scoring."
          details={[
            { label: 'Cost basis', value: '$0.002 per pass per LLM Provider (approximate; depends on model pricing).' },
            { label: 'Duration',   value: 'Serial mode: providers run one at a time. Parallel mode: providers run concurrently.' },
          ]}
          affordances={['Enter -- start  |  Esc -- back to provider builder']}
          initiallyCollapsed
          onOpenChange={onGuidanceOpenChange}
        />
      </Box>
    </Box>
  );
}
