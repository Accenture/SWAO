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

// #3576: the `stackit` live driver (Design 120 sections 6.3, 6.4, 7.1 to 7.5).
// Owner decision 2026-11-03: live first on the STACKIT test project (live
// access exists), like `otc`; the mock pack (#3601) is built from the
// recordings afterwards. Wire formats only from the published OpenAPI in
// stackitcloud/stackit-api-specifications (services/service-enablement/v2,
// authorization/v2, iaas/v2) and the live recordings.
// Every request goes through `ctx.http.fetch` (read-only allow-list, endpoint
// seam, recorder).
//
// Status rules per (region, service), Design 120 section 5.3, from the
// Service Enablement list `GET /v2/projects/{project_id}/regions/{region}/services`
// (`items[{serviceId, state: ENABLED|ENABLING|DISABLED|DISABLING}]`, paged by
// `nextCursor` / `?cursor=`):
// - ENABLED -> `enabled`; DISABLED -> `available_not_enabled` (the API lists
//   it for this project and region); ENABLING / DISABLING -> `unknown`
// - the list itself refused (401 / 403 / 5xx) -> every catalogue service
//   `unknown` with the HTTP status (a denied read is never `restricted`)
// - a catalogue service that the collected list does not name -> `unknown`:
//   with a known serviceId (`STACKIT_SERVICE_IDS`) the evidence says
//   `not-listed` (global services such as DNS appear in the eu01 list only,
//   live 2026-11-03, so absence from one region is not `not_offered`);
//   without one it says `no-service-id-mapping`
//
// Privacy (Design 120 section 6.4): names, descriptions, IPs, user data and
// metadata of resources are never copied; labels become tags, which the scan
// assembler pseudonymises (privacy.ts, #3587); the service account e-mail
// never appears in the output.

import type { LzLiveEvidence, LzLiveFactSource, LzLivePostureInput, LzLiveRegion, LzLiveRegionStatus, LzLiveScan, LzLiveService } from '@swao/core';
import type { ActivityWindow, LiveLzDriver, ReadOnlyProbe, ScopeCtx } from '../types.js';
import { LiveAuthError, LiveSourceUnavailableError } from '../errors.js';
import { flattenAttributes } from '../attributes.js';
import { STACKIT_REGION_OVERLAY, STACKIT_SERVICE_FULFILLS, slugifyProductName } from '../../catalogue/fetch-stackit.js';
import {
  STACKIT_DEFAULT_TOKEN,
  STACKIT_PROVIDER,
  StackitHttpError,
  stackitBase,
  stackitGet,
  stackitProject,
  stackitToken,
} from './stackit-client.js';
import { probeFromPermissions } from './stackit-probe.js';
import { STACKIT_DATA_OMIT, backupFacts, cdnInTransit, dataAtRest, dataBackup, dataItemId, exposureFacts, identityFacts, ingressRules, listenerFacts, volumeEncryption } from './stackit-posture.js';
import type { DataItemOf, IaasItemOf } from './stackit-posture.js';
import { STACKIT_DEFAULT_RESOURCE_MANAGER, listStackitHierarchy } from './stackit-hierarchy.js';
import type { StackitMembershipsDoc, StackitPermissionsDoc } from './stackit-probe.js';

type Estate = LzLiveScan['estate'];

export const STACKIT_DRIVER_VERSION = '0.1.0';
export const STACKIT_DEFAULT_SERVICE_ENABLEMENT = 'https://service-enablement.api.stackit.cloud';
export const STACKIT_DEFAULT_AUTHORIZATION = 'https://authorization.api.stackit.cloud';
export const STACKIT_DEFAULT_IAAS = 'https://iaas.api.stackit.cloud';
// #3867: posture APIs (hosts from the STACKIT API specifications and the Audit Log guide).
export const STACKIT_DEFAULT_KMS = 'https://kms.api.stackit.cloud';
export const STACKIT_DEFAULT_LOAD_BALANCER = 'https://load-balancer.api.stackit.cloud';
export const STACKIT_DEFAULT_SERVER_BACKUP = 'https://server-backup.api.stackit.cloud';
export const STACKIT_DEFAULT_AUDITLOG = 'https://auditlog.api.stackit.cloud';
// #3970: data service APIs (servers of the STACKIT API specifications: object-storage v2, postgres-flex v3, mongodb-flex v2, sfs v1, cdn v1).
export const STACKIT_DEFAULT_OBJECT_STORAGE = 'https://object-storage.api.stackit.cloud';
export const STACKIT_DEFAULT_POSTGRES_FLEX = 'https://postgres-flex-service.api.stackit.cloud';
export const STACKIT_DEFAULT_MONGODB_FLEX = 'https://mongodb-flex-service.api.stackit.cloud';
export const STACKIT_DEFAULT_SFS = 'https://sfs.api.stackit.cloud';
export const STACKIT_DEFAULT_CDN = 'https://cdn.api.stackit.cloud';
// #3995: SQL Server Flex v3 (server of stackit-api-specifications services/sqlserverflex/v3).
export const STACKIT_DEFAULT_SQLSERVER_FLEX = 'https://mssql-flex-service.api.stackit.cloud';

/**
 * #3995 (Design 123 section 5.4): host-aware route key. The SQL Server Flex v3
 * instance routes have the paths of the PostgreSQL Flex v3 routes on another
 * host. The recorder, the replay and the in-process mocks key a request by
 * its path, and the mock pack serves every API on one loopback origin, so the
 * SQL Server Flex routes carry this path prefix: the route key of a request to
 * the SQL Server Flex host is the prefix plus its path (`routePathOf`,
 * record.ts), and the mock pack serves the API under the prefix (its base URL
 * is `<origin>/sqlserver-flex`). On the live host the request path itself is
 * unchanged.
 */
export const STACKIT_SQLSERVER_FLEX_ROUTE_PREFIX = '/sqlserver-flex';
export const STACKIT_ROUTE_HOST_PREFIXES: Readonly<Record<string, string>> = {
  'mssql-flex-service.api.stackit.cloud': STACKIT_SQLSERVER_FLEX_ROUTE_PREFIX,
};
const MAX_PAGES = 50;

/** Regions with the sovereignty overlay of the catalogue fetcher (fetch-stackit.ts STACKIT_REGION_OVERLAY). */
export const STACKIT_DEFAULT_REGIONS: readonly string[] = Object.keys(STACKIT_REGION_OVERLAY);

/** Catalogue services: the PIM product names of fetch-stackit.ts and their catalogue codes. */
export const STACKIT_SERVICES: readonly { product: string; catalogueCode: string; tags: readonly string[] }[] =
  Object.entries(STACKIT_SERVICE_FULFILLS).map(([product, tags]) => ({ product, catalogueCode: slugifyProductName(product), tags }));

/**
 * Service Enablement `serviceId` -> catalogue code (`swao/lz-catalogues/stackit.json`),
 * #3790. Taken from the live list of 2026-11-03 (recording
 * 2026-11-03T18-11-13-275Z, eu01 34 ids, eu02 16 ids). An entry exists only
 * where the id suffix equals the catalogue code, or the spec folder of the same
 * name in stackitcloud/stackit-api-specifications names the product in its
 * title (sfs "STACKIT File Storage", ske "STACKIT Kubernetes Engine", scf
 * "STACKIT Cloud Foundry", load-balancer "STACKIT Network Load Balancer",
 * model-serving "STACKIT Model Serving", postgres-flex). Ids without an entry
 * (argus, automation, cspm, dsa, iaas, model-experiments, mos, network-area,
 * run-command, ufw) keep their own code and no capability tags: iaas covers
 * several catalogue products, the others have no catalogue product or no
 * published link to one (#3790).
 */
