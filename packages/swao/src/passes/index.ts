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

// Passes moved to @swao/module-app-assessment (#0548). Re-exported here for the
// transition window; assess.ts dispatches these directly until the assess
// orchestrator lands in #0549.
export {
  runInvPass,
  runStatePass,
  runDataPass,
  runCtxPass,
  runSbomPass,
  runTfPass,
  runEgrPass,
  runCryptoPass,
  runSynthPass,
  runDynamicPass,
  runBlocksPass,
  runScopePass,
  runLzrPass,
  findLzrInputFiles,
} from '@swao/module-app-assessment';
// COMP (Pass 11) moved to @swao/module-framework (#0570).
export { runCompliancePass } from '@swao/module-framework';
export type { PassContext, PassResult, PassRunner } from '@swao/core';
