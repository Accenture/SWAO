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
}

export interface PendingLeg {
  connectorId: string;
  connector: LoadedConnector;
  model: string;
}
