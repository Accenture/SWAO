// #3575: unit tests of the azure driver: probe verdicts, Azure Policy deny
// rules, the ARM alias table against lz-catalogues/azure.json, the token
// request (secret and RFC 7523 client assertion with x5t), ARM paging
// (nextLink off the ARM origin refused), 429 retry, 401 fail fast, the
// status rules per (region, service) and the Q-21 registration gate. The
// end-to-end runs against the spec-derived Azure mock are in
// swao/ops/mock-csp/contract/azure.contract.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { loadLzCatalogue, resolveLzCataloguesDir } from '../../../catalogue/loader.js';
import { createReadOnlyFetch } from '../../http.js';
import { LiveAuthError, LiveSourceUnavailableError } from '../../errors.js';
import { registerBuiltInLiveLzDrivers } from '../../builtin.js';
import { getLiveLzDriver, unregisterLiveLzDriver } from '../../registry.js';
import type { FetchLike, ScopeCtx } from '../../types.js';
import { AZURE_ARM_ALIASES, AZURE_TAG_CORRECTIONS, azureDriver, deniedTypes, probeFromRoles, readAzurePass23State, setAzureCatalogueForTests } from '../azure-driver.js';
import { AzureHttpError, armList, buildClientAssertion, jwtClaims, splitPem } from '../azure-client.js';
import { createThrottleRetryFetch, setThrottleSleepForTests } from '../../retry.js';

const SUB = '11111111-1111-1111-1111-111111111111';
const OID = '22222222-2222-2222-2222-222222222222';
const ARM = 'https://arm.mock.invalid';
const LOGIN = 'https://login.mock.invalid';

type Handler = (url: URL, init: { method?: string; headers?: Record<string, string>; body?: string }) => { status: number; body?: unknown; headers?: Record<string, string> };

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const ACCESS = `${b64({ alg: 'none' })}.${b64({ oid: OID, tid: 't' })}.sig`;

function fake(routes: Record<string, Handler>): { fetch: FetchLike; calls: { method: string; url: string; body?: string }[] } {
  const calls: { method: string; url: string; body?: string }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const u = new URL(url);
    calls.push({ method: init?.method ?? 'GET', url, ...(init?.body !== undefined ? { body: init.body } : {}) });
    const key = `${init?.method ?? 'GET'} ${u.pathname}`;
    const h = routes[key] ?? (u.pathname.endsWith('/oauth2/v2.0/token') ? () => ({ status: 200, body: { token_type: 'Bearer', expires_in: 3599, access_token: ACCESS } }) : undefined);
    const r = h ? h(u, init ?? {}) : { status: 404, body: { error: { code: 'X', message: 'no route' } } };
    const text = r.body === undefined ? '' : JSON.stringify(r.body);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null }, text: async () => text };
  };
  return { fetch: createReadOnlyFetch(fetchImpl, 'azure', azureDriver.readAllowList), calls };
}

function ctx(f: FetchLike, over: Partial<ScopeCtx> = {}): ScopeCtx {
  return {
    lzId: 'az', provider: 'azure', scopeId: 'platform', scopeKind: 'platform', auth: 'service-principal-secret', regions: ['germanywestcentral'],
    target: { subscription: SUB },
    credentials: { 'tenant-id': 't', 'client-id': 'c', 'client-secret': ['fake', 'value'].join('-') },
    http: { fetch: f, baseUrls: { login: LOGIN, arm: ARM } },
    sources: [],
    ...over,
  };
}

const provider = (ns: string, state: string, types: Record<string, string[]>) => ({ namespace: ns, registrationState: state, resourceTypes: Object.entries(types).map(([resourceType, locations]) => ({ resourceType, locations })) });

beforeEach(() => setThrottleSleepForTests(async () => undefined));
afterEach(() => { setAzureCatalogueForTests(undefined); setThrottleSleepForTests(undefined); });

