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

// #3423: language census and recursive build-manifest detection (synthetic fixtures only).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  computeLanguageCensus,
  detectBuildManifests,
  buildManifestKind,
  countNonBlankLines,
  languagesForExtensions,
  manifestKindInfo,
  BUILD_MANIFEST_KINDS,
  LanguageCensusSchema,
  ecosystemLanguages,
  PACKAGE_ECOSYSTEMS,
} from './language-census.js';

let root: string;

function put(rel: string, content: string): void {
  const abs = join(root, ...rel.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf-8');
}

function lines(n: number, prefix = 'x'): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i};`).join('\n') + '\n';
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'swao-3423-census-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('#3423 countNonBlankLines', () => {
  it('counts non-blank lines across LF, CRLF and CR', () => {
    expect(countNonBlankLines('a\n\n  \nb\r\nc\rd\n')).toBe(4);
    expect(countNonBlankLines('')).toBe(0);
  });
});

describe('#3423 detectBuildManifests', () => {
  it('finds a nested service/pom.xml next to a test-only systemtest/package.json (FS/EZ layout)', () => {
    put('README.md', '# app');
    put('service/pom.xml', '<project/>');
    put('service/src/main/java/a/App.java', 'class App {}\n');
    put('systemtest/package.json', '{}');
    const m = detectBuildManifests(root);
    expect(m.map((x) => x.path)).toEqual(expect.arrayContaining(['service/pom.xml', 'systemtest/package.json']));
    const pom = m.find((x) => x.path === 'service/pom.xml');
    expect(pom).toMatchObject({ kind: 'maven', ecosystem: 'Maven', depth: 1, is_test: false });
    expect(m.find((x) => x.path === 'systemtest/package.json')?.is_test).toBe(true);
  });

  it('finds manifests three levels deep and never inside node_modules or target', () => {
    put('a/b/c/build.gradle.kts', '');
    put('a/b/c/x/go.mod', 'module x\n');
    put('node_modules/dep/package.json', '{}');
    put('target/classes/pom.xml', '<project/>');
    const paths = detectBuildManifests(root).map((x) => x.path);
    expect(paths).toContain('a/b/c/build.gradle.kts');
    expect(paths).toContain('a/b/c/x/go.mod');
    expect(paths.some((p) => p.startsWith('node_modules/') || p.startsWith('target/'))).toBe(false);
  });

  it('orders shallowest first and honours maxDepth', () => {
    put('deep/er/pom.xml', '');
    put('pom.xml', '');
    expect(detectBuildManifests(root).map((x) => x.path)).toEqual(['pom.xml', 'deep/er/pom.xml']);
    expect(detectBuildManifests(root, { maxDepth: 0 }).map((x) => x.path)).toEqual(['pom.xml']);
  });

  it('recognises every documented manifest name', () => {
    const cases: Array<[string, string]> = [
      ['pom.xml', 'maven'], ['build.gradle', 'gradle'], ['build.gradle.kts', 'gradle'], ['build.sbt', 'sbt'],
      ['package.json', 'npm'], ['pyproject.toml', 'python'], ['requirements.txt', 'python'],
      ['requirements-dev.txt', 'python'], ['setup.py', 'python'], ['Pipfile', 'python'], ['go.mod', 'go'],
      ['Api.csproj', 'dotnet'], ['App.sln', 'dotnet'], ['Cargo.toml', 'cargo'], ['Gemfile', 'bundler'],
      ['composer.json', 'composer'],
    ];
    for (const [name, kind] of cases) expect(buildManifestKind(name)).toBe(kind);
    expect(buildManifestKind('README.md')).toBeNull();
    expect(buildManifestKind('requirements.md')).toBeNull();
  });

  it('every manifest kind maps to an ecosystem with at least one language', () => {
    for (const k of BUILD_MANIFEST_KINDS) expect(manifestKindInfo(k).languages.length).toBeGreaterThan(0);
    for (const e of PACKAGE_ECOSYSTEMS) expect(ecosystemLanguages(e).length).toBeGreaterThan(0);
  });
});

describe('#3423 computeLanguageCensus', () => {
  it('counts files and non-blank LOC per language, production vs test, excluding generated files', () => {
    put('service/pom.xml', '<project/>');
    put('service/src/main/java/a/App.java', lines(10) + '\n\n');           // 10 prod
    put('service/src/main/java/a/Repo.java', lines(5));                    // 5 prod
    put('service/src/test/java/a/AppTest.java', lines(4));                 // 4 test
    put('systemtest/specs/login.ts', lines(7));                            // 7 test (systemtest segment)
    put('web/app.js', lines(3));                                           // 3 prod
    put('web/app.min.js', lines(500));                                     // generated: excluded
    put('scripts/deploy.ksh', lines(2));                                   // 2 prod, Shell
    put('docs/readme.md', lines(100));                                     // not a language
    const c = computeLanguageCensus(root);
    expect(LanguageCensusSchema.safeParse(c).success).toBe(true);
    const by = Object.fromEntries(c.languages.map((r) => [r.language, r]));
    expect(by['Java']).toMatchObject({ files: 3, loc: 19, files_test: 1, loc_test: 4, extensions: ['.java'] });
    expect(by['TypeScript']).toMatchObject({ files: 1, loc: 7, files_test: 1, loc_test: 7 });
    expect(by['JavaScript']).toMatchObject({ files: 1, loc: 3, files_test: 0 });
    expect(by['Shell']).toMatchObject({ files: 1, loc: 2, extensions: ['.ksh'] });
    expect(c.total_loc).toBe(31);
    expect(c.total_loc_test).toBe(11);
    expect(c.files_generated_excluded).toBe(1);
    expect(c.languages[0]?.language).toBe('Java');
    expect(c.manifests.map((m) => m.path)).toEqual(['service/pom.xml']);
    expect(c.manifests_total).toBe(1);
  });

  it('skips files above the size cap and counts them', () => {
    put('big.sql', lines(50));
    put('small.sql', lines(2));
    const c = computeLanguageCensus(root, { maxFileBytes: 100 });
    expect(c.files_too_large).toBe(1);
    expect(c.languages).toEqual([expect.objectContaining({ language: 'SQL', files: 1, loc: 2 })]);
  });

  it('returns an empty census for an empty tree', () => {
    const c = computeLanguageCensus(root);
    expect(c).toMatchObject({ total_files: 0, total_loc: 0, languages: [], manifests: [], manifests_total: 0 });
  });
});

describe('#3423 languagesForExtensions', () => {
  it('maps scanned extensions to languages and ignores non-code extensions', () => {
    expect([...languagesForExtensions(['.ts', '.mjs', '.java', '.yaml'])].sort()).toEqual(['Java', 'JavaScript', 'TypeScript']);
  });
});
