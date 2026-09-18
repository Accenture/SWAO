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

// Run-manifest schema relocated to @swao/core (#0591) so the app-assessment
// module's `diff` command can validate manifests without importing from
// @swao/swao. Re-exported here for the existing '../schema/run-manifest.js'
// and schema-barrel import sites (assess, exports/star, publish/*, tests).
export { PassStatSchema, RunManifestSchema } from '@swao/core';
export type {
  PassStat,
  PassFailed,
  RunManifest,
  LlmRunStats,
  FilesAssessed,
  RunManifestProvenance,
} from '@swao/core';
