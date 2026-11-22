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

// #3576 test fixture: an in-process mock of the STACKIT APIs the `stackit`
// driver reads, served through the injected transport (the pattern of
// otc/__tests__/otc-mock.ts). Wire formats follow the published OpenAPI in
// stackitcloud/stackit-api-specifications (service-enablement/v2,
// authorization/v2, iaas/v2), the Key Flow of docs.stackit.cloud and the
// shapes recorded live on 2026-11-03 (error envelope, `{"items":[]}` for a
// service account without a role, AZ list `["eu01-1", ...]`). Every id and
// name here is neutral test data, never a project value. The token endpoint
// verifies the RS512 assertion against the public key of the generated test
// key pair.

import { createVerify, generateKeyPairSync } from 'node:crypto';
import type { FetchLike } from '../../types.js';
import { routePathOf } from '../../record.js';
import { STACKIT_ROUTE_HOST_PREFIXES } from '../stackit-driver.js';

export const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
export const SA_EMAIL = ['sa', 'mock'].join('-') + '@sa.example.invalid';
export const SA_SUB = '00000000-0000-4000-8000-0000000000aa';
export const KEY_ID = '00000000-0000-4000-8000-0000000000bb';
export const AUD = 'https://accounts.example.invalid';

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const PRIVATE_PEM = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PUBLIC_KEY = pair.publicKey;

/** The portal's key JSON shape (live 2026-11-03), with neutral values. */
export function serviceAccountKey(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    credentials: { aud: AUD, iss: SA_EMAIL, kid: KEY_ID, sub: SA_SUB, privateKey: PRIVATE_PEM, tokenEndpoint: 'https://attacker.example.invalid/oauth/v2/token', ...over },
    id: KEY_ID,
    keyAlgorithm: 'RSA_2048',
    keyOrigin: 'GENERATED',
    keyType: 'USER_MANAGED',
  });
}

