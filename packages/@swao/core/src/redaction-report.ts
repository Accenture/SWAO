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

// Per-run aggregator for pre-LLM redaction events (#0354, sprint-038).
//
// Each LlmProvider's complete() call invokes recordRedaction() after it
// has scrubbed the prompt. The assess runner calls flushRedactionReport
// at run end to persist `wsp/runs/<ts>/redaction-report.json` per
// `docs/design/032-pii-egress-control.md` §7.
//
// The shape is process-wide module state because:
//   1. The LlmProvider interface is shared with stub/Ollama drivers and
//      we do not want to change its signature for one feature.
//   2. The assess runner already manages run lifecycle; flushing at run
//      end is its responsibility.
//
// Test code can reset via _resetForTests.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PreLlmRedactionCounts } from './redact-pre-llm.js';
import { emptyPreLlmCounts } from './redact-pre-llm.js';

export type RedactionSurface = 'llm_egress' | 'report_write';

export interface RedactionCallEntry {
  timestamp: string;
  surface: RedactionSurface;
  /** For llm_egress: provider name. For report_write: 'report-scrub'. */
  provider: string;
  /** For llm_egress: model id. For report_write: the file path relative to runDir. */
  model: string;
  input_chars: number;
  scrubbed_chars: number;
  counts: PreLlmRedactionCounts;
}

export interface RedactionReport {
  schema_version: 1;
  run_started_at: string;
  run_ended_at: string;
  totals: {
    calls: number;
    total_input_chars: number;
    scrubbed_chars: number;
    counts: PreLlmRedactionCounts;
  };
  calls: RedactionCallEntry[];
}

let calls: RedactionCallEntry[] = [];
let runStartedAt: string = new Date().toISOString();

export function recordRedaction(entry: Omit<RedactionCallEntry, 'timestamp' | 'surface'> & { surface?: RedactionSurface }): void {
  calls.push({
    timestamp: new Date().toISOString(),
    surface: entry.surface ?? 'llm_egress',
    provider: entry.provider,
    model: entry.model,
    input_chars: entry.input_chars,
    scrubbed_chars: entry.scrubbed_chars,
    counts: entry.counts,
  });
}

/**
 * Reset the sink and mark a new run start. Called by the assess runner
 * at run open so cross-run contamination is impossible.
 */
export function beginRun(): void {
  calls = [];
  runStartedAt = new Date().toISOString();
}

export function buildReport(): RedactionReport {
  const totals = emptyPreLlmCounts();
  let scrubbed_chars_total = 0;
  let total_input_chars = 0;
  for (const c of calls) {
    // #1508: sum scrubbed_chars directly -- it is the scrubbed-output length,
    // not a "chars removed" delta. Subtracting from input_chars is wrong when
    // replacement tokens are longer than the originals and produces 0.
    scrubbed_chars_total += c.scrubbed_chars;
    total_input_chars += c.input_chars;
    for (const k of Object.keys(totals) as (keyof PreLlmRedactionCounts)[]) {
      totals[k] += c.counts[k];
    }
  }
  return {
    schema_version: 1,
    run_started_at: runStartedAt,
    run_ended_at: new Date().toISOString(),
    totals: {
      calls: calls.length,
      total_input_chars,
      scrubbed_chars: scrubbed_chars_total,
      counts: totals,
    },
    calls,
  };
}

/**
 * Write the report to disk and clear the in-memory state. Idempotent
 * with respect to file existence (overwrites; mkdirs the parent).
 */
export function flushRedactionReport(outPath: string): void {
  const report = buildReport();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
}

export function _resetForTests(): void {
  calls = [];
  runStartedAt = new Date().toISOString();
}

/** Test-only inspector. */
export function _peekCalls(): readonly RedactionCallEntry[] {
  return calls;
}
