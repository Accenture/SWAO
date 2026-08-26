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

// Moved to @swao/core (#0548). Re-exported here for the transition window so
// existing import sites and the schema/index.ts barrel keep compiling.
export { LandingZoneCandidateSchema, LandingZoneResultSchema } from '@swao/core';
export type { LandingZoneCandidate, LandingZoneResult, LockInFlag } from '@swao/core';
