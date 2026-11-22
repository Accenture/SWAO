// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Framework module -- Client LZ Policy Baseline by rule (#3888)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3888 (Design 123 section 8.4, CP-4): the controls of a Client LZ Policy
// Baseline (a framework folder with policy-baseline.yaml) are decided by the
// rule engine, never by the LLM. The host's decisions arrive on the
// PassContext; without them every baseline control is UNKNOWN by rule. The
// shipped framework folder is copied into a temporary workspace.

import { describe, it, expect } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { BaselineControlDecisions, LlmProvider, PassContext } from '@swao/core';
import { isPolicyBaselineRegime, runCompliancePass } from './compliance-evaluator.js';

const SHIPPED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'community-frameworks', 'frameworks', 'client-lz-policy-baseline');
const FW = 'CLIENT_LZ_POLICY_BASELINE';

function workspace(withOther: boolean): { root: string; workspacePath: string; passesDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'swao-comp-baseline-'));
  const workspacePath = join(root, 'apps', 'demo-app');
  const passesDir = join(workspacePath, 'wsp', 'runs', '2026-11-05T00-00-00', 'passes');
  mkdirSync(passesDir, { recursive: true });
  const community = join(root, 'wsp', 'inputs', 'catalogs', 'community');
  cpSync(SHIPPED, join(community, 'client-lz-policy-baseline'), { recursive: true });
  const regimes = [FW];
  if (withOther) {
    mkdirSync(join(community, 'app-reg'), { recursive: true });
    writeFileSync(join(community, 'app-reg', 'controls.yaml'), ['regime_meta:', '  id: APP_REG', '  name: APP_REG test regime', '  version: "1.0"', '  authority: SWAO Test Suite', '  catalogue_version: 1.0.0', 'controls:', '  - id: AR_1', '    title: Control AR_1', '    description: Synthetic control.', '    severity_default: high', ''].join('\n'));
    regimes.push('APP_REG');
  }
  writeFileSync(join(workspacePath, '.swao.yml'), ['assessment:', '  regimes_active:', ...regimes.map((r) => `    - ${r}`)].join('\n') + '\n');
  writeFileSync(join(passesDir, '01-inv.yaml'), 'pass:\n  id: 1\n  name: inventory\nsignals:\n  - id: INV-01\n    severity: high\n    derivation: "probe"\n');
  return { root, workspacePath, passesDir };
}

/** An LLM that fails every call and records the prompts it was given. */
function failingLlm(prompts: string[]): LlmProvider {
  return { complete: async (prompt: string): Promise<string> => { prompts.push(prompt); throw new Error('the LLM must not be called for baseline controls'); } } as unknown as LlmProvider;
}
function gapLlm(prompts: string[]): LlmProvider {
  return {
    complete: async (prompt: string): Promise<string> => {
      prompts.push(prompt);
      const ids = [...prompt.matchAll(/- id: (\S+)/g)].map((m) => m[1]!);
      return JSON.stringify({ controls: ids.map((id) => ({ id, outcome: 'GAP', rationale: `Probe ${id}.`, signal_refs: ['INV-01'], remediation: 'Fix it.' })) });
    },
  } as unknown as LlmProvider;
}

const ctxFor = (ws: { workspacePath: string; passesDir: string }, llm?: LlmProvider, baselineDecisions?: BaselineControlDecisions): PassContext => ({
  appId: 'demo-app', sourcePath: ws.workspacePath, workspacePath: ws.workspacePath, iter: 1, assessedAt: '2026-11-05', passesDir: ws.passesDir,
  assessmentType: 'application', ...(llm ? { llm } : {}), ...(baselineDecisions ? { baselineDecisions } : {}),
} as PassContext);

type Ctl = { id: string; outcome: string; rationale: string; assessor: string };
type Reg = { id: string; status: string; controls: Ctl[] };

const DECISIONS: BaselineControlDecisions = {
  source: 'catalogue',
  regimes: {
    [FW]: {
      'CPB-RES-01': { policy_id: 'CPB-RES-01', outcome: 'SATISFIED', rationale: 'CPB-RES-01 (region_residency): target regions: otc/eu-de allowed. Decided by the baseline rule engine, no LLM evaluation.' },
      'CPB-SVC-01': { policy_id: 'CPB-SVC-01', outcome: 'GAP', rationale: 'CPB-SVC-01 (service_deny): the app needs x. Decided by the baseline rule engine, no LLM evaluation.' },
      'CPB-RES-02': { policy_id: 'CPB-RES-02', outcome: 'PARTIAL', rationale: 'CPB-RES-02: probe. Decided by the baseline rule engine, no LLM evaluation.' },
    },
  },
};

