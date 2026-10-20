// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// CodeQL js/polynomial-redos and js/double-escaping (PR #1621). Each former
// regex was replaced by a scan or a built-in with the same result. The former
// regexes are kept here as oracles only (test input is not externally
// controlled); every helper is compared with its oracle on random input and
// must stay fast on the pathological input CodeQL reported.

import { describe, it, expect } from 'vitest';
import { dotnetVersion } from './binary/pe.js';
import { idPrefix } from './catalog/infra-cat.js';
import { dropTrailingSeparators, normaliseAppId, parseIdNameCell } from './intake/column-a.js';
import { containsEmail, looksLikePersonalName } from './intake/pii.js';
import { extractJsonObject, fenceBody } from './research/llm-research.js';
import { decodeXmlEntities, parseBsiRss } from './research/feeds.js';
import { upsertServicePortfolioBlock } from './scaffold/write.js';

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

/** Deterministic random strings over `alphabet` (tokens may be longer than one character). */
function randomStrings(alphabet: readonly string[], count: number, maxLen: number, seed: number): string[] {
  let state = seed;
  const rnd = (n: number) => { state = (state * 1103515245 + 12345) % 2147483648; return state % n; };
  const out: string[] = [];
  for (let k = 0; k < count; k++) {
    let s = '';
    const len = rnd(maxLen + 1);
    for (let i = 0; i < len; i++) s += alphabet[rnd(alphabet.length)];
    out.push(s);
  }
  return out;
}

function fast(fn: () => void): void {
  const t0 = performance.now();
  fn();
  expect(performance.now() - t0).toBeLessThan(200);
}

describe('dotnetVersion (binary/pe.ts)', () => {
  const oracle = (v: string): [number, number, number] | null => {
    const m = /v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(v);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
  };

  it('parses runtime version strings', () => {
    expect(dotnetVersion('v4.7.2')).toEqual([4, 7, 2]);
    expect(dotnetVersion('v6.0')).toEqual([6, 0, 0]);
    expect(dotnetVersion('v2.0.50727')).toEqual([2, 0, 50727]);
    expect(dotnetVersion('Version 10.12.3-beta')).toEqual([10, 12, 3]);
    expect(dotnetVersion('1.2.')).toEqual([1, 2, 0]);
    expect(dotnetVersion('ä 7.1')).toEqual([7, 1, 0]);
    expect(dotnetVersion('')).toBeNull();
    expect(dotnetVersion('   ')).toBeNull();
    expect(dotnetVersion(null)).toBeNull();
    expect(dotnetVersion(undefined)).toBeNull();
    expect(dotnetVersion('v4')).toBeNull();
  });

  it('matches the former regex on random input (differential)', () => {
    for (const s of randomStrings(['0', '1', '9', '.', 'v', ' ', 'x', '\u0661'], 5000, 10, 13)) {
      expect(dotnetVersion(s), JSON.stringify(s)).toEqual(oracle(s));
    }
  });

  it('stays fast on 50 000 zeros without a dot', () => {
    fast(() => {
      expect(dotnetVersion('0'.repeat(50_000))).toBeNull();
      expect(dotnetVersion(`${'0.'.repeat(25_000)}`)).toEqual([0, 0, 0]);
    });
  });
});

describe('idPrefix (catalog/infra-cat.ts)', () => {
  const oracle = (appId: string) => ((/^[a-z_-]+/.exec(appId.toLowerCase()))?.[0] ?? '').replace(/-+$/, '');

  it('keeps leading letters and drops trailing hyphens', () => {
    expect(idPrefix('hosapp133')).toBe('hosapp');
    expect(idPrefix('crm_core01')).toBe('crm_core');
    expect(idPrefix('HOS-PACS-004')).toBe('hos-pacs');
    expect(idPrefix('---')).toBe('');
    expect(idPrefix('')).toBe('');
    expect(idPrefix('  ')).toBe('');
    expect(idPrefix('grösse')).toBe('gr');
  });

  it('matches the former regex on random input (differential)', () => {
    for (const s of randomStrings(['a', 'Z', '_', '-', '1', ' ', 'ä', '\u0130'], 5000, 10, 17)) {
      expect(idPrefix(s), JSON.stringify(s)).toBe(oracle(s));
    }
  });

  it('stays fast on 50 000 hyphens followed by a digit', () => {
    fast(() => {
      expect(idPrefix(`a${'-'.repeat(50_000)}1`)).toBe('a');
    });
  });
});

