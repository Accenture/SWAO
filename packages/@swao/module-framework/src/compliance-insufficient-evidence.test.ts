// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Framework module -- GAP vs insufficient evidence tests (#3426)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3426: GDPR Art. 44-49 were "Fail" only because the data-processing
// agreements were not supplied (SCOPE-10). Pass 11 now post-checks every LLM
// GAP: one that cites only missing-input signals (SCOPE-*, *-00), or a
// context_input control without any real negative finding, becomes UNKNOWN
// with not_evaluated_reason insufficient_evidence. Mocked LLM output only.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { complianceNotEvaluatedReason, type PassContext, type LlmProvider } from '@swao/core';
import { runCompliancePass, isInsufficientInputSignal } from './compliance-evaluator.js';

/** Synthetic GDPR-like catalogue; ART_44/ART_46 expect a context_input, ART_32 is signal-based. */
function catalogue(): string {
  return [
    'regime_meta:', '  id: GDPR_TEST', '  name: GDPR-like test regime', '  version: "1.0"',
    '  authority: SWAO Test Suite', '  catalogue_version: 1.0.0', 'controls:',
    '  - id: ART_44', '    title: Transfer principle', '    description: Synthetic transfer control.', '    severity_default: high',
    '    evidence_basis:', '      - { context_input: "evidence/05-art-44-transfer-principle.md" }',
    '  - id: ART_46', '    title: Appropriate safeguards', '    description: Synthetic safeguards control.', '    severity_default: high',
    '    evidence_basis:', '      - { context_input: "evidence/05-art-46-safeguards.md" }',
    '  - id: ART_32', '    title: Security of processing', '    description: Synthetic security control.', '    severity_default: high',
    '    evidence_basis:', '      - { signal_prefix: CRYPTO }',
    '  - id: ART_49', '    title: Derogations', '    description: Synthetic derogation control.', '    severity_default: medium',
    '    evidence_basis:', '      - { context_input: "evidence/05-art-49-derogations.md" }',
  ].join('\n') + '\n';
}

function workspace(): { workspacePath: string; passesDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'swao-comp-3426-'));
  const workspacePath = join(root, 'apps', 'demo-app');
  const passesDir = join(workspacePath, 'wsp', 'runs', '2026-10-23T00-00-00', 'passes');
  const catalogDir = join(root, 'wsp', 'inputs', 'catalogs', 'community', 'GDPR_TEST');
  mkdirSync(passesDir, { recursive: true });
  mkdirSync(catalogDir, { recursive: true });
  writeFileSync(join(catalogDir, 'controls.yaml'), catalogue());
  writeFileSync(join(workspacePath, '.swao.yml'), 'assessment:\n  regimes_active:\n    - GDPR_TEST\n');
  writeFileSync(join(passesDir, '13-scope.yaml'), [
    'pass:', '  id: 13', '  name: scope', 'signals:',
    '  - id: SCOPE-10', '    severity: medium', '    derivation: "Data processing agreements were not supplied; out of scope for this run."',
    '  - id: CRYPTO-05', '    severity: high', '    outcome: negative', '    derivation: "TLS 1.0 still enabled on the public endpoint."',
    '  - id: DATA-00', '    severity: informational', '    derivation: "Data classification pass skipped (no LLM provider)."',
  ].join('\n') + '\n');
  return { workspacePath, passesDir };
}

/** Mocked LLM: every control GAP; refs per control id. */
function gapLlm(refsById: Record<string, string[]>): LlmProvider {
  return {
    complete: async (prompt: string): Promise<string> => {
      const ids = [...prompt.matchAll(/- id: (\S+)/g)].map((m) => m[1]!);
      return JSON.stringify({ controls: ids.map((id) => ({
        id, outcome: 'GAP', rationale: `Model says ${id} is not met.`, signal_refs: refsById[id] ?? [], remediation: 'Fix it.',
      })) });
    },
  } as unknown as LlmProvider;
}

