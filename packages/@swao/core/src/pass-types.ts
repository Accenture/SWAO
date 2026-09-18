// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Pass runner types -- re-exported from plugin-types for discoverability.
 * These types define the pass contract for @swao/module-app-assessment
 * and any other module that registers PassContributions.
 */
export type {
  PassContext,
  PassHeader,
  PassResult,
  PassRunner,
} from './plugin-types.js';
