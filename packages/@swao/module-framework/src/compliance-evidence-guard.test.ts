// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Framework module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3414: one weak-crypto substring hit in test code drove several GDPR
// controls to GAP. Pass 11 now caps a model GAP at PARTIAL (reason
// unverified_evidence) when no cited signal is verified evidence: all cited
// signals are test code only, low confidence, or LLM-inferred without file
// evidence. A GAP backed by one verified production signal stays GAP.
// Mocked LLM output and synthetic fixtures only.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { UNVERIFIED_EVIDENCE_RATIONALE_PREFIX, complianceNotEvaluatedReason, type PassContext, type LlmProvider, type Signal } from '@swao/core';
import { runCompliancePass, signalEvidenceIssues } from './compliance-evaluator.js';

function catalogue(): string {
  return [
    'regime_meta:', '  id: GDPR_TEST', '  name: GDPR-like test regime', '  version: "1.0"',
    '  authority: SWAO Test Suite', '  catalogue_version: 1.0.0', 'controls:',
    '  - id: ART_32_1_A', '    title: Encryption of personal data', '    description: Synthetic encryption control.', '    severity_default: high',
    '  - id: ART_5_1_F', '    title: Integrity and confidentiality', '    description: Synthetic integrity control.', '    severity_default: high',
    '  - id: ART_44', '    title: Transfer principle', '    description: Synthetic transfer control.', '    severity_default: high',
    '    evidence_basis:', '      - { context_input: "evidence/05-art-44-transfer-principle.md" }',
    '  - id: ART_SECTOR', '    title: Sector rule', '    description: Synthetic sector control.', '    severity_default: medium',
    '    applies_when:', '      kritis_sector: energy',
  ].join('\n') + '\n';
}

const SIGNALS = [
  'pass:', '  id: 8', '  name: crypto', 'signals:',
  // Test-only catalogue hit: test path and low confidence (#3411).
  '  - id: CRYPTO-01', '    severity: high', '    confidence: low', '    assessor: rule_engine',
  '    derivation: "3DES (DESede) referenced in test code only."',
  '    evidence: ["src/test/java/com/example/CryptoHelperTest.java:238"]',
  // Test path but no low confidence: test code alone is enough.
  '  - id: CRYPTO-02', '    severity: medium', '    confidence: high', '    assessor: rule_engine',
  '    derivation: "MD5 in a test fixture."',
  '    evidence: ["src/test/java/com/example/HashFixture.java"]',
  // Production path, low confidence (bare token).
  '  - id: CRYPTO-03', '    severity: high', '    confidence: low', '    assessor: rule_engine',
  '    derivation: "Bare token SHA1 in production code."',
  '    evidence: ["src/main/java/com/example/Util.java:12"]',
  // Production, high confidence: Cipher.getInstance("DESede").
  '  - id: CRYPTO-04', '    severity: high', '    confidence: high', '    assessor: rule_engine',
  '    derivation: "Cipher.getInstance(\\"DESede\\") in production code."',
  '    evidence: ["src/main/java/com/example/LegacyCipher.java:40"]',
  // One signal, mixed evidence (production + test), high confidence.
  '  - id: CRYPTO-05', '    severity: high', '    confidence: high', '    assessor: rule_engine',
  '    derivation: "RC4 in production and test code."',
  '    evidence: ["src/main/java/com/example/Rc4.java:9", "src/test/java/com/example/Rc4Test.java:3"]',
  // LLM-derived, no file evidence.
  '  - id: DATA-07', '    severity: high', '    confidence: medium', '    source: llm_inference',
  '    derivation: "Personal data probably unencrypted at rest."',
  // High-confidence personal data in a test resource (fake data fixture).
  '  - id: DATA-08', '    severity: high', '    confidence: high', '    assessor: rule_engine',
  '    derivation: "E-mail addresses found in a CSV file."',
  '    evidence: ["src/test/resources/users.csv"]',
  // High-confidence finding backed by a production document.
  '  - id: DATA-09', '    severity: high', '    confidence: high', '    source: workshop',
  '    derivation: "The DPA states that backups are unencrypted."',
  '    evidence: ["docs/dpa.pdf"]',
  '  - id: SCOPE-10', '    severity: medium', '    derivation: "Data processing agreements were not supplied."',
].join('\n') + '\n';

function workspace(): { workspacePath: string; passesDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'swao-comp-3414-'));
  const workspacePath = join(root, 'apps', 'demo-app');
  const passesDir = join(workspacePath, 'wsp', 'runs', '2026-10-24T00-00-00', 'passes');
  const catalogDir = join(root, 'wsp', 'inputs', 'catalogs', 'community', 'GDPR_TEST');
  mkdirSync(passesDir, { recursive: true });
  mkdirSync(catalogDir, { recursive: true });
  writeFileSync(join(catalogDir, 'controls.yaml'), catalogue());
  writeFileSync(join(workspacePath, '.swao.yml'), 'assessment:\n  regimes_active:\n    - GDPR_TEST\n');
  writeFileSync(join(passesDir, '08-crypto.yaml'), SIGNALS);
  return { workspacePath, passesDir };
}

