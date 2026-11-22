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

// #3572 test fixture: an in-process mock of the OTC APIs the `otc` driver
// reads, served through the injected transport (the pattern of
// live/__tests__/fake-driver.ts). Wire formats follow the published OTC IAM
// API reference (opentelekomcloud-docs/identity-access-management) and the
// shapes recorded by the partner hackathon on 2026-10-28 (handover 03);
// every id, name and URL here is neutral test data, never a tenant value.

import type { FetchLike } from '../../types.js';

export const DOMAIN_ID = 'd0000000000000000000000000000001';
export const USER_ID = 'u0000000000000000000000000000001';
export const GROUP_ID = 'g0000000000000000000000000000001';
export const PROJECT_IDS: Record<string, string> = { 'eu-de': 'p00000000000000000000000000000de', 'eu-nl': 'p00000000000000000000000000000nl' };

export const READONLY_ROLE = {
  catalog: 'BASE',
  display_name: 'Guest',
  name: 'readonly',
  policy: { Version: '1.0', Statement: [{ Action: ['*:*:Get*', '*:*:List*'], Effect: 'Allow' }, { Action: ['identity:*'], Effect: 'Deny' }] },
};
export const ADMIN_ROLE = {
  catalog: 'BASE',
  display_name: 'Tenant Administrator',
  name: 'te_admin',
  policy: { Version: '1.0', Statement: [{ Action: ['*:*:*'], Effect: 'Allow' }, { Action: ['identity:*:*'], Effect: 'Deny' }] },
};
export const AOM_RO_ROLE = {
  display_name: 'AOM ReadOnlyAccess',
  name: 'aom_ro',
  policy: { Version: '1.1', Statement: [{ Action: ['aom:*:list*', 'aom:*:get*'], Effect: 'Allow' }] },
};

