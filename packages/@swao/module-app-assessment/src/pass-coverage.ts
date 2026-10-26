// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Application Assessment Module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3419 / #3436: pass coverage bookkeeping for `swao assess`. Pure functions
// so the decisions are unit-tested here (the host CLI tests spawn the built
// binary and cannot exercise source changes directly).
//
//   passesNotScheduled()   default passes the run never scheduled and why
//                          (not_in_profile, skipped_by_flag, not_applicable)
//   classifyPassOutcome()  a pass that ran: skipped itself (llm_unavailable,
//                          llm_failed, tool_missing, ...) or ran degraded
//
// Vocabulary and schemas: @swao/core pass-coverage.ts.

import {
  PassDegradedEntrySchema,
  PassDegradedRegimeSchema,
  PassDegradedReasonSchema,
  type PassResult,
  type PassNotRunEntry,
  type PassDegradedEntry,
} from '@swao/core';
import { z } from 'zod';
import {
  assessOrchestrator,
  CANONICAL_PASS_ORDER,
  DEFAULT_PASS_KEYS,
  SKIP_LLM_REMOVED_PASSES,
  SUPERSEDED_PASS_KEYS,
  sortPassesCanonical,
} from './orchestrator.js';
import { NO_LLM_REASON, CONNECTIVITY_FAILURE_REASON, INVALID_LLM_RESPONSE_REASON } from './passes/llm-skip.js';

/** Pass number and header name of a pass key (host-dispatched passes included). */
export function passIdentity(key: string): { num?: string; name?: string } {
  switch (key) {
    case 'comp': return { num: '11', name: 'compliance_evaluation' };
    case 'dynamic': return { num: '10', name: 'dynamic_analysis' };
    case 'lzr': return { num: '23', name: 'lzr' };
    default: {
      const d = assessOrchestrator.getPass(key);
      return d ? { num: d.num, name: d.name } : {};
    }
  }
}

export interface PassesNotScheduledInput {
  /** Normalised `--passes` keys before `--skip-llm` removed any. */
  requested: readonly string[];
  /** Keys that the pass loop will run (after --skip-llm, pass_profile / lenses, service plan). */
  scheduled: readonly string[];
  /** `--skip-llm` was set. */
  skipLlm: boolean;
  /** Service mode: passes the service plan skipped, with its reason. */
  serviceSkipped?: ReadonlyArray<{ key: string; reason: string }>;
}

/**
 * #3419: every default pass, and every explicitly requested pass, that is not
 * scheduled, with the reason. A pass superseded by a scheduled one (`secrets`
 * when `malware` runs) is not reported: its work is done by the other pass.
 */
export function passesNotScheduled(input: PassesNotScheduledInput): PassNotRunEntry[] {
  const scheduled = new Set(input.scheduled);
  const requested = new Set(input.requested);
  // sortPassesCanonical drops `secrets` when `malware` is a candidate; the
  // check after the loop accounts for it when neither of the two runs.
  const candidates = sortPassesCanonical([...DEFAULT_PASS_KEYS, ...input.requested]);
  const out: PassNotRunEntry[] = [];
  for (const key of candidates) {
    if (key === 'lzr' || scheduled.has(key)) continue;
    const by = SUPERSEDED_PASS_KEYS[key];
    if (by !== undefined && scheduled.has(by)) continue;
    const id = passIdentity(key);
    const service = input.serviceSkipped?.find((s) => s.key === key);
    if (service) {
      out.push({ pass: key, ...id, reason: 'not_applicable', detail: service.reason });
    } else if (input.skipLlm && requested.has(key) && SKIP_LLM_REMOVED_PASSES.includes(key)) {
      out.push({ pass: key, ...id, reason: 'skipped_by_flag', detail: '--skip-llm' });
    } else {
      out.push({ pass: key, ...id, reason: 'not_in_profile', detail: requested.has(key) ? 'excluded by assessment.pass_profile / lenses' : 'not in the requested pass list' });
    }
  }
  // `secrets` superseded by a requested (but unscheduled) `malware` was dropped
  // by sortPassesCanonical; report it when neither of the two runs.
  if (DEFAULT_PASS_KEYS.includes('secrets') && !scheduled.has('secrets') && !scheduled.has('malware') && !out.some((e) => e.pass === 'secrets')) {
    out.push({ pass: 'secrets', ...passIdentity('secrets'), reason: 'not_in_profile', detail: 'excluded by assessment.pass_profile / lenses' });
  }
  return sortByCanonical(out);
}

function sortByCanonical(entries: PassNotRunEntry[]): PassNotRunEntry[] {
  const rank = (k: string): number => {
    const i = CANONICAL_PASS_ORDER.indexOf(k);
    return i === -1 ? CANONICAL_PASS_ORDER.length : i;
  };
  return [...entries].sort((x, y) => rank(x.pass) - rank(y.pass));
}

