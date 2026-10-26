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

// #3419 / #3436: pass coverage of an application or service run. One shared
// vocabulary for the run manifest (passes_not_run, passes_degraded), the
// run-status marker (degraded_passes), the structured log and the
// publication ("Passes not executed" / "not fully evaluated").
//
// Two lists, never merged on disk, so a coverage count does not see a pass
// twice:
//   passes_not_run   a pass of the default profile that produced no result
//                    (it was not requested, or it ran and skipped itself)
//   passes_degraded  a pass that ran and is listed in passes_executed, but
//                    whose result is not complete (Pass 11 with controls
//                    that have no model verdict, #3436)
// The publication merges both into one list; a degraded entry carries the
// `degraded` reason there (PassCoverageReason).

import { z } from 'zod';

/** Why a pass produced no result in a run (#3419). */
export const PassNotRunReasonSchema = z.enum([
  /** A default pass left out by `assessment.pass_profile` / `lenses` or an explicit `--passes` list. */
  'not_in_profile',
  /** Removed or withheld by a command-line flag (`--skip-llm`). */
  'skipped_by_flag',
  /** The pass needs an LLM and no provider was configured or reachable at start. */
  'llm_unavailable',
  /** The LLM call failed after its retries (connectivity, provider error) or the answer was unusable. */
  'llm_failed',
  /** A required external tool is not on PATH (Pass 14: Gitleaks). */
  'tool_missing',
  /** Every tool of the pass is disabled in `.swao.yml`. */
  'disabled_by_config',
  /** The pass had no input to work on (service mode, no regimes configured, ...). */
  'not_applicable',
]);
export type PassNotRunReason = z.infer<typeof PassNotRunReasonSchema>;

export const PassNotRunEntrySchema = z.object({
  /** Pass key as used in `--passes` (e.g. `secrets`, `comp`). */
  pass: z.string(),
  num: z.string().optional(),
  name: z.string().optional(),
  reason: PassNotRunReasonSchema,
  /** Short operator-facing detail (missing tool, skip marker); never source content. */
  detail: z.string().optional(),
});
export type PassNotRunEntry = z.infer<typeof PassNotRunEntrySchema>;

/** Why a pass that ran is not fully evaluated (#3436). */
export const PassDegradedReasonSchema = z.enum(['llm_unavailable']);
export type PassDegradedReason = z.infer<typeof PassDegradedReasonSchema>;

export const PassDegradedRegimeSchema = z.object({
  id: z.string(),
  controls_without_verdict: z.number().int().nonnegative(),
});

export const PassDegradedEntrySchema = z.object({
  pass: z.string(),
  num: z.string().optional(),
  name: z.string().optional(),
  reason: PassDegradedReasonSchema,
  /** Pass 11: frameworks with controls that have no model verdict. */
  regimes: z.array(PassDegradedRegimeSchema).optional(),
});
export type PassDegradedEntry = z.infer<typeof PassDegradedEntrySchema>;

/** Publication vocabulary: every not-run reason plus `degraded` (ran, not fully evaluated). */
export const PassCoverageReasonSchema = z.enum([...PassNotRunReasonSchema.options, 'degraded']);
export type PassCoverageReason = z.infer<typeof PassCoverageReasonSchema>;

/**
 * Operator-facing label per reason (publication, console). Exhaustive switch:
 * a new reason fails the build until it has a label.
 */
export function passCoverageReasonLabel(reason: PassCoverageReason): string {
  switch (reason) {
    case 'not_in_profile': return 'Not in the pass profile';
    case 'skipped_by_flag': return 'Skipped by command-line flag';
    case 'llm_unavailable': return 'No LLM provider available';
    case 'llm_failed': return 'LLM call failed';
    case 'tool_missing': return 'Required tool not installed';
    case 'disabled_by_config': return 'Disabled in .swao.yml';
    case 'not_applicable': return 'No input for this pass';
    case 'degraded': return 'Not fully evaluated';
    default: {
      const never: never = reason;
      return String(never);
    }
  }
}