describe('normaliseAppId and trailing separators (intake/column-a.ts)', () => {
  const appIdOracle = (raw: string) => raw
    .trim()
    .toLowerCase()
    .replace(/[äöüß]/g, (ch) => ({ 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' } as Record<string, string>)[ch] ?? ch)
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  const separatorsOracle = (s: string) => s.replace(new RegExp(`[\\s,;.!:\\-${EN}${EM}]+$`), '');

  it('normaliseAppId collapses and trims hyphens', () => {
    expect(normaliseAppId('--A -- B--')).toBe('a-b');
    expect(normaliseAppId('')).toBe('');
    expect(normaliseAppId('   ')).toBe('');
    expect(normaliseAppId('---')).toBe('');
    expect(normaliseAppId('Größe')).toBe('groesse');
  });

  it('dropTrailingSeparators removes the whole trailing run only', () => {
    expect(dropTrailingSeparators(`HOSAPP1 ${EM} `)).toBe('HOSAPP1');
    expect(dropTrailingSeparators(`a, b;.!: ${EN}\t\n`)).toBe('a, b');
    expect(dropTrailingSeparators('')).toBe('');
    expect(dropTrailingSeparators(' \t ')).toBe('');
    expect(dropTrailingSeparators('über-')).toBe('über');
  });

  it('match the former regexes on random input (differential)', () => {
    for (const s of randomStrings(['-', ' ', '\t', 'A', 'z', '9', '.', ',', '!', 'ä', 'ß', EN, EM, '\u00a0', '_'], 5000, 12, 19)) {
      expect(normaliseAppId(s), JSON.stringify(s)).toBe(appIdOracle(s));
      expect(dropTrailingSeparators(s), JSON.stringify(s)).toBe(separatorsOracle(s));
    }
  });

  it('stays fast on 50 000 hyphens or tabs', () => {
    fast(() => {
      expect(normaliseAppId(`a${'-'.repeat(50_000)}b`)).toBe('a-b');
      expect(normaliseAppId(`a${'-'.repeat(50_000)}`)).toBe('a');
      expect(dropTrailingSeparators(`a${'\t'.repeat(50_000)}b`)).toBe(`a${'\t'.repeat(50_000)}b`);
      expect(parseIdNameCell(`HOSAPP1${'\t'.repeat(50_000)}x`).id).toBe('hosapp1-x');
      expect(parseIdNameCell(`HOSAPP1${'\t'.repeat(50_000)}`).id).toBe('hosapp1');
    });
  });
});

describe('containsEmail (intake/pii.ts)', () => {
  const oracle = (v: string) => /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(v);

  it('detects email-like tokens', () => {
    expect(containsEmail('max.mustermann@example.de')).toBe(true);
    expect(containsEmail('Contact: a@b.CO now')).toBe(true);
    expect(containsEmail('a@.de')).toBe(false);
    expect(containsEmail('a@b.c')).toBe(false);
    expect(containsEmail('@b.de')).toBe(false);
    expect(containsEmail('a@ b.de')).toBe(false);
    expect(containsEmail('')).toBe(false);
    expect(containsEmail('   ')).toBe(false);
    expect(containsEmail('jürgen@müller.de')).toBe(true);
    expect(containsEmail('a@b.ää')).toBe(false);
    expect(looksLikePersonalName('Support: helpdesk@vendor.com')).toBe(true);
  });

  it('matches the former regex on random input (differential)', () => {
    for (const s of randomStrings(['a', 'B', '@', '.', ' ', '\t', '!', 'ä', 'de', '@@', '\u00a0'], 8000, 10, 23)) {
      expect(containsEmail(s), JSON.stringify(s)).toBe(oracle(s));
    }
  });

  it('stays fast on 50 000 repetitions of "!" and on a long dot run after "@"', () => {
    fast(() => {
      expect(containsEmail('!'.repeat(50_000))).toBe(false);
      expect(containsEmail(`a@${'.'.repeat(50_000)}`)).toBe(false);
      expect(containsEmail('a@'.repeat(25_000))).toBe(false);
      expect(looksLikePersonalName('!'.repeat(50_000))).toBe(false);
    });
  });
});

describe('fenceBody / extractJsonObject (research/llm-research.ts)', () => {
  const oracle = (s: string) => {
    const m = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
    return m ? (m[1] as string) : null;
  };

  it('extracts fenced and unfenced objects', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('```JSON {"a":2}```')).toEqual({ a: 2 });
    expect(extractJsonObject('text {"ä":3} text')).toEqual({ 'ä': 3 });
    expect(() => extractJsonObject('')).toThrow(/no JSON object/);
    expect(() => extractJsonObject('   ')).toThrow(/no JSON object/);
  });

  it('matches the former regex on random input (differential)', () => {
    for (const s of randomStrings(['`', '```', 'json', 'JSON', ' ', '\n', '{', '}', 'x', '\u0130', '\u00a0'], 8000, 10, 29)) {
      expect(fenceBody(s), JSON.stringify(s)).toBe(oracle(s));
    }
  });

  it('stays fast on a fence followed by 50 000 spaces', () => {
    fast(() => {
      expect(fenceBody(`\`\`\`${' '.repeat(50_000)}`)).toBeNull();
      expect(() => extractJsonObject(`\`\`\`${' '.repeat(50_000)}`)).toThrow(/no JSON object/);
    });
  });
});

describe('upsertServicePortfolioBlock append path (scaffold/write.ts)', () => {
  const meta = { source: 'x.xlsx', mapping: null, imported_at: '2026-10-20', app_count: 1, row_count: 1, sheets: ['S'], headers: {}, pii_columns: [], cluster_threshold: 3 };

  it('trims trailing whitespace before appending the block', () => {
    const out = upsertServicePortfolioBlock('wsp_version: "0.9"\n \t\n\n', meta);
    expect(out.startsWith('wsp_version: "0.9"\n\nservice_portfolio:\n')).toBe(true);
    expect(upsertServicePortfolioBlock('', meta).startsWith('\n\nservice_portfolio:\n')).toBe(true);
    expect(upsertServicePortfolioBlock('   ', meta).startsWith('\n\nservice_portfolio:\n')).toBe(true);
  });

  it('trimEnd matches the former regex on random input (differential)', () => {
    for (const s of randomStrings([' ', '\t', '\n', '\r', 'a', '\u00a0', '\u3000'], 3000, 10, 31)) {
      expect(s.trimEnd(), JSON.stringify(s)).toBe(s.replace(/\s*$/, ''));
    }
  });

  it('stays fast on 50 000 spaces followed by a character', () => {
    fast(() => {
      const out = upsertServicePortfolioBlock(`a:${' '.repeat(50_000)}b`, meta);
      expect(out).toContain('service_portfolio:');
    });
  });
});

describe('decodeXmlEntities (research/feeds.ts, js/double-escaping)', () => {
  it('decodes each entity once, so an escaped entity stays literal', () => {
    expect(decodeXmlEntities('a &amp; b')).toBe('a & b');
    expect(decodeXmlEntities('&lt;tag&gt; &quot;q&quot;')).toBe('<tag> "q"');
    expect(decodeXmlEntities('&amp;lt;')).toBe('&lt;');
    expect(decodeXmlEntities('&amp;amp;')).toBe('&amp;');
    expect(decodeXmlEntities('&apos; &nbsp;')).toBe('&apos; &nbsp;');
    expect(decodeXmlEntities('')).toBe('');
  });

  it('parseBsiRss keeps an escaped entity in a title literal', () => {
    const xml = '<rss><channel><item><title>[hoch] A &amp;lt; B &amp; C</title><link>https://x/1</link></item></channel></rss>';
    expect(parseBsiRss(xml)).toEqual([{ title: '[hoch] A &lt; B & C', link: 'https://x/1', severity: 'hoch', published: null }]);
  });
});
