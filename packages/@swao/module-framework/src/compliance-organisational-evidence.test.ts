// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Framework module -- organisational evidence guard tests (#3962)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3962: a control marked `layer: governance` (an organisational control: a
// policy, a register, a plan) is only SATISFIED or PARTIAL when the model cites
// organisational document evidence, i.e. a signal over a file from the app's
// ingestion folder. Otherwise it is UNKNOWN with insufficient_evidence (needs
// verification), never a pass. Controls without the marker are unchanged.
// Mocked LLM output only.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { complianceNotEvaluatedReason, type PassContext, type LlmProvider } from '@swao/core';
import { runCompliancePass, isOrganisationalEvidenceSignal } from './compliance-evaluator.js';

function catalogue(): string {
  return [
    'regime_meta:', '  id: ORG_TEST', '  name: Organisational test regime', '  version: "1.0"',
    '  authority: SWAO Test Suite', '  catalogue_version: 1.0.0', 'controls:',
    '  - id: ORG_POLICY', '    title: Incident classification policy', '    description: Synthetic organisational control.',
    '    layer: governance',
    '    evidence_basis:', '      - { context_input: incident_classification_policy }',
    '  - id: TECH_LOGS', '    title: Logging', '    description: Synthetic technical control.',
    '    evidence_basis:', '      - { signal_prefix: OBS }',
  ].join('\n') + '\n';
}

function workspace(): { workspacePath: string; passesDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'swao-comp-3962-'));
  const workspacePath = join(root, 'apps', 'demo-app');
  const passesDir = join(workspacePath, 'wsp', 'runs', '2026-11-06T00-00-00', 'passes');
  const catalogDir = join(root, 'wsp', 'inputs', 'catalogs', 'community', 'ORG_TEST');
  mkdirSync(passesDir, { recursive: true });
  mkdirSync(catalogDir, { recursive: true });
  writeFileSync(join(catalogDir, 'controls.yaml'), catalogue());
  writeFileSync(join(workspacePath, '.swao.yml'), 'assessment:\n  regimes_active:\n    - ORG_TEST\n');
  writeFileSync(join(passesDir, '04-ctx.yaml'), [
    'pass:', '  id: 4', '  name: ctx', 'signals:',
    '  - id: CTX-03', '    severity: informational', '    source: llm_inference', '    confidence: high',
    '    derivation: "The incident classification policy applies the Article 18 criteria."',
    // The second entry carries a regulation number that parses as a path (live run 2026-11-06).
    '    evidence: ["wsp/inputs/architecture/guardrails/incident-classification-policy.pdf", "architecture/guardrails/incident-classification-policy.pdf - Delegated Regulation (EU) 2024/1772 Article 9(5)(b) referenced"]',
  ].join('\n') + '\n');
  // An unrelated, blank document (live run 2026-11-06: the LLM intake questionnaire).
  writeFileSync(join(passesDir, '04b-ctx.yaml'), [
    'pass:', '  id: 4', '  name: ctx', 'signals:',
    '  - id: CTX-04', '    severity: informational', '    confidence: high', '    derivation: "Questionnaire sections are blank."',
    '    evidence: ["workshops/llm-intake-questionnaire.docx.extracted.md [part 1/5] - all blank"]',
  ].join('\n') + '\n');
  writeFileSync(join(passesDir, '09-obs.yaml'), [
    'pass:', '  id: 9', '  name: obs', 'signals:',
    '  - id: OBS-02', '    severity: informational', '    confidence: high', '    derivation: "Structured logging configured."',
    '    evidence: ["src/main/resources/logback.xml"]',
  ].join('\n') + '\n');
  return { workspacePath, passesDir };
}

function llmSaying(outcome: string, refsById: Record<string, string[]>): LlmProvider {
  return {
    complete: async (prompt: string): Promise<string> => {
      const ids = [...prompt.matchAll(/- id: (\S+)/g)].map((m) => m[1]!);
      return JSON.stringify({ controls: ids.map((id) => ({ id, outcome, rationale: `Model says ${outcome}.`, signal_refs: refsById[id] ?? [] })) });
    },
  } as unknown as LlmProvider;
}

