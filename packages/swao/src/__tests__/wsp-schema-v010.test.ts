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

import { describe, it, expect } from 'vitest';
import { SignalSchema, SignalOutcomeSchema } from '../schema/signals.js';
import {
  PlanSchema,
  ComplianceControlSchema,
  ComplianceControlOutcomeSchema,
  ObservabilitySchema,
  TestingMaturitySchema,
  DatabaseAssessmentSchema,
  IntegrationAssessmentSchema,
  IamAssessmentSchema,
  DrAssessmentSchema,
  LicenceComplianceSchema,
  ArchitectureAssessmentSchema,
  CstClassRequiredSchema,
  MaturityAssessmentSchema,
} from '../schema/wsp-plan.js';

const baseSignal = {
  id: 'CRYPTO-04',
  source: 'static_analysis' as const,
  category: 'application' as const,
  derivation: 'AES-256-GCM detected via crypto.createCipheriv match in src/db.ts',
  evidence: ['PKG-04'],
  confidence: 'high' as const,
};

describe('SignalSchema v0.10 (#0167)', () => {
  it('accepts the existing required field set unchanged', () => {
    expect(SignalSchema.safeParse(baseSignal).success).toBe(true);
  });

  it('rejects derivation shorter than 20 chars (new constraint)', () => {
    const result = SignalSchema.safeParse({ ...baseSignal, derivation: 'short' });
    expect(result.success).toBe(false);
  });

  it('accepts the four-value outcome enum', () => {
    for (const outcome of ['positive', 'negative', 'neutral', 'indeterminate'] as const) {
      const result = SignalSchema.safeParse({ ...baseSignal, outcome });
      expect(result.success, `outcome=${outcome}`).toBe(true);
    }
  });

  it('rejects an invalid outcome value', () => {
    expect(SignalSchema.safeParse({ ...baseSignal, outcome: 'maybe' }).success).toBe(false);
  });

  it('accepts the false_positive_considered + false_positive_ruled_out pair', () => {
    const result = SignalSchema.safeParse({
      ...baseSignal,
      severity: 'high',
      outcome: 'negative',
      false_positive_considered: true,
      false_positive_ruled_out: 'considered that this is a test fixture; ruled out because path is in src/, not tests/',
    });
    expect(result.success).toBe(true);
  });

  it('rejects false_positive_ruled_out shorter than 20 chars', () => {
    const result = SignalSchema.safeParse({
      ...baseSignal,
      severity: 'high',
      outcome: 'negative',
      false_positive_considered: true,
      false_positive_ruled_out: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('accepts the assessor enum (rule_engine | llm | human_override)', () => {
    for (const assessor of ['rule_engine', 'llm', 'human_override'] as const) {
      const result = SignalSchema.safeParse({ ...baseSignal, assessor });
      expect(result.success, `assessor=${assessor}`).toBe(true);
    }
  });

  it('rejects an invalid assessor value', () => {
    expect(SignalSchema.safeParse({ ...baseSignal, assessor: 'random' }).success).toBe(false);
  });

  it('accepts assessed_at and derivation_chain', () => {
    const result = SignalSchema.safeParse({
      ...baseSignal,
      assessed_at: '2026-05-09T13:00:00Z',
      derivation_chain: ['PKG-04', 'PKG-08', 'STATE-01'],
    });
    expect(result.success).toBe(true);
  });

  it('all v0.10 fields are optional (a v0.9-shaped signal still validates)', () => {
    const v09 = {
      ...baseSignal,
      severity: 'low' as const,
    };
    expect(SignalSchema.safeParse(v09).success).toBe(true);
  });

  it('SignalOutcomeSchema is exported and constrains to the four-value enum', () => {
    expect(SignalOutcomeSchema.safeParse('positive').success).toBe(true);
    expect(SignalOutcomeSchema.safeParse('SATISFIED').success).toBe(false);
  });
});

describe('ComplianceControlSchema v0.10 (#0168)', () => {
  const v09Control = {
    id: 'GDPR_Art_32',
    status: 'PARTIAL',
    evidence: ['PKG-04'],
    severity: 'high',
  };

  it('the v0.9 shape (status + evidence + severity) still validates', () => {
    expect(ComplianceControlSchema.safeParse(v09Control).success).toBe(true);
  });

  it('the five-value outcome enum is accepted', () => {
    for (const outcome of ['SATISFIED', 'PARTIAL', 'GAP', 'UNKNOWN', 'N_A'] as const) {
      const result = ComplianceControlSchema.safeParse({ id: 'X', outcome });
      expect(result.success, `outcome=${outcome}`).toBe(true);
    }
  });

  it('accepts the auditor field set together', () => {
    const v10 = {
      id: 'GDPR_Art_32',
      outcome: 'PARTIAL' as const,
      rationale: 'Encryption at rest verified for primary database; pgbouncer log file unencrypted',
      signal_refs: ['CRYPTO-04', 'CRYPTO-09'],
      evidence_ids: ['PKG-04', 'PKG-08'],
      assessor: 'rule_engine' as const,
      assessed_at: '2026-05-09T13:00:00Z',
      remediation: 'Move log file to encrypted volume mount',
      references: ['GDPR Article 32(1)'],
    };
    expect(ComplianceControlSchema.safeParse(v10).success).toBe(true);
  });

  it('rejects rationale shorter than 20 chars', () => {
    const result = ComplianceControlSchema.safeParse({
      id: 'GDPR_Art_32',
      outcome: 'PARTIAL',
      rationale: 'too short',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid outcome enum value', () => {
    expect(
      ComplianceControlSchema.safeParse({ id: 'X', outcome: 'PASS' }).success,
    ).toBe(false);
  });

  it('ComplianceControlOutcomeSchema is exported with the five-value enum', () => {
    expect(ComplianceControlOutcomeSchema.safeParse('SATISFIED').success).toBe(true);
    expect(ComplianceControlOutcomeSchema.safeParse('positive').success).toBe(false);
  });
});

describe('Per-pass assessment block v0.10 additions (#0169)', () => {
  const auditorFields = {
    overall_outcome: 'negative' as const,
    overall_rationale: 'Critical migration blocker identified through static and dynamic analysis',
    assessor: 'rule_engine' as const,
    assessed_at: '2026-05-09T13:00:00Z',
  };

  it('ObservabilitySchema accepts the auditor fields', () => {
    const block = {
      score: 0.5,
      threshold: 0.7,
      sovereign_migration_risk: 'medium' as const,
      components: [],
      ...auditorFields,
    };
    expect(ObservabilitySchema.safeParse(block).success).toBe(true);
  });

  it('TestingMaturitySchema accepts the auditor fields', () => {
    const block = {
      score: 0.6,
      threshold: 0.7,
      sovereign_migration_risk: 'medium' as const,
      components: [],
      ...auditorFields,
    };
    expect(TestingMaturitySchema.safeParse(block).success).toBe(true);
  });

  it('LicenceComplianceSchema accepts the auditor fields', () => {
    const block = {
      risk_level: 'low' as const,
      flagged_count: 0,
      flagged_dependencies: [],
      ...auditorFields,
    };
    expect(LicenceComplianceSchema.safeParse(block).success).toBe(true);
  });

  it('ArchitectureAssessmentSchema accepts the auditor fields', () => {
    const block = {
      score: 0.8,
      threshold: 0.7,
      components: [],
      ...auditorFields,
    };
    expect(ArchitectureAssessmentSchema.safeParse(block).success).toBe(true);
  });

  it('DatabaseAssessmentSchema accepts the auditor fields', () => {
    const block = {
      overall_risk: 'low_medium',
      ...auditorFields,
    };
    expect(DatabaseAssessmentSchema.safeParse(block).success).toBe(true);
  });

  it('IntegrationAssessmentSchema accepts the auditor fields', () => {
    const block = {
      overall_risk: 'low',
      ...auditorFields,
    };
    expect(IntegrationAssessmentSchema.safeParse(block).success).toBe(true);
  });

  it('IamAssessmentSchema accepts the auditor fields', () => {
    const block = {
      iam_migration_complexity: 'low' as const,
      ...auditorFields,
    };
    expect(IamAssessmentSchema.safeParse(block).success).toBe(true);
  });

  it('DrAssessmentSchema accepts the auditor fields', () => {
    const block = {
      rpo_claimed_hours: 1,
      rto_claimed_hours: 2,
      ...auditorFields,
    };
    expect(DrAssessmentSchema.safeParse(block).success).toBe(true);
  });

  it('every block tolerates the absence of all auditor fields (v0.9 back-compat)', () => {
    expect(
      ObservabilitySchema.safeParse({
        score: 0.5,
        threshold: 0.7,
        sovereign_migration_risk: 'medium',
        components: [],
      }).success,
    ).toBe(true);
    expect(
      DatabaseAssessmentSchema.safeParse({ overall_risk: 'low' }).success,
    ).toBe(true);
  });

  it('overall_rationale shorter than 20 chars is rejected', () => {
    const result = ObservabilitySchema.safeParse({
      score: 0.5,
      threshold: 0.7,
      sovereign_migration_risk: 'medium',
      components: [],
      overall_rationale: 'short',
    });
    expect(result.success).toBe(false);
  });
});

describe('PlanSchema integration with v0.10 fields', () => {
  it('a v0.10 plan with auditor fields on controls + assessment blocks validates', () => {
    const plan = {
      migration_plan: { runbook: [] },
      risk_register: [],
      value_case: [],
      compliance: {
        regimes: [
          {
            id: 'GDPR',
            status: 'partial',
            controls: [
              {
                id: 'GDPR_Art_32',
                outcome: 'PARTIAL',
                rationale: 'Encryption at rest verified; pgbouncer log file unencrypted (gap)',
                signal_refs: ['CRYPTO-04'],
                evidence_ids: ['PKG-08'],
                assessor: 'rule_engine',
                assessed_at: '2026-05-09T13:00:00Z',
              },
            ],
          },
        ],
      },
      security_findings: [],
      assumptions: [],
      data_gaps: [],
      observability: {
        score: 0.6,
        threshold: 0.7,
        sovereign_migration_risk: 'medium',
        components: [],
        overall_outcome: 'negative',
        overall_rationale: 'Distributed tracing absent; partial logging coverage on critical paths',
        assessor: 'rule_engine',
        assessed_at: '2026-05-09T13:00:00Z',
      },
    };
    const result = PlanSchema.safeParse(plan);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
  });
});

// ---- #1139 + #1142: Saudi Arabia schema additions ----

describe('CstClassRequiredSchema (#1139)', () => {
  it('accepts all four licensing class values', () => {
    for (const v of ['qualification', 'class_a', 'class_b', 'class_c'] as const) {
      expect(CstClassRequiredSchema.safeParse(v).success, `value=${v}`).toBe(true);
    }
  });

  it('accepts null (non-Saudi run or tier unknown)', () => {
    expect(CstClassRequiredSchema.safeParse(null).success).toBe(true);
  });

  it('rejects unknown class values', () => {
    expect(CstClassRequiredSchema.safeParse('class_d').success).toBe(false);
    expect(CstClassRequiredSchema.safeParse('').success).toBe(false);
  });
});

describe('MaturityAssessmentSchema (#1142)', () => {
  const domainBlocked = {
    domain_id: 'SAMA_CSF_GOV',
    domain_name: 'Leadership and Governance',
    measured_level: 2,
    minimum_required: 3,
    verdict: 'blocked' as const,
  };
  const domainReady = {
    domain_id: 'SAMA_CSF_OPS',
    domain_name: 'Cybersecurity Operations',
    measured_level: 3,
    minimum_required: 3,
    verdict: 'ready' as const,
  };
  const domainUnknown = {
    domain_id: 'SAMA_CSF_RES',
    domain_name: 'Cyber Resilience',
    measured_level: null,
    minimum_required: 3,
    verdict: 'unknown' as const,
  };

  it('accepts a fully populated maturity assessment', () => {
    const ma = {
      framework_id: 'SAMA_CSF',
      domains: [domainBlocked, domainReady, domainUnknown],
      overall_verdict: 'blocked' as const,
    };
    expect(MaturityAssessmentSchema.safeParse(ma).success).toBe(true);
  });

  it('accepts all-ready verdict', () => {
    const ma = {
      framework_id: 'SAMA_CSF',
      domains: [domainReady],
      overall_verdict: 'ready' as const,
    };
    expect(MaturityAssessmentSchema.safeParse(ma).success).toBe(true);
  });

  it('rejects measured_level outside 0-5', () => {
    const d = { ...domainReady, measured_level: 6 };
    const ma = { framework_id: 'SAMA_CSF', domains: [d], overall_verdict: 'blocked' as const };
    expect(MaturityAssessmentSchema.safeParse(ma).success).toBe(false);
  });

  it('rejects minimum_required of 0 (must be 1+)', () => {
    const d = { ...domainReady, minimum_required: 0 };
    const ma = { framework_id: 'SAMA_CSF', domains: [d], overall_verdict: 'ready' as const };
    expect(MaturityAssessmentSchema.safeParse(ma).success).toBe(false);
  });
});

describe('PlanSchema backwards compatibility with Saudi fields (#1139 + #1142)', () => {
  const basePlan = {
    migration_plan: { runbook: [] },
    risk_register: [],
    value_case: [],
    security_findings: [],
    assumptions: [],
    data_gaps: [],
  };

  it('plan without Saudi fields is still valid (back-compat)', () => {
    expect(PlanSchema.safeParse(basePlan).success).toBe(true);
  });

  it('plan with cst_class_required is valid', () => {
    const plan = { ...basePlan, cst_class_required: 'class_b' as const };
    expect(PlanSchema.safeParse(plan).success).toBe(true);
  });

  it('plan with cst_class_required null is valid', () => {
    const plan = { ...basePlan, cst_class_required: null };
    expect(PlanSchema.safeParse(plan).success).toBe(true);
  });

  it('plan with maturity_assessment is valid', () => {
    const plan = {
      ...basePlan,
      maturity_assessment: {
        framework_id: 'SAMA_CSF',
        domains: [
          {
            domain_id: 'SAMA_CSF_GOV',
            domain_name: 'Leadership and Governance',
            measured_level: 3,
            minimum_required: 3,
            verdict: 'ready' as const,
          },
        ],
        overall_verdict: 'ready' as const,
      },
    };
    expect(PlanSchema.safeParse(plan).success).toBe(true);
  });
});
