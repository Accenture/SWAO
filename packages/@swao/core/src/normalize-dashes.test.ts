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

// #3291 / Design 110 D-28: one normalizeDashes, owned by @swao/core.

import { describe, it, expect } from 'vitest';
import { normalizeDashes } from './normalize-dashes.js';
import { normalizeDashes as fromIndex } from './index.js';

describe('normalizeDashes (#3291)', () => {
  it('is exported from the package index', () => {
    expect(fromIndex).toBe(normalizeDashes);
  });

  it('maps an em-dash and its surrounding spaces to ", "', () => {
    expect(normalizeDashes('Lift \u2014 and shift')).toBe('Lift, and shift');
    expect(normalizeDashes('Lift\u2014shift')).toBe('Lift, shift');
    expect(normalizeDashes('Lift \t\u2014\t shift')).toBe('Lift, shift');
  });

  it('maps an en-dash to a single hyphen', () => {
    expect(normalizeDashes('2024\u20132026')).toBe('2024-2026');
  });

  it('maps a spaced ASCII double-dash separator to ", "', () => {
    expect(normalizeDashes('Rehost -- low effort')).toBe('Rehost, low effort');
  });

  it('leaves CLI flags and plain hyphens untouched', () => {
    expect(normalizeDashes('swao publish --evidence-base-url x')).toBe('swao publish --evidence-base-url x');
    expect(normalizeDashes('re-platform')).toBe('re-platform');
  });

  it('does not swallow newlines around an em-dash', () => {
    expect(normalizeDashes('a\n\u2014\nb')).toBe('a\n, \nb');
  });

  it('handles empty, blank-only, adjacent-dash and unicode input', () => {
    expect(normalizeDashes('')).toBe('');
    expect(normalizeDashes('   \t ')).toBe('   \t ');
    expect(normalizeDashes('\u2014')).toBe(', ');
    expect(normalizeDashes(' \t\u2014 \t')).toBe(', ');
    expect(normalizeDashes('a \u2014 \u2014 b')).toBe('a, , b');
    expect(normalizeDashes('a\u2014\u2014b')).toBe('a, , b');
    expect(normalizeDashes('Gr\u00f6\u00dfe \u2014 \u00fcbersicht')).toBe('Gr\u00f6\u00dfe, \u00fcbersicht');
  });

  // CodeQL js/polynomial-redos: the former `[ \t]*\u2014[ \t]*` pattern was
  // quadratic on long blank runs without a dash. It is kept here as an oracle
  // only (test input is not externally controlled).
  it('matches the former regex on random input (differential)', () => {
    const oracle = (s: string) => s.replace(/[ \t]*\u2014[ \t]*/g, ', ').replace(/\u2013/g, '-').replace(/ -- /g, ', ');
    const alphabet = [' ', '\t', '\n', '\u2014', '\u2013', '-', 'a', '\u00e4'];
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let k = 0; k < 3000; k++) {
      let s = '';
      const len = rnd(16);
      for (let i = 0; i < len; i++) s += alphabet[rnd(alphabet.length)];
      expect(normalizeDashes(s), JSON.stringify(s)).toBe(oracle(s));
    }
  });

  it('stays fast on 50 000 blanks without a dash and around a dash', () => {
    const blanks = ' \t'.repeat(25_000);
    let t0 = performance.now();
    expect(normalizeDashes(`${blanks}x`)).toBe(`${blanks}x`);
    expect(performance.now() - t0).toBeLessThan(200);
    t0 = performance.now();
    expect(normalizeDashes(`a${blanks}\u2014${blanks}b`)).toBe('a, b');
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
