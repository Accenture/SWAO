// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3571: the LiveLzDriver contract (Design 120 section 7.1, Design 121
// section 6). One driver per catalogue provider; every driver talks to the CSP
// only through `ScopeCtx.http.fetch`, which the registry wraps with the
// read-only allow-list (http.ts) and, in development runs, the recorder
// (record.ts). Zod at every boundary (CLAUDE.md section 5.5): the driver
// descriptor is checked on registration, probe results on return.

import { z } from 'zod';
import {
  LzLiveReadOnlySchema,
  LZ_PROVIDER_ID_PATTERN,
  LZ_CREDENTIAL_FIELDS,
} from '@swao/core';
import type {
  LzLiveRegion,
  LzLiveService,
  LzLiveScan,
  LzLiveSource,
  LzLivePostureInput,
  LzLiveHierarchyNodeKind,
  LzLiveAttributes,
  LzLiveFactSource,
  LzCredentialField,
} from '@swao/core';

/** Same shape as `module-service-assessment/src/research/http.ts:24`. */
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export type LiveResponse = Awaited<ReturnType<FetchLike>>;

/**
 * A request a driver may send. GET and HEAD are always allowed; any other
 * method needs a rule whose `path` matches and whose `reason` says why the
 * call is read-only (for example the OTC token request or AWS
 * SimulatePrincipalPolicy, which are POSTs that change nothing).
 */
export const ReadAllowRuleSchema = z.object({
  method: z.enum(['POST']),
  path: z.instanceof(RegExp),
  reason: z.string().min(10),
}).strict();
export type ReadAllowRule = z.infer<typeof ReadAllowRuleSchema>;

const LzCredentialFieldSchema = z.enum(LZ_CREDENTIAL_FIELDS);

export const AuthMethodSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
  /** Vault fields `lz:<lz-id>:<scope-id>:<field>` this method needs. */
  required: z.array(LzCredentialFieldSchema),
  optional: z.array(LzCredentialFieldSchema).default([]),
  /** Usable in cron / CI (Design 120 section 7.1, Q-16). */
  unattended: z.boolean(),
}).strict();
export type AuthMethod = z.infer<typeof AuthMethodSchema>;

export const ReadOnlyProbeSchema = z.object({
  read_only: LzLiveReadOnlySchema,
  /** Display label of the identity (role or group name), never a secret. */
  identity: z.string().min(1),
  /** Why the result is refused or unverifiable; required for both. */
  reason: z.string().min(1).optional(),
  /** Write actions the credential was found to allow (refused only). */
  write_actions_allowed: z.array(z.string()).default([]),
  /** Same shape as LzLiveMeta.coverage (@swao/core lz-live-scan.ts). */
  coverage: z.object({
    readable: z.array(z.string()).default([]),
    unreadable: z.array(z.string()).default([]),
  }).strict(),
}).strict().superRefine((p, ctx) => {
  if (p.read_only !== 'verified' && p.reason === undefined) {
    ctx.addIssue({ code: 'custom', path: ['reason'], message: `a ${p.read_only} probe needs a reason` });
  }
});
export type ReadOnlyProbe = z.infer<typeof ReadOnlyProbeSchema>;

export interface ScopeCtx {
  lzId: string;
  provider: string;
  scopeId: string;
  scopeKind: 'platform' | 'application';
  auth: string;
  regions: string[];
  /** Scope locator from `.swao.yml` (project, subscription, account, ...). */
  target: Record<string, string>;
  /** Resolved vault fields of the scope; never logged, never written. */
  credentials: Partial<Record<LzCredentialField, string>>;
  http: {
    /** Read-only allow-list (and recorder) already applied. */
    fetch: FetchLike;
    /** Driver defaults merged with loopback overrides (endpoints.ts). */
    baseUrls: Record<string, string>;
  };
  /**
   * #3572: collection sources of this scope run (`LzLiveMeta.sources`). A
   * driver records a source it could only partly read here (for example the
   * price list behind a 5xx) and keeps going; a list method that cannot be
   * served at all throws `LiveSourceUnavailableError` instead (errors.ts).
   */
  sources: LzLiveSource[];
  /**
   * #3975 (Design 123 section 5.4): the landing zone's log archive scope
   * (`scopes[].purpose: log-archive`), present on every other scope of a
   * landing zone that registers one. `open()` builds its context once per
   * scope run, through the same read-only allow-list, recorder and read-only
   * gate as a scope of its own; it never throws: a login that is missing,
   * expired or refused by the gate comes back as `unavailable`.
   */
  logArchive?: LogArchiveRef;
  /**
   * #3975: true when this scope is itself the landing zone's log archive
   * (`scopes[].purpose: log-archive`). Its own S3 reads are the archive's
   * reads, so a trail bucket it cannot read is not retried through
   * `logArchive` (absent on this scope): the driver says whether the archive
   * lists the bucket at all (live 2026-11-09).
   */
  isLogArchive?: true;
}

