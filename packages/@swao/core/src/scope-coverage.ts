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

// Scope-coverage result schema (Pass 13). Extracted from @swao/swao's
// schema/wsp-plan.ts into @swao/core (#0548) so the app-assessment module's
// Pass 13 and swao's WSP PlanSchema can both reference it without a circular
// package dependency. The coverage formula stays pinned here so
// pass-13-scope.ts remains declarative.

const BlindSpotCoverageSchema = z.enum(['closed', 'partial', 'open']);

const BlindSpotEntryResultSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  category: z.string().optional(),
  coverage: BlindSpotCoverageSchema,
  severity: z.enum(['critical', 'high', 'medium', 'low', 'informational']),
  input_required: z.string().optional(),
  input_provided: z.string().optional(),
  partial_coverage_note: z.string().optional(),
  related_regimes: z.array(z.string()).optional(),
  assessor: z.string().optional(),
  assessed_at: z.string().optional(),
});

export const ScopeCoverageSchema = z.object({
  catalogue_version: z.string(),
  total_blind_spots: z.number().int().min(0),
  closed: z.number().int().min(0),
  partial: z.number().int().min(0),
  open: z.number().int().min(0),
  coverage_ratio: z.number().min(0).max(1),
  blind_spots: z.array(BlindSpotEntryResultSchema),
});

export type ScopeCoverage = z.infer<typeof ScopeCoverageSchema>;
export type BlindSpotEntryResult = z.infer<typeof BlindSpotEntryResultSchema>;
