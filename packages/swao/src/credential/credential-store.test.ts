// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CredentialStore } from '@swao/core';
import { resolveVcsToken, vcsTokenKey } from './vcs-credential.js';

const TMP_DIR = join(tmpdir(), `swao-cred-test-${process.pid}`);

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
  delete process.env['SWAO_CREDENTIAL_ANTHROPIC_API_KEY'];
  delete process.env['SWAO_CREDENTIAL_TEST_KEY'];
  delete process.env['SWAO_CREDENTIAL_MYKEY'];
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
  delete process.env['SWAO_CREDENTIAL_ANTHROPIC_API_KEY'];
  delete process.env['SWAO_CREDENTIAL_TEST_KEY'];
  delete process.env['SWAO_CREDENTIAL_MYKEY'];
});

function makeStore(): CredentialStore {
  return new CredentialStore(TMP_DIR);
}

describe('CredentialStore (#0118)', () => {
  it('set and get roundtrip works', async () => {
    const store = makeStore();
    await store.set('my-key', 'my-secret');
    const val = await store.get('my-key');
    expect(val).toBe('my-secret');
  });

  it('get returns null for unknown credential', async () => {
    const store = makeStore();
    const val = await store.get('does-not-exist');
    expect(val).toBeNull();
  });

  it('list returns stored names without values', async () => {
    const store = makeStore();
    await store.set('alpha', 'secret1');
    await store.set('beta', 'secret2');
    const names = await store.list();
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
    expect(names.join('')).not.toContain('secret');
  });

  it('delete removes a credential', async () => {
    const store = makeStore();
    await store.set('to-delete', 'value');
    const deleted = await store.delete('to-delete');
    expect(deleted).toBe(true);
    expect(await store.get('to-delete')).toBeNull();
  });

  it('delete returns false for non-existent credential', async () => {
    const store = makeStore();
    const deleted = await store.delete('nonexistent');
    expect(deleted).toBe(false);
  });

  it('env var SWAO_CREDENTIAL_<NAME> takes priority over stored value', async () => {
    process.env['SWAO_CREDENTIAL_TEST_KEY'] = 'env-value';
    const store = makeStore();
    await store.set('test-key', 'stored-value');
    const val = await store.get('test-key');
    expect(val).toBe('env-value');
  });

  it('list includes env-sourced credential names', async () => {
    process.env['SWAO_CREDENTIAL_MYKEY'] = 'env-val';
    const store = makeStore();
    const names = await store.list();
    expect(names).toContain('mykey');
  });

  it('getOrThrow throws if credential not found', async () => {
    const store = makeStore();
    await expect(store.getOrThrow('missing', 'test-context')).rejects.toThrow('"missing" not found');
  });

  it('getOrThrow returns value if found', async () => {
    const store = makeStore();
    await store.set('found-key', 'secret-value');
    const result = await store.getOrThrow('found-key', 'test');
    expect(result).toBe('secret-value');
  });

  it('credential value does not appear in error messages', async () => {
    const store = makeStore();
    let errorMessage = '';
    try {
      await store.getOrThrow('no-such-key', 'context');
    } catch (e) {
      errorMessage = (e as Error).message;
    }
    expect(errorMessage).not.toContain('secret');
    expect(errorMessage).not.toContain('password');
    expect(errorMessage).toContain('no-such-key');
  });

  it('multiple set operations update the same key', async () => {
    const store = makeStore();
    await store.set('key', 'first');
    await store.set('key', 'second');
    expect(await store.get('key')).toBe('second');
  });
});

