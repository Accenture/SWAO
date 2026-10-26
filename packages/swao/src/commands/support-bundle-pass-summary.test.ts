// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Support bundle: LLM pass summary tests (#3441)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3441: pass-inventory.json showed `signals_by_status: { unknown: N }` for
// 03-data, 04-ctx and 11-comp because it read `signal.status`, which the
// Signal schema does not define. Synthetic pass files only.

import { describe, it, expect } from 'vitest';
import { summariseLlmPassForBundle } from './support-bundle-pass-summary.js';

describe('summariseLlmPassForBundle (#3441)', () => {
  it('buckets 03/04 signals by outcome, never "unknown"', () => {
    const s = summariseLlmPassForBundle({
      pass: { id: 3, name: 'data_classification', status: 'complete' },
      signals: [
        { id: 'DATA-01', severity: 'high', outcome: 'negative' },
        { id: 'DATA-02', severity: 'informational', outcome: 'neutral' },
        { id: 'DATA-03', severity: 'positive', outcome: 'positive' },
        { id: 'DATA-04', severity: 'medium' }, // pre-enrichment: severity default
        { id: 'DATA-05' },
      ],
      assessment: {},
    });
    expect(s['signals_by_status']).toEqual({ negative: 2, neutral: 1, positive: 1, indeterminate: 1 });
    expect(Object.keys(s['signals_by_status'] as object)).not.toContain('unknown');
    expect(s['top_gaps']).toEqual(['DATA-01', 'DATA-04']);
  });

  it('a legacy status string is kept when outcome is absent', () => {
    const s = summariseLlmPassForBundle({ signals: [{ id: 'CTX-01', status: 'gap' }] });
    expect(s['signals_by_status']).toEqual({ gap: 1 });
  });

  it('11-comp: control verdicts through the shared classifier, regime statuses and control gaps', () => {
    const s = summariseLlmPassForBundle({
      pass: { id: 11, name: 'compliance_evaluation', status: 'complete' },
      signals: [{ id: 'COMP-01', severity: 'high', outcome: 'negative', source: 'llm_inference' }],
      assessment: {
        regimes: [
          { id: 'GDPR', status: 'evaluated', controls: [
            { id: 'Art-5', status: 'SATISFIED' },
            { id: 'Art-44', status: 'GAP' },
            { id: 'Art-32', status: 'PARTIAL' },
            { id: 'Art-9', status: 'N_A' },
            { id: 'Art-30', status: 'UNKNOWN' },
          ] },
          { id: 'SECNUMCLOUD', status: 'out_of_scope', controls: [{ id: 'SNC-1', status: 'UNKNOWN' }] },
        ],
      },
    });
    expect(s['signals_by_status']).toEqual({ negative: 1 });
    expect(s['controls_by_status']).toEqual({ pass: 1, partial: 1, fail: 1, not_assessed: 2, not_applicable: 1 });
    expect(s['regimes_by_status']).toEqual({ evaluated: 1, out_of_scope: 1 });
    expect(s['regimes_evaluated']).toEqual(['GDPR', 'SECNUMCLOUD']);
    expect(s['top_gaps']).toEqual(['GDPR/Art-44', 'GDPR/Art-32']);
  });
});
