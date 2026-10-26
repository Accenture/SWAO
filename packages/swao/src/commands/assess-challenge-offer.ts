// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3427: `swao assess` end-of-run challenge offer. The TUI asks "Run a
// Stakeholder Challenge?" after an assessment (ChallengePromptPhase); the CLI
// prints the next-step command instead of running it. Both read the same
// challengeOfferForRun() from @swao/core, so the stale-challenge note and the
// command are identical on both surfaces. Gates mirror the TUI prompt:
// Enterprise tier (the challenge command), LLM not skipped (#3383), and no
// service runs (no stakeholder challenge).

import { challengeOfferForRun, type ChallengeKind } from '@swao/core';

export interface AssessChallengeOfferInput {
  /** apps/<app>/wsp */
  wspDir: string;
  /** The run that just finished (apps/<app>/wsp/runs/<ts>). */
  runDir: string;
  kind: ChallengeKind;
  /** Licence tier of the running binary. */
  tier: string;
  skipLlm: boolean;
  isService?: boolean;
}

/** Lines to print after the run summary; empty when no offer applies. */
export function assessChallengeOfferLines(input: AssessChallengeOfferInput): string[] {
  if (input.tier !== 'enterprise' || input.skipLlm || input.isService) return [];
  const offer = challengeOfferForRun(input.wspDir, input.kind, input.runDir);
  if (offer.freshness === 'current') return [];
  const label = input.kind === 'lz' ? 'LZ Sovereignty Challenge' : 'Stakeholder Challenge';
  return [
    ...(offer.note ? [`[note] ${offer.note}`] : []),
    `[next] ${label} for this run: ${offer.command}`,
  ];
}
