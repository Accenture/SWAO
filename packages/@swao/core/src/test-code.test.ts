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

// #3403: configurable test-code handling (setting, rules, evidence classifier,
// signal marker). Synthetic fixtures only.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { load } from 'js-yaml';
import {
  resolveTestCodeSetting,
  scopeTestCodeMode,
  globToRegExp,
  mavenTestFolders,
  gradleTestFolders,
  vitestIncludeGlobs,
  jestTestMatchGlobs,
  testRulesFromBuildFile,
  evidencePaths,
  classifyEvidenceOrigin,
  applyTestCodeMarker,
  lowerSeverity,
  stripDelimited,
  stripLineSuffix,
} from './test-code.js';
import { SwaoYmlSchema } from './swao-yml.js';
import { PassFileSchema } from './wsp-pass.js';
import {
  SourceScope,
  beginSourceScopeRun,
  endSourceScopeRun,
  getSourceScope,
  isTestPath,
  listSourceFiles,
} from './source-scope.js';

describe('.swao.yml schema (#3403)', () => {
  it('accepts assessment.exclude_test_code and the extended test_code block', () => {
    expect(SwaoYmlSchema.safeParse(load('assessment:\n  exclude_test_code: true\n')).success).toBe(true);
    const ext = SwaoYmlSchema.safeParse(load(
      'assessment:\n  test_code:\n    mode: tag\n    extra_patterns: ["systemtest/**"]\n    keep_patterns: ["src/mock/api/**"]\n',
    ));
    expect(ext.success).toBe(true);
    if (ext.success) expect(ext.data.assessment?.test_code?.mode).toBe('tag');
  });

  it('rejects an unknown mode and a contradictory pair', () => {
    expect(SwaoYmlSchema.safeParse(load('assessment:\n  test_code:\n    mode: skip\n')).success).toBe(false);
    const bad = SwaoYmlSchema.safeParse(load('assessment:\n  exclude_test_code: true\n  test_code:\n    mode: include\n'));
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toContain('contradicts');
    // A consistent pair is fine.
    expect(SwaoYmlSchema.safeParse(load('assessment:\n  exclude_test_code: true\n  test_code:\n    mode: exclude\n')).success).toBe(true);
  });
});

describe('resolveTestCodeSetting (#3403)', () => {
  it('defaults to include when nothing is set', () => {
    expect(resolveTestCodeSetting(undefined, undefined)).toEqual({ mode: 'include', extraPatterns: [], keepPatterns: [], source: 'default' });
    expect(resolveTestCodeSetting({ type: 'application' }, {})).toMatchObject({ mode: 'include', source: 'default' });
  });

  it('maps the boolean and lets test_code.mode win', () => {
    expect(resolveTestCodeSetting({ exclude_test_code: true }).mode).toBe('exclude');
    expect(resolveTestCodeSetting({ exclude_test_code: false }).mode).toBe('include');
    expect(resolveTestCodeSetting({ exclude_test_code: false, test_code: { mode: 'tag' } }).mode).toBe('tag');
  });

  it('app file wins over workspace file; workspace is the fallback', () => {
    expect(resolveTestCodeSetting({ exclude_test_code: false }, { exclude_test_code: true })).toMatchObject({ mode: 'include', source: 'app' });
    expect(resolveTestCodeSetting({}, { test_code: { mode: 'exclude', extra_patterns: ['qa/**'] } }))
      .toEqual({ mode: 'exclude', extraPatterns: ['qa/**'], keepPatterns: [], source: 'workspace' });
  });

  it('tag lists like include at the scope level', () => {
    expect(scopeTestCodeMode('include')).toBe('include');
    expect(scopeTestCodeMode('tag')).toBe('include');
    expect(scopeTestCodeMode('exclude')).toBe('exclude');
  });
});

