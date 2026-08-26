// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- lz-narrative tests (#1358)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { generateLzNarrative } from './lz-narrative.js';
import type { LzFitReport } from './lz-fit.js';

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

/** Minimal valid LzFitReport for a READY outcome. */
function makeReadyReport(): LzFitReport {
  return {
    provider: 'aws',
    region: 'eu-central-1',
    overall: 'READY',
    assessment_mode: 'full',
    sovereignty_active: true,
    items: [
      {
        service_code: 'kubernetes',
        label: 'Kubernetes',
        verdict: 'SUPPORTED',
        detail: 'kubernetes is available and provisioned.',
      },
      {
        service_code: 'key_vault',
        label: 'KMS',
        verdict: 'SUPPORTED',
        detail: 'key_vault is available and provisioned.',
      },
    ],
    sovereignty_statement: 'Region eu-central-1 satisfies the sovereignty requirements derived from GDPR.',
    generated_at: '2026-08-04',
  };
}

/** LzFitReport for a BLOCKED outcome (sovereignty passes, service gap). */
function makeBlockedReport(): LzFitReport {
  return {
    provider: 'aws',
    region: 'ap-southeast-1',
    overall: 'BLOCKED',
    assessment_mode: 'full',
    sovereignty_active: true,
    items: [
      {
        service_code: 'kubernetes',
        label: 'Kubernetes',
        verdict: 'SUPPORTED',
        detail: 'kubernetes is available and provisioned.',
      },
      {
        service_code: 'hsm_service',
        label: 'HSM',
        verdict: 'NOT_AVAILABLE_IN_REGION',
        detail: 'hsm_service is not offered in ap-southeast-1.',
        remediation: 'Choose an alternative service or region.',
      },
      {
        service_code: 'data_warehouse',
        verdict: 'NOT_AVAILABLE_IN_REGION',
        detail: 'data_warehouse is not offered in ap-southeast-1.',
      },
    ],
    sovereignty_statement: 'Region ap-southeast-1 satisfies the sovereignty requirements derived from GDPR.',
    generated_at: '2026-08-04',
  };
}

