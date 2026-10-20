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
 * BINARY.* signal catalogue for Pass 25 BINARY (Design 103 §6.3, #3106).
 *
 * Same pattern as SCAFFOLD.*: `BIN-NN` ids with a `code`, on the Signal
 * interface, written to `apps/<id>/wsp/signals/binary-signals.json` only, so
 * the WSP signal id vocabulary (SIGNAL_ID_REGEX) is unchanged.
 */

import { z } from 'zod';
import { SignalSchema } from './signals.js';

export const BINARY_SIGNALS = {
  'BINARY.UNSIGNED':                 { id: 'BIN-01' },
  'BINARY.EXPIRED_CERT':             { id: 'BIN-02' },
  'BINARY.LEGACY_RUNTIME':           { id: 'BIN-03' },
  'BINARY.LEGACY_ARCH':              { id: 'BIN-04' },
  'BINARY.COMPILATION_DATE_ANOMALY': { id: 'BIN-05' },
} as const;

export type BinarySignalCode = keyof typeof BINARY_SIGNALS;
export const BINARY_SIGNAL_CODES = Object.keys(BINARY_SIGNALS) as BinarySignalCode[];

export const BinarySignalSchema = SignalSchema.extend({
  id: z.string().regex(/^BIN-\d{2}$/),
  code: z.enum(BINARY_SIGNAL_CODES as [BinarySignalCode, ...BinarySignalCode[]]),
});
export type BinarySignal = z.infer<typeof BinarySignalSchema>;

export const BinarySignalsFileSchema = z.object({
  generated_at: z.string(),
  app_id: z.string(),
  signals: z.array(BinarySignalSchema),
});
export type BinarySignalsFile = z.infer<typeof BinarySignalsFileSchema>;

export function binarySignal(
  code: BinarySignalCode,
  args: { severity: 'critical' | 'high' | 'medium' | 'low' | 'informational'; derivation: string; evidence: string[]; confidence?: 'high' | 'medium' | 'low' },
): BinarySignal {
  return {
    id: BINARY_SIGNALS[code].id,
    code,
    source: 'static_analysis',
    category: 'application',
    severity: args.severity,
    outcome: args.severity === 'informational' ? 'neutral' : 'negative',
    derivation: args.derivation,
    evidence: args.evidence,
    confidence: args.confidence ?? 'high',
    assessor: 'rule_engine',
  };
}
