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

// #3423: INV language census, recursive manifest detection, coverage matrix
// and the INV-91 warning (synthetic fixtures only).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInvPass } from './pass-01-inv.js';
import { LanguageCensusSchema, LanguageCoverageSchema, SignalIdSchema, type PassContext } from '@swao/core';

let dir: string;
let src: string;
let ws: string;

function put(rel: string, content: string): void {
  const abs = join(src, ...rel.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf-8');
}

function lines(n: number): string {
  return Array.from({ length: n }, (_, i) => `stmt${i};`).join('\n') + '\n';
}

async function run() {
  const ctx: PassContext = {
    appId: 'test-app', iter: 1, assessedAt: '2026-10-24',
    llm: undefined as unknown as PassContext['llm'],
    passesDir: dir, sourcePath: src, workspacePath: ws,
  };
  return runInvPass(ctx);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'swao-3423-inv-'));
  src = join(dir, 'src');
  ws = join(dir, 'ws');
  mkdirSync(src, { recursive: true });
  mkdirSync(ws, { recursive: true });
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('#3423 pass-01 recursive manifest detection', () => {
  it('detects a nested service/pom.xml as Java next to a test-only systemtest/package.json (FS/EZ)', async () => {
    put('service/pom.xml', '<project/>');
    put('service/src/main/java/de/x/Freigabe.java', lines(40));
    put('service/src/test/java/de/x/FreigabeTest.java', lines(10));
    put('systemtest/package.json', '{"name":"systemtest"}');
    put('systemtest/specs/login.spec.ts', lines(20));
    const r = await run();
    expect(r.assessment.language).toBe('java');
    expect(r.assessment.detected_languages).toEqual(['Java']);
    const inv01 = r.signals.find((s) => s.id === 'INV-01');
    expect(inv01?.derivation).toContain('Java (Maven service/pom.xml)');
    expect(inv01?.derivation).not.toContain('TypeScript/Node.js');
    expect(inv01?.evidence).toEqual(['service/pom.xml']);
    expect(r.signals.some((s) => s.id === 'INV-00')).toBe(false);
  });

  it('orders polyglot languages by production LOC and names every manifest', async () => {
    put('frontend/package.json', '{}');
    put('frontend/src/app.ts', lines(5));
    put('backend/api/build.gradle.kts', '');
    put('backend/api/src/main/kotlin/App.kt', lines(30));
    const r = await run();
    expect(r.assessment.detected_languages).toEqual(['Kotlin', 'TypeScript']);
    expect(r.assessment.language).toBe('kotlin');
    const inv01 = r.signals.find((s) => s.id === 'INV-01');
    expect(inv01?.evidence).toEqual(expect.arrayContaining(['frontend/package.json', 'backend/api/build.gradle.kts']));
  });

  it('falls back to the census when no build manifest exists (Ant-style Java)', async () => {
    put('src/de/x/Main.java', lines(12));
    const r = await run();
    expect(r.assessment.language).toBe('java');
    expect(r.signals.find((s) => s.id === 'INV-01')?.derivation).toContain('no build manifest');
    expect(r.signals.some((s) => s.id === 'INV-00')).toBe(false);
  });

  it('a root package.json keeps the Node INV-01 and names further manifests', async () => {
    put('package.json', JSON.stringify({ name: 'x', version: '1.0.0', dependencies: { express: '4' } }));
    put('index.js', lines(3));
    put('legacy/pom.xml', '<project/>');
    put('legacy/src/main/java/A.java', lines(3));
    const r = await run();
    expect(r.assessment.language).toBe('javascript');
    const inv01 = r.signals.filter((s) => s.id === 'INV-01');
    expect(inv01).toHaveLength(1);
    expect(inv01[0]?.derivation).toContain('Further build manifests: Java (Maven legacy/pom.xml)');
  });
});

describe('#3423 pass-01 language census (INV-90) and coverage matrix', () => {
  it('writes the census and coverage to the assessment and emits INV-90 with LOC per language', async () => {
    put('service/pom.xml', '<project/>');
    put('service/src/main/java/A.java', lines(100));
    put('service/src/test/java/ATest.java', lines(25));
    put('web/app.ts', lines(10));
    put('ops/run.ksh', lines(4));
    const r = await run();
    const census = LanguageCensusSchema.parse(r.assessment.language_census);
    expect(census.languages.map((l) => [l.language, l.loc, l.loc_test])).toEqual([
      ['Java', 125, 25], ['TypeScript', 10, 0], ['Shell', 4, 0],
    ]);
    const coverage = LanguageCoverageSchema.parse(r.assessment.language_coverage);
    expect(coverage.dominant_language).toBe('Java');
    expect(coverage.rows.find((x) => x.language === 'Shell')?.has_deterministic).toBe(false);
    const inv90 = r.signals.find((s) => s.id === 'INV-90');
    expect(inv90?.severity).toBe('informational');
    expect(inv90?.derivation).toContain('Java 125 LOC (test 25; 2 files)');
    expect(inv90?.derivation).toContain('Shell 4 LOC');
    expect(inv90?.derivation).toContain('Dominant language: Java');
    expect(SignalIdSchema.safeParse('INV-90').success).toBe(true);
  });

  it('emits INV-91 when more than half of the production LOC lacks deterministic code analysis', async () => {
    put('scripts/batch.ksh', lines(80));
    put('scripts/lib.sh', lines(20));
    put('tools/helper.js', lines(30));
    const r = await run();
    const inv91 = r.signals.find((s) => s.id === 'INV-91');
    expect(inv91).toBeDefined();
    expect(inv91?.severity).toBe('medium');
    expect(inv91?.outcome).toBe('negative');
    expect(inv91?.derivation).toContain('77% of the production code is in Shell');
    expect(inv91?.derivation).toContain('no rule-based code-analysis pass');
  });

  it('does not emit INV-91 when the dominant language is deterministically covered', async () => {
    put('pom.xml', '<project/>');
    put('src/main/java/A.java', lines(80));
    put('scripts/run.ksh', lines(20));
    const r = await run();
    expect(r.signals.some((s) => s.id === 'INV-91')).toBe(false);
  });

  it('emits no census signals for an empty source tree', async () => {
    const r = await run();
    expect(r.signals.some((s) => s.id === 'INV-90' || s.id === 'INV-91')).toBe(false);
    expect(r.signals.some((s) => s.id === 'INV-00')).toBe(true);
  });
});
