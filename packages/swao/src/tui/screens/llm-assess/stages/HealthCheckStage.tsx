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
import { GuidanceBox } from '@swao/tui-kit';
import type { PendingLeg } from '../types.js';

export interface HealthCheckStageProps {
  pendingLegCount: number;
  nextLeg: PendingLeg;
  healthStatus: 'running' | 'ok' | 'fail' | null;
  healthMessage: string;
  guidanceOpen: boolean;
  onGuidanceOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function HealthCheckStage({
  pendingLegCount,
  nextLeg,
  healthStatus,
  healthMessage,
  onGuidanceOpenChange,
}: HealthCheckStageProps): React.JSX.Element {
  const activeConn = nextLeg.connector.file.connector;

  return (
    <Box flexDirection="column">
      <Text bold>LLM Provider {pendingLegCount + 1} -- Connectivity check</Text>
      <Text>
        Connector: <Text color="cyanBright">{activeConn.name}</Text>
        {'  '}Model: <Text color="cyanBright">{nextLeg.model}</Text>
      </Text>
      <Box marginTop={1}>
        {healthStatus === 'running' && <Text dimColor>Pinging endpoint... (up to 10s)</Text>}
        {healthStatus === 'ok' && (
          <Text color="green">PASS -- {healthMessage}</Text>
        )}
        {healthStatus === 'fail' && (
          <Box flexDirection="column">
            <Text color="yellow">WARNING -- {healthMessage}</Text>
            <Text dimColor>You can continue anyway (e.g. air-gapped legs) or go back to change the model.</Text>
          </Box>
        )}
      </Box>
      {healthStatus !== 'running' && (
        <Box marginTop={1}>
          <Text dimColor>
            Enter -- add to leg set  |  Esc -- change model
          </Text>
        </Box>
      )}
      <GuidanceBox
        title="Connectivity check"
        what="A minimal prompt is sent to the connector/model combination to verify the endpoint is reachable and the API key is valid. FAIL does not block the assessment -- you can continue and inspect the findings log for details."
        details={[
          { label: 'Timeout',  value: '10 seconds per connector' },
          { label: 'Cost',     value: 'Negligible -- single short prompt' },
          { label: 'Air-gap',  value: 'Pings will FAIL for intentionally air-gapped connectors -- this is expected.' },
        ]}
        affordances={['Enter -- add to leg set  |  Esc -- change model']}
        onOpenChange={onGuidanceOpenChange}
      />
    </Box>
  );
}
