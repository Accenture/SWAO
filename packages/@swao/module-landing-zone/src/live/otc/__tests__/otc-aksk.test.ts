// #3685: the AK/SK session of the otc client (otc-client.ts akskSession) and
// the aksk auth method of the driver, on an in-process fake (the mock-server
// cases are in swao/ops/mock-csp/contract/otc-aksk.contract.ts).

import { describe, it, expect } from 'vitest';
import { createReadOnlyFetch } from '../../http.js';
import { LiveAuthError } from '../../errors.js';
import { LiveLzDriverDescriptorSchema } from '../../types.js';
import type { FetchLike, ScopeCtx } from '../../types.js';
import { otcDomainToken, otcGet, otcToken } from '../otc-client.js';
import { otcDriver } from '../otc-driver.js';

const DOMAIN = 'd0000000000000000000000000000001';
const PROJECT = 'p0000000000000000000000000000001';
const SK = ['fake', 'secret', 'key'].join('-');

interface Seen { url: string; headers: Record<string, string> }

function fake(routes: Record<string, (h: Record<string, string>) => { status: number; body: unknown }>): { fetch: FetchLike; seen: Seen[] } {
  const seen: Seen[] = [];
  const inner: FetchLike = async (url, init) => {
    const u = new URL(url);
    seen.push({ url, headers: { ...(init?.headers ?? {}) } });
    const r = routes[u.pathname]?.(init?.headers ?? {}) ?? { status: 404, body: {} };
    return { ok: r.status < 400, status: r.status, headers: { get: () => null }, text: async () => JSON.stringify(r.body) };
  };
  return { fetch: createReadOnlyFetch(inner, 'otc', otcDriver.readAllowList), seen };
}

const OK_ROUTES = {
  '/v3/auth/domains': () => ({ status: 200, body: { domains: [{ id: DOMAIN, name: 'd' }] } }),
  '/v3.0/OS-CREDENTIAL/credentials/MOCKAK': () => ({ status: 200, body: { credential: { access: 'MOCKAK', user_id: 'u1' } } }),
  '/v3/auth/projects': () => ({ status: 200, body: { projects: [{ id: PROJECT, name: 'eu-de' }] } }),
  '/v3/auth/catalog': (h: Record<string, string>) => (h['x-project-id'] === PROJECT ? { status: 200, body: { catalog: [{ type: 'compute', endpoints: [{ url: `https://ecs.example/v2.1/${PROJECT}`, region: 'eu-de', interface: 'public' }] }] } } : { status: 403, body: {} }),
};

function ctx(f: FetchLike, credentials: Record<string, string> = { 'access-key-id': 'MOCKAK', 'secret-access-key': SK }): ScopeCtx {
  return { lzId: 'o', provider: 'otc', scopeId: 'platform', scopeKind: 'platform', auth: 'aksk', regions: ['eu-de'], target: {}, credentials, http: { fetch: f, baseUrls: { iam: 'https://iam.example/v3' } }, sources: [] };
}

