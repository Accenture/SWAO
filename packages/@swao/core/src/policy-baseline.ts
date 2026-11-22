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

// Client LZ Policy Baseline: `policy-baseline.yaml` schema and loader (#3862,
// Design 123 sections 5.1, 5.2, 7.2, 7.3; owner decisions D-09, D-10).
//
// The file is a strict sibling of framework-meta.yaml and controls.yaml inside
// a community framework folder, following the service-controls.yaml precedent
// (service-controls.ts). framework-meta.yaml and controls.yaml are not strict
// (regime-catalogue.ts FrameworkMetaSchema, RegimeControlSchema) and would drop
// settings silently, so the baseline settings live here.
//
// A policy has a kind from a closed set; kinds are code, policies are data
// (Design 123 section 5.1). Each kind has one strict parameter schema; the
// discriminated union on `kind` also pins the category of the kind, so a
// category that does not match its kind is a validation error. Parameters are
// never coerced (YAML `min_tls_version: 1.2` is a number and is refused).
//
// Every parameter is optional in the schema: absent values take the shipped
// default (Design 123 section 5.2), and the shipped policies CPB-RES-01 to 03
// share one kind with one parameter each. A client-added policy has no shipped
// default, so the loader requires every parameter of its kind.

import { existsSync, readFileSync, readdirSync } from 'fs';
import { isIP } from 'net';
import { join } from 'path';
import { load } from 'js-yaml';
import { z } from 'zod';
import { RegimeIdSchema } from './regime-catalogue.js';
import { CapabilityTagSchema } from './service-controls.js';
import { collectSecretShapedPaths } from './swao-yml.js';

export const POLICY_BASELINE_FILE = 'policy-baseline.yaml';

/** Shipped policy ids (Design 123 section 7.2, D-09): `CPB-<CAT>-NN`. */
export const SHIPPED_POLICY_ID_PATTERN = /^CPB-[A-Z]+-\d{2,3}$/;
/** Client-added policy ids (D-09): `X-<PREFIX>-<CAT>-NN`, for example X-ORG-SVC-01. */
export const CLIENT_POLICY_ID_PATTERN = /^X-[A-Z][A-Z0-9]*-[A-Z]+-\d{2,3}$/;

export const POLICY_STATES = ['enabled', 'disabled', 'not_set'] as const;
export type PolicyState = (typeof POLICY_STATES)[number];

export const POLICY_CATEGORIES = [
  'data_residency',
  'service_control',
  'encryption',
  'network_exposure',
  'identity',
  'logging',
  'tagging',
  'availability',
  'resilience',
  'cost',
  'portability',
] as const;
export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];

export const POLICY_KINDS = [
  'region_residency',
  'service_deny',
  'service_allow_list',
  'encryption_at_rest',
  'encryption_in_transit',
  'no_public_exposure',
  'no_open_admin_ingress',
  'privileged_mfa',
  'credential_age',
  'audit_trail',
  'log_retention',
  'required_tags',
  'min_availability_zones',
  'backup_configured',
  'budget_alerts',
  'documented_exit',
] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

/** The category of every kind (Design 123 section 5.1 table). */
export const POLICY_KIND_CATEGORY: Readonly<Record<PolicyKind, PolicyCategory>> = {
  region_residency: 'data_residency',
  service_deny: 'service_control',
  service_allow_list: 'service_control',
  encryption_at_rest: 'encryption',
  encryption_in_transit: 'encryption',
  no_public_exposure: 'network_exposure',
  no_open_admin_ingress: 'network_exposure',
  privileged_mfa: 'identity',
  credential_age: 'identity',
  audit_trail: 'logging',
  log_retention: 'logging',
  required_tags: 'tagging',
  min_availability_zones: 'availability',
  backup_configured: 'resilience',
  budget_alerts: 'cost',
  documented_exit: 'portability',
};

/** Key custody order, weakest first (Design 123 section 5.1, `min_key_custody`). */
export const KEY_CUSTODY_LEVELS = ['provider-managed', 'customer-managed', 'byok', 'hyok'] as const;
export type KeyCustodyLevel = (typeof KEY_CUSTODY_LEVELS)[number];