type Ctl = { id: string; outcome: string; rationale: string; not_evaluated_reason?: string; missing_input?: string[]; assessor: string };

async function run(outcome: string, refsById: Record<string, string[]>) {
  const ws = workspace();
  const ctx = { appId: 'demo-app', sourcePath: ws.workspacePath, workspacePath: ws.workspacePath, iter: 1, assessedAt: '2026-11-06', llm: llmSaying(outcome, refsById), passesDir: ws.passesDir } as PassContext;
  const result = await runCompliancePass(ctx);
  const controls = (result.assessment['regimes'] as Array<{ controls: Ctl[] }>)[0]!.controls;
  return (id: string) => controls.find((c) => c.id === id)!;
}

describe('isOrganisationalEvidenceSignal (#3962)', () => {
  it('a document-backed signal counts; code, missing-input markers and absent signals do not', () => {
    expect(isOrganisationalEvidenceSignal({ id: 'CTX-03', evidence: ['wsp/inputs/compliance/register-of-information.xlsx'] } as never)).toBe(true);
    expect(isOrganisationalEvidenceSignal({ id: 'OBS-02', evidence: ['src/main/resources/logback.xml'] } as never)).toBe(false);
    expect(isOrganisationalEvidenceSignal({ id: 'SCOPE-10', evidence: ['docs/x.pdf'] } as never)).toBe(false);
    expect(isOrganisationalEvidenceSignal(undefined)).toBe(false);
    const policy = { id: 'CTX-03', evidence: ['wsp/inputs/architecture/guardrails/incident-classification-policy.pdf'] } as never;
    expect(isOrganisationalEvidenceSignal(policy, undefined, ['incident_classification_policy'])).toBe(true);
    expect(isOrganisationalEvidenceSignal(policy, undefined, ['incident_management_procedure'])).toBe(false);
  });
});

describe('Pass 11 organisational evidence guard (#3962)', () => {
  it('SATISFIED with no cited signal becomes UNKNOWN insufficient_evidence with the expected input named', async () => {
    const byId = await run('SATISFIED', {});
    const c = byId('ORG_POLICY');
    expect(c).toMatchObject({ outcome: 'UNKNOWN', not_evaluated_reason: 'insufficient_evidence', missing_input: ['incident_classification_policy'], assessor: 'rule_engine' });
    expect(complianceNotEvaluatedReason({ rationale: c.rationale })).toBe('insufficient_evidence');
    expect(c.rationale).toContain('never a pass');
  });

  it('SATISFIED citing only a code signal is not a pass either', async () => {
    const byId = await run('SATISFIED', { ORG_POLICY: ['OBS-02'] });
    expect(byId('ORG_POLICY')).toMatchObject({ outcome: 'UNKNOWN', not_evaluated_reason: 'insufficient_evidence' });
  });

  it('PARTIAL without organisational evidence is downgraded too', async () => {
    const byId = await run('PARTIAL', { ORG_POLICY: ['OBS-02'] });
    expect(byId('ORG_POLICY').outcome).toBe('UNKNOWN');
  });

  it('SATISFIED citing an ingested document stays SATISFIED', async () => {
    const byId = await run('SATISFIED', { ORG_POLICY: ['CTX-03'] });
    expect(byId('ORG_POLICY')).toMatchObject({ outcome: 'SATISFIED', assessor: 'llm' });
    expect(byId('ORG_POLICY').not_evaluated_reason).toBeUndefined();
  });

  it('a SATISFIED citing only an unrelated document (not an expected input) is not a pass', async () => {
    const byId = await run('SATISFIED', { ORG_POLICY: ['CTX-04'] });
    expect(byId('ORG_POLICY')).toMatchObject({ outcome: 'UNKNOWN', not_evaluated_reason: 'insufficient_evidence' });
  });

  it('a control without layer: governance keeps a SATISFIED that cites a code signal', async () => {
    const byId = await run('SATISFIED', { TECH_LOGS: ['OBS-02'] });
    expect(byId('TECH_LOGS')).toMatchObject({ outcome: 'SATISFIED', assessor: 'llm' });
  });
});
