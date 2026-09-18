// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- LLM Assessment app-picker stage (#2373)
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
import type { EligibleApp } from '../types.js';

export interface AppPickerStageProps {
  eligibleApps: EligibleApp[];
  noApps: boolean;
  guidanceOpen: boolean;
  onGuidanceOpenChange: (open: boolean) => void;
  onSelect: (appId: string) => void;
}

export function AppPickerStage({
  eligibleApps,
  noApps,
  guidanceOpen,
  onGuidanceOpenChange,
  onSelect,
}: AppPickerStageProps): React.JSX.Element {
  if (noApps) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">No eligible applications found.</Text>
        <Text>Run `swao assess --app &lt;id&gt;` first to complete at least one App Assessment.</Text>
        <Box marginTop={1}>
          <GuidanceBox
            title="LLM Assessment -- No Apps"
            what="The LLM Assessment compares how different LLM connectors perform on your application's pass suite. You need at least one completed Application Assessment run before you can run LLM Assessment."
            details={[{ label: 'Next step', value: 'Run `swao assess --app <id>` then return here.' }]}
            affordances={['Esc -- go back']}
            onOpenChange={onGuidanceOpenChange}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <SelectInput
        label="Select application to assess:"
        options={eligibleApps.map((a) => ({
          label: `${a.id}  (${a.passCount} pass(es))`,
          value: a.id,
        }))}
        onSelect={onSelect}
        active={!guidanceOpen}
      />
      <GuidanceBox
        title="LLM Assessment -- Select Application"
        what="Select the application whose pass suite will be used to benchmark your LLM providers. The application must have at least one completed App Assessment run. SWAO will run the same pass suite through each LLM Provider you configure."
        details={[
          { label: 'Requirement', value: 'At least one completed `swao assess --app <id>` run.' },
          { label: 'Next steps',  value: 'After selecting an app you will configure which LLM Providers to compare.' },
        ]}
        affordances={['Up/Down -- select  |  Enter -- confirm  |  Esc -- back to menu']}
        onOpenChange={onGuidanceOpenChange}
      />
    </Box>
  );
}
