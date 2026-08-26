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

import { z } from 'zod';
import { SignalIdSchema, SignalOutcomeSchema, AssessorSchema } from './signals.js';
import { LandingZoneReadinessResultSchema } from './wsp-lzr.js';
import {
  ScopeCoverageSchema,
  ComplianceControlOutcomeSchema,
  ComplianceControlSchema,
  ComplianceRegimeSchema,
  RiskRegisterItemSchema,
} from '@swao/core';

// Re-export for existing import sites (wsp-plan.ts was the previous home of
// these schemas; @swao/core is now the source of truth per Design 080 §7.1).
export { ComplianceControlOutcomeSchema, ComplianceControlSchema, ComplianceRegimeSchema };
export type {
  ComplianceControl,
  ComplianceRegime,
  RiskRegisterItem,
} from '@swao/core';

// ---------------------------------------------------------------------------
// v0.10 auditor-grade additions on assessment blocks (ADR-0025; design 020).
// Optional in v0.10; doctor probe (#0170) warns when missing.
// ---------------------------------------------------------------------------

const AssessmentBlockAuditorFields = {
  overall_outcome: SignalOutcomeSchema.optional(),
  overall_rationale: z.string().min(20).optional(),
  assessor: AssessorSchema.optional(),
  assessed_at: z.string().optional(),
};

const RunbookStepSchema = z
  .object({
    id: z.string(),
    action: z.string(),
    evidence: z.string(),
  })
  .passthrough();

const RunbookComponentSchema = z.object({
  component: z.string(),
  disposition: z.string(),
  steps: z.array(RunbookStepSchema),
});

// Sprint-038 #0060: data-migration feasibility verdict + computation
// inputs. Three-way verdict per the issue's formula:
//   transfer_hours <= 0.6 * rto_hours -> feasible
//   transfer_hours <= 1.0 * rto_hours -> marginal
//   transfer_hours >  1.0 * rto_hours -> requires_phased_migration
// `storage_source` records where the volume estimate came from so an
// auditor can weigh evidence (FinOps export vs CMDB row vs operator
// `.swao.yml` override vs assumed default). FinOps + CMDB automatic
// extraction is a sprint-039 follow-up; for now the operator supplies
// the volume via `.swao.yml migration:` (see swao-yml.ts).
const DataMigrationSchema = z
  .object({
    feasibility_verdict: z.enum(['feasible', 'marginal', 'requires_phased_migration']),
    total_stateful_volume_gb: z.number().optional(),
    storage_source: z.enum(['finops_export', 'cmdb', 'swao_yml_override', 'assumed_default']).optional(),
    transfer_rate_gbph: z.number().optional(),
    estimated_transfer_hours: z.number().optional(),
    rto_hours: z.number().optional(),
    strategy: z.string().optional(),
    feasibility_note: z.string().optional(),
    risk_register_ref: z.string().optional(),
  })
  .passthrough();


const ComplianceSchema = z
  .object({
    regimes: z.array(ComplianceRegimeSchema),
    cross_regime_overlap: z.array(z.object({}).passthrough()).optional(),
  })
  .passthrough();

const SecurityFindingSchema = z
  .object({
    id: z.string(),
    category: z.string(),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'informational']),
    description: z.string(),
    remediation: z.string(),
    blocks_migration: z.boolean(),
    signal_ref: SignalIdSchema.optional(),
  })
  .passthrough();

const ContextOverrideSchema = z.object({
  signal_id: SignalIdSchema,
  input_id: z.string(),
  override_type: z.string(),
  context_claim: z.string(),
  code_evidence: z.string(),
  resolution: z.string(),
  emitted_by: z.string(),
});

const AssessmentComponentStatusSchema = z.enum(['configured', 'partial', 'not_assessed', 'absent']);

const ArchitectureComponentSchema = z.object({
  id: SignalIdSchema,
  pattern: z.string(),
  status: AssessmentComponentStatusSchema,
  evidence: z.array(z.string()).optional(),
});

const ArchitecturePolicyComplianceSchema = z.object({
  policy_version: z.string(),
  mandatory_violations: z.number().int().min(0),
  warning_violations: z.number().int().min(0),
  verdict: z.enum(['compliant', 'non_compliant', 'partial']),
});

const ArchitectureAssessmentSchema = z.object({
  score: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  policy_compliance: ArchitecturePolicyComplianceSchema.optional(),
  components: z.array(ArchitectureComponentSchema),
  ...AssessmentBlockAuditorFields,
});

const LicenceFlaggedDepSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  licence: z.string(),
  risk_tier: z.enum(['critical', 'high', 'medium', 'low', 'clear']),
  dependency_type: z.enum(['direct', 'transitive']),
  signal_ref: SignalIdSchema.optional(),
});

