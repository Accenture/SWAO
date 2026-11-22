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
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { useInput } from 'ink';
import { ConfirmPanel, guidanceOwnsKey, type KeyHint } from '@swao/tui-kit';
import { FlowFrame, type FlowFrameBase } from './flow-frame.js';
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
  /** #4256: the flow frame of the screen (header, licence line, step bar on Done). */
  frame: FlowFrameBase;
  /** #3427: freshness note and exact command for the just-finished run. */
  offer?: ChallengeOffer;
}

/** #4256: Enter starts the challenge, Esc returns to the main menu. */
export const CHALLENGE_PROMPT_KEYS: readonly KeyHint[] = [{ key: 'Enter', verb: 'confirm' }, { key: 'Esc', verb: 'back' }];

// #0988 Design 074 Step 8: post-assessment challenge prompt (#1109: also for LZ).
// Shared by AppAssessmentScreen and LzAssessmentScreen (#2371).
// #4256 (Design 126 sections 4.4 and 4.7): a ConfirmPanel in the flow frame;
// the stale challenge note is the risk line, the CLI equivalent is in the
// guidance only (section 8), no hand-written key lines.
export function ChallengePromptPhase({ app, type, isEnterprise: _isEnterprise, onConfirm, onBack, frame, offer }: ChallengePromptPhaseProps): JSX.Element {
  const guidanceOpenRef = useRef(false);
  const isLzPrompt = type === 'landing-zone';
  const name = isLzPrompt ? 'LZ Sovereignty Challenge' : 'Stakeholder Challenge';

  useInput((_input, key) => {
    // #4230: an open guidance box owns Esc, PgUp and PgDn only; Enter belongs to the ConfirmPanel.
    if (guidanceOwnsKey(key, guidanceOpenRef.current)) return;
    if (key.escape) onBack();
  });

  const rows = isLzPrompt
    ? [
      { label: 'App', value: app },
      { label: 'Roles', value: 'Sovereignty and GRC reviewer, LZ architect, procurement and vendor, CISO and security' },
      { label: 'Output', value: `apps/${app}/wsp/challenge-lz/`, path: true },
    ]
    : [
      { label: 'App', value: app },
      { label: 'Roles', value: 'Application architect, business owner, GRC compliance officer, FinOps lead, programme manager' },
      { label: 'Output', value: `apps/${app}/wsp/challenge-app/`, path: true },
    ];

  return (
    <FlowFrame
      {...frame}
      onGuidanceOpenChange={(open) => { guidanceOpenRef.current = open; frame.onGuidanceOpenChange(open); }}
      keys={CHALLENGE_PROMPT_KEYS}
      guidance={{ entry: {
        title: name,
        what: isLzPrompt
          ? 'Four AI agent roles challenge the sovereignty verdicts, the CSP selection and the contractual basis of this run. The results are saved next to the HTML report, separate from the application challenge.'
          : 'Five AI agent roles challenge the assessment findings from their stakeholder view. The results are saved next to the HTML report.',
        ...(offer?.note ? { sections: [{ label: 'Note', text: offer.note }] } : {}),
        ...(offer ? { cli: offer.command } : {}),
      } }}
    >
      <ConfirmPanel
        title={`Run a ${name}?`}
        subtitle="The assessment is complete."
        rows={rows}
        {...(offer?.note ? { risk: offer.note } : {})}
        onConfirm={onConfirm}
        active={frame.dialog === null}
      />
    </FlowFrame>
  );
}
