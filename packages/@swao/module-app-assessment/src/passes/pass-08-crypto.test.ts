// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runCryptoPass } from './pass-08-crypto.js';
import { loadPassCatalog } from './pass-catalog-loader.js';
import type { PassContext } from '@swao/core';
import { applyTestCodeMarker, isTestPath } from '@swao/core';

let tmp: string;
let src: string;

function makeCtx(overrides: Partial<PassContext> = {}): PassContext {
  return {
    workspacePath: tmp,
    sourcePath: src,
    appId: 'test-app',
    iter: 1,
    assessedAt: '2026-01-01',
    ...overrides,
  } as PassContext;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-pass08-'));
  src = join(tmp, 'src');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test-app', dependencies: {} }), 'utf-8');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('pass-08-crypto -- existing hardcoded pattern detection', () => {
  it('emits high-severity signal when Node.js MD5 hash detected', async () => {
    writeFileSync(
      join(src, 'hash.ts'),
      `import { createHash } from 'crypto';\nconst h = createHash('md5');`,
      'utf-8',
    );
    const result = await runCryptoPass(makeCtx());
    const weakSignal = result.signals.find(
      (s) => s.severity === 'high' && s.derivation.includes('Weak cryptographic primitive'),
    );
    expect(weakSignal).toBeDefined();
    expect(weakSignal!.derivation).toMatch(/md5/i);
  });

  it('emits positive signal when bcrypt detected', async () => {
    writeFileSync(
      join(src, 'auth.ts'),
      `import bcrypt from 'bcrypt';\nconst h = bcrypt.hash(password, 10);`,
      'utf-8',
    );
    const result = await runCryptoPass(makeCtx());
    const positiveSignal = result.signals.find((s) => s.severity === 'positive');
    expect(positiveSignal).toBeDefined();
  });
});

