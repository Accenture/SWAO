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

// #3160: Zod schemas, resolver and loaders for the five reference catalogues
// in swao/controls/ that passes 01 (INV), 07 (EGR) and 14 (MALWARE) read:
//
//   vendor-sdk-catalogue.yaml        -> Pass 01, INV-09 (vendor SDK lock-in)
//   legacy-indicators-catalogue.yaml -> Pass 01, INV-08 (legacy indicators)
//   db-compatibility-catalogue.yaml  -> Pass 01, INV-07 (database compatibility)
//   sovereign-service-catalogue.yaml -> Pass 07, EGR sovereign service verdicts
//   licence-risk-catalogue.yaml      -> Pass 14, MAL-10 / MAL-13 (ORT licences)
//
// Loaders never throw: a missing or invalid catalogue returns a reason the
// pass records in its assessment block, so a skipped check is visible.

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import { z } from 'zod';

export const VENDOR_SDK_CATALOGUE_FILE = 'vendor-sdk-catalogue.yaml';
export const LEGACY_INDICATORS_CATALOGUE_FILE = 'legacy-indicators-catalogue.yaml';
export const DB_COMPATIBILITY_CATALOGUE_FILE = 'db-compatibility-catalogue.yaml';
export const SOVEREIGN_SERVICE_CATALOGUE_FILE = 'sovereign-service-catalogue.yaml';
export const LICENCE_RISK_CATALOGUE_FILE = 'licence-risk-catalogue.yaml';

/**
 * Resolve a file in swao/controls/ for every runtime layout, mirroring
 * resolveCloudProviderCataloguePath (pass-09-synth.ts):
 *   module src or dist (vitest, tsc) -> 5 levels up
 *   legacy swao layout               -> 4 levels up
 *   bundled binary (packages/swao/dist) -> 3 levels up, or dist/_controls/
 * Returns null when no candidate exists.
 */
export function resolveControlsFile(fileName: string): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../../../../controls', fileName),
    resolve(here, '../../../../controls', fileName),
    resolve(here, '../../../controls', fileName),
    resolve(here, '_controls', fileName),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

export type CatalogueLoad<T> = { ok: true; data: T; path: string } | { ok: false; reason: string };

// #3430: exported for the service footprint catalogue (service-footprint-catalogue.ts).
export function loadCatalogue<T>(fileName: string, schema: z.ZodType<T>, pathOverride?: string): CatalogueLoad<T> {
  const path = pathOverride ?? resolveControlsFile(fileName);
  if (!path || !existsSync(path)) return { ok: false, reason: `${fileName} not found` };
  let raw: unknown;
  try {
    raw = load(readFileSync(path, 'utf-8'));
  } catch (err) {
    return { ok: false, reason: `${fileName} unreadable: ${(err as Error).message.split('\n')[0]}` };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, reason: `${fileName} invalid: ${first ? `${first.path.join('.')}: ${first.message}` : 'schema mismatch'}` };
  }
  return { ok: true, data: parsed.data, path };
}

// ---------------------------------------------------------------------------
// Shared detection rule shape
// ---------------------------------------------------------------------------

/** ISO date (YYYY-MM-DD) used for review dates in the reference catalogues. */
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO date YYYY-MM-DD');

export const MatchModeSchema = z.enum(['exact', 'prefix']);
export type MatchMode = z.infer<typeof MatchModeSchema>;

/** A public source for a catalogue claim, with the date it was checked (#3296). */
export const CatalogueSourceSchema = z
  .object({
    url: z.string().url().refine((u) => u.startsWith('https://'), 'source url must be https'),
    title: z.string().min(1).optional(),
    reviewed: IsoDateSchema,
  })
  .passthrough();
export type CatalogueSource = z.infer<typeof CatalogueSourceSchema>;