describe('CredentialStore -- AES-256-GCM vault (#0149)', () => {
  it('credential file is not plaintext after set', async () => {
    const store = makeStore();
    await store.set('api-key', 'super-secret');
    const raw = readFileSync(join(TMP_DIR, '.swao-credentials.json'), 'utf-8');
    expect(raw).not.toContain('super-secret');
    expect(raw).not.toContain('api-key');
    const parsed = JSON.parse(raw) as { v?: number };
    expect(parsed.v).toBe(1);
  });

  it('salt is reused across successive writes (stable decryption)', async () => {
    const store = makeStore();
    await store.set('k1', 'v1');
    const before = JSON.parse(readFileSync(join(TMP_DIR, '.swao-credentials.json'), 'utf-8')) as { salt: string };
    await store.set('k2', 'v2');
    const after = JSON.parse(readFileSync(join(TMP_DIR, '.swao-credentials.json'), 'utf-8')) as { salt: string };
    expect(before.salt).toBe(after.salt);
  });

  it('iv differs between writes (no IV reuse)', async () => {
    const store = makeStore();
    await store.set('k', 'v');
    const first = JSON.parse(readFileSync(join(TMP_DIR, '.swao-credentials.json'), 'utf-8')) as { iv: string };
    await store.set('k', 'v2');
    const second = JSON.parse(readFileSync(join(TMP_DIR, '.swao-credentials.json'), 'utf-8')) as { iv: string };
    expect(first.iv).not.toBe(second.iv);
  });

  it('empty file treated as uninitialized, not corrupt', async () => {
    const store = makeStore();
    writeFileSync(join(TMP_DIR, '.swao-credentials.json'), '{}');
    const val = await store.get('any-key');
    expect(val).toBeNull();
  });

  it('plaintext legacy file is auto-migrated to encrypted on next set', async () => {
    // Write a plaintext credentials file (legacy format)
    writeFileSync(
      join(TMP_DIR, '.swao-credentials.json'),
      JSON.stringify({ 'legacy-key': 'legacy-value' }, null, 2)
    );
    const store = makeStore();
    // Trigger a write -- migration happens in load() + save()
    await store.set('new-key', 'new-value');
    const raw = readFileSync(join(TMP_DIR, '.swao-credentials.json'), 'utf-8');
    // File must now be encrypted
    const parsed = JSON.parse(raw) as { v?: number };
    expect(parsed.v).toBe(1);
    expect(raw).not.toContain('legacy-value');
    // Both keys must survive
    expect(await store.get('legacy-key')).toBe('legacy-value');
    expect(await store.get('new-key')).toBe('new-value');
  });

  it('corrupted auth tag produces a clear error (not a crash)', async () => {
    const store = makeStore();
    await store.set('x', 'y');
    const raw = readFileSync(join(TMP_DIR, '.swao-credentials.json'), 'utf-8');
    const vault = JSON.parse(raw) as { tag: string; [k: string]: unknown };
    vault.tag = 'deadbeef'.repeat(4);
    writeFileSync(join(TMP_DIR, '.swao-credentials.json'), JSON.stringify(vault));
    await expect(store.get('x')).rejects.toThrow('Vault decryption failed');
  });
});

describe('VCS credential helpers (#0421)', () => {
  it('vcsTokenKey derives the correct key from a GitHub URL', () => {
    expect(vcsTokenKey('https://github.com/accenture/myrepo')).toBe('provider:github:token');
  });

  it('vcsTokenKey derives the correct key from a GitLab URL', () => {
    expect(vcsTokenKey('https://gitlab.com/org/repo')).toBe('provider:gitlab:token');
  });

  it('vcsTokenKey falls back to provider:vcs:token for unknown hosts', () => {
    expect(vcsTokenKey('https://selfhosted.internal/org/repo')).toBe('provider:vcs:token');
  });

  it('resolveVcsToken reads new provider-scoped key when present', async () => {
    const store = makeStore();
    await store.set('provider:github:token', 'ghp_new');
    const result = await resolveVcsToken(store, 'https://github.com/accenture/myrepo');
    expect(result).toBe('ghp_new');
  });

  it('resolveVcsToken falls back to legacy vcs-token when new key is absent', async () => {
    const store = makeStore();
    // Only the old key is present (legacy vault written before #0421).
    await store.set('vcs-token', 'old_pat');
    const result = await resolveVcsToken(store, 'https://github.com/accenture/myrepo');
    expect(result).toBe('old_pat');
  });

  it('resolveVcsToken returns null when neither key is set', async () => {
    const store = makeStore();
    const result = await resolveVcsToken(store, 'https://github.com/accenture/myrepo');
    expect(result).toBeNull();
  });

  it('resolveVcsToken prefers new key over legacy key when both are set', async () => {
    const store = makeStore();
    await store.set('vcs-token', 'old_pat');
    await store.set('provider:github:token', 'new_pat');
    const result = await resolveVcsToken(store, 'https://github.com/accenture/myrepo');
    expect(result).toBe('new_pat');
  });
});
