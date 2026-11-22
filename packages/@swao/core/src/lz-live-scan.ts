// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library -- landing zone live scan (Design 120 section 7.3)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { z } from 'zod';
import {
  LzGuardrailSchema,
  LzScanResultSchema,
  type LzEnabledService,
  type LzScanResult,
} from './lz-scan-result.js';
import { LzServiceIacSchema } from './lz-service-catalogue.js';

/**
 * `LzLiveScan` (Design 120 section 7.3, #3565): the output contract of one
 * read-only live crawl of one landing-zone scope. It carries every field of
 * `LzScanResultSchema` (Layer B), fixed to `collection_mode: live` and
 * `confidence: observed`, plus four additive blocks:
 *
 * - `meta`     provenance of the scope run (read-only probe, coverage, sources)
 * - `offering` what the CSP offers to this scope, per region, with evidence
 * - `estate`   what is deployed and happening in this scope
 * - `diff`     changes against the previous run of the same scope
 *
 * The base fields are derived from the blocks by `deriveLzScanBaseFields`, so
 * `computeLzFit` consumes a live scan through `projectLzLiveScan` unchanged.
 * Offering and estate stay separate products (Design 120 section 5.1).
 */

/** Live status per (scope, region, service) (Design 120 section 5.3). Tenant
 *  state, not the catalogue lifecycle `status` (ga / preview / ...). */
export const LZ_LIVE_STATUSES = ['enabled', 'available_not_enabled', 'restricted', 'not_offered', 'unknown'] as const;
export const LzLiveStatusSchema = z.enum(LZ_LIVE_STATUSES);
export type LzLiveStatus = z.infer<typeof LzLiveStatusSchema>;

/** Where a status was observed (Design 120 section 5.3). */
export const LzLiveEvidenceSchema = z.object({
  source: z.enum(['api', 'inventory', 'price', 'policy']),
  /** Endpoint, resource id or policy id the evidence came from. */
  ref: z.string().min(1),
  http_status: z.number().int().min(100).max(599).optional(),
}).strict();
export type LzLiveEvidence = z.infer<typeof LzLiveEvidenceSchema>;

/** Status of one service in one region. `unknown` is a first-class result
 *  (ADR-0041) and must name the evidence that made the scope unable to tell,
 *  so an empty success is not representable. `restricted` needs `policy`
 *  evidence: a deny on SWAO's own read call is a permission gap and is recorded
 *  as `unknown`, never `restricted` (Design 120 section 5.3). */
export const LzLiveRegionStatusSchema = z.object({
  status: LzLiveStatusSchema,
  evidence: z.array(LzLiveEvidenceSchema).default([]),
  observed_at: z.string().min(1),
}).strict().superRefine((v, ctx) => {
  if (v.status === 'unknown' && v.evidence.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'status unknown requires at least one evidence entry (e.g. the HTTP 403 of the denied read)' });
  }
  if (v.status === 'restricted' && !v.evidence.some((e) => e.source === 'policy')) {
    ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'status restricted requires policy evidence; a denied read call is unknown, not restricted' });
  }
});
export type LzLiveRegionStatus = z.infer<typeof LzLiveRegionStatusSchema>;

/** Result of the least-privilege read-only probe (Design 120 section 6.3). */
export const LzLiveReadOnlySchema = z.enum(['verified', 'refused', 'unverifiable']);

/** Per-run operator overrides of the probe result (Design 120 section 6.3). */
export const LzLiveReadOnlyOverrideSchema = z.enum(['accept-unverified-read-only', 'accept-write-capable-credentials']);

/** One collection source of the crawl (an API family, the inventory, the price list). */
export const LzLiveSourceSchema = z.object({
  name: z.string().min(1),
  status: z.enum(['ok', 'not_collected']),
  http_status: z.number().int().min(100).max(599).optional(),
  /** Why a source was not collected, when there is no HTTP status (e.g. expired token). */
  reason: z.string().min(1).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.status === 'not_collected' && v.http_status === undefined && v.reason === undefined) {
    ctx.addIssue({ code: 'custom', path: ['status'], message: 'a not_collected source needs http_status or reason' });
  }
});
export type LzLiveSource = z.infer<typeof LzLiveSourceSchema>;

/**
 * #3596: what marked a scope run as simulated (Design 121 section 10, item 1).
 * `header`: a response carried `X-SWAO-Mock-CSP`; `token_claim`: a token
 * response carried the `swao_mock` claim; `endpoint_override`: an endpoint was
 * redirected to a loopback host (`SWAO_LZ_MOCK_ENDPOINTS`).
 */
export const LZ_LIVE_SIMULATION_EVIDENCE = ['header', 'token_claim', 'endpoint_override'] as const;
export const LzLiveSimulationEvidenceSchema = z.enum(LZ_LIVE_SIMULATION_EVIDENCE);
export type LzLiveSimulationEvidence = z.infer<typeof LzLiveSimulationEvidenceSchema>;

/** Mock fidelity tiers (Design 121 section 9.1). */
export const LZ_LIVE_SIMULATION_FIDELITIES = ['conformed', 'recorded', 'spec-derived'] as const;