/** Mocked LLM: every control GAP; refs per control id. */
function gapLlm(refsById: Record<string, string[]>, prompts: string[] = []): LlmProvider {
  return {
    complete: async (prompt: string): Promise<string> => {
      prompts.push(prompt);
      const ids = [...prompt.matchAll(/- id: (\S+)/g)].map((m) => m[1]!);
      return JSON.stringify({ controls: ids.map((id) => ({
        id, outcome: 'GAP', rationale: `Model says ${id} is not met.`, signal_refs: refsById[id] ?? [], remediation: 'Replace the algorithm.',
      })) });
    },
  } as unknown as LlmProvider;
}

const ctxFor = (ws: { workspacePath: string; passesDir: string }, llm: LlmProvider): PassContext =>
  ({ appId: 'demo-app', sourcePath: ws.workspacePath, workspacePath: ws.workspacePath, iter: 1, assessedAt: '2026-10-24', llm, passesDir: ws.passesDir });

type Ctl = {
  id: string; outcome: string; status: string; rationale: string; remediation: string; assessor: string; signal_refs: string[];
  not_evaluated_reason?: string;
  verdict_guard?: { original_outcome: string; outcome: string; reason: string; cited: Array<{ id: string; issues: string[] }> };
};

async function run(refsById: Record<string, string[]>, prompts: string[] = []) {
  const result = await runCompliancePass(ctxFor(workspace(), gapLlm(refsById, prompts)));
  const regimes = result.assessment['regimes'] as Array<{ status: string; controls: Ctl[] }>;
  const controls = regimes[0]!.controls;
  return { result, byId: (id: string) => controls.find((c) => c.id === id)! };
}

