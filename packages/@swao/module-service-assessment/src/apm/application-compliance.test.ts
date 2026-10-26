// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  APM: APP-REG-01 compliance vocabulary tests (#3407)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3407: APP-REG-01 read `ctl.outcome === 'PASS'`, but Pass 11 / derive-plan
// persist `status` with SATISFIED / PARTIAL / GAP / UNKNOWN / N_A (never PASS),
// so satisfied controls were never counted. It now reads `ctl.status` through
// the shared @swao/core classifier and score rule. Synthetic fixtures only.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APPLICATION_RULES, gatherApplicationEvidence, tallyApplicationCompliance, type ApplicationEvidence } from './application.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const appReg01 = APPLICATION_RULES.find((r) => r.id === 'APP-REG-01')!;
const score = (compliance: ApplicationEvidence['compliance']) => appReg01.score({ compliance } as ApplicationEvidence);

describe('tallyApplicationCompliance (#3407)', () => {
  it('counts the runtime Pass 11 vocabulary from ctl.status', () => {
    expect(tallyApplicationCompliance([{ controls: [
      { id: 'a', status: 'SATISFIED', outcome: 'SATISFIED' },
      { id: 'b', status: 'PARTIAL' },
      { id: 'c', status: 'GAP' },
      { id: 'd', status: 'UNKNOWN' },
      { id: 'e', status: 'N_A' },
    ] }])).toEqual({ pass: 1, partial: 1, gap: 1 });
  });

  it('reads status before outcome, and outcome only when status is absent', () => {
    expect(tallyApplicationCompliance([{ controls: [
      { id: 'a', status: 'GAP', outcome: 'SATISFIED' },
      { id: 'b', outcome: 'SATISFIED' },
    ] }])).toEqual({ pass: 1, partial: 0, gap: 1 });
  });

  it('accepts the example-workspace aliases compliant / non_compliant and ignores unrecognised values', () => {
    expect(tallyApplicationCompliance([{ controls: [
      { id: 'a', status: 'compliant' },
      { id: 'b', status: 'non_compliant' },
      { id: 'c', status: 'open' },
      { id: 'd' },
    ] }, { controls: 'not-a-list' }, null])).toEqual({ pass: 1, partial: 0, gap: 1 });
  });
});

describe('APP-REG-01 score (#3407)', () => {
  it('uses the shared complianceScore rule', () => {
    expect(score({ pass: 2, partial: 1, gap: 1 })).toBe(62.5);
    expect(score(null)).toBeNull();
  });

  it('a runtime-shaped wsp-plan.yaml yields a score (was null before #3407)', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-3407-'));
    dirs.push(ws);
    const appDir = join(ws, 'apps', 'reg-app');
    const runDir = join(appDir, 'wsp', 'runs', '2026-10-23T09-00-00');
    mkdirSync(join(runDir, 'passes'), { recursive: true });
    writeFileSync(join(appDir, '.swao.yml'), 'app_id: reg-app\nassessment:\n  type: application\n');
    writeFileSync(join(appDir, 'wsp', 'latest.txt'), 'runs/2026-10-23T09-00-00');
    writeFileSync(join(runDir, 'wsp.yaml'), 'overall:\n  seven_r_label: Rehost\n');
    writeFileSync(join(runDir, 'run-manifest.json'), JSON.stringify({ schema_version: '1.4', run_id: '2026-10-23T09-00-00', app: 'reg-app' }));
    writeFileSync(join(runDir, 'wsp-plan.yaml'), [
      'compliance:',
      '  regimes:',
      '    - id: GDPR',
      '      status: evaluated',
      '      controls:',
      '        - { id: Art-5, outcome: SATISFIED, status: SATISFIED, assessor: llm }',
      '        - { id: Art-32, outcome: PARTIAL, status: PARTIAL, assessor: llm }',
      '        - { id: Art-44, outcome: GAP, status: GAP, assessor: llm }',
      '        - { id: Art-9, outcome: N_A, status: N_A, assessor: rule_engine }',
      '        - { id: Art-30, outcome: UNKNOWN, status: UNKNOWN, assessor: llm }',
    ].join('\n') + '\n');
    const { evidence } = gatherApplicationEvidence(ws, 'reg-app');
    expect(evidence.compliance).toEqual({ pass: 1, partial: 1, gap: 1 });
    expect(appReg01.score(evidence)).toBe(50);
  });
});