/**
 * #3596: `meta.simulated` (Design 121 section 10, item 2). Present only when
 * the scope run was served by a mock CSP. Scenario and fidelity come from the
 * `X-SWAO-Mock-CSP: <provider>/<scenario>/<fidelity>` header; a run marked
 * only by the token claim or an endpoint override has neither.
 */
export const LzLiveSimulatedSchema = z.object({
  scenario: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/).optional(),
  fidelity: z.enum(LZ_LIVE_SIMULATION_FIDELITIES).optional(),
  evidence: z.array(LzLiveSimulationEvidenceSchema).min(1),
}).strict();
export type LzLiveSimulated = z.infer<typeof LzLiveSimulatedSchema>;

/** #3864: `meta.baseline` (Design 123 section 9.1): which baseline copy, at
 *  which catalogue version and content hash, a run was evaluated against. The
 *  hash is the same-baseline rule of the portfolio comparison (section 8.3). */
export const LzLiveBaselineRefSchema = z.object({
  /** `framework` of the evaluated `policy-baseline.yaml` (its framework-meta.yaml id,
   *  `PolicyBaselineSchema.framework`, #3862); the client may name its copy (D-09). */
  framework: z.string().min(1),
  /** `catalogue_version` of that file (semver, #3862). */
  catalogue_version: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
export type LzLiveBaselineRef = z.infer<typeof LzLiveBaselineRefSchema>;

export const LzLiveMetaSchema = z.object({
  lz_id: z.string().min(1),
  provider: z.string().min(1),
  scope_id: z.string().min(1),
  scope_kind: z.enum(['platform', 'application']),
  observed_at: z.string().min(1),
  driver_version: z.string().min(1),
  read_only: LzLiveReadOnlySchema,
  /** Overrides the operator passed for this run; stamped, never defaulted. */
  read_only_overrides: z.array(LzLiveReadOnlyOverrideSchema).default([]),
  /** Probe coverage: services the granted roles can and cannot read. */
  coverage: z.object({
    readable: z.array(z.string()).default([]),
    unreadable: z.array(z.string()).default([]),
  }).strict(),
  /** Community frameworks evaluated in this run (Design 120 section 8.1). */
  frameworks: z.array(z.object({
    id: z.string().min(1),
    version: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict()).default([]),
  sources: z.array(LzLiveSourceSchema).default([]),
  /** Detected landing-zone framework (Design 120 section 7.2), e.g. "aws-control-tower". */
  lz_framework: z.string().min(1).optional(),
  /** #3596: present when a mock CSP served this scope run (Design 121 section 10). */
  simulated: LzLiveSimulatedSchema.optional(),
  /** #3864: the client LZ policy baseline evaluated in this run (Design 123 section 9.1);
   *  absent when no baseline is selected. */
  baseline: LzLiveBaselineRefSchema.optional(),
}).strict();
export type LzLiveMeta = z.infer<typeof LzLiveMetaSchema>;

/** Light per (service, framework) (Design 120 section 8.3). */
export const LzLiveFrameworkResultSchema = z.object({
  light: z.enum(['red', 'amber', 'green', 'grey', 'n/a']),
  controls: z.array(z.string()).default([]),
  detail: z.string().optional(),
}).strict();

export const LzLivePriceSchema = z.object({
  region: z.string().min(1),
  unit: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
  sku: z.string().optional(),
}).strict();

export const LzLiveServiceSchema = z.object({
  /** Native service code as the CSP names it (e.g. "Microsoft.Compute", "ecs"). */
  code: z.string().min(1),
  name: z.string().min(1),
  /** SWAO capability tags (the catalogue `fulfills` vocabulary); empty = mapping gap. */
  capability_tags: z.array(z.string()).default([]),
  /** Join key to the LZ catalogue `LzServiceSchema.code`, when a mapping exists. */
  catalogue_code: z.string().min(1).optional(),
  regions: z.record(z.string(), LzLiveRegionStatusSchema),
  /** Terraform / OpenTofu automatability; the single IaC definition shared with
   *  LZ catalogue schema 0.2 (`LzServiceIacSchema`, #3566). */
  iac: LzServiceIacSchema.optional(),
  frameworks: z.record(z.string(), LzLiveFrameworkResultSchema).default({}),
  prices: z.array(LzLivePriceSchema).optional(),
}).strict();
export type LzLiveService = z.infer<typeof LzLiveServiceSchema>;

export const LzLiveRegionSchema = z.object({
  id: z.string().min(1),
  country: z.string().min(1).optional(),
  azs: z.array(z.object({ name: z.string().min(1), available: z.boolean() }).strict()).default([]),
  status: LzLiveStatusSchema,
}).strict();
export type LzLiveRegion = z.infer<typeof LzLiveRegionSchema>;

export const LzLiveOfferingSchema = z.object({
  regions: z.array(LzLiveRegionSchema).default([]),
  services: z.array(LzLiveServiceSchema).default([]),
}).strict();

// ---------------------------------------------------------------------------
// #3886 (Design 123 section 5.7, D-13): every returned property of a read call
// that has no normalised field is kept in an `attributes` map. Shared by
// resources, posture entries and hierarchy nodes. The map is flat: keys are
// dotted paths of the API document (`properties.encrypted`,
// `security_group_rules.0.direction`), values are scalars or arrays of
// scalars. The drivers build it with `flattenAttributes` and the scan
// assembler passes it through the one privacy filter `filterAttributes`
// (module-landing-zone live/privacy.ts) before the scan is stored.
// ---------------------------------------------------------------------------

/** Upper bound of entries per attributes map (`flattenAttributes` caps at it). */
export const LZ_LIVE_ATTRIBUTES_MAX = 256;

const LzLiveAttributeScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const LzLiveAttributeValueSchema = z.union([LzLiveAttributeScalarSchema, z.array(LzLiveAttributeScalarSchema)]);
export type LzLiveAttributeValue = z.infer<typeof LzLiveAttributeValueSchema>;

export const LzLiveAttributesSchema = z.record(z.string().min(1).max(256), LzLiveAttributeValueSchema)
  .refine((m) => Object.keys(m).length <= LZ_LIVE_ATTRIBUTES_MAX, { message: `an attributes map holds at most ${LZ_LIVE_ATTRIBUTES_MAX} entries` });
export type LzLiveAttributes = z.infer<typeof LzLiveAttributesSchema>;

export const LzLiveResourceSchema = z.object({
  /** Provider resource id; the dedup key of the scope merge (Design 120 section 11.1). */
  id: z.string().min(1),
  type: z.string().min(1),
  /** Native service code of the owning service (`LzLiveService.code`). */
  service_code: z.string().min(1).optional(),
  region: z.string().min(1).optional(),
  tags: z.record(z.string(), z.string()).optional(),
  created_at: z.string().optional(),
  /** #3886: the other returned properties, after the privacy filter (Design 123 section 5.7). */
  attributes: LzLiveAttributesSchema.optional(),
}).strict();

export const LzLiveWorkloadSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  resource_ids: z.array(z.string()).default([]),
}).strict();

export const LzLiveQuotaSchema = z.object({
  resource: z.string().min(1),
  region: z.string().min(1).optional(),
  limit: z.number().nonnegative().optional(),
  used: z.number().nonnegative().optional(),
  remaining: z.number().optional(),
}).strict();

/** Aggregated activity counts by default; the per-event feed is opt-in and
 *  never part of this artefact (Design 120 section 6.4, Q-12). */
export const LzLiveActivitySummarySchema = z.object({
  window_days: z.number().int().positive(),
  events_total: z.number().int().nonnegative(),
  by_kind: z.record(z.string(), z.number().int().nonnegative()).default({}),
}).strict();

/**
 * #3864: status of one live check (Design 123 sections 8.1, 9.1). `unverified`
 * is additive: the evidence to decide the check is missing (catalogue only,
 * not collected or not observable, Design 123 section 5.3). It never counts
 * as a pass (ADR-0041). Shared by the scan, the portfolio matrix and the
 * publication model, so the lists cannot drift.
 */
export const LZ_LIVE_CHECK_STATUSES = ['pass', 'fail', 'warn', 'na', 'unverified'] as const;
export const LzLiveCheckStatusSchema = z.enum(LZ_LIVE_CHECK_STATUSES);
export type LzLiveCheckStatus = z.infer<typeof LzLiveCheckStatusSchema>;

/**
 * #3864: how the evidence of a check was obtained (Design 123 section 5.3).
 * `observed`: the live scan has it; `catalogue`: only catalogue data answers
 * it; `not_collected`: a read-only collector could answer it but did not (or
 * the read was denied); `not_observable`: no read-only live API can answer it.
 */
export const LZ_LIVE_OBSERVABILITY = ['observed', 'catalogue', 'not_collected', 'not_observable'] as const;
export const LzLiveObservabilitySchema = z.enum(LZ_LIVE_OBSERVABILITY);
export type LzLiveObservability = z.infer<typeof LzLiveObservabilitySchema>;

export const LzLiveCheckSchema = z.object({
  /** Id from `controls/landing-zone-checks-catalogue.yaml` (Design 120 section 7.3)
   *  or a baseline policy id (Design 123 section 8.1). */
  id: z.string().min(1),
  title: z.string().min(1),
  controls: z.array(z.string()).default([]),
  status: LzLiveCheckStatusSchema,
  /** #3864 (Design 123 section 5.3): optional, so catalogue checks without it stay valid. */
  observability: LzLiveObservabilitySchema.optional(),
  detail: z.string().optional(),
  /** #3880: owning node in `estate.hierarchy` (Design 123 section 5.6), for the roll-up. */
  node_id: z.string().min(1).optional(),
}).strict().superRefine((v, ctx) => {
  // An unverified check must say why (like `unknown` must name its evidence).
  if (v.status === 'unverified' && (v.observability === undefined || v.observability === 'observed')) {
    ctx.addIssue({ code: 'custom', path: ['observability'], message: 'status unverified requires observability catalogue, not_collected or not_observable' });
  }
  // Evidence that was not observed cannot decide the estate (Design 123 section 5.3).
  if (v.observability !== undefined && v.observability !== 'observed' && (v.status === 'pass' || v.status === 'fail' || v.status === 'warn')) {
    ctx.addIssue({ code: 'custom', path: ['status'], message: `observability ${v.observability} cannot decide pass, fail or warn; use unverified or na` });
  }
});
export type LzLiveCheck = z.infer<typeof LzLiveCheckSchema>;

// ---------------------------------------------------------------------------
// #3864: estate.posture (Design 123 sections 5.4, 9.1)
// ---------------------------------------------------------------------------

/**
 * Where one posture block came from: the read calls that answered it,
 * whether the answer covers only part of the scope (for example the AWS
 * tagging API lists tagged resources only, D-15), and `not_collected` with
 * the HTTP status or a reason when the read was denied or failed. A block
 * that is absent was not collected at all; a block with `status: ok` and no
 * items was read and is empty. Reused by `estate.hierarchy` (#3880).
 */
export const LzLiveFactSourceSchema = z.object({
  calls: z.array(z.string().min(1)).min(1),
  partial: z.boolean().default(false),
  status: z.enum(['ok', 'not_collected']).default('ok'),
  http_status: z.number().int().min(100).max(599).optional(),
  reason: z.string().min(1).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.status === 'not_collected' && v.http_status === undefined && v.reason === undefined) {
    ctx.addIssue({ code: 'custom', path: ['status'], message: 'a not_collected posture source needs http_status or reason' });
  }
});
export type LzLiveFactSource = z.infer<typeof LzLiveFactSourceSchema>;

export const LZ_LIVE_KEY_CUSTODY = ['provider-managed', 'customer-managed', 'byok', 'hyok'] as const;
export const LZ_LIVE_TLS_VERSIONS = ['1.0', '1.1', '1.2', '1.3'] as const;

/** Fields shared by the per-resource posture entries. `resource_id` is the
 *  provider id, the same key as `estate.resources[].id`, so an evaluator
 *  joins type, region and tags; it stays in the scan and is pseudonymised
 *  wherever a result leaves it (check `detail`, publications; Design 123
 *  sections 8.1, 9.1, 12). */
const postureResourceShape = {
  resource_id: z.string().min(1),
  type: z.string().min(1).optional(),
  service_code: z.string().min(1).optional(),
  region: z.string().min(1).optional(),
  attributes: LzLiveAttributesSchema.optional(),
};

/** `encryption_at_rest` and `encryption_in_transit` evidence. An absent
 *  `encrypted` means the read did not tell. */
export const LzLiveEncryptionFactSchema = z.object({
  ...postureResourceShape,
  layer: z.enum(['at_rest', 'in_transit']),
  encrypted: z.boolean().optional(),
  key_custody: z.enum(LZ_LIVE_KEY_CUSTODY).optional(),
  /** Provider id of the key (KMS key id or ARN). */
  key_id: z.string().min(1).optional(),
  min_tls_version: z.enum(LZ_LIVE_TLS_VERSIONS).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.layer === 'in_transit' && (v.key_custody !== undefined || v.key_id !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['key_custody'], message: 'key custody belongs to at_rest encryption' });
  }
  if (v.layer === 'at_rest' && v.min_tls_version !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['min_tls_version'], message: 'a TLS floor belongs to in_transit encryption' });
  }
});