const nonEmpty = z.string().min(1);
const capabilityList = z.array(CapabilityTagSchema).min(1);
/** ISO 3166-1 alpha-2 country code or the grouping `EU`. */
const CountryOrEuSchema = z.string().regex(/^(?:[A-Z]{2}|EU)$/, 'country must be an ISO 3166-1 alpha-2 code (DE) or EU');
const PortSchema = z.number().int().min(1).max(65535);
const CidrSchema = z.string().refine((v) => {
  const slash = v.lastIndexOf('/');
  if (slash <= 0) return false;
  const addr = v.slice(0, slash);
  const prefix = v.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const family = isIP(addr);
  const bits = Number(prefix);
  return (family === 4 && bits <= 32) || (family === 6 && bits <= 128);
}, 'source must be a CIDR block (for example 0.0.0.0/0 or ::/0)');
const positiveInt = z.number().int().min(1);

// One strict parameter schema per kind; every field optional (header comment).
const RegionResidencyParams = z
  .object({
    allowed_countries: z.array(CountryOrEuSchema).min(1).optional(),
    allowed_operator_jurisdictions: z.array(nonEmpty).min(1).optional(),
    forbid_exposure: z.array(nonEmpty).min(1).optional(),
    required_certifications: z.array(nonEmpty).min(1).optional(),
  })
  .strict();
const CapabilitiesParams = z.object({ capabilities: capabilityList.optional() }).strict();
const EncryptionAtRestParams = z
  .object({ min_key_custody: z.enum(KEY_CUSTODY_LEVELS).optional(), applies_to: capabilityList.optional() })
  .strict();
const EncryptionInTransitParams = z
  .object({
    min_tls_version: z.enum(['1.2', '1.3'], { message: 'min_tls_version must be the string "1.2" or "1.3" (quote it in YAML)' }).optional(),
    applies_to: capabilityList.optional(),
  })
  .strict();
const NoPublicExposureParams = z.object({ allow_capabilities: z.array(CapabilityTagSchema).optional() }).strict();
const NoOpenAdminIngressParams = z
  .object({ ports: z.array(PortSchema).min(1).optional(), forbidden_sources: z.array(CidrSchema).min(1).optional() })
  .strict();
const NoParams = z.object({}).strict();
const CredentialAgeParams = z.object({ max_age_days: positiveInt.optional() }).strict();
const AuditTrailParams = z.object({ all_regions: z.boolean().optional() }).strict();
const LogRetentionParams = z.object({ min_days: positiveInt.optional() }).strict();
const RequiredTagsParams = z.object({ keys: z.array(nonEmpty).min(1).optional() }).strict();
const MinAzParams = z.object({ min: positiveInt.optional() }).strict();
const BackupConfiguredParams = z.object({ applies_to: capabilityList.optional() }).strict();
const BudgetAlertsParams = z.object({ required: z.boolean().optional() }).strict();

/** Parameter schema per kind; the Record type makes a missing kind a compile error. */
export const POLICY_PARAM_SCHEMAS = {
  region_residency: RegionResidencyParams,
  service_deny: CapabilitiesParams,
  service_allow_list: CapabilitiesParams,
  encryption_at_rest: EncryptionAtRestParams,
  encryption_in_transit: EncryptionInTransitParams,
  no_public_exposure: NoPublicExposureParams,
  no_open_admin_ingress: NoOpenAdminIngressParams,
  privileged_mfa: NoParams,
  credential_age: CredentialAgeParams,
  audit_trail: AuditTrailParams,
  log_retention: LogRetentionParams,
  required_tags: RequiredTagsParams,
  min_availability_zones: MinAzParams,
  backup_configured: BackupConfiguredParams,
  budget_alerts: BudgetAlertsParams,
  documented_exit: NoParams,
} as const satisfies Record<PolicyKind, z.ZodType>;

const PolicyIdSchema = z
  .string()
  .refine(
    (v) => SHIPPED_POLICY_ID_PATTERN.test(v) || CLIENT_POLICY_ID_PATTERN.test(v),
    'policy id must be CPB-<CAT>-NN (shipped) or X-<PREFIX>-<CAT>-NN (client-added), for example X-ORG-SVC-01',
  );

