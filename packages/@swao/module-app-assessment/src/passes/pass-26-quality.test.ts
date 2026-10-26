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

// #3405: Pass 26 code health (Design 117).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { dump } from 'js-yaml';
import { PassFileSchema, type PassContext, type PassResult } from '@swao/core';
import { runQualityPass, QUALITY_TOP_N, type WorklistEntry } from './pass-26-quality.js';
import { assessOrchestrator, CANONICAL_PASS_ORDER, DEFAULT_PASS_KEYS, resolvePassAlias } from '../orchestrator.js';

function write(root: string, rel: string, content: string): void {
  const abs = join(root, ...rel.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf-8');
}

function ctx(sourcePath: string): PassContext {
  return { appId: 'demo', sourcePath, workspacePath: sourcePath, iter: 1, assessedAt: '2026-10-24T00:00:00Z' };
}

type CodeHealth = {
  status: string;
  kpis: Record<string, number> | null;
  totals: Record<string, number>;
  worklist: WorklistEntry[];
  hardcoded_endpoints: Array<{ evidence: string; kind: string; host: string; classification: string }>;
  owner_source: string | null;
  languages: Record<string, { files: number; nloc: number }>;
};
const ch = (r: PassResult): CodeHealth => r.assessment['code_health'] as CodeHealth;
const sig = (r: PassResult, id: string) => r.signals.find((s) => s.id === id);

function complexJava(name: string): string {
  const body: string[] = [];
  for (let i = 0; i < 40; i++) {
    body.push(`        if (code.startsWith("${i}") && attempts > ${i}) {`);
    body.push(`            for (int k = 0; k < ${i}; k++) { if (k % 2 == 0 || k == ${i}) { total += k; } }`);
    body.push('        }');
  }
  return [
    'package com.acme.unlock;',
    '',
    `public class ${name} {`,
    '    private static final String AUDIT = "https://audit.partner-registry.eu/api/v2";',
    '    public int check(String code, int attempts) {',
    '        int total = 0;',
    ...body,
    '        // TODO: replace the retry loop',
    '        return total;',
    '    }',
    '}',
  ].join('\n');
}

describe('Pass 26 code health: Maven fixture', () => {
  let root: string;
  let result: PassResult;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'swao-qual-mvn-'));
    write(root, 'pom.xml', '<project xmlns="http://maven.apache.org/POM/4.0.0"><version>2.5.0.1</version></project>');
    write(root, 'src/main/java/com/acme/unlock/UnlockCode.java', complexJava('UnlockCode'));
    write(root, 'src/main/java/com/acme/unlock/Small.java', 'package com.acme.unlock;\npublic class Small {\n  int a() { return 1; }\n}\n');
    write(root, 'src/main/resources/application.yml', [
      'spring:',
      '  datasource:',
      '    url: jdbc:postgresql://10.20.30.40:5432/acme',
      'mail:',
      '  url: ${MAIL_URL:smtps://smtp.relay.partner.de:465}',
      'local: http://localhost:8080',
    ].join('\n'));
    write(root, 'helm/values-prod.yaml', 'ingress:\n  loadBalancerIP: 52.29.11.7\n');
    write(root, 'Dockerfile', 'FROM eclipse-temurin:21\nENV REGISTRY=https://repo.partner-mirror.eu/maven\n');
    // Test code: an IP here must not count.
    write(root, 'src/test/java/com/acme/unlock/UnlockCodeTest.java', 'class UnlockCodeTest { String h = "10.99.99.99"; }');
    result = await runQualityPass(ctx(root));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('completes, validates against the WSP pass schema and uses the QUAL prefix', () => {
    expect(result.pass).toMatchObject({ id: 26, name: 'code_health', signal_prefix: 'QUAL', status: 'complete' });
    expect(() => PassFileSchema.parse(result)).not.toThrow();
    expect(result.signals.every((s) => /^QUAL-\d{2}$/.test(s.id))).toBe(true);
    expect(result.signals.every((s) => s.severity !== 'high' && s.severity !== 'critical')).toBe(true);
  });

  it('ranks the complex Java file first with a file:line evidence', () => {
    const top = ch(result).worklist[0]!;
    expect(top.file).toBe('src/main/java/com/acme/unlock/UnlockCode.java');
    expect(top.language).toBe('Java');
    expect(top.decision_points).toBeGreaterThan(100);
    expect(top.evidence).toMatch(/^src\/main\/java\/com\/acme\/unlock\/UnlockCode\.java:\d+$/);
    expect(sig(result, 'QUAL-02')?.evidence[0]).toBe(top.evidence);
  });

  it('reports hard-coded IPs (QUAL-05) and URLs (QUAL-06) in YAML, Helm values, Java and Dockerfile with file:line', () => {
    expect(sig(result, 'QUAL-05')?.evidence).toEqual(['helm/values-prod.yaml:2', 'src/main/resources/application.yml:3']);
    expect(sig(result, 'QUAL-06')?.evidence).toEqual([
      'Dockerfile:2',
      'src/main/java/com/acme/unlock/UnlockCode.java:4',
      'src/main/resources/application.yml:5',
    ]);
    const hosts = ch(result).hardcoded_endpoints.map((e) => e.host);
    expect(hosts).not.toContain('localhost');
    expect(hosts).not.toContain('10.99.99.99');
    expect(hosts).not.toContain('maven.apache.org');
  });

  it('counts test files without measuring them', () => {
    expect(ch(result).totals['test_files_not_measured']).toBe(1);
    expect(ch(result).worklist.some((w) => w.file.includes('src/test/'))).toBe(false);
  });

  it('records TODO markers (QUAL-07) and the language coverage', () => {
    expect(sig(result, 'QUAL-07')?.evidence[0]).toMatch(/UnlockCode\.java:\d+$/);
    expect(Object.keys(ch(result).languages)).toEqual(['Java']);
  });

  it('computes the four KPIs in 0..100', () => {
    const k = ch(result).kpis!;
    for (const key of ['complexity', 'maintainability', 'duplication', 'configuration_hygiene', 'overall']) {
      expect(k[key]).toBeGreaterThanOrEqual(0);
      expect(k[key]).toBeLessThanOrEqual(100);
    }
    expect(k['complexity']).toBeLessThan(100);
    expect(k['configuration_hygiene']).toBeLessThan(100);
  });

  it('is byte-identical across two runs on the same input', async () => {
    const again = await runQualityPass(ctx(root));
    expect(dump(again)).toBe(dump(result));
  });
});

