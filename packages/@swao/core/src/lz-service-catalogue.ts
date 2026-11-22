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
  /**
   * ISO country where data rests/processes, or a region grouping ("EU", "global").
   * Two sentinels (#3287): "OPERATOR_SITE" for a region whose site the customer
   * chooses (operator_jurisdiction "operator-site", e.g. azure-local; it
   * belongs to no geography), and "UNKNOWN", written by the refresh for a
   * region without a sourced overlay pin. Optional for backward compatibility;
   * the LZ catalogue quality rule sovereignty-shape requires it.
   */
  residency_country: z.string().optional(),
  /** Legal entity / jurisdiction that operates the region. */
  operator_jurisdiction: z.string().optional(),
  /** Extraterritorial legal exposure facts, e.g. ["us_cloud_act", "fisa_702"]. */
  extraterritorial_exposure: z.array(z.string()).default([]),
  /**
   * Held attestations relevant to sovereignty. Template vocabulary (#3287):
   * BSI_C5, ISO_27001, SOC_2, TISAX_L3, PCI_DSS, FedRAMP_High, MAS_TRM, IRAP;
   * other values pass the schema but the certification-vocabulary rule warns.
   */
  certifications: z.array(z.string()).default([]),
}).strict();

// --- Schema 0.2 (Design 120 §9, §10.1; 073 G-04, G-05; 077 D-077-04) -----
// Additive generation: every 0.1 file stays valid. 0.2 adds the optional
// per-service `iac` block and `canonical_code`, the source mode `live-api`
// (live LZ catalogue, Design 120 §10.1) and the 077 values `manual`
// (hand-maintained custom catalogue), `operator-declared` (confidence) and
// `check-availability` (service status the operator still has to confirm).

/** Service lifecycle status. `check-availability` (077 §5) is not offered
 *  until the operator confirms it, so it never counts as available. */
export const LZ_SERVICE_STATUSES = ['ga', 'preview', 'announced', 'retired', 'check-availability'] as const;

/** How a catalogue snapshot was produced (`meta.source.mode`). Closed enum (073 G-05). */
export const LZ_CATALOGUE_SOURCE_MODES = ['api', 'scrape', 'curated', 'botocore-endpoints', 'pim-api-stackit', 'live-api', 'manual'] as const;

/** Catalogue confidence (`meta.confidence`); `operator-declared` per 077 §4. */
export const LZ_CATALOGUE_CONFIDENCES = ['high', 'medium', 'low', 'operator-declared'] as const;

/** Terraform / OpenTofu automatability level of a service (Design 120 §9):
 *  full = a managed resource exists, read = data source only, none = neither,
 *  n/a = infrastructure as code does not apply to this service. */
export const LZ_IAC_LEVELS = ['full', 'read', 'none', 'n/a'] as const;

/** True for a YYYY-MM-DD string that names a real calendar date (rejects 2026-13-45, 2026-02-30). */
function isCalendarDate(value: string): boolean {
  // The format itself is checked by the regex; report only one issue per value.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Unrefined IaC block object, exported for composition (`.extend`, `.pick`);
 *  validate data with the refined {@link LzServiceIacSchema}. */
export const LzServiceIacBaseSchema = z.object({
  /** IaC tools the provider serves; OpenTofu uses the same providers as Terraform. */
  tool: z.array(z.enum(['terraform', 'opentofu'])).default([]),
  /** Provider source short name, e.g. "opentelekomcloud", "azurerm". */
  provider: z.string().min(1).optional(),
  /** Provider version the resource and data source lists were read from;
   *  required when `source` is `provider-schema`. */
  provider_version: z.string().min(1).optional(),
  level: z.enum(LZ_IAC_LEVELS),
  /** Managed resource types that cover the service. */
  resources: z.array(z.string().min(1)).default([]),
  /** Data sources that read the service. */
  data_sources: z.array(z.string().min(1)).default([]),
  /** provider-schema = derived from `tofu providers schema -json`; curated = hand-maintained. */
  source: z.enum(['provider-schema', 'curated']),
  /** YYYY-MM-DD the block was last verified (073 §5.7). */
  last_verified: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'last_verified must be YYYY-MM-DD')
    .refine(isCalendarDate, 'last_verified must be a real calendar date')
    .optional(),
}).strict();

