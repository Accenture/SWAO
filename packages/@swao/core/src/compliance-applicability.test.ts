// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core: compliance control applicability tests
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { appliesWhenMatches, complianceNotEvaluatedReason, COMPLIANCE_NOT_EVALUATED_REASONS, NOT_EVALUATED_RATIONALE_PREFIX, UNVERIFIED_EVIDENCE_RATIONALE_PREFIX, formatEvidenceBasis, splitEvidenceBasis } from './compliance-applicability.js';
import * as core from './index.js';

// #3425 follow-up: one matcher for Pass 11 and the publication extractor.
describe('appliesWhenMatches (#3425, Design 104 Q-CODE-7)', () => {
  it('an empty or absent applies_when always applies', () => {
    expect(appliesWhenMatches(undefined, undefined)).toBe(true);
    expect(appliesWhenMatches(null, null)).toBe(true);
    expect(appliesWhenMatches({}, undefined)).toBe(true);
  });

  it('a condition without framework_context, or with the key missing, does not apply', () => {
    expect(appliesWhenMatches({ kritis_sector: 'health' }, undefined)).toBe(false);
    expect(appliesWhenMatches({ kritis_sector: 'health' }, {})).toBe(false);
    expect(appliesWhenMatches({ kritis_sector: 'health' }, { kritis_sector: null })).toBe(false);
  });

  it('matches equal values and rejects different ones', () => {
    expect(appliesWhenMatches({ kritis_sector: 'health' }, { kritis_sector: 'health' })).toBe(true);
    expect(appliesWhenMatches({ kritis_sector: 'health' }, { kritis_sector: 'finance' })).toBe(false);
  });

  it('accepts `|` alternatives with surrounding spaces', () => {
    expect(appliesWhenMatches({ kritis_sector: 'energy | water' }, { kritis_sector: 'water' })).toBe(true);
    expect(appliesWhenMatches({ kritis_sector: 'energy|water' }, { kritis_sector: ' energy ' })).toBe(true);
    expect(appliesWhenMatches({ kritis_sector: 'energy|water' }, { kritis_sector: 'health' })).toBe(false);
  });

  it('stringifies non-string context scalars (raw .swao.yml values)', () => {
    expect(appliesWhenMatches({ has_ot_systems: 'true' }, { has_ot_systems: true })).toBe(true);
    expect(appliesWhenMatches({ tier: '2' }, { tier: 2 })).toBe(true);
    expect(appliesWhenMatches({ has_ot_systems: 'true' }, { has_ot_systems: false })).toBe(false);
  });

  it('requires every key to match', () => {
    expect(appliesWhenMatches({ a: 'x', b: 'y' }, { a: 'x', b: 'y' })).toBe(true);
    expect(appliesWhenMatches({ a: 'x', b: 'y' }, { a: 'x' })).toBe(false);
  });

  it('is exported from the @swao/core barrel', () => {
    expect(core.appliesWhenMatches).toBe(appliesWhenMatches);
  });
});

// #3425 follow-up / #3426 / #3436: why an UNKNOWN control was not evaluated.
describe('complianceNotEvaluatedReason', () => {
  it('prefers the structured not_evaluated_reason field', () => {
    expect(complianceNotEvaluatedReason({ not_evaluated_reason: 'out_of_scope', rationale: 'anything' })).toBe('out_of_scope');
    expect(complianceNotEvaluatedReason({ not_evaluated_reason: 'llm_unavailable' })).toBe('llm_unavailable');
  });

  it('falls back to the rationale prefix for every reason', () => {
    for (const reason of COMPLIANCE_NOT_EVALUATED_REASONS) {
      expect(complianceNotEvaluatedReason({ rationale: `${NOT_EVALUATED_RATIONALE_PREFIX[reason]} and more text.` })).toBe(reason);
    }
  });

  it('matches the Pass 11 out-of-scope rationale shape', () => {
    const r = 'Not evaluated: the control is scoped to assessment types [aud] and this run is [app]. Assess it in a matching assessment.';
    expect(complianceNotEvaluatedReason({ rationale: r })).toBe('out_of_scope');
  });

  it('returns null for ordinary verdicts, unknown reasons and empty input', () => {
    expect(complianceNotEvaluatedReason(undefined)).toBeNull();
    expect(complianceNotEvaluatedReason({ rationale: 'No signals address this control.' })).toBeNull();
    expect(complianceNotEvaluatedReason({ not_evaluated_reason: 'bogus' })).toBeNull();
  });
});

describe('evidence-basis markers (#3414)', () => {
  it('splits the trailing evidence-basis sentence off a rationale', () => {
    const basis = formatEvidenceBasis(3, 1, 2);
    expect(splitEvidenceBasis(`Model text. ${basis}`)).toEqual({ body: 'Model text.', basis });
    expect(splitEvidenceBasis('Model text only.')).toEqual({ body: 'Model text only.', basis: null });
    expect(formatEvidenceBasis(0, 0, 0)).toBe('Evidence basis: no cited signals.');
  });

  it('the capped-GAP prefix is not a not-evaluated reason', () => {
    expect(complianceNotEvaluatedReason({ rationale: `${UNVERIFIED_EVIDENCE_RATIONALE_PREFIX}: the model proposed GAP.` })).toBeNull();
  });
});
