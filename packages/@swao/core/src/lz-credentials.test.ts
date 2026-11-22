// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3570: scoped vault keys, env override normalisation (Design 121 Q-M5),
// legacy Pass 23 key migration and the expiry fail-fast (Design 120 section 6.2).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore, credentialEnvVarName } from './credential-store.js';
import {
  lzCredentialKey,
  lzSessionExpiry,
  parseLzCredentialKey,
  findLegacyLzCredentialKeys,
  moveLegacyLzCredentials,
  resolveLzCredentials,
  LzCredentialExpiredError,
  LzCredentialMissingError,
} from './lz-credentials.js';

// Fake values built at runtime; not key-shaped.
const FAKE = (label: string): string => ['fake', label, 'value'].join('-');

let dir: string;
let store: CredentialStore;
let savedEnv: Record<string, string>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'swao-lz-cred-'));
  store = new CredentialStore(dir);
  savedEnv = {};
  for (const k of Object.keys(process.env).filter((k) => k.startsWith('SWAO_CREDENTIAL_'))) {
    savedEnv[k] = process.env[k] as string;
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of Object.keys(process.env).filter((k) => k.startsWith('SWAO_CREDENTIAL_'))) delete process.env[k];
  Object.assign(process.env, savedEnv);
  rmSync(dir, { recursive: true, force: true });
});

describe('lzCredentialKey / parseLzCredentialKey', () => {
  it('builds lz:<lz-id>:<scope-id>:<field>', () => {
    expect(lzCredentialKey('otc-prod', 'platform', 'password')).toBe('lz:otc-prod:platform:password');
    expect(lzCredentialKey('aws-demo', 'app-payments', 'expires-at')).toBe('lz:aws-demo:app-payments:expires-at');
  });

  it('refuses ids that are not kebab-case and unknown fields', () => {
    expect(() => lzCredentialKey('OTC_prod', 'platform', 'password')).toThrow(/kebab-case/);
    expect(() => lzCredentialKey('otc-prod', 'plat:form', 'password')).toThrow(/kebab-case/);
    expect(() => lzCredentialKey('otc-prod', 'platform', 'pin' as never)).toThrow(/unknown/);
  });

  it('parses scoped keys and rejects everything else', () => {
    expect(parseLzCredentialKey('lz:otc-prod:platform:password')).toEqual({ lzId: 'otc-prod', scopeId: 'platform', field: 'password' });
    expect(parseLzCredentialKey('aws-access-key-id')).toBeNull();
    expect(parseLzCredentialKey('lz:otc-prod:platform:pin')).toBeNull();
    expect(parseLzCredentialKey('provider:github:token')).toBeNull();
  });
});

describe('env override names (Design 121 Q-M5)', () => {
  it('maps : to __ and - to _', () => {
    expect(credentialEnvVarName('lz:otc-prod:platform:password')).toBe('SWAO_CREDENTIAL_LZ__OTC_PROD__PLATFORM__PASSWORD');
    expect(credentialEnvVarName('provider:github:token')).toBe('SWAO_CREDENTIAL_PROVIDER__GITHUB__TOKEN');
    expect(credentialEnvVarName('anthropic-api-key')).toBe('SWAO_CREDENTIAL_ANTHROPIC_API_KEY');
  });

  it('a scoped key resolves from its env override and list() round-trips the name', async () => {
    process.env['SWAO_CREDENTIAL_LZ__OTC_PROD__PLATFORM__PASSWORD'] = FAKE('pw');
    expect(await store.get('lz:otc-prod:platform:password')).toBe(FAKE('pw'));
    expect(await store.list()).toContain('lz:otc-prod:platform:password');
  });

  it('the documented provider:<p>:token env form now resolves (vcs-credential.ts)', async () => {
    process.env['SWAO_CREDENTIAL_PROVIDER__GITHUB__TOKEN'] = FAKE('tok');
    expect(await store.get('provider:github:token')).toBe(FAKE('tok'));
    expect(await store.list()).toContain('provider:github:token');
  });

  it('plain names are unchanged', async () => {
    process.env['SWAO_CREDENTIAL_ANTHROPIC_API_KEY'] = FAKE('llm');
    expect(await store.get('anthropic-api-key')).toBe(FAKE('llm'));
    expect(await store.list()).toContain('anthropic-api-key');
  });
});

