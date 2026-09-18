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

// Compliance control, regime, and risk-register schemas -- relocated from
// @swao/swao so @swao/module-mcp can import them without a circular package
// dependency (Design 080 §7.1). Re-exported from packages/swao/src/schema/wsp-plan.ts
// for the existing import sites.

import { z } from 'zod';
import { SignalIdSchema, AssessorSchema, WspOverrideBlockSchema } from './signals.js';
import { RegimeIdSchema } from './regime-catalogue.js';

export const ComplianceRegimeIdSchema = z.union([RegimeIdSchema, z.literal('DiGA')]);

export const ComplianceControlOutcomeSchema = z.enum([
  'SATISFIED',
  'PARTIAL',
  'GAP',
  'UNKNOWN',
  'N_A',
]);

export const ComplianceControlSchema = z
  .object({
    id: z.string(),
    // v0.10: status remains optional for back-compat with v0.9 fixtures
    // that wrote freeform strings ("SATISFIED", "GAP", "UNKNOWN", etc.).
    // v0.11 will deprecate `status` in favour of the structured `outcome`.
    status: z.string().optional(),
    evidence: z.array(z.string()).optional(),
    severity: z.string().optional(),

    // v0.10 auditor fields (all optional)
    outcome: ComplianceControlOutcomeSchema.optional(),
    rationale: z.string().min(20).optional(),
    signal_refs: z.array(SignalIdSchema).optional(),
    evidence_ids: z.array(z.string()).optional(),
    assessor: AssessorSchema.optional(),
    assessed_at: z.string().optional(),
    remediation: z.string().optional(),
    references: z.array(z.string()).optional(),

    // Design 080 §5.3: machine verdict + attributed override (optional in Phase 0)
    machine_outcome: ComplianceControlOutcomeSchema.optional(),
    override: WspOverrideBlockSchema.optional(),
  })
  .passthrough();

export const ComplianceRegimeSchema = z
  .object({
    id: ComplianceRegimeIdSchema,
    status: z.string(),
    controls: z.array(ComplianceControlSchema).optional(),
    notes: z.string().optional(),

    // Design 080 §5.3: regime-level machine verdict + attributed override (optional in Phase 0)
    machine_outcome: z.string().optional(),
    override: WspOverrideBlockSchema.optional(),
  })
  .passthrough();

export const RiskRegisterItemSchema = z
  .object({
    risk_id: z.string(),
    category: z.string(),
    likelihood: z.enum(['high', 'medium', 'low']),
    impact: z.enum(['critical', 'high', 'medium', 'low']),
    trigger: z.string(),
    mitigation: z.string(),
    owner: z.string(),

    // Design 080 §5.4: risk lifecycle fields (optional in Phase 0)
    status: z.enum(['open', 'mitigated', 'accepted', 'closed']).optional(),
    evidence_ids: z.array(z.string()).optional(),
    closed_rationale: z.string().optional(),
    closed_at: z.string().optional(),

    // Design 080 §5.3: machine verdict + attributed override (optional in Phase 0)
    machine_outcome: z.string().optional(),
    override: WspOverrideBlockSchema.optional(),
  })
  .passthrough();

export type ComplianceControl = z.infer<typeof ComplianceControlSchema>;
export type ComplianceRegime = z.infer<typeof ComplianceRegimeSchema>;
export type RiskRegisterItem = z.infer<typeof RiskRegisterItemSchema>;
export type ComplianceRegimeId = z.infer<typeof ComplianceRegimeIdSchema>;