describe('globToRegExp (#3403)', () => {
  it('supports **, *, ? and braces', () => {
    expect(globToRegExp('systemtest/**')!.test('systemtest/framework/helper.ts')).toBe(true);
    expect(globToRegExp('systemtest/**')!.test('ui/systemtest/a.ts')).toBe(false);
    expect(globToRegExp('**/e2e/**')!.test('apps/web/e2e/login.ts')).toBe(true);
    expect(globToRegExp('**/e2e/**')!.test('e2e/login.ts')).toBe(true);
    expect(globToRegExp('src/**/*.{it,int}.ts')!.test('src/a/b/x.int.ts')).toBe(true);
    expect(globToRegExp('src/*.ts')!.test('src/a/x.ts')).toBe(false);
    expect(globToRegExp('*.feature')!.test('deep/dir/login.feature')).toBe(true);
    expect(globToRegExp('qa/')!.test('qa/x/y.sql')).toBe(true);
  });

  it('ignores extended globs and empty patterns', () => {
    expect(globToRegExp('**/?(*.)+(spec|test).[jt]s?(x)')).toBeNull();
    expect(globToRegExp('  ')).toBeNull();
  });
});

describe('build-file test folders (#3403)', () => {
  it('reads Maven testSourceDirectory and testResources', () => {
    const pom = `<project><build>
      <testSourceDirectory>\${project.basedir}/src/it/java</testSourceDirectory>
      <!-- <testSourceDirectory>commented/out</testSourceDirectory> -->
      <testResources><testResource><directory>src/it/resources</directory></testResource></testResources>
      <resources><resource><directory>src/main/resources</directory></resource></resources>
    </build></project>`;
    expect(mavenTestFolders(pom)).toEqual(['${project.basedir}/src/it/java', 'src/it/resources']);
    const rules = testRulesFromBuildFile('service/pom.xml', 'pom.xml', pom).map((r) => r.pattern);
    expect(rules).toEqual(['service/src/it/java/**', 'service/src/it/resources/**']);
  });

  it('reads Gradle test source sets (Groovy and Kotlin DSL), not main', () => {
    const groovy = `sourceSets {
      main { java { srcDirs = ['src/main/java', 'src/gen/java'] } }
      integrationTest {
        java.srcDir 'src/integration/java'
        resources.srcDir "src/integration/resources"
      }
    }`;
    expect(gradleTestFolders(groovy)).toEqual(['src/integration/java', 'src/integration/resources']);
    const kts = `sourceSets {
      create("functionalTest") { java.setSrcDirs(listOf("src/functional/kotlin")) }
      named("main") { java.srcDir("src/main/kotlin") }
    }`;
    expect(gradleTestFolders(kts)).toEqual(['src/functional/kotlin']);
  });

  it('reads vitest include but not coverage include, and jest testMatch', () => {
    const vitest = `export default defineConfig({ test: {
      include: ['tests/**/*.spec.ts', 'src/**'],
      coverage: { include: ['src/**/*.ts'] },
    } });`;
    expect(vitestIncludeGlobs(vitest)).toEqual(['tests/**/*.spec.ts', 'src/**']);
    // The runner guard drops an include that does not name tests.
    expect(testRulesFromBuildFile('ui/vitest.config.ts', 'vitest.config.ts', vitest).map((r) => r.pattern)).toEqual(['ui/tests/**/*.spec.ts']);
    expect(jestTestMatchGlobs(`module.exports = { testMatch: ["<rootDir>/qa/**/*.test.js"] };`, false)).toEqual(['<rootDir>/qa/**/*.test.js']);
    expect(jestTestMatchGlobs(JSON.stringify({ name: 'x', jest: { testMatch: ['integration/**/*.js'] } }), true)).toEqual(['integration/**/*.js']);
  });

  it('drops folders that escape the root or need property expansion', () => {
    expect(testRulesFromBuildFile('pom.xml', 'pom.xml', '<testSourceDirectory>../shared/test</testSourceDirectory>')).toEqual([]);
    expect(testRulesFromBuildFile('pom.xml', 'pom.xml', '<testSourceDirectory>${it.dir}</testSourceDirectory>')).toEqual([]);
  });
});

