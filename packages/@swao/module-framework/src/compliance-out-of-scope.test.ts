// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Framework module -- out-of-scope regime marker tests (#3425 follow-up)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3425 follow-up: a framework whose controls are all outside the run's
// assessment type scope (e.g. an LZ-only catalogue in an application run) is
// marked `out_of_scope` at regime level and per control, so the publication can
// say "not in scope for this assessment type" instead of a wall of UNKNOWN rows.
// Needs @swao/core rebuilt (dist) for the shared rationale prefix and the
// catalogue schema that keeps control-level assessment_type_scope.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { complianceNotEvaluatedReason, type PassContext, type LlmProvider } from '@swao/core';
import { runCompliancePass, regimeEvaluationStatus, loadApplicabilityContext } from './compliance-evaluator.js';

function catalogue(id: string, controls: Array<{ id: string; extra?: string[] }>): string {
  const l = ['regime_meta:', `  id: ${id}`, `  name: ${id} test regime`, '  version: "1.0"',
    '  authority: SWAO Test Suite', '  catalogue_version: 1.0.0', 'controls:'];
  for (const c of controls) {
    l.push(`  - id: ${c.id}`, `    title: Control ${c.id}`, '    description: Synthetic scope probe control.', '    severity_default: high', ...(c.extra ?? []));
  }
  return l.join('\n') + '\n';
}

function workspace(regimes: Record<string, string>): { workspacePath: string; passesDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'swao-comp-oos-'));
  const workspacePath = join(root, 'apps', 'demo-app');
  const passesDir = join(workspacePath, 'wsp', 'runs', '2026-10-23T00-00-00', 'passes');
  mkdirSync(passesDir, { recursive: true });
  for (const [id, yaml] of Object.entries(regimes)) {
    const dir = join(root, 'wsp', 'inputs', 'catalogs', 'community', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'controls.yaml'), yaml);
  }
  writeFileSync(join(workspacePath, '.swao.yml'),
    ['assessment:', '  regimes_active:', ...Object.keys(regimes).map((r) => `    - ${r}`)].join('\n') + '\n');
  writeFileSync(join(passesDir, '01-inv.yaml'),
    'pass:\n  id: 1\n  name: inventory\nsignals:\n  - id: INV-01\n    severity: high\n    derivation: "probe"\n');
  return { workspacePath, passesDir };
}

function gapLlm(prompts: string[]): LlmProvider {
  return {
    complete: async (prompt: string): Promise<string> => {
      prompts.push(prompt);
      const ids = [...prompt.matchAll(/- id: (\S+)/g)].map((m) => m[1]!);
      return JSON.stringify({ controls: ids.map((id) => ({ id, outcome: 'GAP', rationale: `Probe rationale for ${id}.`, signal_refs: ['INV-01'], remediation: 'Fix it.' })) });
    },
  } as unknown as LlmProvider;
}

const ctxFor = (ws: { workspacePath: string; passesDir: string }, llm?: LlmProvider): PassContext =>
  ({ appId: 'demo-app', sourcePath: ws.workspacePath, workspacePath: ws.workspacePath, iter: 1, assessedAt: '2026-10-23', llm, passesDir: ws.passesDir });

type Ctl = { id: string; outcome: string; rationale: string; not_evaluated_reason?: string };
type Reg = { id: string; status: string; controls: Ctl[] };

describe('out-of-scope regimes (#3425 follow-up)', () => {
  it('an all-LZ-scoped catalogue in an application run is out_of_scope with no LLM call', async () => {
    const ws = workspace({
      LZ_ONLY: catalogue('LZ_ONLY', [
        { id: 'LZ_1', extra: ['    assessment_type_scope: [lz]'] },
        { id: 'LZ_2', extra: ['    assessment_type_scope: [lz, aud]'] },
      ]),
      APP_REG: catalogue('APP_REG', [{ id: 'AR_1' }]),
    });
    const prompts: string[] = [];
    const result = await runCompliancePass(ctxFor(ws, gapLlm(prompts)));
    const regimes = result.assessment['regimes'] as Reg[];
    const lz = regimes.find((r) => r.id === 'LZ_ONLY')!;
    expect(lz.status).toBe('out_of_scope');
    for (const c of lz.controls) {
      expect(c).toMatchObject({ outcome: 'UNKNOWN', not_evaluated_reason: 'out_of_scope' });
      expect(complianceNotEvaluatedReason({ rationale: c.rationale })).toBe('out_of_scope');
    }
    expect(regimes.find((r) => r.id === 'APP_REG')!.status).toBe('evaluated');
    expect(prompts.join('\n')).not.toContain('LZ_1');
  });

  // #3425 follow-up: PassContext.assessmentType (routed, --type aware) wins over .swao.yml.
  it('ctx.assessmentType decides the scope: a landing-zone run evaluates the LZ controls', async () => {
    const ws = workspace({ LZ_ONLY: catalogue('LZ_ONLY', [{ id: 'LZ_1', extra: ['    assessment_type_scope: [lz]'] }]) });
    writeFileSync(join(ws.workspacePath, '.swao.yml'), 'assessment:\n  type: application\n  regimes_active:\n    - LZ_ONLY\n');
    const prompts: string[] = [];
    const routed = await runCompliancePass({ ...ctxFor(ws, gapLlm(prompts)), assessmentType: 'landing-zone' });
    expect((routed.assessment['regimes'] as Reg[])[0]!.status).toBe('evaluated');
    expect(prompts.join('\n')).toContain('LZ_1');
    // Without the routed type, .swao.yml assessment.type (application) applies.
    const fallback = await runCompliancePass(ctxFor(ws, gapLlm([])));
    expect((fallback.assessment['regimes'] as Reg[])[0]!.status).toBe('out_of_scope');
  });

  it('loadApplicabilityContext: routed type, then .swao.yml type, then application', () => {
    const ws = workspace({});
    expect(loadApplicabilityContext(ws.workspacePath).scopeTokens).toEqual(['app']);
    expect(loadApplicabilityContext(ws.workspacePath, 'audit').scopeTokens).toEqual(['aud']);
    writeFileSync(join(ws.workspacePath, '.swao.yml'), 'assessment:\n  type: hybrid\n');
    expect(loadApplicabilityContext(ws.workspacePath).scopeTokens).toEqual(['app', 'aud']);
    expect(loadApplicabilityContext(ws.workspacePath, 'service').scopeTokens).toEqual(['service']);
  });

  it('out of scope plus N/A is still out_of_scope; an in-scope control keeps the regime evaluable', () => {
    expect(regimeEvaluationStatus([
      { outcome: 'UNKNOWN', not_evaluated_reason: 'out_of_scope' },
      { outcome: 'N_A' },
    ], true)).toBe('out_of_scope');
    expect(regimeEvaluationStatus([
      { outcome: 'UNKNOWN', not_evaluated_reason: 'out_of_scope' },
      { outcome: 'GAP' },
    ], true)).toBe('evaluated');
  });

  it('an ordinary all-UNKNOWN regime is not out_of_scope', () => {
    expect(regimeEvaluationStatus([{ outcome: 'UNKNOWN' }, { outcome: 'UNKNOWN' }], true)).toBe('insufficient_evidence');
    expect(regimeEvaluationStatus([{ outcome: 'UNKNOWN' }], false)).toBe('pending-llm');
    expect(regimeEvaluationStatus([{ outcome: 'N_A' }], true)).toBe('insufficient_evidence');
  });
});
