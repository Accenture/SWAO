// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- shared types for LlmAssessmentScreen stages
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import type { LoadedConnector } from '@swao/module-llm-providers';

export interface EligibleApp {
  id: string;
  passCount: number;
  /** #4242: the newest completed Application Assessment run (the suite reference). */
  suiteRun?: { runTs: string; passCount: number; finishedAt: string };
  /** #4242: completed application runs of the app (1 = only the suite run). */
  applicationRunCount?: number;
}

/** #4242: an app the LLM Assessment cannot use, with the plain reason. */
export interface UnavailableApp {
  id: string;
  reason: string;
}

export interface PendingLeg {
  connectorId: string;
  connector: LoadedConnector;
  model: string;
}