describe('evidence classification (#3403)', () => {
  it('extracts paths from the evidence formats the passes emit', () => {
    expect(evidencePaths('src/test/java/a/ZugangsdatenVergessenITest.java:238')).toEqual(['src/test/java/a/ZugangsdatenVergessenITest.java']);
    expect(evidencePaths('generic-api-key: systemtest/framework/AccountHelper.ts:12')).toEqual(['systemtest/framework/AccountHelper.ts']);
    expect(evidencePaths('package.json (express: 4.18.2)')).toEqual(['package.json']);
    expect(evidencePaths('ui\\src\\utils\\test\\pdf.ts:2')).toEqual(['ui/src/utils/test/pdf.ts']);
    expect(evidencePaths('/abs/app/src/test/x.sql:3', '/abs/app')).toEqual(['src/test/x.sql']);
    expect(evidencePaths('https://example.org/api')).toEqual([]);
    expect(evidencePaths('No secrets found')).toEqual([]);
  });

  it('classifies test / production / mixed / none', () => {
    expect(classifyEvidenceOrigin(['src/test/A.java:1'], isTestPath)).toBe('test');
    expect(classifyEvidenceOrigin(['src/main/A.java:1'], isTestPath)).toBe('production');
    expect(classifyEvidenceOrigin(['rule: src/main/A.java:1', 'rule: x/a.test.ts:3'], isTestPath)).toBe('mixed');
    expect(classifyEvidenceOrigin([], isTestPath)).toBe('none');
  });
});

describe('applyTestCodeMarker (#3403)', () => {
  const sigs = [
    { id: 'CRYPTO-03', severity: 'high' as const, evidence: ['ui/src/composables/test/useStatus.test.ts:35'] },
    { id: 'CRYPTO-04', severity: 'high' as const, evidence: ['src/main/Cipher.java:10'] },
    { id: 'MAL-03', severity: 'high' as const, evidence: ['generic-api-key: systemtest/framework/AccountHelper.ts:4'] },
    { id: 'DATA-01', severity: 'low' as const, evidence: ['src/test/resources/massendaten.sql'] },
  ];

  it('include returns the same array untouched (byte-identical default)', () => {
    const r = applyTestCodeMarker(sigs, 'include', isTestPath);
    expect(r.signals).toBe(sigs);
    expect(r.tagged).toBe(0);
    expect(JSON.stringify(r.signals)).not.toContain('test_code');
  });

  it('tag marks test-only evidence, steps severity down, keeps secrets at their severity', () => {
    const r = applyTestCodeMarker(sigs, 'tag', isTestPath);
    expect(r.tagged).toBe(3);
    expect(r.lowered).toBe(2);
    expect(r.signals[0]).toMatchObject({ test_code: true, severity: 'medium', severity_original: 'high' });
    expect(r.signals[1]).toEqual(sigs[1]);
    expect(r.signals[2]).toMatchObject({ id: 'MAL-03', test_code: true, severity: 'high' });
    expect(r.signals[2]).not.toHaveProperty('severity_original');
    expect(r.signals[3]).toMatchObject({ test_code: true, severity: 'informational', severity_original: 'low' });
  });

  it('exclude marks without lowering', () => {
    const r = applyTestCodeMarker(sigs, 'exclude', isTestPath);
    expect(r.lowered).toBe(0);
    expect(r.signals[2]).toMatchObject({ id: 'MAL-03', test_code: true, severity: 'high' });
  });

  it('marked signals pass the pass-file schema assess.ts validates with, fields retained', () => {
    const marked = applyTestCodeMarker([{
      id: 'CRYPTO-03', source: 'static_analysis' as const, category: 'application' as const, severity: 'high' as const,
      derivation: '3DES referenced in a BDD test helper class.', evidence: ['src/test/java/A.java:3'], confidence: 'high' as const,
    }], 'tag', isTestPath).signals;
    const parsed = PassFileSchema.safeParse({
      pass: { id: 8, name: 'crypto', signal_prefix: 'CRYPTO', status: 'complete', iter: 1, assessed_at: '2026-10-24' },
      signals: marked,
      assessment: {},
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.signals[0]).toMatchObject({ test_code: true, severity: 'medium', severity_original: 'high' });
  });

  it('severity ladder', () => {
    expect(lowerSeverity('critical')).toBe('high');
    expect(lowerSeverity('informational')).toBe('informational');
    expect(lowerSeverity('positive')).toBe('positive');
  });
});

describe('source scope with the #3403 setting', () => {
  let tmp: string;
  const put = (rel: string, content = 'x'): void => {
    const p = join(tmp, ...rel.split('/'));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  };
  const rels = (opts: Parameters<typeof listSourceFiles>[1] = { purpose: 'code' }): string[] =>
    listSourceFiles(tmp, opts).map((f) => f.rel).sort();

  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'swao-3403-scope-')); endSourceScopeRun(); });
  afterEach(() => { endSourceScopeRun(); rmSync(tmp, { recursive: true, force: true }); });

  it('the run setting applies to every listing without a per-call option (secrets exempt)', () => {
    put('service/pom.xml', '<project/>');
    put('service/src/main/java/App.java');
    put('service/src/test/java/AppTest.java');
    put('service/src/test/resources/massendaten_anlegen.sql');
    beginSourceScopeRun({ testCode: 'exclude' });
    expect(rels()).toEqual(['service/pom.xml', 'service/src/main/java/App.java']);
    expect(rels({ purpose: 'secrets' })).toHaveLength(4);
    expect(rels({ purpose: 'code', testCode: 'include' })).toHaveLength(4);
    endSourceScopeRun();
    // Outside a run the default is include again.
    expect(rels()).toHaveLength(4);
  });

  it('classifies folders declared in pom.xml as test code', () => {
    put('service/pom.xml', '<project><build><testSourceDirectory>src/integration/java</testSourceDirectory></build></project>');
    put('service/src/main/java/App.java');
    put('service/src/integration/java/Checks.java');
    const scope = new SourceScope(tmp);
    expect(scope.list({ purpose: 'code' }).filter((f) => f.isTest).map((f) => f.rel)).toEqual(['service/src/integration/java/Checks.java']);
    expect(scope.summary().test_rules).toEqual(['service/pom.xml: service/src/integration/java/**']);
    // Without the build-file rule the folder name alone is not test code.
    expect(isTestPath('service/src/integration/java/Checks.java')).toBe(false);
  });

  it('applies operator extra and keep patterns; keep wins', () => {
    put('qa/flows/login.ts');
    put('src/mock/api/server.ts');
    put('src/app.ts');
    beginSourceScopeRun({ testCode: 'exclude', extraTestPatterns: ['qa/**'], keepPatterns: ['src/mock/api/**'] });
    expect(rels()).toEqual(['src/app.ts', 'src/mock/api/server.ts']);
    const s = getSourceScope(tmp).summary();
    expect(s.test_rules).toEqual(['assessment.test_code.extra_patterns: qa/**', 'assessment.test_code.keep_patterns: !src/mock/api/**']);
    expect(getSourceScope(tmp).isTestRel('qa/flows/login.ts')).toBe(true);
  });

  it('a default walk has no test_rules key (summary unchanged)', () => {
    put('src/app.ts');
    expect(getSourceScope(tmp).summary()).not.toHaveProperty('test_rules');
  });
});