describe('azure probe verdicts (Design 120 section 6.3)', () => {
  it('verifies */read roles, refuses anything outside */read, and is unverifiable without roles', () => {
    expect(probeFromRoles([{ roleName: 'Reader', actions: ['*/read'], dataActions: [] }]).read_only).toBe('verified');
    const refused = probeFromRoles([{ roleName: 'Contributor', actions: ['*'], dataActions: [] }, { roleName: 'Reader', actions: ['*/read'], dataActions: [] }]);
    expect(refused).toMatchObject({ read_only: 'refused', write_actions_allowed: ['*'] });
    expect(probeFromRoles([{ roleName: 'Data', actions: ['*/read'], dataActions: ['Microsoft.Storage/storageAccounts/blobServices/containers/blobs/write'] }]).read_only).toBe('refused');
    expect(probeFromRoles([]).read_only).toBe('unverifiable');
  });
});

describe('azure policy deny rules (shape of the spec example getBuiltinPolicyDefinition.json)', () => {
  it('reads type equals / in with parameter references and a Deny effect; ignores audit and mixed conditions', () => {
    const rule = { if: { field: 'type', in: "[parameters('types')]" }, then: { effect: 'Deny' } };
    expect(deniedTypes(rule, {}, { types: { value: ['Microsoft.Cache/redis'] } })).toEqual(['microsoft.cache/redis']);
    expect(deniedTypes({ if: { field: 'type', equals: 'Microsoft.Sql/servers' }, then: { effect: "[parameters('effect')]" } }, { effect: { defaultValue: 'deny' } }, {})).toEqual(['microsoft.sql/servers']);
    expect(deniedTypes({ if: { field: 'type', equals: 'x/y' }, then: { effect: 'audit' } }, {}, {})).toEqual([]);
    expect(deniedTypes({ if: { allOf: [{ field: 'type', equals: 'x/y' }, { field: 'sku', equals: 'z' }] }, then: { effect: 'Deny' } }, {}, {})).toEqual([]);
    expect(deniedTypes({ if: { not: { field: 'location', in: ['a'] } }, then: { effect: 'Deny' } }, {}, {})).toEqual([]);
  });
});

describe('azure ARM alias table', () => {
  it('every alias resolves to a code of lz-catalogues/azure.json, and the D-094-08 SQL correction drops postgresql / mysql', () => {
    const dir = resolveLzCataloguesDir();
    expect(dir).toBeTruthy();
    const cat = loadLzCatalogue(dir as string, 'azure');
    const codes = new Set(cat.regions.flatMap((r) => r.services.map((s) => s.code)));
    for (const [type, candidates] of Object.entries(AZURE_ARM_ALIASES)) {
      expect(type).toBe(type.toLowerCase());
      expect(candidates.some((c) => codes.has(c)), type).toBe(true);
    }
    for (const code of Object.keys(AZURE_TAG_CORRECTIONS)) expect(AZURE_TAG_CORRECTIONS[code]).toEqual([]);
  });
});