/**
 * Terraform / OpenTofu automatability of one service (Design 120 §9; 073 §5.7).
 * The single IaC definition for LZ catalogue files and the live scan.
 *
 * Level rules:
 * - `full`: provider, at least one tool and at least one managed resource.
 * - `read`: provider, at least one tool, at least one data source and no managed resource.
 * - `none`: no Terraform / OpenTofu coverage exists; no resources and no data sources;
 *   provider and tool are optional (an on-prem or exotic CSP may have no provider at all).
 * - `n/a`: infrastructure as code does not apply to the service; no resources and no data sources.
 * `source: provider-schema` also requires `provider_version`.
 */
export const LzServiceIacSchema = LzServiceIacBaseSchema.superRefine((iac, ctx) => {
  const issue = (path: string, message: string): void => { ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message }); };
  switch (iac.level) {
    case 'full':
    case 'read':
      if (!iac.provider) issue('provider', `provider is required for level ${iac.level}`);
      if (iac.tool.length === 0) issue('tool', `at least one tool is required for level ${iac.level}`);
      if (iac.level === 'full' && iac.resources.length === 0) issue('resources', 'level full names at least one managed resource type');
      if (iac.level === 'read') {
        if (iac.data_sources.length === 0) issue('data_sources', 'level read names at least one data source');
        if (iac.resources.length > 0) issue('resources', 'level read means data source only; resources must be empty');
      }
      break;
    case 'none':
    case 'n/a':
      if (iac.resources.length > 0) issue('resources', `level ${iac.level} has no managed resources`);
      if (iac.data_sources.length > 0) issue('data_sources', `level ${iac.level} has no data sources`);
      break;
    default: {
      const exhaustive: never = iac.level;
      void exhaustive;
    }
  }
  if (iac.source === 'provider-schema' && !iac.provider_version) issue('provider_version', 'provider_version is required when source is provider-schema');
});

// --- A single service offering in a region -------------------------------
export const LzServiceSchema = z.object({
  /** Stable service code, e.g. "rds-postgresql", "Microsoft.DBforPostgreSQL". */
  code: z.string().min(1),
  /** Stable identifier that survives product renames (073 G-04), e.g. the ARM
   *  namespace when `code` is a marketing name. Optional, schema 0.2. */
  canonical_code: z.string().min(1).optional(),
  /** Human display name (optional). */
  name: z.string().optional(),
  status: z.enum(LZ_SERVICE_STATUSES).default('ga'),
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
  /** Terraform / OpenTofu automatability (Design 120 §9). Optional, schema 0.2. */
  iac: LzServiceIacSchema.optional(),
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
  /** Geographic grouping label used by some providers (e.g. "Middle East"). */
  area: z.string().optional(),
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
    /** How the snapshot was produced; see LZ_CATALOGUE_SOURCE_MODES. */
    mode: z.enum(LZ_CATALOGUE_SOURCE_MODES),
    tool: z.string().optional(),
    operator: z.string().optional(),
    /** Provenance note -- used when the data source carries no contracted public SLA. */
    source_note: z.string().optional(),
  }),
  /** Overall confidence in the snapshot (curated/announced sets are lower). */
  confidence: z.enum(LZ_CATALOGUE_CONFIDENCES).default('high'),
  regions_count: z.number().int().nonnegative().optional(),
}).strict();

export const LzServiceCatalogueSchema = z.object({
  meta: LzCatalogueMetaSchema,
  regions: z.array(LzRegionSchema).default([]),
}).strict();

export type LzSovereigntyFacts = z.infer<typeof LzSovereigntyFactsSchema>;
export type LzService = z.infer<typeof LzServiceSchema>;
export type LzServiceIac = z.infer<typeof LzServiceIacSchema>;
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
