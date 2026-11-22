// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- LLM Assessment health-check stage (#2373)
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
import { StatusLabel, tone, type KeyHint } from '@swao/tui-kit';
import { LlmStageFrame } from '../stage-frame.js';
import type { PendingLeg } from '../types.js';
import { modelLabel } from '../../../model-label.js';

export interface HealthCheckStageProps {
  pendingLegCount: number;
  nextLeg: PendingLeg;
  healthStatus: 'running' | 'ok' | 'fail' | null;
  healthMessage: string;
  guidanceOpen: boolean;
  onGuidanceOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/** #4255 (Design 126 section 7.9): Enter adds the provider, Esc goes back to the model. */
export const HEALTH_CHECK_KEYS: readonly KeyHint[] = [{ key: 'Enter', verb: 'next' }, { key: '←', verb: 'back' }, { key: 'Esc', verb: 'abort' }];
/** #4255: while the check runs only Esc (abort the flow, after the AbortDialog) is read. */
export const HEALTH_CHECK_RUNNING_KEYS: readonly KeyHint[] = [{ key: 'Esc', verb: 'abort' }];

export function HealthCheckStage({
  pendingLegCount,
  nextLeg,
  healthStatus,
  healthMessage,
  onGuidanceOpenChange,
}: HealthCheckStageProps): React.JSX.Element {
  const activeConn = nextLeg.connector.file.connector;
  const keys: readonly KeyHint[] = healthStatus === 'running' ? HEALTH_CHECK_RUNNING_KEYS : HEALTH_CHECK_KEYS;

  return (
    <LlmStageFrame
      keys={keys}
      guidance={{
        title: 'Connectivity check',
        what: 'A minimal prompt goes to the connector and model to check that the endpoint answers and the API key is valid. A failed check does not block the assessment; continue and read the findings log for the details.',
        sections: [
          { label: 'Timeout', text: '10 seconds per connector.' },
          { label: 'Cost', text: 'Negligible: one short prompt.' },
          { label: 'Air gap', text: 'The check fails for an intentionally air-gapped connector; that is expected.' },
        ],
      }}
      onGuidanceOpenChange={onGuidanceOpenChange}
    >
    <Box flexDirection="column">
      <Text bold>LLM Provider {pendingLegCount + 1}: Connectivity check</Text>
      <Text>
        Connector: <Text {...tone('selection')}>{activeConn.name}</Text>
        {'  '}Model: <Text {...tone('selection')}>{modelLabel(nextLeg.model)}</Text>
      </Text>
      <Box marginTop={1}>
        {healthStatus === 'running' && <Text {...tone('muted')}>Pinging endpoint... (up to 10s)</Text>}
        {healthStatus === 'ok' && (
          <Text><StatusLabel level="ok" /> {healthMessage}</Text>
        )}
        {healthStatus === 'fail' && (
          <Box flexDirection="column">
            <Text><StatusLabel level="warn" /> {healthMessage}</Text>
            <Text {...tone('muted')}>You can continue anyway (for example an air-gapped provider) or go back to change the model.</Text>
          </Box>
        )}
      </Box>
    </Box>
    </LlmStageFrame>
  );
}
