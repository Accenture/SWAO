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

// #3571: LiveLzDriver registry, read-only allow-list, endpoint seam, recorder,
// read-only gate and the `swao lz connect` / `swao lz probe` actions.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CredentialStore, LzCredentialExpiredError } from '@swao/core';
import { registerLiveLzDriver, unregisterLiveLzDriver, registeredLiveLzProviders, getLiveLzDriver } from '../registry.js';
import { createReadOnlyFetch, ReadOnlyViolationError } from '../http.js';
import { resolveEndpoints, EndpointOverrideError, MOCK_ENDPOINTS_ENV } from '../endpoints.js';
import { createRecordingFetch, routeOf, validateRecordingDir, RecordingLocationError, RECORD_ENV } from '../record.js';
import { evaluateReadOnlyGate, readLandingZones, writeLandingZones, runLzProbe, WRITE_CAPABLE_ACCEPTED_REASON } from '../session.js';
import { lzConnectAction, lzProbeAction } from '../cli.js';
import type { LzLiveCliDeps } from '../cli.js';
import { makeFakeDriver, makeTransport, VERIFIED, REFUSED, UNVERIFIABLE } from './fake-driver.js';
import type { WireCall } from './fake-driver.js';

const tmp: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmp.push(d);
  return d;
}

// Fake values, built at runtime so no secret-shaped literal is committed.
const AK = ['fake', 'ak', 'value'].join('-');
const SK = ['fake', 'sk', 'value'].join('-');

const REGISTERED_YML = [
  '# workspace config',
  'name: demo',
  'landing_zones:',
  '  - id: fake-prod',
  '    provider: fakecsp',
  '    scopes:',
  '      - id: platform',
  '        kind: platform',
  '        auth: aksk',
  '        regions: [eu-de]',
  '# trailing comment kept',
  'assessment:',
  '  regimes_active: []',
  '',
].join('\n');

interface Harness {
  ws: string;
  store: CredentialStore;
  calls: WireCall[];
  out: string[];
  err: string[];
  deps: (env?: NodeJS.ProcessEnv) => LzLiveCliDeps;
}

function harness(yml = REGISTERED_YML): Harness {
  const ws = tempDir('swao-lz-live-ws-');
  writeFileSync(join(ws, '.swao.yml'), yml);
  const store = new CredentialStore(tempDir('swao-lz-live-vault-'));
  const calls: WireCall[] = [];
  const out: string[] = [];
  const err: string[] = [];
  return {
    ws, store, calls, out, err,
    deps: (env = {}) => ({ cwd: ws, store, env, fetchImpl: makeTransport(calls), out: (l) => out.push(l), err: (l) => err.push(l), guard: { requireFeature: () => undefined } }),
  };
}

async function storeScopeKeys(store: CredentialStore, lz = 'fake-prod', scope = 'platform'): Promise<void> {
  await store.set(`lz:${lz}:${scope}:access-key-id`, AK);
  await store.set(`lz:${lz}:${scope}:secret-access-key`, SK);
}

