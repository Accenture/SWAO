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

/**
 * SCAFFOLD.* signal catalogue for `swao service init` (Design 103 §18.2, #3083).
 *
 * Scaffold signals reuse the Signal interface with `SCAF-NN` ids and a
 * `code` naming the SCAFFOLD.* type. They are written only to the workspace
 * file `wsp/signals/scaffold-signals.json`, never into a run's wsp.json, so
 * SIGNAL_ID_REGEX (the WSP schema) is unchanged.
 *
 * Evidence strings carry sheet / row / column references only, never cell values.
 */

import { z } from 'zod';
import { SignalSchema } from './signals.js';

export const SCAFFOLD_SIGNALS = {
  'SCAFFOLD.DUPLICATE_ID':           { id: 'SCAF-01', severity: 'high' },
  'SCAFFOLD.CLUSTER_DETECTED':       { id: 'SCAF-02', severity: 'informational' },
  'SCAFFOLD.CATEGORY_UNKNOWN':       { id: 'SCAF-03', severity: 'medium' },
  'SCAFFOLD.ID_FLAG_DETECTED':       { id: 'SCAF-04', severity: 'informational' },
  'SCAFFOLD.PII_FIELD_SCRUBBED':     { id: 'SCAF-05', severity: 'informational' },
  'SCAFFOLD.MANDATORY_FIELD_MISSING':{ id: 'SCAF-06', severity: 'medium' },
} as const;

export type ScaffoldSignalCode = keyof typeof SCAFFOLD_SIGNALS;
export const SCAFFOLD_SIGNAL_CODES = Object.keys(SCAFFOLD_SIGNALS) as ScaffoldSignalCode[];

export const ScaffoldSignalSchema = SignalSchema.extend({
  id: z.string().regex(/^SCAF-\d{2}$/),
  code: z.enum(SCAFFOLD_SIGNAL_CODES as [ScaffoldSignalCode, ...ScaffoldSignalCode[]]),
  app_id: z.string().optional(),
});

export type ScaffoldSignal = z.infer<typeof ScaffoldSignalSchema>;

export const ScaffoldSignalsFileSchema = z.object({
  generated_at: z.string(),
  source: z.string(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  signals: z.array(ScaffoldSignalSchema),
  /** Parser warnings (type mismatches, skipped sheets); counts and field names only. */
  warnings: z.array(z.string()).default([]),
});

export type ScaffoldSignalsFile = z.infer<typeof ScaffoldSignalsFileSchema>;

/** Build a scaffold signal with the catalogue id and severity for `code`. */
export function scaffoldSignal(
  code: ScaffoldSignalCode,
  args: { derivation: string; evidence: string[]; appId?: string; confidence?: 'high' | 'medium' | 'low' },
): ScaffoldSignal {
  const def = SCAFFOLD_SIGNALS[code];
  return {
    id: def.id,
    code,
    source: 'cmdb_export',
    category: 'infrastructure_platform',
    severity: def.severity,
    derivation: args.derivation,
    evidence: args.evidence,
    confidence: args.confidence ?? 'high',
    assessor: 'rule_engine',
    ...(args.appId ? { app_id: args.appId } : {}),
  };
}