const LicenceComplianceSchema = z.object({
  risk_level: z.enum(['clear', 'low', 'medium', 'high', 'critical']),
  flagged_count: z.number().int().min(0),
  flagged_dependencies: z.array(LicenceFlaggedDepSchema),
  ...AssessmentBlockAuditorFields,
});

const AssessmentComponentSchema = z.object({
  id: z.string(),
  status: AssessmentComponentStatusSchema,
  evidence_ref: z.string().optional(),
});

const ObservabilityComponentSchema = AssessmentComponentSchema;

const ObservabilitySchema = z.object({
  score: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  sovereign_migration_risk: z.enum(['low', 'medium', 'elevated', 'critical']),
  components: z.array(ObservabilityComponentSchema),
  ...AssessmentBlockAuditorFields,
});

const TestingMaturitySchema = z.object({
  score: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  sovereign_migration_risk: z.enum(['low', 'medium', 'elevated', 'critical', 'unknown']),
  components: z.array(AssessmentComponentSchema),
  ...AssessmentBlockAuditorFields,
});

// ---- Pass 19: Database Migration Assessment ----

const DatabaseEngineEntrySchema = z
  .object({
    name: z.string(),
    version: z.string().optional(),
    migration_path: z.string().optional(),
    version_gap: z.boolean().optional(),
    stored_procedures_detected: z.boolean().optional(),
  })
  .passthrough();

const DatabaseAssessmentSchema = z
  .object({
    engines: z.array(DatabaseEngineEntrySchema).optional(),
    overall_risk: z.string().optional(),
    rationale_signal: SignalIdSchema.optional(),
    ...AssessmentBlockAuditorFields,
  })
  .passthrough();

// ---- Pass 20: Integration Pattern Assessment ----

const IntegrationPatternEntrySchema = z
  .object({
    name: z.string(),
    type: z.string(),
    sovereign_portable: z.boolean().optional(),
  })
  .passthrough();

const IntegrationAssessmentSchema = z
  .object({
    patterns_detected: z.array(IntegrationPatternEntrySchema).optional(),
    esb_detected: z.boolean().optional(),
    kafka_detected: z.boolean().optional(),
    rabbitmq_detected: z.boolean().optional(),
    ibm_mq_detected: z.boolean().optional(),
    overall_risk: z.string().optional(),
    rationale_signal: SignalIdSchema.optional(),
    ...AssessmentBlockAuditorFields,
  })
  .passthrough();

// ---- Pass 21: IAM Assessment ----

const IamAssessmentSchema = z
  .object({
    idp_dependency: z.object({}).passthrough().optional(),
    service_accounts: z.object({}).passthrough().optional(),
    secrets_management: z.object({}).passthrough().optional(),
    iam_migration_complexity: z.enum(['trivial', 'low', 'moderate', 'high']).optional(),
    ...AssessmentBlockAuditorFields,
  })
  .passthrough();

// ---- Pass 22: DR and Backup Assessment ----

const DrBackupStrategySchema = z
  .object({
    detected: z.union([z.boolean(), z.string()]).optional(),
    type: z.string().optional(),
    retention_days: z.number().nullable().optional(),
    encrypted: z.boolean().nullable().optional(),
    cross_region: z.boolean().nullable().optional(),
    signal_ref: SignalIdSchema.optional(),
  })
  .passthrough();

const DrLastTestSchema = z
  .object({
    date: z.string().nullable().optional(),
    gap_months: z.number().nullable().optional(),
    finding: z.string().optional(),
    signal_ref: SignalIdSchema.optional(),
  })
  .passthrough();

const DrAssessmentSchema = z
  .object({
    backup_strategy: DrBackupStrategySchema.optional(),
    rpo_claimed_hours: z.number().optional(),
    rto_claimed_hours: z.number().optional(),
    migration_window_hours: z.number().nullable().optional(),
    migration_window_exceeds_rto: z.boolean().nullable().optional(),
    last_dr_test: DrLastTestSchema.optional(),
    target_cloud_dr_gap: z.object({}).passthrough().optional(),
    rationale_signal: SignalIdSchema.optional(),
    ...AssessmentBlockAuditorFields,
  })
  .passthrough();

// ---- #1139 Saudi Arabia: CST data-classification tier / licensing class ----
// Additive optional field (ADR-0012). Populated by pass-03-data when
// NCA_CCC_CST or NCA_CCC_CSP is active. null = tier unknown or non-Saudi run.
const CstClassRequiredSchema = z.enum(['qualification', 'class_a', 'class_b', 'class_c']).nullable();