beforeEach(() => {
  unregisterLiveLzDriver();
});
afterEach(() => {
  unregisterLiveLzDriver();
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe('LiveLzDriver registry', () => {
  it('registers a valid driver and refuses an invalid descriptor', () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    expect(registeredLiveLzProviders()).toEqual(['fakecsp']);
    expect(getLiveLzDriver('fakecsp')?.driverVersion).toBe('0.0.0-test');
    expect(() => registerLiveLzDriver(makeFakeDriver(VERIFIED, { provider: 'Bad Id' }))).toThrow(/invalid driver/);
    expect(() => registerLiveLzDriver(makeFakeDriver(VERIFIED, { defaultBaseUrls: { iam: 'http://iam.example' } }))).toThrow(/https/);
    expect(() => registerLiveLzDriver(makeFakeDriver(VERIFIED, { authMethods: [] }))).toThrow(/invalid driver/);
  });
});

describe('read-only HTTP allow-list', () => {
  it('refuses every non-read request before it is sent', async () => {
    const calls: WireCall[] = [];
    const f = createReadOnlyFetch(makeTransport(calls), 'fakecsp', [{ method: 'POST', path: /^\/v3\/auth\/tokens$/, reason: 'token request, changes nothing' }]);
    for (const method of ['DELETE', 'PUT', 'PATCH']) {
      await expect(f('https://ecs.fakecsp.example/v1/servers/1', { method })).rejects.toBeInstanceOf(ReadOnlyViolationError);
    }
    await expect(f('https://ecs.fakecsp.example/v1/servers', { method: 'POST', body: '{}' })).rejects.toThrow(/not on the read allow-list/);
    await expect(f('http://ecs.fakecsp.example/v1/servers')).rejects.toThrow(/only https/);
    expect(calls).toHaveLength(0);
    await f('https://ecs.fakecsp.example/v1/servers');
    await f('https://ecs.fakecsp.example/v1/servers', { method: 'HEAD' });
    await f('https://iam.fakecsp.example/v3/auth/tokens', { method: 'POST', body: '{}' });
    expect(calls.map((c) => c.method)).toEqual(['GET', 'HEAD', 'POST']);
  });
});

describe('endpoint seam (Design 121 section 6)', () => {
  function endpointsFile(content: unknown): string {
    const p = join(tempDir('swao-lz-endpoints-'), 'endpoints.json');
    writeFileSync(p, JSON.stringify(content));
    return p;
  }
  const DEFAULTS = { iam: 'https://iam.fakecsp.example', ecs: 'https://ecs.fakecsp.example' };

  it('accepts loopback overrides from the environment and reports them for the manifest', () => {
    const env = { [MOCK_ENDPOINTS_ENV]: endpointsFile({ fakecsp: { iam: 'https://127.0.0.1:8443/', ecs: 'https://localhost:8444' }, other: { x: 'https://example.com' } }) };
    const r = resolveEndpoints('fakecsp', DEFAULTS, env);
    expect(r.baseUrls).toEqual({ iam: 'https://127.0.0.1:8443', ecs: 'https://localhost:8444' });
    expect(r.overrides).toEqual([{ api: 'iam', url: 'https://127.0.0.1:8443' }, { api: 'ecs', url: 'https://localhost:8444' }]);
    expect(resolveEndpoints('fakecsp', DEFAULTS, {}).overrides).toEqual([]);
  });

  it('refuses non-loopback, plain http and unknown API overrides', () => {
    expect(() => resolveEndpoints('fakecsp', DEFAULTS, { [MOCK_ENDPOINTS_ENV]: endpointsFile({ fakecsp: { iam: 'https://iam.attacker.example' } }) })).toThrow(EndpointOverrideError);
    expect(() => resolveEndpoints('fakecsp', DEFAULTS, { [MOCK_ENDPOINTS_ENV]: endpointsFile({ fakecsp: { iam: 'http://127.0.0.1:8080' } }) })).toThrow(/https/);
    expect(() => resolveEndpoints('fakecsp', DEFAULTS, { [MOCK_ENDPOINTS_ENV]: endpointsFile({ fakecsp: { nope: 'https://127.0.0.1' } }) })).toThrow(/unknown fakecsp API/);
    expect(() => resolveEndpoints('fakecsp', DEFAULTS, { [MOCK_ENDPOINTS_ENV]: join(tmpdir(), 'swao-missing-endpoints.json') })).toThrow(/does not exist/);
  });

  it('a non-loopback override fails the probe before any request with a non-zero exit', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = harness();
    await storeScopeKeys(h.store);
    const code = await lzProbeAction('fake-prod', {}, h.deps({ [MOCK_ENDPOINTS_ENV]: endpointsFile({ fakecsp: { iam: 'https://10.0.0.5' } }) }));
    expect(code).toBe(2);
    expect(h.calls).toHaveLength(0);
    expect(h.err.join('\n')).toMatch(/not a loopback host/);
  });

  it('a loopback override routes the probe to the mock', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = harness();
    await storeScopeKeys(h.store);
    const code = await lzProbeAction('fake-prod', {}, h.deps({ [MOCK_ENDPOINTS_ENV]: endpointsFile({ fakecsp: { iam: 'https://127.0.0.1:9443' } }) }));
    expect(code).toBe(0);
    expect(h.calls.every((c) => c.url.startsWith('https://127.0.0.1:9443/'))).toBe(true);
    expect(h.out.join('\n')).toContain('endpoint override: iam -> https://127.0.0.1:9443');
  });

  it('an override in .swao.yml is rejected (scope) or ignored (top level)', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const inScope = harness(REGISTERED_YML.replace('        regions: [eu-de]', '        regions: [eu-de]\n        endpoints:\n          iam: https://127.0.0.1:9443'));
    expect(() => readLandingZones(inScope.ws)).toThrow(/landing_zones is invalid/);
    expect(await lzProbeAction('fake-prod', {}, inScope.deps())).toBe(1);
    expect(inScope.calls).toHaveLength(0);

    const topLevel = harness(REGISTERED_YML + 'lz_mock_endpoints:\n  fakecsp:\n    iam: https://127.0.0.1:9443\n');
    await storeScopeKeys(topLevel.store);
    expect(await lzProbeAction('fake-prod', {}, topLevel.deps())).toBe(0);
    expect(topLevel.calls.every((c) => c.url.startsWith('https://iam.fakecsp.example/'))).toBe(true);
  });
});

