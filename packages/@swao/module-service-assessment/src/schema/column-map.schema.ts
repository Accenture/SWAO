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
 * Column-map YAML schema (Design 103 §21.1, #3076).
 *
 * A column map tells `swao service init` which spreadsheet column feeds which
 * SWAO field. The default template (§3.2) is resolved into the same shape from
 * the header row, so the parser only ever consumes a validated ColumnMap.
 */

import { z } from 'zod';

export type FieldType = 'string' | 'integer' | 'number' | 'boolean' | 'list';

/** Every mappable field key, the app `.swao.yml` path it writes, and its default type. */
export const FIELD_REGISTRY = {
  id_name_combined:         { path: 'id+name',                              type: 'string' },
  id:                       { path: 'id',                                   type: 'string' },
  name:                     { path: 'name',                                 type: 'string' },
  vendor_type:              { path: 'vendor_type',                          type: 'string' },
  vendor_name:              { path: 'vendor.name',                          type: 'string' },
  vendor_version:           { path: 'vendor.version',                       type: 'string' },
  vendor_url:               { path: 'vendor.url',                           type: 'string' },
  vendor_support_active:    { path: 'vendor.support_active',                type: 'boolean' },
  contract_expiry:          { path: 'vendor.contract_expiry',               type: 'string' },
  os:                       { path: 'platform.os',                          type: 'string' },
  os_eol:                   { path: 'platform.os_eol',                      type: 'string' },
  auth_method:              { path: 'platform.auth_method',                 type: 'string' },
  backup_enabled:           { path: 'platform.backup_enabled',              type: 'boolean' },
  sla_uptime:               { path: 'platform.sla_uptime',                  type: 'number' },
  cpu_cores:                { path: 'hardware.cpu_cores',                   type: 'integer' },
  memory_mb:                { path: 'hardware.memory_mb',                   type: 'integer' },
  active_memory_mb:         { path: 'hardware.active_memory_mb',            type: 'integer' },
  disk_count:               { path: 'hardware.disk_count',                  type: 'integer' },
  total_disk_mib:           { path: 'hardware.total_disk_mib',              type: 'integer' },
  total_disk_gb:            { path: 'hardware.total_disk_gb',               type: 'number' },
  ip:                       { path: 'network.ip',                           type: 'string' },
  network_zone:             { path: 'network.zone',                         type: 'string' },
  integrations_raw:         { path: 'integrations',                         type: 'string' },
  business_function:        { path: 'business.function',                    type: 'string' },
  business_domain:          { path: 'business.domain',                      type: 'string' },
  user_count:               { path: 'business.user_count',                  type: 'integer' },
  criticality:              { path: 'business.criticality',                 type: 'string' },
  annual_cost_eur:          { path: 'business.annual_cost_eur',             type: 'number' },
  license_type:             { path: 'business.license_type',                type: 'string' },
  health_data:              { path: 'data.health_data',                     type: 'boolean' },
  data_pii:                 { path: 'data.pii',                             type: 'boolean' },
  data_subjects:            { path: 'data.subjects',                        type: 'list' },
  data_categories:          { path: 'data.categories',                      type: 'list' },
  data_classification:      { path: 'data.classification',                  type: 'string' },
  data_residency:           { path: 'data.residency',                       type: 'string' },
  subprocessors:            { path: 'data.subprocessors',                   type: 'list' },
  gdpr_art9:                { path: 'data.gdpr_art9',                       type: 'boolean' },
  hipaa_phi:                { path: 'data.hipaa_phi',                       type: 'boolean' },
  regulatory:               { path: 'data.regulatory',                      type: 'list' },
  mdr_class:                { path: 'data.mdr_class',                       type: 'string' },
  migration_candidate:      { path: 'disposition.migration_candidate',      type: 'boolean' },
  gartner_time:             { path: 'disposition.gartner_time',             type: 'string' },
  migration_project_vendor: { path: 'disposition.migration_project_vendor', type: 'string' },
  ams_sovereign_cloud:      { path: 'disposition.ams_sovereign_cloud',      type: 'boolean' },
  last_audit_date:          { path: 'security.last_audit_date',             type: 'string' },
} as const satisfies Record<string, { path: string; type: FieldType }>;

export type FieldKey = keyof typeof FIELD_REGISTRY;
export const FIELD_KEYS = Object.keys(FIELD_REGISTRY) as FieldKey[];

/** Column letters A-Z and AA-AZ (Design 103 §21.1). */
export const COLUMN_LETTER_REGEX = /^(?:[A-Z]|A[A-Z])$/;

/** 1-based column index for a letter (A=1, AA=27) or a 1-based number. */
export function columnToIndex(col: string | number): number {
  if (typeof col === 'number') return col;
  const c = col.toUpperCase();
  return c.length === 1 ? c.charCodeAt(0) - 64 : 26 + (c.charCodeAt(1) - 64);
}

export function indexToColumn(index: number): string {
  return index <= 26 ? String.fromCharCode(64 + index) : `A${String.fromCharCode(64 + index - 26)}`;
}

const ColumnRefSchema = z.union([
  z.string().trim().toUpperCase().refine((v) => COLUMN_LETTER_REGEX.test(v), {
    message: 'invalid column letter: use A-Z or AA-AZ, or a 1-indexed column number',
  }),
  z.number().int().min(1).max(52, { message: 'column number must be between 1 and 52 (A-AZ)' }),
]);

export const FieldMappingSchema = z.object({
  col: ColumnRefSchema,
  required: z.boolean().optional(),
  type: z.enum(['string', 'integer', 'number', 'boolean', 'list']).optional(),
  unit: z.enum(['mib', 'mb', 'gb']).optional(),
  true_values: z.array(z.string()).optional(),
  false_values: z.array(z.string()).optional(),
  null_values: z.array(z.string()).optional(),
  multi_value_separator: z.string().min(1).optional(),
  split_on: z.string().min(1).optional(),
  strip_closing: z.string().optional(),
  strip_flags: z.boolean().optional(),
  app_id_pattern: z.string().optional(),
  note: z.string().optional(),
}).strict();

export type FieldMapping = z.infer<typeof FieldMappingSchema>;

export const PiiColumnSchema = z.object({
  col: ColumnRefSchema,
  reason: z.string().min(1),
  stored_as: z.string().optional(),
}).strict();

export type PiiColumn = z.infer<typeof PiiColumnSchema>;

const FieldsSchema = z.record(z.string(), FieldMappingSchema).superRefine((fields, ctx) => {
  for (const key of Object.keys(fields)) {
    if (!(FIELD_KEYS as string[]).includes(key)) {
      ctx.addIssue({ code: 'custom', path: [key], message: `unknown field "${key}"; supported fields: ${FIELD_KEYS.join(', ')}` });
    }
  }
  if (!fields['os']) {
    ctx.addIssue({ code: 'custom', path: ['os'], message: 'mandatory field "os" is not mapped' });
  }
  const combined = Boolean(fields['id_name_combined']);
  const separate = Boolean(fields['id']);
  if (!combined && !separate) {
    ctx.addIssue({ code: 'custom', path: ['id_name_combined'], message: 'mandatory identity field missing: map "id_name_combined" or "id" (and optionally "name")' });
  }
  if (combined && separate) {
    ctx.addIssue({ code: 'custom', path: ['id'], message: 'map either "id_name_combined" or "id"/"name", not both' });
  }
});

export const ColumnMapSchema = z.object({
  version: z.string(),
  source: z.object({
    file: z.string().optional(),
    sheet: z.union([z.string().min(1), z.number().int().min(1)]).optional(),
    header_row: z.number().int().min(0).default(1),
    data_start_row: z.number().int().min(1).default(2),
  }).strict().default({ header_row: 1, data_start_row: 2 }),
  fields: FieldsSchema,
  pii_columns: z.array(PiiColumnSchema).default([]),
}).strict().superRefine((map, ctx) => {
  const piiCols = new Set(map.pii_columns.map((p) => columnToIndex(p.col)));
  for (const [key, f] of Object.entries(map.fields)) {
    if (piiCols.has(columnToIndex(f.col))) {
      ctx.addIssue({ code: 'custom', path: ['fields', key, 'col'], message: `column ${String(f.col)} is declared in pii_columns and cannot also be mapped to "${key}"` });
    }
  }
});

export type ColumnMap = z.infer<typeof ColumnMapSchema>;

export class ColumnMapError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid column map:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ColumnMapError';
  }
}

