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

// #3576: mock-server contract tests of the `stackit` live driver (CLAUDE.md
// section 5.9, Design 120 section 7.1): the Key Flow token request, request
// shape, happy path and the 401 / 403 / 404 / 5xx paths, the read-only probe,
// the Q-21 registration gate and the scan assembler.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CredentialStore, LzLiveScanSchema } from '@swao/core';
import { createReadOnlyFetch, ReadOnlyViolationError } from '../../http.js';
import { getLiveLzDriver, unregisterLiveLzDriver } from '../../registry.js';
import { LiveAuthError, LiveSourceUnavailableError } from '../../errors.js';
import { registerBuiltInLiveLzDrivers, UNVERIFIED_DRIVERS_ENV } from '../../builtin.js';
import { runLzLiveScan } from '../../scan.js';
import { createRecordingFetch, redactBody, routeOf, routePathOf, validateRecordingDir } from '../../record.js';
import { LiveLzDriverDescriptorSchema } from '../../types.js';
import type { ScopeCtx } from '../../types.js';
import { STACKIT_IAAS_KINDS, STACKIT_DATA_ROUTES, STACKIT_POSTURE_ROUTES, STACKIT_SERVICES, STACKIT_SERVICE_IDS, stackitDriver } from '../stackit-driver.js';
import { STACKIT_HIERARCHY_ROUTES } from '../stackit-hierarchy.js';
import { STACKIT_TOKEN_PATH, buildAssertion, jwtClaims, parseStackitKey, stackitProject, trimTrailingSlashes } from '../stackit-client.js';
import { isReadPermission, probeFromPermissions } from '../stackit-probe.js';
import { AUD, KEY_ID, PRIVATE_PEM, PROJECT_ID, SA_EMAIL, SA_SUB, makeStackitMock, serviceAccountKey } from './stackit-mock.js';
import type { MockOptions } from './stackit-mock.js';
import { filterResourceAttributes, pseudonymiseName } from '../../privacy.js';

const REPO_SWAO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../..');
const tmp: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmp.push(d);
  return d;
}