export interface MockCall {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

export interface MockOptions {
  /** Status override per route key (see `routeKey`), e.g. { 'se-eu01': 403 }. */
  fail?: Record<string, number>;
  /** #3955: the body of a failed route (default: a generic error envelope). */
  failBody?: Record<string, unknown>;
  permissions?: string[];
  roles?: string[];
  /** Service Enablement pages per region. */
  services?: Record<string, { serviceId: string; state: string }[][]>;
  resources?: Record<string, { id: string; labels?: Record<string, string>; name?: string; createdAt?: string; ip?: string; userData?: string }[]>;
  /** Access token without the project claim. */
  noProjectClaim?: boolean;
  /** #3867 posture reads; keys per region where the API is regional. */
  keyRings?: Record<string, { id: string }[]>;
  keys?: Record<string, unknown[]>;
  loadBalancers?: Record<string, unknown[]>;
  members?: unknown[];
  /** Audit log answer (default 404 with an empty body, as live 2026-11-05). */
  auditStatus?: number;
  /** Backup schedules per server id (absent: 404, backup service not enabled). */
  schedules?: Record<string, unknown[]>;
  /**
   * #3883 Resource Manager: the member project list (default: the scope
   * project directly under one organisation, as live 2026-11-05), folder
   * documents by container id, and the organisation document; the
   * organisation and the child listings answer 403 unless given.
   */
  rmProjects?: unknown[];
  rmFolders?: Record<string, unknown>;
  rmOrganization?: unknown;
  rmChildren?: Record<string, { folders?: unknown[]; projects?: unknown[] }>;
  /**
   * #3970 data services, per region (CDN per project). Absent: an empty
   * list. `buckets` null for a region: 404 project.not_found (object storage
   * never enabled for the project there, live 2026-11-06). Flex instances
   * are full GetInstance documents; the list answers their list fields.
   */
  buckets?: Record<string, unknown[] | null>;
  postgres?: Record<string, Record<string, unknown>[]>;
  mongodb?: Record<string, Record<string, unknown>[]>;
  /** #3995: SQL Server Flex v3 instances per region (host mssql-flex-service, same paths as PostgreSQL Flex v3). */
  sqlserver?: Record<string, Record<string, unknown>[]>;
  resourcePools?: Record<string, unknown[]>;
  distributions?: unknown[];
  /** Regions where the SFS API closes the connection (live 2026-11-06, eu02). */
  sfsClosed?: string[];
}

export const RM_ORG_ID = '00000000-0000-4000-8000-0000000000f0';
export const RM_ORG_CONTAINER = 'organization-test0001';

const b64u = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
export const ACCESS_TOKEN_CLAIMS = { sub: SA_SUB, 'stackit/project/project.id': PROJECT_ID };

function routeKey(method: string, path: string): string {
  if (method === 'POST' && path === '/oauth/v2/token') return 'token';
  let m = /^\/v2\/users\/[^/]+\/(permissions|memberships)$/.exec(path);
  if (m) return `authz-${m[1]}`;
  m = /^\/v2\/regions\/([^/]+)\/availability-zones$/.exec(path);
  if (m) return `az-${m[1]}`;
  m = /^\/v1\/projects\/[^/]+\/regions\/([^/]+)\/keyrings$/.exec(path);
  if (m) return `kms-rings-${m[1]}`;
  m = /^\/v1\/projects\/[^/]+\/regions\/[^/]+\/keyrings\/([^/]+)\/keys$/.exec(path);
  if (m) return `kms-keys-${m[1]}`;
  m = /^\/v2\/projects\/[^/]+\/regions\/([^/]+)\/load-balancers$/.exec(path);
  if (m) return `lb-${m[1]}`;
  m = /^\/v2\/projects\/[^/]+\/regions\/[^/]+\/servers\/([^/]+)\/backup-schedules$/.exec(path);
  if (m) return `backup-${m[1]}`;
  if (/^\/v2\/project\/[^/]+\/members$/.test(path)) return 'members';
  // #3970 data services (before the iaas catch-all, which would match the MongoDB Flex list).
  m = /^\/v2\/project\/[^/]+\/regions\/([^/]+)\/buckets$/.exec(path);
  if (m) return `os-buckets-${m[1]}`;
  // #3995: SQL Server Flex v3, keyed by the host route prefix (routePathOf).
  m = /^\/sqlserver-flex\/v3\/projects\/[^/]+\/regions\/([^/]+)\/instances$/.exec(path);
  if (m) return `mssql-list-${m[1]}`;
  m = /^\/sqlserver-flex\/v3\/projects\/[^/]+\/regions\/([^/]+)\/instances\/([^/]+)$/.exec(path);
  if (m) return `mssql-get-${m[1]}-${m[2]}`;
  m = /^\/(v3|v2)\/projects\/[^/]+\/regions\/([^/]+)\/instances$/.exec(path);
  if (m) return `${m[1] === 'v3' ? 'pg' : 'mongo'}-list-${m[2]}`;
  m = /^\/(v3|v2)\/projects\/[^/]+\/regions\/([^/]+)\/instances\/([^/]+)$/.exec(path);
  if (m) return `${m[1] === 'v3' ? 'pg' : 'mongo'}-get-${m[2]}-${m[3]}`;
  m = /^\/v1\/projects\/[^/]+\/regions\/([^/]+)\/resourcePools$/.exec(path);
  if (m) return `sfs-${m[1]}`;
  if (/^\/v1\/projects\/[^/]+\/distributions$/.test(path)) return 'cdn';
  if (method === 'GET' && path === '/v2/projects') return 'rm-list-projects';
  if (method === 'GET' && path === '/v2/folders') return 'rm-list-folders';
  if (/^\/v2\/folders\/[^/]+$/.test(path)) return 'rm-folder';
  if (/^\/v2\/organizations\/[^/]+$/.test(path)) return 'rm-organization';
  if (/^\/v2\/projects\/[^/]+$/.test(path)) return 'auditlog';
  m = /^\/v2\/projects\/[^/]+\/regions\/([^/]+)\/services$/.exec(path);
  if (m) return `se-${m[1]}`;
  m = /^\/v2\/projects\/[^/]+\/regions\/([^/]+)\/([a-z-]+)$/.exec(path);
  if (m) return `iaas-${m[2]}-${m[1]}`;
  return 'unknown';
}

function verifyAssertion(assertion: string): string | undefined {
  const [h, c, s] = assertion.split('.');
  if (!h || !c || !s) return 'not a JWT';
  const header = JSON.parse(Buffer.from(h, 'base64url').toString()) as Record<string, unknown>;
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString()) as Record<string, unknown>;
  if (header['alg'] !== 'RS512' || header['kid'] !== KEY_ID) return 'bad header';
  if (claims['iss'] !== SA_EMAIL || claims['sub'] !== SA_SUB || claims['aud'] !== AUD) return 'bad claims';
  if (typeof claims['jti'] !== 'string' || !/^[0-9a-f-]{36}$/.test(claims['jti'])) return 'jti missing';
  if (typeof claims['iat'] !== 'number' || claims['exp'] !== (claims['iat'] as number) + 600) return 'bad exp';
  const ok = createVerify('RSA-SHA512').update(`${h}.${c}`).verify(PUBLIC_KEY, Buffer.from(s, 'base64url'));
  return ok ? undefined : 'bad signature';
}

