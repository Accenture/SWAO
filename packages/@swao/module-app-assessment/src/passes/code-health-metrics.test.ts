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

// #3405: deterministic code metrics and score formulas (Design 117 sections 4 to 6).

import { describe, it, expect } from 'vitest';
import {
  CODE_LANGUAGES,
  stripCode,
  measureFile,
  detectDuplication,
  fileComponents,
  fileScore,
  appKpis,
  parseCodeOwners,
  ownerOf,
} from './code-health-metrics.js';

const JAVA = CODE_LANGUAGES['.java']!;
const PY = CODE_LANGUAGES['.py']!;

describe('stripCode', () => {
  it('keeps code that contains // inside a string and drops the trailing comment', () => {
    const [l] = stripCode(['String u = "http://a.b/c"; // note'], 'c', false);
    expect(l!.code).toBe('String u = ""; ');
    expect(l!.hadComment).toBe(true);
  });

  it('carries block comments across lines', () => {
    const out = stripCode(['int a; /* start', 'if (x) {}', 'end */ int b;'], 'c', false);
    expect(out.map((o) => o.code.trim())).toEqual(['int a;', '', 'int b;']);
  });

  it('blanks Python docstrings and # comments', () => {
    const out = stripCode(['"""doc if', 'for x"""', 'x = 1  # if'], 'hash', true);
    expect(out.map((o) => o.code.trim())).toEqual(['"""', '"""', 'x = 1']);
  });
});

describe('measureFile', () => {
  it('counts NLOC, decision points, nesting and markers', () => {
    const src = [
      'class A {',
      '  // TODO tidy',
      '  int f(int x) {',
      '    if (x > 0 && x < 9) {',
      '      while (x-- > 0) { log("if || for"); }',
      '    }',
      '    return x;',
      '  }',
      '}',
      '',
    ].join('\n');
    const m = measureFile(src, JAVA);
    expect(m.nloc).toBe(8);
    expect(m.decisionPoints).toBe(3); // if, &&, while (string content ignored)
    expect(m.maxNesting).toBe(3); // method, if, while inside the class body
    expect(m.maxNestingLine).toBe(5);
    expect(m.markers).toBe(1);
    expect(m.firstMarkerLine).toBe(2);
  });

  it('uses indentation depth for Python', () => {
    const m = measureFile('def f(x):\n    if x:\n        for i in x:\n            print(i)\n', PY);
    expect(m.maxNesting).toBe(3);
    expect(m.decisionPoints).toBe(2);
  });

  it('a marker word in code (not a comment) is not counted', () => {
    expect(measureFile('String TODO = "x";', JAVA).markers).toBe(0);
  });
});

describe('detectDuplication', () => {
  const lines = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ line: i + 1, text: `${prefix} statement number ${i};` }));
  it('marks a shared 6-line window in both files', () => {
    const r = detectDuplication([
      { rel: 'a.ts', significant: lines(6, 'same') },
      { rel: 'b.ts', significant: lines(6, 'same') },
      { rel: 'c.ts', significant: lines(6, 'other') },
    ]);
    expect(r.duplicatedLines.get('a.ts')).toBe(6);
    expect(r.duplicatedLines.get('b.ts')).toBe(6);
    expect(r.duplicatedLines.has('c.ts')).toBe(false);
    expect(r.cloneGroups).toBe(1);
  });
  it('five shared lines are below the window', () => {
    const r = detectDuplication([{ rel: 'a', significant: lines(5, 's') }, { rel: 'b', significant: lines(5, 's') }]);
    expect(r.cloneGroups).toBe(0);
  });
});

describe('score formulas (Design 117 section 5)', () => {
  it('file components and composite score', () => {
    const c = fileComponents({ nloc: 600, decisionPoints: 75, maxNesting: 2, duplicatedLines: 60, ips: 1, urls: 1, markers: 2 });
    expect(c).toEqual({ complexity: 50, size: 50, duplication: 10, endpoints: 30, markers: 20 });
    // 0.30*50 + 0.25*50 + 0.20*10 + 0.15*30 + 0.10*20 = 15 + 12.5 + 2 + 4.5 + 2 = 36
    expect(fileScore(c)).toBe(36);
  });

  it('nesting drives complexity when deeper than 3', () => {
    expect(fileComponents({ nloc: 10, decisionPoints: 0, maxNesting: 8, duplicatedLines: 0, ips: 0, urls: 0, markers: 0 }).complexity).toBe(100);
  });

  it('app KPIs', () => {
    const k = appKpis({ nloc: 10_000, decisionPoints: 2000, duplicatedLines: 500, ips: 5, urls: 20, markers: 30, hotspotNloc: 2000 })!;
    // density 20 -> 100 - (20-15)*4 = 80; maintainability 100 - 20 - min(20, 3*2) = 74;
    // duplication 100 - 5*2 = 90; hygiene 100 - 10*(20+10)/10 = 70; overall (80+74+90+70)/4 = 78.5 -> 79
    expect(k).toEqual({ complexity: 80, maintainability: 74, duplication: 90, configuration_hygiene: 70, overall: 79 });
  });

  it('no production code -> null KPIs', () => {
    expect(appKpis({ nloc: 0, decisionPoints: 0, duplicatedLines: 0, ips: 0, urls: 0, markers: 0, hotspotNloc: 0 })).toBeNull();
  });
});

describe('CODEOWNERS owner formula', () => {
  const rules = parseCodeOwners([
    '# comment',
    '*            @org/all',
    '*.yml        @org/ops',
    '/src/legacy/ @org/legacy @alice',
    'docs/**/*.md @org/docs',
    '/vendor/',
  ].join('\n'));
  it.each([
    ['src/app/Main.java', '@org/all'],
    ['helm/values.yml', '@org/ops'],
    ['src/legacy/Old.java', '@org/legacy @alice'],
    ['src/legacy/deep/config.yml', '@org/legacy @alice'],
    ['docs/a/b/readme.md', '@org/docs'],
    ['vendor/lib.js', null],
  ])('%s -> %s', (rel, owner) => {
    expect(ownerOf(rel, rules)).toBe(owner);
  });
  it('no rules -> null', () => {
    expect(ownerOf('a.ts', [])).toBeNull();
  });
});
