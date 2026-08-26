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

const LockInFlagSchema = z.object({
  service: z.string(),
  risk: z.enum(['low', 'medium', 'high', 'critical']),
  note: z.string(),
});

const MeshstackIntegrationSchema = z.object({
  supported: z.boolean(),
  building_blocks: z.array(z.string()).optional(),
  note: z.string().optional(),
});

export const LandingZoneCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  fit_score: z.number().min(0).max(1),
  rationale: z.string(),
  disqualified: z.boolean(),
  disqualification_reason: z.string().optional(),
  service_gaps: z.array(z.string()),
  certifications_matched: z.array(z.string()),
  lock_in_flags: z.array(LockInFlagSchema),
  overall_lock_in_risk: z.enum(['low', 'medium', 'high']),
  meshstack_integration: MeshstackIntegrationSchema.optional(),
});

const LandingZoneBlockerSchema = z.object({
  service: z.string(),
  signal: z.string(),
  note: z.string(),
});

export const LandingZoneResultSchema = z.object({
  landing_zone_candidates: z.array(LandingZoneCandidateSchema).optional(),
  recommended_landing_zone: z.string().optional(),
  landing_zone_recommendation_confidence: z.enum(['low', 'medium', 'high']).optional(),
  landing_zone_blockers: z.array(LandingZoneBlockerSchema).optional(),
});

export type LandingZoneCandidate = z.infer<typeof LandingZoneCandidateSchema>;
export type LandingZoneResult = z.infer<typeof LandingZoneResultSchema>;
export type LockInFlag = z.infer<typeof LockInFlagSchema>;