/** Validate a parsed column-map object; throws ColumnMapError with readable issues. */
export function parseColumnMap(raw: unknown): ColumnMap {
  const result = ColumnMapSchema.safeParse(raw);
  if (result.success) return result.data;
  throw new ColumnMapError(result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
}

/** Header text that indicates a personal-data column (contact person, phone, email). */
export const PII_HEADER_PATTERNS: readonly RegExp[] = [
  /\b(phone|telefon|telefonnummer|tel\.?|mobile|mobil)\b/i,
  /\b(e-?mail|mail)\b/i,
  /\b(contact|kontakt|ansprechpartner)\b/i,
  /hersteller\s*support/i,
];

export function isPiiHeader(header: string): boolean {
  return PII_HEADER_PATTERNS.some((re) => re.test(header));
}

/**
 * Warnings (not errors) for source columns whose header looks like personal data
 * but which are not declared in `pii_columns` (Design 103 §21.1 check 3).
 * `headers` is keyed by 1-based column index.
 */
export function checkPiiDeclarations(map: ColumnMap, headers: ReadonlyMap<number, string>): string[] {
  const declared = new Set(map.pii_columns.map((p) => columnToIndex(p.col)));
  const warnings: string[] = [];
  for (const [index, header] of headers) {
    if (isPiiHeader(header) && !declared.has(index)) {
      warnings.push(`column ${indexToColumn(index)} ("${header}") looks like personal data but is not declared in pii_columns`);
    }
  }
  return warnings;
}
