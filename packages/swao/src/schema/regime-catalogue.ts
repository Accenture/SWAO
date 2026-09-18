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
export {
  REGIME_ID_REGEX,
  RegimeIdSchema,
  ScopeSchema,
  RegimeMetaSchema,
  RegimeControlSchema,
  RegimeCatalogueSchema,
  RegimeIndexSchema,
} from '@swao/core';
export type {
  RegimeId,
  Scope,
  RegimeMeta,
  RegimeControl,
  RegimeCatalogue,
  RegimeIndex,
  RegimeIndexEntry,
} from '@swao/core';
