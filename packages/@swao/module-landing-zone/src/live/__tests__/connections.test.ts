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

// #3589: Landing Zone Connections shared by CLI, TUI and health check:
// `swao lz list`, `swao lz remove`, `swao lz connect --display` and
// `--credentials-stdin`, and the empty landing_zones block round trip.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { CredentialStore } from '@swao/core';
import { registerLiveLzDriver, unregisterLiveLzDriver } from '../registry.js';
import { readLandingZones, removeRegistration, upsertScope } from '../session.js';
import { describeLandingZones, formatLandingZones, legacyCredentialCounts, runLzRemove } from '../connections.js';
import { lzConnectAction, lzListAction, lzRemoveAction } from '../cli.js';
import type { LzLiveCliDeps } from '../cli.js';
import { makeFakeDriver, makeTransport, VERIFIED, REFUSED } from './fake-driver.js';

const tmp: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmp.push(d);
  return d;
}

// Fake values, built at runtime so no secret-shaped literal is committed.
const AK = ['fake', 'ak', 'value'].join('-');
const SK = ['fake', 'sk', 'value'].join('-');

const CONNECT = { provider: 'fakecsp', scope: 'platform', kind: 'platform', auth: 'aksk', region: ['eu-de'] };

interface Harness {
  ws: string;
  store: CredentialStore;
  out: string[];
  err: string[];
  deps: (stdin?: string) => LzLiveCliDeps;
}

function harness(yml = 'name: demo\n'): Harness {
  const ws = tempDir('swao-lz-conn-ws-');
  writeFileSync(join(ws, '.swao.yml'), yml);
  const store = new CredentialStore(tempDir('swao-lz-conn-vault-'));
  const out: string[] = [];
  const err: string[] = [];
  return {
    ws, store, out, err,
    deps: (stdin) => ({
      cwd: ws, store, env: {}, fetchImpl: makeTransport([]),
      out: (l) => out.push(l), err: (l) => err.push(l),
      guard: { requireFeature: () => undefined },
      ...(stdin !== undefined ? { readStdin: async () => stdin } : {}),
    }),
  };
}

beforeEach(() => { unregisterLiveLzDriver(); });
afterEach(() => {
  unregisterLiveLzDriver();
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('swao lz connect --credentials-stdin and --display (#3589)', () => {
  it('stores the stdin fields without printing them and records the display name', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = harness();
    const code = await lzConnectAction('fake-prod', { ...CONNECT, credentialsStdin: true, display: 'Fake production', probe: false }, h.deps(`access-key-id=${AK}\nsecret-access-key=${SK}\n`));
    expect(h.err).toEqual([]);
    expect(code).toBe(0);
    expect(await h.store.get('lz:fake-prod:platform:secret-access-key')).toBe(SK);
    expect(readLandingZones(h.ws)[0]?.display).toBe('Fake production');
    const printed = h.out.join('\n');
    expect(printed).not.toContain(SK);
    expect(printed).not.toContain(AK);
    expect(readFileSync(join(h.ws, '.swao.yml'), 'utf-8')).not.toContain(SK);
  });

  it('refuses --credentials-stdin together with --credentials-file before reading stdin', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = harness();
    let read = false;
    const deps = { ...h.deps(), readStdin: async () => { read = true; return ''; } };
    expect(await lzConnectAction('fake-prod', { ...CONNECT, credentialsStdin: true, credentialsFile: 'x.env' }, deps)).toBe(1);
    expect(read).toBe(false);
    expect(h.err.join('\n')).toMatch(/not both/);
    expect(readFileSync(join(h.ws, '.swao.yml'), 'utf-8')).toBe('name: demo\n');
  });

  it('a later connect without --display keeps the display name; with one, updates it', () => {
    const scope = { id: 'platform', kind: 'platform' as const, auth: 'aksk' };
    const first = upsertScope([], 'fake-prod', 'fakecsp', scope, 'First');
    expect(first.lzs[0]?.display).toBe('First');
    const kept = upsertScope(first.lzs, 'fake-prod', 'fakecsp', scope);
    expect(kept).toMatchObject({ outcome: 'unchanged' });
    expect(kept.lzs[0]?.display).toBe('First');
    const changed = upsertScope(first.lzs, 'fake-prod', 'fakecsp', scope, 'Second');
    expect(changed.outcome).toBe('scope-updated');
    expect(changed.lzs[0]?.display).toBe('Second');
  });
});