/** Schema versions the loader accepts (#4128 BC-02): 0.2 adds the optional per-policy `decision`. */
export const POLICY_BASELINE_SCHEMA_VERSIONS = ['0.1', '0.2'] as const;
/** Longest rationale of a decision record (Design 123 section 17.5.6). */
export const POLICY_DECISION_RATIONALE_MAX = 300;

/**
 * The client's reason for a value (#4128 BC-02, Design 123 section 17.5.6):
 * no person's name, one line of at most 300 characters, the date and the way
 * it was decided. `default_source` keeps documenting the shipped default.
 */
export const PolicyDecisionSchema = z
  .object({
    rationale: z
      .string()
      .min(1)
      .max(POLICY_DECISION_RATIONALE_MAX)
      .regex(/^[^\u0000-\u001f\u007f]+$/, 'rationale must be one line without control characters'),
    decided_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'decided_on must be YYYY-MM-DD (quote it in YAML)'),
    via: z.literal('consultation'),
  })
  .strict();
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

const policyCommon = {
  id: PolicyIdSchema,
  /** Control id in the sibling controls.yaml. */
  control: z.string().min(1).max(80),
  state: z.enum(POLICY_STATES),
  /** Citation of the default, or the literal `assumption` (Design 123 section 6.2, D-05). */
  default_source: nonEmpty,
  /** Schema 0.2 (#4128 BC-02): the client's decision record for the current value. */
  decision: PolicyDecisionSchema.optional(),
};

function policyVariant<K extends PolicyKind, P extends z.ZodObject>(kind: K, params: P) {
  return z
    .object({
      ...policyCommon,
      kind: z.literal(kind),
      category: z.literal(POLICY_KIND_CATEGORY[kind] as (typeof POLICY_KIND_CATEGORY)[K]),
      params: params.default({} as never),
    })
    .strict();
}

export const PolicySchema = z.discriminatedUnion('kind', [
  policyVariant('region_residency', RegionResidencyParams),
  policyVariant('service_deny', CapabilitiesParams),
  policyVariant('service_allow_list', CapabilitiesParams),
  policyVariant('encryption_at_rest', EncryptionAtRestParams),
  policyVariant('encryption_in_transit', EncryptionInTransitParams),
  policyVariant('no_public_exposure', NoPublicExposureParams),
  policyVariant('no_open_admin_ingress', NoOpenAdminIngressParams),
  policyVariant('privileged_mfa', NoParams),
  policyVariant('credential_age', CredentialAgeParams),
  policyVariant('audit_trail', AuditTrailParams),
  policyVariant('log_retention', LogRetentionParams),
  policyVariant('required_tags', RequiredTagsParams),
  policyVariant('min_availability_zones', MinAzParams),
  policyVariant('backup_configured', BackupConfiguredParams),
  policyVariant('budget_alerts', BudgetAlertsParams),
  policyVariant('documented_exit', NoParams),
]);

export const PolicyBaselineSchema = z
  .object({
    schema_version: z.enum(POLICY_BASELINE_SCHEMA_VERSIONS),
    /** framework.id of the sibling framework-meta.yaml. */
    framework: RegimeIdSchema,
    /** Shipped baseline this copy derives from (equal to `framework` in the shipped file). */
    baseline_of: RegimeIdSchema,
    /** Shipped catalogue version this copy was last upgraded to. */
    catalogue_version: z.string().regex(/^\d+\.\d+\.\d+$/, 'catalogue_version must be semver (1.0.0)'),
    policies: z.array(PolicySchema).default([]),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const seen = new Set<string>();
    doc.policies.forEach((p, i) => {
      if (seen.has(p.id)) {
        ctx.addIssue({ code: 'custom', path: ['policies', i, 'id'], message: `duplicate policy id "${p.id}"` });
      }
      seen.add(p.id);
      if (p.decision !== undefined && doc.schema_version === '0.1') {
        ctx.addIssue({ code: 'custom', path: ['policies', i, 'decision'], message: 'a decision record needs schema_version "0.2"' });
      }
      if (p.kind === 'region_residency' && Object.keys(p.params).length === 0) {
        ctx.addIssue({ code: 'custom', path: ['policies', i, 'params'], message: 'region_residency needs at least one parameter' });
      }
    });
  });

export type Policy = z.infer<typeof PolicySchema>;
export type PolicyBaseline = z.infer<typeof PolicyBaselineSchema>;

