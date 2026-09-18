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
import { SignalSchema } from './signals.js';

const PassHeaderSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    name: z.string(),
    signal_prefix: z.string().optional(),
    status: z.enum(['complete', 'stub', 'not_applicable']),
    iter: z.number(),
    assessed_at: z.string().optional(),
  })
  .passthrough();

export const DataSourceSchema = z.object({
  llm_provider: z.string(),
  llm_model: z.string(),
  llm_temperature: z.number(),
  llm_seed: z.number().nullable().optional(),
  cassette_hit: z.boolean(),
  placeholder_inputs: z.array(z.string()),
  false_positive_flags: z.number().int().nonnegative(),
  assessed_at: z.string(),
});

export const PassFileSchema = z
  .object({
    pass: PassHeaderSchema,
    data_source: DataSourceSchema.optional(),
    signals: z.array(SignalSchema),
    assessment: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export type DataSource = z.infer<typeof DataSourceSchema>;
export type PassFile = z.infer<typeof PassFileSchema>;
