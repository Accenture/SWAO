// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3418: chat findings integrity (evidence kind, detection method, index
// lines, answer post-check).

import { describe, it, expect } from 'vitest';
import {
  signalEvidenceKind,
  signalDetectionMethod,
  signalSeverityLabel,
  signalIndexEntry,
  formatSignalIndexLine,
  parseSignalIndexLines,
  mergeSignalIndex,
  checkFindingsIntegrity,
  applyFindingsIntegrity,
  type SignalIndexEntry,
} from './finding-integrity.js';

const TEST_CRYPTO: SignalIndexEntry = {
  id: 'CRYPTO-01', app: 'demo', severity: 'medium', severityOriginal: 'high', confidence: 'medium',
  evidenceKind: 'test-code', detection: 'pattern-match', firstEvidence: 'src/test/java/HashTest.java:42',
};
const PROD_EGR: SignalIndexEntry = {
  id: 'EGR-02', app: 'demo', severity: 'high', confidence: 'high',
  evidenceKind: 'production', detection: 'deterministic', firstEvidence: 'package.json',
};
const LOW_DATA: SignalIndexEntry = {
  id: 'DATA-03', app: 'demo', severity: 'low', confidence: 'high',
  evidenceKind: 'production', detection: 'llm', firstEvidence: 'src/main/Repo.java:9',
};

describe('signalEvidenceKind (#3418)', () => {
  it('uses the #3403 marker first', () => {
    expect(signalEvidenceKind({ test_code: true, evidence: ['src/main/A.java:1'] })).toBe('test-code');
  });
  it('classifies by path in include mode (no marker)', () => {
    expect(signalEvidenceKind({ evidence: ['src/test/java/A.java:3'] })).toBe('test-code');
    expect(signalEvidenceKind({ evidence: ['src/main/java/A.java:3'] })).toBe('production');
    expect(signalEvidenceKind({ evidence: ['src/main/A.java:1', 'x/a.test.ts:3'] })).toBe('mixed');
  });
  it('separates documents and signals without file evidence', () => {
    expect(signalEvidenceKind({ evidence: ['docs/workshop.md', 'inputs/cmdb.xlsx'] })).toBe('document');
    expect(signalEvidenceKind({ evidence: [], source: 'workshop' })).toBe('document');
    expect(signalEvidenceKind({ evidence: [] })).toBe('none');
    expect(signalEvidenceKind({ evidence: ['src/main/A.java:1', 'docs/a.md'] })).toBe('production');
    // Service-app signal files are SWAO records, not production code.
    expect(signalEvidenceKind({ evidence: ['signals/binary-signals.json'] })).toBe('document');
  });
  it('a test folder above the workspace does not flip an absolute path', () => {
    const root = 'C:/work/tests/ws';
    expect(signalEvidenceKind({ evidence: [`${root}/apps/a/src/main/A.java:4`] }, root)).toBe('production');
  });
});

describe('signalDetectionMethod (#3418)', () => {
  it('reads assessor and provenance first', () => {
    expect(signalDetectionMethod({ id: 'CRYPTO-01', assessor: 'llm' })).toBe('llm');
    expect(signalDetectionMethod({ id: 'DATA-01', provenance: { source: 'ollama/gemma' } })).toBe('llm');
    expect(signalDetectionMethod({ id: 'DATA-01', source: 'llm_inference' })).toBe('llm');
    expect(signalDetectionMethod({ id: 'X-01', assessor: 'human_override' })).toBe('human');
  });
  it('separates pattern-match passes from deterministic rule-engine passes', () => {
    expect(signalDetectionMethod({ id: 'CRYPTO-02', assessor: 'rule_engine' })).toBe('pattern-match');
    expect(signalDetectionMethod({ id: 'MAL-03', provenance: { source: 'rule_engine' } })).toBe('pattern-match');
    expect(signalDetectionMethod({ id: 'SBOM-01', assessor: 'rule_engine' })).toBe('deterministic');
    expect(signalDetectionMethod({ id: 'SBOM-01' })).toBe('unknown');
  });
});