describe('swao lz list (#3589)', () => {
  it('lists landing zones and scopes with field names only, never values', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = harness();
    await lzConnectAction('fake-prod', { ...CONNECT, probe: false, credentialsStdin: true }, h.deps(`access-key-id=${AK}\nsecret-access-key=${SK}\n`));
    await lzConnectAction('fake-prod', { ...CONNECT, scope: 'app-pay', kind: 'application', region: undefined, probe: false }, h.deps());
    h.out.length = 0;
    expect(await lzListAction(h.deps())).toBe(0);
    const text = h.out.join('\n');
    expect(text).toContain('landing zone fake-prod (fakecsp)');
    expect(text).toContain('scope platform: platform, auth aksk, regions eu-de; credentials stored (2 field(s))');
    expect(text).toContain('scope app-pay: application, auth aksk; credentials missing: access-key-id, secret-access-key');
    expect(text).not.toContain(SK);
    expect(text).not.toContain(AK);
  });

  it('reports a provider without a driver in this build and an expired token', async () => {
    const h = harness('landing_zones:\n  - id: other\n    provider: nocsp\n    scopes:\n      - id: platform\n        kind: platform\n        auth: aksk\n  - id: fake-prod\n    provider: fakecsp\n    scopes:\n      - id: platform\n        kind: platform\n        auth: aksk\n');
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    await h.store.set('lz:fake-prod:platform:access-key-id', AK);
    await h.store.set('lz:fake-prod:platform:secret-access-key', SK);
    await h.store.set('lz:fake-prod:platform:expires-at', '2020-01-01T00:00:00Z');
    const lzs = await describeLandingZones(h.ws, h.store);
    expect(lzs.map((l) => [l.id, l.driverAvailable, l.scopes[0]?.credentials])).toEqual([['other', false, 'no-driver'], ['fake-prod', true, 'expired']]);
    expect(formatLandingZones(lzs).join('\n')).toMatch(/other \(nocsp\): no live driver for this provider in this build/);
  });

  it('says how to add one when nothing is registered', async () => {
    const h = harness();
    expect(await lzListAction(h.deps())).toBe(0);
    expect(h.out[0]).toMatch(/no landing zones registered; add one with swao lz connect/);
  });
});

