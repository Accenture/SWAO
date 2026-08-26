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

import { z } from 'zod';

/**
 * LZ service catalogue (Design 056 Layer A) -- a region-keyed, sovereignty-fact
 * catalogue of "what is technically available" per CSP. JSON, hand-editable,
 * one file per provider under `swao/lz-catalogues/<provider>.json` (D-LZ-05/06).
 *
 * This is the availability + sovereignty-FACTS superset of the LZR
 * `cloud-provider-catalogue` (which scores sovereignty fit). Per D-LZ-07 the
 * catalogue stores only facts; the sovereignty VERDICT is computed elsewhere by
 * evaluating these facts against the installed community frameworks' controls.
 * No tier/score is baked in here.
 */

// --- Sovereignty facts (data, not judgment; D-LZ-07) ---------------------
export const LzSovereigntyFactsSchema = z.object({
  /** ISO country where data rests/processes, or a region grouping ("EU", "global"). */
  residency_country: z.string().optional(),
  /** Legal entity / jurisdiction that operates the region. */
  operator_jurisdiction: z.string().optional(),
  /** Extraterritorial legal exposure facts, e.g. ["us_cloud_act", "fisa_702"]. */
  extraterritorial_exposure: z.array(z.string()).default([]),
  /** Held attestations relevant to sovereignty, e.g. ["C5", "SecNumCloud", "ENS"]. */
  certifications: z.array(z.string()).default([]),
}).strict();

// --- A single service offering in a region -------------------------------
export const LzServiceSchema = z.object({
  /** Stable service code, e.g. "rds-postgresql", "Microsoft.DBforPostgreSQL". */
  code: z.string().min(1),
  /** Human display name (optional). */
  name: z.string().optional(),
  status: z.enum(['ga', 'preview', 'announced', 'retired']).default('ga'),
  /** Feature tags, e.g. ["cmek", "multi-az", "eu-data-residency"]. */
  capabilities: z.array(z.string()).default([]),
  /** Abstract capability keys this service FULFILS (the bridge to the app's
   *  CSP-agnostic `service_dep:<key>` needs), e.g. ["kubernetes"], ["postgresql"].
   *  Data-driven mapping: a new CSP service self-declares what it fulfils. */
  fulfills: z.array(z.string()).default([]),
  /** Key-custody options offered, e.g. ["provider-managed", "byok", "hyok"]. */
  key_custody: z.array(z.string()).default([]),
  /** YYYY-MM-DD this entry was last verified against its source. */
  last_verified: z.string().optional(),
  /** Where this entry came from: api | pricing | scrape | curated. */
  source: z.string().optional(),
  /** YYYY-MM-DD this service was first observed missing from the source data.
   *  Only present when status === 'retired'. Preserved across subsequent refreshes. */
  retired_at: z.string().optional(),
  /** Highest major version known to be supported, e.g. 17 for PostgreSQL 17.
   *  Populated only where this fact is reliably sourced. Used by regionFulfills
   *  to resolve `service_dep:<code>@<major>` qualifiers (#1323). */
  max_version: z.number().int().positive().optional(),
}).strict();

// --- A region within a provider ------------------------------------------
export const LzRegionSchema = z.object({
  /** Provider region id, e.g. "eu-central-1", "germanywestcentral". */
  id: z.string().min(1),
  display: z.string().optional(),
  /** ISO country code, e.g. "DE". */
  country: z.string().optional(),
  sovereignty: LzSovereigntyFactsSchema.optional(),
  services: z.array(LzServiceSchema).default([]),
}).strict();

