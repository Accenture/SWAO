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

// #3572: mock-server contract tests of the `otc` live driver (CLAUDE.md
// section 5.9, Design 120 section 7.1): request shape, happy path and the
// 401 / 403 / 404 / 5xx paths, plus the Q-21 registration gate, the scan
// assembler and `swao lz scan --mode live`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CredentialStore, LzLiveMergedSchema, LzLiveScanSchema, parseLzCatalogue, parseLzProbeScopeLine } from '@swao/core';
import { load as yamlLoad } from 'js-yaml';
import { createReadOnlyFetch, LiveTokenRejectedError, ReadOnlyViolationError } from '../../http.js';
import { getLiveLzDriver, registeredLiveLzProviders, unregisterLiveLzDriver } from '../../registry.js';
import { LiveAuthError, LiveSourceUnavailableError } from '../../errors.js';
import { registerBuiltInLiveLzDrivers, UNVERIFIED_DRIVERS_ENV } from '../../builtin.js';
import { runLzLiveScan, mergeServices } from '../../scan.js';
import { lzScanAction } from '../../cli.js';
import { LiveLzDriverDescriptorSchema } from '../../types.js';
import type { ScopeCtx } from '../../types.js';
import { otcDriver, classifyTrace, parseOtcAmount } from '../otc-driver.js';
import { trimTrailingSlashes } from '../otc-client.js';
import { analyseRoles, isReadAction, probeFromRoles } from '../otc-probe.js';
import { OTC_SERVICES } from '../otc-services.js';
import { ADMIN_ROLE, AOM_RO_ROLE, DOMAIN_ID, GROUP_ID, PROJECT_IDS, READONLY_ROLE, USER_ID, makeOtcMock } from './otc-mock.js';
import type { MockOptions } from './otc-mock.js';
import { filterResourceAttributes, pseudonymiseName } from '../../privacy.js';

// Fake login values, built at runtime so no secret-shaped literal is committed.
const USERNAME = ['mock', 'user'].join('-');
const PASSWORD = ['mock', 'pass', 'value'].join('-');
const DOMAIN = ['MOCK', 'DOMAIN'].join('-');

const tmp: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmp.push(d);
  return d;
}

function ctxFor(opts: MockOptions = {}, over: Partial<ScopeCtx> = {}): { ctx: ScopeCtx; calls: ReturnType<typeof makeOtcMock>['calls'] } {
  const mock = makeOtcMock(opts);
  const ctx: ScopeCtx = {
    lzId: 'otc-test',
    provider: 'otc',
    scopeId: 'platform',
    scopeKind: 'platform',
    auth: 'iam-password-token',
    regions: ['eu-de', 'eu-nl'],
    target: {},
    credentials: { username: USERNAME, password: PASSWORD, domain: DOMAIN },
    http: { fetch: createReadOnlyFetch(mock.fetch, 'otc', otcDriver.readAllowList), baseUrls: { ...otcDriver.defaultBaseUrls } },
    sources: [],
    ...over,
  };
  return { ctx, calls: mock.calls };
}

