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

// #4190 SET-01 / #4195 SET-06 (Design 125 section 5.5): the Landing Zone Live
// Assessment branch. Owner of this file after SET-01: the LZ Live lane.
// Migrated from the linear wizard (behaviour unchanged): Landing zones (order
// 10, the LZ Connections step, #3589). SET-06 (#4195): Probe (20), Policy
// Baseline (30, writes landing_zones[].frameworks, section 5.7) and Org
// Evidence (40, optional, #4050); components in lz-live-steps.tsx, logic in
// lz-live-logic.ts. Health check and Ready are added by the engine.
//
// The Probe, Baseline and Evidence steps are always applicable: the plan
// evaluates isApplicable when it is built (plan.ts scopeEntries), so a landing
// zone registered in step 10 of the same run would otherwise not enable them;
// without a landing zone each step says so and continues on Enter.

import { SETUP_ASSESSMENT_TYPE_LABELS, SETUP_ASSESSMENT_TYPE_MIN_TIER } from '@swao/core';
import { LzConnectionsStep } from '../../tui/screens/wizard/steps/LzConnectionsStep.js';
import type { SetupBranchModule, SetupStepProps } from '../types.js';
import { LzLiveBaselineStep, LzLiveEvidenceStep, LzLiveProbeStep } from './lz-live-steps.js';
import { baselineCheck, ensureEvidenceFolders, evidenceCheck, probeCheck, registeredLandingZones } from './lz-live-logic.js';
import { logSetupStepComplete } from '../step-events.js';

export function LzLiveConnectionsStep({ ctx, onNext, setEscapeCaptured }: SetupStepProps) {
  return (
    <LzConnectionsStep
      workspace={ctx.workspaceRoot}
      onOpenChange={setEscapeCaptured}
      onNext={(opened) => {
        logSetupStepComplete('lz-connections', 'Landing Zone Connections step completed', { opened });
        onNext({ status: opened ? 'done' : 'skipped' });
      }}
    />
  );
}

export const lzLiveBranch: SetupBranchModule = {
  branch: {
    type: 'lz-live',
    label: SETUP_ASSESSMENT_TYPE_LABELS['lz-live'],
    description: 'Landing zones, scopes, probe and policy baseline',
    minTier: SETUP_ASSESSMENT_TYPE_MIN_TIER['lz-live'],
    // #4346: the Org Evidence step creates the ingestion folders on entry; the non-interactive check does the same.
    prepareNonInteractive: (ws) => { ensureEvidenceFolders(ws, registeredLandingZones(ws).map((lz) => lz.id), 'setup.lz-live.non-interactive'); },
  },
  steps: [
    { id: 'lz-live.connections', label: 'Landing Zones', assessmentType: 'lz-live', order: 10, guidance: 'Register a landing zone and its scopes; SWAO only reads.', component: LzLiveConnectionsStep },
    { id: 'lz-live.probe', label: 'Probe', assessmentType: 'lz-live', order: 20, guidance: 'Read-only probe and coverage per scope; a write-capable login is flagged and needs a confirmation per run.', component: LzLiveProbeStep, check: probeCheck },
    { id: 'lz-live.baseline', label: 'Policy Baseline', assessmentType: 'lz-live', order: 30, guidance: 'Checks the Client LZ Policy Baseline in the workspace catalogue (copy it from GitHub; SWAO never installs or updates it) and stores the frameworks per landing zone as the assessment defaults.', component: LzLiveBaselineStep, check: (ws) => baselineCheck(ws) },
    { id: 'lz-live.evidence', label: 'Org Evidence', assessmentType: 'lz-live', order: 40, guidance: 'Optional: the ingestion folder of each landing zone for organisational documents (governance controls such as DORA).', component: LzLiveEvidenceStep, check: evidenceCheck },
  ],
};