function ctxFor(opts: MockOptions = {}, over: Partial<ScopeCtx> = {}): { ctx: ScopeCtx; calls: ReturnType<typeof makeStackitMock>['calls'] } {
  const mock = makeStackitMock(opts);
  const ctx: ScopeCtx = {
    lzId: 'stackit-test',
    provider: 'stackit',
    scopeId: 'platform',
    scopeKind: 'platform',
    auth: 'key-flow',
    regions: ['eu01', 'eu02'],
    target: {},
    credentials: { 'service-account-key': serviceAccountKey() },
    http: { fetch: createReadOnlyFetch(mock.fetch, 'stackit', stackitDriver.readAllowList), baseUrls: { ...stackitDriver.defaultBaseUrls } },
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

describe('stackit driver descriptor and the Q-21 registration gate', () => {
  it('is a valid descriptor: key-flow auth, the token POST as the only non-read rule, not live-verified', () => {
    expect(LiveLzDriverDescriptorSchema.safeParse(stackitDriver).success).toBe(true);
    expect(stackitDriver.authMethods).toEqual([{ id: 'key-flow', required: ['service-account-key'], optional: [], unattended: true }]);
    expect(stackitDriver.readAllowList).toHaveLength(1);
    expect(stackitDriver.readAllowList[0]?.path.test('/oauth/v2/token')).toBe(true);
    // exactly the token path: no prefix, suffix or look-alike path passes the POST rule
    for (const p of ['/x/oauth/v2/token', '/oauth/v2/token/x', '/oauth/v2/tokens', '/oauthXv2/token', '/v2/projects/p/regions/eu01/services']) {
      expect(stackitDriver.readAllowList[0]?.path.test(p)).toBe(false);
    }
    // the literal rule and the client's token path agree
    expect(stackitDriver.readAllowList[0]?.path.test(STACKIT_TOKEN_PATH)).toBe(true);
    expect(stackitDriver.liveVerified).toBe(true); // #3831 (Q-21)
  });

  it('declares its route templates as literals equal to the client token path and the IaaS kinds (#3601, route parity gate)', () => {
    expect(stackitDriver.routeTemplates).toEqual([
      STACKIT_TOKEN_PATH,
      '/v2/users/{email}/permissions',
      '/v2/users/{email}/memberships',
      '/v2/regions/{region}/availability-zones',
      '/v2/projects/{project_id}/regions/{region}/services',
      ...STACKIT_IAAS_KINDS.map((k) => `/v2/projects/{project_id}/regions/{region}/${k.path}`),
      '/v2/projects/{project_id}/regions/{region}/quotas',
      // #3867: posture reads, in STACKIT_POSTURE_ROUTES
      STACKIT_POSTURE_ROUTES.keyrings,
      STACKIT_POSTURE_ROUTES.keys,
      STACKIT_POSTURE_ROUTES.loadBalancers,
      STACKIT_POSTURE_ROUTES.members,
      STACKIT_POSTURE_ROUTES.auditLog,
      STACKIT_POSTURE_ROUTES.backupSchedules,
      // #3883: Resource Manager hierarchy reads, in STACKIT_HIERARCHY_ROUTES
      STACKIT_HIERARCHY_ROUTES.projects,
      STACKIT_HIERARCHY_ROUTES.folders,
      STACKIT_HIERARCHY_ROUTES.folder,
      STACKIT_HIERARCHY_ROUTES.organization,
      // #3970: data service reads, in STACKIT_DATA_ROUTES
      ...Object.values(STACKIT_DATA_ROUTES),
    ]);
    // the gate reads quoted literals from the source text: every template must be one
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'stackit-driver.ts'), 'utf-8');
    const block = /routeTemplates:\s*\[([\s\S]*?)\]/.exec(src)?.[1] ?? '';
    expect([...block.matchAll(/'([^']*)'/g)].map((m) => m[1])).toEqual(stackitDriver.routeTemplates);
  });

  it('is registered in a release build without SWAO_LZ_UNVERIFIED_DRIVERS (#3831, Q-21)', () => {
    expect(registerBuiltInLiveLzDrivers({})).toContain('stackit');
    expect(getLiveLzDriver('stackit')).toBe(stackitDriver);
    expect(registerBuiltInLiveLzDrivers({ [UNVERIFIED_DRIVERS_ENV]: 'stackit' })).toContain('stackit');
  });
});

describe('Key Flow token request (POST /oauth/v2/token)', () => {
  it('posts a form with the jwt-bearer grant and an RS512 assertion the mock verifies; one token per scope run', async () => {
    const { ctx, calls } = ctxFor();
    await stackitDriver.listRegions(ctx);
    await stackitDriver.listServices(ctx, 'eu01');
    const tokenCalls = calls.filter((c) => c.path === '/oauth/v2/token');
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]?.method).toBe('POST');
    expect(tokenCalls[0]?.url).toBe('https://accounts.stackit.cloud/oauth/v2/token');
    expect(tokenCalls[0]?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(tokenCalls[0]?.body ?? '');
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    // the request carries the assertion only, never the private key
    expect(tokenCalls[0]?.body).not.toContain('PRIVATE');
    for (const c of calls.filter((x) => x.path !== '/oauth/v2/token')) {
      expect(c.method).toBe('GET');
      expect(c.headers['authorization']).toMatch(/^Bearer /);
    }
  });

  it('the assertion has header alg RS512 + kid and claims iss, sub, aud, jti, iat, exp = iat + 600', () => {
    const key = parseStackitKey(serviceAccountKey());
    const jwt = buildAssertion(key, 1_000_000, '11111111-1111-4111-8111-111111111111');
    const [h] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h as string, 'base64url').toString())).toEqual({ alg: 'RS512', typ: 'JWT', kid: KEY_ID });
    expect(jwtClaims(jwt)).toEqual({ iss: SA_EMAIL, sub: SA_SUB, aud: AUD, jti: '11111111-1111-4111-8111-111111111111', iat: 1_000_000, exp: 1_000_600 });
  });

  it("never sends the request to the key's own tokenEndpoint (only the driver default or a loopback override)", async () => {
    const { ctx, calls } = ctxFor();
    await stackitDriver.listRegions(ctx);
    expect(calls.some((c) => c.url.includes('attacker'))).toBe(false);
  });

  it('a refused key (401) stops with LiveAuthError without echoing key material', async () => {
    const { ctx } = ctxFor({ fail: { token: 401 } });
    const err = await stackitDriver.listRegions(ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LiveAuthError);
    expect((err as LiveAuthError).httpStatus).toBe(401);
    expect((err as Error).message).not.toContain(SA_EMAIL);
    expect((err as Error).message).not.toContain('PRIVATE');
  });

  it('a 5xx on the token endpoint is an HTTP error, not an auth error', async () => {
    const { ctx } = ctxFor({ fail: { token: 503 } });
    const err = await stackitDriver.listRegions(ctx).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(LiveAuthError);
    expect((err as Error).message).toMatch(/HTTP 503/);
  });

  it('a missing or incomplete key fails before any request, naming fields only', async () => {
    const none = ctxFor({}, { credentials: {} });
    await expect(stackitDriver.listRegions(none.ctx)).rejects.toBeInstanceOf(LiveAuthError);
    expect(none.calls).toHaveLength(0);
    const partial = ctxFor({}, { credentials: { 'service-account-key': serviceAccountKey({ privateKey: '', kid: '' }) } });
    const err = await stackitDriver.listRegions(partial.ctx).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/credentials\.kid, credentials\.privateKey/);
    expect(partial.calls).toHaveLength(0);
    expect(() => parseStackitKey('not json')).toThrow(/not valid JSON/);
  });

  it('a key that is not an RSA private key is refused before sending', async () => {
    const { ctx, calls } = ctxFor({}, { credentials: { 'service-account-key': serviceAccountKey({ privateKey: 'not a key' }) } });
    await expect(stackitDriver.listRegions(ctx)).rejects.toThrow(/cannot sign/);
    expect(calls).toHaveLength(0);
  });

  it('the project comes from the scope target, else from the token claim; neither is an auth error', async () => {
    const fromClaim = ctxFor();
    expect(await stackitProject(fromClaim.ctx)).toBe(PROJECT_ID);
    const fromTarget = ctxFor({}, { target: { project: 'p-from-yml' } });
    expect(await stackitProject(fromTarget.ctx)).toBe('p-from-yml');
    const none = ctxFor({ noProjectClaim: true });
    await expect(stackitProject(none.ctx)).rejects.toThrow(/scopes\[\]\.target\.project/);
  });

  it('the read-only wrapper refuses any non-read call the driver could make', async () => {
    const { ctx } = ctxFor();
    await expect(ctx.http.fetch('https://service-enablement.api.stackit.cloud/v2/projects/x/regions/eu01/services/s', { method: 'POST' })).rejects.toBeInstanceOf(ReadOnlyViolationError);
    await expect(ctx.http.fetch('https://iaas.api.stackit.cloud/v2/projects/x/regions/eu01/servers', { method: 'DELETE' })).rejects.toBeInstanceOf(ReadOnlyViolationError);
  });
});

