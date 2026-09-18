// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health-check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Tests for #2325 Feature 3: credential vault health-check probe.
// Three scenarios: vault absent (FAIL), vault decryptable with no LLM key (WARN),
// vault decryptable with LLM key (OK). Plus a corrupt-vault FAIL case.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from '@swao/core';
import { buildCredentialVaultProbe } from './credential-vault-probe.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'swao-vault-probe-'));
}

function cleanup(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

describe('buildCredentialVaultProbe (#2325 Feature 3)', () => {
  it('returns FAIL when vault file is absent', () => {
    const dir = makeTempDir();
    try {
      const result = buildCredentialVaultProbe(dir);
      expect(result.status).toBe('fail');
      expect(result.vaultExists).toBe(false);
      expect(result.decryptable).toBe(false);
      expect(result.keyCount).toBe(0);
      expect(result.categories).toHaveLength(0);
    } finally {
      cleanup(dir);
    }
  });

  it('returns WARN when vault decrypts but no LLM API key present', async () => {
    const dir = makeTempDir();
    try {
      const store = new CredentialStore(dir);
      await store.set('vcs-token', 'ghp_abc');
      await store.set('playwright-url-myapp', 'https://example.com');

      const result = buildCredentialVaultProbe(dir);
      expect(result.status).toBe('warn');
      expect(result.vaultExists).toBe(true);
      expect(result.decryptable).toBe(true);
      expect(result.keyCount).toBe(2);
      expect(result.categories).toContain('vcs');
      expect(result.categories).toContain('playwright');
      expect(result.categories).not.toContain('llm');
    } finally {
      cleanup(dir);
    }
  });

  it('returns OK when vault decrypts and has at least one LLM API key', async () => {
    const dir = makeTempDir();
    try {
      const store = new CredentialStore(dir);
      await store.set('anthropic-api-key', 'sk-ant-test');
      await store.set('vcs-token', 'ghp_xyz');

      const result = buildCredentialVaultProbe(dir);
      expect(result.status).toBe('ok');
      expect(result.vaultExists).toBe(true);
      expect(result.decryptable).toBe(true);
      expect(result.keyCount).toBe(2);
      expect(result.categories).toContain('llm');
      expect(result.categories).toContain('vcs');
    } finally {
      cleanup(dir);
    }
  });

  it('returns FAIL when vault file exists but is corrupt (unreadable JSON)', () => {
    const dir = makeTempDir();
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, '.swao-credentials.json'), '{"v":1,"alg":"aes-256-gcm","kdf":"scrypt","n":16384,"r":8,"p":1,"salt":"deadbeef","iv":"deadbeef","tag":"deadbeef","data":"deadbeef"}', 'utf-8');

      const result = buildCredentialVaultProbe(dir);
      expect(result.status).toBe('fail');
      expect(result.vaultExists).toBe(true);
      expect(result.decryptable).toBe(false);
      expect(result.keyCount).toBe(0);
    } finally {
      cleanup(dir);
    }
  });

  it('categorises playwright-mfa-* keys separately from playwright keys', async () => {
    const dir = makeTempDir();
    try {
      const store = new CredentialStore(dir);
      await store.set('anthropic-api-key', 'sk-ant-test');
      await store.set('playwright-url-app1', 'https://app1.example.com');
      await store.set('playwright-mfa-app1', 'TOTP_SECRET');

      const result = buildCredentialVaultProbe(dir);
      expect(result.status).toBe('ok');
      expect(result.categories).toContain('llm');
      expect(result.categories).toContain('playwright');
      expect(result.categories).toContain('playwright-mfa');
    } finally {
      cleanup(dir);
    }
  });

  it('log event context never contains key names or values', async () => {
    // The probe itself does not log; the caller (gatherProbes) does.
    // This test verifies the result shape contains no credential data.
    const dir = makeTempDir();
    try {
      const store = new CredentialStore(dir);
      await store.set('anthropic-api-key', 'sk-ant-SUPERSECRET');

      const result = buildCredentialVaultProbe(dir);
      const serialised = JSON.stringify(result);
      expect(serialised).not.toContain('sk-ant-SUPERSECRET');
      expect(serialised).not.toContain('anthropic-api-key');
    } finally {
      cleanup(dir);
    }
  });
});