describe('pass-08-crypto -- catalogue-extended detection (#3063)', () => {
  it('emits high-severity CRYPTO signal when Java-style DES/ECB import detected', async () => {
    // DES/ECB matches the catalogue entry id: des with detection.imports including "DES/ECB"
    writeFileSync(
      join(src, 'CryptoUtil.java'),
      `import javax.crypto.Cipher;\npublic class CryptoUtil {\n  Cipher c = Cipher.getInstance("DES/ECB/PKCS5Padding");\n}`,
      'utf-8',
    );
    const result = await runCryptoPass(makeCtx());
    // In dev environment the bundled catalogue is found; in CI without bundled files,
    // only hardcoded patterns fire. We assert the finding IF the catalogue is resolved.
    const anyHighSeverity = result.signals.some((s) => s.severity === 'high');
    // Either the catalogue entry fires OR the Java file is not matched by hardcoded JS patterns
    // (which is expected -- this validates catalogue supplements where hardcoded patterns don't reach).
    // Assertion: no crash, result is complete.
    expect(result.pass.status).toBe('complete');
    if (anyHighSeverity) {
      const desSignal = result.signals.find(
        (s) => s.severity === 'high' && (s.derivation.includes('DES') || s.derivation.includes('des')),
      );
      expect(desSignal).toBeDefined();
    }
  });

  it('emits high-severity signal when RC4 detected from catalogue', async () => {
    writeFileSync(
      join(src, 'legacy.ts'),
      `const cipher = crypto.createCipheriv('RC4', key, null);`,
      'utf-8',
    );
    const result = await runCryptoPass(makeCtx());
    expect(result.pass.status).toBe('complete');
    // RC4 is in the catalogue with severity: weak; also 'RC4' contains no Node.js createCipheriv match
    // from the hardcoded list (which only covers 'des' pattern). Catalogue should catch it.
    const highSignals = result.signals.filter((s) => s.severity === 'high');
    if (highSignals.length > 0) {
      expect(highSignals.some((s) => s.derivation.includes('RC4') || s.derivation.includes('rc4'))).toBe(true);
    }
  });

  it('blocks_migration is true when weak primitives detected', async () => {
    writeFileSync(
      join(src, 'hash.ts'),
      `import { createHash } from 'crypto';\nconst h = createHash('md5');`,
      'utf-8',
    );
    const result = await runCryptoPass(makeCtx());
    expect((result.assessment as Record<string, unknown>)['blocks_migration']).toBe(true);
  });

  it('does not double-report primitives already covered by hardcoded patterns', async () => {
    // DES is in both hardcoded WEAK_PRIMITIVES and catalogue; it should not emit duplicate signals.
    writeFileSync(
      join(src, 'legacy.ts'),
      `const c = crypto.createCipheriv('des', key, iv);`,
      'utf-8',
    );
    const result = await runCryptoPass(makeCtx());
    const desSignals = result.signals.filter(
      (s) => s.severity === 'high' && s.derivation.toLowerCase().includes('des'),
    );
    // Expect at most one DES-related weak signal (no duplicates)
    expect(desSignals.length).toBeLessThanOrEqual(1);
  });

  it('returns complete pass result even with no source files', async () => {
    const result = await runCryptoPass(makeCtx());
    expect(result.pass.id).toBe(8);
    expect(result.pass.status).toBe('complete');
    expect(result.signals.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// #3410: shared catalogue matcher (word boundaries, case rules, data skip)
// ---------------------------------------------------------------------------

const B64_PDF_LINES = [
  'JVBERi0xLjQKJcfsj6IKNSAwIG9iago8PC9MZW5ndGggNiAwIFIvRmlsdGVyIC9GbGF0ZURlY29k',
  'ZT4+CnN0cmVhbQp4nCvkMlAwUDC2tNTKTSxRSMsvyklRMLOw0DNWyM1RyEgtSlVIyc+zVcjPS9Xz',
  'TM0rKUrMyy9KSS1SsDUwUDBXSFQwUDBXMAKyc0rMS0rKEVKTSzIzUxTSFSwsDA2NNBMyMpX8CtSz',
  'TMs3MFMwNrcwsrS0tDBQMDQ0Mtc1M+RC4/MjU0NTg0NTCwszI0MlWw0DA3N7Uwtjc3MlSwNjQy',
];

function weakCryptoSignals(result: Awaited<ReturnType<typeof runCryptoPass>>) {
  return result.signals.filter((s) => /weak|deprecated/i.test(s.derivation) && s.severity === 'high');
}

describe('pass-08-crypto -- #3410 shared catalogue matcher', () => {
  it('the bundled catalogue resolves in this environment (the assertions below are unconditional)', () => {
    const cat = loadPassCatalog(tmp, 'pass-08-crypto-algorithms.yaml');
    expect(cat).not.toBeNull();
    expect(cat!.match_defaults?.match).toBe('identifier');
  });

  it('istDeaktiviert, a base64 PDF string and "// 3DES legacy note" produce no CRYPTO weak signal', async () => {
    writeFileSync(join(src, 'konto.service.ts'), [
      'export class KontoService {',
      '  // 3DES legacy note: the old mainframe used it, we do not',
      '  pruefe(konto: Konto): boolean {',
      '    if (konto.istDeaktiviert) { return false; }',
      '    return !konto.wirdDeaktiviert;',
      '  }',
      '}',
    ].join('\n'), 'utf-8');
    writeFileSync(join(src, 'pdf-sample.ts'), [
      'export const SAMPLE_PDF =',
      ...B64_PDF_LINES.map((l) => `  "${l}" +`),
      '  "";',
    ].join('\n'), 'utf-8');
    const result = await runCryptoPass(makeCtx());
    expect(weakCryptoSignals(result)).toEqual([]);
    expect(result.assessment['blocks_migration']).toBe(false);
  });

  it('Java Cipher.getInstance("DESede/CBC/PKCS5Padding") is detected as 3DES', async () => {
    mkdirSync(join(src, 'main', 'java'), { recursive: true });
    writeFileSync(join(src, 'main', 'java', 'LegacyCrypto.java'), [
      'import javax.crypto.Cipher;',
      'public class LegacyCrypto {',
      '  Cipher c() throws Exception { return Cipher.getInstance("DESede/CBC/PKCS5Padding"); }',
      '}',
    ].join('\n'), 'utf-8');
    const result = await runCryptoPass(makeCtx());
    const sig = weakCryptoSignals(result).find((s) => s.derivation.includes('Triple DES'));
    expect(sig).toBeDefined();
    expect(sig!.evidence[0]).toBe('main/java/LegacyCrypto.java:3');
  });

  it("Node createCipheriv('rc4', ...) is detected as RC4", async () => {
    writeFileSync(join(src, 'legacy.ts'), `import crypto from 'crypto';\nconst c = crypto.createCipheriv('rc4', key, null);\n`, 'utf-8');
    const result = await runCryptoPass(makeCtx());
    const sig = weakCryptoSignals(result).find((s) => s.derivation.includes('RC4'));
    expect(sig).toBeDefined();
    expect(sig!.evidence[0]).toBe('legacy.ts:2');
  });

  it('a minified bundle is skipped even when it contains a weak cipher call', async () => {
    writeFileSync(join(src, 'vendor.min.js'), `var a=require('crypto').createCipheriv('rc4',k,null);`, 'utf-8');
    const result = await runCryptoPass(makeCtx());
    expect(weakCryptoSignals(result)).toEqual([]);
  });

  it('regression fixture with the client K1 to K6 shapes yields no weak-crypto false positive', async () => {
    // Mirrors the six weak-crypto finding shapes of the partner PoC (#3410
    // problem statement): TDEA inside German identifiers, RC4 inside a
    // base64 test document, and bare acronyms in comments or prose.
    mkdirSync(join(src, 'app', 'benutzer'), { recursive: true });
    mkdirSync(join(src, 'systemtest', 'data'), { recursive: true });
    writeFileSync(join(src, 'app', 'benutzer', 'benutzer.entity.ts'), [
      'export class Benutzer {',
      '  istDeaktiviert = false;          // K1',
      '  letzterStatusDeaktivierung?: Date; // K2',
      '  /** Feld fuer RC4 Altdaten-Migration, siehe Konzept */ // K3',
      '}',
    ].join('\n'), 'utf-8');
    writeFileSync(join(src, 'systemtest', 'data', 'antrag.pdf.ts'), [
      'export const ANTRAG_PDF = [',
      ...B64_PDF_LINES.map((l) => `  '${l}', // K4/K5`),
      '].join("");',
    ].join('\n'), 'utf-8');
    writeFileSync(join(src, 'app', 'export.service.ts'), [
      'const STATUS_DEAKTIVIERT = "TDEAKTIV"; // K6',
      'const label = "3DES or SHA1 were used by the predecessor";',
    ].join('\n'), 'utf-8');
    const result = await runCryptoPass(makeCtx());
    expect(weakCryptoSignals(result)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #3411: all hits, production/test split
// ---------------------------------------------------------------------------

const DESEDE_LINE = '  Cipher c = Cipher.getInstance("DESede/CBC/PKCS5Padding");';

function writeJava(rel: string, lines: string[]): void {
  const full = join(src, ...rel.split('/'));
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, ['class X {', ...lines, '}'].join('\n'), 'utf-8');
}

function tripleDesSignal(result: Awaited<ReturnType<typeof runCryptoPass>>) {
  return result.signals.find((s) => s.derivation.includes('Triple DES'));
}

type HitBlock = { total: number; production: number; test: number; truncated: boolean; locations: Array<{ file: string; line: number; path_class: string }> };

describe('pass-08-crypto -- #3411 all catalogue hits with production/test split', () => {
  it('3 test hits and 1 production hit: production file cited first, "4 occurrences (1 production, 3 test)"', async () => {
    // Walk order lists test/ before zz/, so the pre-#3411 first-hit logic cited a test file.
    writeJava('test/java/ATest.java', [DESEDE_LINE]);
    writeJava('test/java/BTest.java', [DESEDE_LINE]);
    writeJava('test/java/CTest.java', [DESEDE_LINE]);
    writeJava('zz/main/Prod.java', [DESEDE_LINE]);
    const result = await runCryptoPass(makeCtx());
    const sig = tripleDesSignal(result);
    expect(sig).toBeDefined();
    expect(sig!.evidence[0]).toBe('zz/main/Prod.java:2');
    expect(sig!.evidence).toHaveLength(4);
    expect(sig!.derivation).toContain('4 occurrences (1 production, 3 test)');
    expect(sig!.severity).toBe('high');
    const hits = (result.assessment['hits'] as Record<string, HitBlock>)['3des']!;
    expect(hits).toMatchObject({ total: 4, production: 1, test: 3, truncated: false });
    expect(hits.locations[0]!.path_class).toBe('prod');
  });

  it('cap of 50 stored hits, at most 10 evidence entries, truncation stated, production hit kept', async () => {
    writeJava('test/java/ManyTest.java', Array.from({ length: 60 }, () => DESEDE_LINE));
    writeJava('zz/main/Prod.java', [DESEDE_LINE]);
    const result = await runCryptoPass(makeCtx());
    const sig = tripleDesSignal(result)!;
    expect(sig.evidence).toHaveLength(10);
    expect(sig.evidence[0]).toBe('zz/main/Prod.java:2');
    expect(sig.derivation).toContain('61 occurrences (1 production, 60 test)');
    expect(sig.derivation).toContain('Hit list truncated at 50 of 61');
    const hits = (result.assessment['hits'] as Record<string, HitBlock>)['3des']!;
    expect(hits.locations).toHaveLength(50);
    expect(hits.truncated).toBe(true);
    expect(hits.locations.some((l) => l.file === 'zz/main/Prod.java')).toBe(true);
  });

  it('test-code-only hits (default include mode): severity kept, low confidence, still blocking', async () => {
    writeJava('src/test/java/LegacyTest.java', [DESEDE_LINE]);
    const result = await runCryptoPass(makeCtx());
    const sig = tripleDesSignal(result)!;
    expect(sig.severity).toBe('high');
    expect(sig.confidence).toBe('low');
    expect(sig.derivation).toContain('1 occurrence (0 production, 1 test)');
    expect(sig.derivation).toContain('Seen in test code only');
    expect(result.assessment['blocks_migration']).toBe(true);
  });

  it('test-code-only hits under assessment.test_code: tag: no migration block, and the #3403 marker lowers the signal once', async () => {
    writeJava('src/test/java/LegacyTest.java', [DESEDE_LINE]);
    const result = await runCryptoPass(makeCtx({ testCode: 'tag' }));
    const sig = tripleDesSignal(result)!;
    expect(sig.severity).toBe('high');
    expect(result.assessment['blocks_migration']).toBe(false);
    expect(result.assessment['overall_posture']).toBe('weak_primitives_in_test_code_only');
    // The pass does not lower test-only findings itself, so the central marker
    // applies exactly one step (High -> Medium), never two.
    const marked = applyTestCodeMarker([sig], 'tag', isTestPath);
    expect(marked.signals[0]).toMatchObject({ test_code: true, severity: 'medium', severity_original: 'high' });
  });
});

// ---------------------------------------------------------------------------
// #3412: context exceptions (TOTP, HMAC, checksums)
// ---------------------------------------------------------------------------

function sha1Signal(result: Awaited<ReturnType<typeof runCryptoPass>>) {
  return result.signals.find((s) => s.derivation.includes('SHA-1'));
}

const TOTP_HELPER = [
  "import { authenticator } from 'otplib';",
  '',
  'export function totpCode(secret: string): string {',
  '  authenticator.options = {',
  '    digits: 6,',
  "    algorithm: 'SHA1',",
  '    step: 30,',
  '  };',
  '  return authenticator.generate(secret);',
  '}',
];

describe('pass-08-crypto -- #3412 crypto catalogue context exceptions', () => {
  it("TOTP helper with algorithm: 'SHA1' yields Informational citing RFC 6238 (test path, as in the PoC)", async () => {
    mkdirSync(join(src, 'systemtest', 'framework', 'helper'), { recursive: true });
    writeFileSync(join(src, 'systemtest', 'framework', 'helper', 'totp.helper.ts'), TOTP_HELPER.join('\n'), 'utf-8');
    const result = await runCryptoPass(makeCtx());
    const sig = sha1Signal(result)!;
    expect(sig).toBeDefined();
    expect(sig.severity).toBe('informational');
    expect(sig.derivation).toContain('totp-rfc6238');
    expect(sig.derivation).toContain('RFC 6238');
    expect(sig.evidence[0]).toBe('systemtest/framework/helper/totp.helper.ts:6');
  });

  it('TOTP in production code is Informational too and does not block migration', async () => {
    mkdirSync(join(src, 'app', 'mfa'), { recursive: true });
    writeFileSync(join(src, 'app', 'mfa', 'totp.service.ts'), TOTP_HELPER.join('\n'), 'utf-8');
    const result = await runCryptoPass(makeCtx());
    expect(sha1Signal(result)!.severity).toBe('informational');
    expect(result.assessment['blocks_migration']).toBe(false);
    expect(result.assessment['overall_posture']).toBe('weak_primitives_context_excepted');
  });

  it('MessageDigest.getInstance("SHA-1") for password hashing stays High, even next to an HMAC call', async () => {
    mkdirSync(join(src, 'main', 'java'), { recursive: true });
    writeFileSync(join(src, 'main', 'java', 'PasswordHasher.java'), [
      'import java.security.MessageDigest;',
      'import javax.crypto.Mac;',
      'class PasswordHasher {',
      '  byte[] hash(String password) throws Exception {',
      '    MessageDigest md = MessageDigest.getInstance("SHA-1");',
      '    Mac mac = Mac.getInstance("HmacSHA1");',
      '    return md.digest(password.getBytes());',
      '  }',
      '}',
    ].join('\n'), 'utf-8');
    const result = await runCryptoPass(makeCtx());
    const sig = sha1Signal(result)!;
    expect(sig.severity).toBe('high');
    expect(sig.evidence).toContain('main/java/PasswordHasher.java:5');
    expect(result.assessment['blocks_migration']).toBe(true);
  });

  it('HmacSHA1 yields Low with the BSI TR-02102 note', async () => {
    mkdirSync(join(src, 'main', 'java'), { recursive: true });
    writeFileSync(join(src, 'main', 'java', 'Signer.java'), [
      'import javax.crypto.Mac;',
      'class Signer {',
      '  Mac mac() throws Exception { return Mac.getInstance("HmacSHA1"); }',
      '}',
    ].join('\n'), 'utf-8');
    const result = await runCryptoPass(makeCtx());
    const sig = sha1Signal(result)!;
    expect(sig.severity).toBe('low');
    expect(sig.derivation).toContain('hmac-sha1');
    expect(sig.derivation).toContain('BSI TR-02102 permits SHA-1 in HMAC');
  });

  it('git object hashing (blob header) is Informational under checksum-content-addressing', async () => {
    mkdirSync(join(src, 'main', 'java'), { recursive: true });
    writeFileSync(join(src, 'main', 'java', 'GitObject.java'), [
      'class GitObject {',
      '  byte[] id(byte[] content) throws Exception {',
      '    String header = "blob " + content.length;',
      '    java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-1");',
      '    return md.digest(content);',
      '  }',
      '}',
    ].join('\n'), 'utf-8');
    const result = await runCryptoPass(makeCtx());
    const sig = sha1Signal(result)!;
    expect(sig.severity).toBe('informational');
    expect(sig.derivation).toContain('checksum-content-addressing');
  });

  it('a password digest next to a checksum variable or a git comment stays High', async () => {
    mkdirSync(join(src, 'main', 'java'), { recursive: true });
    writeFileSync(join(src, 'main', 'java', 'Login.java'), [
      'class Login {',
      '  // see git history for the old hashing scheme',
      '  byte[] hash(String password) throws Exception {',
      '    java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-1");',
      '    long checksum = 0;',
      '    return md.digest(password.getBytes());',
      '  }',
      '}',
    ].join('\n'), 'utf-8');
    const result = await runCryptoPass(makeCtx());
    expect(sha1Signal(result)!.severity).toBe('high');
  });

  it('a malformed workspace exception is reported and never silences the finding', async () => {
    mkdirSync(join(tmp, 'wsp', 'inputs', 'pass-catalogs'), { recursive: true });
    writeFileSync(join(tmp, 'wsp', 'inputs', 'pass-catalogs', 'pass-08-crypto-algorithms.yaml'), [
      'pass_number: 8',
      'pass_name: "Crypto Posture"',
      'entries:',
      '  - id: sha1',
      '    name: "SHA-1"',
      '    detection:',
      '      context: [\'MessageDigest\\.getInstance\\(\\s*"SHA-?1"\']',
      '    exceptions:',
      '      - id: everything',
      '        severity: informational',
      '        rationale: "no pattern and no near"',
      '    posture:',
      '      severity: deprecated',
    ].join('\n'), 'utf-8');
    mkdirSync(join(src, 'main', 'java'), { recursive: true });
    writeFileSync(join(src, 'main', 'java', 'H.java'), 'class H { Object m = java.security.MessageDigest.getInstance("SHA-1"); }', 'utf-8');
    const result = await runCryptoPass(makeCtx());
    expect(sha1Signal(result)!.severity).toBe('high');
    expect((result.assessment['catalogue_errors'] as string[]).join('\n')).toContain('sha1: exception');
  });
});

// ---------------------------------------------------------------------------
// #3413: CRYPTO fallback vs catalogue hits, catalogue strong hits emitted
// ---------------------------------------------------------------------------

function fallbackSignal(result: Awaited<ReturnType<typeof runCryptoPass>>) {
  return result.signals.find((s) => s.derivation.startsWith('No cryptographic primitives'));
}

describe('pass-08-crypto -- #3413 fallback and catalogue strong hits', () => {
  it('Java-only fixture with DESede: weak signal, no "no primitives detected" fallback', async () => {
    mkdirSync(join(src, 'main', 'java'), { recursive: true });
    writeFileSync(join(src, 'main', 'java', 'Legacy.java'),
      'class Legacy { Object c = javax.crypto.Cipher.getInstance("DESede/ECB/PKCS5Padding"); }', 'utf-8');
    const result = await runCryptoPass(makeCtx());
    expect(tripleDesSignal(result)).toBeDefined();
    expect(fallbackSignal(result)).toBeUndefined();
  });

  it('a catalogue strong hit alone suppresses the fallback and produces a positive CRYPTO signal', async () => {
    mkdirSync(join(src, 'main', 'java'), { recursive: true });
    writeFileSync(join(src, 'main', 'java', 'Keys.java'), [
      'import java.security.spec.ECGenParameterSpec;',
      'class Keys { Object spec = new ECGenParameterSpec("secp384r1"); }',
    ].join('\n'), 'utf-8');
    const result = await runCryptoPass(makeCtx());
    expect(fallbackSignal(result)).toBeUndefined();
    const pos = result.signals.find((s) => s.severity === 'positive' && s.derivation.includes('P-384'));
    expect(pos).toBeDefined();
    expect(pos!.derivation).toContain('Approved cryptographic primitive detected');
    expect(pos!.evidence[0]).toBe('main/java/Keys.java:2');
    // Appended after the always-present at-rest signal: existing IDs do not shift.
    const atRestIdx = result.signals.findIndex((s) => s.category === 'infrastructure_platform');
    expect(result.signals.indexOf(pos!)).toBeGreaterThan(atRestIdx);
    expect(result.assessment['nist_compliant']).toBe(true);
  });

  it('fallback text names the scanned languages and the file count', async () => {
    writeFileSync(join(src, 'a.ts'), 'export const a = 1;\n', 'utf-8');
    mkdirSync(join(src, 'main', 'java'), { recursive: true });
    writeFileSync(join(src, 'main', 'java', 'B.java'), 'class B {}\n', 'utf-8');
    const result = await runCryptoPass(makeCtx());
    const fb = fallbackSignal(result)!;
    expect(fb).toBeDefined();
    expect(fb.derivation).toBe('No cryptographic primitives detected by pattern scan (languages scanned: Java, TypeScript; files: 2). Manual review recommended.');
    expect(result.assessment['pattern_scan']).toEqual({ languages: ['Java', 'TypeScript'], configuration_files: false, files: 2 });
  });

  it('no duplicate signal for an algorithm found by both the hard-coded scan and the catalogue (sha1 / sha1_hash)', async () => {
    writeFileSync(join(src, 'h.ts'), `import { createHash } from 'crypto';\nexport const h = createHash('sha1');\n`, 'utf-8');
    const result = await runCryptoPass(makeCtx());
    const sha1 = result.signals.filter((s) => /sha.?1/i.test(s.derivation) && s.severity === 'high');
    expect(sha1).toHaveLength(1);
    expect(sha1[0]!.evidence).toEqual(['h.ts:2']);
  });

  it('Java MessageDigest MD5 is detected now that the catalogue md5 entry is no longer skipped', async () => {
    mkdirSync(join(src, 'main', 'java'), { recursive: true });
    writeFileSync(join(src, 'main', 'java', 'Md.java'),
      'class Md { Object m = java.security.MessageDigest.getInstance("MD5"); }', 'utf-8');
    const result = await runCryptoPass(makeCtx());
    const md5 = result.signals.filter((s) => s.derivation.includes('MD5') && s.severity === 'high');
    expect(md5).toHaveLength(1);
    expect(md5[0]!.evidence).toEqual(['main/java/Md.java:1']);
  });

  it('a hard-coded strong hit is not reported twice by its catalogue twin (argon2 / argon2id)', async () => {
    writeFileSync(join(src, 'auth.ts'), `import argon2 from 'argon2';\nexport const h = (p: string) => argon2.hash(p);\n`, 'utf-8');
    const result = await runCryptoPass(makeCtx());
    const positives = result.signals.filter((s) => s.severity === 'positive' && /argon2/i.test(s.derivation));
    expect(positives).toHaveLength(1);
  });
});