describe('legacy Pass 23 key migration', () => {
  it('moves the AWS keys to scoped keys in one write; legacy keys are gone and not read', async () => {
    await store.importAll({
      'aws-access-key-id': FAKE('ak'),
      'aws-secret-access-key': FAKE('sk'),
      'aws-session-token': FAKE('st'),
      'azure-client-id': FAKE('cid'),
      'anthropic-api-key': FAKE('llm'),
    }, 'merge');

    expect(findLegacyLzCredentialKeys(store)).toEqual(['aws-access-key-id', 'aws-secret-access-key', 'aws-session-token', 'azure-client-id']);
    const moves = await moveLegacyLzCredentials(store, 'aws', 'aws-demo', 'platform');
    expect(moves.map((m) => m.to)).toEqual([
      'lz:aws-demo:platform:access-key-id',
      'lz:aws-demo:platform:secret-access-key',
      'lz:aws-demo:platform:session-token',
    ]);

    const data = store.loadSync();
    expect(data['aws-access-key-id']).toBeUndefined();
    expect(data['aws-secret-access-key']).toBeUndefined();
    expect(data['aws-session-token']).toBeUndefined();
    expect(data['lz:aws-demo:platform:access-key-id']).toBe(FAKE('ak'));
    expect(data['lz:aws-demo:platform:session-token']).toBe(FAKE('st'));
    // other providers and unrelated keys untouched
    expect(data['azure-client-id']).toBe(FAKE('cid'));
    expect(data['anthropic-api-key']).toBe(FAKE('llm'));
    expect(findLegacyLzCredentialKeys(store, 'aws')).toEqual([]);

    const creds = await resolveLzCredentials(store, 'aws-demo', 'platform', ['access-key-id', 'secret-access-key'], ['session-token']);
    expect(creds).toEqual({ 'access-key-id': FAKE('ak'), 'secret-access-key': FAKE('sk'), 'session-token': FAKE('st') });
  });

  it('refuses to overwrite an existing scoped key and leaves the vault unchanged', async () => {
    await store.importAll({
      'azure-tenant-id': FAKE('t'),
      'azure-client-id': FAKE('c'),
      'lz:az-demo:platform:client-id': FAKE('existing'),
    }, 'merge');
    const before = readFileSync(join(dir, '.swao-credentials.json'), 'utf-8');
    await expect(moveLegacyLzCredentials(store, 'azure', 'az-demo', 'platform')).rejects.toThrow(/already exists/);
    expect(readFileSync(join(dir, '.swao-credentials.json'), 'utf-8')).toBe(before);
    expect(store.loadSync()['azure-tenant-id']).toBe(FAKE('t'));
  });

  it('is a no-op when there are no legacy keys', async () => {
    expect(await moveLegacyLzCredentials(store, 'aws', 'aws-demo', 'platform')).toEqual([]);
  });
});

describe('resolveLzCredentials expiry fail-fast', () => {
  const NOW = new Date('2026-11-02T12:00:00Z');

  beforeEach(async () => {
    await store.importAll({
      'lz:aws-demo:platform:access-key-id': FAKE('ak'),
      'lz:aws-demo:platform:secret-access-key': FAKE('sk'),
    }, 'merge');
  });

  it('throws LzCredentialExpiredError (exit code 2) for a past expires-at, before reading any other field', async () => {
    await store.set('lz:aws-demo:platform:expires-at', '2026-11-02T11:59:59+00:00');
    const err = await resolveLzCredentials(store, 'aws-demo', 'platform', ['access-key-id'], [], NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LzCredentialExpiredError);
    expect((err as LzCredentialExpiredError).exitCode).toBe(2);
    expect((err as LzCredentialExpiredError).reason).toBe('expired');
    expect((err as Error).message).not.toContain(FAKE('ak'));
    // #4459: the hint names steps a binary user can follow, no repository script.
    expect((err as Error).message).not.toMatch(/scripts\/|\.sh\b/);
    expect((err as Error).message).toContain('aws sso login --profile <profile>');
    expect((err as Error).message).toContain('swao credential set lz:aws-demo:platform:<field> -');
  });

  it('#4459: lzSessionExpiry reports a past, a future and an unreadable expires-at; null without one', async () => {
    expect(await lzSessionExpiry(store, 'aws-demo', 'platform', NOW)).toBeNull();
    await store.set('lz:aws-demo:platform:expires-at', '2026-11-02T11:00:00Z');
    expect(await lzSessionExpiry(store, 'aws-demo', 'platform', NOW)).toEqual({ expiresAt: '2026-11-02T11:00:00Z', expired: true });
    await store.set('lz:aws-demo:platform:expires-at', '2026-11-02T13:00:00Z');
    expect((await lzSessionExpiry(store, 'aws-demo', 'platform', NOW))?.expired).toBe(false);
    await store.set('lz:aws-demo:platform:expires-at', 'soon');
    expect((await lzSessionExpiry(store, 'aws-demo', 'platform', NOW))?.expired).toBe(true);
  });

  it('throws for an unreadable expires-at', async () => {
    await store.set('lz:aws-demo:platform:expires-at', 'tomorrow');
    await expect(resolveLzCredentials(store, 'aws-demo', 'platform', ['access-key-id'], [], NOW)).rejects.toMatchObject({ reason: 'unreadable' });
  });

  it('accepts a future expires-at in the AWS export format', async () => {
    await store.set('lz:aws-demo:platform:expires-at', '2026-11-02T19:59:25+00:00');
    const c = await resolveLzCredentials(store, 'aws-demo', 'platform', ['access-key-id', 'secret-access-key'], [], NOW);
    expect(c['access-key-id']).toBe(FAKE('ak'));
  });

  it('the expiry check also applies to an env override', async () => {
    process.env['SWAO_CREDENTIAL_LZ__AWS_DEMO__PLATFORM__EXPIRES_AT'] = '2020-01-01T00:00:00Z';
    await expect(resolveLzCredentials(store, 'aws-demo', 'platform', ['access-key-id'], [], NOW)).rejects.toBeInstanceOf(LzCredentialExpiredError);
  });

  it('lists missing required keys by name', async () => {
    const err = await resolveLzCredentials(store, 'aws-demo', 'platform', ['access-key-id', 'session-token'], [], NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LzCredentialMissingError);
    expect((err as LzCredentialMissingError).keys).toEqual(['lz:aws-demo:platform:session-token']);
  });
});
