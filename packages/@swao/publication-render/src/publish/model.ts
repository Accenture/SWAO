// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * PublicationModel v1.0 -- Design 041 §4.2 + §15.4
 *
 * Single seam between the assessment engine and every downstream consumer:
 * Mode A HTML, Mode B Eleventy, PowerBI/MCP, SWAO Live Portal REST API.
 *
 * Contract stability rules:
 *   - Additive changes (new optional fields)  = minor bump (1.0 -> 1.1)
 *   - Renames or type changes                  = major bump (1.0 -> 2.0)
 *   - Removals                                 = deprecation cycle first, then major bump
 */

import { z } from 'zod';

/** Bump to 1.1 on first v1.1 publication; 1.0 publications remain valid (union). */
export const CONTRACT_VERSION = '1.1' as const;

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export const SeveritySchema = z.enum([
  'critical',
  'high',
  'medium',
  'low',
  'informational',
  'positive',
]);

export const RagStatusSchema = z.enum(['pass', 'partial', 'fail', 'not-assessed']);
export const TierSchema = z.enum(['community', 'consultant', 'enterprise']);
export const EvidenceTypeSchema = z.enum(['imported_artifact', 'derived', 'meeting_transcript']);
export const InputFileKindSchema = z.enum(['architecture', 'adr', 'banf', 'eam', 'source']);
export const RiskStatusSchema = z.enum(['open', 'in_progress', 'resolved']);

// ---------------------------------------------------------------------------
// EngagementMeta -- PII-sanitised contact labels (§4.4)
// ---------------------------------------------------------------------------

