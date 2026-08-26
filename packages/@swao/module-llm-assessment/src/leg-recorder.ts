// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Leg-mode recorder bridge (#1421, Design 092 s3.1).
//
// A leg is a normal `swao assess` CHILD PROCESS (063 s17.4: env-based
// selection is only safe across processes). The orchestrator sets the
// SWAO_LLM_ASSESSMENT_* environment; the host's assess command calls
// createLegRecorderFromEnv() once and, when leg mode is active, wraps each
// pass's usage-tracking provider so every LLM call streams a CallRecord to
// the sink file (append-only NDJSON; the orchestrator harvests it after
// the leg completes). Outside leg mode this is a null hook -- a normal
// assessment run records nothing and pays nothing.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRecordingProvider } from './recording-provider.js';
import type { UsageSnapshot } from './recording-provider.js';

export const LEG_ENV = {
  RECORD: 'SWAO_LLM_ASSESSMENT_RECORD',
  LEG_ID: 'SWAO_LLM_ASSESSMENT_LEG_ID',
  CONNECTOR: 'SWAO_LLM_ASSESSMENT_CONNECTOR',
  MODEL: 'SWAO_LLM_ASSESSMENT_MODEL',
  CONNECTOR_SHA256: 'SWAO_LLM_ASSESSMENT_CONNECTOR_SHA256',
  COST_SOURCE: 'SWAO_LLM_ASSESSMENT_COST_SOURCE',
} as const;

interface CompletesLikeProvider {
  complete(prompt: string): Promise<string>;
  completeVision?(prompt: string, images: Buffer[]): Promise<string>;
}

export interface LegRecorder {
  /** Set by the host before each pass dispatch. */
  setPass(passId: string, callSite: string): void;
  /** Wrap a pass's provider; the returned object preserves the inner
   *  provider's shape with complete() recording every call. */
  wrap<T extends CompletesLikeProvider>(inner: T, usageSnapshot: () => UsageSnapshot): T;
}

/** Null outside leg mode; the host guards with a single `if`. */
export function createLegRecorderFromEnv(
  env: Record<string, string | undefined> = process.env,
): LegRecorder | null {
  const sink = env[LEG_ENV.RECORD];
  if (!sink) return null;
  mkdirSync(dirname(sink), { recursive: true });

  const leg = {
    id: env[LEG_ENV.LEG_ID] ?? 'leg',
    connector: env[LEG_ENV.CONNECTOR] ?? 'unknown',
    model: env[LEG_ENV.MODEL] ?? 'unknown',
    ...(env[LEG_ENV.CONNECTOR_SHA256] ? { connector_sha256: env[LEG_ENV.CONNECTOR_SHA256] } : {}),
  };
  const rawSource = env[LEG_ENV.COST_SOURCE];
  const costSource: 'billed' | 'configured' | 'local' =
    rawSource === 'configured' || rawSource === 'local' ? rawSource : 'billed';

  let current = { passId: 'pre-pass', callSite: 'pre-pass' };

  return {
    setPass(passId, callSite) {
      current = { passId, callSite };
    },
    wrap<T extends CompletesLikeProvider>(inner: T, usageSnapshot: () => UsageSnapshot): T {
      const recording = createRecordingProvider(inner, {
        leg,
        usageSnapshot,
        costSource,
        currentContext: () => current,
        maxTokens: (inner as { maxTokens?: number }).maxTokens,
        onRecord: (record) => appendFileSync(sink, JSON.stringify(record) + '\n', 'utf-8'),
      });
      // Preserve the inner provider's shape (name/model props etc.) so pass
      // code and provenance reporting keep working.
      return Object.assign(Object.create(Object.getPrototypeOf(inner) as object) as T, inner, {
        complete: (prompt: string) => recording.complete(prompt),
        ...(recording.completeVision
          ? { completeVision: (prompt: string, images: Buffer[]) => recording.completeVision!(prompt, images) }
          : {}),
      });
    },
  };
}
