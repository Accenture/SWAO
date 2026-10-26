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

// #3431: Zod schema and loader for swao/controls/migration-scores-catalogue.yaml,
// the weights of the deterministic cloud-native and portability scores
// (src/scoring/migration-scores.ts). The loader never throws.

import { z } from 'zod';
import { IsoDateSchema, loadCatalogue, type CatalogueLoad } from './reference-catalogues.js';

export const MIGRATION_SCORES_CATALOGUE_FILE = 'migration-scores-catalogue.yaml';

const Unit = z.number().min(0).max(1);
const Weight = z.number().min(0);

export const PORTABILITY_COMPONENTS = ['service_availability', 'vendor_lock', 'container', 'iac', 'egress'] as const;
export type PortabilityComponentId = (typeof PORTABILITY_COMPONENTS)[number];

export const MigrationScoresCatalogueSchema = z
  .object({
    version: z.string().min(1),
    last_reviewed: IsoDateSchema.optional(),
    cloud_native: z
      .object({
        status_values: z.object({ pass: Unit, partial: Unit, unknown: Unit, fail: Unit }).strict(),
        factor_weights: z.record(z.string().regex(/^[IVX]+$/, 'factor key must be a Roman numeral'), Weight),
        default_factor_weight: Weight,
        confidence: z
          .object({ high_min_checked_share: Unit, medium_min_checked_share: Unit })
          .strict(),
      })
      .strict(),
    portability: z
      .object({
        weights: z
          .object({
            service_availability: Weight,
            vendor_lock: Weight,
            container: Weight,
            iac: Weight,
            egress: Weight,
          })
          .strict(),
        service_availability: z
          .object({
            min_sovereign_providers: z.number().int().min(1),
            forbid_exposure: z.array(z.string().min(1)),
            require_operator_jurisdiction: z.array(z.string().min(1)).min(1),
          })
          .strict(),
        vendor_lock: z
          .object({ impact_penalty: z.record(z.string(), Unit) })
          .strict(),
        container: z.object({ kubernetes: Unit, container: Unit, none: Unit }).strict(),
        iac: z.object({ present: Unit, absent: Unit }).strict(),
        egress: z
          .object({
            verdict_values: z.object({ available: Unit, partial: Unit, unavailable: Unit }).strict(),
            hardcoded_host_values: z.object({ public: Unit, private: Unit }).strict(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((cat, ctx) => {
    const total = PORTABILITY_COMPONENTS.reduce((s, c) => s + cat.portability.weights[c], 0);
    if (total <= 0) ctx.addIssue({ code: 'custom', message: 'portability weights must not all be 0' });
    const c = cat.cloud_native.confidence;
    if (c.medium_min_checked_share > c.high_min_checked_share) {
      ctx.addIssue({ code: 'custom', message: 'medium_min_checked_share must not exceed high_min_checked_share' });
    }
  });
export type MigrationScoresCatalogue = z.infer<typeof MigrationScoresCatalogueSchema>;

export function loadMigrationScoresCatalogue(pathOverride?: string): CatalogueLoad<MigrationScoresCatalogue> {
  return loadCatalogue(MIGRATION_SCORES_CATALOGUE_FILE, MigrationScoresCatalogueSchema, pathOverride);
}
