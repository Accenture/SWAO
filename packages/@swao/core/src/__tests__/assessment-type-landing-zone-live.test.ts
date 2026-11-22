// #3568 (Design 120 section 13.1): `landing-zone-live` is the one assessment
// type token for the Landing Zone Live Assessment; the former reserved
// customer landing zone token (ADR-0051) is gone from router and schema.

import { describe, expect, it } from 'vitest';
import { AssessmentTypeRouter, KNOWN_ASSESSMENT_TYPES, UnknownAssessmentTypeError } from '../assess-router.js';
import { SwaoYmlAssessmentSchema } from '../swao-yml.js';

// Built at run time so the retired literal does not appear in the package
// source (pinned by tests/audit-gates/assessment-type-token-retired.gate.mjs).
const RETIRED_TOKEN = ['landing', 'zone', 'customer'].join('-');

describe('landing-zone-live assessment type token (#3568)', () => {
  it('is a known assessment type', () => {
    expect(KNOWN_ASSESSMENT_TYPES).toContain('landing-zone-live');
    expect(KNOWN_ASSESSMENT_TYPES).not.toContain(RETIRED_TOKEN);
  });

  it('routes to a coming-soon notice until a module registers the engine', () => {
    const decision = new AssessmentTypeRouter().route('landing-zone-live');
    expect(decision.kind).toBe('coming-soon');
    if (decision.kind === 'coming-soon') {
      expect(decision.type).toBe('landing-zone-live');
      expect(decision.message).toContain('landing-zone-live');
      expect(decision.message).toContain('Design 120');
    }
  });

  it('runs a registered landing-zone-live contribution', () => {
    const router = new AssessmentTypeRouter();
    router.register({ type: 'landing-zone-live', run: async () => ({ wsp_version: '0', generated_at: '', signals: [] }) });
    expect(router.route('landing-zone-live').kind).toBe('run');
    expect(router.registeredTypes()).toEqual(['landing-zone-live']);
  });

  it('rejects the retired token in the router as an unknown type', () => {
    expect(() => new AssessmentTypeRouter().normalizeType(RETIRED_TOKEN)).toThrow(UnknownAssessmentTypeError);
  });

  it('accepts landing-zone-live and rejects the retired token in assessment.type', () => {
    expect(SwaoYmlAssessmentSchema.safeParse({ type: 'landing-zone-live' }).success).toBe(true);
    expect(SwaoYmlAssessmentSchema.safeParse({ type: RETIRED_TOKEN }).success).toBe(false);
  });
});
