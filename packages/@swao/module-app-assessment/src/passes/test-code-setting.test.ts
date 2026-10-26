// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Pass behaviour under assessment.test_code (#3403)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3403: with the exclude setting no static pass cites a test file, for a
// Maven layout (tests inside the module, next to pom.xml) and an npm layout
// (*.test.ts, systemtest/). The control case runs the same fixture without
// the setting and must cite test files, so the exclude assertions fail when
// the setting does not reach the passes. Synthetic fixtures only.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  applyTestCodeMarker,
  beginSourceScopeRun,
  endSourceScopeRun,
  evidencePaths,
  isTestPath,
  type LlmProvider,
  type PassContext,
  type PassResult,
} from '@swao/core';
import { runInvPass } from './pass-01-inv.js';
import { runStatePass } from './pass-02-state.js';
import { runDataPass, buildDataPrompt, TEST_CODE_PROMPT_RULE } from './pass-03-data.js';
import { runSbomPass } from './pass-05-sbom.js';
import { runTfPass } from './pass-06-tf.js';
import { runEgrPass } from './pass-07-egr.js';
import { runCryptoPass } from './pass-08-crypto.js';
import { runIamPass } from './pass-21-iam.js';
import { mapGitleaksJson } from './pass-14-malware.js';

let tmp: string;
let src: string;

function put(rel: string, content: string): void {
  const p = join(src, ...rel.split('/'));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, 'utf-8');
}

function ctx(overrides: Partial<PassContext> = {}): PassContext {
  return { workspacePath: tmp, sourcePath: src, appId: 'tc-app', iter: 1, assessedAt: '2026-10-24', ...overrides } as PassContext;
}

async function runStaticPasses(): Promise<PassResult[]> {
  return [
    await runInvPass(ctx()),
    // #3422: state reads Java and Spring configuration through the same scope.
    await runStatePass(ctx()),
    await runDataPass(ctx()),
    await runSbomPass(ctx()),
    await runTfPass(ctx()),
    await runEgrPass(ctx()),
    await runCryptoPass(ctx()),
    await runIamPass(ctx()),
  ];
}

function citedPaths(results: PassResult[]): string[] {
  return results.flatMap((r) => r.signals.flatMap((s) => s.evidence.flatMap((e) => evidencePaths(e, src))));
}

function mavenFixture(): void {
  put('service/pom.xml', '<project><artifactId>orders</artifactId><dependencies/></project>');
  put('service/src/main/java/de/app/App.java', 'package de.app;\npublic class App { public static void main(String[] a) {} }\n');
  put('service/src/test/java/de/app/bdd/ZugangsdatenVergessenITest.java',
    'package de.app.bdd;\nimport javax.crypto.Cipher;\nclass ZugangsdatenVergessenITest {\n  Cipher c = Cipher.getInstance("DESede/ECB/PKCS5Padding");\n  String md = java.security.MessageDigest.getInstance("MD5").toString();\n  String url = "https://api.stripe.com/v1/charges";\n}\n');
  // #3422: Java session state and Spring configuration endpoints in test code.
  put('service/src/test/java/de/app/SessionITest.java',
    'package de.app;\nclass SessionITest {\n  void t(jakarta.servlet.http.HttpSession session) {}\n  static final java.util.Map<String, String> SEEN = new java.util.HashMap<>();\n}\n');
  put('service/src/test/resources/application-test.yml',
    'spring:\n  datasource:\n    url: jdbc:postgresql://testdb.partner-cloud.de:5432/app\n');
  put('service/src/test/resources/massendaten_anlegen.sql',
    'INSERT INTO person (rentenversicherungsnummer, email, iban) VALUES (\'12345678A123\', \'a@b.de\', \'DE00\');\n');
}

function npmFixture(): void {
  put('package.json', JSON.stringify({ name: 'webshop', dependencies: {} }));
  put('src/app.ts', 'export const ok = 1;\n');
  put('ui/src/composables/test/useZugangVergessen.test.ts',
    "import { createCipheriv, createHash } from 'crypto';\nconst c = createCipheriv('des-ede3', key, null);\nconst h = createHash('md5');\nfetch('https://api.stripe.com/v1/charges');\n");
  put('systemtest/framework/helper/totp.helper.ts',
    "import { createHmac, createHash } from 'crypto';\nexport const t = createHash('md5').update('x');\n");
  put('systemtest/framework/AccountHelper.ts', "export const rentenversicherungsnummer = 'x'; const password = 'Geheim123!';\n");
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-3403-'));
  src = join(tmp, 'source');
  mkdirSync(src, { recursive: true });
  endSourceScopeRun();
});

