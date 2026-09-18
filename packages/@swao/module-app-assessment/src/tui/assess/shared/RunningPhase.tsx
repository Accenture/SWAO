// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { useRef } from 'react';
import type { ComponentType } from 'react';
import { Box, Text, useInput } from 'ink';
import { ProgressBar, LiveOutput, GuidanceBox } from '@swao/tui-kit';
import { PASS_DESCRIPTIONS } from './passDescriptions.js';

export interface RunningPhaseProps {
  progressValue: number;
  progressLabel: string;
  totalPasses: number;
  liveLines: string[];
  passName: string;
  typeLabel: string;
  onBack: () => void;
  Header: ComponentType<{ subtitle?: string }>;
}

// Active running phase -- shown while the assessment subprocess is running.
// Shared by AppAssessmentScreen and LzAssessmentScreen (#2371).
// All subprocess management stays in the parent screen's state machine.
export function RunningPhase({ progressValue, progressLabel, totalPasses, liveLines, passName, typeLabel, onBack, Header }: RunningPhaseProps): JSX.Element {
  const guidanceOpenRef = useRef(false);
  const passInfoVisible = !!passName && PASS_DESCRIPTIONS[passName] !== undefined;
  const startPanelVisible = !passName;

  useInput((_input, key) => {
    if (guidanceOpenRef.current) return;
    if (key.escape) onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle={typeLabel} />
      <ProgressBar
        value={progressValue}
        total={totalPasses}
        label={progressLabel || undefined}
        color="cyan"
      />
      <Text color="yellow">Running assessment...</Text>
      {/* #2546: maxLines reduced from 5 to 4 to budget for wrapped content rows */}
      <LiveOutput lines={liveLines} maxLines={4} label="Output" />
      {/* #1676: Pass description panel always visible when running */}
      <Box marginTop={1}>
        <GuidanceBox
          title={passInfoVisible ? `Pass info -- ${passName.replace(/_/g, ' ')}` : 'Assessment in Progress'}
          what={passInfoVisible
            ? PASS_DESCRIPTIONS[passName]!.summary
            : (startPanelVisible
              ? 'Cloning source repository and preparing analysis passes...'
              : 'Assessment running. Each pass analyses a different workload dimension.')}
          details={passInfoVisible && PASS_DESCRIPTIONS[passName]!.tip
            ? [{ label: 'Tip', value: PASS_DESCRIPTIONS[passName]!.tip! }]
            : undefined}
          affordances={['Ctrl+G -- toggle this panel', 'Esc -- cancel assessment']}
          initiallyCollapsed
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Escape to cancel...</Text>
      </Box>
    </Box>
  );
}
