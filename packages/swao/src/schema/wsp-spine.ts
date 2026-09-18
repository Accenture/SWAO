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
import { SignalIdSchema } from './signals.js';

const AppBlockSchema = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    business_domain: z.string().optional(),
    business_criticality: z.string().optional(),
    regulatory_class: z.string().optional(),
  })
  .passthrough();

const PassExecutedSchema = z
  .object({
    pass: z.union([z.number(), z.string()]),
    name: z.string(),
    status: z.enum(['complete', 'stub', 'not_applicable']),
    signal_prefix: z.string().optional(),
    signals_emitted: z.number().optional(),
    file: z.string(),
    iter: z.number(),
    reason: z.string().optional(),
  })
  .passthrough();

const PortabilityComponentSchema = z
  .object({
    service: z.string(),
    signal_ref: SignalIdSchema,
    verdict: z.enum(['available', 'unavailable', 'partial', 'not_applicable']),
    score: z.number(),
    blocks_migration: z.boolean().optional(),
  })
  .passthrough();

const DimensionDescriptionSchema = z.object({
  description: z.string().optional(),
  benefit: z.string().optional(),
  interpretation: z.string().optional(),
});

const AssessmentScoresSchema = z
  .object({
    seven_r: DimensionDescriptionSchema.extend({
      verdict: z.string(),
      confidence: z.number(),
      rationale_signal: SignalIdSchema,
    })
      .passthrough()
      .optional(),
    portability: DimensionDescriptionSchema.extend({
      score: z.number(),
      threshold: z.number(),
      status: z.enum(['below_threshold', 'above_threshold', 'at_threshold']),
      rationale_signal: SignalIdSchema,
      component_breakdown: z.array(PortabilityComponentSchema).optional(),
    })
      .passthrough()
      .optional(),
    legacy_indicators: DimensionDescriptionSchema.extend({
      verdict: z.string(),
      tier_1_blockers: z.number(),
      rationale_signal: SignalIdSchema,
    })
      .passthrough()
      .optional(),
    data_migration_feasibility: DimensionDescriptionSchema.extend({
      verdict: z.enum(['feasible', 'requires_phased_migration']),
      rationale_signal: SignalIdSchema,
    })
      .passthrough()
      .optional(),
    pipeline_security: DimensionDescriptionSchema.and(z.object({}).passthrough()).optional(),
    observability: DimensionDescriptionSchema.and(z.object({}).passthrough()).optional(),
  })
  .passthrough();

export const ProviderStatusSchema = z.enum([
  'configured_not_executed',
  'executed_with_results',
  'executed_no_findings',
  'failed',
]);

export const ProvidersUsedItemSchema = z
  .object({
    type: z.string().optional(),
    status: ProviderStatusSchema.optional(),
    skip_reason: z.string().optional(),
  })
  .passthrough();

const WspFilesSchema = z.object({
  evidence: z.string(),
  plan: z.string(),
  passes_dir: z.string(),
});

const SpineBaseSchema = z.object({
  // Accept v0.9 / v0.10 / v0.11 / v0.12 to reconcile the spine-literal vs fixture skew (#0597).
  // orchestrateAudit and orchestrateLandingZone write '0.11'; module-powerbi fixtures
  // use '0.10'; reference workspace WSPs use '0.9'. '0.12' reserved for Design 080 Phase 0+.
  wsp_version: z.enum(['0.9', '0.10', '0.11', '0.12']),
  assessment_type: z.string().optional(),
  meta: z
    .object({
      assessor: z.string(),
      assessment_date: z.string(),
      simulation_type: z.string(),
      iter: z.number(),
    })
    .passthrough(),
  assessed_at: z.string(),
  overall: z
    .object({
      seven_r_label: z.string(),
      modernization_position: z.string().optional(),
      cloud_native_score: z.number().optional(),
      coverage_score: z.number().optional(),
      confidence: z.union([z.number(), z.string()]).optional(),
      portability_score: z.number().optional(),
      categories: z.array(z.string()),
    })
    .passthrough(),
  assessment_scores: AssessmentScoresSchema.optional(),
  passes_executed: z.array(PassExecutedSchema),
  wsp_files: WspFilesSchema,
  app: AppBlockSchema.optional(),
  workload: AppBlockSchema.optional(),
  providers_used: z.record(z.string(), z.unknown()).optional(),
});

export const SpineSchema = SpineBaseSchema.refine(
  (data) => data.app !== undefined || data.workload !== undefined,
  { message: 'Either app or workload must be present' },
);

export type Spine = z.infer<typeof SpineBaseSchema>;
