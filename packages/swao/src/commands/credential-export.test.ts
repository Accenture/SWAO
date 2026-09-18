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

// Tests for #2325 Feature 2: credential export/import crypto helpers.
// Tests encrypt/decrypt round-trip, wrong passphrase rejection, and
// the CredentialStore.importAll() merge/replace semantics.

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from '@swao/core';
import { encryptExport, decryptExport } from './credential.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'swao-export-test-'));
}
function cleanup(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

describe('encryptExport / decryptExport round-trip (#2325 Feature 2)', () => {
  it('round-trips plaintext through encrypt then decrypt with correct passphrase', () => {
    const plaintext = JSON.stringify({ 'anthropic-api-key': 'sk-ant-test', 'vcs-token': 'ghp_abc' });
    const passphrase = 'correct-horse-battery-staple';
    const envelope = encryptExport(plaintext, passphrase);
    const recovered = decryptExport(envelope, passphrase);
    expect(recovered).toBe(plaintext);
  });

  it('envelope has expected structure and type field', () => {
    const envelope = encryptExport('{"test":"value"}', 'passphrase-for-test');
    expect(envelope.v).toBe(1);
    expect(envelope.type).toBe('swao-credential-export');
    expect(envelope.alg).toBe('aes-256-gcm');
    expect(envelope.kdf).toBe('scrypt');
    expect(envelope.n).toBe(131_072);
    expect(envelope.r).toBe(8);
    expect(envelope.p).toBe(1);
    expect(typeof envelope.salt).toBe('string');
    expect(envelope.salt).toHaveLength(64); // 32 bytes hex
    expect(envelope.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(envelope.machine).toHaveLength(8); // sha256 truncated to 8 hex chars
  });

  it('each encryption produces a different ciphertext (random salt+iv)', () => {
    const plaintext = 'same-data';
    const pass = 'same-passphrase-abc';
    const a = encryptExport(plaintext, pass);
    const b = encryptExport(plaintext, pass);
    expect(a.salt).not.toBe(b.salt);
    expect(a.data).not.toBe(b.data);
  });

  it('decryptExport throws on wrong passphrase', () => {
    const envelope = encryptExport('{"key":"value"}', 'correct-passphrase-xyz');
    expect(() => decryptExport(envelope, 'wrong-passphrase-xyz')).toThrow('wrong-passphrase');
  });

  it('decryptExport throws when ciphertext is tampered', () => {
    const envelope = encryptExport('{"key":"value"}', 'passphrase-tamper-test');
    const tampered = { ...envelope, data: 'deadbeefdeadbeefdeadbeefdeadbeef' };
    expect(() => decryptExport(tampered, 'passphrase-tamper-test')).toThrow();
  });

  it('envelope data field does not contain the passphrase or plaintext in hex-decoded form', () => {
    const plaintext = '{"secret":"ultrasecret-unique-token-xyz"}';
    const passphrase = 'my-unique-test-passphrase-abc';
    const envelope = encryptExport(plaintext, passphrase);
    const envelopeStr = JSON.stringify(envelope);
    // Passphrase and plaintext must not appear anywhere in the envelope
    expect(envelopeStr).not.toContain(passphrase);
    expect(envelopeStr).not.toContain('ultrasecret-unique-token-xyz');
  });
});

describe('CredentialStore.importAll merge/replace semantics (#2325 Feature 2)', () => {
  let dir: string;
  let store: CredentialStore;

  beforeEach(() => {
    dir = makeTempDir();
    store = new CredentialStore(dir);
  });

  it('merge mode preserves existing keys not in import data', async () => {
    await store.set('existing-key', 'existing-value');
    await store.importAll({ 'new-key': 'new-value' }, 'merge');
    const keys = await store.list();
    expect(keys).toContain('existing-key');
    expect(keys).toContain('new-key');
    cleanup(dir);
  });

  it('merge mode overwrites existing keys that appear in import data', async () => {
    await store.set('anthropic-api-key', 'old-value');
    await store.importAll({ 'anthropic-api-key': 'new-value' }, 'merge');
    const val = await store.get('anthropic-api-key');
    expect(val).toBe('new-value');
    cleanup(dir);
  });

  it('replace mode removes existing keys not in import data', async () => {
    await store.set('old-key', 'old-value');
    await store.importAll({ 'new-key': 'new-value' }, 'replace');
    const keys = await store.list();
    expect(keys).not.toContain('old-key');
    expect(keys).toContain('new-key');
    cleanup(dir);
  });

  it('replace mode restores full vault from import data', async () => {
    await store.set('key-a', 'a');
    await store.set('key-b', 'b');
    await store.importAll({ 'key-c': 'c', 'key-d': 'd' }, 'replace');
    const keys = await store.list();
    expect(keys.sort()).toEqual(['key-c', 'key-d']);
    cleanup(dir);
  });
});
