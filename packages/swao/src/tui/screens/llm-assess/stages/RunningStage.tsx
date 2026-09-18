// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- LLM Assessment running stage (#2374)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import React, { useState, useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import { GuidanceBox, ProgressBar } from '@swao/tui-kit';
import type { ResolvedLeg } from '@swao/module-llm-assessment';

export interface RunningStageProps {
  resolvedLegs: ResolvedLeg[];
  progressLines: string[];
  legCallLines: string[];
  selectedAppId: string;
  guidanceOpen: boolean;
  onGuidanceOpenChange: (open: boolean) => void;
}

export function RunningStage({
  resolvedLegs,
  progressLines,
  legCallLines,
  selectedAppId,
  onGuidanceOpenChange,
}: RunningStageProps): React.JSX.Element {
  // #2563: cap progress lines to terminal width
  const { stdout } = useStdout();
  const [cols, setCols] = useState(stdout?.columns ?? 80);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setCols(stdout.columns ?? 80);
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

  // Progress bar (#1443): count completed providers from progress messages.
  // #2548: match 'leg N: complete (M calls)' only -- NOT 'leg N: challenge complete'
  // which also contains ': complete' and causes the bar to prematurely show 100%.
  const completedLegs = progressLines.filter(l => /: complete \(/.test(l)).length;
  const startingLegs  = progressLines.filter(l => l.includes(': starting')).length;
  const inFlightLegs  = Math.max(0, startingLegs - completedLegs);
  const rawProgressValue = completedLegs + (inFlightLegs > 0 ? 0.5 : 0);
  // #2548: cap at 95% of total while in running stage so synthesis/interpretation
  // (which runs after all legs complete) doesn't leave the bar stuck at 100%.
  // The result screen is the UX signal for "fully done".
  const progressValue = Math.min(rawProgressValue, resolvedLegs.length * 0.95);
  const allLegsComplete = completedLegs >= resolvedLegs.length;

  return (
    <Box flexDirection="column">
      <Text bold>Running LLM Assessment...</Text>
      {/* #1585: ensure at least 0.5 progress when running but no messages yet */}
      {/* #2597: label is short status only; provider/model detail is in --- Output --- via progressLines */}
      <ProgressBar
        value={progressValue > 0 ? progressValue : 0.5}
        total={resolvedLegs.length}
        label={!allLegsComplete
          ? `Provider ${completedLegs + 1}/${resolvedLegs.length}`
          : 'Synthesising results...'}
        color={allLegsComplete ? 'green' : 'cyan'}
        width={28}
      />
      {/* #2573: consistent "--- Output ---" section header matching AppAssessmentScreen */}
      <Text dimColor>--- Output ---</Text>
      <Box flexDirection="column" width={cols}>
        {progressLines.length === 0
          ? <Text dimColor>{`Starting ${resolvedLegs[0] ? `${resolvedLegs[0].connector}/${resolvedLegs[0].model}` : 'assessment'}...`}</Text>
          : progressLines.slice(-6).map((line, i) => (
              <Text key={i} dimColor wrap="wrap">{line}</Text>
            ))
        }
      </Box>
      {/* #1477: per-call progress from the active leg's app event log */}
      {legCallLines.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {legCallLines.map((line, i) => (
            <Text key={i} color="white" dimColor>{line}</Text>
          ))}
        </Box>
      )}
      {/* #1586: stable key prevents GuidanceBox remount when legCallLines appear */}
      <Box key="guidance-running" marginTop={1}>
        <GuidanceBox
          title="LLM Assessment -- Running"
          what="Each provider runs the full pass suite in serial. Results are saved to the run folder. Do not close this window until the assessment completes."
          details={[
            { label: 'Providers', value: `${resolvedLegs.length} total -- running in serial` },
            { label: 'App',       value: selectedAppId },
            { label: 'Duration',  value: `Approx ${resolvedLegs.length * 5}-${resolvedLegs.length * 10} min total (varies by model latency)` },
            { label: 'Cancel',    value: 'Ctrl+C to cancel -- partial results are saved to the run folder' },
            { label: 'Log',       value: 'llm-assessments/swao/<timestamp>/log.ndjson' },
          ]}
          affordances={['Ctrl+G -- open/close this guidance  |  Ctrl+C to cancel']}
          initiallyCollapsed
          onOpenChange={onGuidanceOpenChange}
        />
      </Box>
    </Box>
  );
}
