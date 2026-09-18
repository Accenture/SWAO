// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// `type: llm` AssessmentTypeContribution (Design 092; #1419/#1420).
//
// Gate: the selected app needs a completed App Assessment run (092 s3.0; gates.ts).
// LLM Assessment is available on all tiers per the DOCX golden standard (Community+).
//
// The run-loop engine (legs, recording, comparison -- #1421..#1426) plugs in
// here; until it lands, a gates-green invocation raises EnginePendingError
// so the CLI reports an honest state instead of a silent no-op.

import type { AssessmentTypeContribution, AssessmentRunContext, WspResult } from '@swao/core';
import { checkAppAssessmentPrecondition } from './gates.js';

export class LlmAssessmentGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmAssessmentGateError';
  }
}

/** Raised after gates pass while the engine phases (#1421+) are landing. */
export class EnginePendingError extends Error {
  constructor() {
    super(
      'LLM Assessment gates passed; the run-loop engine (#1421) is landing in sprint-114. ' +
      'This build does not yet execute legs.',
    );
    this.name = 'EnginePendingError';
  }
}

export async function runLlmAssessment(
  ctx: AssessmentRunContext,
  /** Host-provided engine: receives the passed precondition (with the
   *  latest completed run's pass stats for the cost preview) and executes
   *  the leg orchestration. Absent = gates-only (build without wiring). */
  engine?: (pre: import('./gates.js').PreconditionResult) => Promise<WspResult>,
): Promise<WspResult> {
  // Precondition gate (092 s3.0).
  const pre = checkAppAssessmentPrecondition(ctx.workspacePath, ctx.appId);
  if (!pre.ok) {
    throw new LlmAssessmentGateError(pre.message ?? 'LLM Assessment precondition failed.');
  }

  // 3. Engine (#1421): host wires the orchestrator here.
  if (!engine) throw new EnginePendingError();
  return engine(pre);
}

export const llmAssessmentType: AssessmentTypeContribution = {
  type: 'llm',
  description:
    'LLM Assessment for SWAO (Design 092): run an assessed application through 2..5 LLM (connector, model) legs and compare the models across performance, cost, reliability, quality, reasoning, and security dimensions.',
  run: runLlmAssessment,
};