export const STACKIT_SERVICE_IDS: Readonly<Record<string, string>> = {
  'cloud.stackit.cdn': 'cdn',
  'cloud.stackit.confidential-kubernetes': 'confidential-kubernetes',
  'cloud.stackit.container-registry': 'container-registry',
  'cloud.stackit.dns': 'dns',
  'cloud.stackit.dremio': 'dremio',
  'cloud.stackit.edge-cloud': 'edge-cloud',
  'cloud.stackit.git': 'git',
  'cloud.stackit.intake': 'intake',
  'cloud.stackit.kms': 'kms',
  'cloud.stackit.loadbalancer': 'network-load-balancer',
  'cloud.stackit.logs': 'logs',
  'cloud.stackit.mailout': 'mailout',
  'cloud.stackit.model-serving': 'ai-model-serving',
  'cloud.stackit.mongodb-flex': 'mongodb-flex',
  'cloud.stackit.object-storage': 'object-storage',
  'cloud.stackit.postgres-flex': 'postgresql-flex',
  'cloud.stackit.scf': 'cloud-foundry',
  'cloud.stackit.secrets-manager': 'secrets-manager',
  'cloud.stackit.sfs': 'file-storage',
  'cloud.stackit.ske': 'kubernetes-engine',
  'cloud.stackit.sqlserver-flex': 'sqlserver-flex',
  'cloud.stackit.telemetry-router': 'telemetry-router',
  'cloud.stackit.vpn': 'vpn',
};

const MAPPED_CATALOGUE_CODES = new Set(Object.values(STACKIT_SERVICE_IDS));

const now = (): string => new Date().toISOString();

function httpStatusOf(err: unknown): number | undefined {
  if (err instanceof StackitHttpError) return err.status;
  if (err instanceof LiveAuthError) return err.httpStatus;
  if (err instanceof LiveSourceUnavailableError) return err.httpStatus;
  return undefined;
}

function recordSource(ctx: ScopeCtx, name: string, err: unknown): void {
  const http = httpStatusOf(err);
  ctx.sources.push(http !== undefined
    ? { name, status: 'not_collected', http_status: http }
    : { name, status: 'not_collected', reason: err instanceof Error ? err.message : String(err) });
}

export function stackitRegions(ctx: ScopeCtx): string[] {
  return ctx.regions.length > 0 ? [...ctx.regions] : [...STACKIT_DEFAULT_REGIONS];
}

// ---------------------------------------------------------------------------
// probeReadOnly
// ---------------------------------------------------------------------------

async function probeReadOnly(ctx: ScopeCtx): Promise<ReadOnlyProbe> {
  const t = await stackitToken(ctx);
  const projectId = await stackitProject(ctx);
  const authz = stackitBase(ctx, 'authorization', STACKIT_DEFAULT_AUTHORIZATION);
  const email = encodeURIComponent(t.email);
  let perms: StackitPermissionsDoc;
  try {
    perms = await stackitGet<StackitPermissionsDoc>(ctx, `${authz}/v2/users/${email}/permissions?resourceType=project&resource=${encodeURIComponent(projectId)}`, '/v2/users/{email}/permissions');
  } catch (err) {
    if (err instanceof LiveAuthError) throw err;
    return {
      read_only: 'unverifiable',
      identity: 'service account',
      reason: `the service account cannot read its own permissions (HTTP ${httpStatusOf(err) ?? 'error'} on /v2/users/{email}/permissions)`,
      write_actions_allowed: [],
      coverage: { readable: [], unreadable: [] },
    };
  }
  let memberships: StackitMembershipsDoc | undefined;
  try {
    memberships = await stackitGet<StackitMembershipsDoc>(ctx, `${authz}/v2/users/${email}/memberships?resourceType=project&resourceId=${encodeURIComponent(projectId)}`, '/v2/users/{email}/memberships');
  } catch (err) {
    if (err instanceof LiveAuthError) throw err;
    memberships = undefined;
  }
  return probeFromPermissions(perms, memberships, projectId);
}

// ---------------------------------------------------------------------------
// Offering
// ---------------------------------------------------------------------------

async function listRegions(ctx: ScopeCtx): Promise<LzLiveRegion[]> {
  await stackitToken(ctx); // a refused key stops the run here
  const iaas = stackitBase(ctx, 'iaas', STACKIT_DEFAULT_IAAS);
  const out: LzLiveRegion[] = [];
  for (const id of stackitRegions(ctx)) {
    const country = STACKIT_REGION_OVERLAY[id]?.country;
    const azs: LzLiveRegion['azs'] = [];
    try {
      // AvailabilityZoneListResponse { items: string[] } (iaas v2 spec); the
      // list carries no availability state, so a listed zone counts as available.
      const doc = await stackitGet<{ items?: unknown[] }>(ctx, `${iaas}/v2/regions/${encodeURIComponent(id)}/availability-zones`, '/v2/regions/{region}/availability-zones');
      for (const z of doc.items ?? []) if (typeof z === 'string' && z !== '') azs.push({ name: z, available: true });
      ctx.sources.push({ name: `azs:${id}`, status: 'ok' });
    } catch (err) {
      if (err instanceof LiveAuthError) throw err;
      recordSource(ctx, `azs:${id}`, err);
    }
    out.push({ id, ...(country ? { country } : {}), azs, status: azs.length > 0 ? 'enabled' : 'unknown' });
  }
  return out;
}

interface ServiceStatusPage {
  items?: { serviceId?: string; state?: string; labels?: Record<string, string> }[];
  nextCursor?: string;
}

/** All pages of the Service Enablement list for one region. */
async function serviceEnablement(ctx: ScopeCtx, projectId: string, region: string): Promise<{ serviceId: string; state: string }[]> {
  const base = stackitBase(ctx, 'service-enablement', STACKIT_DEFAULT_SERVICE_ENABLEMENT);
  const out: { serviceId: string; state: string }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${base}/v2/projects/${encodeURIComponent(projectId)}/regions/${encodeURIComponent(region)}/services${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
    const doc = await stackitGet<ServiceStatusPage>(ctx, url, '/v2/projects/{project_id}/regions/{region}/services');
    for (const it of doc.items ?? []) if (it.serviceId) out.push({ serviceId: it.serviceId, state: it.state ?? 'ENABLED' });
    cursor = doc.nextCursor;
    if (!cursor) return out;
  }
  ctx.sources.push({ name: `service-enablement:${region}`, status: 'not_collected', reason: `stopped after ${MAX_PAGES} pages` });
  return out;
}

function statusOfState(state: string, ref: string, observed_at: string): LzLiveRegionStatus {
  const evidence: LzLiveEvidence[] = [{ source: 'api', ref }];
  switch (state) {
    case 'ENABLED': return { status: 'enabled', evidence, observed_at };
    case 'DISABLED': return { status: 'available_not_enabled', evidence, observed_at };
    default: return { status: 'unknown', evidence, observed_at };
  }
}

/** #3955: one Service Enablement read per region and scope run, shared by the offering and the posture. */
type EnablementRead = { ok: true; items: { serviceId: string; state: string }[] } | { ok: false; err: unknown };
const enablementCache = new WeakMap<ScopeCtx, Map<string, Promise<EnablementRead>>>();

