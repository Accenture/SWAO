// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Framework module -- exhausted compliance LLM call tests (#3436)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3436: when a Pass 11 batch call failed after its retries, the pass still
// reported a clean evaluation. Now the affected controls are UNKNOWN with
// not_evaluated_reason llm_unavailable, the regime is `degraded`, and the pass
// assessment carries `degraded: true` + `degraded_regimes`. Rule-engine
// decisions (N_A via applies_when, out of scope) stay valid verdicts.
// Mocked all-attempts-fail provider only.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { complianceNotEvaluatedReason, type PassContext, type LlmProvider } from '@swao/core';
import { runCompliancePass } from './compliance-evaluator.js';

function catalogue(id: string, extra: string[][]): string {
  const l = ['regime_meta:', `  id: ${id}`, `  name: ${id} test regime`, '  version: "1.0"',
    '  authority: SWAO Test Suite', '  catalogue_version: 1.0.0', 'controls:'];
  extra.forEach((x, i) => l.push(`  - id: ${id}_${i + 1}`, `    title: Control ${i + 1}`,
    '    description: Synthetic degradation probe control.', '    severity_default: high', ...x));
  return l.join('\n') + '\n';
}

function workspace(): { workspacePath: string; passesDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'swao-comp-3436-'));
  const workspacePath = join(root, 'apps', 'demo-app');
  const passesDir = join(workspacePath, 'wsp', 'runs', '2026-10-23T00-00-00', 'passes');
  mkdirSync(passesDir, { recursive: true });
  const write = (id: string, yaml: string) => {
    const dir = join(root, 'wsp', 'inputs', 'catalogs', 'community', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'controls.yaml'), yaml);
  };
  // GDPR_T: 2 evaluable + 1 sector N/A + 1 out of scope; ISO_T: 1 evaluable.
  write('GDPR_T', catalogue('GDPR_T', [[], [], ['    applies_when:', '      kritis_sector: "health"'], ['    assessment_type_scope: [aud]']]));
  write('ISO_T', catalogue('ISO_T', [[]]));
  writeFileSync(join(workspacePath, '.swao.yml'), 'assessment:\n  regimes_active:\n    - GDPR_T\n    - ISO_T\n');
  writeFileSync(join(passesDir, '01-inv.yaml'),
    'pass:\n  id: 1\n  name: inventory\nsignals:\n  - id: INV-01\n    severity: high\n    derivation: "probe"\n');
  return { workspacePath, passesDir };
}

class LlmConnectivityError extends Error { override name = 'LlmConnectivityError'; }

/** GDPR_T batches throw (all retries exhausted); ISO_T answers SATISFIED. */
function partlyFailingLlm(): LlmProvider {
  return {
    complete: async (prompt: string): Promise<string> => {
      if (prompt.includes('Regime: GDPR_T')) throw new LlmConnectivityError('HTTP 500 after 6 attempts');
      const ids = [...prompt.matchAll(/- id: (\S+)/g)].map((m) => m[1]!);
      return JSON.stringify({ controls: ids.map((id) => ({ id, outcome: 'SATISFIED', rationale: `Probe ${id} is met.`, signal_refs: ['INV-01'] })) });
    },
  } as unknown as LlmProvider;
}

const ctxFor = (ws: { workspacePath: string; passesDir: string }, llm?: LlmProvider): PassContext =>
  ({ appId: 'demo-app', sourcePath: ws.workspacePath, workspacePath: ws.workspacePath, iter: 1, assessedAt: '2026-10-23', llm, passesDir: ws.passesDir });

type Ctl = { id: string; outcome: string; assessor: string; rationale: string; not_evaluated_reason?: string };
type Reg = { id: string; status: string; controls: Ctl[] };

describe('Pass 11 exhausted LLM batch (#3436)', () => {
  it('a mocked all-attempts-fail batch yields degraded and no verdict', async () => {
    const result = await runCompliancePass(ctxFor(workspace(), partlyFailingLlm()));
    const regimes = result.assessment['regimes'] as Reg[];
    const gdpr = regimes.find((r) => r.id === 'GDPR_T')!;
    expect(gdpr.status).toBe('degraded');
    const evaluable = gdpr.controls.filter((c) => c.id === 'GDPR_T_1' || c.id === 'GDPR_T_2');
    for (const c of evaluable) {
      expect(c).toMatchObject({ outcome: 'UNKNOWN', not_evaluated_reason: 'llm_unavailable', assessor: 'rule_engine' });
      expect(c.rationale).toContain('LlmConnectivityError');
      expect(complianceNotEvaluatedReason({ rationale: c.rationale })).toBe('llm_unavailable');
    }
    // Rule-engine decisions stay valid verdicts.
    expect(gdpr.controls.find((c) => c.id === 'GDPR_T_3')).toMatchObject({ outcome: 'N_A', assessor: 'rule_engine' });
    expect(gdpr.controls.find((c) => c.id === 'GDPR_T_4')).toMatchObject({ outcome: 'UNKNOWN', not_evaluated_reason: 'out_of_scope' });
    // The other regime is unaffected.
    const iso = regimes.find((r) => r.id === 'ISO_T')!;
    expect(iso.status).toBe('evaluated');
    expect(iso.controls[0]).toMatchObject({ outcome: 'SATISFIED', assessor: 'llm' });

    expect(result.assessment).toMatchObject({ degraded: true, degraded_reason: 'llm_unavailable', degraded_regimes: [{ id: 'GDPR_T', controls_without_verdict: 2 }] });
    const comp = result.signals.find((s) => s.derivation.startsWith('GDPR_T'))!;
    expect(comp.derivation).toContain('Compliance not fully evaluated: 2 UNKNOWN have no model verdict');
    expect(comp.severity).toBe('medium');
  });

  it('an unusable answer is also llm_unavailable, not a silent UNKNOWN', async () => {
    const llm = { complete: async () => 'I cannot answer that.' } as unknown as LlmProvider;
    const result = await runCompliancePass(ctxFor(workspace(), llm));
    const iso = (result.assessment['regimes'] as Reg[]).find((r) => r.id === 'ISO_T')!;
    expect(iso.status).toBe('degraded');
    expect(iso.controls[0]!.not_evaluated_reason).toBe('llm_unavailable');
  });

  it('a clean run carries no degraded marker; no provider stays pending-llm, not degraded', async () => {
    const ok = { complete: async (p: string) => JSON.stringify({ controls: [...p.matchAll(/- id: (\S+)/g)].map((m) => ({ id: m[1], outcome: 'PARTIAL', rationale: 'Probe partial.', signal_refs: ['INV-01'] })) }) } as unknown as LlmProvider;
    const clean = await runCompliancePass(ctxFor(workspace(), ok));
    expect(clean.assessment['degraded']).toBeUndefined();
    const none = await runCompliancePass(ctxFor(workspace()));
    expect((none.assessment['regimes'] as Reg[]).map((r) => r.status)).toEqual(['pending-llm', 'pending-llm']);
    expect(none.assessment['degraded']).toBeUndefined();
  });
});