describe('recording FetchLike (Design 121 section 13.2)', () => {
  it('captures request, status, allow-listed headers and body; never request headers or credentials; nothing in the workspace', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = harness();
    await storeScopeKeys(h.store);
    const recRoot = tempDir('swao-lz-record-');
    const deps = h.deps({ [RECORD_ENV]: recRoot });
    deps.fetchImpl = makeTransport(h.calls, (url) => url.endsWith('/tokens')
      ? { status: 201, body: '{"token":{"roles":[]}}', headers: { 'content-type': 'application/json', 'x-subject-token': 'fake-token', 'x-ratelimit-remaining': '99', 'set-cookie': 'sid=1' } }
      : { status: 403, body: '{"error":{"code":"ECS.0003"}}', headers: { 'content-type': 'application/json', link: '<https://x>; rel="next"' } });
    expect(await lzProbeAction('fake-prod', {}, deps)).toBe(0);

    const runs = readdirSync(recRoot);
    expect(runs).toHaveLength(1);
    const runDir = join(recRoot, runs[0] as string);
    const v = validateRecordingDir(runDir);
    expect(v.errors).toEqual([]);
    expect(v.requests).toBe(2);
    const reqs = readFileSync(join(runDir, 'requests.ndjson'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(reqs[0]).toMatchObject({ seq: 1, method: 'POST', route: '/v3/auth/tokens', status: 201, response_headers: { 'x-subject-token-present': true, 'x-ratelimit-remaining': '99' } });
    expect(reqs[1]).toMatchObject({ seq: 2, method: 'GET', route: '/v3/projects/{project_id}/servers', query_keys: ['limit', 'marker'], status: 403, error_code: 'ECS.0003', pagination: { kind: 'link', has_next: true } });
    expect(readFileSync(join(runDir, 'bodies', '2.json'), 'utf-8')).toContain('ECS.0003');
    expect(JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf-8'))).toMatchObject({ provider: 'fakecsp', scope_id: 'platform', identity: 'operator', driver_version: '0.0.0-test' });
    const everything = [join(runDir, 'run.json'), join(runDir, 'requests.ndjson'), ...readdirSync(join(runDir, 'bodies')).map((b) => join(runDir, 'bodies', b))].map((p) => readFileSync(p, 'utf-8')).join('\n');
    for (const secret of [SK, AK, 'fake-token', 'sid=1', 'x-auth-key']) expect(everything).not.toContain(secret);
    expect(existsSync(join(h.ws, 'wsp'))).toBe(false);
  });

  it('refuses a recording root inside a workspace, a repository or a WSP before any request', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = harness();
    await storeScopeKeys(h.store);
    expect(await lzProbeAction('fake-prod', {}, h.deps({ [RECORD_ENV]: join(h.ws, 'recordings') }))).toBe(2);
    expect(h.calls).toHaveLength(0);
    expect(() => createRecordingFetch(makeTransport([]), { root: join(tempDir('swao-x-'), 'wsp'), provider: 'p', scopeId: 's', identity: 'operator', driverVersion: '1' })).toThrow(RecordingLocationError);
    const repo = tempDir('swao-repo-');
    mkdirSync(join(repo, '.git'));
    expect(() => createRecordingFetch(makeTransport([]), { root: join(repo, 'rec'), provider: 'p', scopeId: 's', identity: 'operator', driverVersion: '1' })).toThrow(/inside the repository/);
    expect(() => createRecordingFetch(makeTransport([]), { root: 'relative/dir', provider: 'p', scopeId: 's', identity: 'operator', driverVersion: '1' })).toThrow(/absolute/);
  });

  // #3716: the driver's region hook gets the URL and the request headers;
  // only a plain region id reaches the recording, and a failing hook never
  // breaks the run.
  it('records the region from the driver hook (URL and request headers), null for an invalid value or a throwing hook', async () => {
    const recRoot = tempDir('swao-lz-region-');
    const seen: Array<{ url: string; auth?: string }> = [];
    const rec = createRecordingFetch(makeTransport([]), {
      root: recRoot, provider: 'p', scopeId: 's', identity: 'operator', driverVersion: '1',
      regionOf: (u, init) => {
        seen.push({ url: u.toString(), ...(init?.headers?.['x-region'] !== undefined ? { auth: init.headers['x-region'] } : {}) });
        const r = u.searchParams.get('r');
        if (r === 'throw') throw new Error('boom');
        return r === 'none' ? null : r;
      },
    });
    for (const r of ['eu-de', 'none', 'Not A Region!', 'throw']) await rec.fetch(`https://api.example.test/x?r=${encodeURIComponent(r)}`, { headers: { 'x-region': 'h' } });
    rec.finish();
    const reqs = readFileSync(join(rec.runDir, 'requests.ndjson'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l) as { region: string | null });
    expect(reqs.map((q) => q.region)).toEqual(['eu-de', null, null, null]);
    expect(seen.every((x) => x.auth === 'h')).toBe(true);
    expect(validateRecordingDir(rec.runDir).errors).toEqual([]);
  });

  it('maps paths to driver templates first, then to generic {id} placeholders', () => {
    expect(routeOf('/v3/projects/abc/servers', ['/v3/projects/{project_id}/servers'])).toBe('/v3/projects/{project_id}/servers');
    expect(routeOf('/v1/0123456789abcdef0123456789abcdef/vpcs/1f0e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b')).toBe('/v1/{id}/vpcs/{id}');
    expect(routeOf('/accounts/123456789012/regions')).toBe('/accounts/{id}/regions');
  });

  const SAMPLE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../../tests/fixtures/mock-csp-findings/2026-11-02T10-00-00Z');
  // The sample carries one deliberate contract violation (seq 12 lacks
  // query_keys and response_headers) for the findings agent's
  // `recording-contract` class (.claude/agents/swao-mock-csp-findings.md:79);
  // every other record must parse.
  it.skipIf(!existsSync(SAMPLE))('the committed sample run parses with the same validator, except its deliberate seq 12 defect', () => {
    const v = validateRecordingDir(SAMPLE);
    expect(v.requests).toBe(12);
    expect(v.errors).toHaveLength(1);
    expect(v.errors[0]).toMatch(/^requests\.ndjson line 12: query_keys: .*response_headers: /);
  });
});

describe('read-only gate (Design 120 section 6.3)', () => {
  it('maps probe results and flags to proceed / stop and the manifest stamp', () => {
    expect(evaluateReadOnlyGate(VERIFIED, {})).toMatchObject({ proceed: true, exitCode: 0, manifest: { read_only: 'verified', read_only_overrides: [] } });
    expect(evaluateReadOnlyGate(REFUSED, {})).toMatchObject({ proceed: false, exitCode: 1 });
    expect(evaluateReadOnlyGate(REFUSED, { acceptUnverifiedReadOnly: true })).toMatchObject({ proceed: false });
    expect(evaluateReadOnlyGate(REFUSED, { acceptWriteCapableCredentials: true })).toMatchObject({
      proceed: true,
      manifest: { read_only: 'refused', read_only_overrides: ['accept-write-capable-credentials'], read_only_reason: WRITE_CAPABLE_ACCEPTED_REASON, probe_reason: 'role grants ecs:servers:create' },
    });
    expect(evaluateReadOnlyGate(UNVERIFIABLE, {})).toMatchObject({ proceed: false, exitCode: 1 });
    expect(evaluateReadOnlyGate(UNVERIFIABLE, { acceptWriteCapableCredentials: true })).toMatchObject({ proceed: false });
    expect(evaluateReadOnlyGate(UNVERIFIABLE, { acceptUnverifiedReadOnly: true })).toMatchObject({ proceed: true, manifest: { read_only_overrides: ['accept-unverified-read-only'] } });
  });

  it('a write-capable credential without the flag stops with a non-zero exit', async () => {
    registerLiveLzDriver(makeFakeDriver(REFUSED));
    const h = harness();
    await storeScopeKeys(h.store);
    expect(await lzProbeAction('fake-prod', {}, h.deps())).toBe(1);
    expect(h.err.join('\n')).toMatch(/write-capable.*--accept-write-capable-credentials/);
  });

  it('with --accept-write-capable-credentials the run proceeds and carries flag, result and reason', async () => {
    registerLiveLzDriver(makeFakeDriver(REFUSED));
    const h = harness();
    await storeScopeKeys(h.store);
    const outcome = await runLzProbe({ workspaceRoot: h.ws, lzId: 'fake-prod', store: h.store, env: {}, fetchImpl: makeTransport(h.calls), acceptWriteCapableCredentials: true });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.results[0]?.gate.manifest).toEqual({
      read_only: 'refused',
      read_only_overrides: ['accept-write-capable-credentials'],
      read_only_reason: WRITE_CAPABLE_ACCEPTED_REASON,
      probe_reason: 'role grants ecs:servers:create',
    });
  });

  it('the flag in .swao.yml is rejected (scope) or ignored (top level)', async () => {
    registerLiveLzDriver(makeFakeDriver(REFUSED));
    const inScope = harness(REGISTERED_YML.replace('        auth: aksk', '        auth: aksk\n        accept_write_capable_credentials: true'));
    expect(await lzProbeAction('fake-prod', {}, inScope.deps())).toBe(1);
    expect(inScope.err.join('\n')).toMatch(/landing_zones is invalid/);

    const topLevel = harness(REGISTERED_YML + 'accept_write_capable_credentials: true\n');
    await storeScopeKeys(topLevel.store);
    expect(await lzProbeAction('fake-prod', {}, topLevel.deps())).toBe(1);
    expect(topLevel.err.join('\n')).toMatch(/write-capable/);
  });

  it('with the flag set the allow-list still refuses every non-read request', async () => {
    registerLiveLzDriver(makeFakeDriver(async (ctx) => {
      await ctx.http.fetch(`${ctx.http.baseUrls['ecs']}/v1/servers`, { method: 'POST', body: '{}' });
      return REFUSED;
    }));
    const h = harness();
    await storeScopeKeys(h.store);
    expect(await lzProbeAction('fake-prod', { acceptWriteCapableCredentials: true }, h.deps())).toBe(1);
    expect(h.calls).toHaveLength(0);
    expect(h.err.join('\n')).toMatch(/refused before sending/);
  });

  it('unverifiable needs --accept-unverified-read-only per run', async () => {
    registerLiveLzDriver(makeFakeDriver(UNVERIFIABLE));
    const h = harness();
    await storeScopeKeys(h.store);
    expect(await lzProbeAction('fake-prod', {}, h.deps())).toBe(1);
    expect(await lzProbeAction('fake-prod', { acceptUnverifiedReadOnly: true }, h.deps())).toBe(0);
  });

  it('an expired token fails before any request (exit 2); missing keys and unknown landing zones exit 1', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = harness();
    await storeScopeKeys(h.store);
    await h.store.set('lz:fake-prod:platform:expires-at', '2020-01-01T00:00:00Z');
    expect(await lzProbeAction('fake-prod', {}, h.deps())).toBe(2);
    expect(h.calls).toHaveLength(0);
    await expect(runLzProbe({ workspaceRoot: h.ws, lzId: 'fake-prod', store: h.store, env: {}, fetchImpl: makeTransport([]) })).rejects.toBeInstanceOf(LzCredentialExpiredError);

    const empty = harness();
    expect(await lzProbeAction('fake-prod', {}, empty.deps())).toBe(1);
    expect(empty.err.join('\n')).toMatch(/missing landing zone credentials: lz:fake-prod:platform:access-key-id/);
    expect(await lzProbeAction('nope', {}, empty.deps())).toBe(1);
  });

  it('a driver that returns an invalid probe result fails the probe', async () => {
    registerLiveLzDriver(makeFakeDriver({ ...REFUSED, reason: undefined }));
    const h = harness();
    await storeScopeKeys(h.store);
    expect(await lzProbeAction('fake-prod', {}, h.deps())).toBe(1);
    expect(h.err.join('\n')).toMatch(/invalid probe result/);
  });
});