/** `no_public_exposure` evidence: a public address, endpoint or storage. */
export const LzLiveExposureFactSchema = z.object({
  ...postureResourceShape,
  exposure: z.enum(['public_ip', 'internet_endpoint', 'public_storage', 'other']),
  public: z.boolean(),
  /** Resource the public address is bound to, when it is bound. */
  bound_to: z.string().min(1).optional(),
}).strict();

/** `no_open_admin_ingress` evidence: one inbound rule of a security group or
 *  firewall. `resource_id` is the security group. */
export const LzLiveIngressRuleSchema = z.object({
  ...postureResourceShape,
  protocol: z.string().min(1),
  port_from: z.number().int().min(0).max(65535).optional(),
  port_to: z.number().int().min(0).max(65535).optional(),
  /** Remote CIDR (for example `0.0.0.0/0`); absent when the rule names a group. */
  remote_cidr: z.string().min(1).optional(),
  remote_group_id: z.string().min(1).optional(),
  action: z.enum(['allow', 'deny']).default('allow'),
}).strict().superRefine((v, ctx) => {
  if (v.port_from !== undefined && v.port_to !== undefined && v.port_from > v.port_to) {
    ctx.addIssue({ code: 'custom', path: ['port_to'], message: 'port_to must not be below port_from' });
  }
});