/** #3975: why the log archive scope could not be used (never a secret). */
export type LogArchiveUnavailable = 'login_missing' | 'login_expired' | 'login_rejected' | 'read_only_refused' | 'read_only_unverifiable' | 'not_opened';

export interface LogArchiveRef {
  scopeId: string;
  open(): Promise<{ ctx: ScopeCtx } | { unavailable: LogArchiveUnavailable }>;
  /**
   * #4091 (Design 120 section 6.3): the archive's read-only gate as it was
   * applied, once `open()` has settled; undefined while the archive was never
   * opened. The reading scope stamps it into its run record (scan.ts).
   */
  outcome(): LogArchiveOutcome | undefined;
}

/** #4091: the log archive's gate result (no probe reason, no native id). */
export type LogArchiveOutcome =
  | { opened: true; read_only: ReadOnlyProbe['read_only']; read_only_overrides: readonly string[]; read_only_reason?: string }
  | { opened: false; unavailable: LogArchiveUnavailable; read_only?: ReadOnlyProbe['read_only'] };

export interface ActivityWindow {
  days: number;
}

type Estate = LzLiveScan['estate'];

/** #3880: one node as a driver returns it, with the native name (never stored). */
export interface DriverHierarchyNode {
  id: string;
  kind: LzLiveHierarchyNodeKind;
  native_kind?: string;
  parent?: string;
  /** Native display name; pseudonymised at the scan boundary, never written. */
  name?: string;
  status?: 'observed' | 'unknown';
  /** Returned properties; the scan boundary passes them through filterAttributes (#3886). */
  attributes?: LzLiveAttributes;
  policy_refs?: string[];
}

/** #3880: the tenant structure a driver returns (`listHierarchy`). */
export interface DriverHierarchy {
  nodes: DriverHierarchyNode[];
  source: Omit<LzLiveFactSource, 'partial' | 'status'> & Partial<Pick<LzLiveFactSource, 'partial' | 'status'>>;
  scope_node?: string;
  resource_nodes?: Record<string, string>;
}