export interface MockCall {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

export interface MockOptions {
  /** Regions whose project token is issued (others get 401). */
  regions?: string[];
  roles?: unknown[];
  /** Status override per route key (see `routeKey`), e.g. { 'rms-resources': 403 }. */
  fail?: Record<string, number>;
  /** Catalogue types per region (default below). */
  catalogTypes?: Record<string, string[]>;
  resourcesPages?: unknown[][];
  traces?: { trace_name: string; read_only?: boolean; user?: { name: string }; source_ip?: string }[][];
  prices?: Record<string, unknown[]>;
  rmsProviders?: unknown[];
  /** Refuse the domain-scoped token (401), to test the fallback path. */
  noDomainToken?: boolean;
  /** #3865 posture reads: ELB v3 listeners, RDS v3 instances, CBR vaults and policies (all regions). */
  listeners?: unknown[];
  rdsInstances?: unknown[];
  vaults?: unknown[];
  policies?: unknown[];
  trackers?: unknown[];
  /**
   * #3951 OBS: documents per bucket and sub-resource (`null` answers the
   * documented 404 "not configured"; a number answers that status with an
   * OBS XML error). Buckets not named answer 404 NoSuchBucket.
   */
  buckets?: Record<string, Partial<Record<'encryption' | 'acl' | 'policy' | 'lifecycle', string | null | number>>>;
  /** #3954 APIG: API groups and APIs of every instance. */
  apigGroups?: unknown[];
  apigApis?: unknown[];
}

/** #3951: the temporary AK/SK the mock issues (synthetic). */
export const MOCK_TEMP_AK = 'MOCKTEMPORARYAK';
export const MOCK_TEMP_SK = ['mock', 'temporary', 'sk'].join('-');
export const MOCK_TEMP_TOKEN = ['mock', 'security', 'token'].join('-');

const DEFAULT_TYPES: Record<string, string[]> = {
  'eu-de': ['identity', 'compute', 'network', 'vpc', 'volumev2', 'rms', 'ctsv3', 'apigv2', 'aomv2', 'kms', 'rdsv3', 'cce', 'elbv3', 'cbr', 'object'],
  'eu-nl': ['identity', 'compute', 'network', 'vpc', 'volumev2', 'rms', 'ctsv3', 'aomv2', 'kms', 'rdsv3', 'cce', 'elbv3', 'cbr'],
};

function host(type: string): string {
  return `https://${type.replace(/v\d.*$/, '')}.mock.otc.example`;
}

/** #3951 / #3954: the OBS endpoint has no path (live catalogue type `object`); APIG v2 is `/v2/<project>`. */
function endpointUrl(type: string, region: string): string {
  if (type === 'identity') return 'https://iam.mock.otc.example/v3';
  if (type === 'object') return `https://obs.${region}.mock.otc.example`;
  if (type === 'apigv2') return `${host(type)}/v2/${PROJECT_IDS[region] ?? 'p'}`;
  return `${host(type)}/${type === 'rms' ? 'v1' : `v3/${PROJECT_IDS[region] ?? 'p'}`}`;
}

export function catalogFor(region: string, types: string[]): unknown[] {
  return types.map((type) => ({
    type,
    id: `c-${type}`,
    name: type,
    endpoints: [{ id: `e-${type}-${region}`, interface: 'public', region, region_id: type === 'identity' ? '*' : region, url: endpointUrl(type, region) }],
  }));
}

export const DEFAULT_PROVIDERS = [
  { provider: 'ecs', resource_types: [{ name: 'cloudservers', global: false, regions: ['eu-de', 'eu-nl'] }] },
  { provider: 'apig', resource_types: [{ name: 'instances', global: false, regions: ['eu-de'] }] },
  { provider: 'iam', resource_types: [{ name: 'users', global: true, regions: [] }] },
];

export const DEFAULT_PRICES: Record<string, unknown[]> = {
  ecs: [{ id: 'OTC_S3_L4', productName: 's3.large.4', unit: 'h', region: 'eu-de', priceAmount: '0.051175 EUR', currency: 'EUR' }],
  cci: [{ id: 'OTC_CCI_1', productName: 'CCI vCPU', unit: 'h', region: 'eu-de', priceAmount: '0,010000 EUR', currency: 'EUR' }],
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Awaited<ReturnType<FetchLike>> {
  const h = new Map(Object.entries({ 'content-type': 'application/json', ...headers }).map(([k, v]) => [k.toLowerCase(), v]));
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status < 400, status, headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null }, text: async () => text };
}

export function routeKey(path: string, hostname = ''): string {
  if (/^[^.]+\.obs\./.test(hostname)) return 'obs';
  if (path === '/v3.0/OS-CREDENTIAL/securitytokens') return 'securitytokens';
  if (/\/apigw\/instances\/[^/]+\/api-groups$/.test(path)) return 'apig-groups';
  if (/\/apigw\/instances\/[^/]+\/apis$/.test(path)) return 'apig-apis';
  if (path.endsWith('/v3/auth/tokens')) return 'token';
  if (/\/v3\/users\/[^/]+\/groups$/.test(path)) return 'user-groups';
  if (/\/v3\/domains\/[^/]+\/groups\/[^/]+\/roles$/.test(path)) return 'domain-roles';
  if (/\/v3\/projects\/[^/]+\/groups\/[^/]+\/roles$/.test(path)) return 'project-roles';
  if (/\/OS-INHERIT\/domains\/[^/]+\/groups\/[^/]+\/roles\/inherited_to_projects$/.test(path)) return 'inherited-roles';
  if (path.endsWith('/providers')) return 'rms-providers';
  if (path.endsWith('/all-resources')) return 'rms-resources';
  if (path.endsWith('/os-availability-zone')) return 'azs';
  if (path.endsWith('/trackers')) return 'cts-trackers';
  if (path.endsWith('/traces')) return 'cts-traces';
  if (path.includes('open-telekom-price-api')) return 'price';
  if (path.endsWith('/elb/listeners')) return 'elb-listeners';
  if (/\/v3\/[^/]+\/instances$/.test(path)) return 'rds-instances';
  if (path.endsWith('/vaults')) return 'cbr-vaults';
  if (/\/v3\/[^/]+\/policies$/.test(path)) return 'cbr-policies';
  return 'unknown';
}

