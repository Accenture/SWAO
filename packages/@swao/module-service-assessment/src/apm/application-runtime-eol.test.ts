// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  APM: APP-TCH-01 runtime end-of-life per detected runtime (#3458)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3458: APP-TCH-01 read only `assessment.node_eol_status`, so the Pass 05
// `java_runtime` block (#3420) never reached APM scoring and Java-only services
// had no runtime EOL score. Node behaviour must stay unchanged. Synthetic fixtures only.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  APPLICATION_RULES, applicationEvidenceGaps, gatherApplicationEvidence, javaRuntimeEol, runtimeEolSignal, worseRuntimeEol,
} from './application.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const appTch01 = APPLICATION_RULES.find((r) => r.id === 'APP-TCH-01')!;

/** One application run whose pass files carry the given `assessment` lines (file name -> YAML lines). */
function runWith(passes: Record<string, string[]>): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-3458-'));
  dirs.push(ws);
  const appDir = join(ws, 'apps', 'rt-app');
  const runDir = join(appDir, 'wsp', 'runs', '2026-10-24T09-00-00');
  mkdirSync(join(runDir, 'passes'), { recursive: true });
  writeFileSync(join(appDir, '.swao.yml'), 'app_id: rt-app\nassessment:\n  type: application\n');
  writeFileSync(join(appDir, 'wsp', 'latest.txt'), 'runs/2026-10-24T09-00-00');
  writeFileSync(join(runDir, 'wsp.yaml'), 'overall:\n  seven_r_label: Rehost\n');
  writeFileSync(join(runDir, 'run-manifest.json'), JSON.stringify({ schema_version: '1.4', run_id: '2026-10-24T09-00-00', app: 'rt-app' }));
  for (const [file, lines] of Object.entries(passes)) {
    writeFileSync(join(runDir, 'passes', file), ['pass: x', 'signals: []', 'assessment:', ...lines.map((l) => `  ${l}`)].join('\n') + '\n');
  }
  return ws;
}

const evidenceOf = (passes: Record<string, string[]>) => gatherApplicationEvidence(runWith(passes), 'rt-app').evidence;

/** The Pass 05 `java_runtime` block as written by #3420. */
const javaBlock = (status: string, major: number | null): string[] => [
  'java_runtime:',
  `  major: ${major === null ? 'null' : major}`,
  `  eol_status: ${status}`,
];

describe('APP-TCH-01 reads the Java runtime EOL status (#3458)', () => {
  it('a Java-only service on an end-of-life release scores 0 (was null before #3458)', () => {
    const e = evidenceOf({ '05-sbom.yaml': ['runtime: java', ...javaBlock('eol', 11)] });
    expect(e.runtimeEol).toBe('eol');
    expect(appTch01.score(e)).toBe(0);
    expect(runtimeEolSignal(e)).toBe('BLOCKED');
  });

  it('a Java-only service on a supported LTS release scores 100', () => {
    const e = evidenceOf({ '05-sbom.yaml': ['runtime: java', ...javaBlock('supported', 21)] });
    expect(e.runtimeEol).toBe('active_lts');
    expect(appTch01.score(e)).toBe(100);
    expect(runtimeEolSignal(e)).toBe('GREEN');
  });

  it('an unknown Java release or missing runtime data yields no score and an end_of_life gap', () => {
    for (const passes of [
      { '05-sbom.yaml': ['runtime: java', ...javaBlock('unknown', null)] },
      { '05-sbom.yaml': ['runtime: java'] },
      { '05-sbom.yaml': ['java_runtime: not-a-block'] },
      { '05-sbom.yaml': ['cve_lookup: skipped'] },
    ]) {
      const e = evidenceOf(passes);
      expect(e.runtimeEol).toBeNull();
      expect(appTch01.score(e)).toBeNull();
      expect(applicationEvidenceGaps(e)).toContain('end_of_life');
    }
  });

  it('a mixed Node + Java service takes the worse of the two statuses', () => {
    const e = evidenceOf({ '05-sbom.yaml': ['runtime: node', 'node_eol_status: active_lts', ...javaBlock('eol', 11)] });
    expect(appTch01.score(e)).toBe(0);
    const healthy = evidenceOf({ '05-sbom.yaml': ['runtime: node', 'node_eol_status: maintenance_lts', ...javaBlock('supported', 21)] });
    expect(appTch01.score(healthy)).toBe(70);
  });
});

describe('APP-TCH-01 Node behaviour unchanged (#3458)', () => {
  it.each([
    ['active_lts', 100],
    ['maintenance_lts', 70],
    ['eol', 0],
  ] as const)('node_eol_status %s scores %d', (status, expected) => {
    expect(appTch01.score(evidenceOf({ '05-sbom.yaml': ['runtime: node', `node_eol_status: ${status}`] }))).toBe(expected);
  });

  it('the last pass file still wins between Pass 01 and Pass 05, and unknown is ignored', () => {
    expect(evidenceOf({ '01-inv.yaml': ['node_eol_status: eol'], '05-sbom.yaml': ['node_eol_status: active_lts'] }).runtimeEol).toBe('active_lts');
    expect(evidenceOf({ '01-inv.yaml': ['node_eol_status: maintenance_lts'], '05-sbom.yaml': ['node_eol_status: unknown'] }).runtimeEol).toBe('maintenance_lts');
  });
});

describe('runtime EOL helpers (#3458)', () => {
  it('javaRuntimeEol maps the Pass 05 vocabulary onto the Node scale', () => {
    expect(javaRuntimeEol({ eol_status: 'supported' })).toBe('active_lts');
    expect(javaRuntimeEol({ eol_status: 'eol' })).toBe('eol');
    expect(javaRuntimeEol({ eol_status: 'unknown' })).toBeNull();
    expect(javaRuntimeEol(undefined)).toBeNull();
    expect(javaRuntimeEol('eol')).toBeNull();
  });

  it('worseRuntimeEol keeps the worse known status', () => {
    expect(worseRuntimeEol(null, null)).toBeNull();
    expect(worseRuntimeEol('active_lts', null)).toBe('active_lts');
    expect(worseRuntimeEol(null, 'eol')).toBe('eol');
    expect(worseRuntimeEol('maintenance_lts', 'active_lts')).toBe('maintenance_lts');
    expect(worseRuntimeEol('active_lts', 'eol')).toBe('eol');
  });
});