export interface LiveLzDriver {
  /** Catalogue provider id (otc, aws, azure, stackit). */
  provider: string;
  driverVersion: string;
  authMethods: AuthMethod[];
  /** Default base URL per API id; overridable for loopback hosts only. */
  defaultBaseUrls: Record<string, string>;
  /** Non-GET/HEAD requests the driver may send (empty for most drivers). */
  readAllowList: ReadAllowRule[];
  /** Route templates for the recorder, e.g. `/v3/projects/{project_id}`. */
  routeTemplates?: string[];
  /**
   * #3995: route key prefix per API host, for two APIs whose paths collide on
   * different hosts (STACKIT SQL Server Flex and PostgreSQL Flex v3). The
   * route key of a request to a listed host is the prefix plus its path
   * (`routePathOf`, record.ts); the templates of that API carry the prefix and
   * the mock pack serves the API under it. Never changes the request sent.
   */
  routeHostPrefixes?: Readonly<Record<string, string>>;
  /**
   * #3716: region of one request for the recorder (`requests.ndjson`
   * `region`), from the URL and the request headers the driver sent; null
   * when the request has no region. Only the region is recorded, never a
   * header value.
   */
  regionOf?(url: string, init?: { headers?: Record<string, string> }): string | null;
  probeReadOnly(ctx: ScopeCtx): Promise<ReadOnlyProbe>;
  listRegions(ctx: ScopeCtx): Promise<LzLiveRegion[]>;
  listServices(ctx: ScopeCtx, region: string): Promise<LzLiveService[]>;
  listGuardrails(ctx: ScopeCtx): Promise<Estate['guardrails']>;
  listResources(ctx: ScopeCtx): Promise<Estate['resources']>;
  /**
   * #3970 (Design 123 section 5.4): optional inventory of managed services
   * that `listResources` does not list (STACKIT object storage, Flex
   * databases, file storage, CDN). Appended to `estate.resources`; a separate
   * collector, so a replay of a recording that predates these reads omits it
   * (`omitLzCollectors`).
   */
  listServiceResources?(ctx: ScopeCtx): Promise<Estate['resources']>;
  /**
   * #3970: `listPosture` without the reads of `listServiceResources`;
   * `omitLzCollectors(['listServiceResources'])` puts it in place of
   * `listPosture`, so a recording that predates those reads replays alike.
   */
  listPostureWithoutServiceResources?(ctx: ScopeCtx): Promise<LzLivePostureInput>;
  listQuotas(ctx: ScopeCtx, region: string): Promise<Estate['quotas']>;
  listActivity(ctx: ScopeCtx, window: ActivityWindow): Promise<NonNullable<Estate['activity_summary']>>;
  /** #3572: takes the scope context so the price call passes the allow-list,
   *  the endpoint seam and the recorder like every other request. */
  listPrices?(ctx: ScopeCtx, region: string): Promise<unknown[]>;
  /**
   * #3864 (Design 123 sections 5.4, 9.1): optional posture collector. A block
   * the driver did not read is left out; a denied read is a block with
   * `source.status: not_collected`. The scan assembler validates the result
   * against `LzLivePostureSchema` and applies the privacy filter.
   */
  listPosture?(ctx: ScopeCtx): Promise<LzLivePostureInput>;
  /**
   * #3880 (Design 123 section 5.6): optional tenant structure of the scope.
   * Nodes carry the native `name`; the scan assembler replaces it by the
   * pseudonym label and validates the tree (live/hierarchy.ts).
   */
  listHierarchy?(ctx: ScopeCtx): Promise<DriverHierarchy>;
  /**
   * #3572 (Q-21): `true` only after a live run has verified the driver. The
   * CLI registers a driver with `false` only when the operator names it in
   * `SWAO_LZ_UNVERIFIED_DRIVERS` (builtin.ts), so a release build never
   * carries a driver whose only evidence is mock runs.
   */
  liveVerified?: boolean;
}

const fn = z.custom<(...args: unknown[]) => unknown>((v) => typeof v === 'function', { message: 'must be a function' });

/** Checked by registerLiveLzDriver (registry.ts). */
export const LiveLzDriverDescriptorSchema = z.object({
  provider: z.string().regex(LZ_PROVIDER_ID_PATTERN),
  driverVersion: z.string().min(1),
  authMethods: z.array(AuthMethodSchema).min(1),
  defaultBaseUrls: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.string().url().refine((u) => u.startsWith('https://'), { message: 'driver base URLs must be https' })),
  readAllowList: z.array(ReadAllowRuleSchema),
  routeTemplates: z.array(z.string().startsWith('/')).optional(),
  routeHostPrefixes: z.record(z.string().regex(/^[a-z0-9.-]+$/), z.string().regex(/^\/[a-z0-9-]+$/)).optional(),
  regionOf: fn.optional(),
  probeReadOnly: fn,
  listRegions: fn,
  listServices: fn,
  listGuardrails: fn,
  listResources: fn,
  listServiceResources: fn.optional(),
  listPostureWithoutServiceResources: fn.optional(),
  listQuotas: fn,
  listActivity: fn,
  listPrices: fn.optional(),
  listPosture: fn.optional(),
  listHierarchy: fn.optional(),
  liveVerified: z.boolean().optional(),
}).passthrough();
