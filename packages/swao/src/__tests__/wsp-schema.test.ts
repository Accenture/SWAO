// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { load } from 'js-yaml';
import { describe, it, expect } from 'vitest';
import { SpineSchema } from '../schema/wsp-spine.js';
import { EvidenceSchema } from '../schema/wsp-evidence.js';
import { PlanSchema, ObservabilitySchema, LicenceComplianceSchema, TestingMaturitySchema, ArchitectureAssessmentSchema, DatabaseAssessmentSchema, IntegrationAssessmentSchema, IamAssessmentSchema, DrAssessmentSchema, LandingZoneReadinessResultSchema } from '../schema/wsp-plan.js';
import { RiskRegisterItemSchema, ComplianceControlSchema } from '@swao/core';
import { PassFileSchema } from '../schema/wsp-pass.js';
import { SignalIdSchema } from '../schema/signals.js';
import { LandingZoneCandidateSchema, LandingZoneResultSchema } from '../schema/wsp-landing-zone.js';
import { SwaoYmlSchema, SwaoYmlCrawlSchema } from '../schema/swao-yml.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEDPLUM_WSP = join(
  __dirname,
  '../../../../../examples/portfolio-workspace/portfolio/apps/medplum/wsp',
);
const SOVEREIGN_HEALTH_WSP = join(
  __dirname,
  '../../../../../examples/portfolio-workspace/portfolio/apps/sovereign-health/wsp',
);

function loadYaml(filePath: string): unknown {
  return load(readFileSync(filePath, 'utf-8'));
}

describe('Medplum WSP v0.9 golden fixture', () => {
  it('pass 01 (inventory) parses without error', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'passes/01-inv.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 02 (statefulness) parses without error', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'passes/02-state.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 03 (data_classification) parses without error', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'passes/03-data.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 04 (egress) parses without error', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'passes/04-egress.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 05 (crypto_posture) parses without error', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'passes/05-crypto.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 06 (sbom_cve) parses without error', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'passes/06-sbom.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 07 (twelve_factor) parses without error', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'passes/07-tf.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 08 (seven_r_synthesis) parses without error', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'passes/08-synth.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass ctx (context_ingestion) parses without error', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'passes/ctx.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 15 (observability_readiness stub) parses without error', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'passes/15-obs.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('spine parses without error', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'wsp.yaml'));
    const result = SpineSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('evidence_catalogue parses without error', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'wsp-evidence.yaml'));
    const result = EvidenceSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('plan parses without error', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'wsp-plan.yaml'));
    const result = PlanSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 16 (licence_compliance) parses without error', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'passes/16-lic.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 19 (database_migration_assessment) parses without error', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'passes/19-dba.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 20 (integration_pattern_assessment) parses without error', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'passes/20-int.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 21 (iam_assessment) parses without error', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'passes/21-iam.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 22 (dr_backup_assessment) parses without error', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'passes/22-dr.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });
});

describe('Sovereign-health WSP v0.9 golden fixture', () => {
  it('spine parses without error', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'wsp.yaml'));
    const result = SpineSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 01 (inventory) parses without error', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'passes/01-inv.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 02 (statefulness) parses without error', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'passes/02-state.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 03 (data_classification) parses without error', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'passes/03-data.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 04 (egress) parses without error', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'passes/04-egress.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 05 (crypto_posture) parses without error', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'passes/05-crypto.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 06 (sbom_cve) parses without error', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'passes/06-sbom.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 07 (twelve_factor) parses without error', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'passes/07-tf.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 08 (seven_r_synthesis) parses without error', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'passes/08-synth.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass ctx (context_ingestion) parses without error', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'passes/ctx.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 19 (database_migration_assessment) parses without error', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'passes/19-dba.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 20 (integration_pattern_assessment) parses without error', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'passes/20-int.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 21 (iam_assessment) parses without error', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'passes/21-iam.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 22 (dr_backup_assessment) parses without error', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'passes/22-dr.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });
});

const GHOSTFOLIO_WSP = join(
  __dirname,
  '../../../../../examples/portfolio-workspace/portfolio/apps/ghostfolio/wsp',
);

