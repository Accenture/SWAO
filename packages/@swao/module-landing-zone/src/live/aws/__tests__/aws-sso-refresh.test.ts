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

// #4459 (CLAUDE.md section 5.9): the AWS SSO refresh against a mock server
// before any real call. Pins the request shapes (register, device
// authorisation, token polling, role credentials), the pending and slow_down
// polling, an expired device code, a refused sign-in, 401 and 5xx, both AWS
// config forms, and that no token, key, client secret or device code reaches
// a prompt, a log event or an error message. A local http server on port 0 is
// the mock; no AWS endpoint and no real AWS config is touched.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const events: Array<{ level: string; code: string; message: string; context: Record<string, unknown> }> = [];
vi.mock('@swao/core', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@swao/core')>();
  return {
    ...orig,
    logPortfolio: (level: string, code: string, message: string, opts: { context?: Record<string, unknown> } = {}) => {
      events.push({ level, code, message, context: opts.context ?? {} });
    },
  };
});

const { CredentialStore, resolveLzCredentials } = await import('@swao/core');
const {
  AWS_SSO_DEVICE_GRANT, AwsSsoRefreshError, awsConfigPath, awsSsoExpiration, pickAwsSsoProfile, readAwsSsoProfiles, runAwsSsoDeviceFlow,
} = await import('../aws-sso-refresh.js');
const { refreshAwsSsoScope, awsSsoProfilesForScope } = await import('../aws-sso-scope.js');
type FetchLike = import('../../types.js').FetchLike;

// Fake values, built at runtime so no secret-shaped literal is committed.
const fake = (...p: string[]): string => ['fake', ...p].join('-');
const CLIENT_ID = fake('client', 'id');
const CLIENT_SECRET = fake('client', 'secret');
const DEVICE_CODE = fake('device', 'code');
const ACCESS_TOKEN = fake('sso', 'access', 'token');
const AK = fake('ak');
const SK = fake('sk');
const ST = fake('st');
const SECRETS = [CLIENT_SECRET, DEVICE_CODE, ACCESS_TOKEN, AK, SK, ST];
const USER_CODE = 'ABCD-EFGH';
const ACCOUNT = '111122223333';
const OTHER_ACCOUNT = '444455556666';
const EXPIRES_MS = Date.parse('2026-11-15T20:00:00Z');

const CONFIG = [
  '# comment',
  '[default]',
  'region = eu-central-1',
  '',
  '[profile legacy-ro]',
  'sso_start_url = https://example-start.awsapps.com/start',
  'sso_region = eu-west-1',
  'sso_account_id = ' + ACCOUNT,
  'sso_role_name = ReadOnly',
  'region = eu-central-1',
  '',
  '[profile session-ro]',
  'sso_session = corp',
  'sso_account_id = ' + OTHER_ACCOUNT,
  'sso_role_name = SecurityAudit',
  'region = us-east-1',
  '',
  '[sso-session corp]',
  'sso_start_url = https://corp-start.awsapps.com/start',
  'sso_region = eu-north-1',
  '',
  '[profile keys-only]',
  'aws_access_key_id = not-sso',
  '',
].join('\n');

interface Seen { method: string; path: string; headers: Record<string, string | string[] | undefined>; body: string }
type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

