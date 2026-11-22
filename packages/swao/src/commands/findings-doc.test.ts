// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4286 criterion 3: findings.yaml of a run that evaluated no framework carries a reason.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump } from 'js-yaml';
import { buildFindingsDoc } from './findings-doc.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
function runDir(comp?: unknown): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-findings-'));
  dirs.push(d);
  if (comp !== undefined) {
    mkdirSync(join(d, 'passes'), { recursive: true });
    writeFileSync(join(d, 'passes', '11-comp.yaml'), dump(comp));
  }
  return d;
}

describe('findings.yaml document (#2674, #4286)', () => {
  it('flattens the controls of the evaluated regimes, without a reason', () => {
    const doc = buildFindingsDoc([{ id: 'SWAO_APM', controls: [{ id: 'APM-STR-01', title: 'Fit', outcome: 'GAP', severity: 'high' }] }], '2026-11-09', runDir());
    expect(doc).toEqual({ findings: [{ id: 'APM-STR-01', title: 'Fit', severity: 'high', outcome: 'GAP', regime: 'SWAO_APM', assessed_at: '2026-11-09' }] });
  });

  it('zero evaluated frameworks: the reason from the missing-framework signal of Pass 11', () => {
    const d = runDir({ assessment: { regimes: [], regimes_evaluated: 0 }, signals: [{ id: 'COMP-01', derivation: 'Regime X_REG is listed in .swao.yml but no framework with this id was found.' }] });
    const doc = buildFindingsDoc([], '2026-11-09', d);
    expect(doc.findings).toEqual([]);
    expect(doc.reason).toBe('No compliance framework was evaluated in this run, so there are no compliance findings: Regime X_REG is listed in .swao.yml but no framework with this id was found.');
    expect(readFileSync(join(d, 'passes', '11-comp.yaml'), 'utf-8')).toContain('COMP-01');
  });

  it('zero evaluated frameworks: the skipped_reason of Pass 11, or that Pass 11 did not run', () => {
    expect(buildFindingsDoc([], 'x', runDir({ assessment: { skipped_reason: 'No regimes configured in .swao.yml' } })).reason)
      .toBe('No compliance framework was evaluated in this run, so there are no compliance findings: No regimes configured in .swao.yml');
    expect(buildFindingsDoc([], 'x', runDir()).reason)
      .toBe('No compliance framework was evaluated in this run, so there are no compliance findings: Pass 11 (compliance evaluation) did not run in this assessment');
  });
});
