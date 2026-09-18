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

import { z } from 'zod';

export const SIGNAL_ID_REGEX =
  /^(INV|STATE|DATA|EGR|CRYPTO|SBOM|TF|SYNTH|CTX|PP|OBS|LIC|QA|PAT|DBA|INT|IAM|DR|DYN|LZR|LZ|COMP|SCOPE|AUD|MAL)-\d{2}$/;

export const SignalIdSchema = z.string().regex(SIGNAL_ID_REGEX);

// ---------------------------------------------------------------------------
// v0.10 auditor-grade traceability surface (ADR-0025; design 020).
// All new fields are optional in v0.10. Doctor probe warns when missing.
// v0.11 will tighten to required after fixtures and engines have migrated.
// ---------------------------------------------------------------------------

export const SignalOutcomeSchema = z.enum([
  'positive',
  'negative',
  'neutral',
  'indeterminate',
]);

export const AssessorSchema = z.enum([
  'rule_engine',
  'llm',
  'human_override',
  'human', // #0556 (Design 049 §4): human was the primary assessor (audit checklist)
]);

// Design 080 §5.3: attributed override block, shared by signal/control/risk shapes.
// Defined here so all schema modules can import it without a circular dependency.
export const WspOverrideBlockSchema = z
  .object({
    author: z.string(),
    role: z.string().optional(),
    timestamp: z.string(),
    rationale: z.string(),
    evidence_ids: z.array(z.string()).optional(),
  })
  .passthrough();

export type WspOverrideBlock = z.infer<typeof WspOverrideBlockSchema>;

export const SignalSchema = z.object({
  id: SignalIdSchema,
  source: z.enum([
    'static_analysis',
    'dynamic_analysis',
    'workshop',
    'cmdb',
    'cmdb_export',
    'finops',
    'llm_inference',
    'incident',
    'ops_runbook',
    'ops_runbooks',
  ]),
  category: z.enum([
    'application',
    'infrastructure_platform',
    'enablement',
    'business_processes',
  ]),
  severity: z
    .enum(['critical', 'high', 'medium', 'low', 'informational', 'positive'])
    .optional(),
  synthesis: z.boolean().optional(),
  // v0.10: derivation gains a min(20) constraint. Doctor probe (#0170)
  // soft-warns on shorter values during the v0.10 window; v0.11 will
  // enforce strictly.
  derivation: z.string().min(20),
  evidence: z.array(z.string()),
  signal_ref: SignalIdSchema.optional(),
  implies: z.array(z.string()).optional(),
  confidence: z.enum(['high', 'medium', 'low']),
  legacy_tier: z.enum(['tier_1_blocker', 'tier_2_complicator', 'tier_3_manageable']).optional(),

  // v0.10 auditor fields (all optional)
  outcome: SignalOutcomeSchema.optional(),
  false_positive_considered: z.boolean().optional(),
  false_positive_ruled_out: z.string().min(20).optional(),
  assessor: AssessorSchema.optional(),
  assessed_at: z.string().optional(),
  derivation_chain: z.array(z.string()).optional(),

  // v0.11 -- set programmatically by pass-04 after normalizeSignal(); the
  // LLM should NOT emit these (they are not in SIGNAL_SCHEMA_HINT).
  false_positive_flag: z.boolean().optional(),
  false_positive_note: z.string().optional(),

  // v0.12 (#0478 C-22): per-signal provenance, injected by assess.ts loop.
  // source = "<provider>/<model>" for LLM passes or "rule_engine" for static passes.
  // prompt_hash is pass-level (in data_source); not repeated per signal.
  provenance: z.object({
    source: z.string(),
    run_id: z.string(),
    cassette_hit: z.boolean(),
    assessed_at: z.string(),
  }).optional(),

  // Design 080 §5.3: machine verdict + attributed override (optional in Phase 0)
  machine_outcome: SignalOutcomeSchema.optional(),
  override: WspOverrideBlockSchema.optional(),
});

export type SignalId = z.infer<typeof SignalIdSchema>;
export type Signal = z.infer<typeof SignalSchema>;
export type SignalOutcome = z.infer<typeof SignalOutcomeSchema>;
export type Assessor = z.infer<typeof AssessorSchema>;
