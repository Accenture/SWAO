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

// WSP signal zod schema relocated to @swao/core (#0575) so the publication
// engine (@swao/module-html-report) can validate signals without importing from
// @swao/swao. Re-exported here for the existing '../schema/signals.js' and
// schema-barrel import sites (passes, wsp-schema tests). The Signal /
// SignalOutcome / Assessor types come from @swao/core's plugin-types.js (the WSP
// contract interfaces), structurally identical to the zod-inferred shapes.
export {
  SIGNAL_ID_REGEX,
  SignalIdSchema,
  SignalOutcomeSchema,
  AssessorSchema,
  SignalSchema,
} from '@swao/core';
export type { SignalId, Signal, SignalOutcome, Assessor } from '@swao/core';
