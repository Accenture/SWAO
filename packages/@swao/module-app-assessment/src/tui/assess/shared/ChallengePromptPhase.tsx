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
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Box, Text, useInput } from 'ink';
import { GuidanceBox } from '@swao/tui-kit';
import { challengeOfferForRun, type ChallengeOffer } from '@swao/core';

/**
 * #3427: challenge offer for the app's just-finished run (same helper as the
 * `swao assess` end-of-run hint). Application: newest runs/<ts> with a
 * wsp.yaml; LZ: the latest-landing-zone-catalog.txt run. Undefined when the
 * run cannot be resolved.
 */
export function challengeOfferForApp(workspace: string | null, app: string, type: 'application' | 'landing-zone'): ChallengeOffer | undefined {
  if (!workspace || !app) return undefined;
  try {
    const wspDir = join(workspace, 'apps', app, 'wsp');
    if (type === 'landing-zone') {
      const ptr = join(wspDir, 'latest-landing-zone-catalog.txt');
      const rel = existsSync(ptr) ? readFileSync(ptr, 'utf-8').trim() : '';
      return rel ? challengeOfferForRun(wspDir, 'lz', join(wspDir, rel)) : undefined;
    }
    const runsDir = join(wspDir, 'runs');
    const newest = existsSync(runsDir)
      ? readdirSync(runsDir).filter(r => existsSync(join(runsDir, r, 'wsp.yaml'))).sort().pop()
      : undefined;
    return newest ? challengeOfferForRun(wspDir, 'app', join(runsDir, newest)) : undefined;
  } catch {
    return undefined;
  }
}

export interface ChallengePromptPhaseProps {
  app: string;
  type: 'application' | 'landing-zone';
  isEnterprise: boolean;
  onConfirm: () => void;
  onBack: () => void;
  Header: ComponentType<{ subtitle?: string }>;
  /** #3427: freshness note and exact command for the just-finished run. */
  offer?: ChallengeOffer;
}

// #0988 Design 074 Step 8: post-assessment challenge prompt (#1109: also for LZ).
// Shared by AppAssessmentScreen and LzAssessmentScreen (#2371).
export function ChallengePromptPhase({ app, type, isEnterprise: _isEnterprise, onConfirm, onBack, Header, offer }: ChallengePromptPhaseProps): JSX.Element {
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
        {/* #3427: say when the challenge on disk belongs to another run; name the CLI equivalent. */}
        {offer?.note ? <Box marginTop={1}><Text color="yellow">{offer.note}</Text></Box> : null}
        {offer ? <Text dimColor>CLI equivalent: {offer.command}</Text> : null}
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