// --- Catalogue metadata block (D-LZ-06) ----------------------------------
export const LzCatalogueMetaSchema = z.object({
  schema_version: z.string(),
  name: z.string(),
  /** Provider id. Known: aws, aws-esc, azure, gcp, stackit, otc, ionos, ovhcloud.
   *  Free string (extensible -- a new sovereign CSP is added as data, not code). */
  provider: z.string().min(1),
  /** YYYY-MM-DD the catalogue snapshot was generated/updated. */
  last_updated: z.string(),
  source: z.object({
    /** How the snapshot was produced: api | scrape | curated | botocore-endpoints | pim-api-stackit. */
    mode: z.enum(['api', 'scrape', 'curated', 'botocore-endpoints', 'pim-api-stackit']),
    tool: z.string().optional(),
    operator: z.string().optional(),
    /** Provenance note -- used when the data source carries no contracted public SLA. */
    source_note: z.string().optional(),
  }),
  /** Overall confidence in the snapshot (curated/announced sets are lower). */
  confidence: z.enum(['high', 'medium', 'low']).default('high'),
  regions_count: z.number().int().nonnegative().optional(),
}).strict();

export const LzServiceCatalogueSchema = z.object({
  meta: LzCatalogueMetaSchema,
  regions: z.array(LzRegionSchema).default([]),
}).strict();

export type LzSovereigntyFacts = z.infer<typeof LzSovereigntyFactsSchema>;
export type LzService = z.infer<typeof LzServiceSchema>;
export type LzRegion = z.infer<typeof LzRegionSchema>;
export type LzCatalogueMeta = z.infer<typeof LzCatalogueMetaSchema>;
export type LzServiceCatalogue = z.infer<typeof LzServiceCatalogueSchema>;

/** Parse + validate a catalogue object (already-parsed JSON). Throws on invalid. */
export function parseLzCatalogue(raw: unknown): LzServiceCatalogue {
  return LzServiceCatalogueSchema.parse(raw);
}

/** Safe variant: returns the catalogue or a list of issue messages. */
export function safeParseLzCatalogue(
  raw: unknown,
): { ok: true; catalogue: LzServiceCatalogue } | { ok: false; issues: string[] } {
  const r = LzServiceCatalogueSchema.safeParse(raw);
  if (r.success) return { ok: true, catalogue: r.data };
  return { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

/** Does this region offer the given service code (GA or preview)? */
export function regionHasService(region: LzRegion, serviceCode: string): boolean {
  return region.services.some(
    (s) => s.code === serviceCode && (s.status === 'ga' || s.status === 'preview'),
  );
}

/** Does this region offer a (GA/preview) service that fulfils the abstract
 *  capability key (e.g. "kubernetes")? The catalogue is the data-driven bridge
 *  from the app's CSP-agnostic needs to per-CSP service codes.
 *
 *  Supports two optional qualifier suffixes (#1323):
 *  - `<code>@<major>`: version qualifier -- service must have max_version >= major.
 *  - `<code>+<cap>`: capability qualifier -- service must carry cap or cap_supported
 *    in its capabilities array.
 *  The base code (without qualifier) is matched against the service's fulfills array. */
export function regionFulfills(region: LzRegion, capability: string): boolean {
  const atIdx = capability.indexOf('@');
  const plusIdx = capability.indexOf('+');

  let base: string;
  let minVersion: number | null = null;
  let requiredCap: string | null = null;

  if (atIdx !== -1) {
    base = capability.slice(0, atIdx);
    minVersion = parseInt(capability.slice(atIdx + 1), 10);
  } else if (plusIdx !== -1) {
    base = capability.slice(0, plusIdx);
    requiredCap = capability.slice(plusIdx + 1);
  } else {
    base = capability;
  }

  return region.services.some((s) => {
    if (!s.fulfills.includes(base)) return false;
    if (s.status !== 'ga' && s.status !== 'preview') return false;
    if (minVersion !== null) {
      return s.max_version !== undefined && s.max_version >= minVersion;
    }
    if (requiredCap !== null) {
      return s.capabilities.includes(requiredCap) || s.capabilities.includes(`${requiredCap}_supported`);
    }
    return true;
  });
}

/** Find a region by id within a catalogue. */
export function findRegion(catalogue: LzServiceCatalogue, regionId: string): LzRegion | undefined {
  return catalogue.regions.find((r) => r.id === regionId);
}
