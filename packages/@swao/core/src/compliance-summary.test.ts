// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library -- compliance regime summary (Design 113 section 6.2)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import {
  complianceRagStatus, summariseRegimeCompliance, normaliseComplianceOutcome, complianceOutcomeRag,
  tallyComplianceRag, complianceScore, COMPLIANCE_RAG_VALUES,
} from './compliance-summary.js';
import { ComplianceControlOutcomeSchema } from './wsp-compliance.js';

describe('complianceRagStatus (#3402, shared with the publication extractor)', () => {
  it('maps the control status vocabulary like the report', () => {
    expect(complianceRagStatus('SATISFIED')).toBe('pass');
    expect(complianceRagStatus('PASS')).toBe('pass');
    expect(complianceRagStatus('partial')).toBe('partial');
    expect(complianceRagStatus('UNKNOWN')).toBe('not-assessed');
    expect(complianceRagStatus('GAP')).toBe('fail');
    expect(complianceRagStatus(undefined)).toBe('fail');
    expect(complianceRagStatus('something-else')).toBe('fail');
  });

  // #3425: N/A controls were classified as fail (KRITIS sector controls showed as 6 Fail).
  it('classifies every not-applicable spelling as not-applicable, never fail', () => {
    for (const s of ['N_A', 'n_a', 'NA', 'N/A', 'NOT_APPLICABLE', 'not-applicable', 'Not applicable']) {
      expect(complianceRagStatus(s)).toBe('not-applicable');
    }
  });
});

describe('normaliseComplianceOutcome + complianceOutcomeRag (#3425)', () => {
  it('folds aliases onto the Pass 11 outcome union', () => {
    expect(normaliseComplianceOutcome('pass')).toBe('SATISFIED');
    expect(normaliseComplianceOutcome('FAIL')).toBe('GAP');
    expect(normaliseComplianceOutcome('n/a')).toBe('N_A');
    expect(normaliseComplianceOutcome(' unknown ')).toBe('UNKNOWN');
    expect(normaliseComplianceOutcome('')).toBeNull();
    expect(normaliseComplianceOutcome(null)).toBeNull();
    expect(normaliseComplianceOutcome('open')).toBeNull();
  });

  // #3407: the example-workspace plan vocabulary.
  it('folds compliant / non_compliant onto SATISFIED / GAP', () => {
    expect(normaliseComplianceOutcome('compliant')).toBe('SATISFIED');
    expect(normaliseComplianceOutcome('non_compliant')).toBe('GAP');
    expect(normaliseComplianceOutcome('Non-Compliant')).toBe('GAP');
    expect(complianceRagStatus('compliant')).toBe('pass');
  });

  it('maps every WSP outcome to a distinct RAG bucket', () => {
    const rags = ComplianceControlOutcomeSchema.options.map((o) => complianceOutcomeRag(o));
    expect(rags).toEqual(['pass', 'partial', 'fail', 'not-assessed', 'not-applicable']);
    expect([...rags].sort()).toEqual([...COMPLIANCE_RAG_VALUES].sort());
  });
});

describe('complianceScore (#3425: N/A excluded from the denominator)', () => {
  it('scores (100*pass + 50*partial) / (pass + partial + fail)', () => {
    expect(complianceScore({ pass: 1, partial: 2, fail: 1 })).toBe(50);
    expect(complianceScore({ pass: 2, partial: 1, fail: 0 })).toBe(83.33);
  });

  it('is unchanged by adding N/A or not-assessed controls', () => {
    const base = tallyComplianceRag(['GAP', 'PARTIAL', 'PARTIAL', 'SATISFIED']);
    const withNa = tallyComplianceRag(['GAP', 'PARTIAL', 'PARTIAL', 'SATISFIED', 'N_A', 'N_A', 'N_A', 'UNKNOWN']);
    expect(withNa.not_applicable).toBe(3);
    expect(withNa.not_assessed).toBe(1);
    expect(complianceScore(withNa)).toBe(complianceScore(base));
  });

  it('is null when nothing was assessed pass/partial/fail', () => {
    expect(complianceScore(tallyComplianceRag(['N_A', 'UNKNOWN']))).toBeNull();
  });
});

describe('summariseRegimeCompliance (#3402)', () => {
  it('tallies pass/partial/fail/not_assessed per framework', () => {
    const out = summariseRegimeCompliance([
      {
        id: 'gdpr', name: 'GDPR', controls: [
          { status: 'SATISFIED' }, { status: 'PARTIAL' }, { status: 'GAP' }, { status: 'UNKNOWN' }, { status: 'N_A' },
        ],
      },
      { id: 'bsi_c5', controls: [{ status: 'SATISFIED' }, { status: 'SATISFIED' }] },
    ]);
    expect(out).toEqual([
      { id: 'GDPR', name: 'GDPR', pass: 1, partial: 1, fail: 1, not_assessed: 1, not_applicable: 1 },
      { id: 'BSI_C5', name: 'bsi_c5', pass: 2, partial: 0, fail: 0, not_assessed: 0, not_applicable: 0 },
    ]);
  });

  // #3425 acceptance: a orders-api-like KRITIS tally (synthetic) is
  // 1 gap / 2 partial / 5 N/A, not 6 fail.
  it('reports a KRITIS-like regime as 1 fail / 2 partial / 5 N/A', () => {
    const [k] = summariseRegimeCompliance([{
      id: 'kritis_de', name: 'KRITIS-DE', controls: [
        { status: 'GAP' }, { status: 'PARTIAL' }, { status: 'PARTIAL' },
        { status: 'N_A' }, { status: 'N_A' }, { status: 'N_A' }, { status: 'N_A' }, { status: 'N_A' },
      ],
    }])!;
    expect(k).toMatchObject({ fail: 1, partial: 2, pass: 0, not_applicable: 5 });
  });

  it('skips regimes with no controls and returns undefined when empty', () => {
    expect(summariseRegimeCompliance([{ id: 'x', controls: [] }])).toBeUndefined();
    expect(summariseRegimeCompliance(undefined)).toBeUndefined();
    expect(summariseRegimeCompliance('nope')).toBeUndefined();
  });
});
