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

// Durable-input schemas for Design 080 §7 table. Phase 0 defines the shapes;
// no read/write wiring until Phases 2-3.

import { z } from 'zod';

// Evidence record: structured proof item attached to a control or risk.
export const WspEvidenceRecordSchema = z
  .object({
    evidence_id: z.string(),
    type: z.enum([
      'static_analysis',
      'cmdb',
      'finops',
      'incident',
      'ops_runbook',
      'workshop',
      'architecture_doc',
      'apm',
      'other',
    ]),
    file: z.string().optional(),
    url: z.string().optional(),
    description: z.string().optional(),
    captured_at: z.string().optional(),
    captured_by: z.string().optional(),
  })
  .passthrough();

// Risk-import overlay: operator-supplied risk items to merge with the machine register.
export const WspRiskImportOverlaySchema = z
  .object({
    source: z.string(),
    imported_at: z.string(),
    risks: z.array(
      z
        .object({
          risk_id: z.string(),
          category: z.string(),
          likelihood: z.enum(['high', 'medium', 'low']),
          impact: z.enum(['critical', 'high', 'medium', 'low']),
          trigger: z.string(),
          mitigation: z.string(),
          owner: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

// Override record: an attributed human override of a machine verdict.
export const WspOverrideRecordSchema = z
  .object({
    target_type: z.enum(['control', 'risk', 'signal']),
    target_id: z.string(),
    author: z.string(),
    role: z.string().optional(),
    timestamp: z.string(),
    rationale: z.string(),
    evidence_ids: z.array(z.string()).optional(),
    original_machine_outcome: z.string().optional(),
    override_outcome: z.string(),
  })
  .passthrough();

// Annotation record: freeform note on any WSP artefact.
export const WspAnnotationRecordSchema = z
  .object({
    annotation_id: z.string(),
    target_type: z.string(),
    target_id: z.string(),
    author: z.string(),
    timestamp: z.string(),
    text: z.string(),
  })
  .passthrough();

export type WspEvidenceRecord = z.infer<typeof WspEvidenceRecordSchema>;
export type WspRiskImportOverlay = z.infer<typeof WspRiskImportOverlaySchema>;
export type WspOverrideRecord = z.infer<typeof WspOverrideRecordSchema>;
export type WspAnnotationRecord = z.infer<typeof WspAnnotationRecordSchema>;