describe('probeReadOnly (own permissions and memberships, Authorization API v2)', () => {
  it('Reader-style read permissions -> verified, identity is the role name, never the e-mail', async () => {
    const { ctx, calls } = ctxFor();
    const p = await stackitDriver.probeReadOnly(ctx);
    expect(p).toMatchObject({ read_only: 'verified', identity: 'roles: reader', write_actions_allowed: [] });
    expect(p.coverage.readable).toEqual(['service-enablement', 'iaas']);
    expect(JSON.stringify(p)).not.toContain(SA_EMAIL);
    const perm = calls.find((c) => c.path.endsWith('/permissions'));
    expect(perm?.url).toBe(`https://authorization.api.stackit.cloud/v2/users/${encodeURIComponent(SA_EMAIL)}/permissions?resourceType=project&resource=${PROJECT_ID}`);
  });

  it('a write permission -> refused with the permission names', async () => {
    const { ctx } = ctxFor({ permissions: ['iaas.server.list', 'iaas.server.create', 'iaas.server.delete'], roles: ['editor'] });
    const p = await stackitDriver.probeReadOnly(ctx);
    expect(p).toMatchObject({ read_only: 'refused', identity: 'roles: editor', write_actions_allowed: ['iaas.server.create', 'iaas.server.delete'] });
  });

  it('no permission on the project (no role binding, live 2026-11-03) -> unverifiable naming the Reader role', async () => {
    const { ctx } = ctxFor({ permissions: [], roles: [] });
    const p = await stackitDriver.probeReadOnly(ctx);
    expect(p.read_only).toBe('unverifiable');
    expect(p.identity).toBe('no role on the project');
    expect(p.reason).toMatch(/Reader role/);
  });

  it('the permission query refused (403) -> unverifiable with the status', async () => {
    const { ctx } = ctxFor({ fail: { 'authz-permissions': 403 } });
    const p = await stackitDriver.probeReadOnly(ctx);
    expect(p).toMatchObject({ read_only: 'unverifiable' });
    expect(p.reason).toMatch(/HTTP 403/);
  });

  it('a memberships failure keeps the permission verdict', async () => {
    const { ctx } = ctxFor({ fail: { 'authz-memberships': 500 } });
    expect((await stackitDriver.probeReadOnly(ctx)).read_only).toBe('verified');
  });

  it('classifies permission verbs', () => {
    expect(isReadPermission('iam.member.read')).toBe(true);
    expect(isReadPermission('iaas.server.list')).toBe(true);
    expect(isReadPermission('iaas.server.get')).toBe(true);
    expect(isReadPermission('iaas.server.create')).toBe(false);
    expect(isReadPermission('service-enablement.service.enable')).toBe(false);
    expect(isReadPermission('read')).toBe(false);
    // read verbs seen in the live Reader role, each a read by its published description
    for (const n of ['alb.ping', 'functions.function.logs', 'functions.function.metrics', 'lds.failover.check-enabled', 'sca.project.overview', 'mongodb-flex.backup.restore-list']) expect(isReadPermission(n)).toBe(true);
    for (const n of ['postgres-flex.backup.restore', 'data-catalog.instance.use', 'lds.authentication.auth', 'support.ticket.create']) expect(isReadPermission(n)).toBe(false);
  });

  it('matches items by type: live 2026-11-03 the response resourceId is the project containerId, not the UUID', () => {
    const p = probeFromPermissions({ items: [{ resourceId: 'mock-project-slug-1a2b3c', resourceType: 'project', permissions: [{ name: 'iaas.server.list' }] }] }, { items: [{ resourceId: 'mock-project-slug-1a2b3c', resourceType: 'project', role: 'reader' }] }, PROJECT_ID);
    expect(p).toMatchObject({ read_only: 'verified', identity: 'roles: reader' });
  });

  it('the built-in Reader role is refused: it holds 7 non-read permissions (live 2026-11-03)', () => {
    const readerWrites = ['data-catalog.instance.use', 'lds.authentication.auth', 'marketplace.inquiry.create', 'postgres-flex.backup.restore', 'ske.cluster.kubeconfig.idp.create', 'support.help-center.ticket.create', 'support.ticket.create'];
    const reads = ['iaas.server.list', 'iaas.server.get', 'service-enablement.service.list', 'alb.ping', 'sca.project.overview'];
    const p = probeFromPermissions({ items: [{ resourceId: 'mock-project-slug-1a2b3c', resourceType: 'project', permissions: [...reads, ...readerWrites].map((name) => ({ name })) }] }, { items: [{ role: 'reader' }] }, PROJECT_ID);
    expect(p.read_only).toBe('refused');
    expect(p.write_actions_allowed).toEqual(readerWrites);
    expect(p.reason).toBe('the service account holds 7 non-read permission(s) on the project');
  });
});

