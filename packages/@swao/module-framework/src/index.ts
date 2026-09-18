// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Framework module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// @swao/module-framework (#0570) -- the compliance-framework module.
//
// Two surfaces over one evaluation core:
//   - runCompliancePass(ctx): the RICH path. Reads the run's signals + selected
//     regimes from disk and emits the full WSP PassResult (regimes[] + COMP-NN
//     roll-ups). The host imports this directly and dispatches it as the COMP
//     pass (it owns the fidelity-critical WSP output).
//   - evaluate() / complianceEvaluator: the LEAN ComplianceEvaluatorContribution.
//     A compact (signals, frameworks, opts) -> ComplianceResult API for guest
//     modules that cannot import this module directly and reach compliance via
//     CoreContext.complianceEvaluator.
export {
  runCompliancePass,
  evaluate,
  complianceEvaluator,
  frameworkModuleManifest,
} from './compliance-evaluator.js';
export { communityCatalogueContribution, communityFrameworksDir } from './community-catalogue.js';
