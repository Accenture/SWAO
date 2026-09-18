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
import { GuidanceBox } from '@swao/tui-kit';

export interface ChallengePromptPhaseProps {
  app: string;
  type: 'application' | 'landing-zone';
  isEnterprise: boolean;
  onConfirm: () => void;
  onBack: () => void;
  Header: ComponentType<{ subtitle?: string }>;
}

// #0988 Design 074 Step 8: post-assessment challenge prompt (#1109: also for LZ).
// Shared by AppAssessmentScreen and LzAssessmentScreen (#2371).
export function ChallengePromptPhase({ app, type, isEnterprise: _isEnterprise, onConfirm, onBack, Header }: ChallengePromptPhaseProps): JSX.Element {
  const guidanceOpenRef = useRef(false);
  const isLzPrompt = type === 'landing-zone';

  useInput((_input, key) => {
    if (guidanceOpenRef.current) return;
    if (key.return) onConfirm();
    if (key.escape) onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle={isLzPrompt ? 'LZ Sovereignty Challenge' : 'Stakeholder Challenge'} />
      <Text>App: <Text color="cyanBright">{app}</Text></Text>
      <Box marginTop={1} flexDirection="column">
        <Text bold>{isLzPrompt
          ? 'Assessment complete. Run an LZ Sovereignty Challenge?'
          : 'Assessment complete. Run a Stakeholder Challenge?'}
        </Text>
        {isLzPrompt ? (
          <>
            <Text dimColor>Four AI agent personas challenge the sovereignty verdicts, CSP selection, and contractual basis.</Text>
            <Text dimColor>Results are saved to wsp/challenge-lz/ (separate from App challenge output).</Text>
          </>
        ) : (
          <>
            <Text dimColor>A Stakeholder Challenge runs AI-powered agent reviews of the assessment findings.</Text>
            <Text dimColor>Results are saved to wsp/challenge-app/ alongside the HTML report.</Text>
          </>
        )}
      </Box>
      <Box marginTop={2} flexDirection="column">
        <Text>  <Text color="green" bold>Enter</Text>  Run {isLzPrompt ? 'LZ Sovereignty' : 'Stakeholder'} Challenge</Text>
        <Text>  <Text color="yellow" bold>Esc</Text>    Skip and return to main menu</Text>
      </Box>
      <GuidanceBox
        title={isLzPrompt ? 'LZ Sovereignty Challenge' : 'Stakeholder Challenge'}
        what={isLzPrompt
          ? 'Four AI agent personas challenge the sovereignty verdicts and CSP selection based on your WSP: Sovereignty/GRC Reviewer, LZ Architect, Procurement/Vendor, and CISO/Security.'
          : 'Five AI agent personas challenge the assessment findings from their stakeholder perspective: Application Architect, Business Owner, GRC Compliance Officer, FinOps Lead, and Programme Manager.'}
        details={isLzPrompt
          ? [{ label: 'Output', value: 'apps/<app>/wsp/challenge-lz/<ts>/LZCA_<agent>.yaml' }]
          : [{ label: 'Output', value: 'apps/<app>/wsp/challenge-app/<ts>/AA_<agent>.yaml' }]}
        affordances={['Enter -- run challenge  |  Esc -- skip']}
        onOpenChange={(open) => { guidanceOpenRef.current = open; }}
      />
    </Box>
  );
}