export function makeOtcMock(opts: MockOptions = {}): { fetch: FetchLike; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const regions = opts.regions ?? ['eu-de', 'eu-nl'];
  const fetchImpl: FetchLike = async (url, init) => {
    const u = new URL(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url, path: u.pathname, headers: init?.headers ?? {}, ...(init?.body !== undefined ? { body: init.body } : {}) });
    const key = routeKey(u.pathname, u.hostname);
    const failed = opts.fail?.[key];
    if (failed !== undefined) return json(failed, { error: { code: String(failed), message: `mock ${key} ${failed}` } });
    switch (key) {
      case 'token': {
        const body = JSON.parse(init?.body ?? '{}') as { auth?: { scope?: { project?: { name?: string }; domain?: { name?: string } } } };
        if (body.auth?.scope?.domain && !opts.noDomainToken) {
          // Live 2026-11-03: a domain-scoped token carries an empty catalogue.
          return json(201, {
            token: {
              methods: ['password'],
              expires_at: '2099-01-01T00:00:00.000000Z',
              user: { id: USER_ID, name: 'mock-user', domain: { id: DOMAIN_ID, name: 'MOCK-DOMAIN' } },
              domain: { id: DOMAIN_ID, name: 'MOCK-DOMAIN' },
              roles: [{ name: 'readonly', id: 'r1' }],
              catalog: [],
            },
          }, { 'X-Subject-Token': 'mock-token-domain' });
        }
        const project = body.auth?.scope?.project?.name ?? '';
        if (!regions.includes(project)) return json(401, { error: { code: 401, message: 'The request you have made requires authentication.' } });
        return json(201, {
          token: {
            methods: ['password'],
            expires_at: '2099-01-01T00:00:00.000000Z',
            user: { id: USER_ID, name: 'mock-user', domain: { id: DOMAIN_ID, name: 'MOCK-DOMAIN' } },
            project: { id: PROJECT_IDS[project], name: project, domain: { id: DOMAIN_ID } },
            roles: [{ name: 'readonly', id: 'r1' }],
            catalog: catalogFor(project, (opts.catalogTypes ?? DEFAULT_TYPES)[project] ?? []),
          },
        }, { 'X-Subject-Token': `mock-token-${project}` });
      }
      case 'domain-roles':
      case 'project-roles':
      case 'inherited-roles':
        // Live 2026-11-03: with a project-scoped token IAM refuses the role
        // queries (403, "Policy doesn't allow iam:permissions:listRolesForGroupOnDomain").
        if ((init?.headers ?? {})['x-auth-token'] !== 'mock-token-domain') {
          return json(403, { error: { code: 403, message: "Policy doesn't allow iam:permissions:listRolesForGroupOnDomain to be performed.", title: 'Forbidden' } });
        }
        return json(200, { roles: key === 'domain-roles' ? opts.roles ?? [READONLY_ROLE] : [] });
      case 'user-groups':
        return json(200, { groups: [{ id: GROUP_ID, name: 'read-only admin', domain_id: DOMAIN_ID }] });
      case 'rms-providers':
        return json(200, { resource_providers: opts.rmsProviders ?? DEFAULT_PROVIDERS });
      case 'rms-resources': {
        const pages = opts.resourcesPages ?? [[]];
        const marker = u.searchParams.get('marker');
        const i = marker === null ? 0 : Number(marker.replace('m', ''));
        const next = i + 1 < pages.length ? `m${i + 1}` : null;
        return json(200, { resources: pages[i] ?? [], page_info: { current_count: (pages[i] ?? []).length, next_marker: next } });
      }
      case 'azs': {
        const region = u.pathname.includes(PROJECT_IDS['eu-nl'] as string) ? 'eu-nl' : 'eu-de';
        return json(200, { availabilityZoneInfo: [1, 2, 3].map((n) => ({ zoneName: `${region}-0${n}`, zoneState: { available: n !== 3 } })) });
      }
      case 'elb-listeners':
        return json(200, { listeners: opts.listeners ?? [], page_info: { current_count: (opts.listeners ?? []).length } });
      case 'rds-instances':
        return json(200, { instances: opts.rdsInstances ?? [], total_count: (opts.rdsInstances ?? []).length });
      case 'cbr-vaults':
        return json(200, { vaults: opts.vaults ?? [], count: (opts.vaults ?? []).length, offset: 0, limit: 1000 });
      case 'cbr-policies':
        return json(200, { policies: opts.policies ?? [], count: (opts.policies ?? []).length });
      case 'cts-trackers':
        if (opts.trackers) return json(200, { trackers: opts.trackers });
        return json(200, { trackers: [{ tracker_name: 'system', tracker_type: 'system', status: 'enabled', is_support_validate: true, lts: { is_lts_enabled: false } }] });
      case 'cts-traces': {
        const pages = opts.traces ?? [[]];
        const next = u.searchParams.get('next');
        const i = next === null ? 0 : Number(next.replace('t', ''));
        const marker = i + 1 < pages.length ? `t${i + 1}` : null;
        return json(200, { traces: pages[i] ?? [], meta_data: { count: (pages[i] ?? []).length, marker } });
      }
      case 'securitytokens': {
        // IAM "Obtaining a Temporary AK/SK" (token method): 201 with credential.{access, secret, securitytoken, expires_at}.
        const body = JSON.parse(init?.body ?? '{}') as { auth?: { identity?: { methods?: string[]; token?: { duration_seconds?: number } } } };
        if (method !== 'POST' || !body.auth?.identity?.methods?.includes('token') || (init?.headers ?? {})['x-auth-token'] === undefined) return json(400, { error: { code: '400', message: 'bad request' } });
        return json(201, { credential: { access: MOCK_TEMP_AK, secret: MOCK_TEMP_SK, securitytoken: MOCK_TEMP_TOKEN, expires_at: '2099-01-01T00:00:00.000000Z' } });
      }
      case 'obs': {
        const xmlError = (status: number, code: string) => ({ ok: false, status, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/xml' : null) }, text: async () => `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>mock</Message></Error>` });
        const h = init?.headers ?? {};
        if (!/^OBS [^:]+:[A-Za-z0-9+/=]+$/.test(h['authorization'] ?? '') || h['x-obs-date'] === undefined) return xmlError(403, 'AccessDenied');
        const bucket = u.hostname.split('.')[0] as string;
        const sub = [...u.searchParams.keys()][0] as 'encryption' | 'acl' | 'policy' | 'lifecycle';
        const doc = opts.buckets?.[bucket]?.[sub];
        const notConfigured = { encryption: 'NoSuchEncryptionConfiguration', policy: 'NoSuchBucketPolicy', lifecycle: 'NoSuchLifecycleConfiguration', acl: 'NoSuchBucket' }[sub];
        if (opts.buckets?.[bucket] === undefined) return xmlError(404, 'NoSuchBucket');
        if (typeof doc === 'number') return xmlError(doc, doc === 403 ? 'AccessDenied' : 'InternalError');
        if (doc === null || doc === undefined) return xmlError(404, notConfigured);
        return { ok: true, status: 200, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? (sub === 'policy' ? 'application/json' : 'application/xml') : null) }, text: async () => doc };
      }
      case 'apig-groups':
        return json(200, { total: (opts.apigGroups ?? []).length, size: (opts.apigGroups ?? []).length, groups: opts.apigGroups ?? [] });
      case 'apig-apis':
        return json(200, { total: (opts.apigApis ?? []).length, size: (opts.apigApis ?? []).length, apis: opts.apigApis ?? [] });
      case 'price':
        return json(200, { response: { cachedAt: '2026-10-20 18:18:27', result: opts.prices ?? DEFAULT_PRICES } });
      default:
        return json(404, { error: { code: '404', message: 'not found' } });
    }
  };
  return { fetch: fetchImpl, calls };
}