/** Parameter names of a kind, from its schema (used for the client-policy completeness rule). */
export function policyKindParamNames(kind: PolicyKind): string[] {
  return Object.keys(POLICY_PARAM_SCHEMAS[kind].shape);
}

/** Every capability tag a baseline names (input to the unused-tag warning of the health check, #3869). */
export function policyBaselineCapabilityTags(doc: PolicyBaseline): string[] {
  const tags = new Set<string>();
  for (const p of doc.policies) {
    for (const t of policyCapabilityTags(p)) tags.add(t);
  }
  return [...tags].sort();
}

function policyCapabilityTags(p: Policy): readonly string[] {
  switch (p.kind) {
    case 'service_deny':
    case 'service_allow_list':
      return p.params.capabilities ?? [];
    case 'encryption_at_rest':
    case 'encryption_in_transit':
    case 'backup_configured':
      return p.params.applies_to ?? [];
    case 'no_public_exposure':
      return p.params.allow_capabilities ?? [];
    case 'region_residency':
    case 'no_open_admin_ingress':
    case 'privileged_mfa':
    case 'credential_age':
    case 'audit_trail':
    case 'log_retention':
    case 'required_tags':
    case 'min_availability_zones':
    case 'budget_alerts':
    case 'documented_exit':
      return [];
    default: {
      const unreachable: never = p;
      return unreachable;
    }
  }
}

export interface LoadPolicyBaselineOptions {
  /**
   * Policy ids of the bundled shipped baseline. When given, a `CPB-` id that
   * is not among them is refused: the prefix is reserved for shipped policies
   * (D-09), so an upgrade never collides with a client policy. Without the set
   * the file alone cannot tell a copied shipped policy from a client one.
   */
  shippedPolicyIds?: ReadonlySet<string>;
}

export type PolicyBaselineLoadResult =
  /** No policy-baseline.yaml: the framework is not a policy baseline. */
  | { status: 'absent'; file: string; baseline: null; errors: [] }
  | { status: 'ok'; file: string; baseline: PolicyBaseline; errors: [] }
  | { status: 'invalid'; file: string; baseline: null; errors: string[] };

function readYaml(file: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: load(readFileSync(file, 'utf-8')) };
  } catch (e) {
    return { ok: false, error: (e as Error).message.split('\n')[0] ?? 'unreadable' };
  }
}

/** Control ids of a controls.yaml document (`controls[].id`), or null when the shape is wrong. */
function controlIdsOf(raw: unknown): Set<string> | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { controls?: unknown }).controls)) return null;
  const ids = new Set<string>();
  for (const c of (raw as { controls: unknown[] }).controls) {
    if (c && typeof c === 'object' && typeof (c as { id?: unknown }).id === 'string') ids.add((c as { id: string }).id);
  }
  return ids;
}

/**
 * Control ids of the sibling controls.yaml of a baseline folder, or why they
 * cannot be read: `missing` (no file) or `unreadable` (not YAML, or no
 * `controls[].id` list). Never throws (#4128 BC-01, Design 123 section 17.5.5).
 */
export type PolicyBaselineControlIds = ReadonlySet<string> | 'missing' | 'unreadable';

export function readPolicyBaselineControlIds(frameworkDir: string): PolicyBaselineControlIds {
  const controlsFile = join(frameworkDir, 'controls.yaml');
  try {
    if (!existsSync(controlsFile)) return 'missing';
    const controls = readYaml(controlsFile);
    const ids = controls.ok ? controlIdsOf(controls.value) : null;
    return ids ?? 'unreadable';
  } catch {
    return 'unreadable';
  }
}

export interface ParsePolicyBaselineOptions extends LoadPolicyBaselineOptions {
  /** framework.id of the folder's framework-meta.yaml; the file's `framework` must match it. */
  expectedFrameworkId?: string;
  /** Control ids of the sibling controls.yaml (readPolicyBaselineControlIds). */
  controlIds: PolicyBaselineControlIds;
}

export type PolicyBaselineParseResult =
  | { ok: true; baseline: PolicyBaseline; errors: [] }
  | { ok: false; baseline: null; errors: string[] };