/** `backup_configured` evidence per stateful resource. */
export const LzLiveBackupFactSchema = z.object({
  ...postureResourceShape,
  protected: z.boolean(),
  policy_id: z.string().min(1).optional(),
  retention_days: z.number().int().nonnegative().optional(),
}).strict();

export const LZ_LIVE_BUDGET_PERIODS = ['daily', 'monthly', 'quarterly', 'annually', 'custom'] as const;

/**
 * #3936: `budget_alerts` evidence, one entry per budget of the scope
 * (Design 123 sections 5.4, 9.1). Provider-neutral: AWS Budgets and Azure
 * Consumption budgets map onto it (field mapping in Design 123 section 5.4).
 * Recipients are counted per alert, never named: no address, e-mail, topic or
 * group id (Design 120 section 6.4). `resource_id` is the provider id of the
 * budget (AWS budget ARN, Azure budget resource id); `scope` the account,
 * subscription or resource group it covers.
 */
export const LzLiveBudgetFactSchema = z.object({
  resource_id: z.string().min(1),
  type: z.string().min(1).optional(),
  scope: z.string().min(1).optional(),
  /** What the budget limits: spend (`cost`), usage units (`usage`), or a coverage or utilisation target (`other`). */
  budget_kind: z.enum(['cost', 'usage', 'other']).default('cost'),
  amount: z.number().nonnegative().optional(),
  /** Unit of `amount`: an ISO 4217 currency for cost budgets, the usage unit otherwise. */
  currency: z.string().min(1).max(32).optional(),
  period: z.enum(LZ_LIVE_BUDGET_PERIODS).optional(),
  alerts: z.array(z.object({
    threshold: z.number().nonnegative(),
    threshold_type: z.enum(['percentage', 'absolute']),
    /** Spend so far (`actual`) or the forecast for the period (`forecasted`). */
    basis: z.enum(['actual', 'forecasted']),
    /** Number of recipients (addresses, topics, groups, roles); absent when not read. */
    recipients: z.number().int().nonnegative().optional(),
    enabled: z.boolean().optional(),
  }).strict()).default([]),
  attributes: LzLiveAttributesSchema.optional(),
}).strict();