/** A mock of the SSO OIDC and portal endpoints on one local server (port 0). */
async function mockServer(tokenReplies: Reply[], overrides: Partial<Record<'register' | 'device' | 'portal', Reply>> = {}): Promise<{ base: string; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  const queue = [...tokenReplies];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString('utf-8'); });
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      seen.push({ method: req.method ?? '', path: `${url.pathname}${url.search}`, headers: req.headers, body });
      const send = (r: Reply): void => {
        res.writeHead(r.status, { 'content-type': 'application/json', ...(r.headers ?? {}) });
        res.end(r.body === undefined ? '' : JSON.stringify(r.body));
      };
      if (url.pathname === '/oidc/client/register') return send(overrides.register ?? { status: 200, body: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, clientIdIssuedAt: 1, clientSecretExpiresAt: 2 } });
      if (url.pathname === '/oidc/device_authorization') {
        return send(overrides.device ?? { status: 200, body: { deviceCode: DEVICE_CODE, userCode: USER_CODE, verificationUri: 'https://device.sso.example/', verificationUriComplete: `https://device.sso.example/?user_code=${USER_CODE}`, expiresIn: 600, interval: 5 } });
      }
      if (url.pathname === '/oidc/token') return send(queue.shift() ?? { status: 500, body: { error: 'no more replies' } });
      if (url.pathname === '/portal/federation/credentials') {
        return send(overrides.portal ?? { status: 200, body: { roleCredentials: { accessKeyId: AK, secretAccessKey: SK, sessionToken: ST, expiration: EXPIRES_MS } } });
      }
      return send({ status: 404 });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const transport: FetchLike = (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;
const PENDING: Reply = { status: 400, body: { error: 'authorization_pending', error_description: 'pending' } };
const SLOW: Reply = { status: 400, body: { error: 'slow_down' } };
const TOKEN_OK: Reply = { status: 200, body: { accessToken: ACCESS_TOKEN, tokenType: 'Bearer', expiresIn: 28800 } };
const LEGACY = readAwsSsoProfiles(CONFIG).find((p) => p.name === 'legacy-ro')!;

const tmp: string[] = [];
const tempDir = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); tmp.push(d); return d; };
let closeServer: (() => Promise<void>) | null = null;
beforeEach(() => { events.length = 0; });
afterEach(async () => {
  if (closeServer) await closeServer();
  closeServer = null;
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

function expectNoSecret(text: string): void {
  for (const s of SECRETS) expect(text).not.toContain(s);
}

describe('AWS config profiles (#4459)', () => {
  it('reads the legacy form and the sso-session form; the SSO region of a session wins over the profile region', () => {
    const p = readAwsSsoProfiles(CONFIG);
    expect(p.map((x) => x.name)).toEqual(['legacy-ro', 'session-ro']);
    expect(p[0]).toMatchObject({ startUrl: 'https://example-start.awsapps.com/start', ssoRegion: 'eu-west-1', accountId: ACCOUNT, roleName: 'ReadOnly' });
    expect(p[1]).toMatchObject({ startUrl: 'https://corp-start.awsapps.com/start', ssoRegion: 'eu-north-1', accountId: OTHER_ACCOUNT, roleName: 'SecurityAudit', session: 'corp' });
  });

  it('the config path is AWS_CONFIG_FILE, else <home>/.aws/config', () => {
    expect(awsConfigPath({ AWS_CONFIG_FILE: '/x/config' }, '/home/u')).toBe('/x/config');
    expect(awsConfigPath({}, '/home/u/')).toBe('/home/u/.aws/config');
  });

  it('picks by name, by the scope account, and refuses a mismatch, an unknown name and an ambiguous choice', () => {
    const p = readAwsSsoProfiles(CONFIG);
    expect(pickAwsSsoProfile(p, { scopeAccount: ACCOUNT }).name).toBe('legacy-ro');
    expect(pickAwsSsoProfile(p, { name: 'session-ro' }).name).toBe('session-ro');
    expect(() => pickAwsSsoProfile(p, { name: 'session-ro', scopeAccount: ACCOUNT })).toThrow(/another account/);
    expect(() => pickAwsSsoProfile(p, { name: 'nope' })).toThrow(/no SSO profile nope/);
    expect(() => pickAwsSsoProfile(p, {})).toThrow(/more than one SSO profile fits/);
    expect(() => pickAwsSsoProfile([], {})).toThrow(/no SSO profile/);
    // No account id in a refusal message.
    try { pickAwsSsoProfile(p, { name: 'session-ro', scopeAccount: ACCOUNT }); } catch (e) { expect((e as Error).message).not.toContain(OTHER_ACCOUNT); expect((e as Error).message).not.toContain(ACCOUNT); }
  });

  it('the expiration becomes an ISO 8601 UTC string (epoch ms, epoch s, ISO)', () => {
    expect(awsSsoExpiration(EXPIRES_MS)).toBe('2026-11-15T20:00:00.000Z');
    expect(awsSsoExpiration(EXPIRES_MS / 1000)).toBe('2026-11-15T20:00:00.000Z');
    expect(awsSsoExpiration('2026-11-15T20:00:00Z')).toBe('2026-11-15T20:00:00.000Z');
    expect(awsSsoExpiration(undefined)).toBeUndefined();
  });
});

describe('AWS SSO device flow against a mock server (#4459)', () => {
  it('happy path: request shapes, pending then slow_down polling, role credentials; only URL and code are shown', async () => {
    const m = await mockServer([PENDING, SLOW, TOKEN_OK]);
    closeServer = m.close;
    const sleeps: number[] = [];
    const prompts: unknown[] = [];
    const waits: Array<[string, number]> = [];
    const creds = await runAwsSsoDeviceFlow({
      profile: LEGACY, transport, oidcBaseUrl: `${m.base}/oidc`, portalBaseUrl: `${m.base}/portal`,
      onPrompt: (p) => prompts.push(p), onWaiting: (s, n) => waits.push([s, n]),
      sleep: async (ms) => { sleeps.push(ms); }, now: () => 0,
    });
    expect(creds).toEqual({ accessKeyId: AK, secretAccessKey: SK, sessionToken: ST, expiresAt: '2026-11-15T20:00:00.000Z' });
    expect(m.seen.map((s) => `${s.method} ${s.path.split('?')[0]}`)).toEqual([
      'POST /oidc/client/register', 'POST /oidc/device_authorization', 'POST /oidc/token', 'POST /oidc/token', 'POST /oidc/token', 'GET /portal/federation/credentials',
    ]);
    expect(JSON.parse(m.seen[0]!.body)).toEqual({ clientName: 'swao-lz-live', clientType: 'public' });
    expect(JSON.parse(m.seen[1]!.body)).toEqual({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, startUrl: LEGACY.startUrl });
    expect(JSON.parse(m.seen[2]!.body)).toEqual({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, grantType: AWS_SSO_DEVICE_GRANT, deviceCode: DEVICE_CODE });
    const portal = m.seen[5]!;
    expect(new URL(portal.path, 'http://x').searchParams.get('account_id')).toBe(ACCOUNT);
    expect(new URL(portal.path, 'http://x').searchParams.get('role_name')).toBe('ReadOnly');
    expect(portal.headers['x-amz-sso_bearer_token']).toBe(ACCESS_TOKEN);
    expect(m.seen[0]!.headers['content-type']).toBe('application/json');
    // interval 5 s, plus 5 s after slow_down.
    expect(sleeps).toEqual([5000, 5000, 10000]);
    expect(waits).toEqual([['pending', 5], ['slow_down', 10]]);
    expect(prompts).toEqual([{ verificationUri: 'https://device.sso.example/', verificationUriComplete: `https://device.sso.example/?user_code=${USER_CODE}`, userCode: USER_CODE, expiresInS: 600 }]);
    expectNoSecret(JSON.stringify(prompts));
  });

  it('the exception spelling (__type and x-amzn-ErrorType) is read as well', async () => {
    const m = await mockServer([
      { status: 400, body: { __type: 'com.amazonaws.ssooidc#AuthorizationPendingException' } },
      { status: 400, body: {}, headers: { 'x-amzn-ErrorType': 'SlowDownException:http://internal' } },
      TOKEN_OK,
    ]);
    closeServer = m.close;
    const sleeps: number[] = [];
    await runAwsSsoDeviceFlow({ profile: LEGACY, transport, oidcBaseUrl: `${m.base}/oidc`, portalBaseUrl: `${m.base}/portal`, onPrompt: () => {}, sleep: async (ms) => { sleeps.push(ms); }, now: () => 0 });
    expect(sleeps).toEqual([5000, 5000, 10000]);
  });

  it('an expired device code (expired_token) stops with code expired; the deadline stops it as well', async () => {
    const m = await mockServer([PENDING, { status: 400, body: { error: 'expired_token' } }]);
    closeServer = m.close;
    const err = await runAwsSsoDeviceFlow({ profile: LEGACY, transport, oidcBaseUrl: `${m.base}/oidc`, portalBaseUrl: `${m.base}/portal`, onPrompt: () => {}, sleep: async () => {}, now: () => 0 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AwsSsoRefreshError);
    expect((err as InstanceType<typeof AwsSsoRefreshError>).code).toBe('expired');
    expectNoSecret((err as Error).message);

    const m2 = await mockServer([PENDING, PENDING, PENDING]);
    let t = 0;
    const err2 = await runAwsSsoDeviceFlow({ profile: LEGACY, transport, oidcBaseUrl: `${m2.base}/oidc`, portalBaseUrl: `${m2.base}/portal`, onPrompt: () => {}, sleep: async (ms) => { t += ms * 70; }, now: () => t }).catch((e: unknown) => e);
    await m2.close();
    expect((err2 as InstanceType<typeof AwsSsoRefreshError>).code).toBe('expired');
    expect(m2.seen.filter((s) => s.path === '/oidc/token').length).toBeLessThan(3);
  });

  it('a refused sign-in (access_denied) stops with code denied', async () => {
    const m = await mockServer([{ status: 400, body: { error: 'access_denied' } }]);
    closeServer = m.close;
    await expect(runAwsSsoDeviceFlow({ profile: LEGACY, transport, oidcBaseUrl: `${m.base}/oidc`, portalBaseUrl: `${m.base}/portal`, onPrompt: () => {}, sleep: async () => {}, now: () => 0 }))
      .rejects.toMatchObject({ code: 'denied' });
  });

  it('401 on the role credentials is unauthorized; 5xx on the registration is server; neither message carries a secret', async () => {
    const m = await mockServer([TOKEN_OK], { portal: { status: 401, body: { message: `token ${ACCESS_TOKEN} invalid` }, headers: { 'x-amzn-ErrorType': 'UnauthorizedException' } } });
    closeServer = m.close;
    const e1 = await runAwsSsoDeviceFlow({ profile: LEGACY, transport, oidcBaseUrl: `${m.base}/oidc`, portalBaseUrl: `${m.base}/portal`, onPrompt: () => {}, sleep: async () => {}, now: () => 0 }).catch((e: unknown) => e);
    expect(e1).toMatchObject({ code: 'unauthorized', httpStatus: 401 });
    expectNoSecret((e1 as Error).message);
    await m.close();

    const m2 = await mockServer([], { register: { status: 503, body: { message: 'unavailable' } } });
    closeServer = m2.close;
    const e2 = await runAwsSsoDeviceFlow({ profile: LEGACY, transport, oidcBaseUrl: `${m2.base}/oidc`, portalBaseUrl: `${m2.base}/portal`, onPrompt: () => {}, sleep: async () => {}, now: () => 0 }).catch((e: unknown) => e);
    expect(e2).toMatchObject({ code: 'server', httpStatus: 503 });
    expect(m2.seen).toHaveLength(1); // nothing after a failed registration
  });

  it('default endpoints are the regional OIDC and portal hosts of the SSO region', async () => {
    const urls: string[] = [];
    const t: FetchLike = async (url) => {
      urls.push(url);
      const body = url.endsWith('/client/register') ? { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }
        : url.endsWith('/device_authorization') ? { deviceCode: DEVICE_CODE, userCode: USER_CODE, verificationUri: 'https://device.sso.example/', expiresIn: 60, interval: 1 }
          : url.endsWith('/token') ? { accessToken: ACCESS_TOKEN }
            : { roleCredentials: { accessKeyId: AK, secretAccessKey: SK, sessionToken: ST, expiration: EXPIRES_MS } };
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
    };
    await runAwsSsoDeviceFlow({ profile: LEGACY, transport: t, onPrompt: () => {}, sleep: async () => {}, now: () => 0 });
    expect(urls.map((u) => u.split('?')[0])).toEqual([
      'https://oidc.eu-west-1.amazonaws.com/client/register',
      'https://oidc.eu-west-1.amazonaws.com/device_authorization',
      'https://oidc.eu-west-1.amazonaws.com/token',
      'https://portal.sso.eu-west-1.amazonaws.com/federation/credentials',
    ]);
  });
});

describe('refreshAwsSsoScope: vault write of one AWS session-keys scope (#4459)', () => {
  const YML = [
    'name: demo',
    'landing_zones:',
    '  - id: aws-prod',
    '    provider: aws',
    '    scopes:',
    '      - id: platform',
    '        kind: platform',
    '        auth: session-keys',
    '        regions: [eu-central-1]',
    '        target:',
    `          account: "${ACCOUNT}"`,
    '  - id: otc-prod',
    '    provider: otc',
    '    scopes:',
    '      - id: platform',
    '        kind: platform',
    '        auth: iam-password-token',
    '        regions: [eu-de]',
    '',
  ].join('\n');

  function setup(): { ws: string; home: string; store: InstanceType<typeof CredentialStore> } {
    const ws = tempDir('swao-sso-ws-');
    writeFileSync(join(ws, '.swao.yml'), YML);
    const home = tempDir('swao-sso-home-');
    mkdirSync(join(home, '.aws'), { recursive: true });
    writeFileSync(join(home, '.aws', 'config'), CONFIG);
    return { ws, home, store: new CredentialStore(tempDir('swao-sso-vault-')) };
  }

  it('matches the profile by the target account, stores the four fields, and the stored expiry passes the credential check', async () => {
    const h = setup();
    const m = await mockServer([PENDING, TOKEN_OK]);
    closeServer = m.close;
    await h.store.set('lz:aws-prod:platform:expires-at', '2020-01-01T00:00:00Z');
    const prompts: string[] = [];
    const out = await refreshAwsSsoScope({
      workspaceRoot: h.ws, lzId: 'aws-prod', scopeId: 'platform', store: h.store, env: {}, home: h.home,
      transport, oidcBaseUrl: `${m.base}/oidc`, portalBaseUrl: `${m.base}/portal`,
      onPrompt: (p) => prompts.push(`${p.verificationUri} ${p.userCode}`), sleep: async () => {}, now: () => 0,
    });
    expect(out.profile).toBe('legacy-ro');
    expect(out.expiresAt).toBe('2026-11-15T20:00:00.000Z');
    expect(out.storedKeys.sort()).toEqual(['lz:aws-prod:platform:access-key-id', 'lz:aws-prod:platform:expires-at', 'lz:aws-prod:platform:secret-access-key', 'lz:aws-prod:platform:session-token']);
    expect(await h.store.get('lz:aws-prod:platform:secret-access-key')).toBe(SK);
    const c = await resolveLzCredentials(h.store, 'aws-prod', 'platform', ['access-key-id', 'secret-access-key'], ['session-token'], new Date('2026-11-15T19:00:00Z'));
    expect(c['session-token']).toBe(ST);
    const e = events.find((x) => x.code === 'lz.credentials.refresh')!;
    expect(e.level).toBe('info');
    expect(e.context).toMatchObject({ lz_id: 'aws-prod', scope_id: 'platform', profile: 'legacy-ro', outcome: 'stored' });
    expectNoSecret(JSON.stringify(events));
    expectNoSecret(prompts.join('\n'));
    expect(JSON.stringify(events)).not.toContain(ACCOUNT);
  });

  it('a refused sign-in leaves the vault unchanged and logs the outcome; a profile of another account is refused before any call', async () => {
    const h = setup();
    const m = await mockServer([{ status: 400, body: { error: 'access_denied' } }]);
    closeServer = m.close;
    await h.store.set('lz:aws-prod:platform:access-key-id', fake('old', 'ak'));
    const base = { workspaceRoot: h.ws, lzId: 'aws-prod', scopeId: 'platform', store: h.store, env: {}, home: h.home, transport, oidcBaseUrl: `${m.base}/oidc`, portalBaseUrl: `${m.base}/portal`, onPrompt: () => {}, sleep: async () => {}, now: () => 0 };
    const err = await refreshAwsSsoScope(base).catch((x: unknown) => x);
    expect((err as Error).message).toMatch(/refused in the browser; nothing was stored/);
    expect((err as { exitCode?: number }).exitCode).toBe(2);
    expect(await h.store.get('lz:aws-prod:platform:access-key-id')).toBe(fake('old', 'ak'));
    expect(events.find((x) => x.code === 'lz.credentials.refresh')).toMatchObject({ level: 'warn', context: { outcome: 'denied' } });

    const before = m.seen.length;
    await expect(refreshAwsSsoScope({ ...base, profileName: 'session-ro' })).rejects.toThrow(/another account/);
    expect(m.seen.length).toBe(before);
  });

  it('refuses a scope that is not AWS session keys, and lists the profiles of the scope account for the TUI', async () => {
    const h = setup();
    await expect(refreshAwsSsoScope({ workspaceRoot: h.ws, lzId: 'otc-prod', scopeId: 'platform', store: h.store, env: {}, home: h.home, onPrompt: () => {} })).rejects.toThrow(/not an AWS landing zone/);
    await expect(refreshAwsSsoScope({ workspaceRoot: h.ws, lzId: 'aws-prod', scopeId: 'nope', store: h.store, env: {}, home: h.home, onPrompt: () => {} })).rejects.toThrow(/no scope nope/);
    expect(awsSsoProfilesForScope({ workspaceRoot: h.ws, lzId: 'aws-prod', scopeId: 'platform', env: {}, home: h.home }).map((p) => p.name)).toEqual(['legacy-ro']);
    expect(awsSsoProfilesForScope({ workspaceRoot: h.ws, lzId: 'aws-prod', scopeId: 'platform', env: { AWS_CONFIG_FILE: join(h.home, 'missing') }, home: h.home })).toEqual([]);
    // A scope account no profile signs in to: nothing to offer (the CLI would refuse every profile).
    writeFileSync(join(h.home, '.aws', 'config'), CONFIG.split(ACCOUNT).join('999999999999'));
    expect(awsSsoProfilesForScope({ workspaceRoot: h.ws, lzId: 'aws-prod', scopeId: 'platform', env: {}, home: h.home })).toEqual([]);
  });

  // #4459 owner decision 2026-11-16: the optional aws_profile of the scope names the profile.
  it('signs in with the aws_profile of the scope when set; --profile still wins; without it two profiles are ambiguous', async () => {
    const h = setup();
    const noTarget = (profileLine: string): string => [
      'name: demo', 'landing_zones:', '  - id: aws-prod', '    provider: aws', '    scopes:',
      '      - id: platform', '        kind: platform', '        auth: session-keys', profileLine, '',
    ].filter((l) => l !== '').join('\n') + '\n';
    writeFileSync(join(h.ws, '.swao.yml'), noTarget(''));
    const m = await mockServer([TOKEN_OK, TOKEN_OK]);
    closeServer = m.close;
    const base = { workspaceRoot: h.ws, lzId: 'aws-prod', scopeId: 'platform', store: h.store, env: {}, home: h.home, transport, oidcBaseUrl: `${m.base}/oidc`, portalBaseUrl: `${m.base}/portal`, onPrompt: () => {}, sleep: async () => {}, now: () => 0 };
    await expect(refreshAwsSsoScope(base)).rejects.toThrow(/more than one SSO profile fits/);
    expect(awsSsoProfilesForScope(base).map((p) => p.name)).toEqual(['legacy-ro', 'session-ro']);

    writeFileSync(join(h.ws, '.swao.yml'), noTarget('        aws_profile: session-ro'));
    expect(awsSsoProfilesForScope(base).map((p) => p.name)).toEqual(['session-ro']);
    const out = await refreshAwsSsoScope(base);
    expect(out.profile).toBe('session-ro');
    expect(events.filter((x) => x.code === 'lz.credentials.refresh').at(-1)).toMatchObject({ level: 'info', context: { profile: 'session-ro', profile_source: 'swao_yml' } });

    const over = await refreshAwsSsoScope({ ...base, profileName: 'legacy-ro' });
    expect(over.profile).toBe('legacy-ro');
    expect(events.filter((x) => x.code === 'lz.credentials.refresh').at(-1)).toMatchObject({ context: { profile_source: 'option' } });
    expectNoSecret(JSON.stringify(events));

    // A named profile missing from the AWS config is refused with the profile names, never a value.
    writeFileSync(join(h.ws, '.swao.yml'), noTarget('        aws_profile: gone'));
    await expect(refreshAwsSsoScope(base)).rejects.toThrow(/no SSO profile gone/);
    expect(awsSsoProfilesForScope(base).map((p) => p.name)).toEqual(['legacy-ro', 'session-ro']);
  });
});

describe('swao lz credentials refresh (#4459, CLI)', () => {
  const YML = ['name: demo', 'landing_zones:', '  - id: aws-prod', '    provider: aws', '    scopes:', '      - id: platform', '        kind: platform', '        auth: session-keys', '        regions: [eu-central-1]', '        target:', `          account: "${ACCOUNT}"`, ''].join('\n');

  it('prints the URL and the code, then the stored field names and the expiry; never a value', async () => {
    const { lzCredentialsRefreshAction } = await import('../../cli.js');
    const ws = tempDir('swao-sso-cli-ws-');
    writeFileSync(join(ws, '.swao.yml'), YML);
    const home = tempDir('swao-sso-cli-home-');
    mkdirSync(join(home, '.aws'), { recursive: true });
    writeFileSync(join(home, '.aws', 'config'), CONFIG);
    const store = new CredentialStore(tempDir('swao-sso-cli-vault-'));
    const m = await mockServer([PENDING, PENDING, TOKEN_OK]);
    closeServer = m.close;
    const out: string[] = [];
    const err: string[] = [];
    const deps = { cwd: ws, store, env: {}, fetchImpl: transport, out: (l: string) => out.push(l), err: (l: string) => err.push(l), guard: { requireFeature: () => undefined } };
    const code = await lzCredentialsRefreshAction('aws-prod', 'platform', {}, deps, { home, oidcBaseUrl: `${m.base}/oidc`, portalBaseUrl: `${m.base}/portal`, sleep: async () => {}, now: () => 0 });
    expect(err).toEqual([]);
    expect(code).toBe(0);
    const text = out.join('\n');
    // #4496: the URL and the code each on a line of their own (the URL copies as one piece).
    expect(out).toContain(`https://device.sso.example/?user_code=${USER_CODE}`);
    expect(out).toContain(`code: ${USER_CODE}`);
    expect(text).toContain('open this URL in a browser and confirm the code');
    // Without the opener seam nothing is opened and nothing is said about a browser.
    expect(text).not.toContain('default browser');
    expect(out.filter((l) => l.includes('waiting for the sign-in'))).toHaveLength(1);
    expect(text).toContain('from the AWS profile legacy-ro');
    expect(text).toContain('the session expires at 2026-11-15T20:00:00.000Z');
    expectNoSecret(text);
    expect(await store.get('lz:aws-prod:platform:session-token')).toBe(ST);
  });

  it('#4496: opens the URL with the opener and says so; --aws-profile stores the profile with the minimal-patch writer, comments kept', async () => {
    const { lzCredentialsRefreshAction } = await import('../../cli.js');
    const ws = tempDir('swao-sso-cli-ws-');
    writeFileSync(join(ws, '.swao.yml'), `# kept comment${String.fromCharCode(10)}${YML}`);
    const home = tempDir('swao-sso-cli-home-');
    mkdirSync(join(home, '.aws'), { recursive: true });
    writeFileSync(join(home, '.aws', 'config'), CONFIG);
    const m = await mockServer([TOKEN_OK]);
    closeServer = m.close;
    const out: string[] = [];
    const opened: string[] = [];
    const deps = { cwd: ws, store: new CredentialStore(tempDir('swao-sso-cli-vault-')), env: {}, fetchImpl: transport, out: (l: string) => out.push(l), err: () => {}, guard: { requireFeature: () => undefined } };
    const code = await lzCredentialsRefreshAction('aws-prod', 'platform', { awsProfile: 'legacy-ro' }, deps, { home, oidcBaseUrl: `${m.base}/oidc`, portalBaseUrl: `${m.base}/portal`, sleep: async () => {}, now: () => 0, openUrl: (u) => { opened.push(u); return true; } });
    expect(code).toBe(0);
    expect(opened).toEqual([`https://device.sso.example/?user_code=${USER_CODE}`]);
    expect(out.join(String.fromCharCode(10))).toContain('opened in the default browser');
    expect(out.join(String.fromCharCode(10))).toContain('aws_profile legacy-ro stored for aws-prod / platform');
    const yml = readFileSync(join(ws, '.swao.yml'), 'utf-8');
    expect(yml).toContain('# kept comment');
    expect(yml).toMatch(/aws_profile: legacy-ro/);
  });

  it('#4496: only an https AWS sign-in URL is opened', async () => {
    const { isAwsSignInUrl } = await import('../aws-sso-scope.js');
    expect(isAwsSignInUrl('https://device.sso.eu-central-1.amazonaws.com/?user_code=AB-CD')).toBe(true);
    expect(isAwsSignInUrl('https://d-123.awsapps.com/start/#/device')).toBe(true);
    expect(isAwsSignInUrl('http://device.sso.eu-central-1.amazonaws.com/')).toBe(false);
    expect(isAwsSignInUrl('https://example.com/?u=amazonaws.com')).toBe(false);
    expect(isAwsSignInUrl('file:///etc/passwd')).toBe(false);
  });

  it('a failed sign-in exits 2 with the reason on stderr and no value', async () => {
    const { lzCredentialsRefreshAction } = await import('../../cli.js');
    const ws = tempDir('swao-sso-cli-ws-');
    writeFileSync(join(ws, '.swao.yml'), YML);
    const home = tempDir('swao-sso-cli-home-');
    mkdirSync(join(home, '.aws'), { recursive: true });
    writeFileSync(join(home, '.aws', 'config'), CONFIG);
    const m = await mockServer([{ status: 500, body: { message: `boom ${DEVICE_CODE}` } }]);
    closeServer = m.close;
    const out: string[] = [];
    const err: string[] = [];
    const deps = { cwd: ws, store: new CredentialStore(tempDir('swao-sso-cli-vault-')), env: {}, fetchImpl: transport, out: (l: string) => out.push(l), err: (l: string) => err.push(l), guard: { requireFeature: () => undefined } };
    expect(await lzCredentialsRefreshAction('aws-prod', 'platform', {}, deps, { home, oidcBaseUrl: `${m.base}/oidc`, portalBaseUrl: `${m.base}/portal`, sleep: async () => {}, now: () => 0 })).toBe(2);
    expect(err.join('\n')).toMatch(/AWS SSO refresh: the AWS sign-in service failed on the token request \(HTTP 500\)/);
    expectNoSecret([...out, ...err].join('\n'));
  });
});
