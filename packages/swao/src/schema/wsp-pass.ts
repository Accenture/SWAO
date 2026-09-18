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

// WSP pass-file zod schema relocated to @swao/core (#0575) so the publication
// engine (@swao/module-html-report) can validate passes/*.yaml without importing
// from @swao/swao. Re-exported here for the existing '../schema/wsp-pass.js' and
// schema-barrel import sites (wsp-schema tests). The DataSource type comes from
// @swao/core's plugin-types.js (the WSP contract interface), structurally
// identical to the zod-inferred shape.
export { DataSourceSchema, PassFileSchema } from '@swao/core';
export type { DataSource, PassFile } from '@swao/core';
