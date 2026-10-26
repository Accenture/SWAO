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

// #3423: the coverage matrix is derived from the passes' own scan lists.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CANONICAL_DEFAULT_PASS_KEYS, languagesForExtensions, ecosystemLanguages, type LanguageCensus } from '@swao/core';
import { passLanguageRules, buildLanguageCoverage, coverageLevel, LANGUAGE_COVERAGE_WARNING_SHARE } from './language-coverage.js';
import { PII_SCAN_EXTENSIONS, DATA_LLM_SOURCE_EXTENSIONS } from './pass-03-data.js';
import { SBOM_OSV_ECOSYSTEMS } from './pass-05-sbom.js';
import { EGR_SOURCE_SCAN_EXTENSIONS } from './pass-07-egr.js';
import { CRYPTO_CATALOGUE_SCAN_EXTENSIONS, CRYPTO_PRIMITIVE_SCAN_EXTENSIONS } from './pass-08-crypto.js';
import { CODE_LANGUAGES } from './code-health-metrics.js';

function census(rows: Array<[LanguageCensus['languages'][number]['language'], number, number]>): LanguageCensus {
  return {
    method: 'non_blank_lines', total_files: rows.length, total_loc: rows.reduce((s, r) => s + r[1], 0),
    total_loc_test: rows.reduce((s, r) => s + r[2], 0), files_generated_excluded: 0, files_too_large: 0,
    languages: rows.map(([language, loc, locTest]) => ({ language, extensions: [], files: 1, loc, files_test: locTest > 0 ? 1 : 0, loc_test: locTest })),
    manifests: [], manifests_total: 0,
  };
}

const rule = (key: string) => {
  const r = passLanguageRules().find((x) => x.key === key);
  if (!r) throw new Error(`no rule ${key}`);
  return r;
};

describe('#3423 pass language rules', () => {
  it('columns are default-profile passes in profile order (dynamic and scope excluded)', () => {
    const keys = passLanguageRules().map((r) => r.key);
    expect(keys.every((k) => CANONICAL_DEFAULT_PASS_KEYS.includes(k))).toBe(true);
    // ctx, comp, synth and blocks reason over signals and inputs, not source files: no column.
    expect(keys).toEqual(['inv', 'state', 'data', 'sbom', 'tf', 'egr', 'crypto', 'quality', 'secrets']);
    expect(keys).toEqual(CANONICAL_DEFAULT_PASS_KEYS.filter((k) => keys.includes(k)));
  });

  it('deterministic cells follow the exported scan lists, not a hand list', () => {
    expect([...rule('egr').languages].sort()).toEqual([...languagesForExtensions(EGR_SOURCE_SCAN_EXTENSIONS)].sort());
    expect([...rule('data').languages].sort()).toEqual([...languagesForExtensions(PII_SCAN_EXTENSIONS)].sort());
    expect([...(rule('data').llmLanguages ?? [])].sort()).toEqual([...languagesForExtensions(DATA_LLM_SOURCE_EXTENSIONS)].sort());
    const crypto = new Set([...languagesForExtensions(CRYPTO_PRIMITIVE_SCAN_EXTENSIONS), ...languagesForExtensions(CRYPTO_CATALOGUE_SCAN_EXTENSIONS)]);
    expect([...rule('crypto').languages].sort()).toEqual([...crypto].sort());
    const sbom = new Set(SBOM_OSV_ECOSYSTEMS.flatMap((e) => ecosystemLanguages(e)));
    expect([...rule('sbom').languages].sort()).toEqual([...sbom].sort());
    // #3405: Pass 26 column follows CODE_LANGUAGES and never counts as sovereignty code analysis.
    expect([...rule('quality').languages].sort()).toEqual([...languagesForExtensions(Object.keys(CODE_LANGUAGES))].sort());
    expect(rule('quality').codeAnalysis).toBe(false);
  });

  it('today: egress and state cover Java (#3422), crypto reaches Java via the catalogue, shell has no code analysis', () => {
    expect(coverageLevel(rule('egr'), 'Java')).toBe('deterministic');
    expect(coverageLevel(rule('egr'), 'Kotlin')).toBe('deterministic');
    expect(coverageLevel(rule('state'), 'Java')).toBe('deterministic');
    expect(coverageLevel(rule('egr'), 'Python')).toBe('none');
    expect(coverageLevel(rule('egr'), 'TypeScript')).toBe('deterministic');
    expect(coverageLevel(rule('crypto'), 'Java')).toBe('deterministic');
    expect(coverageLevel(rule('data'), 'Shell')).toBe('none');
    expect(coverageLevel(rule('data'), 'Ruby')).toBe('llm');
    expect(coverageLevel(rule('secrets'), 'Shell')).toBe('deterministic');
    expect(coverageLevel(rule('inv'), 'Java')).toBe('deterministic');
    expect(coverageLevel(rule('inv'), 'Shell')).toBe('none');
  });
});

describe('#3423 SBOM ecosystem list stays tied to the OSV queries', () => {
  it('every ecosystem literal queried in pass-05-sbom.ts is listed in SBOM_OSV_ECOSYSTEMS', () => {
    const src = readFileSync(fileURLToPath(new URL('./pass-05-sbom.ts', import.meta.url)), 'utf-8');
    const queried = [...src.matchAll(/ecosystem:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(queried.length).toBeGreaterThan(0);
    for (const eco of queried) expect(SBOM_OSV_ECOSYSTEMS as readonly string[]).toContain(eco);
  });
});

describe('#3423 buildLanguageCoverage', () => {
  it('weights by production LOC: test-heavy TypeScript does not outweigh production Java', () => {
    const c = buildLanguageCoverage(census([['TypeScript', 500, 480], ['Java', 300, 20]]));
    expect(c.dominant_language).toBe('Java');
    expect(c.rows.find((r) => r.language === 'Java')).toMatchObject({ loc_production: 280, has_deterministic: true });
    expect(c.warning).toBe(false);
  });

  it('warns above the threshold share of uncovered production LOC', () => {
    const c = buildLanguageCoverage(census([['Shell', 60, 0], ['Java', 40, 0]]));
    expect(c.uncovered_loc_share).toBe(0.6);
    expect(c.warning_threshold).toBe(LANGUAGE_COVERAGE_WARNING_SHARE);
    expect(c.warning).toBe(true);
    const exactlyHalf = buildLanguageCoverage(census([['Shell', 50, 0], ['Java', 50, 0]]));
    expect(exactlyHalf.warning).toBe(false);
  });

  it('every row has a cell for every column and an empty census yields no rows', () => {
    const c = buildLanguageCoverage(census([['COBOL', 10, 0]]));
    expect(Object.keys(c.rows[0]?.cells ?? {})).toEqual(c.passes.map((p) => p.key));
    const empty = buildLanguageCoverage(census([]));
    expect(empty).toMatchObject({ rows: [], dominant_language: null, uncovered_loc_share: 0, warning: false });
  });
});
