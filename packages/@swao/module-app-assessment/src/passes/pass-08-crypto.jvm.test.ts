// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Pass 08 crypto: Java crypto APIs (#3422)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3422: Java JCA, BouncyCastle and Spring Security patterns through the
// crypto catalogue and the shared matcher, plus the JCA call inventory.
// Synthetic fixtures only.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { beginSourceScopeRun, endSourceScopeRun, type PassContext, type PassResult, type Signal } from '@swao/core';
import { runCryptoPass } from './pass-08-crypto.js';

let tmp: string;
let src: string;

function put(rel: string, content: string): void {
  const p = join(src, ...rel.split('/'));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, 'utf-8');
}

function ctx(overrides: Partial<PassContext> = {}): PassContext {
  return { workspacePath: tmp, sourcePath: src, appId: 'jvm-app', iter: 1, assessedAt: '2026-10-24', ...overrides } as PassContext;
}

function byEntry(r: PassResult, id: string): Signal | undefined {
  return r.signals.find((s) => s.derivation.includes(`(catalogue entry ${id}`));
}

function inventorySignal(r: PassResult): Signal | undefined {
  return r.signals.find((s) => s.derivation.startsWith('Java Cryptography Architecture usage'));
}

type Inventory = { total: number; production: number; test: number; algorithms: Array<{ api: string; algorithm: string; count: number }>; providers: string[]; locations: Array<{ file: string; line: number; path_class: string }> };

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-3422-crypto-'));
  src = join(tmp, 'source');
  mkdirSync(src, { recursive: true });
  endSourceScopeRun();
});

afterEach(() => {
  endSourceScopeRun();
  rmSync(tmp, { recursive: true, force: true });
});

describe('#3422 Pass 08: JCA algorithm strings', () => {
  it('Cipher.getInstance("DESede/CBC/PKCS5Padding") yields a deterministic CRYPTO signal with file:line', async () => {
    put('src/main/java/de/acme/Legacy.java', [
      'package de.acme;',
      'import javax.crypto.Cipher;',
      'class Legacy {',
      '  Cipher c() throws Exception { return Cipher.getInstance("DESede/CBC/PKCS5Padding"); }',
      '}',
    ].join('\n'));
    const r = await runCryptoPass(ctx());
    const sig = byEntry(r, '3des')!;
    expect(sig).toMatchObject({ severity: 'high', source: 'static_analysis', confidence: 'high' });
    expect(sig.evidence).toEqual(['src/main/java/de/acme/Legacy.java:4']);
  });

  it('KeyGenerator / SecretKeyFactory with "DES", Mac HmacMD5 and Signature SHA1withRSA are weak', async () => {
    put('src/main/java/de/acme/Keys.java', [
      'class Keys {',
      '  Object k = KeyGenerator.getInstance("DES");',
      '  Object f = SecretKeyFactory.getInstance("DES");',
      '  Object m = Mac.getInstance("HmacMD5");',
      '  Object s = Signature.getInstance("SHA1withRSA");',
      '}',
    ].join('\n'));
    const r = await runCryptoPass(ctx());
    expect(byEntry(r, 'des')!.evidence).toEqual(['src/main/java/de/acme/Keys.java:2', 'src/main/java/de/acme/Keys.java:3']);
    expect(byEntry(r, 'md5')!.evidence).toEqual(['src/main/java/de/acme/Keys.java:4']);
    expect(byEntry(r, 'sha1')!.evidence).toEqual(['src/main/java/de/acme/Keys.java:5']);
    expect(r.assessment['blocks_migration']).toBe(true);
  });

  it('approved Java primitives: PBKDF2WithHmacSHA256, SHA-256, HmacSHA256 yield positive signals', async () => {
    put('src/main/java/de/acme/Good.java', [
      'class Good {',
      '  Object f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");',
      '  Object d = MessageDigest.getInstance("SHA-256");',
      '  Object m = Mac.getInstance("HmacSHA256");',
      '}',
    ].join('\n'));
    const r = await runCryptoPass(ctx());
    for (const id of ['pbkdf2-sha2', 'sha2-sha3', 'hmac-sha2']) {
      expect(byEntry(r, id), id).toMatchObject({ severity: 'positive' });
    }
    expect(byEntry(r, 'pbkdf2-sha2')!.evidence).toEqual(['src/main/java/de/acme/Good.java:2']);
    expect(r.assessment['overall_posture']).toBe('good_with_infrastructure_gap');
  });
});

