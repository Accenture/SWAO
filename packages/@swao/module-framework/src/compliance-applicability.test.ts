// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Framework module -- Pass 11 applicability pre-filter tests (#3425)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3425: Pass 11 applies Design 104 Q-CODE-7 `applies_when` and the per-control
// `assessment_type_scope` deterministically, before any LLM call. Synthetic
// fixtures only. NOTE: the scope cases need @swao/core rebuilt (dist), because
// the catalogue schema that keeps control-level `assessment_type_scope` lives
// in core (regime-catalogue.ts).

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { PassContext, LlmProvider } from '@swao/core';
import {
  runCompliancePass,
  appliesWhenMatches,
  assessmentScopeTokens,
  controlApplicability,
  loadApplicabilityContext,
} from './compliance-evaluator.js';

const SECTORS: Array<[string, string]> = [
  ['KT_SEC_ENE', 'energy|water'],
  ['KT_SEC_HLT', 'health'],
  ['KT_SEC_FIN', 'finance'],
  ['KT_SEC_TRN', 'transport'],
  ['KT_SEC_ICT', 'ict'],
];

/** A synthetic KRITIS-like catalogue: 3 evaluable, 5 sector-conditional, 1 audit-only. */
function kritisLikeCatalogue(): string {
  const l = [
    'regime_meta:', '  id: KRITIS_TEST', '  name: KRITIS-like test regime', '  version: "1.0"',
    '  authority: SWAO Test Suite', '  catalogue_version: 1.0.0', 'controls:',
  ];
  const ctl = (id: string, extra: string[] = []) => l.push(
    `  - id: ${id}`, `    title: Control ${id}`, '    description: Synthetic applicability probe control.',
    '    severity_default: high', ...extra,
  );
  ctl('KT_GOV_1');
  ctl('KT_GOV_2', ['    assessment_type_scope: [app, aud]']);
  ctl('KT_GOV_3', ['    assessment_type_scope: [app, aud]']);
  for (const [id, sector] of SECTORS) {
    ctl(id, ['    assessment_type_scope: [aud]', '    applies_when:', `      kritis_sector: "${sector}"`]);
  }
  ctl('KT_SEC_DACHG', ['    assessment_type_scope: [aud]']);
  return l.join('\n') + '\n';
}

function buildWorkspace(swaoYmlExtra: string[]): { workspacePath: string; passesDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'swao-comp-3425-'));
  const workspacePath = join(root, 'apps', 'demo-app');
  const passesDir = join(workspacePath, 'wsp', 'runs', '2026-10-23T00-00-00', 'passes');
  const catalogDir = join(root, 'wsp', 'inputs', 'catalogs', 'community', 'KRITIS_TEST');
  mkdirSync(passesDir, { recursive: true });
  mkdirSync(catalogDir, { recursive: true });
  writeFileSync(join(catalogDir, 'controls.yaml'), kritisLikeCatalogue());
  writeFileSync(join(workspacePath, '.swao.yml'),
    ['assessment:', '  regimes_active:', '    - KRITIS_TEST', ...swaoYmlExtra].join('\n') + '\n');
  writeFileSync(join(passesDir, '01-inv.yaml'),
    'pass:\n  id: 1\n  name: inventory\nsignals:\n  - id: INV-01\n    severity: high\n    derivation: "probe"\n');
  return { workspacePath, passesDir };
}

/** Mock LLM that records prompts; GOV_1 -> GAP, GOV_2/3 -> PARTIAL, anything else -> GAP. */
function recordingLlm(): { llm: LlmProvider; prompts: string[] } {
  const prompts: string[] = [];
  const llm = {
    complete: async (prompt: string): Promise<string> => {
      prompts.push(prompt);
      const ids = [...prompt.matchAll(/- id: (\S+)/g)].map((m) => m[1]!);
      return JSON.stringify({
        controls: ids.map((id) => ({
          id,
          outcome: id === 'KT_GOV_2' || id === 'KT_GOV_3' ? 'PARTIAL' : 'GAP',
          rationale: `Probe rationale for ${id}.`,
          signal_refs: ['INV-01'],
          remediation: 'Fix it.',
        })),
      });
    },
  } as unknown as LlmProvider;
  return { llm, prompts };
}

function ctxFor(ws: { workspacePath: string; passesDir: string }, llm?: LlmProvider): PassContext {
  return { appId: 'demo-app', sourcePath: ws.workspacePath, workspacePath: ws.workspacePath, iter: 1, assessedAt: '2026-10-23', llm, passesDir: ws.passesDir };
}

type OutControl = { id: string; outcome: string; status: string; assessor: string; rationale: string };
function controlsOf(result: Awaited<ReturnType<typeof runCompliancePass>>): OutControl[] {
  const regimes = (result.assessment['regimes'] as Array<{ controls: OutControl[] }>);
  return regimes[0]!.controls;
}
function tally(controls: OutControl[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const c of controls) t[c.outcome] = (t[c.outcome] ?? 0) + 1;
  return t;
}

describe('appliesWhenMatches (#3425, Design 104 Q-CODE-7)', () => {
  it('applies when there is no condition', () => {
    expect(appliesWhenMatches(undefined, undefined)).toBe(true);
    expect(appliesWhenMatches({}, undefined)).toBe(true);
  });
  it('does not apply when the key is missing or mismatched', () => {
    expect(appliesWhenMatches({ kritis_sector: 'health' }, undefined)).toBe(false);
    expect(appliesWhenMatches({ kritis_sector: 'health' }, {})).toBe(false);
    expect(appliesWhenMatches({ kritis_sector: 'health' }, { kritis_sector: 'finance' })).toBe(false);
  });
  it('matches exact values and |-separated alternatives', () => {
    expect(appliesWhenMatches({ kritis_sector: 'health' }, { kritis_sector: 'health' })).toBe(true);
    expect(appliesWhenMatches({ kritis_sector: 'energy|water' }, { kritis_sector: 'water' })).toBe(true);
    expect(appliesWhenMatches({ kritis_sector: 'energy|water' }, { kritis_sector: 'energy|water' })).toBe(false);
  });
});

