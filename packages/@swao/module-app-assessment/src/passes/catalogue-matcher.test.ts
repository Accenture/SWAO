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

// #3410: shared catalogue matcher (boundaries, case rules, ReDoS guard,
// data-content masking, file filter).

import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { load } from 'js-yaml';
import {
  compileTokenMatcher,
  compileRegexMatcher,
  foldCase,
  unsafeRegexReason,
  maskDataContent,
  scanLines,
  isScannableFile,
  scanCatalogueRules,
  productionFirst,
  compileExceptions,
  findException,
  occurrenceSummary,
  CatalogueDetectionSchema,
  MAX_SCAN_FILE_BYTES,
  type ScanRule,
} from './catalogue-matcher.js';

const m = (tokens: Parameters<typeof compileTokenMatcher>[0], opts?: Parameters<typeof compileTokenMatcher>[1]) => {
  const c = compileTokenMatcher(tokens, opts);
  if (!c) throw new Error('no matcher');
  return (line: string) => c.exec(line)?.text ?? null;
};

describe('#3410 token matcher: identifier boundaries', () => {
  it('does not match TDEA inside istDeaktiviert (the client substring false positive)', () => {
    const hit = m(['TDEA']);
    expect(hit('if (konto.istDeaktiviert) return;')).toBeNull();
    expect(hit('const TDEAKey = 1;')).toBeNull();
    expect(hit('algorithm TDEA here')).toBe('TDEA');
  });

  it('matches a token whose edges are punctuation without a boundary on that edge', () => {
    const hit = m(["crypto.createCipheriv('rc4'"]);
    expect(hit("x=crypto.createCipheriv('rc4', k, null)")).toBe("crypto.createCipheriv('rc4'");
    const javaHit = m(['DESede']);
    expect(javaHit('Cipher.getInstance("DESede/CBC/PKCS5Padding")')).toBe('DESede');
  });

  it('finds the longer alternative when the shorter one fails its boundary (DES vs DESede)', () => {
    const hit = m(['DES', 'DESede']);
    expect(hit('Cipher.getInstance("DESede/CBC")')).toBe('DESede');
    expect(hit('Cipher.getInstance("DES/CBC")')).toBe('DES');
  });

  it('case-insensitive by default, case-sensitive on request', () => {
    expect(m(['keycloak'])('import Keycloak from "keycloak-js"')).toBe('Keycloak');
    const cs = m([{ token: 'TDEA', case_sensitive: true }]);
    expect(cs('the tdea word')).toBeNull();
    expect(cs('the TDEA word')).toBe('TDEA');
    expect(m(['TDEA'], { caseSensitive: true })('tdea')).toBeNull();
  });

  it('substring mode keeps the pre-#3410 behaviour when explicitly requested', () => {
    expect(m([{ token: 'TDEA', match: 'substring' }])('istDeaktiviert')).toBe('tDea');
  });
});

describe('#3410 token matcher: segment boundaries', () => {
  const seg = (tok: string) => m([tok], { match: 'segment' });

  it('matches identifier parts split by underscore, dash, dot or a camelCase step', () => {
    expect(seg('kvnr')('const kvnr_hash = x;')).toBe('kvnr');
    expect(seg('kvnr')('patientKvnr: string')).toBe('Kvnr');
    expect(seg('pid')('const patientPid = 1')).toBe('Pid');
    expect(seg('keycloak')('class KeycloakService {}')).toBe('Keycloak');
    expect(seg('eric')('ELSTER_ERIC_PATH=/opt')).toBe('ERIC');
  });

  it('rejects matches inside a word', () => {
    expect(seg('pid')('const rapid = 1')).toBeNull();
    expect(seg('eric')('function generic(numeric) {}')).toBeNull();
    expect(seg('tdea')('istDeaktiviert')).toBeNull();
  });
});

