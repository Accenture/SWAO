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
 * RunContext schema -- written to run-context.yaml on every assessment
 * run completion (Design 067 §5.2, #0783).
 *
 * Allows RunContextPicker and the publication pipeline to read the
 * canonical assessment type directly from the run directory rather than
 * inferring it from pass file patterns.
 */

import { z } from 'zod';

export const RunContextSchema = z.object({
  assessment_type: z.string(),
  run_timestamp: z.string(),
  swao_version: z.string(),
  // #0911: optional audit trail fields (additive; absent on runs before this version).
  excluded_passes: z.array(z.string()).optional(),
  lz_targets: z.array(z.string()).optional(),
  active_frameworks: z.array(z.string()).optional(),
});

export type RunContext = z.infer<typeof RunContextSchema>;
