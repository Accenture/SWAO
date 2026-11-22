// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Community frameworks -- cross-map checker tests (#4058)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// The rules of tests/audit-gates/framework-cross-map.gate.mjs on inline
// fixtures, plus one run of the gate itself on the shipped frameworks.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asymmetryByPair, checkCrossMaps, commonIdPrefix, crossMapKey, type CrossMapFramework } from './cross-map.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

const FIXTURE: CrossMapFramework[] = [
  { dir: 'alpha', frameworkId: 'ALPHA', controls: [
    { id: 'ALPHA_1', maps_to: ['BETA_1', 'BETA_2', 'NIST_CSF_GV.OC-01'] },
    { id: 'ALPHA_2', maps_to: ['BETA_OLD'] },
    { id: 'ALPHA_3', maps_to: ['BETA_9'] },
  ] },
  { dir: 'beta', frameworkId: 'BETA', controls: [
    { id: 'BETA_1', maps_to: ['ALPHA_1'] },
    { id: 'BETA_2' },
    { id: 'BETA_3', replaces: ['BETA_OLD'] },
  ] },
  { dir: 'beta-demo', frameworkId: 'BETA_SAMPLE', controls: [
    { id: 'BETA_DEMO.X1', maps_to: ['BETA_DEMO.X9'] },
    { id: 'BETA_2', maps_to: ['ALPHA_1'] },
  ] },
];

describe('checkCrossMaps (#4058)', () => {
  const r = checkCrossMaps(FIXTURE);

  it('resolves an existing id and counts an external standard without failing', () => {
    expect(r.refs).toBe(8);
    expect(r.resolved).toBe(4);
    expect(r.external).toEqual({ NIST: 1 });
  });

  it('fails an in-library miss and a replaced id, naming the replacement', () => {
    expect(r.errors.map((e) => crossMapKey(e.from, e.to)).sort()).toEqual(['ALPHA_2 -> BETA_OLD', 'ALPHA_3 -> BETA_9', 'BETA_DEMO.X1 -> BETA_DEMO.X9']);
    expect(r.errors.find((e) => e.to === 'BETA_OLD')).toMatchObject({ toDir: 'beta', replacedBy: 'BETA_3' });
    // a control-id stem (`BETA_DEMO`) puts an id in the library like a framework id
    expect(r.errors.find((e) => e.to === 'BETA_DEMO.X9')?.toDir).toBe('beta-demo');
  });

  it('a listed known miss passes; an unlisted one still fails', () => {
    const k = checkCrossMaps(FIXTURE, new Set([crossMapKey('ALPHA_3', 'BETA_9')]));
    expect(k.knownMisses.map((m) => m.to)).toEqual(['BETA_9']);
    expect(k.errors.map((e) => e.to).sort()).toEqual(['BETA_DEMO.X9', 'BETA_OLD']);
  });

  it('reports an asymmetric pair; an id shipped twice is symmetric when one copy maps back, and owned by the full framework', () => {
    // ALPHA_1 -> BETA_1 maps back; ALPHA_1 -> BETA_2 maps back only through the demo copy.
    expect(r.asymmetric).toEqual([]);
    const one = checkCrossMaps([FIXTURE[0]!, { ...FIXTURE[1]!, controls: [{ id: 'BETA_1' }, { id: 'BETA_2' }] }]);
    expect(one.asymmetric.map((a) => crossMapKey(a.from, a.to))).toEqual(['ALPHA_1 -> BETA_1', 'ALPHA_1 -> BETA_2']);
    expect(asymmetryByPair(one)).toEqual([['alpha -> beta', 2]]);
    const twice = checkCrossMaps([FIXTURE[0]!, { ...FIXTURE[1]!, controls: [{ id: 'BETA_2' }] }, { dir: 'beta-demo', frameworkId: 'BETA_DEMO', controls: [{ id: 'BETA_2' }] }]);
    expect(twice.asymmetric.find((a) => a.to === 'BETA_2')?.toDir).toBe('beta');
  });
});

describe('ids that do not carry their framework id (#4058)', () => {
  it('commonIdPrefix cuts back to the last separator', () => {
    expect(commonIdPrefix(['BSI_ISMS1_A1', 'BSI_ORP1_A1', 'BSI_NET11_A2'])).toBe('BSI_');
    expect(commonIdPrefix(['HIPAA-ADM-01', 'HIPAA-TEC-02'])).toBe('HIPAA-');
    expect(commonIdPrefix(['ABC1', 'XYZ2'])).toBe('');
  });

  it('a typo in an id of such a framework fails; an external id with a similar head does not', () => {
    const r = checkCrossMaps([
      { dir: 'gs', frameworkId: 'GRUNDSCHUTZ_X', controls: [{ id: 'GSX_ISMS1_A1' }, { id: 'GSX_ORP1_A1' }] },
      { dir: 'hip', frameworkId: 'NIST_X', controls: [{ id: 'HIPX-ADM-01' }, { id: 'HIPX-TEC-01' }] },
      { dir: 'src', frameworkId: 'SRC', controls: [{ id: 'SRC_1', maps_to: ['GSX_ISMS1_A1', 'GSX_ISMS1_A99', 'HIPX-ADM-99', 'HIPX_164.502'] }] },
    ]);
    expect(r.errors.map((e) => `${e.to} ${e.toDir}`).sort()).toEqual(['GSX_ISMS1_A99 gs', 'HIPX-ADM-99 hip']);
    expect(r.external).toEqual({ HIPX: 1 });
  });
});

describe('framework-cross-map gate on the shipped frameworks (#4058)', () => {
  it('exits 0 with no unresolved in-library id', () => {
    const run = spawnSync(process.execPath, [join(REPO_ROOT, 'tests', 'audit-gates', 'framework-cross-map.gate.mjs')], { encoding: 'utf-8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/\[ok\] framework-cross-map\.gate\.mjs: .* 0 unresolved\./);
  });
});