/**
 * The content rules of the loader over the text of a policy-baseline.yaml
 * (#4128 BC-01, Design 123 section 17.5.5): YAML, secret-shaped values, the
 * schema, the framework id, every `control` against the sibling controls.yaml,
 * the `CPB-` reservation (with `options.shippedPolicyIds`) and complete
 * parameters for client-added policies. Never throws. The MCP write path runs
 * it on a candidate text before writing; loadPolicyBaseline runs it on the file.
 */
export function parsePolicyBaselineText(text: string, options: ParsePolicyBaselineOptions): PolicyBaselineParseResult {
  const invalid = (errors: string[]): PolicyBaselineParseResult => ({ ok: false, baseline: null, errors });
  let raw: unknown;
  try {
    raw = load(text);
  } catch (e) {
    return invalid([`not valid YAML (${(e as Error).message.split('\n')[0] ?? 'unreadable'})`]);
  }
  try {
    const secretHits: (string | number)[][] = [];
    collectSecretShapedPaths(raw, [], secretHits);
    if (secretHits.length > 0) {
      return invalid(secretHits.map((p) => `${p.join('.') || '(root)'}: secret-shaped value refused; credentials never belong in framework content`));
    }

    const parsed = PolicyBaselineSchema.safeParse(raw);
    if (!parsed.success) {
      return invalid(parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
    }
    const doc = parsed.data;
    const errors: string[] = [];
    if (options.expectedFrameworkId !== undefined && doc.framework !== options.expectedFrameworkId) {
      errors.push(`framework: "${doc.framework}" does not match framework-meta.yaml id "${options.expectedFrameworkId}"`);
    }

    const controlIds = typeof options.controlIds === 'string' ? null : options.controlIds;
    if (options.controlIds === 'missing') {
      errors.push('controls.yaml: missing; every policy needs its control in the sibling controls.yaml');
    } else if (options.controlIds === 'unreadable') {
      errors.push('controls.yaml: not readable as a controls catalogue (controls[].id)');
    }

    doc.policies.forEach((p, i) => {
      if (controlIds !== null && !controlIds.has(p.control)) {
        errors.push(`policies.${i}.control: "${p.control}" is not a control id in controls.yaml`);
      }
      const shipped = SHIPPED_POLICY_ID_PATTERN.test(p.id);
      if (shipped && options.shippedPolicyIds !== undefined && !options.shippedPolicyIds.has(p.id)) {
        errors.push(`policies.${i}.id: "${p.id}" uses the CPB- prefix reserved for shipped policies; client policies use X-<PREFIX>-<CAT>-NN (D-09)`);
      }
      if (!shipped) {
        const given = p.params as Record<string, unknown>;
        const missing = policyKindParamNames(p.kind).filter((n) => given[n] === undefined);
        if (missing.length > 0) {
          errors.push(`policies.${i}.params: client policy "${p.id}" has no shipped default; set ${missing.join(', ')}`);
        }
      }
    });

    if (errors.length > 0) return invalid(errors);
    return { ok: true, baseline: doc, errors: [] };
  } catch (e) {
    return invalid([`could not be read (${(e as Error).message.split('\n')[0]})`]);
  }
}

/**
 * Read `<frameworkDir>/policy-baseline.yaml` (Design 123 section 7.2). Never
 * throws. `expectedFrameworkId` is the framework.id of the folder's
 * framework-meta.yaml; discovery goes by that id, not by the folder name (D-09).
 * The content rules are parsePolicyBaselineText's (#4128 BC-01): the schema,
 * the framework id, every `control` against the sibling controls.yaml, the
 * `CPB-` reservation (with `options.shippedPolicyIds`), complete parameters for
 * client-added policies, and secret-shaped values (CLAUDE.md section 5.7;
 * errors name the path only). This function only reads the two files.
 */
export function loadPolicyBaseline(
  frameworkDir: string,
  expectedFrameworkId?: string,
  options: LoadPolicyBaselineOptions = {},
): PolicyBaselineLoadResult {
  const file = join(frameworkDir, POLICY_BASELINE_FILE);
  const invalid = (errors: string[]): PolicyBaselineLoadResult => ({ status: 'invalid', file, baseline: null, errors });
  try {
    if (!existsSync(file)) return { status: 'absent', file, baseline: null, errors: [] };
    const text = readFileSync(file, 'utf-8');
    const r = parsePolicyBaselineText(text, {
      ...options,
      ...(expectedFrameworkId !== undefined ? { expectedFrameworkId } : {}),
      controlIds: readPolicyBaselineControlIds(frameworkDir),
    });
    return r.ok ? { status: 'ok', file, baseline: r.baseline, errors: [] } : invalid(r.errors);
  } catch (e) {
    return invalid([`could not be read (${(e as Error).message.split('\n')[0]})`]);
  }
}

// ---------------------------------------------------------------------------
// Shipped baseline lookup and drift (#3869 health check, #3870 baseline
// commands; Design 123 section 7.4).
// ---------------------------------------------------------------------------

/** Numeric semver order of two `catalogue_version` values (negative: a is older). */
export function compareCatalogueVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface ShippedPolicyBaseline {
  /** Folder of the shipped framework (inside the bundled frameworks dir). */
  dir: string;
  baseline: PolicyBaseline;
}

/**
 * The shipped baseline a copy derives from: the bundled framework folder whose
 * policy-baseline.yaml names `baselineOf` as its framework (Design 123 section
 * 7.1: the copy's `baseline_of`). Never throws; null when SWAO ships no such
 * baseline or the bundled file does not load.
 */
export function findShippedPolicyBaseline(bundledFrameworksDir: string, baselineOf: string): ShippedPolicyBaseline | null {
  let entries: string[];
  try {
    entries = readdirSync(bundledFrameworksDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort();
  } catch {
    return null;
  }
  for (const name of entries) {
    const dir = join(bundledFrameworksDir, name);
    if (!existsSync(join(dir, POLICY_BASELINE_FILE))) continue;
    const r = loadPolicyBaseline(dir);
    if (r.status === 'ok' && r.baseline.framework === baselineOf) return { dir, baseline: r.baseline };
  }
  return null;
}

/** Shipped policy ids of a shipped baseline (the `shippedPolicyIds` loader option). */
export function shippedPolicyIdsOf(shipped: ShippedPolicyBaseline | null): ReadonlySet<string> | undefined {
  return shipped ? new Set(shipped.baseline.policies.map((p) => p.id)) : undefined;
}

export interface PolicyBaselineDrift {
  copy_version: string;
  shipped_version: string;
  /** The copy's catalogue_version is lower than the shipped one. */
  stale: boolean;
  /** Shipped policy ids the copy does not have (new in the shipped baseline), in shipped order. */
  missing_shipped_ids: string[];
  /** CPB- ids in the copy that the shipped baseline no longer has. */
  removed_shipped_ids: string[];
  /** Shipped policy ids whose kind, category, control or params differ between copy and shipped. */
  differing_ids: string[];
}

/** Stable JSON of a value with sorted object keys (order-independent comparison). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Drift of a client copy against its shipped baseline (Design 123 section 7.4). */
export function policyBaselineDrift(copy: PolicyBaseline, shipped: PolicyBaseline): PolicyBaselineDrift {
  const copyById = new Map(copy.policies.map((p) => [p.id, p] as const));
  const shippedIds = new Set(shipped.policies.map((p) => p.id));
  const differing: string[] = [];
  for (const s of shipped.policies) {
    const c = copyById.get(s.id);
    if (!c) continue;
    if (c.kind !== s.kind || c.category !== s.category || c.control !== s.control || canonical(c.params) !== canonical(s.params)) differing.push(s.id);
  }
  return {
    copy_version: copy.catalogue_version,
    shipped_version: shipped.catalogue_version,
    stale: compareCatalogueVersions(copy.catalogue_version, shipped.catalogue_version) < 0,
    missing_shipped_ids: shipped.policies.filter((p) => !copyById.has(p.id)).map((p) => p.id),
    removed_shipped_ids: copy.policies.filter((p) => SHIPPED_POLICY_ID_PATTERN.test(p.id) && !shippedIds.has(p.id)).map((p) => p.id),
    differing_ids: differing,
  };
}

export interface PolicyBaselineFindings {
  /** Rule violations that fail the health check (none of the probe's own rules today; load errors come from the loader). */
  errors: string[];
  /** Messages without the framework prefix, for example "policy-baseline.yaml has 2 policies not reviewed ...". */
  warnings: string[];
  /** Policy ids with state not_set (D-10). */
  not_set: string[];
  /** Drift against the shipped baseline; null when SWAO ships no baseline named by baseline_of. */
  drift: PolicyBaselineDrift | null;
  /** Capability tags the baseline names that no resolved LZ catalogue uses (empty when `tagsInUse` is empty). */
  unused_tags: string[];
}

/**
 * The health-check rules over a loaded baseline (#3869, moved here by #4128
 * BC-01 so the MCP write path validates a candidate with the same rules,
 * Design 123 section 17.5.5): not_set policies, a stale copy with the shipped
 * ids it misses, a baseline_of SWAO does not ship, and capability tags no
 * resolved LZ catalogue uses. An empty `tagsInUse` means no vocabulary to
 * check against, so no unused-tag warning (the probe's own rule).
 */
export function policyBaselineFindings(
  doc: PolicyBaseline,
  shipped: ShippedPolicyBaseline | null,
  tagsInUse: readonly string[],
): PolicyBaselineFindings {
  const warnings: string[] = [];
  const notSet = doc.policies.filter((p) => p.state === 'not_set').map((p) => p.id);
  if (notSet.length > 0) {
    warnings.push(`policy-baseline.yaml has ${notSet.length} polic${notSet.length === 1 ? 'y' : 'ies'} not reviewed (state not_set, not evaluated until reviewed): ${notSet.join(', ')}`);
  }
  if (shipped === null && doc.baseline_of !== doc.framework) {
    warnings.push(`policy-baseline.yaml baseline_of ${doc.baseline_of} is not a baseline SWAO ships; staleness cannot be checked`);
  }
  const drift = shipped ? policyBaselineDrift(doc, shipped.baseline) : null;
  if (drift?.stale) {
    const missing = drift.missing_shipped_ids.length > 0 ? `; shipped policies missing from the copy: ${drift.missing_shipped_ids.join(', ')}` : '';
    warnings.push(`policy-baseline.yaml is stale (catalogue_version ${drift.copy_version} is lower than the shipped ${drift.shipped_version})${missing}; SWAO never updates the copy (Design 123 D-07, #4126): take the newer version from the GitHub repository by hand if you want it`);
  }
  const inUse = new Set(tagsInUse);
  const unused = inUse.size === 0 ? [] : policyBaselineCapabilityTags(doc).filter((t) => !inUse.has(t));
  if (unused.length > 0) {
    warnings.push(`policy-baseline.yaml names capability tags no resolved LZ catalogue uses: ${unused.join(', ')}`);
  }
  return { errors: [], warnings, not_set: notSet, drift, unused_tags: unused };
}

// ---------------------------------------------------------------------------
// Residency policies as the framework's sovereignty declaration (#3871,
// Design 123 sections 6.1 and 8.2: one source, the policies).
// ---------------------------------------------------------------------------

export interface PolicyBaselineSovereigntyRequirements {
  require_residency_country?: string[];
  require_operator_jurisdiction?: string[];
  forbid_exposure?: string[];
  require_certifications?: string[];
}

/** Union of the parameters of every enabled region_residency policy; undefined when none sets any. */
export function policyBaselineSovereigntyRequirements(doc: PolicyBaseline): PolicyBaselineSovereigntyRequirements | undefined {
  const countries = new Set<string>();
  const jurisdictions = new Set<string>();
  const exposure = new Set<string>();
  const certs = new Set<string>();
  for (const p of doc.policies) {
    if (p.state !== 'enabled' || p.kind !== 'region_residency') continue;
    for (const v of p.params.allowed_countries ?? []) countries.add(v);
    for (const v of p.params.allowed_operator_jurisdictions ?? []) jurisdictions.add(v);
    for (const v of p.params.forbid_exposure ?? []) exposure.add(v);
    for (const v of p.params.required_certifications ?? []) certs.add(v);
  }
  const out: PolicyBaselineSovereigntyRequirements = {
    ...(countries.size > 0 ? { require_residency_country: [...countries] } : {}),
    ...(jurisdictions.size > 0 ? { require_operator_jurisdiction: [...jurisdictions] } : {}),
    ...(exposure.size > 0 ? { forbid_exposure: [...exposure] } : {}),
    ...(certs.size > 0 ? { require_certifications: [...certs] } : {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}