function enablementOf(ctx: ScopeCtx, region: string): Promise<EnablementRead> {
  let m = enablementCache.get(ctx);
  if (!m) {
    m = new Map();
    enablementCache.set(ctx, m);
  }
  let p = m.get(region);
  if (!p) {
    p = (async (): Promise<EnablementRead> => {
      const projectId = await stackitProject(ctx);
      try {
        return { ok: true, items: await serviceEnablement(ctx, projectId, region) };
      } catch (err) {
        if (err instanceof LiveAuthError) throw err;
        return { ok: false, err };
      }
    })();
    m.set(region, p);
  }
  return p;
}

/**
 * #3955 (Design 123 section 5.4, STACKIT table): the documented answers of a
 * regional API for a project that has no presence in the region. Live Reader
 * runs of 2026-11-06 (recordings s156-3871-stackit, eu02): every iaas list
 * answered 404 `{"msg":"resource not found: project"}` and the load balancer
 * list 403 `{"message":"Service not enabled"}`, while Service Enablement of
 * the same region answered 200 with `cloud.stackit.iaas` and
 * `cloud.stackit.loadbalancer` DISABLED. Service Enablement is the STACKIT
 * API that enables a service for a project in a region (stackit-api-
 * specifications services/service-enablement/v2, `state` ENABLED / DISABLED);
 * a disabled service holds no resource of the project there. Only that pair,
 * the answer and a DISABLED state read in the same run, makes the region an
 * empty answer; any other refusal (for example 403 "You are not allowed to
 * perform this action.") stays a failed read and keeps the block partial.
 */
export const STACKIT_ABSENT_ANSWERS = {
  iaas: { status: 404, text: /^resource not found: project$/i, serviceId: 'cloud.stackit.iaas' },
  loadbalancer: { status: 403, text: /^service not enabled$/i, serviceId: 'cloud.stackit.loadbalancer' },
} as const;

/** True when `err` is the documented "no presence" answer of `api` in a region whose Service Enablement shows the service DISABLED. */
async function absentInRegion(ctx: ScopeCtx, region: string, api: keyof typeof STACKIT_ABSENT_ANSWERS, err: unknown): Promise<boolean> {
  const a = STACKIT_ABSENT_ANSWERS[api];
  if (!(err instanceof StackitHttpError) || err.status !== a.status || err.detail === undefined || !a.text.test(err.detail.trim())) return false;
  const e = await enablementOf(ctx, region);
  return e.ok && e.items.some((x) => x.serviceId === a.serviceId && x.state === 'DISABLED');
}

/**
 * #3955: the Audit Log v2 request as the API defines it (stackit-sdk-go
 * services/auditlog v0.6.1 v2api, ListProjectAuditLogEntries: host
 * auditlog.api.stackit.cloud, `GET /v2/projects/{projectId}`, required
 * `start-time-range` and `end-time-range`, ISO timestamps, at most 24 hours
 * within the last 90 days, optional `limit` and `cursor`) answers 404 with an
 * empty body for the Reader service account (live 2026-11-05 and twice on
 * 2026-11-06, with and without fractional seconds and with `limit`). The SDK
 * marks the API "deprecated and will be removed shortly" in favour of the
 * Telemetry Router, and the STACKIT documentation requires the
 * `audit-log.reader` role for service accounts. With no read-only API that
 * answers for this key, audit trail and log retention are not observable.
 */
export const STACKIT_AUDITLOG_UNANSWERED = 'Audit Log API v2 answers 404 with an empty body for this key (the API is deprecated in favour of the Telemetry Router; service accounts need the audit-log.reader role); not observable from live read-only data';

const ABSENT_REASON = 'service not enabled for the project in the region (Service Enablement DISABLED); answered empty';