// ---- #1142 SAMA CSF: per-domain maturity assessment block ----
// Additive optional field (ADR-0012). Only populated when SAMA_CSF is active.
// Minimum required level is 3 (Defined) per SAMA CSF v1.0 across all domains.
const MaturityDomainResultSchema = z.object({
  domain_id: z.string(),
  domain_name: z.string(),
  measured_level: z.number().int().min(0).max(5).nullable(),
  minimum_required: z.number().int().min(1).max(5),
  verdict: z.enum(['ready', 'blocked', 'unknown']),
});

export const MaturityAssessmentSchema = z.object({
  framework_id: z.string(),
  domains: z.array(MaturityDomainResultSchema),
  overall_verdict: z.enum(['ready', 'blocked', 'unknown']),
});

const AssumptionSchema = z
  .object({
    field: z.string(),
    value: z.unknown().optional(),
    basis: z.string().optional(),
    derived_from: z.string().optional(),
    workshop_needed: z.boolean().optional(),
  })
  .passthrough();

const DataGapSchema = z
  .object({
    field: z.string(),
    blocking: z.boolean(),
    recommendation: z.string(),
    coverage_impact: z.number().optional(),
  })
  .passthrough();

// #0263 Phase 1 -- Scope Coverage block emitted by Pass 13.
// Moved to @swao/core (#0548) as scope-coverage.ts so the app-assessment
// module's Pass 13 can reference it without a circular package dependency.
// Re-exported here for back-compat with existing import sites.
export { ScopeCoverageSchema };
export type { ScopeCoverage, BlindSpotEntryResult } from '@swao/core';

export const PlanSchema = z.object({
  migration_plan: z
    .object({
      runbook: z.array(RunbookComponentSchema),
      data_migration: DataMigrationSchema.optional(),
      data_plan: z.array(z.object({}).passthrough()).optional(),
    })
    .passthrough(),
  risk_register: z.array(RiskRegisterItemSchema),
  value_case: z.array(z.object({}).passthrough()),
  compliance: ComplianceSchema.optional(),
  training_plan: z.object({}).passthrough().optional(),
  security_findings: z.array(SecurityFindingSchema),
  assumptions: z.array(AssumptionSchema),
  data_gaps: z.array(DataGapSchema),
  context_overrides: z.array(ContextOverrideSchema).optional(),
  observability: ObservabilitySchema.optional(),
  licence_compliance: LicenceComplianceSchema.optional(),
  testing_maturity: TestingMaturitySchema.optional(),
  architecture_assessment: ArchitectureAssessmentSchema.optional(),
  database_assessment: DatabaseAssessmentSchema.optional(),
  integration_assessment: IntegrationAssessmentSchema.optional(),
  iam_assessment: IamAssessmentSchema.optional(),
  dr_assessment: DrAssessmentSchema.optional(),
  landing_zone_readiness: LandingZoneReadinessResultSchema.optional(),
  scope_coverage: ScopeCoverageSchema.optional(),
  cst_class_required: CstClassRequiredSchema.optional(),
  maturity_assessment: MaturityAssessmentSchema.optional(),
});

export type Plan = z.infer<typeof PlanSchema>;
export type SecurityFinding = z.infer<typeof SecurityFindingSchema>;
export type ContextOverride = z.infer<typeof ContextOverrideSchema>;
export type MaturityAssessment = z.infer<typeof MaturityAssessmentSchema>;
export type MaturityDomainResult = z.infer<typeof MaturityDomainResultSchema>;
export type CstClassRequired = z.infer<typeof CstClassRequiredSchema>;
export {
  ObservabilitySchema,
  LicenceComplianceSchema,
  TestingMaturitySchema,
  ArchitectureAssessmentSchema,
  DatabaseAssessmentSchema,
  IntegrationAssessmentSchema,
  IamAssessmentSchema,
  DrAssessmentSchema,
  LandingZoneReadinessResultSchema,

  CstClassRequiredSchema,
  MaturityDomainResultSchema,
};
export type Observability = z.infer<typeof ObservabilitySchema>;
export type LicenceCompliance = z.infer<typeof LicenceComplianceSchema>;
export type TestingMaturity = z.infer<typeof TestingMaturitySchema>;
export type ArchitectureAssessment = z.infer<typeof ArchitectureAssessmentSchema>;
export type DatabaseAssessment = z.infer<typeof DatabaseAssessmentSchema>;
export type IntegrationAssessment = z.infer<typeof IntegrationAssessmentSchema>;
export type IamAssessment = z.infer<typeof IamAssessmentSchema>;
export type DrAssessment = z.infer<typeof DrAssessmentSchema>;
export type { LandingZoneReadinessResult, LZBlockerItem, LZServiceCheck } from './wsp-lzr.js';
