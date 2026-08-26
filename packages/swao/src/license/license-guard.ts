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

// Moved to @swao/core (#0546). Re-exported here for the sprint-057 transition window.
export type { LicenseState, LicenseTier, LicensePayload, FeatureKey } from '@swao/core';
export { LicenseGuard, LicenseTierError, LicenseLimitError, LicenseInvalidError, normalizeTier, _paths, buildLicenseKey, FEATURE_GATES } from '@swao/core';
