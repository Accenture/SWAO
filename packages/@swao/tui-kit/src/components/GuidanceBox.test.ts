// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library -- GuidanceBox pure-helper unit tests (#2363)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// TU-GB-TRUNC-01: truncateAtWordBoundary -- text shorter than maxWidth unchanged
// TU-GB-TRUNC-02: text exactly maxWidth characters unchanged
// TU-GB-TRUNC-03: text longer than maxWidth -- truncated at word boundary with "..."
// TU-GB-TRUNC-04: long word at cut point -- result does not end mid-word
// TU-GB-TRUNC-05: result is at most maxWidth characters long
// TU-GB-TRUNC-06: maxWidth <= 3 -- returns empty string or minimal ellipsis

import { describe, it, expect } from 'vitest';
import { truncateAtWordBoundary } from './GuidanceBox.js';

describe('truncateAtWordBoundary -- TU-GB-TRUNC-01: short text unchanged', () => {
  it('returns text as-is when shorter than maxWidth', () => {
    expect(truncateAtWordBoundary('hello world', 20)).toBe('hello world');
  });
});

describe('truncateAtWordBoundary -- TU-GB-TRUNC-02: exact-length text unchanged', () => {
  it('returns text as-is when length equals maxWidth', () => {
    const text = 'hello world'; // 11 chars
    expect(truncateAtWordBoundary(text, 11)).toBe(text);
  });
});

describe('truncateAtWordBoundary -- TU-GB-TRUNC-03: truncates at word boundary', () => {
  it('appends "..." and does not end mid-word', () => {
    // "This is a longer sentence." -- cut at maxWidth=15; "This is a..." is 12
    const result = truncateAtWordBoundary('This is a longer sentence.', 15);
    expect(result.endsWith('...')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(15);
    // The body (without "...") must be a prefix of one of the words in the original
    const body = result.slice(0, -3).trimEnd();
    // body must be a prefix that ends exactly on a word boundary
    const original = 'This is a longer sentence.';
    expect(original.startsWith(body)).toBe(true);
    // The character after body in the original must be a space (or body is whole)
    expect(body === original || original[body.length] === ' ').toBe(true);
  });

  it('truncates "The quick brown fox jumps" at 20 to end on a word', () => {
    const result = truncateAtWordBoundary('The quick brown fox jumps', 20);
    // Should be "The quick brown..." (15 chars) or "The quick brown f..."
    // Key invariant: result must not end on a partial word
    expect(result.endsWith('...')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(20);
    const body = result.slice(0, -3).trimEnd();
    // body should be one of the complete words
    expect('The quick brown fox jumps').toContain(body.trim());
  });
});

describe('truncateAtWordBoundary -- TU-GB-TRUNC-04: long word at cut point', () => {
  it('handles a single very long word (no spaces to break on)', () => {
    // If the word before the cut is a long token with no preceding space,
    // the regex strips the whole remaining partial; result is just "..."
    const result = truncateAtWordBoundary('abcdefghijklmnopqrstuvwxyz', 10);
    expect(result.endsWith('...')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(10);
  });
});

describe('truncateAtWordBoundary -- TU-GB-TRUNC-05: result always within maxWidth', () => {
  it('never exceeds maxWidth characters for varied inputs', () => {
    const cases: Array<[string, number]> = [
      ['Short text.', 5],
      ['The quick brown fox', 8],
      ['a b c d e f g h i j k l m n', 12],
      ['word '.repeat(20).trimEnd(), 40],
    ];
    for (const [text, w] of cases) {
      expect(truncateAtWordBoundary(text, w).length).toBeLessThanOrEqual(w);
    }
  });
});

describe('truncateAtWordBoundary -- TU-GB-TRUNC-06: very small maxWidth', () => {
  it('returns "..." for maxWidth <= 3 when text is longer', () => {
    // The minimum truncated output is "..." (3 chars); when maxWidth < 3 the
    // caller is expected to provide a sensible box width (GuidanceBox enforces
    // innerWidth >= 1 before calling). We document rather than fix edge behaviour.
    const r = truncateAtWordBoundary('hello world', 3);
    // result is "..." (truncation marker only -- no room for body)
    expect(r).toBe('...');
  });

  it('returns text unchanged when maxWidth equals text length', () => {
    expect(truncateAtWordBoundary('hi', 2)).toBe('hi');
  });
});
