// #3975 (Design 120 section 6.3, Design 123 section 5.4): the log archive
// scope (`scopes[].purpose: log-archive`) as other scopes see it. It is opened
// once, through its own probe and the same read-only gate and run flags as any
// scope; every failure is a named reason, never an exception.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from '@swao/core';
import { registerLiveLzDriver, unregisterLiveLzDriver } from '../registry.js';
import { buildScopeCtx, logArchiveRef } from '../session.js';
import type { BuiltScopeCtx } from '../session.js';
import type { ReadOnlyProbe } from '../types.js';
import { makeFakeDriver, makeTransport, REFUSED, UNVERIFIABLE, VERIFIED } from './fake-driver.js';

const dirs: string[] = [];
afterEach(() => {
  unregisterLiveLzDriver();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const LZ = {
  id: 'fake-org', provider: 'fakecsp',
  scopes: [
    { id: 'platform', kind: 'platform' as const, auth: 'aksk' },
    { id: 'app-shop', kind: 'application' as const, auth: 'aksk' },
    { id: 'log-archive', kind: 'application' as const, auth: 'aksk', purpose: 'log-archive' as const },
  ],
};
const platform = LZ.scopes[0]!;
const archive = LZ.scopes[2]!;

async function store(withArchiveLogin: boolean, expiresAt?: string): Promise<CredentialStore> {
  const d = mkdtempSync(join(tmpdir(), 'swao-la-vault-'));
  dirs.push(d);
  const s = new CredentialStore(d);
  for (const scope of ['platform', ...(withArchiveLogin ? ['log-archive'] : [])]) {
    await s.set(`lz:fake-org:${scope}:access-key-id`, 'AKIDEXAMPLE');
    await s.set(`lz:fake-org:${scope}:secret-access-key`, 'example-secret-value');
  }
  if (expiresAt) await s.set('lz:fake-org:log-archive:expires-at', expiresAt);
  return s;
}

async function open(probe: ReadOnlyProbe, opts: { login?: boolean; expiresAt?: string; acceptWrite?: boolean; acceptUnverified?: boolean } = {}) {
  let probes = 0;
  registerLiveLzDriver(makeFakeDriver(async () => { probes++; return probe; }));
  const built: BuiltScopeCtx[] = [];
  const ref = logArchiveRef(LZ, platform, {
    store: await store(opts.login ?? true, opts.expiresAt), env: {}, fetchImpl: makeTransport([]),
    acceptWriteCapableCredentials: opts.acceptWrite ?? false, acceptUnverifiedReadOnly: opts.acceptUnverified ?? false,
  }, (b) => built.push(b));
  if (!ref) throw new Error('no log archive ref');
  const first = await ref.open();
  const second = await ref.open();
  return { ref, first, second, probes, built };
}

describe('logArchiveRef (#3975)', () => {
  it('is absent when the landing zone registers no log archive, and for the log archive scope itself', () => {
    const none = { ...LZ, scopes: LZ.scopes.slice(0, 2) };
    const d = mkdtempSync(join(tmpdir(), 'swao-la-'));
    dirs.push(d);
    expect(logArchiveRef(none, platform, { store: new CredentialStore(d) }, () => undefined)).toBeUndefined();
    expect(logArchiveRef(LZ, archive, { store: new CredentialStore(d) }, () => undefined)).toBeUndefined();
  });

  it('live 2026-11-09: the log archive scope context is marked as the archive, other scopes are not', async () => {
    registerLiveLzDriver(makeFakeDriver(async () => VERIFIED));
    const opts = { store: await store(true), env: {}, fetchImpl: makeTransport([]) };
    expect((await buildScopeCtx(LZ, archive, opts)).ctx.isLogArchive).toBe(true);
    expect((await buildScopeCtx(LZ, platform, opts)).ctx.isLogArchive).toBeUndefined();
  });

  it('a verified archive login opens once with its own scope context', async () => {
    const { ref, first, second, probes, built } = await open(VERIFIED);
    expect(ref.scopeId).toBe('log-archive');
    expect('ctx' in first && first.ctx.scopeId).toBe('log-archive');
    expect(second).toBe(first);
    expect(probes).toBe(1);
    expect(built).toHaveLength(1);
  });

  it('a write-capable archive login is not used without --accept-write-capable-credentials', async () => {
    expect((await open(REFUSED)).first).toEqual({ unavailable: 'read_only_refused' });
    unregisterLiveLzDriver();
    expect('ctx' in (await open(REFUSED, { acceptWrite: true })).first).toBe(true);
  });

  it('an unverifiable archive login is not used without --accept-unverified-read-only', async () => {
    expect((await open(UNVERIFIABLE)).first).toEqual({ unavailable: 'read_only_unverifiable' });
  });

  it('a missing or expired archive login is a reason, not an exception, and sends no request', async () => {
    const missing = await open(VERIFIED, { login: false });
    expect(missing.first).toEqual({ unavailable: 'login_missing' });
    expect(missing.probes).toBe(0);
    unregisterLiveLzDriver();
    const expired = await open(VERIFIED, { expiresAt: '2026-11-07T17:59:00Z' });
    expect(expired.first).toEqual({ unavailable: 'login_expired' });
    expect(expired.probes).toBe(0);
  });
});
