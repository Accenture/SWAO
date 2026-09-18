// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- LLM Assessment result/saving/error stage (#2374)
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
import type { OrchestrationResult, ResolvedLeg } from '@swao/module-llm-assessment';
import { LlmResultTable } from '../LlmResultTable.js';

export interface ResultStageProps {
  stage: 'saving' | 'done' | 'error';
  result: OrchestrationResult | null;
  legs: ResolvedLeg[];
  errorMsg: string;
  guidanceOpen: boolean;
  onGuidanceOpenChange: (open: boolean) => void;
}

export function ResultStage({
  stage,
  result,
  legs,
  errorMsg,
  onGuidanceOpenChange,
}: ResultStageProps): React.JSX.Element {
  if (stage === 'error') {
    // #2575: show error-specific guidance rather than a hardcoded licence message.
    const isFilesystemErr = /EBUSY|EPERM|EACCES|rmdir|unlink/i.test(errorMsg);
    const isLicenceErr = /licence|license|tier|consultant|enterprise/i.test(errorMsg);
    const isNetworkErr = /ECONNREFUSED|ENOTFOUND|fetch|timeout|http_status|404|503/i.test(errorMsg);
    const errorWhat = isFilesystemErr
      ? 'A temp directory is locked from a previous run. Restart SWAO and try again. If the error persists, delete temp dirs matching "swao-leg-*" in %TEMP%.'
      : isLicenceErr
        ? 'LLM Assessment requires a Consultant or Enterprise licence. Run "swao license request --tier consultant" or contact support.'
        : isNetworkErr
          ? 'Check LLM provider connectivity (run Health Check). Verify the connector base_url and API key are correct.'
          : 'Check the error message above. Common causes: missing connector credentials, a leg that returned no parseable responses, or a filesystem error.';
    return (
      <Box flexDirection="column">
        <Text color="red">LLM Assessment failed:</Text>
        <Box marginTop={1}><Text>{errorMsg}</Text></Box>
        <Box marginTop={1}>
          <GuidanceBox
            title="LLM Assessment -- Error"
            what={errorWhat}
            affordances={['Esc -- go back']}
            onOpenChange={onGuidanceOpenChange}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}><Text bold color="green">Assessment complete.</Text></Box>
      {result && <LlmResultTable result={result} legs={legs} />}
      {stage === 'saving' && (
        <Box marginTop={1}><Text dimColor>Saving results...</Text></Box>
      )}
      {stage === 'done' && (
        <>
          <Box marginTop={1}><Text dimColor>Esc -- back to menu</Text></Box>
          <Box marginTop={1}>
            <GuidanceBox
              title="LLM Assessment -- Complete"
              what="Assessment complete. Results show score (0-100) and rank per dimension group. Publish an HTML report via the Publish menu (option 5) to share with stakeholders."
              affordances={['Esc -- back to main menu']}
              initiallyCollapsed
              onOpenChange={onGuidanceOpenChange}
            />
          </Box>
        </>
      )}
    </Box>
  );
}