afterEach(() => {
  endSourceScopeRun();
  rmSync(tmp, { recursive: true, force: true });
});

describe('#3403 exclude: no signal cites a test path', () => {
  for (const [layout, fixture] of [['Maven', mavenFixture], ['npm', npmFixture]] as const) {
    it(`${layout} fixture: control run without the setting cites test files`, async () => {
      fixture();
      beginSourceScopeRun();
      const cited = citedPaths(await runStaticPasses());
      expect(cited.filter((p) => isTestPath(p)).length).toBeGreaterThan(0);
    });

    it(`${layout} fixture: with exclude no static pass cites a test file`, async () => {
      fixture();
      beginSourceScopeRun({ testCode: 'exclude' });
      const cited = citedPaths(await runStaticPasses());
      expect(cited.filter((p) => isTestPath(p))).toEqual([]);
    });
  }
});

describe('#3403 default include is byte-identical', () => {
  it('signals of a default run equal those of an explicit include run, and the marker leaves them alone', async () => {
    mavenFixture();
    npmFixture();
    beginSourceScopeRun();
    const before = JSON.stringify(await runStaticPasses());
    endSourceScopeRun();
    beginSourceScopeRun({ testCode: 'include' });
    const results = await runStaticPasses();
    const marked = results.map((r) => ({ ...r, signals: applyTestCodeMarker(r.signals, 'include', isTestPath, src).signals }));
    expect(JSON.stringify(marked)).toBe(before);
    expect(before).not.toContain('test_code');
  });
});

describe('#3403 secret findings in test code', () => {
  it('stay reported under exclude, marked as test code, severity unchanged', () => {
    const mal03 = mapGitleaksJson([
      { File: 'systemtest/framework/AccountHelper.ts', StartLine: 4, RuleID: 'generic-password', Secret: 'Geheim123!' },
    ]);
    expect(mal03).not.toBeNull();
    const { signals, tagged, lowered } = applyTestCodeMarker([mal03!], 'exclude', isTestPath, src);
    expect(tagged).toBe(1);
    expect(lowered).toBe(0);
    expect(signals[0]).toMatchObject({ id: 'MAL-03', test_code: true, severity: 'high' });
    // Tag mode never lowers a secret either.
    expect(applyTestCodeMarker([mal03!], 'tag', isTestPath, src).signals[0]).toMatchObject({ severity: 'high', test_code: true });
  });
});

describe('#3403 AI pass marker (pass 03)', () => {
  function stubLlm(prompts: string[]): LlmProvider {
    return {
      name: 'stub',
      model: 'stub-1',
      complete: async (prompt: string) => {
        prompts.push(prompt);
        return JSON.stringify({ signals: [], assessment: { data_classes: [], gdpr_art17_implemented: false, secrets_in_env: false } });
      },
    } as unknown as LlmProvider;
  }

  function dataFixture(): void {
    put('src/main/resources/schema.sql', 'CREATE TABLE person (email TEXT);\n');
    put('src/test/resources/schema.sql', 'CREATE TABLE person_fixture (email TEXT);\n');
  }

  it('tag: test files are labelled and the prompt carries the test-code rule', async () => {
    dataFixture();
    const prompts: string[] = [];
    beginSourceScopeRun();
    await runDataPass(ctx({ llm: stubLlm(prompts), testCode: 'tag' }));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('schema, test code: src/test/resources/schema.sql');
    expect(prompts[0]).toContain('schema: src/main/resources/schema.sql');
    expect(prompts[0]).toContain(TEST_CODE_PROMPT_RULE);
  });

  it('include (default): the prompt is the pre-#3403 prompt', async () => {
    dataFixture();
    const withDefault: string[] = [];
    const withInclude: string[] = [];
    beginSourceScopeRun();
    await runDataPass(ctx({ llm: stubLlm(withDefault) }));
    await runDataPass(ctx({ llm: stubLlm(withInclude), testCode: 'include' }));
    expect(withInclude[0]).toBe(withDefault[0]);
    expect(withDefault[0]).not.toContain('test code');
    expect(buildDataPrompt([], false)).toBe(buildDataPrompt([], false, false));
  });

  it('exclude: test files never reach the model', async () => {
    dataFixture();
    const prompts: string[] = [];
    beginSourceScopeRun({ testCode: 'exclude' });
    await runDataPass(ctx({ llm: stubLlm(prompts), testCode: 'exclude' }));
    expect(prompts[0]).not.toContain('src/test/resources/schema.sql');
    expect(prompts[0]).toContain('src/main/resources/schema.sql');
  });
});