describe('azure token request', () => {
  it('posts the client secret form (RFC 6749) to the login base and caches one token per scope run', async () => {
    const { fetch, calls } = fake({ [`GET /subscriptions/${SUB}/locations`]: () => ({ status: 200, body: { value: [] } }) });
    const c = ctx(fetch);
    await armList(c, `/subscriptions/${SUB}/locations`, 'r', '2022-12-01');
    await armList(c, `/subscriptions/${SUB}/locations`, 'r', '2022-12-01');
    const tok = calls.filter((x) => x.url.endsWith('/oauth2/v2.0/token'));
    expect(tok).toHaveLength(1);
    expect(tok[0]?.url).toBe(`${LOGIN}/t/oauth2/v2.0/token`);
    const form = new URLSearchParams(tok[0]?.body);
    expect(Object.fromEntries(form)).toMatchObject({ grant_type: 'client_credentials', client_id: 'c', scope: 'https://management.azure.com/.default' });
    expect(form.get('client_secret')).toBeTruthy();
    expect(calls[1]?.url).toBe(`${ARM}/subscriptions/${SUB}/locations?api-version=2022-12-01`);
  });

  it('builds an RS256 client assertion (RFC 7523) with iss, sub, aud and a verifiable signature; x5t only with a certificate block', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const a = buildClientAssertion('c', 'https://login/t/oauth2/v2.0/token', pem, 1000, 'j');
    const [h, p, s] = a.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(jwtClaims(a)).toMatchObject({ iss: 'c', sub: 'c', aud: 'https://login/t/oauth2/v2.0/token', jti: 'j', exp: 1600 });
    expect(verify('sha256', Buffer.from(`${h}.${p}`), createPublicKey(privateKey), Buffer.from(s, 'base64url'))).toBe(true);
    expect(splitPem(`${pem}\n-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----\n`).cert).toContain('BEGIN CERTIFICATE');
    expect(() => buildClientAssertion('c', 'u', 'not a pem')).toThrow(LiveAuthError);
  });

  it('turns a refused token request (401) into LiveAuthError', async () => {
    const { fetch } = fake({ 'POST /t/oauth2/v2.0/token': () => ({ status: 401, body: { error: 'invalid_client', error_description: 'bad' } }) });
    await expect(armList(ctx(fetch), `/subscriptions/${SUB}/locations`, 'r', 'v')).rejects.toBeInstanceOf(LiveAuthError);
  });
});

describe('azure ARM transport', () => {
  it('follows nextLink on the ARM origin and refuses one that leaves it', async () => {
    const path = `/subscriptions/${SUB}/providers`;
    const ok = fake({ [`GET ${path}`]: (u) => (u.searchParams.get('$skiptoken') ? { status: 200, body: { value: [2] } } : { status: 200, body: { value: [1], nextLink: `${ARM}${path}?api-version=v&$skiptoken=1` } }) });
    expect(await armList(ctx(ok.fetch), path, 'r', 'v')).toEqual([1, 2]);
    const evil = fake({ [`GET ${path}`]: () => ({ status: 200, body: { value: [1], nextLink: `https://elsewhere.invalid${path}` } }) });
    await expect(armList(ctx(evil.fetch), path, 'r', 'v')).rejects.toBeInstanceOf(AzureHttpError);
    expect(evil.calls.some((c) => new URL(c.url).hostname === 'elsewhere.invalid')).toBe(false);
  });

  it('retries 429 after Retry-After through the shared transport rule (#3751) and fails fast on 401; an exhausted 429 is an AzureHttpError', async () => {
    const path = `/subscriptions/${SUB}/locations`;
    let n = 0;
    const slept: number[] = [];
    setThrottleSleepForTests(async (ms) => { slept.push(ms); });
    const t = fake({ [`GET ${path}`]: () => (n++ === 0 ? { status: 429, body: { error: { code: 'X', message: 'y' } }, headers: { 'retry-after': '2' } } : { status: 200, body: { value: ['x'] } }) });
    expect(await armList(ctx(createThrottleRetryFetch(t.fetch)), path, 'r', 'v')).toEqual(['x']);
    expect(slept).toEqual([2000]);
    const always = fake({ [`GET ${path}`]: () => ({ status: 429, body: { error: { code: 'X', message: 'y' } }, headers: { 'retry-after': '1' } }) });
    await expect(armList(ctx(createThrottleRetryFetch(always.fetch)), path, 'r', 'v')).rejects.toMatchObject({ status: 429 });
    const u = fake({ [`GET ${path}`]: () => ({ status: 401, body: { error: { code: 'X', message: 'y' } } }) });
    await expect(armList(ctx(u.fetch), path, 'r', 'v')).rejects.toBeInstanceOf(LiveAuthError);
  });

  it('refuses a request the read-only allow-list does not hold', async () => {
    const { fetch } = fake({});
    await expect(fetch(`${ARM}/subscriptions/${SUB}/providers/Microsoft.Compute/register`, { method: 'POST' })).rejects.toThrow(/read allow-list/);
  });
});