describe('#3410 regex matcher', () => {
  it('case-folds without the i flag so segment boundaries still see real case', () => {
    const c = compileRegexMatcher('(kvnr|kv_nr)', { match: 'segment' });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.matcher.exec('KVNR = 1')?.text).toBe('KVNR');
    expect(c.matcher.exec('ekvnrx')).toBeNull();
  });

  it('identifier boundary on a regex end: java.version=11 does not match java.version=110', () => {
    const c = compileRegexMatcher('java.version=11', { match: 'identifier' });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.matcher.exec('java.version=11')).not.toBeNull();
    expect(c.matcher.exec('java.version=110')).toBeNull();
  });

  it('context regexes match a call form and not prose', () => {
    const c = compileRegexMatcher(`(?:algorithm|cipher)\\s*[:=]\\s*['"]?(?:3DES|TDEA)['"]?`, { match: 'identifier' });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.matcher.exec(`cipher: '3DES'`)).not.toBeNull();
    expect(c.matcher.exec('// 3DES legacy note')).toBeNull();
  });

  it('foldCase leaves escapes, group syntax and quantifiers intact', () => {
    expect(foldCase('a\\d{2,3}(?:b)')).toBe('[aA]\\d{2,3}(?:[bB])');
    expect(foldCase('[a-c_]')).toBe('[a-c_A-C]');
    expect(foldCase('(?<name>x)\\s')).toBe('(?<name>[xX])\\s');
    expect(new RegExp(foldCase('\\u00e4[^a]\\p{L}', ), 'u').test('äbZ')).toBe(true);
  });

  it('rejects ReDoS-prone and invalid patterns instead of throwing', () => {
    // Assembled at runtime: as literals, code scanning reads these deliberately
    // catastrophic patterns as live regular expressions (js/redos).
    const badPatterns = [['(a+', ')+$'], ['(\\w*', ')*x'], ['(a|ab', ')*c'], ['(x{2,}', ')+'], ['(a)', '\\1'], ['.*a.*b', '.*c.*d']].map((p) => p.join(''));
    for (const bad of badPatterns) {
      expect(unsafeRegexReason(bad), bad).not.toBeNull();
      expect(compileRegexMatcher(bad).ok, bad).toBe(false);
    }
    expect(compileRegexMatcher('(unclosed').ok).toBe(false);
    for (const good of ['BUNDID_.*', 'sourceCompatibility.*1\\.8', '(rentenversicherungsnummer|rvnr)', 'TLS_[A-Z0-9_]{0,40}_RC4_']) {
      expect(unsafeRegexReason(good), good).toBeNull();
    }
  });

  it('compiled matchers stay fast on a hostile 1,000-character line', () => {
    const c = compileRegexMatcher('ssl\\.cipher\\.suites.{0,200}RC4', { match: 'identifier' });
    const tok = compileTokenMatcher(['TDEA', 'DESede', 'TripleDES'], { match: 'segment' });
    expect(c.ok).toBe(true);
    if (!c.ok || !tok) return;
    const line = 'ssl.cipher.suites'.repeat(58).slice(0, 1000);
    const t0 = Date.now();
    for (let i = 0; i < 200; i++) { c.matcher.exec(line); tok.exec('a'.repeat(1000)); }
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('#3410 content filter', () => {
  it('blanks base64 runs (MIME-wrapped PDF line with +RC4/) and data: URIs, keeping columns', () => {
    const b64 = 'JVBERi0xLjQKJcfsj6IKNSAwIG9iago8PC9MZW5ndGggNiAwIFIvRmlsdGVy+RC4/IC9GbGF0ZURlY29kZT4+';
    const line = `    "${b64}" +`;
    const masked = maskDataContent(line);
    expect(masked).not.toContain('RC4');
    expect(masked.length).toBe(line.length);
    const uri = 'img = "data:application/pdf;base64,JVBERiRC4xyz"';
    expect(maskDataContent(uri)).not.toContain('RC4');
    expect(maskDataContent('createCipheriv("rc4", k)')).toBe('createCipheriv("rc4", k)');
  });

  it('drops minified lines over 1,000 characters but keeps line numbering', () => {
    const lines = scanLines(`a\n${'x'.repeat(1001)}\nb`);
    expect(lines).toEqual(['a', '', 'b']);
  });

  it('skips generated and oversized files', () => {
    expect(isScannableFile({ isGenerated: true, sizeBytes: 10 })).toBe(false);
    expect(isScannableFile({ isGenerated: false, sizeBytes: MAX_SCAN_FILE_BYTES + 1 })).toBe(false);
    expect(isScannableFile({ isGenerated: false, sizeBytes: 10 })).toBe(true);
  });
});

describe('#3410/#3411 scanCatalogueRules', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'swao-matcher-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('reads each file once, honours appliesTo, caps hits and counts totals', () => {
    writeFileSync(join(tmp, 'a.ts'), 'x DESede\ny DESede\n', 'utf-8');
    writeFileSync(join(tmp, 'b.yaml'), 'cipher: DESede\n', 'utf-8');
    const matcher = compileTokenMatcher(['DESede'])!;
    const rules: ScanRule<string>[] = [
      { key: '3des', matcher, via: 'token', appliesTo: (f) => f.rel.endsWith('.ts') },
    ];
    const files = [
      { abs: join(tmp, 'a.ts'), rel: 'a.ts', isTest: false, sizeBytes: 10 },
      { abs: join(tmp, 'b.yaml'), rel: 'b.yaml', isTest: true, sizeBytes: 10 },
    ];
    const r = scanCatalogueRules(files, rules, { maxHitsPerKey: 1 });
    expect(r.hits.get('3des')).toEqual([{ file: 'a.ts', line: 1, path_class: 'prod', via: 'token', match: 'DESede' }]);
    expect(r.totals.get('3des')).toBe(2);
  });

  it('#3411: a full hit list makes room for a later production hit; class totals are exact', () => {
    writeFileSync(join(tmp, 't.ts'), 'DESede\nDESede\nDESede\n', 'utf-8');
    writeFileSync(join(tmp, 'p.ts'), 'x\nDESede\n', 'utf-8');
    const rules: ScanRule<string>[] = [{ key: 'k', matcher: compileTokenMatcher(['DESede'])!, via: 'token' }];
    const files = [
      { abs: join(tmp, 't.ts'), rel: 'test/t.ts', isTest: true, sizeBytes: 10 },
      { abs: join(tmp, 'p.ts'), rel: 'p.ts', isTest: false, sizeBytes: 10 },
    ];
    const r = scanCatalogueRules(files, rules, { maxHitsPerKey: 2 });
    const stored = r.hits.get('k')!;
    expect(stored).toHaveLength(2);
    expect(productionFirst(stored)[0]).toMatchObject({ file: 'p.ts', line: 2, path_class: 'prod' });
    expect(r.totalsByClass.get('k')).toEqual({ prod: 1, test: 3, unknown: 0 });
    expect(occurrenceSummary(4, { prod: 1, test: 3, unknown: 0 }, 2)).toBe('4 occurrences (1 production, 3 test). Hit list truncated at 2 of 4.');
  });
});