/** #3436: structured log event for a pass that ran but is not fully evaluated. */
export const PASS_DEGRADED_EVENT = 'assessment.pass.degraded' as const;

export interface PassDegradedLogEvent {
  event: typeof PASS_DEGRADED_EVENT;
  level: 'warn';
  message: string;
  context: { pass: string; num?: string; name?: string; reason: PassDegradedEntry['reason']; regimes: NonNullable<PassDegradedEntry['regimes']>; pass_id: string };
}

/**
 * #3436: the `assessment.pass.degraded` event (app and portfolio log) for a
 * degraded pass. The message names the frameworks and their controls without
 * a model verdict, so the log alone says compliance was not fully evaluated.
 */
export function passDegradedLogEvent(d: PassDegradedEntry, passId: string): PassDegradedLogEvent {
  const regimes = d.regimes ?? [];
  const list = regimes.map((r) => `${r.id} (${r.controls_without_verdict})`).join(', ');
  const what = d.pass === 'comp' ? 'compliance not fully evaluated' : 'not fully evaluated';
  return {
    event: PASS_DEGRADED_EVENT,
    level: 'warn',
    message: `Pass ${d.num ?? '?'} ${d.name ?? d.pass} ${what} (${d.reason})${list ? `: ${list}` : ''}`,
    context: { pass: d.pass, ...(d.num ? { num: d.num } : {}), ...(d.name ? { name: d.name } : {}), reason: d.reason, regimes, pass_id: passId },
  };
}

export interface PassOutcome {
  /** The pass produced no (or no usable) result. */
  notRun?: PassNotRunEntry;
  /** #3436: the pass ran but is not fully evaluated. */
  degraded?: PassDegradedEntry;
}

const AssessmentMarkersSchema = z.object({
  skipped_reason: z.string().optional(),
  skip_llm_flag: z.boolean().optional(),
  malware_scan_status: z.string().optional(),
  missing_tools: z.array(z.string()).optional(),
  degraded: z.boolean().optional(),
  degraded_reason: z.string().optional(),
  degraded_regimes: z.array(PassDegradedRegimeSchema).optional(),
}).passthrough();

/**
 * #3419 / #3436: classify the result of a pass that ran. Reads the markers the
 * passes already write (`assessment.skipped_reason`, Pass 14
 * `malware_scan_status` / `missing_tools`, Pass 11 `degraded*`).
 */
export function classifyPassOutcome(key: string, result: Pick<PassResult, 'pass' | 'assessment'>, opts: { skipLlm: boolean }): PassOutcome {
  const id = passIdentity(key);
  const base = { pass: key, num: id.num ?? String(result.pass.id).padStart(2, '0'), name: result.pass.name };
  const parsed = AssessmentMarkersSchema.safeParse(result.assessment ?? {});
  const a = parsed.success ? parsed.data : {};
  const out: PassOutcome = {};

  // #3436: the pass ran, its header stays `complete`; the degradation is a separate field.
  if (a.degraded === true) {
    const reason = PassDegradedReasonSchema.safeParse(a.degraded_reason);
    out.degraded = PassDegradedEntrySchema.parse({
      ...base,
      reason: reason.success ? reason.data : 'llm_unavailable',
      ...(a.degraded_regimes && a.degraded_regimes.length > 0 ? { regimes: a.degraded_regimes } : {}),
    });
  }

  const skipped = a.skipped_reason;
  if (skipped === NO_LLM_REASON) {
    out.notRun = opts.skipLlm || a.skip_llm_flag === true
      ? { ...base, reason: 'skipped_by_flag', detail: '--skip-llm' }
      : { ...base, reason: 'llm_unavailable', detail: NO_LLM_REASON };
  } else if (skipped === CONNECTIVITY_FAILURE_REASON || skipped === 'provider_error' || skipped === INVALID_LLM_RESPONSE_REASON) {
    out.notRun = { ...base, reason: 'llm_failed', detail: skipped };
  } else if (a.malware_scan_status === 'skipped_tools_missing') {
    out.notRun = { ...base, reason: 'tool_missing', detail: `not installed: ${(a.missing_tools ?? []).join(', ')}` };
  } else if (a.malware_scan_status === 'skipped_all_disabled') {
    out.notRun = { ...base, reason: 'disabled_by_config', detail: 'passes.malware.tools' };
  } else if ((a.missing_tools ?? []).includes('gitleaks')) {
    // #3419: the full scan ran other tools, but the secret scan did not happen.
    out.notRun = { ...base, reason: 'tool_missing', detail: 'gitleaks not installed: secret scan not executed' };
  } else if (result.pass.status === 'not_applicable') {
    out.notRun = { ...base, reason: 'not_applicable', ...(skipped ? { detail: skipped } : {}) };
  }
  return out;
}