describe('azure status rules (Design 120 section 5.3)', () => {
  const CAT = {
    meta: { schema_version: '0.1', name: 'test', provider: 'azure', last_updated: '2026-11-01', source: { mode: 'api', tool: 't', operator: 'o' }, confidence: 'high', regions_count: 1 },
    regions: [{ id: 'germanywestcentral', name: 'Germany West Central', country: 'DE', services: ['Azure Kubernetes Service', 'Azure Cache for Redis', 'Azure Cosmos DB', 'Virtual Machines', 'Azure SQL Database', 'Azure Bastion'].map((code) => ({ code, name: code, status: 'ga', capabilities: [], fulfills: code === 'Azure SQL Database' ? ['postgresql'] : ['x'], key_custody: [], last_verified: '2026-11-01', source: 'test' })) }],
  } as unknown as Parameters<typeof setAzureCatalogueForTests>[0];

  it('maps Registered, NotRegistered, Registering, missing region, policy deny and unmapped codes', async () => {
    setAzureCatalogueForTests(CAT);
    const { fetch } = fake({
      [`GET /subscriptions/${SUB}/providers`]: () => ({ status: 200, body: { value: [
        provider('Microsoft.ContainerService', 'Registered', { managedClusters: ['Germany West Central'] }),
        provider('Microsoft.Cache', 'Registered', { redis: ['germanywestcentral'] }),
        provider('Microsoft.DocumentDB', 'NotRegistered', { databaseAccounts: ['Germany West Central'] }),
        provider('Microsoft.Compute', 'Registering', { virtualMachines: ['Germany West Central'] }),
        provider('Microsoft.Sql', 'Registered', { servers: ['Sweden Central'] }),
      ] } }),
      [`GET /subscriptions/${SUB}/providers/Microsoft.Authorization/policyAssignments`]: () => ({ status: 200, body: { value: [{ name: 'deny-redis', properties: { policyDefinitionId: `/subscriptions/${SUB}/providers/Microsoft.Authorization/policyDefinitions/d`, parameters: { t: { value: ['Microsoft.Cache/redis'] } }, enforcementMode: 'Default' } }] } }),
      [`GET /subscriptions/${SUB}/providers/Microsoft.Authorization/policyDefinitions/d`]: () => ({ status: 200, body: { properties: { policyRule: { if: { field: 'type', in: "[parameters('t')]" }, then: { effect: 'Deny' } } } } }),
    });
    const c = ctx(fetch);
    const services = await azureDriver.listServices(c, 'germanywestcentral');
    const st = (code: string) => services.find((s) => s.catalogue_code === code)?.regions['germanywestcentral']?.status;
    expect(st('Azure Kubernetes Service')).toBe('enabled');
    expect(st('Azure Cache for Redis')).toBe('restricted');
    expect(st('Azure Cosmos DB')).toBe('available_not_enabled');
    expect(st('Virtual Machines')).toBe('unknown');
    expect(st('Azure SQL Database')).toBe('not_offered');
    expect(services.find((s) => s.catalogue_code === 'Azure SQL Database')?.capability_tags).toEqual([]);
    expect(services.find((s) => s.catalogue_code === 'Azure Bastion')?.regions['germanywestcentral']).toMatchObject({ status: 'unknown', evidence: [{ ref: 'providers:no-arm-mapping' }] });
    const guardrails = await azureDriver.listGuardrails(c);
    expect(guardrails[0]).toMatchObject({ type: 'azure-policy', id: 'deny-redis', status: 'pass' });
  });

  it('marks every mapped service unknown with the HTTP status when the providers list is refused', async () => {
    setAzureCatalogueForTests(CAT);
    const { fetch } = fake({ [`GET /subscriptions/${SUB}/providers`]: () => ({ status: 403, body: { error: { code: 'X', message: 'y' } } }) });
    const c = ctx(fetch);
    const services = await azureDriver.listServices(c, 'germanywestcentral');
    expect(services.find((s) => s.catalogue_code === 'Azure Kubernetes Service')?.regions['germanywestcentral']).toMatchObject({ status: 'unknown', evidence: [{ http_status: 403 }] });
    expect(c.sources).toContainEqual({ name: 'providers:germanywestcentral', status: 'not_collected', http_status: 403 });
  });

  it('reports quotas and activity as not collected, and needs a subscription target', async () => {
    const { fetch } = fake({});
    await expect(azureDriver.listQuotas(ctx(fetch), 'x')).rejects.toBeInstanceOf(LiveSourceUnavailableError);
    await expect(azureDriver.listActivity(ctx(fetch), { days: 7 })).rejects.toBeInstanceOf(LiveSourceUnavailableError);
    await expect(azureDriver.listRegions(ctx(fetch, { target: {} }))).rejects.toThrow(/target.subscription/);
  });
});

