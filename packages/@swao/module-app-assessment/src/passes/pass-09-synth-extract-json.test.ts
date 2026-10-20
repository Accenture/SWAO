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

// CodeQL js/polynomial-redos (PR #1621): the fence regex in extractJsonObject
// was replaced by a linear scan. The former regex is kept below as an oracle
// only (test input is not externally controlled).

import { describe, it, expect } from 'vitest';
import { extractJsonObject, firstFenceBody } from './pass-09-synth.js';

const FENCE_RE = /```(?:json)?\s*\n([\s\S]*?)\n```/;
const oracle = (s: string): string | null => {
  const m = s.match(FENCE_RE);
  return m ? (m[1] as string) : null;
};

describe('firstFenceBody / extractJsonObject (pass-09)', () => {
  it('extracts a fenced JSON object', () => {
    expect(extractJsonObject('Here:\n```json\n{"a":1}\n```\nthanks')).toEqual({ a: 1 });
    expect(extractJsonObject('```\n{"b":[1,2]}\n```')).toEqual({ b: [1, 2] });
  });

  it('falls back to the whole answer without a fence', () => {
    expect(extractJsonObject('prose {"c":true} prose')).toEqual({ c: true });
    expect(extractJsonObject('')).toBeNull();
    expect(extractJsonObject('   \n\t ')).toBeNull();
  });

  it('skips an inline fence and uses the later block', () => {
    const raw = 'Use ```inline``` then\n```json\n{"d":"äöü"}\n```';
    expect(firstFenceBody(raw)).toBe('{"d":"äöü"}');
    expect(extractJsonObject(raw)).toEqual({ d: 'äöü' });
  });

  it('matches the former regex on edge cases', () => {
    for (const s of [
      '```\n```', '```\n\n```', '```json\n```', '```\n \n```x', '````\n{}\n```',
      '```json \n {"x":1}\n```', '```JSON\n{}\n```', '```\n{}', '```', '\n```\n',
    ]) {
      expect(firstFenceBody(s), JSON.stringify(s)).toBe(oracle(s));
    }
  });

  it('matches the former regex on random input (differential)', () => {
    const alphabet = ['`', '```', '\n', ' ', '\t', 'json', '{', '}', 'a', '\n```'];
    let seed = 11;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let k = 0; k < 5000; k++) {
      let s = '';
      const len = rnd(12);
      for (let i = 0; i < len; i++) s += alphabet[rnd(alphabet.length)];
      expect(firstFenceBody(s), JSON.stringify(s)).toBe(oracle(s));
    }
  });

  it('stays fast on a fence followed by 50 000 newline-space pairs', () => {
    const raw = `\`\`\`\n${'\n '.repeat(50_000)}`;
    const t0 = performance.now();
    expect(firstFenceBody(raw)).toBeNull();
    expect(extractJsonObject(raw)).toBeNull();
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('stays fast on 50 000 unclosed fences', () => {
    const raw = '```\n'.repeat(50_000);
    const t0 = performance.now();
    // The third fence closes the first; the second one is the body.
    expect(firstFenceBody(raw)).toBe('```');
    expect(firstFenceBody(`\`\`\`x${'```  '.repeat(50_000)}`)).toBeNull();
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