describe('Ghostfolio WSP v0.9 golden fixture (iter-01)', () => {
  it('spine parses without error', () => {
    const raw = loadYaml(join(GHOSTFOLIO_WSP, 'wsp.yaml'));
    const result = SpineSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('evidence_catalogue parses without error', () => {
    const raw = loadYaml(join(GHOSTFOLIO_WSP, 'wsp-evidence.yaml'));
    const result = EvidenceSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('plan parses without error', () => {
    const raw = loadYaml(join(GHOSTFOLIO_WSP, 'wsp-plan.yaml'));
    const result = PlanSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('G-NEW-14: DORA regime entry is schema-valid and present in ghostfolio plan', () => {
    const raw = loadYaml(join(GHOSTFOLIO_WSP, 'wsp-plan.yaml')) as { compliance?: { regimes?: Array<{ id: string }> } };
    const result = PlanSchema.safeParse(raw);
    expect(result.success).toBe(true);
    const regimes = raw?.compliance?.regimes ?? [];
    const doraRegime = regimes.find((r) => r.id === 'DORA');
    expect(doraRegime, 'DORA regime must be present in compliance.regimes').toBeDefined();
  });

  it('pass 01 (inventory) parses without error', () => {
    const raw = loadYaml(join(GHOSTFOLIO_WSP, 'passes/01-inv.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 02 (state) parses without error', () => {
    const raw = loadYaml(join(GHOSTFOLIO_WSP, 'passes/02-state.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 03 (data) parses without error', () => {
    const raw = loadYaml(join(GHOSTFOLIO_WSP, 'passes/03-data.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 04 (context) parses without error', () => {
    const raw = loadYaml(join(GHOSTFOLIO_WSP, 'passes/04-ctx.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 05 (sbom) parses without error', () => {
    const raw = loadYaml(join(GHOSTFOLIO_WSP, 'passes/05-sbom.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 06 (twelve-factor) parses without error', () => {
    const raw = loadYaml(join(GHOSTFOLIO_WSP, 'passes/06-tf.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 07 (egress) parses without error', () => {
    const raw = loadYaml(join(GHOSTFOLIO_WSP, 'passes/07-egr.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 08 (crypto) parses without error', () => {
    const raw = loadYaml(join(GHOSTFOLIO_WSP, 'passes/08-crypto.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 19 (database_migration_assessment) parses without error', () => {
    const raw = loadYaml(join(GHOSTFOLIO_WSP, 'passes/19-dba.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 20 (integration_pattern_assessment) parses without error', () => {
    const raw = loadYaml(join(GHOSTFOLIO_WSP, 'passes/20-int.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 21 (iam_assessment) parses without error', () => {
    const raw = loadYaml(join(GHOSTFOLIO_WSP, 'passes/21-iam.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('pass 22 (dr_backup_assessment) parses without error', () => {
    const raw = loadYaml(join(GHOSTFOLIO_WSP, 'passes/22-dr.yaml'));
    const result = PassFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });
});

// =====================================================================
// Signal ID boundary test (issue #0086)
// =====================================================================

describe('SwaoYmlCrawlSchema (#0027)', () => {
  it('accepts a valid crawl block', () => {
    const result = SwaoYmlCrawlSchema.safeParse({
      target_url: 'https://app.example.com',
      screenshot_quality: 60,
      viewport_width: 1280,
      max_turns: 40,
    });
    expect(result.success).toBe(true);
  });

  it('accepts absence of all fields (all optional)', () => {
    expect(SwaoYmlCrawlSchema.safeParse({}).success).toBe(true);
  });

  it('rejects screenshot_quality below 0', () => {
    expect(SwaoYmlCrawlSchema.safeParse({ screenshot_quality: -1 }).success).toBe(false);
  });

  it('rejects screenshot_quality above 100', () => {
    expect(SwaoYmlCrawlSchema.safeParse({ screenshot_quality: 101 }).success).toBe(false);
  });

  it('rejects non-integer screenshot_quality', () => {
    expect(SwaoYmlCrawlSchema.safeParse({ screenshot_quality: 75.5 }).success).toBe(false);
  });

  it('rejects non-positive viewport_width', () => {
    expect(SwaoYmlCrawlSchema.safeParse({ viewport_width: 0 }).success).toBe(false);
    expect(SwaoYmlCrawlSchema.safeParse({ viewport_width: -1280 }).success).toBe(false);
  });

  it('rejects invalid auth_type', () => {
    expect(SwaoYmlCrawlSchema.safeParse({ auth_type: 'oauth2' }).success).toBe(false);
  });
});

describe('SwaoYmlSchema (#0027)', () => {
  it('accepts a minimal .swao.yml (source + no crawl)', () => {
    expect(SwaoYmlSchema.safeParse({ source: { path: '../app/src' } }).success).toBe(true);
  });

  it('accepts a full .swao.yml with valid crawl block', () => {
    const yml = {
      source: { path: '../app/src' },
      crawl: { target_url: 'https://app.example.com', screenshot_quality: 70, viewport_width: 1440 },
    };
    expect(SwaoYmlSchema.safeParse(yml).success).toBe(true);
  });

  it('fails when crawl.screenshot_quality is out of range', () => {
    const yml = { source: { path: '.' }, crawl: { screenshot_quality: 110 } };
    expect(SwaoYmlSchema.safeParse(yml).success).toBe(false);
  });
});

describe('LandingZoneCandidateSchema (#0095)', () => {
  const validCandidate = {
    id: 'stackit_de_sovereign',
    name: 'STACKIT (Deutsche Telekom)',
    fit_score: 0.87,
    rationale: 'DE_only residency guaranteed; BSI C5 attested; meshStack supported.',
    disqualified: false,
    service_gaps: [],
    certifications_matched: ['BSI_C5', 'ISO_27001'],
    lock_in_flags: [],
    overall_lock_in_risk: 'low',
  };

  it('accepts a fully valid candidate', () => {
    expect(LandingZoneCandidateSchema.safeParse(validCandidate).success).toBe(true);
  });

  it('accepts a disqualified candidate with reason', () => {
    const disq = {
      ...validCandidate,
      id: 'aws_eu_central_1',
      name: 'AWS eu-central-1',
      fit_score: 0.0,
      disqualified: true,
      disqualification_reason: 'DE_only residency not guaranteed; BSI C5 not attested.',
      lock_in_flags: [{ service: 'DynamoDB', risk: 'high', note: 'No equivalent sovereign service.' }],
      overall_lock_in_risk: 'high',
    };
    expect(LandingZoneCandidateSchema.safeParse(disq).success).toBe(true);
  });

  it('rejects fit_score outside [0, 1]', () => {
    expect(LandingZoneCandidateSchema.safeParse({ ...validCandidate, fit_score: 1.5 }).success).toBe(false);
    expect(LandingZoneCandidateSchema.safeParse({ ...validCandidate, fit_score: -0.1 }).success).toBe(false);
  });

  it('rejects invalid overall_lock_in_risk value', () => {
    expect(LandingZoneCandidateSchema.safeParse({ ...validCandidate, overall_lock_in_risk: 'critical' }).success).toBe(false);
  });

  it('rejects lock_in_flag with invalid risk level', () => {
    const bad = { ...validCandidate, lock_in_flags: [{ service: 'X', risk: 'extreme', note: 'y' }] };
    expect(LandingZoneCandidateSchema.safeParse(bad).success).toBe(false);
  });
});

describe('LandingZoneResultSchema (#0095)', () => {
  it('accepts an empty result (all fields optional)', () => {
    expect(LandingZoneResultSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a full result with candidates and recommendation', () => {
    const result = {
      landing_zone_candidates: [
        {
          id: 'stackit_de_sovereign',
          name: 'STACKIT',
          fit_score: 0.87,
          rationale: 'Best fit.',
          disqualified: false,
          service_gaps: [],
          certifications_matched: ['BSI_C5'],
          lock_in_flags: [],
          overall_lock_in_risk: 'low',
        },
      ],
      recommended_landing_zone: 'stackit_de_sovereign',
      landing_zone_recommendation_confidence: 'high',
      landing_zone_blockers: [],
    };
    expect(LandingZoneResultSchema.safeParse(result).success).toBe(true);
  });

  it('rejects invalid recommendation_confidence value', () => {
    expect(LandingZoneResultSchema.safeParse({
      landing_zone_recommendation_confidence: 'very_high',
    }).success).toBe(false);
  });
});

describe('SignalIdSchema -- boundary values', () => {
  it('accepts two-digit IDs: PREFIX-01 through PREFIX-09', () => {
    expect(SignalIdSchema.safeParse('EGR-01').success).toBe(true);
    expect(SignalIdSchema.safeParse('SBOM-09').success).toBe(true);
    expect(SignalIdSchema.safeParse('CRYPTO-05').success).toBe(true);
  });

  it('accepts two-digit IDs at 10+: PREFIX-10, PREFIX-99', () => {
    expect(SignalIdSchema.safeParse('EGR-10').success).toBe(true);
    expect(SignalIdSchema.safeParse('SBOM-10').success).toBe(true);
    expect(SignalIdSchema.safeParse('CRYPTO-99').success).toBe(true);
  });

  it('rejects three-digit IDs (old PREFIX-0N pattern at N>=10)', () => {
    expect(SignalIdSchema.safeParse('EGR-010').success).toBe(false);
    expect(SignalIdSchema.safeParse('SBOM-010').success).toBe(false);
    expect(SignalIdSchema.safeParse('CRYPTO-010').success).toBe(false);
  });
});

describe('ObservabilitySchema (Pass 15)', () => {
  const validBlock = {
    score: 0.375,
    threshold: 0.60,
    sovereign_migration_risk: 'elevated',
    components: [
      { id: 'structured_logging', status: 'absent', evidence_ref: 'no pino/winston' },
      { id: 'health_endpoints', status: 'configured' },
    ],
  };

  it('parses a valid observability block', () => {
    expect(ObservabilitySchema.safeParse(validBlock).success).toBe(true);
  });

  it('rejects score outside 0-1', () => {
    expect(ObservabilitySchema.safeParse({ ...validBlock, score: 1.5 }).success).toBe(false);
    expect(ObservabilitySchema.safeParse({ ...validBlock, score: -0.1 }).success).toBe(false);
  });

  it('rejects invalid sovereign_migration_risk enum value', () => {
    expect(ObservabilitySchema.safeParse({ ...validBlock, sovereign_migration_risk: 'high' }).success).toBe(false);
  });

  it('rejects invalid component status enum value', () => {
    const block = { ...validBlock, components: [{ id: 'structured_logging', status: 'unknown' }] };
    expect(ObservabilitySchema.safeParse(block).success).toBe(false);
  });

  it('allows optional evidence_ref to be omitted', () => {
    const block = { ...validBlock, components: [{ id: 'structured_logging', status: 'absent' }] };
    expect(ObservabilitySchema.safeParse(block).success).toBe(true);
  });

  it('Medplum wsp-plan.yaml parses with observability block', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'wsp-plan.yaml'));
    const result = PlanSchema.safeParse(raw);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
    expect((result.data as { observability?: { score: number } })?.observability?.score).toBe(0.375);
  });

  it('Sovereign Health wsp-plan.yaml parses with observability block', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'wsp-plan.yaml'));
    const result = PlanSchema.safeParse(raw);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
    expect((result.data as { observability?: { score: number } })?.observability?.score).toBe(0.625);
  });
});

describe('LicenceComplianceSchema (Pass 16)', () => {
  it('parses a clear licence_compliance block', () => {
    const block = { risk_level: 'clear', flagged_count: 0, flagged_dependencies: [] };
    expect(LicenceComplianceSchema.safeParse(block).success).toBe(true);
  });

  it('parses a block with flagged dependencies', () => {
    const block = {
      risk_level: 'critical',
      flagged_count: 1,
      flagged_dependencies: [
        { name: 'some-lib', version: '1.0.0', licence: 'AGPL-3.0', risk_tier: 'critical', dependency_type: 'transitive', signal_ref: 'LIC-01' },
      ],
    };
    expect(LicenceComplianceSchema.safeParse(block).success).toBe(true);
  });

  it('rejects invalid risk_level enum', () => {
    expect(LicenceComplianceSchema.safeParse({ risk_level: 'unknown', flagged_count: 0, flagged_dependencies: [] }).success).toBe(false);
  });

  it('rejects negative flagged_count', () => {
    expect(LicenceComplianceSchema.safeParse({ risk_level: 'clear', flagged_count: -1, flagged_dependencies: [] }).success).toBe(false);
  });

  it('rejects invalid dependency_type in flagged_dependencies', () => {
    const block = {
      risk_level: 'high',
      flagged_count: 1,
      flagged_dependencies: [{ name: 'lib', licence: 'GPL-2.0-only', risk_tier: 'high', dependency_type: 'bundled' }],
    };
    expect(LicenceComplianceSchema.safeParse(block).success).toBe(false);
  });

  it('Medplum wsp-plan.yaml parses with licence_compliance block', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'wsp-plan.yaml'));
    const result = PlanSchema.safeParse(raw);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
    expect((result.data as { licence_compliance?: { risk_level: string } })?.licence_compliance?.risk_level).toBe('clear');
  });

  it('Sovereign Health wsp-plan.yaml parses with licence_compliance block', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'wsp-plan.yaml'));
    const result = PlanSchema.safeParse(raw);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
    expect((result.data as { licence_compliance?: { flagged_count: number } })?.licence_compliance?.flagged_count).toBe(1);
  });
});

describe('TestingMaturitySchema (Pass 17)', () => {
  const validBlock = {
    score: 0.714,
    threshold: 0.65,
    sovereign_migration_risk: 'low',
    components: [
      { id: 'unit_tests', status: 'configured', evidence_ref: 'jest configured' },
      { id: 'dr_drill_documented', status: 'not_assessed' },
    ],
  };

  it('parses a valid testing_maturity block', () => {
    expect(TestingMaturitySchema.safeParse(validBlock).success).toBe(true);
  });

  it('accepts unknown as sovereign_migration_risk (QA-specific)', () => {
    expect(TestingMaturitySchema.safeParse({ ...validBlock, sovereign_migration_risk: 'unknown' }).success).toBe(true);
  });

  it('rejects invalid sovereign_migration_risk enum (not in ObservabilitySchema set)', () => {
    expect(TestingMaturitySchema.safeParse({ ...validBlock, sovereign_migration_risk: 'warning' }).success).toBe(false);
  });

  it('rejects score above 1.0', () => {
    expect(TestingMaturitySchema.safeParse({ ...validBlock, score: 1.1 }).success).toBe(false);
  });

  it('Medplum wsp-plan.yaml parses with testing_maturity block', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'wsp-plan.yaml'));
    const result = PlanSchema.safeParse(raw);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
    expect((result.data as { testing_maturity?: { score: number } })?.testing_maturity?.score).toBeCloseTo(0.714, 2);
  });

  it('Sovereign Health wsp-plan.yaml parses with testing_maturity block', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'wsp-plan.yaml'));
    const result = PlanSchema.safeParse(raw);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
    expect((result.data as { testing_maturity?: { sovereign_migration_risk: string } })?.testing_maturity?.sovereign_migration_risk).toBe('elevated');
  });
});

describe('ArchitectureAssessmentSchema (Pass 18)', () => {
  const validBlock = {
    score: 0.75,
    threshold: 0.70,
    components: [
      { id: 'PAT-01', pattern: 'api_specification_present', status: 'configured', evidence: ['PKG-04'] },
      { id: 'PAT-08', pattern: 'circuit_breaker_or_retry', status: 'absent' },
    ],
  };

  it('parses a valid architecture_assessment block', () => {
    expect(ArchitectureAssessmentSchema.safeParse(validBlock).success).toBe(true);
  });

  it('parses block with optional policy_compliance', () => {
    const block = {
      ...validBlock,
      policy_compliance: { policy_version: '2.1', mandatory_violations: 1, warning_violations: 0, verdict: 'non_compliant' },
    };
    expect(ArchitectureAssessmentSchema.safeParse(block).success).toBe(true);
  });

  it('rejects component with malformed signal ID', () => {
    const block = { ...validBlock, components: [{ id: 'INVALID', pattern: 'api_spec', status: 'configured' }] };
    expect(ArchitectureAssessmentSchema.safeParse(block).success).toBe(false);
  });

  it('rejects invalid policy_compliance verdict', () => {
    const block = {
      ...validBlock,
      policy_compliance: { policy_version: '1.0', mandatory_violations: 0, warning_violations: 0, verdict: 'unknown' },
    };
    expect(ArchitectureAssessmentSchema.safeParse(block).success).toBe(false);
  });

  it('Medplum wsp-plan.yaml parses with architecture_assessment block', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'wsp-plan.yaml'));
    const result = PlanSchema.safeParse(raw);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
    expect((result.data as { architecture_assessment?: { score: number } })?.architecture_assessment?.score).toBe(0.750);
  });

  it('Sovereign Health wsp-plan.yaml parses with architecture_assessment block', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'wsp-plan.yaml'));
    const result = PlanSchema.safeParse(raw);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
    expect((result.data as { architecture_assessment?: { score: number } })?.architecture_assessment?.score).toBe(0.875);
  });
});

// =====================================================================
// Pass 19-22 schema unit tests (#0074-#0077)
// =====================================================================

describe('DatabaseAssessmentSchema (Pass 19)', () => {
  it('accepts a minimal database_assessment object', () => {
    const result = DatabaseAssessmentSchema.safeParse({
      engines: [{ name: 'postgresql', version: '15' }],
      overall_risk: 'low',
    });
    expect(result.success).toBe(true);
  });

  it('accepts overall_risk: high with extra passthrough fields', () => {
    const result = DatabaseAssessmentSchema.safeParse({
      engines: [{ name: 'oracle', version: '11g', stored_procedures_detected: true }],
      overall_risk: 'high',
      rationale_signal: 'SYNTH-15',
      custom_field: 'allowed by passthrough',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object (all fields optional)', () => {
    expect(DatabaseAssessmentSchema.safeParse({}).success).toBe(true);
  });

  it('Medplum wsp-plan.yaml parses with database_assessment block', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'wsp-plan.yaml'));
    const result = PlanSchema.safeParse(raw);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
    const plan = result.data as { database_assessment?: { overall_risk?: string } };
    expect(plan.database_assessment?.overall_risk).toBeDefined();
  });

  it('Sovereign Health wsp-plan.yaml parses with database_assessment block', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'wsp-plan.yaml'));
    const result = PlanSchema.safeParse(raw);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
  });
});

describe('IntegrationAssessmentSchema (Pass 20)', () => {
  it('accepts a minimal integration_assessment object', () => {
    const result = IntegrationAssessmentSchema.safeParse({
      patterns_detected: [{ name: 'bull_redis_queue', type: 'async_queue' }],
      esb_detected: false,
      overall_risk: 'low',
    });
    expect(result.success).toBe(true);
  });

  it('accepts object with kafka and rabbitmq flags', () => {
    const result = IntegrationAssessmentSchema.safeParse({
      kafka_detected: true,
      rabbitmq_detected: false,
      ibm_mq_detected: false,
      overall_risk: 'high',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object (all fields optional)', () => {
    expect(IntegrationAssessmentSchema.safeParse({}).success).toBe(true);
  });

  it('Medplum wsp-plan.yaml parses with integration_assessment block', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'wsp-plan.yaml'));
    const result = PlanSchema.safeParse(raw);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
    const plan = result.data as { integration_assessment?: { overall_risk?: string } };
    expect(plan.integration_assessment?.overall_risk).toBeDefined();
  });
});

describe('IamAssessmentSchema (Pass 21)', () => {
  it('accepts a well-formed iam_assessment object', () => {
    const result = IamAssessmentSchema.safeParse({
      idp_dependency: { external_idp_detected: false, self_hosted_jwt: true },
      iam_migration_complexity: 'low',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown iam_migration_complexity values', () => {
    const result = IamAssessmentSchema.safeParse({
      iam_migration_complexity: 'extreme',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid complexity values', () => {
    for (const v of ['trivial', 'low', 'moderate', 'high']) {
      expect(IamAssessmentSchema.safeParse({ iam_migration_complexity: v }).success).toBe(true);
    }
  });

  it('accepts empty object (all fields optional)', () => {
    expect(IamAssessmentSchema.safeParse({}).success).toBe(true);
  });

  it('Medplum wsp-plan.yaml parses with iam_assessment block', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'wsp-plan.yaml'));
    const result = PlanSchema.safeParse(raw);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
    const plan = result.data as { iam_assessment?: { iam_migration_complexity?: string } };
    expect(plan.iam_assessment?.iam_migration_complexity).toBeDefined();
  });
});

describe('DrAssessmentSchema (Pass 22)', () => {
  it('accepts a full dr_assessment object including null nullable fields', () => {
    const result = DrAssessmentSchema.safeParse({
      backup_strategy: {
        detected: false,
        type: 'none',
        retention_days: null,
        encrypted: null,
        cross_region: false,
      },
      rpo_claimed_hours: 1,
      rto_claimed_hours: 4,
      migration_window_hours: null,
      migration_window_exceeds_rto: false,
      last_dr_test: { date: null, gap_months: null, finding: 'dr_test_gap' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a dr_assessment with real numeric migration_window_hours', () => {
    const result = DrAssessmentSchema.safeParse({
      rpo_claimed_hours: 0.5,
      rto_claimed_hours: 2,
      migration_window_hours: 0.42,
      migration_window_exceeds_rto: false,
      rationale_signal: 'DR-03',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object (all fields optional)', () => {
    expect(DrAssessmentSchema.safeParse({}).success).toBe(true);
  });

  it('Medplum wsp-plan.yaml parses with dr_assessment block', () => {
    const raw = loadYaml(join(MEDPLUM_WSP, 'wsp-plan.yaml'));
    const result = PlanSchema.safeParse(raw);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
    const plan = result.data as { dr_assessment?: { migration_window_exceeds_rto?: boolean } };
    expect(plan.dr_assessment?.migration_window_exceeds_rto).toBe(true);
  });

  it('Sovereign Health wsp-plan.yaml parses with dr_assessment block', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'wsp-plan.yaml'));
    const result = PlanSchema.safeParse(raw);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
    const plan = result.data as { dr_assessment?: { rpo_claimed_hours?: number } };
    expect(plan.dr_assessment?.rpo_claimed_hours).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// LandingZoneReadinessResultSchema (Pass 23, #0103)
// ---------------------------------------------------------------------------

describe('LandingZoneReadinessResultSchema (#0103)', () => {
  const READY_FIXTURE = {
    provider_id: 'stackit_de_sovereign',
    landing_zone_id: 'lz-ghostfolio-prod',
    assessed_at: '2026-04-28',
    ingestion_strategy: 'terraform',
    blockers: [],
    warnings: [],
    service_checks: [
      {
        service: 'postgresql',
        required: true,
        available_in_lz: true,
        provisioned_in_lz: true,
        version_compatible: true,
        status: 'ready',
      },
    ],
    quota_checks: [],
    policy_checks: [],
    network_checks: [],
    overall_verdict: 'ready',
  };

  it('parses a well-formed ready fixture', () => {
    const result = LandingZoneReadinessResultSchema.safeParse(READY_FIXTURE);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
    expect(result.data?.overall_verdict).toBe('ready');
  });

  it('accepts blocked verdict with a blocker item', () => {
    const fixture = {
      ...READY_FIXTURE,
      overall_verdict: 'blocked',
      blockers: [
        {
          check_id: 'LZ-BLK-01',
          category: 'quota',
          service: 'kubernetes',
          description: 'SKE quota exhausted.',
          evidence: ['STACKIT IaaS API: limit=5, used=5'],
          remediation: 'Request quota increase.',
          blocks_migration: true,
        },
      ],
    };
    const result = LandingZoneReadinessResultSchema.safeParse(fixture);
    expect(result.success).toBe(true);
    expect(result.data?.blockers[0].check_id).toBe('LZ-BLK-01');
  });

  it('accepts advisory verdict with a warning item', () => {
    const fixture = {
      ...READY_FIXTURE,
      overall_verdict: 'advisory',
      warnings: [
        {
          check_id: 'LZ-WRN-01',
          category: 'service',
          description: 'PostgreSQL Flex not yet provisioned.',
          evidence: ['Terraform state: no postgresql_flex resource found'],
        },
      ],
    };
    const result = LandingZoneReadinessResultSchema.safeParse(fixture);
    expect(result.success).toBe(true);
    expect(result.data?.overall_verdict).toBe('advisory');
  });

  it('rejects unknown overall_verdict', () => {
    const result = LandingZoneReadinessResultSchema.safeParse({
      ...READY_FIXTURE,
      overall_verdict: 'unknown',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown ingestion_strategy', () => {
    const result = LandingZoneReadinessResultSchema.safeParse({
      ...READY_FIXTURE,
      ingestion_strategy: 'manual',
    });
    expect(result.success).toBe(false);
  });

  it('accepts null for nullable service_check fields', () => {
    const fixture = {
      ...READY_FIXTURE,
      service_checks: [
        {
          service: 'redis',
          required: true,
          available_in_lz: true,
          provisioned_in_lz: false,
          version_compatible: null,
          status: 'warning',
        },
      ],
    };
    const result = LandingZoneReadinessResultSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('LZR prefix is accepted by SIGNAL_ID_REGEX', async () => {
    const { SignalIdSchema } = await import('../schema/signals.js');
    expect(SignalIdSchema.safeParse('LZR-01').success).toBe(true);
    expect(SignalIdSchema.safeParse('LZR-23').success).toBe(true);
  });

  it('MAL prefix is accepted by SIGNAL_ID_REGEX (#1583)', async () => {
    const { SignalIdSchema } = await import('../schema/signals.js');
    expect(SignalIdSchema.safeParse('MAL-00').success).toBe(true);
    expect(SignalIdSchema.safeParse('MAL-01').success).toBe(true);
    expect(SignalIdSchema.safeParse('MAL-03').success).toBe(true);
    expect(SignalIdSchema.safeParse('MAL-09').success).toBe(true);
    expect(SignalIdSchema.safeParse('MAL-12').success).toBe(true);
  });

  it('accepts landing_zone_readiness as optional field in PlanSchema', () => {
    const planWithLzr = {
      migration_plan: { runbook: [], data_migration: undefined },
      risk_register: [],
      value_case: [],
      compliance: { regimes: [] },
      security_findings: [],
      assumptions: [],
      data_gaps: [],
      landing_zone_readiness: READY_FIXTURE,
    };
    const result = PlanSchema.safeParse(planWithLzr);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
  });

  it('existing PlanSchema fixture still valid when landing_zone_readiness absent', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'wsp-plan.yaml'));
    const result = PlanSchema.safeParse(raw);
    expect(result.success).toBe(true);
  });
});

// #0597 (sprint-073): WSP spine v0.11 -- assessment_type + version skew reconcile.
// ADR-0012 §5.6 requires a fixture-WSP test for every schema change.
describe('WSP spine v0.11 schema (#0597)', () => {
  const minimalBase = {
    assessed_at: '2026-06-30T00:00:00.000Z',
    meta: { assessor: 'swao', assessment_date: '2026-06-30', simulation_type: 'auto', iter: 1 },
    overall: { seven_r_label: 'Retain', categories: [] },
    passes_executed: [],
    wsp_files: { evidence: 'wsp-evidence.yaml', plan: 'wsp-plan.yaml', passes_dir: 'passes' },
    app: { name: 'test-app' },
  };

  it('accepts wsp_version 0.9 (existing fixtures)', () => {
    const result = SpineSchema.safeParse({ ...minimalBase, wsp_version: '0.9' });
    expect(result.success).toBe(true);
  });

  it('accepts wsp_version 0.10 (module-powerbi fixtures)', () => {
    const result = SpineSchema.safeParse({ ...minimalBase, wsp_version: '0.10' });
    expect(result.success).toBe(true);
  });

  it('accepts wsp_version 0.11 with assessment_type (audit/lz write path)', () => {
    const result = SpineSchema.safeParse({ ...minimalBase, wsp_version: '0.11', assessment_type: 'audit' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assessment_type).toBe('audit');
  });

  it('accepts wsp_version 0.11 with assessment_type landing-zone', () => {
    const result = SpineSchema.safeParse({ ...minimalBase, wsp_version: '0.11', assessment_type: 'landing-zone' });
    expect(result.success).toBe(true);
  });

  it('rejects unknown wsp_version', () => {
    const result = SpineSchema.safeParse({ ...minimalBase, wsp_version: '0.8' });
    expect(result.success).toBe(false);
  });

  it('accepts wsp_version 0.12 (Design 080 Phase 0 write path)', () => {
    const result = SpineSchema.safeParse({ ...minimalBase, wsp_version: '0.12' });
    expect(result.success).toBe(true);
  });
});

// Design 080 Phase 0 backward-compat gate (#1172): existing WSPs parse correctly
// with the new schema additions; new optional fields are absent on old WSPs.
describe('WSP schema Phase 0 backward-compat gate (#1172)', () => {
  it('existing wsp-plan.yaml fixture still parses after Phase 0 schema additions', () => {
    const raw = loadYaml(join(SOVEREIGN_HEALTH_WSP, 'wsp-plan.yaml'));
    const result = PlanSchema.safeParse(raw);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
  });

  it('old risk register item (no new fields) parses with new RiskRegisterItemSchema', () => {
    const oldItem = {
      risk_id: 'RISK-01',
      category: 'technical',
      likelihood: 'medium',
      impact: 'high',
      trigger: 'service mesh fails',
      mitigation: 'canary deployment',
      owner: 'platform-team',
    };
    const result = RiskRegisterItemSchema.safeParse(oldItem);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBeUndefined();
      expect(result.data.evidence_ids).toBeUndefined();
      expect(result.data.closed_rationale).toBeUndefined();
      expect(result.data.machine_outcome).toBeUndefined();
      expect(result.data.override).toBeUndefined();
    }
  });

  it('old compliance control (no new fields) parses with new ComplianceControlSchema', () => {
    const oldControl = {
      id: 'GDPR-ART5-1A',
      status: 'SATISFIED',
      outcome: 'SATISFIED',
      rationale: 'Data minimisation is enforced by the ingestion pipeline at the source.',
      evidence_ids: ['E-001'],
    };
    const result = ComplianceControlSchema.safeParse(oldControl);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.machine_outcome).toBeUndefined();
      expect(result.data.override).toBeUndefined();
    }
  });

  it('new risk register item with Phase 0 fields parses correctly', () => {
    const newItem = {
      risk_id: 'RISK-02',
      category: 'compliance',
      likelihood: 'low',
      impact: 'critical',
      trigger: 'data sovereignty gap',
      mitigation: 'isolate PII to EU region',
      owner: 'dpo',
      status: 'mitigated',
      evidence_ids: ['E-002', 'E-003'],
      machine_outcome: 'open',
      override: {
        author: 'alice@example.com',
        role: 'DPO',
        timestamp: '2026-07-21T12:00:00.000Z',
        rationale: 'PII isolation confirmed via audit log review.',
      },
    };
    const result = RiskRegisterItemSchema.safeParse(newItem);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('mitigated');
      expect(result.data.evidence_ids).toEqual(['E-002', 'E-003']);
      expect(result.data.machine_outcome).toBe('open');
      expect(result.data.override?.author).toBe('alice@example.com');
    }
  });
});