const PatternRuleSchema = z
  .object({
    pattern: z.string().min(1),
    match: MatchModeSchema.optional(),
    note: z.string().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// vendor-sdk-catalogue.yaml
// ---------------------------------------------------------------------------

export const VendorSdkEntrySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    vendor: z.string().min(1),
    lock_in_level: z.enum(['extreme', 'high', 'medium', 'low']),
    sovereign_impact: z.enum(['blocks_migration', 'partial', 'manageable', 'none']),
    detection: z
      .object({
        npm_packages: z.array(PatternRuleSchema).optional(),
        cargo_crates: z.array(PatternRuleSchema).optional(),
        pip_packages: z.array(PatternRuleSchema).optional(),
        python_packages: z.array(PatternRuleSchema).optional(),
        maven_group_ids: z.array(PatternRuleSchema).optional(),
        nuget_packages: z.array(PatternRuleSchema).optional(),
        jar_patterns: z.array(PatternRuleSchema).optional(),
        description: z.string().optional(),
      })
      .passthrough(),
    sovereign_alternative: z.string().optional(),
    // #3302: public sources per entry (required by the quality gate, optional
    // here so a workspace copy without them still loads).
    sources: z.array(CatalogueSourceSchema).optional(),
    last_reviewed: IsoDateSchema.optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough();

export const VendorSdkCatalogueSchema = z
  .object({ last_reviewed: IsoDateSchema.optional(), sdks: z.array(VendorSdkEntrySchema).min(1) })
  .passthrough();
export type VendorSdkEntry = z.infer<typeof VendorSdkEntrySchema>;
export type VendorSdkCatalogue = z.infer<typeof VendorSdkCatalogueSchema>;

export function loadVendorSdkCatalogue(pathOverride?: string): CatalogueLoad<VendorSdkCatalogue> {
  return loadCatalogue(VENDOR_SDK_CATALOGUE_FILE, VendorSdkCatalogueSchema, pathOverride);
}

// ---------------------------------------------------------------------------
// legacy-indicators-catalogue.yaml
// ---------------------------------------------------------------------------

export const LegacyEcosystemSchema = z.enum(['npm', 'pip', 'cargo', 'maven', 'nuget']);
export type LegacyEcosystem = z.infer<typeof LegacyEcosystemSchema>;

export const LegacyIndicatorSchema = z
  .object({
    id: z.string().regex(/^LI-T[123]-\d{3}$/),
    name: z.string().min(1),
    description: z.string().optional(),
    detection: z
      .object({
        dependency_manifest: z
          .array(PatternRuleSchema.extend({ ecosystem: LegacyEcosystemSchema, group: z.string().optional() }))
          .optional(),
        docker_image: z.array(PatternRuleSchema).optional(),
        file_pattern: z
          .array(z.object({ pattern: z.string().min(1), description: z.string().optional(), glob: z.string().optional() }).passthrough())
          .optional(),
        code_pattern: z.array(z.object({ pattern: z.string() }).passthrough()).optional(),
        sql_pattern: z.array(z.object({ pattern: z.string() }).passthrough()).optional(),
        jar_patterns: z.array(z.object({ pattern: z.string() }).passthrough()).optional(),
      })
      .passthrough(),
    sovereign_alternative: z.string().optional(),
    migration_effort_weeks: z.number().nonnegative().optional(),
    // #3302: public sources per indicator (required by the quality gate).
    sources: z.array(CatalogueSourceSchema).optional(),
    last_reviewed: IsoDateSchema.optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough();

export const LegacyIndicatorsCatalogueSchema = z
  .object({
    last_reviewed: IsoDateSchema.optional(),
    tiers: z.object({
      tier_1_blockers: z.array(LegacyIndicatorSchema),
      tier_2_complicators: z.array(LegacyIndicatorSchema),
      tier_3_manageable: z.array(LegacyIndicatorSchema),
    }),
  })
  .passthrough();
export type LegacyIndicator = z.infer<typeof LegacyIndicatorSchema>;
export type LegacyIndicatorsCatalogue = z.infer<typeof LegacyIndicatorsCatalogueSchema>;

export function loadLegacyIndicatorsCatalogue(pathOverride?: string): CatalogueLoad<LegacyIndicatorsCatalogue> {
  return loadCatalogue(LEGACY_INDICATORS_CATALOGUE_FILE, LegacyIndicatorsCatalogueSchema, pathOverride);
}

// ---------------------------------------------------------------------------
// db-compatibility-catalogue.yaml
// ---------------------------------------------------------------------------

export const DbCompatibilityRowSchema = z
  .object({
    engine: z.string().min(1),
    version_range: z.string().min(1),
    target_managed_service: z.array(z.string()).optional(),
    compatibility: z.enum(['supported', 'migration_required', 'complex', 'partial', 'not_available']),
    effort: z.enum(['trivial', 'low', 'moderate', 'high', 'very_high']),
    sovereign_availability: z.enum(['available', 'partial', 'vm_only', 'not_available']),
    notes: z.string().optional(),
  })
  .passthrough();

export const DbCompatibilityCatalogueSchema = z
  .object({ last_reviewed: IsoDateSchema.optional(), engines: z.array(DbCompatibilityRowSchema).min(1) })
  .passthrough();
export type DbCompatibilityRow = z.infer<typeof DbCompatibilityRowSchema>;
export type DbCompatibilityCatalogue = z.infer<typeof DbCompatibilityCatalogueSchema>;

export function loadDbCompatibilityCatalogue(pathOverride?: string): CatalogueLoad<DbCompatibilityCatalogue> {
  return loadCatalogue(DB_COMPATIBILITY_CATALOGUE_FILE, DbCompatibilityCatalogueSchema, pathOverride);
}

// ---------------------------------------------------------------------------
// sovereign-service-catalogue.yaml
// ---------------------------------------------------------------------------

// #3296: every verdict carries public sources and a review date. An entry whose
// claims could not be checked against a public source is `unverified`; Pass 07
// caps its severity at medium and never treats it as a migration blocker.
export const VerdictConfidenceSchema = z.enum(['verified', 'unverified']);
export type VerdictConfidence = z.infer<typeof VerdictConfidenceSchema>;

export const SovereignServiceEntrySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    category: z.string().min(1),
    vendor: z.string().min(1),
    /** Jurisdiction of the ultimate parent company (ISO country code, `EU` not used). */
    parent_jurisdiction: z.string().min(2),
    portability_verdict: z.enum(['available', 'partial', 'unavailable']),
    sovereign_evidence: z.enum([
      'eu_region_confirmed',
      'eu_entity_available',
      'eu_cdn_routing',
      'eu_proxy_available',
      'no_eu_equivalent',
      'not_assessed',
    ]),
    verdict_confidence: VerdictConfidenceSchema,
    sources: z.array(CatalogueSourceSchema),
    eu_details: z.string().optional(),
    blocks_migration: z.boolean(),
    remediation: z.string().optional(),
    last_reviewed: IsoDateSchema,
    tags: z.array(z.string()).optional(),
  })
  .passthrough()
  .superRefine((e, ctx) => {
    if (e.verdict_confidence === 'verified' && e.sources.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['sources'], message: 'a verified verdict needs at least one source' });
    }
    if (e.blocks_migration && !(e.portability_verdict === 'unavailable' && e.verdict_confidence === 'verified')) {
      ctx.addIssue({
        code: 'custom',
        path: ['blocks_migration'],
        message: 'blocks_migration requires portability_verdict unavailable and verdict_confidence verified',
      });
    }
    if (!e.blocks_migration && e.portability_verdict === 'unavailable' && e.verdict_confidence === 'verified') {
      ctx.addIssue({
        code: 'custom',
        path: ['blocks_migration'],
        message: 'a verified unavailable verdict must set blocks_migration: true',
      });
    }
  });