describe('assessmentScopeTokens (#3425)', () => {
  it('maps the router vocabulary to catalogue scope tokens', () => {
    expect(assessmentScopeTokens(undefined)).toEqual(['app']);
    expect(assessmentScopeTokens('application')).toEqual(['app']);
    expect(assessmentScopeTokens('source-code')).toEqual(['app']);
    expect(assessmentScopeTokens('audit')).toEqual(['aud']);
    expect(assessmentScopeTokens('hybrid')).toEqual(['app', 'aud']);
    expect(assessmentScopeTokens('landing-zone')).toEqual(['lz']);
    expect(assessmentScopeTokens('service')).toEqual(['service']);
    expect(assessmentScopeTokens('llm')).toEqual(['llm']);
    expect(assessmentScopeTokens('workshop')).toBeNull();
  });
});

describe('controlApplicability (#3425)', () => {
  const app = { scopeTokens: ['app'] as const };
  it('an applies_when mismatch is N/A even when the control is also out of scope', () => {
    expect(controlApplicability({ applies_when: { kritis_sector: 'health' }, assessment_type_scope: ['aud'] }, app).kind).toBe('not_applicable');
  });
  it('a matching control outside the run scope is out_of_scope', () => {
    expect(controlApplicability(
      { applies_when: { kritis_sector: 'health' }, assessment_type_scope: ['aud'] },
      { ...app, frameworkContext: { kritis_sector: 'health' } },
    ).kind).toBe('out_of_scope');
  });
  it('unscoped controls and an unknown run type are evaluated', () => {
    expect(controlApplicability({}, app).kind).toBe('evaluate');
    expect(controlApplicability({ assessment_type_scope: ['aud'] }, { scopeTokens: null }).kind).toBe('evaluate');
    expect(controlApplicability({ assessment_type_scope: ['app', 'aud'] }, app).kind).toBe('evaluate');
  });
});

describe('loadApplicabilityContext (#3425)', () => {
  it('reads framework_context and assessment.type, stringifying scalars', () => {
    const ws = buildWorkspace(['  type: audit', 'framework_context:', '  kritis_sector: health', '  has_ot_systems: true']);
    expect(loadApplicabilityContext(ws.workspacePath)).toEqual({
      frameworkContext: { kritis_sector: 'health', has_ot_systems: 'true' },
      scopeTokens: ['aud'],
    });
  });
});

describe('runCompliancePass applicability pre-filter (#3425)', () => {
  it('orders-api-like fixture: 1 GAP / 2 PARTIAL / 5 N_A, sector and audit-only controls never reach the LLM', async () => {
    const ws = buildWorkspace(['framework_context:', '  kritis_sector: public_administration']);
    const { llm, prompts } = recordingLlm();
    const controls = controlsOf(await runCompliancePass(ctxFor(ws, llm)));

    expect(controls.map((c) => c.id)).toEqual(['KT_GOV_1', 'KT_GOV_2', 'KT_GOV_3', ...SECTORS.map(([id]) => id), 'KT_SEC_DACHG']);
    expect(tally(controls)).toEqual({ GAP: 1, PARTIAL: 2, N_A: 5, UNKNOWN: 1 });
    for (const [id] of SECTORS) {
      const c = controls.find((x) => x.id === id)!;
      expect(c).toMatchObject({ outcome: 'N_A', status: 'N_A', assessor: 'rule_engine' });
      expect(c.rationale).toContain('kritis_sector');
    }
    expect(controls.find((c) => c.id === 'KT_SEC_DACHG')).toMatchObject({ outcome: 'UNKNOWN', assessor: 'rule_engine' });

    const sent = prompts.join('\n');
    expect(sent).toContain('KT_GOV_1');
    for (const id of [...SECTORS.map(([x]) => x), 'KT_SEC_DACHG']) expect(sent).not.toContain(id);
  });

  it('marks sector controls N/A without an LLM provider too', async () => {
    const ws = buildWorkspace([]);
    const controls = controlsOf(await runCompliancePass(ctxFor(ws)));
    expect(controls.filter((c) => c.outcome === 'N_A').map((c) => c.id)).toEqual(SECTORS.map(([id]) => id));
  });

  it('an audit run evaluates the audit-scoped controls; a matching sector is sent to the LLM', async () => {
    const ws = buildWorkspace(['  type: audit', 'framework_context:', '  kritis_sector: water']);
    const { llm, prompts } = recordingLlm();
    const controls = controlsOf(await runCompliancePass(ctxFor(ws, llm)));
    expect(controls.find((c) => c.id === 'KT_SEC_ENE')).toMatchObject({ outcome: 'GAP', assessor: 'llm' });
    expect(controls.find((c) => c.id === 'KT_SEC_DACHG')).toMatchObject({ assessor: 'llm' });
    expect(controls.filter((c) => c.outcome === 'N_A')).toHaveLength(4);
    expect(prompts.join('\n')).not.toContain('KT_SEC_HLT');
  });

  it('the COMP roll-up counts the rule-decided N/A controls', async () => {
    const ws = buildWorkspace([]);
    const { llm } = recordingLlm();
    const result = await runCompliancePass(ctxFor(ws, llm));
    expect(result.signals[0]!.derivation).toMatch(/1 GAP, 1 UNKNOWN, 5 N\/A out of 9 controls\. 1 UNKNOWN are outside the assessment type scope\./);
  });
});