describe('Client LZ Policy Baseline controls are decided by rule (#3888, CP-4)', () => {
  it('detects the baseline regime by its policy-baseline.yaml', () => {
    const ws = workspace(true);
    expect(isPolicyBaselineRegime(ws.root, FW)).toBe(true);
    expect(isPolicyBaselineRegime(ws.root, 'APP_REG')).toBe(false);
  });

  it('with a failing LLM: no call is made; the host decisions become rule-engine outcomes; the regime is evaluated', async () => {
    const ws = workspace(false);
    const prompts: string[] = [];
    const result = await runCompliancePass(ctxFor(ws, failingLlm(prompts), DECISIONS));
    expect(prompts).toEqual([]);
    const reg = (result.assessment['regimes'] as Reg[]).find((r) => r.id === FW)!;
    expect(reg.status).toBe('evaluated');
    expect(reg.controls.every((c) => c.assessor === 'rule_engine')).toBe(true);
    expect(reg.controls.find((c) => c.id === 'CPB-RES-01')).toMatchObject({ outcome: 'SATISFIED' });
    expect(reg.controls.find((c) => c.id === 'CPB-SVC-01')).toMatchObject({ outcome: 'GAP' });
    expect(reg.controls.find((c) => c.id === 'CPB-RES-02')).toMatchObject({ outcome: 'PARTIAL' });
    // a control without a decision is UNKNOWN by rule, with the reason
    const other = reg.controls.find((c) => !(c.id in (DECISIONS.regimes[FW] ?? {})))!;
    expect(other).toMatchObject({ outcome: 'UNKNOWN', assessor: 'rule_engine' });
    expect(other.rationale).toMatch(/decided by rule only/);
    // the COMP roll-up counts the baseline like any regime
    const comp = (result.signals as { derivation: string; severity: string }[])[0]!;
    expect(comp.derivation).toMatch(new RegExp(`^${FW}: 1 SATISFIED, 1 PARTIAL, 1 GAP, ${reg.controls.length - 3} UNKNOWN, 0 N/A out of ${reg.controls.length} controls`));
    expect(comp.severity).toBe('high');
  });

  it('without decisions and without an LLM: every baseline control is UNKNOWN by rule, never pending-llm', async () => {
    const ws = workspace(false);
    const result = await runCompliancePass(ctxFor(ws));
    const reg = (result.assessment['regimes'] as Reg[]).find((r) => r.id === FW)!;
    expect(reg.controls.every((c) => c.outcome === 'UNKNOWN' && c.assessor === 'rule_engine')).toBe(true);
    expect(reg.status).not.toBe('pending-llm');
    const none = await runCompliancePass(ctxFor(ws, undefined, { source: 'none', regimes: {}, reason: 'the inline LZ fit is off (--no-lz-fit)' }));
    expect((none.assessment['regimes'] as Reg[])[0]!.controls[0]!.rationale).toMatch(/--no-lz-fit/);
  });

  it('a mixed run: the other regime goes to the LLM, no prompt names a baseline control', async () => {
    const ws = workspace(true);
    const prompts: string[] = [];
    const result = await runCompliancePass(ctxFor(ws, gapLlm(prompts), DECISIONS));
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) expect(p).not.toMatch(/CPB-/);
    const regs = result.assessment['regimes'] as Reg[];
    expect(regs.find((r) => r.id === 'APP_REG')!.controls[0]).toMatchObject({ outcome: 'GAP', assessor: 'llm' });
    expect(regs.find((r) => r.id === FW)!.controls.every((c) => c.assessor === 'rule_engine')).toBe(true);
  });
});

describe('ranked contributions reach the evaluated control (#3981)', () => {
  it('a decision with contributions carries them as baseline_contributions; one without does not', async () => {
    const ws = workspace(false);
    const contributions = [
      { scope_id: 'app-b', provider: 'otc', outcome: 'GAP' as const, rationale: 'estate fail (observed): 2 of 3 lack x' },
      { scope_id: 'platform', provider: 'otc', outcome: 'SATISFIED' as const, rationale: 'estate pass (observed): ok' },
    ];
    const withContrib: BaselineControlDecisions = {
      source: 'live',
      regimes: { [FW]: { ...DECISIONS.regimes[FW], 'CPB-RES-01': { policy_id: 'CPB-RES-01', outcome: 'GAP', rationale: 'CPB-RES-01: live. Decided by the baseline rule engine, no LLM evaluation.', contributions } } },
    };
    const result = await runCompliancePass(ctxFor(ws, undefined, withContrib));
    const reg = (result.assessment['regimes'] as Array<{ id: string; controls: Array<Ctl & { baseline_contributions?: unknown }> }>).find((r) => r.id === FW)!;
    expect(reg.controls.find((c) => c.id === 'CPB-RES-01')!.baseline_contributions).toEqual(contributions);
    expect(reg.controls.find((c) => c.id === 'CPB-SVC-01')!.baseline_contributions).toBeUndefined();
  });
});
