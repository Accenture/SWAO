// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library -- landing zone live scope merge (Design 120 section 11.1)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3583: `lz-live-merged.yaml`, the scopes of one landing zone merged before
// reporting (Design 120 sections 7.4, 11.1). Inputs are the latest
// `LzLiveScan` per scope within the staleness window (Q-11, default 7 days).
// Every registered scope is listed with its merge status, so a stale or
// missing scope is visible and never silently merged or dropped.

import { z } from 'zod';
import { LzGuardrailSchema } from './lz-scan-result.js';
import { LzServiceIacSchema } from './lz-service-catalogue.js';
import {
  LzLiveEvidenceSchema,
  LzLiveMergedHierarchySchema,
  LzLivePostureSchema,
  LzLiveRegionSchema,
  LzLiveResourceSchema,
  LzLiveSimulatedSchema,
  LzLiveStatusSchema,
  type LzLiveStatus,
} from './lz-live-scan.js';

/** Default staleness window in days (Design 120 Q-11). */
export const LZ_LIVE_STALENESS_DAYS = 7;

/**
 * Status precedence when scopes of one landing zone disagree on a service in
 * a region (Design 120 section 11.1, item 2), strongest first. `restricted`
 * wins because a policy denial anywhere constrains the landing zone; `unknown`
 * is last, so it never overrides a status another scope observed. Not the
 * same order as LZ_LIVE_STATUS_PRECEDENCE, which picks the best service for
 * a capability tag inside one scan (#3609).
 */
export const LZ_LIVE_SCOPE_MERGE_PRECEDENCE: readonly LzLiveStatus[] = [
  'restricted', 'enabled', 'available_not_enabled', 'not_offered', 'unknown',
];

export const LzLiveMergedScopeSchema = z.object({
  scope_id: z.string().min(1),
  scope_kind: z.enum(['platform', 'application']).optional(),
  /** merged: within the window and merged; stale: latest scan older than the window; missing: no scan. */
  status: z.enum(['merged', 'stale', 'missing']),
  observed_at: z.string().min(1).optional(),
  age_days: z.number().nonnegative().optional(),
  /** #3596: copied from the scope's scan `meta.simulated` (stale scopes too), so the
   *  publication and the portfolio merge see carried simulated scopes. */
  simulated: LzLiveSimulatedSchema.optional(),
}).strict();
export type LzLiveMergedScope = z.infer<typeof LzLiveMergedScopeSchema>;

export const LzLiveMergedRegionStatusSchema = z.object({
  status: LzLiveStatusSchema,
  /** Scope whose observation won the precedence. */
  scope_id: z.string().min(1),
  evidence: z.array(LzLiveEvidenceSchema).default([]),
  observed_at: z.string().min(1),
}).strict();

export const LzLiveMergedServiceSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  capability_tags: z.array(z.string()).default([]),
  catalogue_code: z.string().min(1).optional(),
  regions: z.record(z.string(), LzLiveMergedRegionStatusSchema),
  iac: LzServiceIacSchema.optional(),
}).strict();
export type LzLiveMergedService = z.infer<typeof LzLiveMergedServiceSchema>;

export const LzLiveMergedResourceSchema = LzLiveResourceSchema.extend({
  seen_by: z.array(z.string().min(1)).min(1),
}).strict();

export const LzLiveMergedGuardrailSchema = LzGuardrailSchema.extend({
  scope_id: z.string().min(1),
  /** platform: from the platform scope; local: local policy added by an application scope. */
  origin: z.enum(['platform', 'local']),
}).strict();

export const LzLiveMergedSchema = z.object({
  lz_id: z.string().min(1),
  provider: z.string().min(1),
  merged_at: z.string().min(1),
  window_days: z.number().int().positive(),
  scopes: z.array(LzLiveMergedScopeSchema),
  offering: z.object({
    regions: z.array(LzLiveRegionSchema).default([]),
    services: z.array(LzLiveMergedServiceSchema).default([]),
  }).strict(),
  estate: z.object({
    resources: z.array(LzLiveMergedResourceSchema).default([]),
    guardrails: z.array(LzLiveMergedGuardrailSchema).default([]),
    /** #3864: posture of the merged scopes (Design 123 section 9.1, merge rule in
     *  `mergeLzLivePosture`); absent when no merged scope carries posture. */
    posture: LzLivePostureSchema.optional(),
    /** #3880: the tenant tree of the landing zone, nodes of all merged scopes
     *  unioned by id (`mergeLzLiveHierarchy`); absent when no scope has one. */
    hierarchy: LzLiveMergedHierarchySchema.optional(),
  }).strict(),
}).strict();
export type LzLiveMerged = z.infer<typeof LzLiveMergedSchema>;

export function parseLzLiveMerged(raw: unknown): LzLiveMerged {
  return LzLiveMergedSchema.parse(raw);
}
