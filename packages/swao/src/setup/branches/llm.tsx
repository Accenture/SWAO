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

// #4190 SET-01 / #4196 SET-07 (Design 125 section 5.6, Q-05): the LLM
// Assessment branch. Owner of this file after SET-01: the Application and
// LLM lane. SET-07: Candidates (10, setup/steps/LlmCandidatesStep) and
// Subject (20, LlmSubjectStep; Q-05: needs a completed Application
// Assessment run, otherwise points to the Application branch). Stores
// assessment.llm.candidates and assessment.llm.subject_app
// (setup/llm-values.ts writeAssessmentLlm; read by setup/defaults.ts
// readLlmDefaults). Health check and Ready are added by the engine.

import { SETUP_ASSESSMENT_TYPE_LABELS, SETUP_ASSESSMENT_TYPE_MIN_TIER } from '@swao/core';
import type { SetupBranchModule } from '../types.js';
import { LlmCandidatesStep } from '../steps/LlmCandidatesStep.js';
import { LlmSubjectStep } from '../steps/LlmSubjectStep.js';
import { checkLlmCandidates, checkLlmSubject } from '../llm-values.js';

export const llmBranch: SetupBranchModule = {
  branch: {
    type: 'llm',
    label: SETUP_ASSESSMENT_TYPE_LABELS.llm,
    description: 'Candidate LLM connectors and the assessed app',
    minTier: SETUP_ASSESSMENT_TYPE_MIN_TIER.llm,
  },
  steps: [
    { id: 'llm.candidates', label: 'Candidates', assessmentType: 'llm', order: 10, guidance: 'Two to five LLM connectors and models to compare, with credentials.', component: LlmCandidatesStep, check: (ws) => checkLlmCandidates(ws) },
    { id: 'llm.subject', label: 'Subject', assessmentType: 'llm', order: 20, guidance: 'The assessed app; it needs a completed Application Assessment.', component: LlmSubjectStep, check: checkLlmSubject },
  ],
};