describe('#3412 context exceptions', () => {
  const { exceptions, errors } = compileExceptions([
    { id: 'hmac', pattern: 'HmacSHA1', severity: 'low', rationale: 'r1' },
    { id: 'totp', pattern: 'algorithm', near: 'totp', window: 2, severity: 'informational', rationale: 'r2' },
    { id: 'bad', severity: 'low', rationale: 'neither pattern nor near' },
    { id: 'redos', pattern: '(a+)+', severity: 'low', rationale: 'unsafe' },
  ], 'sha1');

  it('validates and compiles; invalid or unsafe exceptions are reported, not thrown', () => {
    expect(exceptions.map((e) => e.id)).toEqual(['hmac', 'totp']);
    expect(errors).toHaveLength(2);
    expect(errors.join('\n')).toContain('redos');
  });

  it('pattern is anchored to the hit line; near looks within the window', () => {
    const lines = ['totp setup', 'x', "algorithm: 'SHA1'", 'y', 'z', 'Mac.getInstance("HmacSHA1")'];
    expect(findException(exceptions, lines, 2)?.id).toBe('totp');
    expect(findException(exceptions, lines, 5)?.id).toBe('hmac');
    // `HmacSHA1` on a neighbouring line does not cover a different hit line.
    expect(findException(exceptions, ['MessageDigest.getInstance("SHA-1")', 'HmacSHA1'], 0)).toBeNull();
    // totp outside the 2-line window does not cover the hit.
    expect(findException(exceptions, ['totp', 'a', 'b', "algorithm: 'SHA1'"], 3)).toBeNull();
  });
});

describe('#3410 bundled catalogues validate against the shared schema', () => {
  const dir = resolve(__dirname, '../../../../../pass-catalogs');
  const files = readdirSync(dir).filter((f) => /^pass-(08|21)-.*\.yaml$/.test(f));

  it('finds the token catalogues', () => {
    expect(files.length).toBe(2);
  });

  for (const file of files) {
    it(`${file}: every detection block parses and every context regex passes the ReDoS guard`, () => {
      const cat = load(readFileSync(join(dir, file), 'utf-8')) as { entries: Array<{ id: string; detection?: unknown }> };
      for (const e of cat.entries) {
        const r = CatalogueDetectionSchema.safeParse(e.detection ?? {});
        expect(r.success, `${file} ${e.id}`).toBe(true);
        if (!r.success) continue;
        for (const src of r.data.context) {
          expect(compileRegexMatcher(src).ok, `${e.id}: ${src}`).toBe(true);
        }
        // #3412: every bundled exception validates and compiles.
        expect(compileExceptions((e as Record<string, unknown>)['exceptions'], e.id).errors, e.id).toEqual([]);
      }
    });
  }
});