describe('Pass 26 code health: npm fixture', () => {
  let root: string;
  let result: PassResult;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'swao-qual-npm-'));
    const shared = [
      'export function normaliseOrder(order) {',
      '  const lines = order.lines.filter((l) => l.quantity > 0);',
      '  const total = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);',
      '  const discount = total > 1000 ? total * 0.05 : 0;',
      '  const shipping = order.express ? 25 : 5;',
      '  return { ...order, lines, total: total - discount + shipping };',
      '}',
    ].join('\n');
    write(root, 'package.json', '{"name":"shop","homepage":"https://example.com"}');
    write(root, 'src/orders.ts', `${shared}\n`);
    write(root, 'src/legacy/orders-copy.ts', `// copied\n${shared}\n`);
    write(root, 'src/config.js', "// API docs: https://docs.payments-vendor.io/guide\nmodule.exports = { api: 'https://api.payments-vendor.io/v1', docs: 'https://example.org/x' };\n");
    write(root, 'src/app.spec.ts', "it('x', () => fetch('https://api.payments-vendor.io/test'));\n");
    write(root, 'dist/bundle.js', "fetch('https://cdn.vendor.io/a.js')\n");
    write(root, '.github/CODEOWNERS', '* @org/platform\n/src/legacy/ @org/legacy-team\n');
    result = await runQualityPass(ctx(root));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('detects the duplicated block in both files (QUAL-04)', () => {
    const q4 = sig(result, 'QUAL-04');
    expect(q4).toBeDefined();
    expect([...(q4?.evidence ?? [])].sort()).toEqual(['src/legacy/orders-copy.ts:2', 'src/orders.ts:1']);
    expect(ch(result).totals['clone_groups']).toBeGreaterThan(0);
  });

  it('reports the hard-coded URL in config.js only (no tests, no build output, no example hosts, no comment lines)', () => {
    expect(sig(result, 'QUAL-06')?.evidence).toEqual(['src/config.js:2']);
  });

  it('assigns owners from CODEOWNERS, last matching rule wins', () => {
    const byFile = new Map(ch(result).worklist.map((w) => [w.file, w.owner]));
    expect(byFile.get('src/legacy/orders-copy.ts')).toBe('@org/legacy-team');
    expect(byFile.get('src/orders.ts')).toBe('@org/platform');
    expect(ch(result).owner_source).toBe('.github/CODEOWNERS');
  });

  it('keeps the worklist sorted by score then path and within top_n', () => {
    const wl = ch(result).worklist;
    expect(wl.length).toBeLessThanOrEqual(QUALITY_TOP_N);
    for (let i = 1; i < wl.length; i++) {
      const a = wl[i - 1]!; const b = wl[i]!;
      expect(a.score > b.score || (a.score === b.score && a.file < b.file)).toBe(true);
      expect(b.rank).toBe(i + 1);
    }
  });
});

describe('Pass 26 code health: graceful skip', () => {
  it('emits QUAL-00 not_applicable for an empty tree', async () => {
    const root = mkdtempSync(join(tmpdir(), 'swao-qual-empty-'));
    try {
      write(root, 'README.md', '# nothing');
      const r = await runQualityPass(ctx(root));
      expect(r.pass.status).toBe('not_applicable');
      expect(r.signals.map((s) => s.id)).toEqual(['QUAL-00']);
      expect(() => PassFileSchema.parse(r)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('emits QUAL-00 when only test code exists', async () => {
    const root = mkdtempSync(join(tmpdir(), 'swao-qual-tests-'));
    try {
      write(root, 'src/test/java/FooTest.java', 'class FooTest {}');
      const r = await runQualityPass(ctx(root));
      expect(r.signals[0]?.derivation).toMatch(/only test code/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('emits QUAL-00 for a missing source path', async () => {
    const r = await runQualityPass(ctx(join(tmpdir(), 'swao-qual-does-not-exist-3405')));
    expect(r.signals[0]?.id).toBe('QUAL-00');
  });
});

describe('Pass 26 registration', () => {
  it('is registered as pass 26 `quality` in the default profile, before comp/synth/blocks', () => {
    expect(assessOrchestrator.getPass('quality')).toMatchObject({ num: '26', name: 'code_health', llmPassName: null });
    expect(DEFAULT_PASS_KEYS).toContain('quality');
    expect(resolvePassAlias('QUALITY')).toBe('quality');
    const i = CANONICAL_PASS_ORDER.indexOf('quality');
    expect(i).toBeGreaterThan(-1);
    for (const later of ['comp', 'synth', 'blocks']) expect(i).toBeLessThan(CANONICAL_PASS_ORDER.indexOf(later));
  });
});