describe('azure Pass 23 state (Design 120 section 7.5)', () => {
  it('reads AKS, PostgreSQL, Redis, Key Vault and VNet rows from one Resource Graph query', async () => {
    const rows = [
      { name: 'aks', type: 'microsoft.containerservice/managedclusters', properties: { provisioningState: 'Succeeded', kubernetesVersion: '1.30' } },
      { name: 'pg', type: 'microsoft.dbforpostgresql/flexibleservers', properties: { state: 'Ready', version: '16' } },
      { name: 'r', type: 'microsoft.cache/redis', properties: { provisioningState: 'Succeeded' } },
      { name: 'kv', type: 'microsoft.keyvault/vaults', properties: {} },
      { name: 'v1', type: 'microsoft.network/virtualnetworks', properties: {} },
    ];
    let body: any;
    const { fetch } = fake({ 'POST /providers/Microsoft.ResourceGraph/resources': (_u, init) => { body = JSON.parse(init.body ?? '{}'); return { status: 200, body: { totalRecords: 5, count: 5, data: rows, resultTruncated: 'false' } }; } });
    const s = await readAzurePass23State(ctx(fetch));
    expect(body).toMatchObject({ query: 'Resources | project id, name, type, properties', subscriptions: [SUB] });
    expect(s).toEqual({
      aks_clusters: [{ name: 'aks', provisioningState: 'Succeeded', kubernetesVersion: '1.30' }],
      postgresql_servers: [{ name: 'pg', state: 'Ready', version: '16' }],
      redis_instances: [{ name: 'r', provisioningState: 'Succeeded' }],
      keyvault_vaults: [{ name: 'kv' }],
      vnet_count: 1,
    });
  });
});

describe('azure registration (Q-21)', () => {
  afterEach(() => unregisterLiveLzDriver('azure'));
  it('is not live-verified, so it registers only when SWAO_LZ_UNVERIFIED_DRIVERS names it; managed identity is not offered', () => {
    expect(azureDriver.liveVerified).toBe(false);
    expect(azureDriver.authMethods.map((m) => m.id)).toEqual(['service-principal-secret', 'service-principal-certificate']);
    unregisterLiveLzDriver('azure');
    expect(registerBuiltInLiveLzDrivers({})).not.toContain('azure');
    expect(getLiveLzDriver('azure')).toBeUndefined();
    // #3831: the gate stays for azure (mock only); the three live-verified drivers register anyway.
    expect(registerBuiltInLiveLzDrivers({ SWAO_LZ_UNVERIFIED_DRIVERS: 'azure' })).toContain('azure');
    expect(getLiveLzDriver('azure')).toBe(azureDriver);
  });
});