describe('offering', () => {
  it('regions with AZs from the IaaS list and the country of the catalogue overlay', async () => {
    const { ctx } = ctxFor();
    const regions = await stackitDriver.listRegions(ctx);
    expect(regions).toEqual([
      { id: 'eu01', country: 'DE', azs: ['eu01-1', 'eu01-2', 'eu01-3', 'eu01-m'].map((name) => ({ name, available: true })), status: 'enabled' },
      { id: 'eu02', country: 'AT', azs: ['eu02-1', 'eu02-2', 'eu02-3', 'eu02-m'].map((name) => ({ name, available: true })), status: 'enabled' },
    ]);
  });

  it('an AZ list failure (404) is a not_collected source and the region becomes unknown', async () => {
    const { ctx } = ctxFor({ fail: { 'az-eu02': 404 } });
    const regions = await stackitDriver.listRegions(ctx);
    expect(regions[1]).toMatchObject({ id: 'eu02', status: 'unknown', azs: [] });
    expect(ctx.sources).toContainEqual({ name: 'azs:eu02', status: 'not_collected', http_status: 404 });
  });

  it('Service Enablement states map to enabled / available_not_enabled / unknown, across pages', async () => {
    const { ctx, calls } = ctxFor({ services: { eu01: [[{ serviceId: 'cloud.stackit.a', state: 'ENABLED' }], [{ serviceId: 'cloud.stackit.b', state: 'DISABLED' }, { serviceId: 'cloud.stackit.c', state: 'ENABLING' }]] } });
    const services = await stackitDriver.listServices(ctx, 'eu01');
    const st = (code: string) => services.find((s) => s.code === code)?.regions['eu01']?.status;
    expect([st('cloud.stackit.a'), st('cloud.stackit.b'), st('cloud.stackit.c')]).toEqual(['enabled', 'available_not_enabled', 'unknown']);
    expect(calls.filter((c) => c.path.endsWith('/services')).map((c) => new URL(c.url).searchParams.get('cursor'))).toEqual([null, '1']);
    // an unmapped serviceId carries no capability tags and no catalogue code (a mapping gap)
    expect(services.find((s) => s.code === 'cloud.stackit.a')).toMatchObject({ capability_tags: [] });
    expect(services.find((s) => s.code === 'cloud.stackit.a')?.catalogue_code).toBeUndefined();
    // catalogue services the list does not name are unknown, never not_offered:
    // `not-listed` with a known serviceId, `no-service-id-mapping` without one
    const pg = services.find((s) => s.catalogue_code === 'postgresql-flex');
    expect(pg?.regions['eu01']).toMatchObject({ status: 'unknown', evidence: [{ source: 'api', ref: 'service-enablement:eu01:not-listed' }] });
    const gpu = services.find((s) => s.catalogue_code === 'gpu-server');
    expect(gpu?.regions['eu01']).toMatchObject({ status: 'unknown', evidence: [{ source: 'api', ref: 'service-enablement:eu01:no-service-id-mapping' }] });
    expect(services.some((s) => Object.values(s.regions).some((r) => r.status === 'not_offered'))).toBe(false);
    expect(ctx.sources).toContainEqual({ name: 'service-enablement:eu01', status: 'ok' });
  });

  it('a mapped serviceId (#3790, live list 2026-11-03) joins the catalogue code and its capability tags', async () => {
    const { ctx } = ctxFor({ services: { eu01: [[{ serviceId: 'cloud.stackit.postgres-flex', state: 'ENABLED' }, { serviceId: 'cloud.stackit.ske', state: 'DISABLED' }, { serviceId: 'cloud.stackit.iaas', state: 'ENABLED' }]] } });
    const services = await stackitDriver.listServices(ctx, 'eu01');
    expect(services.filter((s) => s.catalogue_code === 'postgresql-flex')).toEqual([
      expect.objectContaining({ code: 'cloud.stackit.postgres-flex', name: 'PostgreSQL Flex', capability_tags: ['postgresql'], regions: { eu01: expect.objectContaining({ status: 'enabled' }) } }),
    ]);
    expect(services.find((s) => s.catalogue_code === 'kubernetes-engine')).toMatchObject({ code: 'cloud.stackit.ske', regions: { eu01: { status: 'available_not_enabled' } } });
    // iaas spans several catalogue products, so it stays unmapped
    expect(services.find((s) => s.code === 'cloud.stackit.iaas')?.catalogue_code).toBeUndefined();
  });

  it('every mapped catalogue code exists in the STACKIT catalogue and no code is mapped twice', () => {
    const codes = Object.values(STACKIT_SERVICE_IDS);
    expect(new Set(codes).size).toBe(codes.length);
    const catalogue = JSON.parse(readFileSync(join(REPO_SWAO, 'lz-catalogues', 'stackit.json'), 'utf-8')) as { regions: { services: { code: string }[] }[] };
    const known = new Set(catalogue.regions.flatMap((r) => r.services.map((x) => x.code)));
    expect(codes.filter((c) => !known.has(c))).toEqual([]);
  });

  it('the list refused (403, live 2026-11-03 without a role) -> every catalogue service unknown with the status', async () => {
    const { ctx } = ctxFor({ fail: { 'se-eu01': 403 } });
    const services = await stackitDriver.listServices(ctx, 'eu01');
    expect(services).toHaveLength(STACKIT_SERVICES.length);
    for (const s of services) expect(s.regions['eu01']).toMatchObject({ status: 'unknown', evidence: [{ source: 'api', ref: 'service-enablement:eu01', http_status: 403 }] });
    expect(ctx.sources).toContainEqual({ name: 'service-enablement:eu01', status: 'not_collected', http_status: 403 });
  });

  it('a 500 on the list is recorded the same way', async () => {
    const { ctx } = ctxFor({ fail: { 'se-eu02': 500 } });
    await stackitDriver.listServices(ctx, 'eu02');
    expect(ctx.sources).toContainEqual({ name: 'service-enablement:eu02', status: 'not_collected', http_status: 500 });
  });
});