/** LzFitReport for a SOVEREIGNTY_BLOCKED outcome. */
function makeSovereigntyBlockedReport(): LzFitReport {
  return {
    provider: 'aws',
    region: 'us-east-1',
    overall: 'SOVEREIGNTY_BLOCKED',
    assessment_mode: 'full',
    sovereignty_active: true,
    blocker_category: 'structural',
    items: [
      {
        service_code: 'kubernetes',
        label: 'Kubernetes',
        verdict: 'SOVEREIGNTY_GAP',
        detail: 'kubernetes is available in us-east-1 but the region fails sovereignty requirements: operator jurisdiction US-entity not in [EU-entity].',
        remediation: 'Select a region whose sovereignty facts satisfy the active frameworks.',
      },
      {
        service_code: 'key_vault',
        label: 'KMS',
        verdict: 'SOVEREIGNTY_GAP',
        detail: 'key_vault is available in us-east-1 but the region fails sovereignty requirements: operator jurisdiction US-entity not in [EU-entity].',
        remediation: 'Select a region whose sovereignty facts satisfy the active frameworks.',
      },
    ],
    sovereignty_statement: 'Region us-east-1 FAILS sovereignty requirements (operator jurisdiction US-entity not in [EU-entity]) derived from GDPR.',
    generated_at: '2026-08-04',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateLzNarrative', () => {
  describe('READY verdict', () => {
    it('headline says "All sovereignty requirements met"', () => {
      const report = makeReadyReport();
      const narrative = generateLzNarrative({
        lz_id: 'aws/eu-central-1',
        region_id: 'eu-central-1',
        display: 'Amazon Web Services / eu-central-1',
        fit: report,
        sovereigntyFacts: { operator_jurisdiction: 'EU-entity', residency_country: 'DE', certifications: ['C5'] },
      });
      expect(narrative.summary_headline).toContain('All sovereignty requirements met');
      expect(narrative.summary_headline).toContain('2 assessed service primitive(s)');
    });

    it('service_checks contain only SUPPORTED entries', () => {
      const report = makeReadyReport();
      const narrative = generateLzNarrative({
        lz_id: 'aws/eu-central-1',
        region_id: 'eu-central-1',
        display: 'Amazon Web Services / eu-central-1',
        fit: report,
      });
      expect(narrative.service_checks).toHaveLength(2);
      expect(narrative.service_checks.every(c => c.verdict === 'SUPPORTED')).toBe(true);
    });

    it('sovereignty.passed is true', () => {
      const narrative = generateLzNarrative({
        lz_id: 'aws/eu-central-1',
        region_id: 'eu-central-1',
        display: 'Amazon Web Services / eu-central-1',
        fit: makeReadyReport(),
      });
      expect(narrative.sovereignty.passed).toBe(true);
    });

    it('sovereignty.statement matches fit report', () => {
      const report = makeReadyReport();
      const narrative = generateLzNarrative({
        lz_id: 'aws/eu-central-1',
        region_id: 'eu-central-1',
        display: 'Amazon Web Services / eu-central-1',
        fit: report,
        sovereigntyFacts: { operator_jurisdiction: 'EU-entity', residency_country: 'DE', certifications: [] },
      });
      expect(narrative.sovereignty.statement).toBe(report.sovereignty_statement);
    });

    it('summary_body contains operator_jurisdiction and residency_country', () => {
      const narrative = generateLzNarrative({
        lz_id: 'aws/eu-central-1',
        region_id: 'eu-central-1',
        display: 'Amazon Web Services / eu-central-1',
        fit: makeReadyReport(),
        sovereigntyFacts: { operator_jurisdiction: 'EU-entity', residency_country: 'DE', certifications: ['C5'] },
      });
      expect(narrative.summary_body).toContain('EU-entity');
      expect(narrative.summary_body).toContain('DE');
    });

    it('contains no em-dashes (U+2014) in any output', () => {
      const narrative = generateLzNarrative({
        lz_id: 'aws/eu-central-1',
        region_id: 'eu-central-1',
        display: 'Amazon Web Services / eu-central-1',
        fit: makeReadyReport(),
        sovereigntyFacts: { operator_jurisdiction: 'EU-entity', residency_country: 'DE', certifications: ['C5'] },
      });
      const emDash = String.fromCharCode(0x2014);
      expect(narrative.summary_headline.includes(emDash)).toBe(false);
      expect(narrative.summary_body.includes(emDash)).toBe(false);
      expect(narrative.sovereignty.statement.includes(emDash)).toBe(false);
    });
  });

  describe('BLOCKED verdict (sovereignty passes, service gap)', () => {
    it('headline mentions "Passes sovereignty; blocked on M missing service primitive(s)"', () => {
      const narrative = generateLzNarrative({
        lz_id: 'aws/ap-southeast-1',
        region_id: 'ap-southeast-1',
        display: 'Amazon Web Services / ap-southeast-1',
        fit: makeBlockedReport(),
        sovereigntyFacts: { operator_jurisdiction: 'AP-entity', residency_country: 'SG' },
      });
      expect(narrative.summary_headline).toContain('Passes sovereignty');
      expect(narrative.summary_headline).toContain('blocked on 2 missing service primitive(s)');
      expect(narrative.summary_headline).toContain('hsm_service');
      expect(narrative.summary_headline).toContain('data_warehouse');
    });

    it('sovereignty.passed is true', () => {
      const narrative = generateLzNarrative({
        lz_id: 'aws/ap-southeast-1',
        region_id: 'ap-southeast-1',
        display: 'Amazon Web Services / ap-southeast-1',
        fit: makeBlockedReport(),
      });
      expect(narrative.sovereignty.passed).toBe(true);
    });

    it('service_checks include both SUPPORTED and NOT_AVAILABLE_IN_REGION entries', () => {
      const narrative = generateLzNarrative({
        lz_id: 'aws/ap-southeast-1',
        region_id: 'ap-southeast-1',
        display: 'Amazon Web Services / ap-southeast-1',
        fit: makeBlockedReport(),
      });
      expect(narrative.service_checks).toHaveLength(3);
      const verdicts = narrative.service_checks.map(c => c.verdict);
      expect(verdicts).toContain('SUPPORTED');
      expect(verdicts).toContain('NOT_AVAILABLE_IN_REGION');
    });

    it('contains no em-dashes (U+2014) in any output', () => {
      const narrative = generateLzNarrative({
        lz_id: 'aws/ap-southeast-1',
        region_id: 'ap-southeast-1',
        display: 'Amazon Web Services / ap-southeast-1',
        fit: makeBlockedReport(),
      });
      const emDash = String.fromCharCode(0x2014);
      expect(narrative.summary_headline.includes(emDash)).toBe(false);
      expect(narrative.summary_body.includes(emDash)).toBe(false);
    });
  });

  describe('SOVEREIGNTY_BLOCKED verdict', () => {
    it('headline mentions "Sovereignty blocked"', () => {
      const narrative = generateLzNarrative({
        lz_id: 'aws/us-east-1',
        region_id: 'us-east-1',
        display: 'Amazon Web Services / us-east-1',
        fit: makeSovereigntyBlockedReport(),
        sovereigntyFacts: { operator_jurisdiction: 'US-entity', residency_country: 'US', certifications: [] },
      });
      expect(narrative.summary_headline).toContain('Sovereignty blocked');
    });

    it('headline includes operator_jurisdiction value', () => {
      const narrative = generateLzNarrative({
        lz_id: 'aws/us-east-1',
        region_id: 'us-east-1',
        display: 'Amazon Web Services / us-east-1',
        fit: makeSovereigntyBlockedReport(),
        sovereigntyFacts: { operator_jurisdiction: 'US-entity', residency_country: 'US', certifications: [] },
      });
      expect(narrative.summary_headline).toContain('US-entity');
    });

    it('sovereignty.passed is false', () => {
      const narrative = generateLzNarrative({
        lz_id: 'aws/us-east-1',
        region_id: 'us-east-1',
        display: 'Amazon Web Services / us-east-1',
        fit: makeSovereigntyBlockedReport(),
      });
      expect(narrative.sovereignty.passed).toBe(false);
    });

    it('sovereignty.blockers lists SOVEREIGNTY_GAP details', () => {
      const narrative = generateLzNarrative({
        lz_id: 'aws/us-east-1',
        region_id: 'us-east-1',
        display: 'Amazon Web Services / us-east-1',
        fit: makeSovereigntyBlockedReport(),
      });
      expect(narrative.sovereignty.blockers).toHaveLength(2);
      expect(narrative.sovereignty.blockers[0]).toContain('operator jurisdiction US-entity');
    });

    it('summary_body contains residency_country', () => {
      const narrative = generateLzNarrative({
        lz_id: 'aws/us-east-1',
        region_id: 'us-east-1',
        display: 'Amazon Web Services / us-east-1',
        fit: makeSovereigntyBlockedReport(),
        sovereigntyFacts: { operator_jurisdiction: 'US-entity', residency_country: 'US', certifications: [] },
      });
      expect(narrative.summary_body).toContain('US');
    });

    it('contains no em-dashes (U+2014) in any output', () => {
      const narrative = generateLzNarrative({
        lz_id: 'aws/us-east-1',
        region_id: 'us-east-1',
        display: 'Amazon Web Services / us-east-1',
        fit: makeSovereigntyBlockedReport(),
        sovereigntyFacts: { operator_jurisdiction: 'US-entity', residency_country: 'US', certifications: [] },
      });
      const emDash = String.fromCharCode(0x2014);
      expect(narrative.summary_headline.includes(emDash)).toBe(false);
      expect(narrative.summary_body.includes(emDash)).toBe(false);
    });

    it('verdict field is SOVEREIGNTY_BLOCKED', () => {
      const narrative = generateLzNarrative({
        lz_id: 'aws/us-east-1',
        region_id: 'us-east-1',
        display: 'Amazon Web Services / us-east-1',
        fit: makeSovereigntyBlockedReport(),
      });
      expect(narrative.verdict).toBe('SOVEREIGNTY_BLOCKED');
    });
  });

  describe('field mapping', () => {
    it('lz_id, region_id, display are passed through', () => {
      const narrative = generateLzNarrative({
        lz_id: 'aws/eu-central-1',
        region_id: 'eu-central-1',
        display: 'Amazon Web Services / eu-central-1',
        fit: makeReadyReport(),
      });
      expect(narrative.lz_id).toBe('aws/eu-central-1');
      expect(narrative.region_id).toBe('eu-central-1');
      expect(narrative.display).toBe('Amazon Web Services / eu-central-1');
    });

    it('evidence_files defaults to empty array', () => {
      const narrative = generateLzNarrative({
        lz_id: 'aws/eu-central-1',
        region_id: 'eu-central-1',
        display: 'Amazon Web Services / eu-central-1',
        fit: makeReadyReport(),
      });
      expect(narrative.evidence_files).toEqual([]);
    });

    it('evidence_files passed through when provided', () => {
      const narrative = generateLzNarrative({
        lz_id: 'aws/eu-central-1',
        region_id: 'eu-central-1',
        display: 'Amazon Web Services / eu-central-1',
        fit: makeReadyReport(),
        evidence_files: ['wsp/runs/2026-08-04/passes/lz-fit.yaml'],
      });
      expect(narrative.evidence_files).toHaveLength(1);
      expect(narrative.evidence_files[0]).toContain('lz-fit.yaml');
    });

    it('sovereignty.certifications defaults to [] when sovereigntyFacts not provided', () => {
      const narrative = generateLzNarrative({
        lz_id: 'aws/eu-central-1',
        region_id: 'eu-central-1',
        display: 'Amazon Web Services / eu-central-1',
        fit: makeReadyReport(),
      });
      expect(narrative.sovereignty.certifications).toEqual([]);
    });
  });
});