export const EngagementMetaSchema = z.object({
  engagement_name: z.string(),
  client_code: z.string().optional(),
  partnership_lead: z.string(),   // role label: "Engagement Lead"
  engagement_lead: z.string().optional(),   // #0722: engagement lead name/email
  account_executive: z.string().optional(), // #0722: account executive name/email
  primary_contact: z.string().optional(),
  secondary_contact: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Signal -- publication representation (different from WSP SignalSchema)
// ---------------------------------------------------------------------------

export const PubSignalSchema = z.object({
  id: z.string(),                     // "CRYPTO-01"
  pass: z.string(),                   // "08-crypto"
  severity: SeveritySchema,
  outcome: z.enum(['positive', 'negative', 'informational']),
  derivation: z.string(),             // PII-scrubbed full text
  evidence_refs: z.array(z.string()), // Evidence.id values -- hyperlinks
  implies: z.array(z.string()),
  tags: z.array(z.string()),
  anchor: z.string(),                 // "signal-CRYPTO-01"
  false_positive_flag: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Evidence -- linked artefacts (§5.4)
// ---------------------------------------------------------------------------

export const PubEvidenceSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: EvidenceTypeSchema,
  file: z.string(),                   // relative path from workspace root (PII path-scrubbed)
  date: z.string(),                   // ISO 8601 date
  link: z.string().optional(),        // Mode B: relative URL; Mode A: data URI or [embedded]
  pii_scrubbed: z.boolean(),
  used_by: z.array(z.string()),       // Signal IDs that reference this evidence
  summary: z.string().optional(),     // human-readable display name (from wsp-evidence.yaml summary:)
  source_path: z.string().optional(), // actual source file path (from wsp-evidence.yaml source_path:)
  refs: z.array(z.string()).optional(), // linked document references
  github_url: z.string().optional(),  // GitHub permalink for this artefact
});

// ---------------------------------------------------------------------------
// InputFile -- source architecture files (§5.5)
// ---------------------------------------------------------------------------

export const InputFileSchema = z.object({
  path: z.string(),                   // relative path (PII path-scrubbed)
  kind: InputFileKindSchema,
  link: z.string().optional(),        // git remote URL or relative href
});

// ---------------------------------------------------------------------------
// TagIndex -- universal cross-reference (§4.3)
// ---------------------------------------------------------------------------

export const TagIndexEntrySchema = z.object({
  anchor: z.string(),
  type: z.string(),                   // 'signal' | 'control' | 'risk' | 'evidence' | 'input_file'
  label: z.string(),
});

export const TagIndexSchema = z.record(z.string(), z.array(TagIndexEntrySchema));

// ---------------------------------------------------------------------------
// FrameworkResult + ControlResult -- compliance view
// ---------------------------------------------------------------------------

export const ControlResultSchema = z.object({
  id: z.string(),                     // "Art.9"
  title: z.string(),
  rag_status: RagStatusSchema,
  worst_severity: SeveritySchema.optional(),
  signals: z.array(z.string()),       // Signal IDs
  rationale: z.string(),
  article_text: z.string().optional(),
  evidence: z.array(z.string()),      // Evidence IDs
  anchor: z.string(),                 // "ctrl-art9"
  // Design 080 §5.2 -- cross-reference propagation source annotation.
  derived_from: z.string().optional(),
  // Audit-coverage: fields from controls.yaml surfaced in publication (#1365-#1370).
  pillar: z.string().optional(),
  tags: z.array(z.string()).optional(),
  severity_default: z.string().optional(),
  evidence_basis: z.array(z.string()).optional(),
  maps_to: z.array(z.string()).optional(),
  references: z.array(z.string()).optional(),
});

export const FrameworkResultSchema = z.object({
  framework_id: z.string(),           // "GDPR"
  framework_name: z.string(),
  controls: z.array(ControlResultSchema),
  fail_count: z.number().int().min(0),
  partial_count: z.number().int().min(0),
  pass_count: z.number().int().min(0),
  not_assessed_count: z.number().int().min(0).default(0),
  // Audit-coverage: framework catalogue metadata (#1371).
  catalogue_version: z.string().optional(),
  last_reviewed: z.string().optional(),
});

// ---------------------------------------------------------------------------
// RiskRegisterItem -- §15.4
// ---------------------------------------------------------------------------

export const RiskRegisterItemSchema = z.object({
  risk_id: z.string(),                // "RR-001"
  signal_ref: z.string().optional(),  // links to Signal.id
  trigger: z.string(),                // short title (<=80 chars)
  category: z.string(),
  likelihood: z.enum(['low', 'medium', 'high']),
  impact: z.enum(['low', 'medium', 'high']),
  mitigation: z.string(),
  owner: z.string(),                  // PII-sanitised role label
  migration_phase: z.string().optional(), // Immediate | Pre-Migration | Post-Migration
  effort: z.enum(['S', 'M', 'L', 'XL']).optional(),
  target_date: z.string().optional(),
  platform_impact: z.string().optional(),
  evidence_refs: z.array(z.string()), // Evidence IDs
  status: RiskStatusSchema,
  resolved_at: z.string().optional(),
  notes: z.string().optional(),
  severity: SeveritySchema.optional(), // derived from signal_ref for display
  // Design 080 §5.4 -- attributed override; machine verdict preserved.
  machine_outcome: z.string().optional(),
  override: z.object({
    author: z.string().optional(),
    role: z.string().optional(),
    timestamp: z.string().optional(),
    rationale: z.string().optional(),
  }).optional(),
  anchor: z.string(),                 // "rr-001"
});

// ---------------------------------------------------------------------------
// RunbookStep -- auto-generated remediation steps
// ---------------------------------------------------------------------------

export const RunbookStepSchema = z.object({
  step: z.number().int().min(1),
  title: z.string(),
  description: z.string(),
  pass: z.string().optional(),
  signals: z.array(z.string()),       // Signal IDs this step addresses
  anchor: z.string(),
});

// ---------------------------------------------------------------------------
// LZRSummary -- landing zone readiness
// ---------------------------------------------------------------------------

export const LZRCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  result: z.enum(['pass', 'fail', 'not_applicable']),
  signal_ref: z.string().optional(),
}).passthrough();

