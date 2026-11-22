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
  // #4285: where the inline fit targets came from (app:assessment.landing_zone.targets,
  // workspace:..., cli:--lz-cat-targets for a run-time pick, linked-lz-seed) and,
  // for geography values, the requested value next to the resolved region. Additive.
  lz_targets_source: z.string().optional(),
  lz_targets_resolved: z.array(z.object({ requested: z.string(), resolved: z.string(), geography: z.string() })).optional(),
  active_frameworks: z.array(z.string()).optional(),
  // #4269: the framework selection of the run: the app default
  // (assessment.regimes_active), the frameworks chosen for this run and the
  // source (app-default, or run-selection for swao assess --regimes). Additive.
  frameworks_selection: z.object({
    default: z.array(z.string()),
    chosen: z.array(z.string()),
    source: z.enum(['app-default', 'run-selection']),
  }).optional(),
  // #3887 (Design 123 section 8.4): LZ evidence source of an app run, and for
  // `live` the run it was measured against. Additive; absent on older runs.
  lz_source: z.enum(['catalogue', 'live']).optional(),
  lz_live: z.object({
    lz_id: z.string(),
    run_id: z.string(),
    scopes: z.array(z.string()),
    stale: z.boolean(),
  }).optional(),
  // #3980 (Design 123 section 11, 012 F-140 option B): why an app linked in
  // landing_zones[].scopes[].app was assessed against the catalogue. Additive;
  // present only on such a run. #4244 (owner decision 2026-11-09): live
  // landing-zone data is used only by the LZ Live Assessment, so every linked
  // app run records reason `lz-live-assessment-only` (no tier fields);
  // `licence-tier` with the tier fields stays for the replay of older runs.
  lz_source_reason: z.object({
    requested: z.literal('live'),
    origin: z.literal('swao-yml'),
    lz_id: z.string(),
    // #4244: every linked landing zone and scope ("landing zone otc-prod, scope platform").
    linked: z.string().optional(),
    reason: z.enum(['licence-tier', 'lz-live-assessment-only']),
    required_tier: z.string().optional(),
    current_tier: z.string().optional(),
    notice: z.string(),
    // #3980 seeding (owner decision 2026-11-06): the catalogue targets seeded
    // from the linked landing zone when none were configured, and their source.
    // Absent when configured targets were used or nothing could be seeded.
    seeded_targets: z.array(z.string()).optional(),
    seed_source: z.enum(['swao-yml-scope-regions', 'live-run-regions-in-use']).optional(),
    seed_run_id: z.string().optional(),
    // True when the run assessed nothing against the catalogue (no configured
    // and no seedable targets).
    no_targets: z.boolean().optional(),
  }).optional(),
});

export type RunContext = z.infer<typeof RunContextSchema>;
