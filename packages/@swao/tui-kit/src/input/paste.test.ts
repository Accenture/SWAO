// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4379: pasted text in a single-line input (Design 126 section 7.11).

import { describe, it, expect } from 'vitest';
import { appendPastedText, hasPasteMarker, sanitisePastedText } from './paste.js';

describe('sanitisePastedText (#4379)', () => {
  it('keeps plain text unchanged', () => {
    expect(sanitisePastedText('Which apps need a landing zone?')).toBe('Which apps need a landing zone?');
  });

  it('turns CR, LF, CR LF and tab into one space each', () => {
    expect(sanitisePastedText('one\r\ntwo\nthree\rfour\tfive')).toBe('one two three four five');
  });

  it('removes other control characters (C0, DEL, C1)', () => {
    expect(sanitisePastedText(`a${String.fromCharCode(0)}b${String.fromCharCode(7)}c${String.fromCharCode(0x7f)}d${String.fromCharCode(0x85)}e`)).toBe('abcde');
  });

  it('removes bracketed paste markers, with and without the leading ESC', () => {
    expect(sanitisePastedText('\u001b[200~hello\u001b[201~')).toBe('hello');
    expect(sanitisePastedText('[200~hello\u001b[201~')).toBe('hello');
    expect(hasPasteMarker('[200~x')).toBe(true);
    expect(hasPasteMarker('x')).toBe(false);
  });

  it('keeps non-ASCII letters', () => {
    expect(sanitisePastedText('Größe über Maß')).toBe('Größe über Maß');
  });
});

describe('appendPastedText (#4379)', () => {
  it('appends within the limit', () => {
    expect(appendPastedText('ab', 'c\nd', 10)).toEqual({ value: 'abc d', truncated: false });
  });

  it('cuts at the limit and says so', () => {
    expect(appendPastedText('ab', 'cdefgh', 5)).toEqual({ value: 'abcde', truncated: true });
  });

  it('a full input takes nothing more', () => {
    expect(appendPastedText('abcde', 'f', 5)).toEqual({ value: 'abcde', truncated: true });
  });

  it('never cuts inside a surrogate pair', () => {
    const r = appendPastedText('', 'ab\u{1D400}c', 3);
    expect(r).toEqual({ value: 'ab', truncated: true });
  });
});

describe('sanitisePastedText for a secret field (#4379)', () => {
  it('drops line breaks instead of turning them into spaces', () => {
    expect(sanitisePastedText('s3cret\r\n', { lineBreaks: 'drop' })).toBe('s3cret');
    expect(sanitisePastedText('ab\ncd', { lineBreaks: 'drop' })).toBe('abcd');
  });
});