/** `privileged_mfa` and `credential_age` evidence. Counts and ages only:
 *  no principal names or ids (Design 120 section 6.4). */
export const LzLiveIdentityPostureSchema = z.object({
  source: LzLiveFactSourceSchema,
  mfa_required_for_privileged: z.boolean().optional(),
  privileged_principals: z.number().int().nonnegative().optional(),
  privileged_without_mfa: z.number().int().nonnegative().optional(),
  credentials: z.array(z.object({
    kind: z.enum(['access_key', 'password', 'api_key', 'service_account_key']),
    active: z.boolean(),
    age_days: z.number().int().nonnegative(),
  }).strict()).default([]),
  attributes: LzLiveAttributesSchema.optional(),
}).strict();

/** `audit_trail` and `log_retention` evidence: one entry per trail. */
export const LzLiveLoggingPostureSchema = z.object({
  source: LzLiveFactSourceSchema,
  trails: z.array(z.object({
    resource_id: z.string().min(1).optional(),
    region: z.string().min(1).optional(),
    all_regions: z.boolean().optional(),
    enabled: z.boolean(),
    retention_days: z.number().int().nonnegative().optional(),
    attributes: LzLiveAttributesSchema.optional(),
  }).strict()).default([]),
}).strict();

const postureList = <T extends z.ZodType>(item: T) => z.object({
  source: LzLiveFactSourceSchema,
  items: z.array(item).default([]),
}).strict();

export const LzLivePostureSchema = z.object({
  encryption: postureList(LzLiveEncryptionFactSchema).optional(),
  exposure: postureList(LzLiveExposureFactSchema).optional(),
  ingress_rules: postureList(LzLiveIngressRuleSchema).optional(),
  identity: LzLiveIdentityPostureSchema.optional(),
  logging: LzLiveLoggingPostureSchema.optional(),
  backup: postureList(LzLiveBackupFactSchema).optional(),
  /** #3936: `budget_alerts` evidence. */
  budgets: postureList(LzLiveBudgetFactSchema).optional(),
}).strict();
export type LzLivePosture = z.infer<typeof LzLivePostureSchema>;
export type LzLivePostureInput = z.input<typeof LzLivePostureSchema>;

/** Posture blocks in a fixed order (merge, diff, privacy filter). */
export const LZ_LIVE_POSTURE_BLOCKS = ['encryption', 'exposure', 'ingress_rules', 'identity', 'logging', 'backup', 'budgets'] as const;
export type LzLivePostureBlock = (typeof LZ_LIVE_POSTURE_BLOCKS)[number];

type PostureListBlock = 'encryption' | 'exposure' | 'ingress_rules' | 'backup' | 'budgets';
type PostureItem<B extends PostureListBlock> = NonNullable<LzLivePosture[B]>['items'][number];

/**
 * #3864: identity of one posture entry inside its block, for the scope merge
 * and the run diff: the resource id plus what makes two entries of the same
 * resource different (encryption layer, exposure kind, the whole ingress rule).
 */