beforeEach(() => unregisterLiveLzDriver());
afterEach(() => {
  unregisterLiveLzDriver();
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('otc driver descriptor and the Q-21 registration gate', () => {
  it('is a valid LiveLzDriver descriptor with the auth methods iam-password-token and aksk (#3685) and the token POST and the temporary AK/SK POST (#3951) as the only non-read rules', () => {
    expect(LiveLzDriverDescriptorSchema.safeParse(otcDriver).success).toBe(true);
    expect(otcDriver.authMethods.map((m) => m.id)).toEqual(['iam-password-token', 'aksk']);
    expect(otcDriver.authMethods[0]?.required).toEqual(['username', 'password', 'domain']);
    expect(otcDriver.readAllowList.map((r) => r.method)).toEqual(['POST', 'POST']);
    // #3951: the temporary AK/SK rule matches the IAM path exactly, nothing under or beside it.
    const sts = otcDriver.readAllowList[1]?.path;
    expect(sts?.test('/v3.0/OS-CREDENTIAL/securitytokens')).toBe(true);
    for (const p of ['/v3.0/OS-CREDENTIAL/credentials', '/v3.0/OS-CREDENTIAL/securitytokens/x', '/x/v3.0/OS-CREDENTIAL/securitytokens', '/v3.0/OS-CREDENTIAL/securitytokensX']) expect(sts?.test(p)).toBe(false);
    // #3831 (Q-21, owner decision 2026-11-04): registered for release.
    expect(otcDriver.liveVerified).toBe(true);
  });

  it('release build (#3831): otc, aws and stackit register without SWAO_LZ_UNVERIFIED_DRIVERS, azure does not', () => {
    expect(registerBuiltInLiveLzDrivers({})).toEqual(['otc', 'aws', 'stackit']);
    expect(getLiveLzDriver('otc')).toBe(otcDriver);
    expect(getLiveLzDriver('azure')).toBeUndefined();
    unregisterLiveLzDriver();
    // azure stays behind the variable
    expect(registerBuiltInLiveLzDrivers({ [UNVERIFIED_DRIVERS_ENV]: 'azure' })).toEqual(['otc', 'aws', 'azure', 'stackit']);
    expect(registeredLiveLzProviders()).toEqual(['aws', 'azure', 'otc', 'stackit']);
  });

  it('an unverified driver registers only when the operator names it', () => {
    expect(registerBuiltInLiveLzDrivers({}, [{ ...otcDriver, liveVerified: false }])).toEqual([]);
    expect(registerBuiltInLiveLzDrivers({ [UNVERIFIED_DRIVERS_ENV]: 'otc' }, [{ ...otcDriver, liveVerified: false }])).toEqual(['otc']);
  });
});

describe('IAM token request (POST /v3/auth/tokens)', () => {
  it('sends the password method with the project scope per region, once per region, and reads endpoints from the catalogue', async () => {
    const { ctx, calls } = ctxFor();
    await otcDriver.listRegions(ctx);
    await otcDriver.listServices(ctx, 'eu-de');
    const tokenCalls = calls.filter((c) => c.path.endsWith('/v3/auth/tokens'));
    expect(tokenCalls.map((c) => c.method)).toEqual(['POST', 'POST']);
    expect(tokenCalls[0]?.url).toBe('https://iam.eu-de.otc.t-systems.com/v3/auth/tokens');
    const body = JSON.parse(tokenCalls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body).toEqual({ auth: { identity: { methods: ['password'], password: { user: { name: USERNAME, password: PASSWORD, domain: { name: DOMAIN } } } }, scope: { project: { name: 'eu-de' } } } });
    expect(JSON.parse(tokenCalls[1]?.body ?? '{}').auth.scope.project.name).toBe('eu-nl');
    // every other call is a GET with the project token and goes to a catalogue endpoint
    const others = calls.filter((c) => !c.path.endsWith('/v3/auth/tokens'));
    expect(others.length).toBeGreaterThan(0);
    for (const c of others) {
      expect(c.method).toBe('GET');
      if (!c.url.includes('open-telekom-price-api')) expect(c.headers['x-auth-token']).toMatch(/^mock-token-eu-(de|nl)$/);
    }
    expect(others.find((c) => c.path.endsWith('/os-availability-zone'))?.url).toBe(`https://compute.mock.otc.example/v3/${PROJECT_IDS['eu-de']}/os-availability-zone`);
  });

  it('a 401 on every region stops with LiveAuthError and names the MFA possibility without echoing the login', async () => {
    const { ctx } = ctxFor({ regions: [] });
    const err = await otcDriver.listRegions(ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LiveAuthError);
    expect((err as LiveAuthError).httpStatus).toBe(401);
    expect((err as Error).message).toMatch(/virtual MFA/);
    expect((err as Error).message).not.toContain(PASSWORD);
    expect((err as Error).message).not.toContain(USERNAME);
  });

  it('missing vault fields fail before any request', async () => {
    const { ctx, calls } = ctxFor({}, { credentials: { username: USERNAME } });
    await expect(otcDriver.listRegions(ctx)).rejects.toBeInstanceOf(LiveAuthError);
    expect(calls).toHaveLength(0);
  });

  it('the read-only allow-list still refuses any other non-read request of the driver', async () => {
    const { ctx } = ctxFor();
    await expect(ctx.http.fetch('https://ecs.mock.otc.example/v1/p/cloudservers', { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(ReadOnlyViolationError);
  });
});

describe('probeReadOnly (Design 120 section 6.3)', () => {
  it('verified for the read-only role: Get* / List* allowed, identity:* denied; coverage is every service', async () => {
    const { ctx, calls } = ctxFor({ roles: [READONLY_ROLE] });
    const p = await otcDriver.probeReadOnly(ctx);
    expect(p.read_only).toBe('verified');
    expect(p.identity).toBe('groups: read-only admin');
    expect(p.coverage.unreadable).toEqual([]);
    expect(p.coverage.readable).toHaveLength(OTC_SERVICES.length);
    const paths = calls.map((c) => c.path);
    expect(paths).toContain(`/v3/users/${USER_ID}/groups`);
    expect(paths).toContain(`/v3/domains/${DOMAIN_ID}/groups/${GROUP_ID}/roles`);
    expect(paths).toContain(`/v3/OS-INHERIT/domains/${DOMAIN_ID}/groups/${GROUP_ID}/roles/inherited_to_projects`);
    expect(paths).toContain(`/v3/projects/${PROJECT_IDS['eu-de']}/groups/${GROUP_ID}/roles`);
    expect(paths).toContain(`/v3/projects/${PROJECT_IDS['eu-nl']}/groups/${GROUP_ID}/roles`);
    // the IAM permission queries carry the domain-scoped token (live finding 2026-11-03)
    const domainToken = calls.find((c) => c.path.endsWith('/v3/auth/tokens') && JSON.parse(c.body ?? '{}').auth.scope.domain);
    expect(JSON.parse(domainToken?.body ?? '{}').auth.scope).toEqual({ domain: { name: DOMAIN } });
    for (const c of calls.filter((x) => x.path.includes('/groups/'))) expect(c.headers['x-auth-token']).toBe('mock-token-domain');
  });

  it('a refused domain token stops the probe with LiveAuthError', async () => {
    const { ctx } = ctxFor({ noDomainToken: true });
    await expect(otcDriver.probeReadOnly(ctx)).rejects.toBeInstanceOf(LiveAuthError);
  });

  it('refused for the tenant administrator role and lists the write actions', async () => {
    const { ctx } = ctxFor({ roles: [ADMIN_ROLE] });
    const p = await otcDriver.probeReadOnly(ctx);
    expect(p.read_only).toBe('refused');
    expect(p.write_actions_allowed).toEqual(['*:*:*']);
  });

  it('coverage of the AOM read-only role is AOM only', async () => {
    const { ctx } = ctxFor({ roles: [AOM_RO_ROLE] });
    const p = await otcDriver.probeReadOnly(ctx);
    expect(p.read_only).toBe('verified');
    expect(p.coverage.readable).toEqual(['aom']);
    expect(p.coverage.unreadable).toContain('ecs');
  });

  it.each([403, 404, 500])('unverifiable (never verified) when the role query returns %i', async (status) => {
    const { ctx } = ctxFor({ fail: { 'domain-roles': status } });
    const p = await otcDriver.probeReadOnly(ctx);
    expect(p.read_only).toBe('unverifiable');
    expect(p.reason).toContain(`HTTP ${status}`);
    expect(p.reason).toMatch(/Security Administrator/);
  });

  it('unverifiable when the user groups are not readable', async () => {
    const { ctx } = ctxFor({ fail: { 'user-groups': 403 } });
    const p = await otcDriver.probeReadOnly(ctx);
    expect(p.read_only).toBe('unverifiable');
    expect(p.identity).toBe('roles: readonly');
  });

  it('maps the rms action prefix to the Config provider (AOM Global Access, live 2026-11-03)', () => {
    const roles = [{ display_name: 'AOM Global Access', policy: { Statement: [{ Action: ['rms:*:list*', 'rms:*:get*'], Effect: 'Allow' }] } }];
    const p = probeFromRoles('groups: read-only admin', roles);
    expect(p.read_only).toBe('verified');
    expect(p.coverage.readable).toEqual(['config']);
  });

  it('the recorded operator role set is refused with exactly its four non-read actions', () => {
    const roles = [
      { name: 'secu_admin', policy: { Statement: [{ Action: ['identity::*'], Effect: 'Allow' }] } },
      { name: 'te_agency', policy: { Statement: [{ Action: ['identity:assume role'], Effect: 'Allow' }] } },
      { name: 'te_admin', policy: { Statement: [{ Action: ['obs:*:*', '*:*:*'], Effect: 'Allow' }] } },
      { name: 'system_all_133', policy: { Statement: [{ Action: ['apig:*:get*', 'apig:*:list*', 'vpc:*:get*', 'vpc:*:list*'], Effect: 'Allow' }] } },
    ];
    const p = probeFromRoles('groups: read-only admin, admin', roles);
    expect(p.read_only).toBe('refused');
    expect(p.write_actions_allowed).toEqual(['*:*:*', 'identity::*', 'identity:assume role', 'obs:*:*']);
  });

  it('classifies actions: read verbs pass, wildcard and write verbs do not, an identical Deny cancels', () => {
    expect(isReadAction('ecs:servers:list')).toBe(true);
    expect(isReadAction('*:*:Get*')).toBe(true);
    expect(isReadAction('ecs:servers:get')).toBe(true);
    expect(isReadAction('ecs:*:*')).toBe(false);
    expect(isReadAction('ecs:servers:create')).toBe(false);
    expect(isReadAction('ecs')).toBe(false);
    expect(analyseRoles([{ policy: { Statement: [{ Action: ['ecs:servers:delete'], Effect: 'Allow' }, { Action: ['ecs:servers:delete'], Effect: 'Deny' }] } }]).writeActions).toEqual([]);
    expect(probeFromRoles('x', [{ name: 'legacy' }]).read_only).toBe('unverifiable');
    expect(probeFromRoles('x', []).read_only).toBe('unverifiable');
  });
});

describe('listRegions', () => {
  it('enabled regions with their AZs from os-availability-zone; a refused region is unknown with its token source', async () => {
    const { ctx } = ctxFor({ regions: ['eu-de'] });
    const regions = await otcDriver.listRegions(ctx);
    expect(regions).toEqual([
      { id: 'eu-de', country: 'DE', azs: [{ name: 'eu-de-01', available: true }, { name: 'eu-de-02', available: true }, { name: 'eu-de-03', available: false }], status: 'enabled' },
      { id: 'eu-nl', country: 'NL', azs: [], status: 'unknown' },
    ]);
    expect(ctx.sources).toContainEqual({ name: 'token:eu-nl', status: 'not_collected', http_status: 401 });
  });

  it('an AZ 5xx is recorded as a not collected source, the region stays enabled', async () => {
    const { ctx } = ctxFor({ fail: { azs: 503 } });
    const regions = await otcDriver.listRegions(ctx);
    expect(regions.every((r) => r.status === 'enabled' && r.azs.length === 0)).toBe(true);
    expect(ctx.sources).toContainEqual({ name: 'azs:eu-de', status: 'not_collected', http_status: 503 });
  });
});

describe('listServices (Design 120 section 5.3)', () => {
  it('endpoint in the token catalogue -> enabled; absent from API, inventory and price list -> not_offered', async () => {
    const { ctx } = ctxFor();
    const de = await otcDriver.listServices(ctx, 'eu-de');
    const nl = await otcDriver.listServices(ctx, 'eu-nl');
    const apigDe = de.find((s) => s.code === 'apig');
    expect(apigDe?.regions['eu-de']?.status).toBe('enabled');
    expect(apigDe?.regions['eu-de']?.evidence).toEqual([{ source: 'api', ref: 'token-catalogue:apigv2' }, { source: 'inventory', ref: 'rms-providers:apig' }]);
    expect(apigDe?.catalogue_code).toBe('API Gateway');
    expect(apigDe?.capability_tags).toEqual(['api_gateway']);
    // API Gateway is absent in eu-nl (Design 095 section 6.2)
    expect(nl.find((s) => s.code === 'apig')?.regions['eu-nl']?.status).toBe('not_offered');
    expect(de).toHaveLength(OTC_SERVICES.length);
  });

  it('no endpoint but price evidence -> unknown, never enabled or not_offered', async () => {
    const { ctx } = ctxFor();
    const cci = (await otcDriver.listServices(ctx, 'eu-de')).find((s) => s.code === 'cci');
    expect(cci?.regions['eu-de']).toMatchObject({ status: 'unknown', evidence: [{ source: 'price', ref: 'price-list:cci' }] });
  });

  it('inventory 403 and price 503: services without an endpoint are unknown with the HTTP statuses, endpoints still count', async () => {
    const { ctx } = ctxFor({ fail: { 'rms-providers': 403, price: 503 } });
    const de = await otcDriver.listServices(ctx, 'eu-de');
    expect(de.find((s) => s.code === 'ecs')?.regions['eu-de']?.status).toBe('enabled');
    expect(de.find((s) => s.code === 'ocr')?.regions['eu-de']).toMatchObject({
      status: 'unknown',
      evidence: [{ source: 'inventory', ref: 'rms-providers', http_status: 403 }, { source: 'price', ref: 'price-list', http_status: 503 }],
    });
    expect(ctx.sources).toContainEqual({ name: 'inventory:providers', status: 'not_collected', http_status: 403 });
    expect(ctx.sources).toContainEqual({ name: 'price', status: 'not_collected', http_status: 503 });
  });

  it('a refused region token makes every service unknown with the 401', async () => {
    const { ctx } = ctxFor({ regions: ['eu-de'] });
    const nl = await otcDriver.listServices(ctx, 'eu-nl');
    expect(nl.every((s) => s.regions['eu-nl']?.status === 'unknown' && s.regions['eu-nl']?.evidence[0]?.http_status === 401)).toBe(true);
  });

  it('reads the RMS provider directory on the domain path and the price list once per scope run', async () => {
    const { ctx, calls } = ctxFor();
    await otcDriver.listServices(ctx, 'eu-de');
    await otcDriver.listServices(ctx, 'eu-nl');
    const providers = calls.filter((c) => c.path.endsWith('/providers'));
    expect(providers.map((c) => c.url)).toEqual([`https://rms.mock.otc.example/v1/resource-manager/domains/${DOMAIN_ID}/providers?locale=en-us`]);
    const price = calls.filter((c) => c.url.includes('open-telekom-price-api'));
    expect(price.map((c) => c.url)).toEqual(['https://calculator.otc-service.com/en/open-telekom-price-api/?limitMax=10000']);
    expect(price[0]?.headers['x-auth-token']).toBeUndefined();
  });
});

describe('estate', () => {
  it('listResources pages via page_info.next_marker; the other RMS properties go into attributes, which the privacy filter cleans (#3886)', async () => {
    const page1 = [{ id: 'res-1', name: 'vm-of-a-person', provider: 'ecs', type: 'cloudservers', region_id: 'eu-de', tags: { owner: 'team-a', cost: 7 }, created: '2026-10-27T10:00:00Z', properties: { secret: 'x', OsExtAz: 'eu-de-01' } }];
    const page2 = [{ id: 'res-2', name: 'user-x', provider: 'iam', type: 'users', region_id: 'global', properties: { credentials: [{ access: 'AK' }] } }];
    const { ctx, calls } = ctxFor({ resourcesPages: [page1, page2] });
    const res = await otcDriver.listResources(ctx);
    // the driver keeps every returned property (Design 123 section 5.7) ...
    expect(res).toEqual([
      { id: 'res-1', type: 'ecs.cloudservers', service_code: 'ecs', region: 'eu-de', tags: { owner: 'team-a', cost: '7' }, created_at: '2026-10-27T10:00:00Z', attributes: { name: 'vm-of-a-person', 'properties.secret': 'x', 'properties.OsExtAz': 'eu-de-01' } },
      { id: 'res-2', type: 'iam.users', service_code: 'iam', region: 'global', attributes: { name: 'user-x', 'properties.credentials.0.access': 'AK' } },
    ]);
    const urls = calls.filter((c) => c.path.endsWith('/all-resources')).map((c) => new URL(c.url).search);
    expect(urls).toEqual(['?limit=200', '?limit=200&marker=m1']);
    // ... and the scan boundary's one privacy filter drops secrets and access keys and pseudonymises names (scan.ts)
    const clean = filterResourceAttributes(res, 's'.repeat(64)).resources;
    expect(clean[0]?.attributes).toEqual({ name: pseudonymiseName('vm-of-a-person', 's'.repeat(64)), 'properties.OsExtAz': 'eu-de-01' });
    expect(clean[1]?.attributes).toEqual({ name: pseudonymiseName('user-x', 's'.repeat(64)) });
    expect(JSON.stringify(clean)).not.toMatch(/person|"AK"|"x"/);
  });

  it('an application scope (target.project) keeps the RMS resources of its project; the platform scope keeps all (#3752)', async () => {
    const page = [
      { id: 'r-own', provider: 'ecs', type: 'cloudservers', region_id: 'eu-de', project_id: PROJECT_IDS['eu-de'] },
      { id: 'r-global', provider: 'iam', type: 'users', region_id: 'global', project_id: '' },
      { id: 'r-other', provider: 'evs', type: 'volumes', region_id: 'eu-de', project_id: 'p-other' },
    ];
    const app = ctxFor({ resourcesPages: [page] }, { regions: ['eu-de'], target: { project: 'eu-de' }, scopeId: 'app', scopeKind: 'application' });
    expect((await otcDriver.listResources(app.ctx)).map((r) => r.id)).toEqual(['r-own']);
    const platform = ctxFor({ resourcesPages: [page] });
    expect((await otcDriver.listResources(platform.ctx)).map((r) => r.id)).toEqual(['r-own', 'r-global', 'r-other']);
  });

  it.each([403, 404, 500])('listResources turns HTTP %i into a not collected source', async (status) => {
    const { ctx } = ctxFor({ fail: { 'rms-resources': status } });
    const err = await otcDriver.listResources(ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LiveSourceUnavailableError);
    expect((err as LiveSourceUnavailableError).httpStatus).toBe(status);
  });

  it('listResources stops the run on HTTP 401 (refused token, fail fast, #3750)', async () => {
    const { ctx } = ctxFor({ fail: { 'rms-resources': 401 } });
    const err = await otcDriver.listResources(ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LiveTokenRejectedError);
    expect(err).toMatchObject({ name: 'LiveAuthError', httpStatus: 401 });
  });

  it('a 401 on the AZ list or the CTS reads is not recorded as a source either: it stops the run (#3750)', async () => {
    const a = ctxFor({ fail: { azs: 401 } });
    await expect(otcDriver.listRegions(a.ctx)).rejects.toBeInstanceOf(LiveTokenRejectedError);
    expect(a.ctx.sources.filter((x) => (x as { http_status?: number }).http_status === 401)).toEqual([]);
  });

  it('listGuardrails reports the system tracker per region', async () => {
    const { ctx } = ctxFor();
    expect(await otcDriver.listGuardrails(ctx)).toEqual([
      { type: 'cts-tracker', id: 'eu-de/system', status: 'pass', detail: 'status enabled, integrity check on, forwarded to LTS no' },
      { type: 'cts-tracker', id: 'eu-nl/system', status: 'pass', detail: 'status enabled, integrity check on, forwarded to LTS no' },
    ]);
  });

  it('listGuardrails with 404 on every region throws a not collected source', async () => {
    const { ctx } = ctxFor({ fail: { 'cts-trackers': 404 } });
    await expect(otcDriver.listGuardrails(ctx)).rejects.toMatchObject({ source: 'guardrails', httpStatus: 404 });
    expect(ctx.sources).toContainEqual({ name: 'guardrails:cts:eu-de', status: 'not_collected', http_status: 404 });
  });

  it('listActivity counts traces by kind across pages (epoch ms window) and keeps no user or IP', async () => {
    const traces = [
      [{ trace_name: 'login', user: { name: 'a-person' }, source_ip: '192.0.2.1' }, { trace_name: 'createServer', read_only: false }],
      [{ trace_name: 'listServers', read_only: true }, { trace_name: 'deleteVolume' }, { trace_name: 'updateTag' }],
    ];
    const { ctx, calls } = ctxFor({ regions: ['eu-de'], traces });
    const a = await otcDriver.listActivity({ ...ctx, regions: ['eu-de'] }, { days: 7 });
    expect(a).toEqual({ window_days: 7, events_total: 5, by_kind: { login: 1, create: 1, read: 1, delete: 1, change: 1 } });
    const q = calls.filter((c) => c.path.endsWith('/traces')).map((c) => new URL(c.url).searchParams);
    expect(q[0]?.get('trace_type')).toBe('system');
    expect(Number(q[0]?.get('to')) - Number(q[0]?.get('from'))).toBe(7 * 86_400_000);
    expect(q[1]?.get('next')).toBe('t1');
    expect(JSON.stringify(a)).not.toMatch(/person|192\.0\.2/);
  });

  it('classifyTrace follows the reference classification', () => {
    expect(classifyTrace('logout', undefined)).toBe('login');
    expect(classifyTrace('anything', true)).toBe('read');
    expect(classifyTrace('setBucketAcl', false)).toBe('create');
    expect(classifyTrace('detachVolume', false)).toBe('delete');
    expect(classifyTrace('updateServer', false)).toBe('change');
  });

  it('listQuotas is not collected (no verified OTC quota API yet)', async () => {
    const { ctx } = ctxFor();
    await expect(otcDriver.listQuotas(ctx, 'eu-de')).rejects.toMatchObject({ source: 'quotas:eu-de' });
  });
});

describe('listPrices (public price list)', () => {
  it('returns the records of the region and parses both decimal formats', async () => {
    const { ctx } = ctxFor();
    const prices = await otcDriver.listPrices?.(ctx, 'eu-de');
    expect(prices).toEqual([
      { key: 'ecs', sku: 'OTC_S3_L4', name: 's3.large.4', unit: 'h', amount: 0.051175, currency: 'EUR' },
      { key: 'cci', sku: 'OTC_CCI_1', name: 'CCI vCPU', unit: 'h', amount: 0.01, currency: 'EUR' },
    ]);
    expect(parseOtcAmount('1.234,50 EUR')).toBe(1234.5);
    expect(parseOtcAmount('n/a')).toBeUndefined();
  });

  it('a 5xx is a not collected price source', async () => {
    const { ctx } = ctxFor({ fail: { price: 502 } });
    await expect(otcDriver.listPrices?.(ctx, 'eu-de')).rejects.toMatchObject({ source: 'price', httpStatus: 502 });
  });
});

describe('trimTrailingSlashes', () => {
  it('drops trailing slashes in linear time and keeps the rest', () => {
    expect(trimTrailingSlashes('https://iam.example/v3///')).toBe('https://iam.example/v3');
    expect(trimTrailingSlashes('https://iam.example/v3')).toBe('https://iam.example/v3');
    expect(trimTrailingSlashes('/'.repeat(100_000) + 'x' + '/'.repeat(100_000))).toBe('/'.repeat(100_000) + 'x');
  });
});

describe('OTC service table (D-095-02)', () => {
  it('has one entry per otc.json service, with the catalogue fulfills as capability tags', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const file = resolve(here, '../../../../../../../lz-catalogues/otc.json');
    expect(existsSync(file)).toBe(true);
    const cat = JSON.parse(readFileSync(file, 'utf-8')) as { regions: { services: { code: string; fulfills?: string[] }[] }[] };
    const fulfills = new Map<string, string[]>();
    for (const r of cat.regions) for (const s of r.services) fulfills.set(s.code, s.fulfills ?? []);
    expect(OTC_SERVICES.map((s) => s.catalogueCode).sort()).toEqual([...fulfills.keys()].sort());
    for (const s of OTC_SERVICES) expect([...s.tags], s.catalogueCode).toEqual(fulfills.get(s.catalogueCode));
    expect(new Set(OTC_SERVICES.map((s) => s.code)).size).toBe(OTC_SERVICES.length);
  });
});

// ---------------------------------------------------------------------------
// Scan assembler and CLI
// ---------------------------------------------------------------------------

const YML = [
  'name: demo',
  'landing_zones:',
  '  - id: otc-test',
  '    provider: otc',
  '    scopes:',
  '      - id: platform',
  '        kind: platform',
  '        auth: iam-password-token',
  '        regions: [eu-de, eu-nl]',
  '',
].join('\n');

async function scanHarness(opts: MockOptions = {}): Promise<{ ws: string; store: CredentialStore; mock: ReturnType<typeof makeOtcMock> }> {
  registerBuiltInLiveLzDrivers({ [UNVERIFIED_DRIVERS_ENV]: 'otc' });
  const ws = tempDir('swao-otc-ws-');
  writeFileSync(join(ws, '.swao.yml'), YML);
  const store = new CredentialStore(tempDir('swao-otc-vault-'));
  await store.set('lz:otc-test:platform:username', USERNAME);
  await store.set('lz:otc-test:platform:password', PASSWORD);
  await store.set('lz:otc-test:platform:domain', DOMAIN);
  return { ws, store, mock: makeOtcMock(opts) };
}

describe('runLzLiveScan with the otc driver', () => {
  it('produces a valid LzLiveScan: offering, estate, sources, quotas not collected, base fields projected', async () => {
    const h = await scanHarness({ roles: [READONLY_ROLE], resourcesPages: [[{ id: 'res-1', provider: 'ecs', type: 'cloudservers', region_id: 'eu-de' }]] });
    const out = await runLzLiveScan({ workspaceRoot: h.ws, lzId: 'otc-test', store: h.store, env: {}, fetchImpl: h.mock.fetch });
    expect(out.exitCode).toBe(0);
    const scan = out.results[0]?.scan;
    expect(scan).toBeDefined();
    expect(LzLiveScanSchema.safeParse(scan).success).toBe(true);
    expect(scan?.meta).toMatchObject({ lz_id: 'otc-test', provider: 'otc', read_only: 'verified', read_only_overrides: [] });
    expect(scan?.offering.services).toHaveLength(OTC_SERVICES.length);
    expect(scan?.offering.services.find((s) => s.code === 'apig')?.regions).toMatchObject({ 'eu-de': { status: 'enabled' }, 'eu-nl': { status: 'not_offered' } });
    expect(scan?.regions).toEqual(['eu-de', 'eu-nl']);
    expect(scan?.enabled_services.find((s) => s.code === 'Elastic Cloud Server')).toMatchObject({ provisioned: true, count: 1 });
    expect(scan?.meta.sources).toContainEqual({ name: 'quotas:eu-de', status: 'not_collected', reason: 'no T Cloud Public quota API verified yet (open question in #3572)' });
    expect(scan?.meta.sources).toContainEqual({ name: 'inventory:resources', status: 'ok' });
    expect(scan?.estate.activity_summary?.window_days).toBe(7);
    // the scan holds no login value and no tenant name
    expect(JSON.stringify(scan)).not.toMatch(new RegExp(`${PASSWORD}|${USERNAME}|${DOMAIN}`));
    // only the token POST and GETs reached the wire
    expect(new Set(h.mock.calls.filter((c) => c.method !== 'GET').map((c) => c.path))).toEqual(new Set(['/v3/auth/tokens']));
  });

  it('a write-capable login stops the scope without the flag (exit 1, nothing crawled)', async () => {
    const h = await scanHarness({ roles: [ADMIN_ROLE] });
    const out = await runLzLiveScan({ workspaceRoot: h.ws, lzId: 'otc-test', store: h.store, env: {}, fetchImpl: h.mock.fetch });
    expect(out.exitCode).toBe(1);
    expect(out.results[0]?.scan).toBeUndefined();
    expect(h.mock.calls.some((c) => c.path.endsWith('/all-resources'))).toBe(false);
  });

  it('with --accept-write-capable-credentials the scan proceeds and carries refused, the override and only reads', async () => {
    const h = await scanHarness({ roles: [ADMIN_ROLE] });
    const out = await runLzLiveScan({ workspaceRoot: h.ws, lzId: 'otc-test', store: h.store, env: {}, fetchImpl: h.mock.fetch, acceptWriteCapableCredentials: true });
    expect(out.exitCode).toBe(0);
    expect(out.results[0]?.scan?.meta).toMatchObject({ read_only: 'refused', read_only_overrides: ['accept-write-capable-credentials'] });
    expect(h.mock.calls.filter((c) => c.method !== 'GET').every((c) => c.path === '/v3/auth/tokens')).toBe(true);
  });

  it('a low-privilege identity yields unknown with not collected sources, never an empty success', async () => {
    const h = await scanHarness({ roles: [AOM_RO_ROLE], fail: { 'rms-providers': 403, 'rms-resources': 403, 'cts-trackers': 403, 'cts-traces': 403, azs: 403 } });
    const out = await runLzLiveScan({ workspaceRoot: h.ws, lzId: 'otc-test', store: h.store, env: {}, fetchImpl: h.mock.fetch });
    const scan = out.results[0]?.scan;
    expect(scan?.meta.coverage.readable).toEqual(['aom']);
    const missing = scan?.meta.sources.filter((s) => s.status === 'not_collected').map((s) => s.name) ?? [];
    expect(missing).toEqual(expect.arrayContaining(['inventory:providers', 'inventory:resources', 'guardrails', 'activity', 'azs:eu-de']));
    expect(scan?.estate.resources).toEqual([]);
    expect(scan?.offering.services.find((s) => s.code === 'ocr')?.regions['eu-de']?.status).toBe('unknown');
  });

  it('mergeServices joins the per-region entries of one code', () => {
    const a = { code: 'ecs', name: 'E', capability_tags: [], regions: { 'eu-de': { status: 'enabled' as const, evidence: [], observed_at: 't' } }, frameworks: {} };
    const b = { ...a, regions: { 'eu-nl': { status: 'not_offered' as const, evidence: [], observed_at: 't' } } };
    expect(mergeServices([[a], [b]])[0]?.regions).toEqual({ ...a.regions, ...b.regions });
  });
});

describe('swao lz scan --mode live', () => {
  it('writes one LzLiveScan per scope into --out and prints the summary', async () => {
    const h = await scanHarness({ roles: [READONLY_ROLE] });
    const out: string[] = [];
    const err: string[] = [];
    const dir = tempDir('swao-otc-out-');
    const code = await lzScanAction('otc-test', { mode: 'live', out: dir }, { cwd: h.ws, store: h.store, env: {}, fetchImpl: h.mock.fetch, out: (l) => out.push(l), err: (l) => err.push(l), guard: { requireFeature: () => undefined } });
    expect(err).toEqual([]);
    expect(code).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(['evidence-refs.json', 'lz-live-catalogue.json', 'lz-live-merged.yaml', 'otc-test.platform.lz-live-scan.json']);
    expect(LzLiveScanSchema.safeParse(JSON.parse(readFileSync(join(dir, 'otc-test.platform.lz-live-scan.json'), 'utf-8'))).success).toBe(true);
    // #3588 / #4399: the TUI live screen parses this scope line (lz-live-flow.ts parseProbeOutput via parseLzProbeScopeLine).
    expect(out).toContain('scope platform: read-only check: read-only');
    expect(out.map(parseLzProbeScopeLine).filter(Boolean)).toEqual([{ scopeId: 'platform', readOnly: 'verified', accepted: true }]);
    // #3581: the live LZ catalogue sits next to the scans, live-api, medium,
    // sovereignty copied from the bundled otc catalogue, and no catalogue
    // lookup folder is created in the workspace.
    const cat = parseLzCatalogue(JSON.parse(readFileSync(join(dir, 'lz-live-catalogue.json'), 'utf-8')));
    expect(cat.meta).toMatchObject({ provider: 'otc', confidence: 'medium', source: { mode: 'live-api', tool: 'otc-test/platform' } });
    expect(cat.regions.find((r) => r.id === 'eu-de')?.sovereignty).toMatchObject({ residency_country: 'DE', operator_jurisdiction: 'EU-entity' });
    expect(cat.regions.find((r) => r.id === 'eu-nl')?.services.some((s) => s.canonical_code === 'apig')).toBe(false);
    expect(existsSync(join(h.ws, 'lz-catalogues'))).toBe(false);
    expect(existsSync(join(h.ws, 'wsp', 'inputs', 'catalogs', 'lz-catalogues'))).toBe(false);
    expect(out.join('\n')).toMatch(/live LZ catalogue: /);
    // #3583: the scopes of the landing zone are merged into lz-live-merged.yaml.
    const merged = LzLiveMergedSchema.parse(yamlLoad(readFileSync(join(dir, 'lz-live-merged.yaml'), 'utf-8')));
    expect(merged.scopes).toEqual([expect.objectContaining({ scope_id: 'platform', scope_kind: 'platform', status: 'merged' })]);
    expect(merged.offering.services.find((s) => s.code === 'apig')?.regions['eu-nl']).toMatchObject({ status: 'not_offered', scope_id: 'platform' });
    expect(out.join('\n')).toMatch(/merged: 1 scope\(s\)/);
  });

  it('refuses an LZ catalogue folder as --out before any request (#3581, Q-03)', async () => {
    const h = await scanHarness({ roles: [READONLY_ROLE] });
    const err: string[] = [];
    const deps = { cwd: h.ws, store: h.store, env: {}, fetchImpl: h.mock.fetch, out: () => undefined, err: (l: string) => err.push(l), guard: { requireFeature: () => undefined } };
    expect(await lzScanAction('otc-test', { mode: 'live', out: join('wsp', 'inputs', 'catalogs', 'lz-catalogues') }, deps)).toBe(1);
    expect(await lzScanAction('otc-test', { mode: 'live', out: 'lz-catalogues' }, deps)).toBe(1);
    expect(err.join('\n')).toMatch(/is an LZ catalogue folder/);
    expect(h.mock.calls).toHaveLength(0);
    expect(existsSync(join(h.ws, 'lz-catalogues'))).toBe(false);
  });

  it('merges an earlier scan in --out: a stale scope is listed, a broken file is reported and left out (#3583)', { timeout: 20_000 }, async () => {
    const h = await scanHarness({ roles: [READONLY_ROLE] });
    writeFileSync(join(h.ws, '.swao.yml'), YML + [
      '      - id: app-a',
      '        kind: application',
      '        auth: iam-password-token',
      '        regions: [eu-de]',
      '      - id: app-b',
      '        kind: application',
      '        auth: iam-password-token',
      '        regions: [eu-de]',
      '',
    ].join('\n'));
    const dir = tempDir('swao-otc-out-');
    const deps = { cwd: h.ws, store: h.store, env: {}, fetchImpl: h.mock.fetch, out: (l: string) => out.push(l), err: (l: string) => err.push(l), guard: { requireFeature: () => undefined } };
    const out: string[] = [];
    const err: string[] = [];
    // First run: platform scope only.
    expect(await lzScanAction('otc-test', { mode: 'live', out: dir, scope: 'platform' }, deps)).toBe(0);
    // Age the platform scan beyond the window and add a broken app-a file.
    const scanFile = join(dir, 'otc-test.platform.lz-live-scan.json');
    const old = JSON.parse(readFileSync(scanFile, 'utf-8')) as { meta: { observed_at: string } };
    old.meta.observed_at = '2026-01-01T00:00:00Z';
    writeFileSync(scanFile, JSON.stringify(old));
    writeFileSync(join(dir, 'otc-test.app-a.lz-live-scan.json'), '{ not json');
    expect(await lzScanAction('otc-test', { mode: 'live', out: dir, scope: 'platform', staleDays: '3' }, deps)).toBe(0);
    let merged = LzLiveMergedSchema.parse(yamlLoad(readFileSync(join(dir, 'lz-live-merged.yaml'), 'utf-8')));
    // The second run rewrote the platform scan, so it is fresh again; app-a and app-b have no valid scan.
    expect(merged.scopes.map((s) => [s.scope_id, s.status])).toEqual([['platform', 'merged'], ['app-a', 'missing'], ['app-b', 'missing']]);
    expect(merged.window_days).toBe(3);
    expect(err.join('\n')).toMatch(/otc-test\.app-a\.lz-live-scan\.json is not a valid LzLiveScan/);
    // An aged scan that is not rewritten stays stale.
    writeFileSync(join(dir, 'otc-test.app-a.lz-live-scan.json'), JSON.stringify({ ...old, meta: { ...old.meta, scope_id: 'app-a', scope_kind: 'application' } }));
    expect(await lzScanAction('otc-test', { mode: 'live', out: dir, scope: 'platform' }, deps)).toBe(0);
    merged = LzLiveMergedSchema.parse(yamlLoad(readFileSync(join(dir, 'lz-live-merged.yaml'), 'utf-8')));
    expect(merged.scopes.find((s) => s.scope_id === 'app-a')).toMatchObject({ status: 'stale', observed_at: '2026-01-01T00:00:00Z' });
    expect(out.join('\n')).toMatch(/not merged: app-a stale, app-b missing/);
  });

  it('refuses a bad --stale-days before any request (#3583)', async () => {
    const h = await scanHarness();
    const err: string[] = [];
    const deps = { cwd: h.ws, store: h.store, env: {}, fetchImpl: h.mock.fetch, out: () => undefined, err: (l: string) => err.push(l), guard: { requireFeature: () => undefined } };
    expect(await lzScanAction('otc-test', { mode: 'live', out: 'x', staleDays: '0' }, deps)).toBe(1);
    expect(err.join('\n')).toMatch(/--stale-days/);
    expect(h.mock.calls).toHaveLength(0);
  });

  it('refuses --mode iac, a bad --days and an unlicensed tier', async () => {
    const h = await scanHarness();
    const err: string[] = [];
    const deps = { cwd: h.ws, store: h.store, env: {}, fetchImpl: h.mock.fetch, out: () => undefined, err: (l: string) => err.push(l), guard: { requireFeature: () => undefined } };
    expect(await lzScanAction('otc-test', { mode: 'iac', out: 'x' }, deps)).toBe(1);
    expect(await lzScanAction('otc-test', { mode: 'live', out: 'x', days: '0' }, deps)).toBe(1);
    const gated = await lzScanAction('otc-test', { mode: 'live', out: 'x' }, { ...deps, guard: { requireFeature: (k: string) => { throw Object.assign(new Error(`tier: ${k}`), { exitCode: 3 }); } } });
    expect(gated).toBe(3);
    expect(err.join('\n')).toMatch(/--mode iac|tier: lz-live-assess/);
    expect(h.mock.calls).toHaveLength(0);
  });
});