describe('#3422 Pass 08: Spring Security and BouncyCastle', () => {
  it('NoOpPasswordEncoder / MessageDigestPasswordEncoder are weak; BCrypt and Pbkdf2 encoders are approved', async () => {
    put('src/main/java/de/acme/SecurityConfig.java', [
      'class SecurityConfig {',
      '  PasswordEncoder legacy() { return NoOpPasswordEncoder.getInstance(); }',
      '  PasswordEncoder digest() { return new MessageDigestPasswordEncoder("SHA-256"); }',
      '  PasswordEncoder good() { return new BCryptPasswordEncoder(12); }',
      '  PasswordEncoder pb() { return Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_8(); }',
      '}',
    ].join('\n'));
    const r = await runCryptoPass(ctx());
    const legacy = byEntry(r, 'spring-legacy-password-encoder')!;
    expect(legacy.severity).toBe('high');
    expect(legacy.evidence).toEqual(['src/main/java/de/acme/SecurityConfig.java:2', 'src/main/java/de/acme/SecurityConfig.java:3']);
    expect(byEntry(r, 'bcrypt')).toMatchObject({ severity: 'positive' });
    expect(byEntry(r, 'pbkdf2-sha2')).toMatchObject({ severity: 'positive' });
  });

  it('BouncyCastle lightweight engines are rated and the provider registration is inventoried', async () => {
    put('src/main/java/de/acme/Bc.java', [
      'class Bc {',
      '  static { Security.addProvider(new BouncyCastleProvider()); }',
      '  BlockCipher e = new DESedeEngine();',
      '  Digest d = new MD5Digest();',
      '  Object c = Cipher.getInstance("AES/GCM/NoPadding", "BC");',
      '}',
    ].join('\n'));
    const r = await runCryptoPass(ctx());
    expect(byEntry(r, '3des')!.evidence).toEqual(['src/main/java/de/acme/Bc.java:3']);
    expect(byEntry(r, 'md5')!.evidence).toEqual(['src/main/java/de/acme/Bc.java:4']);
    const inv = r.assessment['jca_inventory'] as Inventory;
    expect(inv.providers).toEqual(['BouncyCastleProvider']);
    expect(inventorySignal(r)!.derivation).toContain('Providers registered: BouncyCastleProvider.');
  });
});

describe('#3422 Pass 08: JCA inventory', () => {
  it('lists every JCA call with a literal algorithm, rated or not, with file:line; posture unchanged', async () => {
    put('src/main/java/de/acme/Store.java', [
      'class Store {',
      '  Object c = Cipher.getInstance("AES/CBC/PKCS5Padding");',
      '  Object r = SecureRandom.getInstance("SHA1PRNG");',
      '  Object k = KeyStore.getInstance("PKCS12");',
      '  Object c2 = Cipher.getInstance("AES/CBC/PKCS5Padding");',
      '  Object alg = Cipher.getInstance(ALGORITHM);',
      '}',
    ].join('\n'));
    const r = await runCryptoPass(ctx());
    const inv = r.assessment['jca_inventory'] as Inventory;
    expect(inv.total).toBe(4);
    expect(inv.algorithms).toEqual([
      { api: 'Cipher', algorithm: 'AES/CBC/PKCS5Padding', count: 2 },
      { api: 'KeyStore', algorithm: 'PKCS12', count: 1 },
      { api: 'SecureRandom', algorithm: 'SHA1PRNG', count: 1 },
    ]);
    const sig = inventorySignal(r)!;
    expect(sig).toMatchObject({ severity: 'informational', confidence: 'high' });
    expect(sig.evidence).toEqual(['src/main/java/de/acme/Store.java:2', 'src/main/java/de/acme/Store.java:3', 'src/main/java/de/acme/Store.java:4', 'src/main/java/de/acme/Store.java:5']);
    // The inventory suppresses the "no primitives" fallback but rates nothing.
    expect(r.signals.some((s) => s.derivation.startsWith('No cryptographic primitives detected'))).toBe(false);
    expect(r.assessment['overall_posture']).toBe('unknown');
    expect(r.assessment['blocks_migration']).toBe(false);
    // Catalogue `hits` keys stay catalogue ids.
    expect(Object.keys((r.assessment['hits'] ?? {}) as object).some((k) => k.startsWith('__'))).toBe(false);
  });

  it('production/test split; exclude drops test files from the inventory (#3403)', async () => {
    put('src/main/java/de/acme/A.java', 'class A { Object c = Cipher.getInstance("AES/GCM/NoPadding"); }\n');
    put('src/test/java/de/acme/ATest.java', 'class ATest { Object c = Cipher.getInstance("AES/ECB/PKCS5Padding"); }\n');
    beginSourceScopeRun();
    let inv = (await runCryptoPass(ctx())).assessment['jca_inventory'] as Inventory;
    expect(inv).toMatchObject({ total: 2, production: 1, test: 1 });
    expect(inv.locations.map((l) => l.path_class)).toEqual(['prod', 'test']);
    endSourceScopeRun();
    beginSourceScopeRun({ testCode: 'exclude' });
    inv = (await runCryptoPass(ctx({ testCode: 'exclude' }))).assessment['jca_inventory'] as Inventory;
    expect(inv).toMatchObject({ total: 1, production: 1, test: 0 });
  });

  it('a mixed repository reports a KDF once: JS pbkdf2Sync and Java PBKDF2 are twins', async () => {
    put('web/src/hash.ts', "import { pbkdf2Sync } from 'crypto';\nexport const h = (p: string) => pbkdf2Sync(p, 's', 600000, 32, 'sha256');\n");
    put('api/src/main/java/de/acme/H.java', 'class H { Object f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256"); }\n');
    const r = await runCryptoPass(ctx());
    const kdf = r.signals.filter((s) => s.severity === 'positive' && /PBKDF2/i.test(s.derivation));
    expect(kdf).toHaveLength(1);
  });
});