describe('estate', () => {
  it('resources from the IaaS lists: id, type, region, labels as tags, created_at; other properties as attributes, names, IPs and user data removed by the privacy filter (#3886)', async () => {
    const { ctx } = ctxFor({ resources: { 'servers-eu01': [{ id: 'srv-1', name: 'person-named-host', labels: { env: 'test' }, createdAt: '2026-11-01T00:00:00Z', userData: 'secret-cloud-init', machineType: 'c1.2' }], 'public-ips-eu02': [{ id: 'ip-1', ip: '203.0.113.7' }] } });
    const res = await stackitDriver.listResources(ctx);
    expect(res).toEqual([
      { id: 'srv-1', type: 'iaas.server', service_code: 'iaas', region: 'eu01', tags: { env: 'test' }, created_at: '2026-11-01T00:00:00Z', attributes: { name: 'person-named-host', userData: 'secret-cloud-init', machineType: 'c1.2' } },
      { id: 'ip-1', type: 'iaas.public-ip', service_code: 'iaas', region: 'eu02', attributes: { ip: '203.0.113.7' } },
    ]);
    // the scan boundary's one privacy filter (scan.ts) leaves no name, IP or user data
    const clean = filterResourceAttributes(res, 's'.repeat(64)).resources;
    expect(clean[0]?.attributes).toEqual({ name: pseudonymiseName('person-named-host', 's'.repeat(64)), machineType: 'c1.2' });
    expect(clean[1]).toEqual({ id: 'ip-1', type: 'iaas.public-ip', service_code: 'iaas', region: 'eu02' });
    expect(JSON.stringify(clean)).not.toMatch(/person-named-host|203\.0\.113\.7|secret-cloud-init/);
  });

  it('a partly refused inventory records each refused list; all refused -> LiveSourceUnavailableError (403)', async () => {
    const partly = ctxFor({ fail: { 'iaas-servers-eu01': 403 } });
    await stackitDriver.listResources(partly.ctx);
    expect(partly.ctx.sources).toContainEqual({ name: 'inventory:servers:eu01', status: 'not_collected', http_status: 403 });
    const fail: Record<string, number> = {};
    for (const r of ['eu01', 'eu02']) for (const k of ['servers', 'volumes', 'networks', 'public-ips', 'security-groups']) fail[`iaas-${k}-${r}`] = 403;
    const err = await stackitDriver.listResources(ctxFor({ fail }).ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LiveSourceUnavailableError);
    expect((err as LiveSourceUnavailableError).httpStatus).toBe(403);
  });

  it('quotas from the QuotaList map limit and usage; a 403 is a LiveSourceUnavailableError', async () => {
    const q = await stackitDriver.listQuotas(ctxFor().ctx, 'eu01');
    expect(q).toEqual([
      { resource: 'vcpu', region: 'eu01', limit: 100, used: 8, remaining: 92 },
      { resource: 'volumes', region: 'eu01', limit: 50, used: 2, remaining: 48 },
    ]);
    await expect(stackitDriver.listQuotas(ctxFor({ fail: { 'iaas-quotas-eu01': 403 } }).ctx, 'eu01')).rejects.toBeInstanceOf(LiveSourceUnavailableError);
  });

  it('guardrails and activity have no verified API yet and say so', async () => {
    await expect(stackitDriver.listGuardrails(ctxFor().ctx)).rejects.toThrow(/open question in #3576/);
    await expect(stackitDriver.listActivity(ctxFor().ctx, { days: 7 })).rejects.toThrow(/open question in #3576/);
  });

  it('trims trailing slashes in linear time', () => {
    expect(trimTrailingSlashes('https://x.example///')).toBe('https://x.example');
    expect(trimTrailingSlashes('https://x.example')).toBe('https://x.example');
  });
});

const YML = [
  'name: demo',
  'landing_zones:',
  '  - id: stackit-test',
  '    provider: stackit',
  '    scopes:',
  '      - id: platform',
  '        kind: platform',
  '        auth: key-flow',
  '        regions: [eu01, eu02]',
  '',
].join('\n');

async function scanHarness(opts: MockOptions = {}): Promise<{ ws: string; store: CredentialStore; mock: ReturnType<typeof makeStackitMock> }> {
  registerBuiltInLiveLzDrivers({ [UNVERIFIED_DRIVERS_ENV]: 'stackit' });
  const ws = tempDir('swao-stackit-ws-');
  writeFileSync(join(ws, '.swao.yml'), YML);
  const store = new CredentialStore(tempDir('swao-stackit-vault-'));
  await store.set('lz:stackit-test:platform:service-account-key', serviceAccountKey());
  return { ws, store, mock: makeStackitMock(opts) };
}

describe('runLzLiveScan with the stackit driver', () => {
  it('produces a valid LzLiveScan with sources for the unverified APIs; only the token POST and GETs reach the wire', async () => {
    const h = await scanHarness({ resources: { 'servers-eu01': [{ id: 'srv-1', labels: { owner: 'Jane Doe' } }] } });
    const out = await runLzLiveScan({ workspaceRoot: h.ws, lzId: 'stackit-test', store: h.store, env: {}, fetchImpl: h.mock.fetch });
    expect(out.exitCode).toBe(0);
    const scan = out.results[0]?.scan;
    expect(LzLiveScanSchema.safeParse(scan).success).toBe(true);
    expect(scan?.meta).toMatchObject({ lz_id: 'stackit-test', provider: 'stackit', read_only: 'verified' });
    expect(scan?.meta.sources).toContainEqual({ name: 'guardrails', status: 'not_collected', reason: 'no STACKIT guardrail API verified yet (open question in #3576)' });
    // the scan holds no key material, no service account e-mail, and the owner tag is pseudonymised
    const text = JSON.stringify(scan);
    expect(text).not.toMatch(/PRIVATE|Jane Doe/);
    expect(text).not.toContain(SA_EMAIL);
    expect(text).not.toContain(PRIVATE_PEM.slice(40, 80));
    expect(new Set(h.mock.calls.filter((c) => c.method !== 'GET').map((c) => c.path))).toEqual(new Set(['/oauth/v2/token']));
  });

  it('a service account without a role (live 2026-11-03) stops at the gate without --accept-unverified-read-only', async () => {
    const h = await scanHarness({ permissions: [], roles: [] });
    const out = await runLzLiveScan({ workspaceRoot: h.ws, lzId: 'stackit-test', store: h.store, env: {}, fetchImpl: h.mock.fetch });
    expect(out.exitCode).toBe(1);
    expect(out.results[0]?.gate.manifest.read_only).toBe('unverifiable');
  });
});

describe('recording a stackit run (#3576)', () => {
  it('redacts the access token of the Key Flow response body; the driver still gets the real token', async () => {
    const mock = makeStackitMock();
    const root = tempDir('swao-stackit-rec-');
    const rec = createRecordingFetch(mock.fetch, { root, provider: 'stackit', scopeId: 'platform', identity: 'operator', driverVersion: '0.1.0', routeTemplates: stackitDriver.routeTemplates });
    const { ctx } = ctxFor({}, { http: { fetch: createReadOnlyFetch(rec.fetch, 'stackit', stackitDriver.readAllowList), baseUrls: { ...stackitDriver.defaultBaseUrls } } });
    await stackitDriver.listRegions(ctx);
    rec.finish();
    expect(validateRecordingDir(rec.runDir).errors).toEqual([]);
    const tokenBody = readFileSync(join(rec.runDir, 'bodies', '1.json'), 'utf-8');
    expect(JSON.parse(tokenBody)).toMatchObject({ access_token: '<redacted>', token_type: 'Bearer', expires_in: 899 });
    const everything = readdirSync(join(rec.runDir, 'bodies')).map((b) => readFileSync(join(rec.runDir, 'bodies', b), 'utf-8')).join(String.fromCharCode(10)) + readFileSync(join(rec.runDir, 'requests.ndjson'), 'utf-8');
    expect(everything).not.toMatch(/eyJ/); // no JWT
    expect(everything).not.toContain('PRIVATE');
    // the driver used the real token afterwards
    expect(mock.calls.filter((c) => c.path.endsWith('/availability-zones')).every((c) => c.headers['authorization'] !== 'Bearer <redacted>')).toBe(true);
  });

  it('every request path of the driver maps to one of its route templates (no project id or region in a route)', () => {
    const t = stackitDriver.routeTemplates ?? [];
    expect(routeOf('/v2/projects/p-1/regions/eu01/services', t)).toBe('/v2/projects/{project_id}/regions/{region}/services');
    expect(routeOf('/v2/projects/p-1/regions/eu02/security-groups', t)).toBe('/v2/projects/{project_id}/regions/{region}/security-groups');
    expect(routeOf('/v2/projects/p-1/regions/eu01/quotas', t)).toBe('/v2/projects/{project_id}/regions/{region}/quotas');
    expect(routeOf('/v2/users/sa%40x/permissions', t)).toBe('/v2/users/{email}/permissions');
    expect(routeOf('/v2/regions/eu01/availability-zones', t)).toBe('/v2/regions/{region}/availability-zones');
  });

  // #3995: SQL Server Flex v3 and PostgreSQL Flex v3 share the path on two hosts; the route key is host-aware.
  it('records the SQL Server Flex and the PostgreSQL Flex instance lists under their own route keys', async () => {
    const mock = makeStackitMock({ postgres: { eu01: [] }, sqlserver: { eu01: [] } });
    const root = tempDir('swao-stackit-rec-mssql-');
    const rec = createRecordingFetch(mock.fetch, { root, provider: 'stackit', scopeId: 'platform', identity: 'operator', driverVersion: '0.1.0', routeTemplates: stackitDriver.routeTemplates, routeHostPrefixes: stackitDriver.routeHostPrefixes });
    const { ctx } = ctxFor({}, { http: { fetch: createReadOnlyFetch(rec.fetch, 'stackit', stackitDriver.readAllowList), baseUrls: { ...stackitDriver.defaultBaseUrls } } });
    await stackitDriver.listServiceResources!(ctx);
    rec.finish();
    expect(validateRecordingDir(rec.runDir).errors).toEqual([]);
    const routes = readFileSync(join(rec.runDir, 'requests.ndjson'), 'utf-8').split(/\r?\n/).filter(Boolean).map((l) => (JSON.parse(l) as { route: string }).route);
    expect(routes.filter((r) => r === STACKIT_DATA_ROUTES.postgresInstances)).toHaveLength(2);
    expect(routes.filter((r) => r === STACKIT_DATA_ROUTES.sqlserverInstances)).toHaveLength(2);
  });

  it('routePathOf: the host prefix of the driver only for its host; the prefixed templates are driver templates', () => {
    const p = stackitDriver.routeHostPrefixes ?? {};
    expect(Object.keys(p).map((h) => Object.values(stackitDriver.defaultBaseUrls).some((u) => new URL(u).hostname === h))).toEqual([true]);
    expect(routePathOf('https://mssql-flex-service.api.stackit.cloud/v3/projects/p-1/regions/eu01/instances', p)).toBe('/sqlserver-flex/v3/projects/p-1/regions/eu01/instances');
    expect(routePathOf('https://postgres-flex-service.api.stackit.cloud/v3/projects/p-1/regions/eu01/instances', p)).toBe('/v3/projects/p-1/regions/eu01/instances');
    // the mock origin serves the API under the prefix: its path is the key as is
    expect(routePathOf('https://127.0.0.1:8443/sqlserver-flex/v3/projects/p-1/regions/eu01/instances', p)).toBe('/sqlserver-flex/v3/projects/p-1/regions/eu01/instances');
    expect(routePathOf(new URL('https://x.example/a'), {})).toBe('/a');
    const t = stackitDriver.routeTemplates ?? [];
    expect(routeOf('/sqlserver-flex/v3/projects/p-1/regions/eu01/instances/i-1', t)).toBe(STACKIT_DATA_ROUTES.sqlserverInstance);
    expect(LiveLzDriverDescriptorSchema.shape.routeHostPrefixes.safeParse({ 'Bad Host': '/x' }).success).toBe(false);
  });

  it('redactBody replaces only the OAuth token fields of a JSON object', () => {
    expect(JSON.parse(redactBody('{"access_token":"t","refresh_token":"r","expires_in":5}'))).toEqual({ access_token: '<redacted>', refresh_token: '<redacted>', expires_in: 5 });
    expect(redactBody('{"items":[]}')).toBe('{"items":[]}');
    // #3971: the Telemetry Link GET (telemetry-link v1, telemetryLinkResponse) returns the router access token at the top level.
    expect(JSON.parse(redactBody('{"id":"l","enabled":true,"status":"active","accessToken":"a.b.c"}'))).toEqual({ id: 'l', enabled: true, status: 'active', accessToken: '<redacted>' });
    expect(redactBody('not json "access_token"')).toBe('not json "access_token"');
  });

  it('#3951: redactBody replaces the temporary AK/SK of the OTC IAM answer and the key echoes of an OBS XML error', () => {
    const sts = JSON.stringify({ credential: { expires_at: '2026-11-06T12:00:00.000000Z', access: 'TMPAK', secret: 'TMPSK', securitytoken: 'TMPTOKEN' } });
    expect(JSON.parse(redactBody(sts))).toEqual({ credential: { expires_at: '2026-11-06T12:00:00.000000Z', access: '<redacted>', secret: '<redacted>', securitytoken: '<redacted>' } });
    const xml = '<?xml version="1.0" encoding="UTF-8"?><Error><Code>SignatureDoesNotMatch</Code><AccessKeyId>TMPAK</AccessKeyId><SignatureProvided>c2ln</SignatureProvided><StringToSign>GET\n\n\n\nx-obs-security-token:TMPTOKEN\n/b/?acl</StringToSign><StringToSignBytes>47 45</StringToSignBytes><RequestId>r1</RequestId></Error>';
    const out = redactBody(xml);
    for (const secret of ['TMPAK', 'TMPTOKEN', 'c2ln', '47 45']) expect(out).not.toContain(secret);
    expect(out).toContain('<Code>SignatureDoesNotMatch</Code>');
    expect(out).toContain('<RequestId>r1</RequestId>');
    expect(redactBody('{"credentials":[{"access":"x"}]}')).toBe('{"credentials":[{"access":"x"}]}');
  });
});