const ctxFor = (ws: { workspacePath: string; passesDir: string }, llm: LlmProvider): PassContext =>
  ({ appId: 'demo-app', sourcePath: ws.workspacePath, workspacePath: ws.workspacePath, iter: 1, assessedAt: '2026-10-23', llm, passesDir: ws.passesDir });

type Ctl = { id: string; outcome: string; status: string; rationale: string; signal_refs: string[]; not_evaluated_reason?: string; missing_input?: string[] };

async function run(refsById: Record<string, string[]>) {
  const result = await runCompliancePass(ctxFor(workspace(), gapLlm(refsById)));
  const controls = (result.assessment['regimes'] as Array<{ controls: Ctl[] }>)[0]!.controls;
  return { result, byId: (id: string) => controls.find((c) => c.id === id)! };
}

describe('isInsufficientInputSignal (#3426)', () => {
  it('scope signals and skipped-pass markers', () => {
    expect(isInsufficientInputSignal('SCOPE-10')).toBe(true);
    expect(isInsufficientInputSignal('DATA-00')).toBe(true);
    expect(isInsufficientInputSignal('CRYPTO-05')).toBe(false);
    expect(isInsufficientInputSignal('DATA-01')).toBe(false);
  });
});

describe('Pass 11 GAP post-check (#3426)', () => {
  it('scope-only: a GAP citing only SCOPE-10 becomes not assessed with the missing input named', async () => {
    const { byId } = await run({ ART_44: ['SCOPE-10'] });
    const c = byId('ART_44');
    expect(c).toMatchObject({ outcome: 'UNKNOWN', status: 'UNKNOWN', not_evaluated_reason: 'insufficient_evidence', missing_input: ['evidence/05-art-44-transfer-principle.md'] });
    expect(c.rationale).toContain('missing input: evidence/05-art-44-transfer-principle.md');
    expect(complianceNotEvaluatedReason({ rationale: c.rationale })).toBe('insufficient_evidence');
    // The SCOPE signal stays linked so the publication can point to its closure hint.
    expect(c.signal_refs).toEqual(['SCOPE-10']);
  });

  it('skipped-pass marker only: downgraded too', async () => {
    const { byId } = await run({ ART_32: ['DATA-00'] });
    expect(byId('ART_32')).toMatchObject({ outcome: 'UNKNOWN', not_evaluated_reason: 'insufficient_evidence' });
  });

  it('mixed: SCOPE-10 plus a real negative CRYPTO signal stays GAP', async () => {
    const { byId } = await run({ ART_46: ['SCOPE-10', 'CRYPTO-05'] });
    expect(byId('ART_46')).toMatchObject({ outcome: 'GAP', status: 'GAP' });
    expect(byId('ART_46').not_evaluated_reason).toBeUndefined();
  });

  it('real negative only: a signal-based GAP stays GAP', async () => {
    const { byId } = await run({ ART_32: ['CRYPTO-05'] });
    expect(byId('ART_32')).toMatchObject({ outcome: 'GAP' });
  });

  it('context_input control with no cited finding becomes not assessed', async () => {
    const { byId } = await run({ ART_49: [] });
    expect(byId('ART_49')).toMatchObject({ outcome: 'UNKNOWN', not_evaluated_reason: 'insufficient_evidence', missing_input: ['evidence/05-art-49-derogations.md'] });
  });

  it('the COMP roll-up counts the downgraded controls under UNKNOWN', async () => {
    const { result } = await run({ ART_44: ['SCOPE-10'], ART_46: ['SCOPE-10'], ART_32: ['CRYPTO-05'], ART_49: ['SCOPE-10'] });
    expect(result.signals[0]!.derivation).toMatch(/0 SATISFIED, 0 PARTIAL, 1 GAP, 3 UNKNOWN, 0 N\/A out of 4 controls\./);
  });

  it('the prompt tells the model that missing input means UNKNOWN, never GAP', async () => {
    const prompts: string[] = [];
    const llm = { complete: async (p: string) => { prompts.push(p); return '{"controls":[]}'; } } as unknown as LlmProvider;
    await runCompliancePass(ctxFor(workspace(), llm));
    expect(prompts[0]).toContain('UNKNOWN, never GAP');
  });
});
