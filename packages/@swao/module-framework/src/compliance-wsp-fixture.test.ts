// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Framework module -- Pass 11 WSP fixture schema test (#3425 / #3426 / #3436)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// CLAUDE.md section 5.6: additive WSP fields ship with a fixture-WSP test.
// Pass 11 now writes `not_evaluated_reason`, `missing_input`, regime statuses
// `out_of_scope` / `degraded` and `assessment.degraded*`. This runs one pass
// producing all of them and parses the result with the WSP schemas the host
// uses (PassFileSchema for the pass file, ComplianceRegimeSchema for the
// wsp-plan.yaml compliance.regimes entries derive-plan copies verbatim).

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassFileSchema, ComplianceRegimeSchema, type PassContext, type LlmProvider } from '@swao/core';
import { runCompliancePass } from './compliance-evaluator.js';

function catalogue(id: string, controls: string[][]): string {
  const l = ['regime_meta:', `  id: ${id}`, `  name: ${id} fixture`, '  version: "1.0"',
    '  authority: SWAO Test Suite', '  catalogue_version: 1.0.0', 'controls:'];
  controls.forEach((x, i) => l.push(`  - id: ${id}_${i + 1}`, `    title: Control ${i + 1}`,
    '    description: Synthetic fixture control.', '    severity_default: high', ...x));
  return l.join('\n') + '\n';
}

describe('Pass 11 output validates against the WSP schemas', () => {
  it('out-of-scope, downgraded GAP, degraded batch and N/A all parse', async () => {
    const root = mkdtempSync(join(tmpdir(), 'swao-comp-wsp-'));
    const workspacePath = join(root, 'apps', 'demo-app');
    const passesDir = join(workspacePath, 'wsp', 'runs', '2026-10-23T00-00-00', 'passes');
    mkdirSync(passesDir, { recursive: true });
    const regimes: Record<string, string> = {
      OOS_FX: catalogue('OOS_FX', [['    assessment_type_scope: [lz]']]),
      GAP_FX: catalogue('GAP_FX', [['    evidence_basis:', '      - { context_input: "evidence/05-art-44.md" }'], ['    applies_when:', '      kritis_sector: "health"']]),
      FAIL_FX: catalogue('FAIL_FX', [[]]),
    };
    for (const [id, yaml] of Object.entries(regimes)) {
      const dir = join(root, 'wsp', 'inputs', 'catalogs', 'community', id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'controls.yaml'), yaml);
    }
    writeFileSync(join(workspacePath, '.swao.yml'), 'assessment:\n  regimes_active:\n    - OOS_FX\n    - GAP_FX\n    - FAIL_FX\n');
    writeFileSync(join(passesDir, '13-scope.yaml'),
      'pass:\n  id: 13\n  name: scope\nsignals:\n  - id: SCOPE-10\n    severity: medium\n    derivation: "Data processing agreements were not supplied."\n');
    const llm = {
      complete: async (p: string): Promise<string> => {
        if (p.includes('Regime: FAIL_FX')) throw new Error('HTTP 500 after 6 attempts');
        const ids = [...p.matchAll(/- id: (\S+)/g)].map((m) => m[1]!);
        return JSON.stringify({ controls: ids.map((id) => ({ id, outcome: 'GAP', rationale: `Model says ${id} is not met.`, signal_refs: ['SCOPE-10'] })) });
      },
    } as unknown as LlmProvider;
    const ctx: PassContext = { appId: 'demo-app', sourcePath: workspacePath, workspacePath, iter: 1, assessedAt: '2026-10-23T00:00:00Z', llm, passesDir };
    const result = await runCompliancePass(ctx);

    const pass = PassFileSchema.safeParse(result);
    if (!pass.success) throw new Error(JSON.stringify(pass.error.issues, null, 2));

    const out = result.assessment['regimes'] as unknown[];
    const parsed = out.map((r) => {
      const v = ComplianceRegimeSchema.safeParse(r);
      if (!v.success) throw new Error(JSON.stringify(v.error.issues, null, 2));
      return v.data as { id: string; status: string; controls?: Array<Record<string, unknown>> };
    });
    expect(parsed.map((r) => [r.id, r.status])).toEqual([['OOS_FX', 'out_of_scope'], ['GAP_FX', 'insufficient_evidence'], ['FAIL_FX', 'degraded']]);
    // Additive fields survive the passthrough schemas.
    expect(parsed[0]!.controls![0]).toMatchObject({ not_evaluated_reason: 'out_of_scope' });
    expect(parsed[1]!.controls![0]).toMatchObject({ not_evaluated_reason: 'insufficient_evidence', missing_input: ['evidence/05-art-44.md'] });
    expect(parsed[1]!.controls![1]).toMatchObject({ outcome: 'N_A' });
    expect(parsed[2]!.controls![0]).toMatchObject({ not_evaluated_reason: 'llm_unavailable' });
    expect(pass.data.assessment).toMatchObject({ degraded: true, degraded_regimes: [{ id: 'FAIL_FX', controls_without_verdict: 1 }] });
  });
});