describe('linear comment and line-suffix scanners (CodeQL js/redos, js/polynomial-redos)', () => {
  it('stripDelimited removes XML and block comments, and drops an unclosed opener with the rest', () => {
    expect(stripDelimited('a<!-- x -->b<!--y-->c', '<!--', '-->')).toBe('abc');
    expect(stripDelimited('keep /* gone */ this', '/*', '*/')).toBe('keep  this');
    expect(stripDelimited('head <!-- never closed <testSourceDirectory>x', '<!--', '-->')).toBe('head ');
    expect(stripDelimited('no comments', '<!--', '-->')).toBe('no comments');
  });

  it('stripLineSuffix strips :N, :N:M and :N-M, and leaves other text alone', () => {
    expect(stripLineSuffix('src/a.ts:12')).toBe('src/a.ts');
    expect(stripLineSuffix('src/a.ts:12:5')).toBe('src/a.ts');
    expect(stripLineSuffix('src/a.ts:12-20')).toBe('src/a.ts');
    expect(stripLineSuffix('src/a-1.ts')).toBe('src/a-1.ts');
    expect(stripLineSuffix('build-2024')).toBe('build-2024');
    expect(stripLineSuffix(':12')).toBe(''); // same as the former regular expression
  });

  it('both stay fast on adversarial input', () => {
    const t0 = Date.now();
    stripLineSuffix('x' + ':0'.repeat(50_000) + 'z');
    stripDelimited('<!--'.repeat(50_000), '<!--', '-->');
    stripDelimited('/*'.repeat(50_000), '/*', '*/');
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
});
