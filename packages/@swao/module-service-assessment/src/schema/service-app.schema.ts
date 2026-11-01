// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Service-mode blocks of the per-app `apps/<id>/.swao.yml` (Design 103 §4.2, #3078).
 *
 * Service apps use the existing per-app `.swao.yml` (the same file application
 * assessments use) with `assessment.type: service`; there is no separate
 * service config file. The core SwaoYmlSchema is passthrough, so these blocks
 * parse there unchanged; this schema validates them for the service flow.
 *
 * PII guardrail (G-06): vendor support contact, phone, and email are stored as
 * booleans only. The schema rejects any other shape for those keys.
 */

import { z } from 'zod';

const nullable = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional();

export const OPERATIONAL_STATUSES = ['active', 'restricted', 'decommissioned', 'unused', 'inactive'] as const;
export const VENDOR_TYPES = ['on-premises', 'saas', 'hybrid', 'legacy'] as const;
export const SOVEREIGN_RATINGS = ['open-source', 'open-standard', 'proprietary'] as const;

export const InfraCategorySchema = z.union([z.literal('UNKNOWN'), z.string().regex(/^INFRA_[A-Z0-9_]+$/)]);

export const SovereignAlternativeSchema = z.object({
  id: z.string(),
  name: z.string(),
  sovereign_rating: z.enum(SOVEREIGN_RATINGS).optional(),
}).passthrough();

export const ServiceVendorSchema = z.object({
  name: nullable(z.string()),
  version: nullable(z.string()),
  url: nullable(z.string()),
  support_active: nullable(z.boolean()),
  contract_expiry: nullable(z.string()),
  support_contact_present: z.boolean().optional(),
  support_phone_present: z.boolean().optional(),
  support_email_present: z.boolean().optional(),
}).strict();

export const ServiceHardwareSchema = z.object({
  cpu_cores: nullable(z.number().int().nonnegative()),
  memory_mb: nullable(z.number().nonnegative()),
  active_memory_mb: nullable(z.number().nonnegative()),
  disk_count: nullable(z.number().int().nonnegative()),
  total_disk_mib: nullable(z.number().nonnegative()),
  total_disk_gb: nullable(z.number().nonnegative()),
  est_cloud_cost_eur_mo: nullable(z.number().nonnegative()),
}).strict();

export const ServiceDataSchema = z.object({
  health_data: nullable(z.boolean()),
  pii: nullable(z.boolean()),
  subjects: nullable(z.array(z.string())),
  categories: nullable(z.array(z.string())),
  classification: nullable(z.string()),
  /** #3210: original intake wording when it differs from the English canonical value. */
  classification_source: nullable(z.string()),
  residency: nullable(z.string()),
  subprocessors: nullable(z.array(z.string())),
  gdpr_art9: nullable(z.boolean()),
  hipaa_phi: nullable(z.boolean()),
  regulatory: nullable(z.array(z.string())),
  mdr_class: nullable(z.string()),
}).strict();

export const ServiceDispositionSchema = z.object({
  operational_status: z.enum(OPERATIONAL_STATUSES),
  migration_candidate: nullable(z.boolean()),
  gartner_time: nullable(z.string()),
  gartner_time_source: nullable(z.string()),
  migration_project_vendor: nullable(z.string()),
  ams_sovereign_cloud: nullable(z.boolean()),
}).strict();

export const ServiceIntakeProvenanceSchema = z.object({
  sheet: z.string(),
  row: z.number().int().positive(),
  /** Intake fields the column layout mapped (#3196): rules score a field only when its column existed. */
  fields: z.array(z.string()).optional(),
  /** #3210: fields carried verbatim in the client's wording (free text, not translated). */
  source_text_fields: z.array(z.string()).optional(),
  /** #3521: intake workbook this app was scaffolded from (file name only, never a path). */
  source: z.string().optional(),
  /** #3521: SHA-256 of the intake workbook bytes at scaffold time. */
  source_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

export const ServiceAppConfigSchema = z.object({
  wsp_version: z.string(),
  app_id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  app_name: nullable(z.string()),
  imports_dir: z.string().optional(),
  assessment: z.object({ type: z.literal('service') }).passthrough(),
  vendor_type: z.enum(VENDOR_TYPES),
  site: nullable(z.string()),
  infra_category: InfraCategorySchema,
  os_class: nullable(z.string()),
  sovereign_rating: nullable(z.enum(SOVEREIGN_RATINGS)),
  sovereign_alternatives: z.array(SovereignAlternativeSchema).optional(),
  cluster: nullable(z.boolean()),
  cluster_id: nullable(z.string()),
  cluster_member_count: nullable(z.number().int().positive()),
  cluster_members: nullable(z.array(z.string())),
  vendor: ServiceVendorSchema,
  platform: z.object({
    os: nullable(z.string()),
    os_eol: nullable(z.string()),
    auth_method: nullable(z.string()),
    backup_enabled: nullable(z.boolean()),
    sla_uptime: nullable(z.number()),
  }).strict(),
  hardware: ServiceHardwareSchema,
  network: z.object({ ip: nullable(z.string()), zone: nullable(z.string()) }).strict().optional(),
  business: z.object({
    function: nullable(z.string()),
    domain: nullable(z.string()),
    domains: nullable(z.array(z.string())),
    criticality: nullable(z.string()),
    // #3210: original intake wording next to the English canonical value.
    function_source: nullable(z.string()),
    domain_source: nullable(z.string()),
    domains_source: nullable(z.array(z.string())),
    criticality_source: nullable(z.string()),
    user_count: nullable(z.number().int().nonnegative()),
    annual_cost_eur: nullable(z.number().nonnegative()),
    license_type: nullable(z.string()),
  }).strict(),
  data: ServiceDataSchema,
  disposition: ServiceDispositionSchema,
  integrations: z.array(z.string()),
  integrations_notes: nullable(z.string()),
  security: z.object({ last_audit_date: nullable(z.string()) }).strict().optional(),
  intake: ServiceIntakeProvenanceSchema,
  /** Lift-and-shift cost estimate (Design 103 §4.3); reporting currency per workspace options, EUR by default. */
  cost: z.object({ currency: z.string().regex(/^[A-Z]{3}$/), monthly_estimate: z.number().nonnegative().nullable() }).passthrough().optional(),
  /** Fields owned by the scaffold; `--refresh` rewrites only these, preserving analyst edits elsewhere. */
  generated_fields: z.array(z.string()),
  generated_at: z.string(),
}).passthrough();

export type ServiceAppConfig = z.infer<typeof ServiceAppConfigSchema>;