async function listServices(ctx: ScopeCtx, region: string): Promise<LzLiveService[]> {
  const observed_at = now();
  let listed: { serviceId: string; state: string }[] | undefined;
  let http: number | undefined;
  const read = await enablementOf(ctx, region);
  if (read.ok) {
    listed = read.items;
    ctx.sources.push({ name: `service-enablement:${region}`, status: 'ok' });
  } else {
    http = httpStatusOf(read.err);
    recordSource(ctx, `service-enablement:${region}`, read.err);
  }
  const out: LzLiveService[] = [];
  const covered = new Set<string>();
  for (const s of listed ?? []) {
    const catalogueCode = STACKIT_SERVICE_IDS[s.serviceId];
    const entry = catalogueCode ? STACKIT_SERVICES.find((x) => x.catalogueCode === catalogueCode) : undefined;
    if (catalogueCode) covered.add(catalogueCode);
    out.push({
      code: s.serviceId,
      name: entry?.product ?? s.serviceId,
      capability_tags: entry ? [...entry.tags] : [],
      ...(catalogueCode ? { catalogue_code: catalogueCode } : {}),
      regions: { [region]: statusOfState(s.state, `service-enablement:${s.serviceId}`, observed_at) },
      frameworks: {},
    });
  }
  for (const s of STACKIT_SERVICES) {
    if (covered.has(s.catalogueCode)) continue;
    const evidence: LzLiveEvidence[] = listed
      ? [{ source: 'api', ref: `service-enablement:${region}:${MAPPED_CATALOGUE_CODES.has(s.catalogueCode) ? 'not-listed' : 'no-service-id-mapping'}` }]
      : [{ source: 'api', ref: `service-enablement:${region}`, ...(http !== undefined ? { http_status: http } : {}) }];
    out.push({
      code: s.catalogueCode,
      name: s.product,
      capability_tags: [...s.tags],
      catalogue_code: s.catalogueCode,
      regions: { [region]: { status: 'unknown', evidence, observed_at } },
      frameworks: {},
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Estate
// ---------------------------------------------------------------------------

interface IaasItem {
  id?: string;
  labels?: Record<string, unknown>;
  createdAt?: string;
  availabilityZone?: string;
  [property: string]: unknown;
}

/** IaaS item fields mapped into normalised fields (the rest goes into `attributes`, #3886). */
export const STACKIT_IAAS_NORMALISED_KEYS: readonly string[] = ['id', 'labels', 'createdAt'];

/** IaaS list APIs read for the inventory (iaas v2 spec, `{ items: [...] }`). */
export const STACKIT_IAAS_KINDS: readonly { path: string; type: string }[] = [
  { path: 'servers', type: 'iaas.server' },
  { path: 'volumes', type: 'iaas.volume' },
  { path: 'networks', type: 'iaas.network' },
  { path: 'public-ips', type: 'iaas.public-ip' },
  { path: 'security-groups', type: 'iaas.security-group' },
];

function labelsToTags(labels: unknown): Record<string, string> {
  if (labels === null || typeof labels !== 'object') return {};
  return Object.fromEntries(Object.entries(labels as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
}

/** #3867: one read of each iaas list per scope run, shared by the inventory and the posture. */
type IaasRead = { ok: true; items: IaasItem[] } | { ok: false; err: unknown };
const iaasCache = new WeakMap<ScopeCtx, Map<string, Promise<IaasRead>>>();

function iaasList(ctx: ScopeCtx, region: string, path: string): Promise<IaasRead> {
  let m = iaasCache.get(ctx);
  if (!m) {
    m = new Map();
    iaasCache.set(ctx, m);
  }
  const key = `${region}/${path}`;
  let p = m.get(key);
  if (!p) {
    p = (async (): Promise<IaasRead> => {
      const projectId = await stackitProject(ctx);
      const iaas = stackitBase(ctx, 'iaas', STACKIT_DEFAULT_IAAS);
      try {
        const doc = await stackitGet<{ items?: IaasItem[] }>(ctx, `${iaas}/v2/projects/${encodeURIComponent(projectId)}/regions/${encodeURIComponent(region)}/${path}`, `/v2/projects/{project_id}/regions/{region}/${path}`);
        return { ok: true, items: doc.items ?? [] };
      } catch (err) {
        if (err instanceof LiveAuthError) throw err;
        return { ok: false, err };
      }
    })();
    m.set(key, p);
  }
  return p;
}

async function listResources(ctx: ScopeCtx): Promise<Estate['resources']> {
  const out: Estate['resources'] = [];
  let collected = 0;
  let lastErr: unknown;
  for (const region of stackitRegions(ctx)) {
    for (const kind of STACKIT_IAAS_KINDS) {
      const read = await iaasList(ctx, region, kind.path);
      if (!read.ok) {
        if (await absentInRegion(ctx, region, 'iaas', read.err)) {
          collected++;
          ctx.sources.push({ name: `inventory:${kind.path}:${region}`, status: 'ok', reason: ABSENT_REASON });
          continue;
        }
        lastErr = read.err;
        recordSource(ctx, `inventory:${kind.path}:${region}`, read.err);
        continue;
      }
      collected++;
      for (const r of read.items) {
        if (!r.id) continue;
        const tags = labelsToTags(r.labels);
        // #3886 (Design 123 section 5.7): every other returned property goes
        // into `attributes`; names, descriptions, user data and metadata are
        // handled by the one privacy filter in the scan assembler (scan.ts).
        const attributes = flattenAttributes(r, { omit: STACKIT_IAAS_NORMALISED_KEYS });
        out.push({
          id: r.id,
          type: kind.type,
          service_code: 'iaas',
          region,
          ...(Object.keys(tags).length > 0 ? { tags } : {}),
          ...(r.createdAt ? { created_at: r.createdAt } : {}),
          ...(attributes ? { attributes } : {}),
        });
      }
    }
  }
  if (collected === 0) throw new LiveSourceUnavailableError('inventory:resources', httpStatusOf(lastErr));
  return out;
}

// ---------------------------------------------------------------------------
// #3867: posture (Design 123 section 5.4, STACKIT table; estate.posture of #3864)
// ---------------------------------------------------------------------------

export const STACKIT_POSTURE_ROUTES = {
  volumes: '/v2/projects/{project_id}/regions/{region}/volumes',
  publicIps: '/v2/projects/{project_id}/regions/{region}/public-ips',
  securityGroups: '/v2/projects/{project_id}/regions/{region}/security-groups',
  servers: '/v2/projects/{project_id}/regions/{region}/servers',
  keyrings: '/v1/projects/{project_id}/regions/{region}/keyrings',
  keys: '/v1/projects/{project_id}/regions/{region}/keyrings/{keyring_id}/keys',
  loadBalancers: '/v2/projects/{project_id}/regions/{region}/load-balancers',
  members: '/v2/project/{project_id}/members',
  auditLog: '/v2/projects/{project_id}',
  backupSchedules: '/v2/projects/{project_id}/regions/{region}/servers/{server_id}/backup-schedules',
} as const;

type Doc = Record<string, unknown>;

/** Outcome of one block's reads (calls made, parts that failed, the first failure). */
class BlockReads {
  readonly calls = new Set<string>();
  ok = 0;
  failed = 0;
  http: number | undefined;
  reason: string | undefined;
  success(route: string): void {
    this.calls.add(route);
    this.ok++;
  }
  failure(route: string, err: unknown): void {
    if (err instanceof LiveAuthError) throw err;
    this.calls.add(route);
    this.failed++;
    if (this.http === undefined && this.reason === undefined) {
      this.http = httpStatusOf(err);
      if (this.http === undefined) this.reason = err instanceof Error ? err.message : String(err);
    }
  }
  /** #3955: regions answered empty because the service is not enabled there, per reason (#3970: object storage has its own). */
  readonly absent = new Map<string, Set<string>>();
  /** #3955: why a refused read cannot be answered with this key (kept next to the HTTP status). */
  note: string | undefined;
  empty(route: string, region: string, reason: string = ABSENT_REASON): void {
    this.success(route);
    this.absentFor(reason, region);
  }
  absentFor(reason: string, region: string): void {
    const set = this.absent.get(reason) ?? new Set<string>();
    set.add(region);
    this.absent.set(reason, set);
  }
  source(): LzLiveFactSource {
    const calls = [...this.calls].sort();
    if (this.ok === 0) return { calls: calls.length > 0 ? calls : ['none'], partial: false, status: 'not_collected', ...(this.http !== undefined ? { http_status: this.http, ...(this.note ? { reason: this.note } : {}) } : { reason: this.reason ?? 'not collected' }) };
    const absent = [...this.absent].map(([reason, regions]) => `${[...regions].sort().join(', ')}: ${reason}`);
    return { calls, partial: this.failed > 0, status: 'ok', ...(absent.length > 0 ? { reason: absent.join('; ') } : {}) };
  }
}

/** The items of one iaas list in every region, recorded in `reads`. */
async function iaasItems(ctx: ScopeCtx, path: string, route: string, reads: BlockReads): Promise<IaasItemOf[]> {
  const out: IaasItemOf[] = [];
  for (const region of stackitRegions(ctx)) {
    const read = await iaasList(ctx, region, path);
    if (!read.ok) {
      if (await absentInRegion(ctx, region, 'iaas', read.err)) reads.empty(route, region);
      else reads.failure(route, read.err);
      continue;
    }
    reads.success(route);
    out.push(...read.items.map((item) => ({ region, item: item as Doc })));
  }
  return out;
}

const docList = (v: unknown): Doc[] => (Array.isArray(v) ? v.filter((x): x is Doc => x !== null && typeof x === 'object') : []);

// ---------------------------------------------------------------------------
// #3970: data services (object storage, PostgreSQL Flex, MongoDB Flex, SFS, CDN)
// ---------------------------------------------------------------------------

/**
 * Read-only list routes of the data services (stackit-api-specifications at
 * the pinned commit: object-storage v2 `ListBuckets`, postgres-flex v3
 * `ListInstancesRequest` and `GetInstanceRequest`, mongodb-flex v2
 * `ListInstances` and `GetInstance`, sfs v1 `ListResourcePools`, cdn v1
 * `ListDistributions`). #3995: sqlserverflex v3 `ListInstances` and
 * `GetInstance` (host `mssql-flex-service.api.stackit.cloud`) have the paths
 * of the PostgreSQL Flex v3 routes; their templates carry the route prefix of
 * STACKIT_ROUTE_HOST_PREFIXES, so recorder, replay and mock pack keep the two
 * APIs apart. The request sent to the live host has the plain `/v3/...` path.
 */
export const STACKIT_DATA_ROUTES = {
  buckets: '/v2/project/{project_id}/regions/{region}/buckets',
  postgresInstances: '/v3/projects/{project_id}/regions/{region}/instances',
  postgresInstance: '/v3/projects/{project_id}/regions/{region}/instances/{instance_id}',
  sqlserverInstances: '/sqlserver-flex/v3/projects/{project_id}/regions/{region}/instances',
  sqlserverInstance: '/sqlserver-flex/v3/projects/{project_id}/regions/{region}/instances/{instance_id}',
  mongodbInstances: '/v2/projects/{project_id}/regions/{region}/instances',
  mongodbInstance: '/v2/projects/{project_id}/regions/{region}/instances/{instance_id}',
  resourcePools: '/v1/projects/{project_id}/regions/{region}/resourcePools',
  distributions: '/v1/projects/{project_id}/distributions',
} as const;

export interface StackitDataKind {
  /** Resource type (LIVE_RESOURCE_CAPABILITY_MAPS.stackit). */
  type: string;
  /** Service Enablement id; also the resource's `service_code`, so the estate joins the offering. */
  serviceId: string;
  /** Driver base URL key and its default. */
  api: string;
  fallback: string;
  list: string;
  /** Per-item GET whose document replaces the list item (the list lacks backup and encryption). */
  detail?: string;
  /** `project`: one read per project (the CDN is global); `region`: one per scope region. */
  scope: 'region' | 'project';
}

const D = STACKIT_DATA_ROUTES;
export const STACKIT_DATA_KINDS: readonly StackitDataKind[] = [
  { type: 'object-storage.bucket', serviceId: 'cloud.stackit.object-storage', api: 'object-storage', fallback: STACKIT_DEFAULT_OBJECT_STORAGE, list: D.buckets, scope: 'region' },
  { type: 'postgres-flex.instance', serviceId: 'cloud.stackit.postgres-flex', api: 'postgres-flex', fallback: STACKIT_DEFAULT_POSTGRES_FLEX, list: D.postgresInstances, detail: D.postgresInstance, scope: 'region' },
  { type: 'sqlserver-flex.instance', serviceId: 'cloud.stackit.sqlserver-flex', api: 'sqlserver-flex', fallback: STACKIT_DEFAULT_SQLSERVER_FLEX, list: D.sqlserverInstances, detail: D.sqlserverInstance, scope: 'region' },
  { type: 'mongodb-flex.instance', serviceId: 'cloud.stackit.mongodb-flex', api: 'mongodb-flex', fallback: STACKIT_DEFAULT_MONGODB_FLEX, list: D.mongodbInstances, detail: D.mongodbInstance, scope: 'region' },
  { type: 'sfs.resource-pool', serviceId: 'cloud.stackit.sfs', api: 'sfs', fallback: STACKIT_DEFAULT_SFS, list: D.resourcePools, scope: 'region' },
  { type: 'cdn.distribution', serviceId: 'cloud.stackit.cdn', api: 'cdn', fallback: STACKIT_DEFAULT_CDN, list: D.distributions, scope: 'project' },
];

/** Region key of a project-wide read. */
const GLOBAL = 'global';

type DataRead = { ok: true; items: Doc[]; detailErr?: unknown } | { ok: false; err: unknown };
const dataCache = new WeakMap<ScopeCtx, Map<string, Promise<DataRead>>>();

/** All pages of one data service list (shapes and paging per the specification). */
async function dataPages(ctx: ScopeCtx, kind: StackitDataKind, base: string, project: string, region: string): Promise<Doc[]> {
  const r = encodeURIComponent(region);
  const out: Doc[] = [];
  switch (kind.list) {
    case D.buckets:
      return docList((await stackitGet<{ buckets?: unknown }>(ctx, `${base}/v2/project/${project}/regions/${r}/buckets`, kind.list)).buckets);
    case D.postgresInstances:
    // #3995: sqlserverflex v3 ListInstances pages like postgres-flex v3 (`page`, `size`, `pagination.totalPages`).
    case D.sqlserverInstances:
      for (let page = 1; page <= MAX_PAGES; page++) {
        const doc = await stackitGet<{ instances?: unknown; pagination?: { totalPages?: unknown } }>(ctx, `${base}/v3/projects/${project}/regions/${r}/instances?page=${page}&size=100`, kind.list);
        out.push(...docList(doc.instances));
        const total = doc.pagination?.totalPages;
        if (typeof total !== 'number' || page >= total) return out;
      }
      break;
    case D.mongodbInstances:
      // `tag` is required by the specification; the STACKIT CLI sends it empty (`stackit mongodbflex instance list`,
      // "Lists all MongoDB Flex instances", stackit-cli internal/cmd/mongodbflex/instance/list). Not verified on
      // live data with an instance: the test project holds none (2026-11-06).
      return docList((await stackitGet<{ items?: unknown }>(ctx, `${base}/v2/projects/${project}/regions/${r}/instances?tag=`, kind.list)).items);
    case D.resourcePools:
      return docList((await stackitGet<{ resourcePools?: unknown }>(ctx, `${base}/v1/projects/${project}/regions/${r}/resourcePools`, kind.list)).resourcePools);
    case D.distributions: {
      let next: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const doc = await stackitGet<{ distributions?: unknown; nextPageIdentifier?: unknown }>(ctx, `${base}/v1/projects/${project}/distributions?pageSize=100${next ? `&pageIdentifier=${encodeURIComponent(next)}` : ''}`, kind.list);
        out.push(...docList(doc.distributions));
        next = typeof doc.nextPageIdentifier === 'string' && doc.nextPageIdentifier !== '' ? doc.nextPageIdentifier : undefined;
        if (!next) return out;
      }
      break;
    }
    default:
      throw new Error(`[lz live] stackit: no reader for ${kind.list}`);
  }
  ctx.sources.push({ name: `inventory:${kind.type}:${region}`, status: 'not_collected', reason: `stopped after ${MAX_PAGES} pages` });
  return out;
}

/** One read of a data service list per region (or project) and scope run, shared by the inventory and the posture. */
function dataList(ctx: ScopeCtx, kind: StackitDataKind, region: string): Promise<DataRead> {
  let m = dataCache.get(ctx);
  if (!m) {
    m = new Map();
    dataCache.set(ctx, m);
  }
  const key = `${kind.type}@${region}`;
  let p = m.get(key);
  if (!p) {
    p = (async (): Promise<DataRead> => {
      const project = encodeURIComponent(await stackitProject(ctx));
      const base = stackitBase(ctx, kind.api, kind.fallback);
      let items: Doc[];
      try {
        items = await dataPages(ctx, kind, base, project, region);
      } catch (err) {
        if (err instanceof LiveAuthError) throw err;
        return { ok: false, err };
      }
      if (!kind.detail) return { ok: true, items };
      let detailErr: unknown;
      // The API version segment of the template (`/v3/...`, `/sqlserver-flex/v3/...`, #3995).
      const version = /\/(v\d+)\//.exec(kind.detail)?.[1] ?? 'v2';
      const full: Doc[] = [];
      for (const it of items) {
        const id = typeof it['id'] === 'string' ? it['id'] : undefined;
        if (!id) { full.push(it); continue; }
        try {
          const doc = await stackitGet<Doc>(ctx, `${base}/${version}/projects/${project}/regions/${encodeURIComponent(region)}/instances/${encodeURIComponent(id)}`, kind.detail);
          // mongodb-flex v2 wraps the instance in `item`; postgres-flex v3 and sqlserverflex v3 answer the instance itself.
          const wrapped = doc['item'];
          const inner = wrapped !== null && typeof wrapped === 'object' && !Array.isArray(wrapped) ? wrapped as Doc : doc;
          full.push({ ...it, ...inner });
        } catch (err) {
          if (err instanceof LiveAuthError) throw err;
          detailErr ??= err;
          full.push(it);
        }
      }
      return { ok: true, items: full, ...(detailErr !== undefined ? { detailErr } : {}) };
    })();
    m.set(key, p);
  }
  return p;
}

const dataRegions = (ctx: ScopeCtx, kind: StackitDataKind): string[] => (kind.scope === 'project' ? [GLOBAL] : stackitRegions(ctx));

/**
 * #3970 (section 5.4): documented "no presence" answers of the data service
 * lists. Object storage v2: buckets live in an object storage project that
 * `POST /v2/project/{projectId}/regions/{region}` ("Create Project") creates
 * per region; the Terraform provider enables it before it creates a bucket
 * (terraform-provider-stackit objectstorage `EnableProject`, `EnableService`).
 * The live Reader run of 2026-11-06 answered the bucket list in eu01 and eu02
 * with 404 `{"detail":[{"key":"project.not_found"}]}` while Service
 * Enablement showed object storage ENABLED: object storage was never enabled
 * for the project in the region, so it holds no bucket. That answer alone
 * (`when: 'always'`) is an empty answered region.
 *
 * SFS v1: in eu02 the API closes the connection without an HTTP answer (live
 * 2026-11-06, with and without a token), and the Service Enablement list of
 * eu02 does not name `cloud.stackit.sfs` while the eu01 list names it
 * ENABLED: the service is not offered for the project in that region. Only
 * that pair (no HTTP answer, and a Service Enablement list of the region read
 * in the same run that does not name the service, `when: 'not_listed'`) is an
 * empty answered region. Any other refusal stays a failed read and keeps the
 * block partial.
 */
export interface StackitDataAbsentAnswer {
  /** HTTP status and error text of the answer; `transport` for a connection closed without an HTTP answer. */
  answer: { status: number; text: RegExp } | 'transport';
  /** `always`: the answer alone; `disabled`: Service Enablement shows the service DISABLED; `not_listed`: the region's list does not name it. */
  when: 'always' | 'disabled' | 'not_listed';
  reason: string;
}

export const STACKIT_DATA_ABSENT_ANSWERS: Readonly<Record<string, readonly StackitDataAbsentAnswer[]>> = {
  'object-storage.bucket': [{ answer: { status: 404, text: /^project\.not_found$/ }, when: 'always', reason: 'object storage not enabled for the project in the region (bucket list 404 project.not_found); answered empty' }],
  'sfs.resource-pool': [{ answer: 'transport', when: 'not_listed', reason: 'file storage not offered for the project in the region (not in the Service Enablement list; the API closes the connection); answered empty' }],
};

/**
 * The reason when `err` is a documented "no presence" answer of a data
 * service in the region: an answer of STACKIT_DATA_ABSENT_ANSWERS, or the
 * #3955 pair (iaas 404 "resource not found: project" with the service
 * DISABLED in Service Enablement); else undefined.
 */
async function dataAbsent(ctx: ScopeCtx, kind: StackitDataKind, region: string, err: unknown): Promise<string | undefined> {
  if (kind.scope === 'project') return undefined;
  const http = err instanceof StackitHttpError;
  const detail = http ? err.detail?.trim() : undefined;
  const transport = !http && httpStatusOf(err) === undefined;
  const hit = (STACKIT_DATA_ABSENT_ANSWERS[kind.type] ?? []).find((a) => (a.answer === 'transport'
    ? transport
    : http && a.answer.status === err.status && detail !== undefined && a.answer.text.test(detail)));
  if (hit === undefined) return undefined;
  switch (hit.when) {
    case 'always': return hit.reason;
    case 'disabled': {
      const e = await enablementOf(ctx, region);
      return e.ok && e.items.some((x) => x.serviceId === kind.serviceId && x.state === 'DISABLED') ? hit.reason : undefined;
    }
    case 'not_listed': {
      const e = await enablementOf(ctx, region);
      return e.ok && !e.items.some((x) => x.serviceId === kind.serviceId) ? hit.reason : undefined;
    }
    default: {
      const never: never = hit.when;
      throw new Error(`[lz live] stackit: unknown absence rule ${String(never)}`);
    }
  }
}

/** The data service items of every region, recorded in each of `reads` (list and per-item reads). */
async function dataItems(ctx: ScopeCtx, kind: StackitDataKind, reads: readonly BlockReads[]): Promise<DataItemOf[]> {
  const out: DataItemOf[] = [];
  for (const region of dataRegions(ctx, kind)) {
    const read = await dataList(ctx, kind, region);
    if (!read.ok) {
      const absent = await dataAbsent(ctx, kind, region, read.err);
      for (const r of reads) {
        if (absent !== undefined) r.empty(kind.list, region, absent);
        else r.failure(kind.list, read.err);
      }
      continue;
    }
    for (const r of reads) {
      r.success(kind.list);
      if (kind.detail && read.items.length > 0) {
        if (read.detailErr !== undefined) r.failure(kind.detail, read.detailErr);
        else r.calls.add(kind.detail);
      }
    }
    out.push(...read.items.map((item) => ({ region, item })));
  }
  return out;
}

async function listServiceResources(ctx: ScopeCtx): Promise<Estate['resources']> {
  const out: Estate['resources'] = [];
  let collected = 0;
  let lastErr: unknown;
  for (const kind of STACKIT_DATA_KINDS) {
    for (const region of dataRegions(ctx, kind)) {
      const read = await dataList(ctx, kind, region);
      if (!read.ok) {
        const absent = await dataAbsent(ctx, kind, region, read.err);
        if (absent !== undefined) {
          collected++;
          ctx.sources.push({ name: `inventory:${kind.type}:${region}`, status: 'ok', reason: absent });
          continue;
        }
        lastErr = read.err;
        recordSource(ctx, `inventory:${kind.type}:${region}`, read.err);
        continue;
      }
      collected++;
      if (read.detailErr !== undefined) recordSource(ctx, `inventory:${kind.type}:${region}:detail`, read.detailErr);
      for (const item of read.items) {
        const id = dataItemId(kind.type, item);
        if (!id) continue;
        const config = item['config'];
        const labels = kind.type === 'cdn.distribution' && config !== null && typeof config === 'object' ? (config as Doc)['labels'] : item['labels'];
        const tags = labelsToTags(labels);
        const created = item['createdAt'] ?? item['created'];
        const attributes = flattenAttributes(item, { omit: STACKIT_DATA_OMIT[kind.type] ?? [] });
        out.push({
          id,
          type: kind.type,
          service_code: kind.serviceId,
          region,
          ...(Object.keys(tags).length > 0 ? { tags } : {}),
          ...(typeof created === 'string' && created !== '' ? { created_at: created } : {}),
          ...(attributes ? { attributes } : {}),
        });
      }
    }
  }
  if (collected === 0) throw new LiveSourceUnavailableError('inventory:service-resources', httpStatusOf(lastErr));
  return out;
}


async function listPosture(ctx: ScopeCtx, dataServices = true): Promise<LzLivePostureInput> {
  const R = STACKIT_POSTURE_ROUTES;
  const projectId = encodeURIComponent(await stackitProject(ctx));
  const regions = stackitRegions(ctx);

  // KMS keys (protection of the keys that encrypt volumes) and load balancers, per region.
  const kms = stackitBase(ctx, 'kms', STACKIT_DEFAULT_KMS);
  const keyProtection = new Map<string, string>();
  const enc = new BlockReads();
  for (const region of regions) {
    try {
      const rings = docList((await stackitGet<{ keyRings?: unknown }>(ctx, `${kms}/v1/projects/${projectId}/regions/${encodeURIComponent(region)}/keyrings`, R.keyrings)).keyRings);
      enc.success(R.keyrings);
      for (const ring of rings) {
        const rid = typeof ring['id'] === 'string' ? ring['id'] : undefined;
        if (!rid) continue;
        const keys = docList((await stackitGet<{ keys?: unknown }>(ctx, `${kms}/v1/projects/${projectId}/regions/${encodeURIComponent(region)}/keyrings/${encodeURIComponent(rid)}/keys`, R.keys)).keys);
        enc.calls.add(R.keys);
        for (const k of keys) if (typeof k['id'] === 'string' && typeof k['protection'] === 'string') keyProtection.set(k['id'], k['protection']);
      }
    } catch (err) {
      enc.failure(R.keyrings, err);
    }
  }
  const volumes = await iaasItems(ctx, 'volumes', R.volumes, enc);
  const lbBase = stackitBase(ctx, 'load-balancer', STACKIT_DEFAULT_LOAD_BALANCER);
  const lbReads = new BlockReads();
  const lbs: IaasItemOf[] = [];
  for (const region of regions) {
    try {
      let pageId: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const doc = await stackitGet<{ loadBalancers?: unknown; nextPageId?: string }>(ctx, `${lbBase}/v2/projects/${projectId}/regions/${encodeURIComponent(region)}/load-balancers?pageSize=1000${pageId ? `&pageId=${encodeURIComponent(pageId)}` : ''}`, R.loadBalancers);
        lbs.push(...docList(doc.loadBalancers).map((item) => ({ region, item })));
        pageId = typeof doc.nextPageId === 'string' && doc.nextPageId !== '' ? doc.nextPageId : undefined;
        if (!pageId) break;
      }
      lbReads.success(R.loadBalancers);
      enc.success(R.loadBalancers);
    } catch (err) {
      if (await absentInRegion(ctx, region, 'loadbalancer', err)) {
        lbReads.empty(R.loadBalancers, region);
        enc.empty(R.loadBalancers, region);
      } else {
        lbReads.failure(R.loadBalancers, err);
        enc.failure(R.loadBalancers, err);
      }
    }
  }

  // #3970: data services. Encryption at rest of buckets, Flex instances and
  // SFS resource pools; backup of the Flex instances and resource pools; CDN
  // TLS floors (in transit). The bucket read also counts for the exposure
  // block: a refused bucket list must not let "no public storage" pass.
  const bkReads = new BlockReads();
  const expReads = new BlockReads();
  const dataAtRestItems: ReturnType<typeof dataAtRest> = [];
  const dataBackupItems: ReturnType<typeof dataBackup> = [];
  const cdnItems: ReturnType<typeof cdnInTransit> = [];
  for (const kind of dataServices ? STACKIT_DATA_KINDS : []) {
    switch (kind.type) {
      case 'object-storage.bucket':
        dataAtRestItems.push(...dataAtRest(kind.type, kind.serviceId, await dataItems(ctx, kind, [enc, expReads])));
        break;
      case 'postgres-flex.instance':
      case 'sqlserver-flex.instance':
      case 'mongodb-flex.instance':
      case 'sfs.resource-pool': {
        const items = await dataItems(ctx, kind, [enc, bkReads]);
        dataAtRestItems.push(...dataAtRest(kind.type, kind.serviceId, items));
        dataBackupItems.push(...dataBackup(kind.type, kind.serviceId, items));
        break;
      }
      case 'cdn.distribution':
        cdnItems.push(...cdnInTransit(await dataItems(ctx, kind, [enc])));
        break;
      default:
        throw new Error(`[lz live] stackit: no posture mapping for ${kind.type}`);
    }
  }

  // Exposure and ingress from the iaas lists the inventory already reads.
  const publicIps = await iaasItems(ctx, 'public-ips', R.publicIps, expReads);
  if (lbReads.ok > 0) {
    expReads.success(R.loadBalancers);
    for (const [reason, regions] of lbReads.absent) for (const r of regions) expReads.absentFor(reason, r);
  }
  // #3955: a load balancer region refused (not the no-presence answer) leaves the exposure partial.
  if (lbReads.failed > 0) expReads.failure(R.loadBalancers, lbReads.http !== undefined ? new StackitHttpError(lbReads.http, R.loadBalancers) : new Error(lbReads.reason ?? 'not collected'));
  const ingReads = new BlockReads();
  const groups = await iaasItems(ctx, 'security-groups', R.securityGroups, ingReads);

  // Identity: project members (authorization v2).
  const idReads = new BlockReads();
  let members: Doc[] = [];
  try {
    const authz = stackitBase(ctx, 'authorization', STACKIT_DEFAULT_AUTHORIZATION);
    members = docList((await stackitGet<{ members?: unknown }>(ctx, `${authz}/v2/project/${projectId}/members`, R.members)).members);
    idReads.success(R.members);
  } catch (err) {
    idReads.failure(R.members, err);
  }

  // Logging: the project audit log (Audit Log API v2), one entry of the last hour is enough to show it is readable.
  const logReads = new BlockReads();
  const trails: NonNullable<NonNullable<LzLivePostureInput['logging']>['trails']> = [];
  try {
    const audit = stackitBase(ctx, 'auditlog', STACKIT_DEFAULT_AUDITLOG);
    const end = new Date();
    const start = new Date(end.getTime() - 3_600_000);
    // #3955: RFC 3339 without fractional seconds and the SDK's default page size (stackit-sdk-go auditlog v2api, ListProjectAuditLogEntries).
    const iso = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    await stackitGet<Doc>(ctx, `${audit}/v2/projects/${projectId}?start-time-range=${encodeURIComponent(iso(start))}&end-time-range=${encodeURIComponent(iso(end))}&limit=50`, R.auditLog);
    logReads.success(R.auditLog);
    trails.push({ all_regions: true, enabled: true });
  } catch (err) {
    logReads.failure(R.auditLog, err);
    if (err instanceof StackitHttpError && err.status === 404 && err.detail === undefined) logReads.note = STACKIT_AUDITLOG_UNANSWERED;
  }

  // Backup: schedules of every server (server-backup v2); 404 = backup service not enabled for the server.
  const servers = await iaasItems(ctx, 'servers', R.servers, bkReads);
  const schedulesOf = new Map<string, Doc[] | undefined>();
  const backup = stackitBase(ctx, 'server-backup', STACKIT_DEFAULT_SERVER_BACKUP);
  for (const { region, item } of servers) {
    const sid = typeof item['id'] === 'string' ? item['id'] : undefined;
    if (!sid) continue;
    try {
      const doc = await stackitGet<{ items?: unknown }>(ctx, `${backup}/v2/projects/${projectId}/regions/${encodeURIComponent(region)}/servers/${encodeURIComponent(sid)}/backup-schedules`, R.backupSchedules);
      schedulesOf.set(sid, docList(doc.items));
      bkReads.success(R.backupSchedules);
    } catch (err) {
      if (err instanceof StackitHttpError && err.status === 404) {
        schedulesOf.set(sid, undefined);
        bkReads.success(R.backupSchedules);
      } else {
        bkReads.failure(R.backupSchedules, err);
      }
    }
  }

  return {
    encryption: { source: enc.source(), items: [...volumeEncryption(volumes, keyProtection), ...dataAtRestItems, ...listenerFacts(lbs), ...cdnItems] },
    exposure: { source: expReads.source(), items: exposureFacts(publicIps, lbs) },
    ingress_rules: { source: ingReads.source(), items: ingressRules(groups) },
    identity: { source: idReads.source(), ...(idReads.ok > 0 ? identityFacts(members) : { credentials: [] }) },
    logging: { source: logReads.source(), trails },
    backup: { source: bkReads.source(), items: [...backupFacts(servers.filter(({ item }) => schedulesOf.has(String(item['id']))), schedulesOf), ...dataBackupItems] },
  };
}

async function listGuardrails(_ctx: ScopeCtx): Promise<Estate['guardrails']> {
  throw new LiveSourceUnavailableError('guardrails', undefined, 'no STACKIT guardrail API verified yet (open question in #3576)');
}

/** QuotaListResponse { quotas: { <resource>: { limit, usage } } } (iaas v2 spec). */
async function listQuotas(ctx: ScopeCtx, region: string): Promise<Estate['quotas']> {
  const projectId = await stackitProject(ctx);
  const iaas = stackitBase(ctx, 'iaas', STACKIT_DEFAULT_IAAS);
  let doc: { quotas?: Record<string, { limit?: unknown; usage?: unknown }> };
  try {
    doc = await stackitGet<typeof doc>(ctx, `${iaas}/v2/projects/${encodeURIComponent(projectId)}/regions/${encodeURIComponent(region)}/quotas`, '/v2/projects/{project_id}/regions/{region}/quotas');
  } catch (err) {
    if (err instanceof LiveAuthError) throw err;
    throw new LiveSourceUnavailableError(`quotas:${region}`, httpStatusOf(err));
  }
  const out: Estate['quotas'] = [];
  for (const [resource, q] of Object.entries(doc.quotas ?? {})) {
    const limit = typeof q?.limit === 'number' && q.limit >= 0 ? q.limit : undefined;
    const used = typeof q?.usage === 'number' && q.usage >= 0 ? q.usage : undefined;
    out.push({
      resource,
      region,
      ...(limit !== undefined ? { limit } : {}),
      ...(used !== undefined ? { used } : {}),
      ...(limit !== undefined && used !== undefined ? { remaining: limit - used } : {}),
    });
  }
  return out;
}

async function listActivity(_ctx: ScopeCtx, _window: ActivityWindow): Promise<NonNullable<Estate['activity_summary']>> {
  throw new LiveSourceUnavailableError('activity', undefined, 'no STACKIT audit log API in stackit-api-specifications verified yet (open question in #3576)');
}

export const stackitDriver: LiveLzDriver = {
  provider: STACKIT_PROVIDER,
  driverVersion: STACKIT_DRIVER_VERSION,
  authMethods: [{ id: 'key-flow', required: ['service-account-key'], optional: [], unattended: true }],
  defaultBaseUrls: {
    token: STACKIT_DEFAULT_TOKEN,
    'service-enablement': STACKIT_DEFAULT_SERVICE_ENABLEMENT,
    authorization: STACKIT_DEFAULT_AUTHORIZATION,
    iaas: STACKIT_DEFAULT_IAAS,
    kms: STACKIT_DEFAULT_KMS,
    'load-balancer': STACKIT_DEFAULT_LOAD_BALANCER,
    'server-backup': STACKIT_DEFAULT_SERVER_BACKUP,
    auditlog: STACKIT_DEFAULT_AUDITLOG,
    // #3970: data services.
    'object-storage': STACKIT_DEFAULT_OBJECT_STORAGE,
    'postgres-flex': STACKIT_DEFAULT_POSTGRES_FLEX,
    'mongodb-flex': STACKIT_DEFAULT_MONGODB_FLEX,
    sfs: STACKIT_DEFAULT_SFS,
    cdn: STACKIT_DEFAULT_CDN,
    // #3995: SQL Server Flex (routes under STACKIT_SQLSERVER_FLEX_ROUTE_PREFIX, see routeHostPrefixes).
    'sqlserver-flex': STACKIT_DEFAULT_SQLSERVER_FLEX,
    // #3883: Resource Manager (global host), the tenant hierarchy.
    'resource-manager': STACKIT_DEFAULT_RESOURCE_MANAGER,
  },
  readAllowList: [{ method: 'POST', path: /^\/oauth\/v2\/token$/, reason: 'Key Flow token request; exchanges the signed assertion for an access token and creates nothing in the project' }],
  // #3601: string literals only. The mock route parity gate (#3595) reads
  // them from the source text; stackit-driver.test.ts pins the list to
  // STACKIT_TOKEN_PATH and STACKIT_IAAS_KINDS.
  routeTemplates: [
    '/oauth/v2/token',
    '/v2/users/{email}/permissions',
    '/v2/users/{email}/memberships',
    '/v2/regions/{region}/availability-zones',
    '/v2/projects/{project_id}/regions/{region}/services',
    '/v2/projects/{project_id}/regions/{region}/servers',
    '/v2/projects/{project_id}/regions/{region}/volumes',
    '/v2/projects/{project_id}/regions/{region}/networks',
    '/v2/projects/{project_id}/regions/{region}/public-ips',
    '/v2/projects/{project_id}/regions/{region}/security-groups',
    '/v2/projects/{project_id}/regions/{region}/quotas',
    '/v1/projects/{project_id}/regions/{region}/keyrings',
    '/v1/projects/{project_id}/regions/{region}/keyrings/{keyring_id}/keys',
    '/v2/projects/{project_id}/regions/{region}/load-balancers',
    '/v2/project/{project_id}/members',
    '/v2/projects/{project_id}',
    '/v2/projects/{project_id}/regions/{region}/servers/{server_id}/backup-schedules',
    // #3883: Resource Manager hierarchy reads (stackit-hierarchy.ts STACKIT_HIERARCHY_ROUTES).
    // GET /v2/projects/{id} is not read: its path is the Audit Log route above.
    '/v2/projects',
    '/v2/folders',
    '/v2/folders/{container_id}',
    '/v2/organizations/{organization_id}',
    // #3970: data service reads (STACKIT_DATA_ROUTES).
    '/v2/project/{project_id}/regions/{region}/buckets',
    '/v3/projects/{project_id}/regions/{region}/instances',
    '/v3/projects/{project_id}/regions/{region}/instances/{instance_id}',
    // #3995: SQL Server Flex v3, keyed with the host prefix (routeHostPrefixes).
    '/sqlserver-flex/v3/projects/{project_id}/regions/{region}/instances',
    '/sqlserver-flex/v3/projects/{project_id}/regions/{region}/instances/{instance_id}',
    '/v2/projects/{project_id}/regions/{region}/instances',
    '/v2/projects/{project_id}/regions/{region}/instances/{instance_id}',
    '/v1/projects/{project_id}/regions/{region}/resourcePools',
    '/v1/projects/{project_id}/distributions',
  ],
  // #3995: route key prefix per API host (record.ts routePathOf).
  routeHostPrefixes: STACKIT_ROUTE_HOST_PREFIXES,
  probeReadOnly,
  listRegions,
  listServices,
  listGuardrails,
  listResources,
  listServiceResources,
  listQuotas,
  listActivity,
  listPosture: (ctx) => listPosture(ctx),
  // #3970: for recordings that predate the data service reads (omitLzCollectors).
  listPostureWithoutServiceResources: (ctx) => listPosture(ctx, false),
  // #3883 (Design 123 section 5.6): organisation, nested folders, projects.
  listHierarchy: listStackitHierarchy,
  // #3831 (Q-21, owner decision 2026-11-04): registered for release on the
  // live evidence of the operator / Reader runs; minimal role set unverified (ROLES.md).
  liveVerified: true,
};