export function makeStackitMock(opts: MockOptions = {}): { fetch: FetchLike; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const json = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => JSON.stringify(body),
  });
  const errBody = (status: number, path: string) => ({ timestamp: '2026-11-03T00:00:00Z', path, status, error: status === 403 ? 'Forbidden' : 'Error', message: status === 403 ? 'Unauthorized' : 'mock error' });
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url, path: u.pathname, headers: { ...(init?.headers ?? {}) }, ...(init?.body !== undefined ? { body: init.body } : {}) });
    const key = routeKey(method, routePathOf(u, STACKIT_ROUTE_HOST_PREFIXES));
    const failed = opts.fail?.[key];
    if (failed !== undefined) return json(failed, opts.failBody?.[key] ?? errBody(failed, u.pathname));
    if (key === 'token') {
      const form = new URLSearchParams(init?.body ?? '');
      if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') return json(400, { error: 'unsupported_grant_type' });
      const why = verifyAssertion(form.get('assertion') ?? '');
      if (why) return json(400, { error: 'invalid_grant', error_description: why });
      const claims = opts.noProjectClaim ? { sub: SA_SUB } : ACCESS_TOKEN_CLAIMS;
      return json(200, { access_token: `${b64u({ alg: 'RS512' })}.${b64u(claims)}.sig`, token_type: 'Bearer', expires_in: 899 });
    }
    if (init?.headers?.['authorization']?.startsWith('Bearer ') !== true) return json(401, errBody(401, u.pathname));
    if (key === 'authz-permissions') {
      const perms = opts.permissions ?? ['iaas.server.get', 'iaas.server.list', 'service-enablement.service.list'];
      return json(200, { items: perms.length > 0 ? [{ resourceId: PROJECT_ID, resourceType: 'project', permissions: perms.map((name) => ({ name, description: name })) }] : [] });
    }
    if (key === 'authz-memberships') {
      const roles = opts.roles ?? ['reader'];
      return json(200, { items: roles.map((role) => ({ resourceId: PROJECT_ID, resourceType: 'project', role, subject: SA_EMAIL })) });
    }
    let m = /^az-(.+)$/.exec(key);
    if (m) return json(200, { items: [`${m[1]}-1`, `${m[1]}-2`, `${m[1]}-3`, `${m[1]}-m`] });
    m = /^se-(.+)$/.exec(key);
    if (m) {
      const pages = opts.services?.[m[1] as string] ?? [[{ serviceId: 'cloud.stackit.mock-a', state: 'ENABLED' }, { serviceId: 'cloud.stackit.mock-b', state: 'DISABLED' }]];
      const idx = Number(u.searchParams.get('cursor') ?? '0');
      const page = pages[idx] ?? [];
      return json(200, { items: page, ...(idx + 1 < pages.length ? { nextCursor: String(idx + 1) } : {}) });
    }
    m = /^kms-rings-(.+)$/.exec(key);
    if (m) return json(200, { keyRings: opts.keyRings?.[m[1] as string] ?? [] });
    m = /^kms-keys-(.+)$/.exec(key);
    if (m) return json(200, { keys: opts.keys?.[m[1] as string] ?? [] });
    m = /^lb-(.+)$/.exec(key);
    if (m) return json(200, { loadBalancers: opts.loadBalancers?.[m[1] as string] ?? [] });
    m = /^backup-(.+)$/.exec(key);
    if (m) {
      const items = opts.schedules?.[m[1] as string];
      return items === undefined ? json(404, errBody(404, u.pathname)) : json(200, { items });
    }
    if (key === 'rm-list-projects' || key === 'rm-list-folders') {
      const parent = u.searchParams.get('containerParentId');
      if (parent !== null) {
        const c = opts.rmChildren?.[parent];
        if (c === undefined) return json(403, { timeStamp: '2026-11-05T00:00:00Z', path: u.pathname, status: 403, error: 'Forbidden', message: 'You are not allowed to perform this action.' });
        return json(200, { items: (key === 'rm-list-projects' ? c.projects : c.folders) ?? [], offset: 0, limit: 100 });
      }
      if (key === 'rm-list-folders') return json(400, errBody(400, u.pathname));
      const items = opts.rmProjects ?? [{ containerId: 'project-test0001', creationTime: '2026-11-02T19:14:39Z', labels: {}, lifecycleState: 'ACTIVE', name: 'test-project', parent: { id: RM_ORG_ID, containerId: RM_ORG_CONTAINER, type: 'ORGANIZATION' }, projectId: PROJECT_ID, updateTime: '2026-11-02T19:14:56Z' }];
      return json(200, { items, offset: 0, limit: 100 });
    }
    if (key === 'rm-folder') {
      const f = opts.rmFolders?.[u.pathname.split('/')[3] ?? ''];
      return f === undefined ? json(403, { timeStamp: '2026-11-05T00:00:00Z', path: u.pathname, status: 403, error: 'Forbidden', message: 'You are not allowed to perform this action.' }) : json(200, f);
    }
    if (key === 'rm-organization') {
      return opts.rmOrganization === undefined ? json(403, { timeStamp: '2026-11-05T00:00:00Z', path: u.pathname, status: 403, error: 'Forbidden', message: 'You are not allowed to perform this action.' }) : json(200, opts.rmOrganization);
    }
    m = /^os-buckets-(.+)$/.exec(key);
    if (m) {
      const b = opts.buckets?.[m[1] as string];
      return b === null ? json(404, { detail: [{ key: 'project.not_found', msg: 'The project could not be found' }] }) : json(200, { buckets: b ?? [], project: PROJECT_ID });
    }
    m = /^mssql-list-(.+)$/.exec(key);
    if (m) {
      const all = opts.sqlserver?.[m[1] as string] ?? [];
      return json(200, { instances: all.map((i) => ({ id: i['id'], name: i['name'], state: i['state'], isDeletable: true })), pagination: { page: 1, size: 100, sort: 'id.asc', totalPages: 1, totalRows: all.length } });
    }
    m = /^mssql-get-([^-]+\d+)-(.+)$/.exec(key);
    if (m) {
      const i = (opts.sqlserver?.[m[1] as string] ?? []).find((x) => x['id'] === m?.[2]);
      return i === undefined ? json(404, errBody(404, u.pathname)) : json(200, i);
    }
    m = /^(pg|mongo)-list-(.+)$/.exec(key);
    if (m) {
      const all = (m[1] === 'pg' ? opts.postgres : opts.mongodb)?.[m[2] as string] ?? [];
      if (m[1] === 'mongo') return u.searchParams.has('tag') ? json(200, { count: all.length, items: all.map((i) => ({ id: i['id'], name: i['name'], status: i['status'] })) }) : json(400, { code: 400, message: 'missing tag' });
      return json(200, { instances: all.map((i) => ({ id: i['id'], name: i['name'], state: i['state'], isDeletable: true })), pagination: { page: 1, size: 100, sort: 'id.asc', totalPages: 1, totalRows: all.length } });
    }
    m = /^(pg|mongo)-get-([^-]+\d+)-(.+)$/.exec(key);
    if (m) {
      const i = ((m[1] === 'pg' ? opts.postgres : opts.mongodb)?.[m[2] as string] ?? []).find((x) => x['id'] === m?.[3]);
      if (i === undefined) return json(404, errBody(404, u.pathname));
      return json(200, m[1] === 'mongo' ? { item: i } : i);
    }
    m = /^sfs-(.+)$/.exec(key);
    if (m) {
      if (opts.sfsClosed?.includes(m[1] as string)) throw new TypeError('fetch failed');
      return json(200, { resourcePools: opts.resourcePools?.[m[1] as string] ?? [] });
    }
    if (key === 'cdn') return json(200, { distributions: opts.distributions ?? [] });
    if (key === 'members') return json(200, { members: opts.members ?? [{ subject: SA_EMAIL, role: 'reader' }], resourceId: PROJECT_ID, resourceType: 'project' });
    if (key === 'auditlog') return opts.auditStatus === 200 ? json(200, { items: [] }) : { ok: false, status: opts.auditStatus ?? 404, headers: { get: () => null }, text: async () => '' };
    m = /^iaas-(quotas)-(.+)$/.exec(key);
    if (m) return json(200, { quotas: { vcpu: { limit: 100, usage: 8 }, volumes: { limit: 50, usage: 2 } } });
    m = /^iaas-([a-z-]+)-(.+)$/.exec(key);
    if (m) return json(200, { items: opts.resources?.[`${m[1]}-${m[2]}`] ?? [] });
    return json(404, errBody(404, u.pathname));
  };
  return { fetch, calls };
}