export const SovereignServiceCatalogueSchema = z
  .object({ last_reviewed: IsoDateSchema.optional(), services: z.array(SovereignServiceEntrySchema).min(1) })
  .passthrough();
export type SovereignServiceEntry = z.infer<typeof SovereignServiceEntrySchema>;
export type SovereignServiceCatalogue = z.infer<typeof SovereignServiceCatalogueSchema>;

export function loadSovereignServiceCatalogue(pathOverride?: string): CatalogueLoad<SovereignServiceCatalogue> {
  return loadCatalogue(SOVEREIGN_SERVICE_CATALOGUE_FILE, SovereignServiceCatalogueSchema, pathOverride);
}

// ---------------------------------------------------------------------------
// licence-risk-catalogue.yaml
// ---------------------------------------------------------------------------

export const LicenceRiskTierSchema = z.enum(['critical', 'high', 'medium', 'low', 'clear']);
export type LicenceRiskTier = z.infer<typeof LicenceRiskTierSchema>;

/**
 * #3296: what kind of obligation a licence carries. Pass 14 reports copyleft
 * classes as MAL-10 and use-restricting classes (source-available, non-commercial,
 * no-derivatives) as MAL-13; the risk tier alone does not say which.
 */
export const LicenceClassSchema = z.enum([
  'network_copyleft',
  'strong_copyleft',
  'weak_copyleft',
  'source_available',
  'restricted_use',
  'permissive',
]);
export type LicenceClass = z.infer<typeof LicenceClassSchema>;

export const LicenceRiskEntrySchema = z
  .object({
    spdx_id: z.string().min(1),
    risk_tier: LicenceRiskTierSchema,
    licence_class: LicenceClassSchema,
    notes: z.string().optional(),
    sovereign_implications: z.string().optional(),
  })
  .passthrough();

export const LicenceRiskCatalogueSchema = z
  .object({
    schema_version: z.string().optional(),
    signal_prefix: z.string().optional(),
    last_reviewed: IsoDateSchema.optional(),
    licences: z.array(LicenceRiskEntrySchema).min(1),
  })
  .passthrough();
export type LicenceRiskEntry = z.infer<typeof LicenceRiskEntrySchema>;
export type LicenceRiskCatalogue = z.infer<typeof LicenceRiskCatalogueSchema>;

export function loadLicenceRiskCatalogue(pathOverride?: string): CatalogueLoad<LicenceRiskCatalogue> {
  return loadCatalogue(LICENCE_RISK_CATALOGUE_FILE, LicenceRiskCatalogueSchema, pathOverride);
}