describe('swao lz connect', () => {
  const CONNECT = { provider: 'fakecsp', scope: 'platform', kind: 'platform', auth: 'aksk', region: ['eu-de'] };

  it('registers the scope in .swao.yml (other keys and comments kept), stores credentials from a file without printing them, and probes', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = harness('# my workspace\nname: demo\nassessment:\n  regimes_active: []\n');
    const credFile = join(tempDir('swao-cred-file-'), 'creds.env');
    writeFileSync(credFile, `# fake values\naccess-key-id=${AK}\nsecret-access-key=${SK}\n`);
    const code = await lzConnectAction('fake-prod', { ...CONNECT, credentialsFile: credFile, target: ['project=eu-de_demo'] }, h.deps());
    expect(h.err).toEqual([]);
    expect(code).toBe(0);
    const yml = readFileSync(join(h.ws, '.swao.yml'), 'utf-8');
    expect(yml.startsWith('# my workspace\nname: demo\nassessment:\n  regimes_active: []\n')).toBe(true);
    expect(readLandingZones(h.ws)).toEqual([{ id: 'fake-prod', provider: 'fakecsp', scopes: [{ id: 'platform', kind: 'platform', auth: 'aksk', regions: ['eu-de'], target: { project: 'eu-de_demo' } }] }]);
    expect(yml).not.toContain(SK);
    expect(await h.store.get('lz:fake-prod:platform:secret-access-key')).toBe(SK);
    const printed = [...h.out, ...h.err].join('\n');
    expect(printed).toContain('landing zone added');
    expect(printed).toContain('read-only verified');
    expect(printed).not.toContain(SK);
    expect(printed).not.toContain(AK);

    // second scope: block rewritten in place, keys after it kept
    writeFileSync(join(h.ws, '.swao.yml'), readFileSync(join(h.ws, '.swao.yml'), 'utf-8') + 'llm_assessment:\n  enabled: false\n');
    await storeScopeKeys(h.store, 'fake-prod', 'app-payments');
    expect(await lzConnectAction('fake-prod', { ...CONNECT, scope: 'app-payments', kind: 'application' }, h.deps())).toBe(0);
    expect(readLandingZones(h.ws)[0]?.scopes.map((s) => s.id)).toEqual(['platform', 'app-payments']);
    expect(readFileSync(join(h.ws, '.swao.yml'), 'utf-8')).toMatch(/llm_assessment:\n {2}enabled: false\n$/);

    // #3975: the log archive scope keeps its purpose in .swao.yml; an unknown purpose is refused before anything is stored
    await storeScopeKeys(h.store, 'fake-prod', 'log-archive');
    expect(await lzConnectAction('fake-prod', { ...CONNECT, scope: 'log-archive', kind: 'application', purpose: 'log-archive' }, h.deps())).toBe(0);
    expect(readLandingZones(h.ws)[0]?.scopes.find((s) => s.id === 'log-archive')?.purpose).toBe('log-archive');
    expect(await lzConnectAction('fake-prod', { ...CONNECT, scope: 'audit', kind: 'application', purpose: 'audit' }, h.deps())).toBe(1);
    expect(h.err.pop()).toMatch(/--purpose must be log-archive, not audit/);
  });

  it('refuses an unknown provider, an unknown auth method, a second platform scope and a bad kind', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = harness();
    expect(await lzConnectAction('x-lz', { ...CONNECT, provider: 'nocsp' }, h.deps())).toBe(1);
    expect(h.err.pop()).toMatch(/no live driver for provider nocsp \(available: fakecsp\)/);
    expect(await lzConnectAction('fake-prod', { ...CONNECT, auth: 'password' }, h.deps())).toBe(1);
    expect(await lzConnectAction('fake-prod', { ...CONNECT, scope: 'platform-2' }, h.deps())).toBe(1);
    expect(h.err.pop()).toMatch(/at most one platform scope/);
    expect(await lzConnectAction('fake-prod', { ...CONNECT, kind: 'other' }, h.deps())).toBe(1);
    expect(readFileSync(join(h.ws, '.swao.yml'), 'utf-8')).toBe(REGISTERED_YML);
  });

  it('moves legacy Pass 23 keys with --move-legacy-credentials and reports them otherwise (#3570)', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED, { provider: 'aws', authMethods: [{ id: 'session-keys', required: ['access-key-id', 'secret-access-key'], optional: ['session-token', 'expires-at'], unattended: true }] }));
    const h = harness('name: demo\n');
    await h.store.importAll({ 'aws-access-key-id': AK, 'aws-secret-access-key': SK }, 'merge');
    const opts = { provider: 'aws', scope: 'platform', kind: 'platform', auth: 'session-keys', probe: false };
    expect(await lzConnectAction('aws-demo', opts, h.deps())).toBe(0);
    expect(h.out.join('\n')).toMatch(/found 2 legacy aws credential\(s\).*--move-legacy-credentials/);
    expect(await lzConnectAction('aws-demo', { ...opts, moveLegacyCredentials: true, probe: true }, h.deps())).toBe(0);
    expect(await h.store.get('aws-access-key-id')).toBeNull();
    expect(await h.store.get('lz:aws-demo:platform:access-key-id')).toBe(AK);
    expect(h.out.join('\n')).toContain('moved 2 legacy credential(s) to lz:aws-demo:platform:*');
    expect(h.out.join('\n')).toContain('read-only verified');
  });

  it('a credentials file with an unknown field is refused before anything is stored', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = harness('name: demo\n');
    const credFile = join(tempDir('swao-cred-file-'), 'creds.env');
    writeFileSync(credFile, `access-key-id=${AK}\npasswd=x\n`);
    expect(await lzConnectAction('fake-prod', { ...CONNECT, credentialsFile: credFile }, h.deps())).toBe(1);
    expect(h.err.join('\n')).toMatch(/unknown field passwd/);
    expect(await h.store.get('lz:fake-prod:platform:access-key-id')).toBeNull();
    expect(readFileSync(join(h.ws, '.swao.yml'), 'utf-8')).toBe('name: demo\n');
  });
});

describe('writeLandingZones', () => {
  it('replaces only the landing_zones block and keeps CRLF line endings', () => {
    const ws = tempDir('swao-lz-write-');
    writeFileSync(join(ws, '.swao.yml'), REGISTERED_YML.replace(/\n/g, '\r\n'));
    const lzs = readLandingZones(ws);
    lzs[0]!.display = 'Fake production';
    writeLandingZones(ws, lzs);
    const text = readFileSync(join(ws, '.swao.yml'), 'utf-8');
    expect(text.startsWith('# workspace config\r\nname: demo\r\nlanding_zones:\r\n')).toBe(true);
    expect(text).toContain('# trailing comment kept\r\nassessment:\r\n  regimes_active: []\r\n');
    expect(text).not.toMatch(/[^\r]\n/);
    expect(readLandingZones(ws)[0]?.display).toBe('Fake production');
  });
});