export function lzLivePostureEntryKey(block: PostureListBlock, item: PostureItem<PostureListBlock>): string {
  switch (block) {
    case 'encryption': {
      const e = item as PostureItem<'encryption'>;
      return `${e.resource_id}#${e.layer}`;
    }
    case 'exposure': {
      const e = item as PostureItem<'exposure'>;
      return `${e.resource_id}#${e.exposure}`;
    }
    case 'ingress_rules': {
      const r = item as PostureItem<'ingress_rules'>;
      return [r.resource_id, r.protocol, `${r.port_from ?? '*'}-${r.port_to ?? '*'}`, r.remote_cidr ?? '', r.remote_group_id ?? '', r.action].join('#');
    }
    case 'backup':
      return (item as PostureItem<'backup'>).resource_id;
    case 'budgets':
      return (item as PostureItem<'budgets'>).resource_id;
    default: {
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// #3880: estate.hierarchy, the tenant structure (Design 123 section 5.6, D-13)
// ---------------------------------------------------------------------------

/** Normalised node kinds; the CSP term is kept in `native_kind`. */
export const LZ_LIVE_HIERARCHY_NODE_KINDS = [
  'organisation', 'root', 'folder', 'organisational_unit', 'management_group',
  'account', 'subscription', 'project', 'resource_group', 'region',
] as const;
export const LzLiveHierarchyNodeKindSchema = z.enum(LZ_LIVE_HIERARCHY_NODE_KINDS);
export type LzLiveHierarchyNodeKind = z.infer<typeof LzLiveHierarchyNodeKindSchema>;

/** A pseudonymised node name (Design 120 section 6.4): `Node-<10 hex>`, an
 *  HMAC of the native name keyed by the landing zone salt. A native name
 *  cannot pass this pattern. */
export const LZ_LIVE_NODE_LABEL_PATTERN = /^Node-[0-9a-f]{10}$/;

/**
 * One node of the tenant tree. `id` is the native id; it stays in the scan
 * and never reaches a publication (Design 123 section 12). `status: unknown`
 * is a node the scope could not read (Design 120 section 5.2): it carries
 * `id` and `kind` only (plus `native_kind`), never a guessed parent, label,
 * attribute or policy.
 */
export const LzLiveHierarchyNodeSchema = z.object({
  id: z.string().min(1),
  kind: LzLiveHierarchyNodeKindSchema,
  /** CSP term for the report legend, for example `aws:ou`. */
  native_kind: z.string().min(1).optional(),
  parent: z.string().min(1).optional(),
  label: z.string().regex(LZ_LIVE_NODE_LABEL_PATTERN, 'label must be a pseudonym Node-<10 hex>, never a native name').optional(),
  status: z.enum(['observed', 'unknown']).default('observed'),
  attributes: LzLiveAttributesSchema.optional(),
  /** Native ids of the guardrails attached to this node (`estate.guardrails[].id`). */
  policy_refs: z.array(z.string().min(1)).default([]),
}).strict().superRefine((v, ctx) => {
  if (v.status === 'unknown' && (v.parent !== undefined || v.label !== undefined || v.attributes !== undefined || v.policy_refs.length > 0)) {
    ctx.addIssue({ code: 'custom', path: ['status'], message: 'an unknown node carries id and kind only; parent, label, attributes and policy_refs are never guessed' });
  }
  if (v.parent === v.id) ctx.addIssue({ code: 'custom', path: ['parent'], message: 'a node cannot be its own parent' });
});
export type LzLiveHierarchyNode = z.infer<typeof LzLiveHierarchyNodeSchema>;

/**
 * Tree rules of a node list: ids are unique, every parent is a node of the
 * list, and no parent chain returns to itself. The list is then a forest in
 * which every tree has exactly one root (a node without parent). Returns
 * the problems found; an empty list is valid.
 */
export function lzLiveHierarchyProblems(nodes: readonly Pick<LzLiveHierarchyNode, 'id' | 'parent'>[]): string[] {
  const problems: string[] = [];
  const parentOf = new Map<string, string | undefined>();
  for (const n of nodes) {
    if (parentOf.has(n.id)) problems.push(`duplicate node id ${n.id}`);
    parentOf.set(n.id, n.parent);
  }
  for (const n of nodes) if (n.parent !== undefined && !parentOf.has(n.parent)) problems.push(`node ${n.id}: parent ${n.parent} is not a node`);
  const reported = new Set<string>();
  for (const n of nodes) {
    const seen = new Set<string>([n.id]);
    let cur = parentOf.get(n.id);
    while (cur !== undefined && parentOf.has(cur)) {
      if (seen.has(cur)) {
        if (!reported.has(cur)) { problems.push(`cycle through node ${cur}`); for (const s of seen) reported.add(s); }
        break;
      }
      seen.add(cur);
      cur = parentOf.get(cur);
    }
  }
  return problems;
}

/** Ids of the tree roots, in list order. */
export function lzLiveHierarchyRoots(nodes: readonly Pick<LzLiveHierarchyNode, 'id' | 'parent'>[]): string[] {
  return nodes.filter((n) => n.parent === undefined).map((n) => n.id);
}

const hierarchyRefine = (v: { nodes: readonly LzLiveHierarchyNode[]; resource_nodes: Record<string, string> }, ctx: z.RefinementCtx): void => {
  for (const p of lzLiveHierarchyProblems(v.nodes)) ctx.addIssue({ code: 'custom', path: ['nodes'], message: p });
  const ids = new Set(v.nodes.map((n) => n.id));
  for (const [res, node] of Object.entries(v.resource_nodes)) {
    if (!ids.has(node)) ctx.addIssue({ code: 'custom', path: ['resource_nodes', res], message: `owning node ${node} is not a node` });
  }
};

const hierarchyShape = {
  nodes: z.array(LzLiveHierarchyNodeSchema).default([]),
  source: LzLiveFactSourceSchema,
  /** Owning node per resource id (`estate.resources[].id`); a resource
   *  without an entry belongs to `scope_node`. */
  resource_nodes: z.record(z.string(), z.string().min(1)).default({}),
};

/** `estate.hierarchy` of one scope: the part of the tree the scope can see. */
export const LzLiveHierarchySchema = z.object({
  ...hierarchyShape,
  /** Node of the scope itself (its account, subscription or project). */
  scope_node: z.string().min(1).optional(),
}).strict().superRefine((v, ctx) => {
  hierarchyRefine(v, ctx);
  if (v.scope_node !== undefined && !v.nodes.some((n) => n.id === v.scope_node)) {
    ctx.addIssue({ code: 'custom', path: ['scope_node'], message: `scope_node ${v.scope_node} is not a node` });
  }
});
export type LzLiveHierarchy = z.infer<typeof LzLiveHierarchySchema>;
export type LzLiveHierarchyInput = z.input<typeof LzLiveHierarchySchema>;

/** The merged tree of one landing zone (Design 120 section 11.1, Design 123
 *  section 5.6): nodes unioned by id; `scope_nodes` names each scope's node. */
export const LzLiveMergedHierarchySchema = z.object({
  ...hierarchyShape,
  scope_nodes: z.record(z.string(), z.string().min(1)).default({}),
}).strict().superRefine((v, ctx) => {
  hierarchyRefine(v, ctx);
  const ids = new Set(v.nodes.map((n) => n.id));
  for (const [scope, node] of Object.entries(v.scope_nodes)) {
    if (!ids.has(node)) ctx.addIssue({ code: 'custom', path: ['scope_nodes', scope], message: `scope node ${node} is not a node` });
  }
});
export type LzLiveMergedHierarchy = z.infer<typeof LzLiveMergedHierarchySchema>;

export const LzLiveEstateSchema = z.object({
  resources: z.array(LzLiveResourceSchema).default([]),
  workloads: z.array(LzLiveWorkloadSchema).default([]),
  guardrails: z.array(LzGuardrailSchema).default([]),
  quotas: z.array(LzLiveQuotaSchema).default([]),
  activity_summary: LzLiveActivitySummarySchema.optional(),
  checks: z.array(LzLiveCheckSchema).default([]),
  /** #3864: optional; absent when the driver collects no posture (Design 123 section 9.1). */
  posture: LzLivePostureSchema.optional(),
  /** #3880: optional; absent when the driver lists no tenant structure (Design 123 section 5.6). */
  hierarchy: LzLiveHierarchySchema.optional(),
}).strict().superRefine((v, ctx) => {
  // #3880: a policy result attached to a node names a node of this scan.
  const ids = new Set((v.hierarchy?.nodes ?? []).map((n) => n.id));
  v.checks.forEach((c, i) => {
    if (c.node_id !== undefined && !ids.has(c.node_id)) ctx.addIssue({ code: 'custom', path: ['checks', i, 'node_id'], message: `node ${c.node_id} is not in estate.hierarchy` });
  });
});

const LzLiveRefSchema = z.object({
  kind: z.enum(['region', 'service', 'resource']),
  ref: z.string().min(1),
}).strict();

export const LzLiveDiffSchema = z.object({
  /** Timestamp of the run this scan is compared with; absent for a first run. */
  previous_run: z.string().min(1).optional(),
  new: z.array(LzLiveRefSchema).default([]),
  removed: z.array(LzLiveRefSchema).default([]),
  status_changes: z.array(z.object({
    service: z.string().min(1),
    region: z.string().min(1),
    from: LzLiveStatusSchema,
    to: LzLiveStatusSchema,
  }).strict()).default([]),
  /** #3864: posture entries added, removed or changed against the previous
   *  run; present only when either run carries `estate.posture`, so scans
   *  without posture keep their exact shape. `ref` is the entry key (the
   *  provider resource id for per-resource blocks, the block name for
   *  `identity` and `logging`); readers report counts, never refs. */
  posture_changes: z.array(z.object({
    block: z.enum(LZ_LIVE_POSTURE_BLOCKS),
    change: z.enum(['new', 'removed', 'changed']),
    ref: z.string().min(1),
  }).strict()).optional(),
  /** #3880: hierarchy nodes added, removed or moved (parent changed) against
   *  the previous run; present only when either run carries
   *  `estate.hierarchy`. `ref` is the native node id; readers report counts. */
  hierarchy_changes: z.array(z.object({
    change: z.enum(['new', 'removed', 'moved']),
    ref: z.string().min(1),
  }).strict()).optional(),
}).strict();

export const LzLiveScanSchema = LzScanResultSchema.extend({
  collection_mode: z.literal('live'),
  confidence: z.literal('observed'),
  meta: LzLiveMetaSchema,
  offering: LzLiveOfferingSchema,
  estate: LzLiveEstateSchema,
  diff: LzLiveDiffSchema.default({ new: [], removed: [], status_changes: [] }),
}).strict();
export type LzLiveScan = z.infer<typeof LzLiveScanSchema>;
export type LzLiveScanInput = z.input<typeof LzLiveScanSchema>;

export function parseLzLiveScan(raw: unknown): LzLiveScan {
  return LzLiveScanSchema.parse(raw);
}

/**
 * Derive the Layer B base fields from the live blocks (Design 120 section 7.3,
 * "Projection onto the base schema"):
 * - `regions`: ids of offering regions with status `enabled`;
 * - `enabled_services`: services enabled in at least one region, keyed by the
 *   catalogue code when mapped, `fulfills` = capability tags, `provisioned`
 *   when the estate holds a resource of that service;
 * - `guardrails`, `lz_framework` from estate and meta; `quotas` as
 *   `{resource, remaining}`.
 */
export function deriveLzScanBaseFields(parts: {
  meta: LzLiveMeta;
  offering: z.infer<typeof LzLiveOfferingSchema>;
  estate: z.infer<typeof LzLiveEstateSchema>;
}): Pick<LzScanResult, 'provider' | 'scanned_at' | 'regions' | 'enabled_services' | 'guardrails' | 'quotas' | 'lz_framework' | 'provenance'> {
  const { meta, offering, estate } = parts;
  const countByService = new Map<string, number>();
  for (const r of estate.resources) {
    if (r.service_code) countByService.set(r.service_code, (countByService.get(r.service_code) ?? 0) + 1);
  }
  const enabled_services: LzEnabledService[] = offering.services
    .filter((s) => Object.values(s.regions).some((r) => r.status === 'enabled'))
    .map((s) => {
      const count = countByService.get(s.code) ?? 0;
      return {
        code: s.catalogue_code ?? s.code,
        provisioned: count > 0,
        fulfills: [...s.capability_tags],
        ...(count > 0 ? { count } : {}),
        status: 'enabled',
      };
    });
  return {
    provider: meta.provider,
    scanned_at: meta.observed_at,
    regions: offering.regions.filter((r) => r.status === 'enabled').map((r) => r.id),
    enabled_services,
    guardrails: estate.guardrails,
    quotas: estate.quotas.map((q) => ({ resource: q.resource, ...(q.remaining !== undefined ? { remaining: q.remaining } : {}) })),
    ...(meta.lz_framework ? { lz_framework: meta.lz_framework } : {}),
    provenance: { source: `live:${meta.lz_id}/${meta.scope_id}` },
  };
}

/**
 * Order in which observed statuses resolve when several services in one region
 * fulfil the same capability tag (#3609): the best achievable outcome wins, so
 * one usable service is enough. `unknown` ranks above `restricted` and
 * `not_offered` because the scope could not rule the capability out; between
 * the two definite negatives, `restricted` (offered, denied) is the more
 * specific finding.
 */
export const LZ_LIVE_STATUS_PRECEDENCE: readonly LzLiveStatus[] = [
  'enabled', 'available_not_enabled', 'unknown', 'restricted', 'not_offered',
];

/**
 * Observed live status per capability tag in one region (Design 120 section
 * 5.3, #3609), for the fit engine. A capability without any observation in the
 * region is absent from the map, so the caller falls back to the static
 * catalogue only there. Services without capability tags (mapping gap) do not
 * contribute.
 */
export function lzLiveStatusesForRegion(
  offering: Pick<z.infer<typeof LzLiveOfferingSchema>, 'services'>,
  regionId: string,
): Map<string, LzLiveStatus> {
  const rank = (s: LzLiveStatus): number => LZ_LIVE_STATUS_PRECEDENCE.indexOf(s);
  const out = new Map<string, LzLiveStatus>();
  for (const svc of offering.services) {
    const observed = svc.regions[regionId];
    if (!observed) continue;
    for (const tag of svc.capability_tags) {
      const current = out.get(tag);
      if (current === undefined || rank(observed.status) < rank(current)) out.set(tag, observed.status);
    }
  }
  return out;
}

/** Project a live scan onto `LzScanResultSchema` so the fit engine
 *  (`computeLzFit`) consumes it unchanged. The result is validated. */
export function projectLzLiveScan(scan: LzLiveScan): LzScanResult {
  return LzScanResultSchema.parse({
    ...deriveLzScanBaseFields(scan),
    collection_mode: 'live',
    confidence: 'observed',
  });
}
