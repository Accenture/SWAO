// #4232: stored credential sets are offered for the same provider and auth
// method only (names, never values) and copied with
// `swao lz connect --credentials-from <lz-id>:<scope-id>`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from '@swao/core';
import { registerLiveLzDriver, unregisterLiveLzDriver } from '../registry.js';
import { lzConnectAction } from '../cli.js';
import { copyLzCredentialSet, parseCredentialsFrom, reusableCredentialSets, storedCredentialSets, type ReuseDriverInfo } from '../credential-reuse.js';
import { makeFakeDriver, makeTransport, VERIFIED } from './fake-driver.js';

const tmp: string[] = [];
const tempDir = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); tmp.push(d); return d; };
beforeEach(() => { unregisterLiveLzDriver(); });
afterEach(() => { unregisterLiveLzDriver(); for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

// Fake values, built at runtime so no secret-shaped literal is committed.
const PW = ['fake', 'pw', 'value'].join('-');
const AK = ['fake', 'ak', 'value'].join('-');
const SK = ['fake', 'sk', 'value'].join('-');

const DRIVERS: ReuseDriverInfo[] = [
  { provider: 'aws', authMethods: [{ id: 'session-keys', required: ['access-key-id', 'secret-access-key'], optional: ['session-token', 'expires-at'] }] },
  { provider: 'otc', authMethods: [
    { id: 'iam-password-token', required: ['username', 'password', 'domain'], optional: [] },
    { id: 'aksk', required: ['access-key-id', 'secret-access-key'], optional: ['session-token'] },
  ] },
  { provider: 'stackit', authMethods: [{ id: 'key-flow', required: ['service-account-key'], optional: [] }] },
];
const OTC_PW = DRIVERS[1]!.authMethods[0]!;
const OTC_AKSK = DRIVERS[1]!.authMethods[1]!;
const KEYS = [
  'lz:otc-test:platform:username', 'lz:otc-test:platform:password', 'lz:otc-test:platform:domain',
  'lz:legacy-keys:platform:access-key-id', 'lz:legacy-keys:platform:secret-access-key',
  'lz:aws-dev:platform:access-key-id', 'lz:aws-dev:platform:secret-access-key',
  'provider:github:token', 'lz:broken',
];

describe('stored credential sets (#4232)', () => {
  it('derive provider and auth method from the field names when they fit one driver method; ambiguous sets are dropped', () => {
    const sets = storedCredentialSets(KEYS, DRIVERS, []);
    expect(sets).toEqual([{ lzId: 'otc-test', scopeId: 'platform', provider: 'otc', auth: 'iam-password-token', fields: ['domain', 'password', 'username'], basis: 'fields' }]);
  });

  it('use the registration of this workspace when the landing zone and scope are registered here', () => {
    const sets = storedCredentialSets(KEYS, DRIVERS, [{ id: 'aws-dev', provider: 'aws', scopes: [{ id: 'platform', auth: 'session-keys' }] }]);
    expect(sets.map((s) => [s.lzId, s.provider, s.auth, s.basis])).toEqual([
      ['aws-dev', 'aws', 'session-keys', 'registration'],
      ['otc-test', 'otc', 'iam-password-token', 'fields'],
    ]);
  });

  it('reuse is offered for the same provider and auth method only, never across providers, never the scope itself', () => {
    const regs = [{ id: 'aws-dev', provider: 'aws', scopes: [{ id: 'platform', auth: 'session-keys' }] }];
    expect(reusableCredentialSets(KEYS, { provider: 'otc', auth: OTC_PW, lzId: 'otc-prod', scopeId: 'platform' }, DRIVERS, regs).map((s) => s.lzId)).toEqual(['otc-test']);
    // Same field names, other provider: the aws set is not offered to otc aksk.
    expect(reusableCredentialSets(KEYS, { provider: 'otc', auth: OTC_AKSK }, DRIVERS, regs)).toEqual([]);
    expect(reusableCredentialSets(KEYS, { provider: 'stackit', auth: DRIVERS[2]!.authMethods[0]! }, DRIVERS, regs)).toEqual([]);
    expect(reusableCredentialSets(KEYS, { provider: 'otc', auth: OTC_PW, lzId: 'otc-test', scopeId: 'platform' }, DRIVERS, regs)).toEqual([]);
  });

  it('parses --credentials-from', () => {
    expect(parseCredentialsFrom('otc-test:platform')).toEqual({ lzId: 'otc-test', scopeId: 'platform' });
    expect(parseCredentialsFrom('otc-test')).toBeNull();
    expect(parseCredentialsFrom('Otc:platform')).toBeNull();
  });

  it('copies the set (the source keys stay) and refuses a set without the required fields', async () => {
    const store = new CredentialStore(tempDir('swao-reuse-vault-'));
    await store.set('lz:otc-test:platform:username', 'user');
    await store.set('lz:otc-test:platform:password', PW);
    await store.set('lz:otc-test:platform:domain', 'dom');
    expect(await copyLzCredentialSet(store, { lzId: 'otc-test', scopeId: 'platform' }, { lzId: 'otc-prod', scopeId: 'platform' }, OTC_PW)).toEqual(['username', 'password', 'domain']);
    expect(await store.get('lz:otc-prod:platform:password')).toBe(PW);
    expect(await store.get('lz:otc-test:platform:password')).toBe(PW);
    await expect(copyLzCredentialSet(store, { lzId: 'nope', scopeId: 'platform' }, { lzId: 'otc-x', scopeId: 'platform' }, OTC_PW)).rejects.toThrow(/missing: username, password, domain/);
  });
});

describe('swao lz connect --credentials-from (#4232, CLI parity)', () => {
  function harness(): { ws: string; store: CredentialStore; out: string[]; err: string[]; deps: () => Parameters<typeof lzConnectAction>[2] } {
    const ws = tempDir('swao-reuse-ws-');
    writeFileSync(join(ws, '.swao.yml'), 'name: demo\n');
    const store = new CredentialStore(tempDir('swao-reuse-vault-'));
    const out: string[] = [];
    const err: string[] = [];
    return { ws, store, out, err, deps: () => ({ cwd: ws, store, env: {}, fetchImpl: makeTransport([]), out: (l: string) => out.push(l), err: (l: string) => err.push(l), guard: { requireFeature: () => undefined } }) };
  }
  const CONNECT = { provider: 'fakecsp', scope: 'platform', kind: 'platform', auth: 'aksk', region: ['eu-de'], probe: false };

  it('copies the stored set to the new scope, prints names only and never a value', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = harness();
    await h.store.set('lz:fake-test:platform:access-key-id', AK);
    await h.store.set('lz:fake-test:platform:secret-access-key', SK);
    expect(await lzConnectAction('fake-prod', { ...CONNECT, credentialsFrom: 'fake-test:platform' }, h.deps())).toBe(0);
    expect(h.err).toEqual([]);
    expect(await h.store.get('lz:fake-prod:platform:secret-access-key')).toBe(SK);
    expect(await h.store.get('lz:fake-test:platform:secret-access-key')).toBe(SK);
    const printed = h.out.join('\n');
    expect(printed).toContain('copied the stored credentials of fake-test / platform');
    expect(printed).not.toContain(SK);
    expect(printed).not.toContain(AK);
    expect(readFileSync(join(h.ws, '.swao.yml'), 'utf-8')).not.toContain(SK);
  });

  it('#4459: a copied set whose session token has expired is a warning with a binary-user hint; the probe is skipped', async () => {
    const SESSION = { id: 'aksk', required: ['access-key-id', 'secret-access-key'] as const, optional: ['session-token', 'expires-at'] as const, unattended: true };
    registerLiveLzDriver(makeFakeDriver(VERIFIED, { authMethods: [{ ...SESSION, required: [...SESSION.required], optional: [...SESSION.optional] }] }));
    const h = harness();
    await h.store.set('lz:fake-test:platform:access-key-id', AK);
    await h.store.set('lz:fake-test:platform:secret-access-key', SK);
    await h.store.set('lz:fake-test:platform:expires-at', '2020-01-01T00:00:00+00:00');
    expect(await lzConnectAction('fake-prod', { ...CONNECT, probe: true, credentialsFrom: 'fake-test:platform' }, h.deps())).toBe(0);
    const printed = h.out.join('\n');
    expect(printed).toContain('warning: registered, but the session token expired at 2020-01-01T00:00:00+00:00; refresh it before a run');
    expect(printed).toContain('the read-only probe was skipped');
    expect(printed).not.toMatch(/scripts\//);
    expect(printed).not.toContain(SK);
    expect(printed).not.toContain(AK);
  });

  it('#4459: new keys entered without session token and expiry drop the stale ones, so no warning follows', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = harness();
    await h.store.set('lz:fake-prod:platform:session-token', ['old', 'st'].join('-'));
    await h.store.set('lz:fake-prod:platform:expires-at', '2020-01-01T00:00:00+00:00');
    const deps = { ...h.deps(), readStdin: async () => `access-key-id=${AK}\nsecret-access-key=${SK}\n` };
    expect(await lzConnectAction('fake-prod', { ...CONNECT, credentialsStdin: true }, deps)).toBe(0);
    expect(await h.store.get('lz:fake-prod:platform:expires-at')).toBeNull();
    expect(await h.store.get('lz:fake-prod:platform:session-token')).toBeNull();
    expect(h.out.join('\n')).not.toContain('session token expired');
  });

  it('#4459: --aws-profile stores the profile name on the scope, a re-connect keeps it, an empty value removes it', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED, { provider: 'aws' }));
    const h = harness();
    const AWS = { ...CONNECT, provider: 'aws', region: ['eu-central-1'] };
    const yml = (): string => readFileSync(join(h.ws, '.swao.yml'), 'utf-8');
    expect(await lzConnectAction('aws-prod', { ...AWS, awsProfile: 'prod-readonly' }, h.deps())).toBe(0);
    expect(yml()).toContain('aws_profile: prod-readonly');
    const deps = { ...h.deps(), readStdin: async () => `access-key-id=${AK}\nsecret-access-key=${SK}\n` };
    expect(await lzConnectAction('aws-prod', { ...AWS, credentialsStdin: true }, deps)).toBe(0);
    expect(yml()).toContain('aws_profile: prod-readonly');
    expect(yml()).not.toContain(SK);
    expect(await lzConnectAction('aws-prod', { ...AWS, awsProfile: '' }, h.deps())).toBe(0);
    expect(yml()).not.toContain('aws_profile');
    // A secret-shaped value is refused by the .swao.yml pre-check and never written or printed.
    const keyShaped = ['AS', 'IA', 'ABCDEFGHIJKLMNOP'].join('');
    expect(await lzConnectAction('aws-prod', { ...AWS, awsProfile: keyShaped }, h.deps())).not.toBe(0);
    expect(yml()).not.toContain(keyShaped);
    expect([...h.out, ...h.err].join('\n')).not.toContain(keyShaped);
    unregisterLiveLzDriver('aws');
  });

  it('refuses a malformed value, a combination with stdin or a file, and a source without the required fields', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = harness();
    expect(await lzConnectAction('fake-prod', { ...CONNECT, credentialsFrom: 'fake-test' }, h.deps())).toBe(1);
    expect(await lzConnectAction('fake-prod', { ...CONNECT, credentialsFrom: 'fake-test:platform', credentialsStdin: true }, h.deps())).toBe(1);
    expect(h.err.join('\n')).toMatch(/one way only/);
    expect(await lzConnectAction('fake-prod', { ...CONNECT, credentialsFrom: 'fake-test:platform' }, h.deps())).not.toBe(0);
    expect(h.err.join('\n')).toMatch(/no stored credentials for fake-test:platform/);
  });
});
