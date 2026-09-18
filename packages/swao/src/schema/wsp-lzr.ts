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

// Moved to @swao/core (#0548). Re-exported here for the transition window.
export { LandingZoneReadinessResultSchema } from '@swao/core';
export type {
  LandingZoneReadinessResult,
  LZBlockerItem,
  LZWarningItem,
  LZServiceCheck,
  LZQuotaCheck,
  LZPolicyCheck,
  LZNetworkCheck,
} from '@swao/core';
