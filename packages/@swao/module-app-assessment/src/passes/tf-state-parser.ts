// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Re-export shim: implementation has moved to @swao/module-iac (sprint-110 #1320).
// This file exists so that existing consumers (pass-01-inv, pass-23-lzr) and any
// tests that import these names continue to resolve without modification.
export type { TfResource, TfState } from '@swao/module-iac';
export {
  IMAGE_TO_SERVICE_DEP,
  parseTfState,
  collectResourceTypes,
  extractSourceServices,
  findTfstateFiles,
} from '@swao/module-iac';