describe('Pass 11 evidence-quality guard (#3414)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('test-only CRYPTO hit: GAP on Art. 32(1)(a) is capped at PARTIAL (unverified evidence)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { byId } = await run({ ART_32_1_A: ['CRYPTO-01'] });
    const c = byId('ART_32_1_A');
    expect(c).toMatchObject({ outcome: 'PARTIAL', status: 'PARTIAL', assessor: 'rule_engine' });
    expect(c.verdict_guard).toEqual({
      original_outcome: 'GAP', outcome: 'PARTIAL', reason: 'unverified_evidence',
      cited: [{ id: 'CRYPTO-01', issues: ['test_code', 'low_confidence'] }],
    });
    expect(c.rationale.startsWith(UNVERIFIED_EVIDENCE_RATIONALE_PREFIX)).toBe(true);
    expect(c.rationale).toContain('CRYPTO-01: test code only, low confidence');
    expect(c.rationale).toContain('Model rationale: Model says ART_32_1_A is not met.');
    expect(c.remediation).toMatch(/^Verify the cited finding in production code/);
    // Not a "not evaluated" control: the publication must not grey it out.
    expect(c.not_evaluated_reason).toBeUndefined();
    expect(complianceNotEvaluatedReason(c)).toBeNull();
  });

  it('test path alone (high confidence) is enough to cap', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { byId } = await run({ ART_32_1_A: ['CRYPTO-01', 'CRYPTO-02'] });
    expect(byId('ART_32_1_A')).toMatchObject({ outcome: 'PARTIAL' });
    expect(byId('ART_32_1_A').verdict_guard!.cited.map((x) => x.issues)).toEqual([['test_code', 'low_confidence'], ['test_code']]);
  });

  it('low-confidence production hit: GAP is capped at PARTIAL', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { byId } = await run({ ART_5_1_F: ['CRYPTO-03'] });
    expect(byId('ART_5_1_F')).toMatchObject({ outcome: 'PARTIAL' });
    expect(byId('ART_5_1_F').verdict_guard!.cited).toEqual([{ id: 'CRYPTO-03', issues: ['low_confidence'] }]);
  });

  it('LLM-inferred signal without file evidence, or no citation at all: capped', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { byId } = await run({ ART_32_1_A: ['DATA-07'], ART_5_1_F: [] });
    expect(byId('ART_32_1_A').verdict_guard!.cited).toEqual([{ id: 'DATA-07', issues: ['llm_inferred'] }]);
    expect(byId('ART_5_1_F')).toMatchObject({ outcome: 'PARTIAL' });
    expect(byId('ART_5_1_F').rationale).toContain('it cites no signal');
  });

  it('a high-confidence finding in a test-folder document is test code: capped', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prompts: string[] = [];
    const { byId } = await run({ ART_5_1_F: ['DATA-08'] }, prompts);
    expect(byId('ART_5_1_F')).toMatchObject({ outcome: 'PARTIAL' });
    expect(byId('ART_5_1_F').verdict_guard!.cited).toEqual([{ id: 'DATA-08', issues: ['test_code'] }]);
    expect(prompts[0]).toContain('- DATA-08 [high, confidence high, evidence: test code (1)]:');
  });

  it('a high-confidence finding backed by a production document stays GAP', async () => {
    const { byId } = await run({ ART_5_1_F: ['DATA-09'] });
    expect(byId('ART_5_1_F')).toMatchObject({ outcome: 'GAP' });
  });

  it('production Cipher.getInstance("DESede") with high confidence stays GAP', async () => {
    const { byId } = await run({ ART_32_1_A: ['CRYPTO-04'] });
    const c = byId('ART_32_1_A');
    expect(c).toMatchObject({ outcome: 'GAP', status: 'GAP', assessor: 'llm' });
    expect(c.verdict_guard).toBeUndefined();
    expect(c.rationale).toBe('Model says ART_32_1_A is not met. Evidence basis: based on 1 signal, 0 in test code, 0 low confidence.');
  });

  it('mixed citations: weak signals plus one verified production signal stay GAP', async () => {
    const { byId } = await run({ ART_32_1_A: ['CRYPTO-01', 'CRYPTO-03', 'CRYPTO-04'] });
    expect(byId('ART_32_1_A')).toMatchObject({ outcome: 'GAP' });
    expect(byId('ART_32_1_A').rationale).toContain('Evidence basis: based on 3 signals, 1 in test code, 2 low confidence.');
  });

  it('one signal with mixed (production and test) evidence and high confidence stays GAP', async () => {
    const { byId } = await run({ ART_32_1_A: ['CRYPTO-05'] });
    expect(byId('ART_32_1_A')).toMatchObject({ outcome: 'GAP' });
  });

  it('composes with #3426: missing-input citations stay UNKNOWN insufficient_evidence; rule-decided N/A untouched', async () => {
    const { byId } = await run({ ART_44: ['SCOPE-10'] });
    expect(byId('ART_44')).toMatchObject({ outcome: 'UNKNOWN', not_evaluated_reason: 'insufficient_evidence' });
    expect(byId('ART_44').verdict_guard).toBeUndefined();
    const sector = byId('ART_SECTOR');
    expect(sector).toMatchObject({ outcome: 'N_A', assessor: 'rule_engine' });
    expect(sector.verdict_guard).toBeUndefined();
    expect(sector.rationale).not.toContain('Evidence basis:');
  });

  it('logs guard decisions in the pass output and the COMP roll-up', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = await run({ ART_32_1_A: ['CRYPTO-01'], ART_5_1_F: ['CRYPTO-04'] });
    expect(result.assessment['evidence_guard']).toEqual([{
      regime: 'GDPR_TEST', control: 'ART_32_1_A', original_outcome: 'GAP', outcome: 'PARTIAL', reason: 'unverified_evidence',
      cited: [{ id: 'CRYPTO-01', issues: ['test_code', 'low_confidence'] }],
    }]);
    expect(result.signals[0]!.derivation).toContain('1 PARTIAL were proposed as GAP and capped for unverified evidence');
    expect(warn.mock.calls.some(([m]) => String(m).includes('GDPR_TEST/ART_32_1_A GAP capped at PARTIAL'))).toBe(true);
  });

  it('no evidence_guard key when the guard changed nothing', async () => {
    const { result } = await run({ ART_32_1_A: ['CRYPTO-04'], ART_5_1_F: ['CRYPTO-04'] });
    expect(result.assessment).not.toHaveProperty('evidence_guard');
  });

  it('prompt carries confidence, path class and evidence count per signal, plus the GAP rule', async () => {
    const prompts: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await run({}, prompts);
    const p = prompts[0]!;
    expect(p).toContain('- CRYPTO-01 [high, confidence low, evidence: test code (1)]:');
    expect(p).toContain('- CRYPTO-04 [high, confidence high, evidence: production (1)]:');
    expect(p).toContain('- CRYPTO-05 [high, confidence high, evidence: production and tests (2)]:');
    expect(p).toContain('- DATA-07 [high, confidence medium, evidence: no file]:');
    expect(p).toContain('Never return GAP on such');
  });
});

describe('signalEvidenceIssues (#3414)', () => {
  const base = { source: 'static_analysis', category: 'application', severity: 'high', derivation: 'x' } as const;
  it('honours the #3403 test_code marker and treats missing confidence as not low', () => {
    expect(signalEvidenceIssues({ ...base, id: 'CRYPTO-09', evidence: ['src/main/A.java'], confidence: 'high', test_code: true } as Signal)).toEqual(['test_code']);
    expect(signalEvidenceIssues({ ...base, id: 'CRYPTO-10', evidence: [] } as unknown as Signal)).toEqual([]);
  });
  it('legacy numeric confidence below 0.5 is low', () => {
    expect(signalEvidenceIssues({ ...base, id: 'X-01', evidence: ['src/a.ts'], confidence: 0.3 } as unknown as Signal)).toEqual(['low_confidence']);
  });
  it('absolute evidence under the source root is classified relative to it', () => {
    const s = { ...base, id: 'X-02', evidence: ['/work/app/src/main/A.java:1'], confidence: 'high' } as Signal;
    expect(signalEvidenceIssues(s, '/work/app')).toEqual([]);
  });
});