export const LZRSummarySchema = z.object({
  overall: z.string(),                // "Conditionally Ready" | "Ready" | "Blocked" | "Sovereignty Blocked"
  blockers: z.number().int().min(0),
  checks: z.array(LZRCheckSchema),
  // Present when a catalogue fit ran; identifies the assessed landing zone id.
  current_infra: z.string().optional(),
  // LLM synthesis recommendation for the landing zone (moved from primary per #0732 AC6).
  lz_status: z.string().optional(),
  // Present when a catalogue fit ran during App assessment (v1.0, backward compat).
  lz_catalogue: z.object({
    provider: z.string(),
    region: z.string(),
    overall_verdict: z.string(),      // raw LzOverallVerdict from the fit report
  }).optional(),
  // v1.1 (ADR-0051, Design 068 §4): successor to lz_catalogue with richer fields.
  catalog: z.object({
    provider: z.string(),
    region: z.string(),
    overall_verdict: z.string(),
    assessed_regions: z.array(z.string()).optional(),
    service_count: z.number().int().min(0).optional(),
  }).optional(),
  // #1591: framework IDs that contributed sovereignty requirements (for compliance regime filtering).
  selected_frameworks: z.array(z.string()).optional(),
  // v1.2: multi-target runs -- one entry per assessed region (#0923).
  regions: z.array(z.object({
    provider: z.string(),
    region: z.string(),
    overall_verdict: z.string(),
    sovereignty_statement: z.string().optional(),
    service_count: z.number().int().min(0),
    blockers: z.number().int().min(0),
    services: z.array(z.string()).optional().default([]),
    service_labels: z.array(z.string()).optional().default([]),
    services_detected: z.array(z.string()).optional().default([]),
    // Audit-coverage: LZ catalogue metadata (#1361-#1363).
    coverage_warning: z.string().optional(),
    blocker_category: z.string().optional(),
    assessment_mode: z.string().optional(),
    sovereignty_active: z.boolean().optional(),
    selected_frameworks: z.array(z.string()).optional(),
  })).optional(),
});

// ---------------------------------------------------------------------------
// RunSummary -- assessment history entry
// ---------------------------------------------------------------------------

export const RunSummarySchema = z.object({
  run_id: z.string(),
  assessed_at: z.string(),            // ISO 8601
  swao_version: z.string(),
  signal_counts: z.record(z.string(), z.number()),
  // #1711: manifest-derived total for runs where per-severity breakdown is not available.
  total_signals: z.number().int().nonnegative().optional(),
  publication_href: z.string().optional(),
});

// ---------------------------------------------------------------------------
// DeltaModel -- run comparison
// ---------------------------------------------------------------------------

