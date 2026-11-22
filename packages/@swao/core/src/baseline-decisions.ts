// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core contracts
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3888 (Design 123 section 8.4, D-08): rule-engine decisions of the controls
// of a Client LZ Policy Baseline in an Application Assessment. The host
// (`swao assess --app`) evaluates the enabled policies against the app's needs
// and the selected LZ source (#3887) before Pass 11 and hands the decisions
// to Pass 11 on its PassContext; Pass 11 never sends a baseline control to
// the LLM (CP-4).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { lzProviderBrand } from './lz-provider-brand.js';

export const BASELINE_CONTROL_OUTCOMES = ['SATISFIED', 'PARTIAL', 'GAP', 'UNKNOWN', 'N_A'] as const;
export type BaselineControlOutcome = (typeof BASELINE_CONTROL_OUTCOMES)[number];

/**
 * Outcome order of the worst-of combination (Design 123 section 8.4), worst
 * highest: GAP, then UNKNOWN, then PARTIAL, then SATISFIED, then N_A.
 */
export const BASELINE_OUTCOME_RANK: Readonly<Record<BaselineControlOutcome, number>> = { N_A: 0, SATISFIED: 1, PARTIAL: 2, UNKNOWN: 3, GAP: 4 };

/**
 * #3981: the outcome of one LZ target (catalogue source) or one live scope
 * (live source) for one policy, before the worst-of combination. `target` is
 * `<provider>/<region>` on the catalogue source; `scope_id` is the scope's
 * `.swao.yml` id on the live source (a label, never the scope's target
 * locator). Rationale as the decision's: counts, kinds and region ids only.
 */
export const BaselineControlContributionSchema = z.object({
  target: z.string().min(1).optional(),
  scope_id: z.string().min(1).optional(),
  provider: z.string().min(1),
  region: z.string().min(1).optional(),
  outcome: z.enum(BASELINE_CONTROL_OUTCOMES),
  rationale: z.string().min(1),
}).strict().refine((c) => (c.target === undefined) !== (c.scope_id === undefined), { message: 'a contribution names either a target or a scope_id' });
export type BaselineControlContribution = z.infer<typeof BaselineControlContributionSchema>;

export const BaselineControlDecisionSchema = z.object({
  /** Policy the control belongs to (`CPB-*` or client `X-*`). */
  policy_id: z.string().min(1),
  outcome: z.enum(BASELINE_CONTROL_OUTCOMES),
  /** Policy ids, kinds, counts and region ids only: never resource ids, names or tag values (Design 123 section 12). */
  rationale: z.string().min(1),
  /**
   * #3981: per target or per scope outcomes, ranked worst first (the first
   * entry decided `outcome`). Absent when the decision is not per target:
   * app-level kinds (service_deny, service_allow_list), disabled, not_set, or
   * no target or result at all.
   */
  contributions: z.array(BaselineControlContributionSchema).optional(),
}).strict();
export type BaselineControlDecision = z.infer<typeof BaselineControlDecisionSchema>;

export const BaselineControlDecisionsSchema = z.object({
  /** LZ source the decisions were made against; `none` when no source was usable. */
  source: z.enum(['catalogue', 'live', 'none']),
  /** regime (framework) id -> control id -> decision. */
  regimes: z.record(z.string().min(1), z.record(z.string().min(1), BaselineControlDecisionSchema)),
  /** Why a baseline regime has no decisions at all (for example no LZ target, or --no-lz-fit). */
  reason: z.string().min(1).optional(),
}).strict();
export type BaselineControlDecisions = z.infer<typeof BaselineControlDecisionsSchema>;

/** File name of the decisions in the app run folder (#3981), next to run-context.yaml. */
export const BASELINE_DECISIONS_FILE = 'baseline-decisions.json';

/**
 * #3981: ranks contributions worst first by BASELINE_OUTCOME_RANK; ties keep
 * the input order (stable), so the ranking is deterministic per run.
 */
export function rankBaselineContributions(cs: readonly BaselineControlContribution[]): BaselineControlContribution[] {
  return cs.map((c, i) => ({ c, i })).sort((a, b) => BASELINE_OUTCOME_RANK[b.c.outcome] - BASELINE_OUTCOME_RANK[a.c.outcome] || a.i - b.i).map((x) => x.c);
}

/**
 * Label of a contribution: the scope id with the provider brand (live, #4005:
 * `scope platform (T Cloud Public)`) or `<provider>/<region>` (catalogue, the
 * form --lz-cat-targets takes back, #4007). Human text only: the persisted
 * contribution keeps the provider id.
 */
export function baselineContributionLabel(c: BaselineControlContribution): string {
  return c.scope_id !== undefined ? `scope ${c.scope_id} (${lzProviderBrand(c.provider)})` : (c.target as string);
}

/**
 * #3981: one line per ranked contribution (`1. GAP  scope platform (T Cloud Public)`),
 * for the TUI, the MCP tools and the chat context. Labels only: scope ids and
 * provider/region, never a target locator.
 */
export function formatBaselineContributions(cs: readonly BaselineControlContribution[], indent = '  '): string[] {
  return cs.map((c, i) => `${indent}${i + 1}. ${c.outcome.padEnd(9)} ${baselineContributionLabel(c)}`);
}

/** #3981: the decisions of an app run folder (`baseline-decisions.json`), or null when absent or invalid. */
export function readBaselineDecisions(runDir: string): BaselineControlDecisions | null {
  const f = join(runDir, BASELINE_DECISIONS_FILE);
  if (!existsSync(f)) return null;
  try {
    const r = BaselineControlDecisionsSchema.safeParse(JSON.parse(readFileSync(f, 'utf-8')));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/**
 * #3981: summary lines of an app run's baseline decisions, for the TUI results
 * step, the MCP tools and the chat context. First a count line per regime,
 * then the controls worst first (ties by control id), each with its ranked
 * contributions. Labels, outcomes and counts only: no rationale text, so no
 * free text reaches a surface that did not ask for it.
 */
export function formatBaselineDecisionLines(d: BaselineControlDecisions, maxControls = 8): string[] {
  const lines: string[] = [];
  if (Object.keys(d.regimes).length === 0) {
    lines.push(`Baseline decisions (source ${d.source}): none${d.reason ? `, ${d.reason}` : ''}`);
    return lines;
  }
  for (const [regime, controls] of Object.entries(d.regimes).sort(([a], [b]) => a.localeCompare(b))) {
    const entries = Object.entries(controls);
    const counts = BASELINE_CONTROL_OUTCOMES.map((o) => [o, entries.filter(([, x]) => x.outcome === o).length] as const).filter(([, n]) => n > 0);
    lines.push(`Baseline decisions ${regime} (source ${d.source}): ${entries.length} controls, ${counts.map(([o, n]) => `${n} ${o}`).join(', ')}`);
    const ranked = entries.sort(([ia, a], [ib, b]) => BASELINE_OUTCOME_RANK[b.outcome] - BASELINE_OUTCOME_RANK[a.outcome] || ia.localeCompare(ib));
    for (const [id, x] of ranked.slice(0, maxControls)) {
      const cs = x.contributions ?? [];
      lines.push(`  ${id.padEnd(12)} ${x.outcome.padEnd(9)}${cs.length > 0 ? ` ranked: ${cs.map((c, i) => `${i + 1}. ${c.outcome} ${baselineContributionLabel(c)}`).join(', ')}` : ''}`);
    }
    if (ranked.length > maxControls) lines.push(`  ... ${ranked.length - maxControls} more`);
  }
  return lines;
}