describe('otc aksk auth method (#3685)', () => {
  it('is registered next to iam-password-token: access-key-id and secret-access-key, optional session-token', () => {
    expect(LiveLzDriverDescriptorSchema.safeParse(otcDriver).success).toBe(true);
    expect(otcDriver.authMethods.find((m) => m.id === 'aksk')).toEqual({ id: 'aksk', required: ['access-key-id', 'secret-access-key'], optional: ['session-token'], unattended: true });
    // the session reads are named for the recorder (the AK in the path never reaches a recording)
    expect(otcDriver.routeTemplates).toEqual(expect.arrayContaining(['/v3/auth/domains', '/v3/auth/projects', '/v3/auth/catalog', '/v3.0/OS-CREDENTIAL/credentials/{access_key}']));
  });

  it('builds the domain session (account, user) and the project session (project id, catalogue) from signed reads; one domain lookup per scope run', async () => {
    const f = fake(OK_ROUTES);
    const c = ctx(f.fetch);
    const d = await otcDomainToken(c);
    expect(d).toMatchObject({ value: '', domainId: DOMAIN, userId: 'u1', projectId: '', auth: { kind: 'aksk' } });
    const p = await otcToken(c, 'eu-de');
    expect(p).toMatchObject({ domainId: DOMAIN, userId: 'u1', projectId: PROJECT, projectName: 'eu-de' });
    expect(p.catalog.map((e) => e.type)).toEqual(['compute']);
    expect(f.seen.filter((s) => s.url.endsWith('/v3/auth/domains'))).toHaveLength(1);
    // headers: signed, no token; account reads X-Domain-Id (the first none), project reads X-Project-Id
    for (const s of f.seen) {
      expect(s.headers['authorization']).toMatch(/^SDK-HMAC-SHA256 Credential=MOCKAK\//);
      expect(s.headers['x-auth-token']).toBeUndefined();
    }
    expect(f.seen[0]?.headers['x-domain-id']).toBeUndefined();
    expect(f.seen.find((s) => s.url.endsWith('/v3/auth/projects'))?.headers['x-domain-id']).toBe(DOMAIN);
    expect(f.seen.find((s) => s.url.endsWith('/v3/auth/catalog'))?.headers['x-project-id']).toBe(PROJECT);
    await otcGet(c, p, `https://ecs.example/v2.1/${PROJECT}/os-availability-zone`, 'r').catch(() => undefined);
    expect(f.seen[f.seen.length - 1]?.headers['x-project-id']).toBe(PROJECT);
  });

  it('a temporary key sends X-Security-Token and has no user (credential lookup 404); the probe is unverifiable without any IAM role read', async () => {
    const f = fake({ ...OK_ROUTES, '/v3.0/OS-CREDENTIAL/credentials/MOCKAK': () => ({ status: 404, body: { error: { code: 404, message: 'Not Found AK' } } }) });
    const c = ctx(f.fetch, { 'access-key-id': 'MOCKAK', 'secret-access-key': SK, 'session-token': 'tmp-token' });
    const probe = await otcDriver.probeReadOnly(c);
    expect(probe).toMatchObject({ read_only: 'unverifiable', identity: 'access key' });
    expect(f.seen.every((s) => s.headers['x-security-token'] === 'tmp-token')).toBe(true);
    expect(f.seen.some((s) => s.url.includes('/groups'))).toBe(false);
  });

  it('refusals: missing fields, 401 / 403 on the account read, no account, project not listed, catalogue 403 are LiveAuthError; a 5xx stays an HTTP error', async () => {
    await expect(otcDomainToken(ctx(fake(OK_ROUTES).fetch, { 'access-key-id': 'MOCKAK' }))).rejects.toThrow(/access-key-id and secret-access-key/);
    for (const status of [401, 403]) {
      // A 401 reaches the client as the HTTP layer's LiveTokenRejectedError (#3750); the session names the key, not a token.
      const err = await otcDomainToken(ctx(fake({ ...OK_ROUTES, '/v3/auth/domains': () => ({ status, body: {} }) }).fetch)).catch((e: unknown) => e);
      expect(err).toMatchObject({ name: 'LiveAuthError', httpStatus: status });
      expect((err as Error).message).toMatch(/the access key or its signature was refused on \/v3\/auth\/domains/);
      expect((err as Error).message).not.toMatch(/token was refused|mid-run/);
    }
    const temp = await otcDomainToken(ctx(fake({ ...OK_ROUTES, '/v3/auth/domains': () => ({ status: 401, body: {} }) }).fetch, { 'access-key-id': 'MOCKAK', 'secret-access-key': SK, 'session-token': 't' })).catch((e: unknown) => e);
    expect((temp as Error).message).toMatch(/temporary key and its session-token/);
    await expect(otcDomainToken(ctx(fake({ ...OK_ROUTES, '/v3/auth/domains': () => ({ status: 200, body: { domains: [] } }) }).fetch))).rejects.toBeInstanceOf(LiveAuthError);
    await expect(otcToken(ctx(fake({ ...OK_ROUTES, '/v3/auth/projects': () => ({ status: 200, body: { projects: [{ id: 'x', name: 'eu-nl' }] } }) }).fetch), 'eu-de')).rejects.toThrow(/no access to project eu-de/);
    await expect(otcToken(ctx(fake({ ...OK_ROUTES, '/v3/auth/catalog': () => ({ status: 403, body: {} }) }).fetch), 'eu-de')).rejects.toMatchObject({ name: 'LiveAuthError', httpStatus: 403 });
    await expect(otcToken(ctx(fake({ ...OK_ROUTES, '/v3/auth/catalog': () => ({ status: 401, body: {} }) }).fetch), 'eu-de')).rejects.toThrow(/access key or its signature was refused on \/v3\/auth\/catalog for project eu-de/);
    await expect(otcDomainToken(ctx(fake({ ...OK_ROUTES, '/v3/auth/domains': () => ({ status: 503, body: {} }) }).fetch))).rejects.toMatchObject({ name: 'OtcHttpError', status: 503 });
  });
});
