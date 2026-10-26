// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Framework module -- Pass 11 test-code marker (#3403)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3403: signals marked test_code (assessment.test_code tag / exclude) reach
// the compliance model with the marker and a rule; runs without marked
// signals get the unchanged prompt. Synthetic fixtures only.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { PassContext, LlmProvider } from '@swao/core';
import { runCompliancePass } from './compliance-evaluator.js';

function buildWorkspace(signalsYaml: string): { workspacePath: string; passesDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'swao-comp-3403-'));
  const workspacePath = join(root, 'apps', 'demo-app');
  const passesDir = join(workspacePath, 'wsp', 'runs', '2026-10-24T00-00-00', 'passes');
  const catalogDir = join(root, 'wsp', 'inputs', 'catalogs', 'community', 'TC_TEST');
  mkdirSync(passesDir, { recursive: true });
  mkdirSync(catalogDir, { recursive: true });
  writeFileSync(join(catalogDir, 'controls.yaml'), [
    'regime_meta:', '  id: TC_TEST', '  name: Test-code probe regime', '  version: "1.0"',
    '  authority: SWAO Test Suite', '  catalogue_version: 1.0.0', 'controls:',
    '  - id: TC_CRYPTO_1', '    title: Strong cryptography', '    description: Data is encrypted with current algorithms.',
    '    severity_default: high',
  ].join('\n') + '\n');
  writeFileSync(join(workspacePath, '.swao.yml'), 'assessment:\n  regimes_active:\n    - TC_TEST\n');
  writeFileSync(join(passesDir, '08-crypto.yaml'), `pass:\n  id: 8\n  name: crypto\nsignals:\n${signalsYaml}`);
  return { workspacePath, passesDir };
}

function recordingLlm(prompts: string[]): LlmProvider {
  return {
    complete: async (prompt: string): Promise<string> => {
      prompts.push(prompt);
      return JSON.stringify({ controls: [{ id: 'TC_CRYPTO_1', outcome: 'PARTIAL', rationale: 'Probe rationale.', signal_refs: ['CRYPTO-03'], remediation: 'Fix.' }] });
    },
  } as unknown as LlmProvider;
}

function ctxFor(ws: { workspacePath: string; passesDir: string }, llm: LlmProvider): PassContext {
  return { appId: 'demo-app', sourcePath: ws.workspacePath, workspacePath: ws.workspacePath, iter: 1, assessedAt: '2026-10-24', llm, passesDir: ws.passesDir };
}

describe('Pass 11 test-code marker (#3403)', () => {
  it('labels marked signals and adds the test-code rule', async () => {
    const ws = buildWorkspace([
      '  - id: CRYPTO-03', '    severity: medium', '    severity_original: high', '    test_code: true',
      '    derivation: "3DES (DESede) referenced in a BDD test helper."',
      '    evidence: ["src/test/java/ZugangsdatenVergessenITest.java:238"]',
      '  - id: CRYPTO-04', '    severity: high', '    derivation: "RC4 referenced in production code path."',
      '    evidence: ["src/main/java/Legacy.java:10"]', '',
    ].join('\n'));
    const prompts: string[] = [];
    await runCompliancePass(ctxFor(ws, recordingLlm(prompts)));
    expect(prompts.length).toBeGreaterThan(0);
    // #3414: confidence (when present), path class and evidence count per signal.
    expect(prompts[0]).toContain('- CRYPTO-03 [medium, evidence: test code (1)]:');
    expect(prompts[0]).toContain('- CRYPTO-04 [high, evidence: production (1)]:');
    expect(prompts[0]).toContain('Signals with "evidence: test code" rest on test code only');
  });

  it('leaves the prompt unchanged when no signal is marked', async () => {
    const ws = buildWorkspace([
      '  - id: CRYPTO-04', '    severity: high', '    derivation: "RC4 referenced in production code path."',
      '    evidence: ["src/main/java/Legacy.java:10"]', '',
    ].join('\n'));
    const prompts: string[] = [];
    await runCompliancePass(ctxFor(ws, recordingLlm(prompts)));
    expect(prompts[0]).not.toContain('test code');
  });
});