describe('index lines (#3418)', () => {
  it('round-trip through format and parse', () => {
    const e = signalIndexEntry({
      id: 'CRYPTO-01', severity: 'medium', severity_original: 'high', confidence: 'medium', test_code: true,
      assessor: 'rule_engine', evidence: ['src/test/java/HashTest.java:42'],
    }, { app: 'demo' });
    const line = formatSignalIndexLine(e);
    expect(line).toBe('[signal] CRYPTO-01 | app: demo | severity: medium (assessed high) | confidence: medium | evidence: test-code | detection: pattern-match | first evidence: src/test/java/HashTest.java:42');
    expect(parseSignalIndexLines(`noise\n  ${line}\n[signal] broken`)).toEqual([e]);
  });
  it('severity label keeps the assessed severity of a lowered signal', () => {
    expect(signalSeverityLabel({ severity: 'medium', severity_original: 'high' })).toBe('medium (assessed high, lowered one step: test code only)');
    expect(signalSeverityLabel({ severity: 'high' })).toBe('high');
  });
  it('merge replaces per app and id', () => {
    const merged = mergeSignalIndex([TEST_CRYPTO, PROD_EGR], [{ ...PROD_EGR, severity: 'low' }]);
    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.id === 'EGR-02')?.severity).toBe('low');
  });
});

describe('checkFindingsIntegrity (#3418)', () => {
  const index = [TEST_CRYPTO, PROD_EGR, LOW_DATA];

  it('catches a severity escalation and a remediation demand on a test-code signal', () => {
    const issues = checkFindingsIntegrity('CRYPTO-01 is a critical finding and must be replaced.', index);
    expect(issues.map((i) => i.kind)).toEqual(['severity-escalation', 'urgency-escalation', 'test-code-unstated', 'confidence-unstated']);
  });

  it('catches German escalation wording', () => {
    const issues = checkFindingsIntegrity('DATA-03 ist ein hohes Risiko (Konfidenz hoch, im Testcode geprüft).', index);
    expect(issues.map((i) => i.kind)).toEqual(['severity-escalation']);
  });

  it('accepts an answer that states the signal as assessed', () => {
    const answer = 'CRYPTO-01 (medium severity, medium confidence) is in test code at src/test/java/HashTest.java:42; '
      + 'it is a pattern match, so verify it. EGR-02 is a high severity finding in package.json.';
    expect(checkFindingsIntegrity(answer, index)).toEqual([]);
  });

  it('does not read confidence or unrelated wording as severity', () => {
    expect(checkFindingsIntegrity('DATA-03 has high confidence and needs high availability storage.', index)).toEqual([]);
    // A confidence word nearby does not hide a real escalation.
    expect(checkFindingsIntegrity('DATA-03 is critical, with high confidence.', index).map((i) => i.kind)).toEqual(['severity-escalation']);
  });

  it('judges a sentence citing several signals against the strongest one', () => {
    expect(checkFindingsIntegrity('EGR-02 and DATA-03 together are a high risk.', index)).toEqual([]);
  });

  it('wants test code and confidence stated near the citation, not anywhere in the answer', () => {
    const far = 'CRYPTO-01 uses MD5. EGR-02 reaches a US endpoint. Separately, the latest test run was green and verified.';
    expect(checkFindingsIntegrity(far, index).map((i) => i.kind)).toEqual(['test-code-unstated', 'confidence-unstated']);
    const next = 'CRYPTO-01 uses MD5. It sits in test code, medium confidence.';
    expect(checkFindingsIntegrity(next, index)).toEqual([]);
  });

  it('ignores answers that cite no signal', () => {
    expect(checkFindingsIntegrity('Everything is critical and must be replaced.', index)).toEqual([]);
  });

  it('appends a deterministic note and leaves a clean answer unchanged', () => {
    const r = applyFindingsIntegrity('CRYPTO-01 must be replaced.', index);
    expect(r.text.startsWith('CRYPTO-01 must be replaced.')).toBe(true);
    expect(r.text).toContain('[Findings integrity check]');
    expect(r.text).toContain('severity medium (assessed high, lowered: test code only), confidence medium, detection pattern-match, evidence in test code (src/test/java/HashTest.java:42)');
    expect(applyFindingsIntegrity('No signal here.', index).text).toBe('No signal here.');
  });
});