export const DeltaModelSchema = z.object({
  run_a: z.string(),                  // run_id of earlier run
  run_b: z.string(),                  // run_id of later run
  new_signals: z.array(z.string()),   // Signal IDs added in run_b
  resolved_signals: z.array(z.string()),
  changed_signals: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// PublicationConfig -- configurable chrome text (Design 006 §10.2)
// ---------------------------------------------------------------------------

export const PublicationConfigSchema = z.object({
  classification_band: z.string(),
  logo_name: z.string(),
  logo_sub: z.string(),
  footer_note: z.string(),
  engagement_lead_label: z.string(),
  primary_contact_label: z.string(),
  secondary_contact_label: z.string(),
  github_url: z.string().optional(),
  docs_url: z.string().optional(),
  evidence_base_url: z.string().optional(),
});

export type PublicationConfig = z.infer<typeof PublicationConfigSchema>;

// ---------------------------------------------------------------------------
// PublicationMeta + PublicationSummary
// ---------------------------------------------------------------------------

export const PublicationMetaSchema = z.object({
  app_id: z.string(),
  app_name: z.string(),
  assessed_at: z.string(),            // ISO 8601
  run_id: z.string(),
  swao_version: z.string(),
  engagement: EngagementMetaSchema,
  licensee: z.string(),
  tier: TierSchema,
  publication_config: PublicationConfigSchema,
});

export const PublicationSummarySchema = z.object({
  seven_r_label: z.string(),
  coverage_score: z.number().min(0).max(1),
  confidence: z.string().optional(),
  signal_counts: z.record(z.string(), z.number()),
  blocker_count: z.number().int().min(0),
  top_findings: z.array(PubSignalSchema),
  prior_run_id: z.string().optional(),
}).passthrough();

// ---------------------------------------------------------------------------
// Challenge report (#0920)
// ---------------------------------------------------------------------------

/** One finding from a stakeholder challenge agent. */
export const ChallengeFindingSchema = z.object({
  id: z.string(),
  severity: z.string(),
  concern: z.string(),
  evidence_gap: z.string(),
  recommended_question: z.string(),
}).passthrough();

/** One agent's challenge report (canonical envelope added by runner in #0919). */
export const ChallengeAgentReportSchema = z.object({
  schema_version: z.string().optional(),
  agent_id: z.string(),
  workload_id: z.string().optional(),
  reviewed_at: z.string().optional(),
  assessment_status: z.string().optional(),
  severity_overall: z.string().optional(),
  opening_statement: z.string().optional(),
  findings: z.array(ChallengeFindingSchema).default([]),
  next_step: z.string().optional(),
}).passthrough();

export type ChallengeAgentReport = z.infer<typeof ChallengeAgentReportSchema>;
export type ChallengeFinding = z.infer<typeof ChallengeFindingSchema>;

// ---------------------------------------------------------------------------
// BlockAssessmentItem -- pass-12 block scorecard (#1359)
// ---------------------------------------------------------------------------

export const BlockAssessmentItemSchema = z.object({
  name: z.string(),
  overall_outcome: z.enum(['SATISFIED', 'PARTIAL', 'GAP', 'UNKNOWN', 'N_A']),
  overall_rationale: z.string(),
  score: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  status: z.enum(['low', 'medium', 'high', 'critical']),
  key_signals: z.array(z.string()),
  assessor: z.string(),
  assessed_at: z.string(),
});

// ---------------------------------------------------------------------------
// PublicationModel -- root contract
// ---------------------------------------------------------------------------

export const PublicationModelSchema = z.object({
  contract_version: z.union([z.literal('1.0'), z.literal('1.1')]),
  meta: PublicationMetaSchema,
  summary: PublicationSummarySchema,
  signals: z.array(PubSignalSchema),
  compliance: z.array(FrameworkResultSchema),
  risk_register: z.array(RiskRegisterItemSchema),
  runbook: z.array(RunbookStepSchema),
  evidence: z.array(PubEvidenceSchema),
  input_files: z.array(InputFileSchema),
  tags: TagIndexSchema,
  lzr: LZRSummarySchema,
  run_history: z.array(RunSummarySchema),
  delta: DeltaModelSchema.optional(),
  // v1.1 additive fields (Design 068 §4, ADR-0052)
  assessment_type: z.string().optional(),
  block_profile: z.string().optional(),
  block_overrides: z.record(z.string(), z.unknown()).optional(),
  // #0920: stakeholder challenge reports (optional; present when challenge has been run).
  challenge: z.array(ChallengeAgentReportSchema).optional(),
  // #1359: pass-12 block assessment scorecard (optional; present when pass-12 ran).
  blocks: z.array(BlockAssessmentItemSchema).optional(),
});

// ---------------------------------------------------------------------------
// Exported TypeScript types
// ---------------------------------------------------------------------------

export type Severity = z.infer<typeof SeveritySchema>;
export type RagStatus = z.infer<typeof RagStatusSchema>;
export type Tier = z.infer<typeof TierSchema>;
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;
export type InputFileKind = z.infer<typeof InputFileKindSchema>;
export type RiskStatus = z.infer<typeof RiskStatusSchema>;

export type EngagementMeta = z.infer<typeof EngagementMetaSchema>;
export type PubSignal = z.infer<typeof PubSignalSchema>;
export type PubEvidence = z.infer<typeof PubEvidenceSchema>;
export type InputFile = z.infer<typeof InputFileSchema>;
export type TagIndexEntry = z.infer<typeof TagIndexEntrySchema>;
export type TagIndex = z.infer<typeof TagIndexSchema>;
export type ControlResult = z.infer<typeof ControlResultSchema>;
export type FrameworkResult = z.infer<typeof FrameworkResultSchema>;
export type RiskRegisterItem = z.infer<typeof RiskRegisterItemSchema>;
export type RunbookStep = z.infer<typeof RunbookStepSchema>;
export type LZRCheck = z.infer<typeof LZRCheckSchema>;
export type LZRSummary = z.infer<typeof LZRSummarySchema>;
export type BlockAssessmentItem = z.infer<typeof BlockAssessmentItemSchema>;
export type RunSummary = z.infer<typeof RunSummarySchema>;
export type DeltaModel = z.infer<typeof DeltaModelSchema>;
export type PublicationMeta = z.infer<typeof PublicationMetaSchema>;
export type PublicationSummary = z.infer<typeof PublicationSummarySchema>;
export type PublicationModel = z.infer<typeof PublicationModelSchema>;
// PublicationConfig is already exported above as an inline type alias
