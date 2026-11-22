// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- LLM Assessment review-config stage (#2373)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import React, { useMemo } from 'react';
import { Box } from 'ink';
import { ConfirmPanel, type GuidanceEntry, type KeyHint } from '@swao/tui-kit';
import { LlmStageFrame } from '../stage-frame.js';
import type { ResolvedLeg } from '@swao/module-llm-assessment';
import type { EligibleApp } from '../types.js';
import { modelLabel } from '../../../model-label.js';
import { outdatedWorkspaceConnectors, seedStatusText } from '@swao/module-llm-providers';
import { reviewLegLine, reviewTotalLine, type ReviewEstimate } from '../review-estimate.js';

export interface ReviewConfigStageProps {
  selectedApp: EligibleApp;
  resolvedLegs: ResolvedLeg[];
  /** #4497: the estimate per LLM Provider (review-estimate.ts). */
  estimate: ReviewEstimate;
  crawlAvailable: boolean;
  includeCrawl: boolean;
  guidanceOpen: boolean;
  onGuidanceOpenChange: (open: boolean) => void;
  /** #4255: Enter on the ConfirmPanel starts the assessment. */
  onConfirm: () => void;
  /** #4491: the workspace whose connector files are compared with the packaged ones. */
  workspacePath?: string;
}

/** #4255 (Design 126 section 7.9): the confirmation keys; Tab switches the vision crawl (was the letter C). */
export function reviewConfigKeys(crawlAvailable: boolean): readonly KeyHint[] {
  return [
    { key: 'Enter', verb: 'confirm' },
    ...(crawlAvailable ? [{ key: 'Tab', verb: 'toggle', object: 'vision crawl' } as const] : []),
    { key: '←', verb: 'back' },
    { key: 'Esc', verb: 'abort' },
  ];
}

/** #4255: the guidance of the review. */
const REVIEW_GUIDANCE: GuidanceEntry = {
  title: 'Review Configuration',
  what: 'Confirm the LLM Providers and the cost estimate before the start. Each provider runs the full pass suite on its own; the results are compared with weighted dimension scoring.',
  sections: [
    { label: 'Cost basis', text: 'Per LLM Provider: the cost of the same model in the newest earlier LLM Assessment of the app (measured), else the LLM pass, challenge and LZ challenge calls times typical tokens times the model price (connector file, discovery, bundled price or price table). A model without a price shows cost unknown. The synthesis makes no LLM call.' },
    { label: 'Duration', text: 'Serial mode runs the providers one at a time; parallel mode runs them at once.' },
  ],
};

export function ReviewConfigStage({
  selectedApp,
  resolvedLegs,
  estimate,
  crawlAvailable,
  includeCrawl,
  onGuidanceOpenChange,
  onConfirm,
  workspacePath,
}: ReviewConfigStageProps): React.JSX.Element {
  const keys = reviewConfigKeys(crawlAvailable);
  // #4491: a connector file of a leg that is older than the packaged one (stale prices) is named.
  const legConnectors = [...new Set(resolvedLegs.map((l) => l.connector))];
  const connectorNotes = useMemo(() => {
    if (!workspacePath) return [];
    try { return outdatedWorkspaceConnectors(workspacePath, { ids: legConnectors }).map((s) => seedStatusText(s, { hint: 'setup' })); } catch { return []; }
  }, [workspacePath, legConnectors.join(',')]);
  const providers = resolvedLegs.map((leg) => `${leg.connector} / ${modelLabel(leg.model)}${leg.primary ? ' (primary)' : ''}`).join(String.fromCharCode(10));
  return (
    <LlmStageFrame keys={keys} guidance={REVIEW_GUIDANCE} onGuidanceOpenChange={onGuidanceOpenChange}>
    <Box flexDirection="column">
      <ConfirmPanel
        title="Start the LLM Assessment"
        subtitle="Every LLM Provider runs the full pass suite of the application; the results are compared."
        rows={[
          { label: 'Application', value: selectedApp.id },
          { label: `LLM Providers (${resolvedLegs.length})`, value: providers },
          { label: 'Estimated cost', value: [reviewTotalLine(estimate), ...estimate.legs.map(reviewLegLine)].join(String.fromCharCode(10)) },
          ...(connectorNotes.length > 0 ? [{ label: 'Connector files', value: connectorNotes.join(String.fromCharCode(10)) }] : []),
          ...(crawlAvailable ? [{ label: 'Vision crawl', value: includeCrawl ? 'on, screenshots are captured' : 'off, parity baseline only' }] : []),
        ]}
        onConfirm={onConfirm}
      />
    </Box>
    </LlmStageFrame>
  );
}