describe('swao lz remove (#3589)', () => {
  it('removes one scope and deletes only its vault keys', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = harness();
    await lzConnectAction('fake-prod', { ...CONNECT, probe: false, credentialsStdin: true }, h.deps(`access-key-id=${AK}\nsecret-access-key=${SK}\n`));
    await lzConnectAction('fake-prod', { ...CONNECT, scope: 'app-pay', kind: 'application', probe: false, credentialsStdin: true }, h.deps(`access-key-id=${AK}\n`));
    await h.store.set('lz:fake-prod:pseudonym-salt', 'aa');
    expect(await lzRemoveAction('fake-prod', { scope: 'app-pay' }, h.deps())).toBe(0);
    expect(readLandingZones(h.ws)[0]?.scopes.map((s) => s.id)).toEqual(['platform']);
    expect(await h.store.get('lz:fake-prod:app-pay:access-key-id')).toBeNull();
    expect(await h.store.get('lz:fake-prod:platform:access-key-id')).toBe(AK);
    expect(await h.store.get('lz:fake-prod:pseudonym-salt')).toBe('aa');
    expect(h.out.join('\n')).toContain('deleted 1 credential field(s)');
  });

  it('removing the last scope removes the landing zone; connect afterwards writes one landing_zones key', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = harness('name: demo\nassessment:\n  regimes_active: []\n');
    await lzConnectAction('fake-prod', { ...CONNECT, probe: false }, h.deps());
    expect(await lzRemoveAction('fake-prod', { scope: 'platform' }, h.deps())).toBe(0);
    const empty = readFileSync(join(h.ws, '.swao.yml'), 'utf-8');
    expect(empty).not.toMatch(/landing_zones/);
    expect(empty).toContain('assessment:\n  regimes_active: []');
    expect(readLandingZones(h.ws)).toEqual([]);
    // round trip: connect again, exactly one landing_zones key, parseable YAML
    expect(await lzConnectAction('fake-prod', { ...CONNECT, probe: false }, h.deps())).toBe(0);
    const again = readFileSync(join(h.ws, '.swao.yml'), 'utf-8');
    expect(again.match(/^landing_zones:/gm)?.length).toBe(1);
    expect(() => yamlLoad(again)).not.toThrow();
    expect(readLandingZones(h.ws).map((l) => l.id)).toEqual(['fake-prod']);
  });

  it('a hand-written flow-style empty block is replaced, not duplicated', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = harness('name: demo\nlanding_zones: []\nassessment:\n  regimes_active: []\n');
    expect(await lzConnectAction('fake-prod', { ...CONNECT, probe: false }, h.deps())).toBe(0);
    const text = readFileSync(join(h.ws, '.swao.yml'), 'utf-8');
    expect(text.match(/^landing_zones:/gm)?.length).toBe(1);
    expect(text).toContain('assessment:\n  regimes_active: []');
    expect(readLandingZones(h.ws).map((l) => l.id)).toEqual(['fake-prod']);
  });

  it('refuses an unknown landing zone or scope and changes nothing', async () => {
    registerLiveLzDriver(makeFakeDriver(REFUSED));
    const h = harness();
    await lzConnectAction('fake-prod', { ...CONNECT, probe: false }, h.deps());
    const before = readFileSync(join(h.ws, '.swao.yml'), 'utf-8');
    expect(await lzRemoveAction('nope', {}, h.deps())).toBe(1);
    expect(await lzRemoveAction('fake-prod', { scope: 'nope' }, h.deps())).toBe(1);
    expect(h.err.join('\n')).toMatch(/not registered.*\n.*has no scope nope/);
    expect(readFileSync(join(h.ws, '.swao.yml'), 'utf-8')).toBe(before);
  });

  it('removeRegistration without a scope removes every scope of the landing zone', () => {
    const lzs = [{ id: 'a', provider: 'p', scopes: [{ id: 'platform', kind: 'platform' as const, auth: 'x' }, { id: 'app', kind: 'application' as const, auth: 'x' }] }];
    expect(removeRegistration(lzs, 'a')).toEqual({ lzs: [], outcome: 'landing-zone-removed', removedScopes: ['platform', 'app'] });
  });

  it('runLzRemove of a whole landing zone deletes every scoped key of it, not of others', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = harness();
    await lzConnectAction('fake-prod', { ...CONNECT, probe: false }, h.deps());
    await lzConnectAction('fake-test', { ...CONNECT, probe: false }, h.deps());
    await h.store.set('lz:fake-prod:platform:access-key-id', AK);
    await h.store.set('lz:fake-test:platform:access-key-id', AK);
    const r = await runLzRemove({ workspaceRoot: h.ws, store: h.store, lzId: 'fake-prod' });
    expect(r).toEqual({ outcome: 'landing-zone-removed', removedScopes: ['platform'], deletedKeys: 1 });
    expect(await h.store.get('lz:fake-test:platform:access-key-id')).toBe(AK);
  });
});

describe('migration keeps the registration (#3589)', () => {
  it('describeLandingZones carries target and app, and a connect with them plus --move-legacy-credentials leaves .swao.yml byte-identical', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED, { provider: 'aws', authMethods: [{ id: 'session-keys', required: ['access-key-id', 'secret-access-key'], optional: [], unattended: true }] }));
    const h = harness();
    await lzConnectAction('aws-demo', { provider: 'aws', scope: 'platform', kind: 'platform', auth: 'session-keys', region: ['eu-central-1'], target: ['account=123456789012'], app: 'payments', probe: false }, h.deps());
    const before = readFileSync(join(h.ws, '.swao.yml'), 'utf-8');
    await h.store.importAll({ 'aws-access-key-id': AK, 'aws-secret-access-key': SK }, 'merge');
    const sc = (await describeLandingZones(h.ws, h.store))[0]!.scopes[0]!;
    expect(sc).toMatchObject({ regions: ['eu-central-1'], target: { account: '123456789012' }, app: 'payments' });
    // The TUI builds this call from the described scope (lz-connections-flow buildConnectArgs).
    const target = Object.entries(sc.target ?? {}).map(([k, v]) => `${k}=${v}`);
    expect(await lzConnectAction('aws-demo', { provider: 'aws', scope: sc.id, kind: sc.kind, auth: sc.auth, region: sc.regions, target, app: sc.app, moveLegacyCredentials: true, probe: false }, h.deps())).toBe(0);
    expect(readFileSync(join(h.ws, '.swao.yml'), 'utf-8')).toBe(before);
    expect(await h.store.get('lz:aws-demo:platform:secret-access-key')).toBe(SK);
  });
});

describe('legacyCredentialCounts (#3589)', () => {
  it('counts the Pass 23 keys per provider', async () => {
    const h = harness();
    await h.store.importAll({ 'aws-access-key-id': AK, 'aws-secret-access-key': SK, 'azure-client-id': AK }, 'merge');
    expect(legacyCredentialCounts(h.store)).toEqual({ aws: 2, azure: 1 });
  });
});
