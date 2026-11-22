// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- LLM Assessment cost estimate per LLM Provider (#4497)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4497 (Design 092): the Review step estimate is per LLM Provider. Each leg
// makes the LLM pass calls of the suite, the app challenge calls (one per
// challenge agent) and the LZ challenge calls; the synthesis compares the legs
// without an LLM call. Basis per leg, in this order:
//   measured     the cost of the same connector and model in the newest
//                earlier LLM Assessment of the app (calls/<leg>.ndjson);
//   price table  the calls times typical tokens times the model rates
//                (modelRates: the connector file, a discovery price, the
//                bundled price, the Anthropic code table);
//   unknown      no price: "cost unknown" for that leg, no flat default.
// The call counts come from the newest earlier run of the app when there is
// one, else from the suite (LLM pass share of the pass count, 5 agents, 4 LZ
// agents). Typical tokens per call were measured on the 2026-11-16 run of the
// owner UAT (28 calls, 2 legs).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { modelRates, type Connector, type ModelRates } from '@swao/module-llm-providers';

export type ReviewCallKind = 'pass' | 'challenge' | 'lz-challenge';

/** Typical tokens of one call by kind (owner UAT run of 2026-11-16, means over both legs). */
export const REVIEW_CALL_TOKENS: Readonly<Record<ReviewCallKind, { input: number; output: number }>> = {
  pass: { input: 5_700, output: 2_850 },
  challenge: { input: 10_600, output: 3_000 },
  'lz-challenge': { input: 1_200, output: 2_050 },
};
/** LLM passes of the pass suite 1.6.1 (03, 04, 09, 11, 12) per pass of the suite (5 of 14). */
export const LLM_PASS_SHARE = 5 / 14;
/** App challenge agents (persona taxonomy, CANONICAL_AGENT_ORDER). */
export const DEFAULT_APP_CHALLENGES = 5;
/** LZ challenge agents of an app with a landing zone link (upper bound when not measured). */
export const DEFAULT_LZ_CHALLENGES = 4;

export interface ReviewCallCounts { pass: number; challenge: number; 'lz-challenge': number; source: 'measured' | 'suite' }

export interface ReviewLegInput { connector: string; model: string }

export interface ReviewLegEstimate {
  connector: string;
  model: string;
  calls: ReviewCallCounts;
  usd: number | null;
  basis: 'measured' | 'price table' | 'unknown';
  /** Price table: where the rates come from. */
  rates?: ModelRates;
  /** Measured: the run the cost was read from. */
  measuredRun?: string;
}

export interface ReviewEstimate {
  legs: ReviewLegEstimate[];
  /** Sum of the legs with a cost; null when no leg has one. */
  knownUsd: number | null;
  /** Legs without a cost. */
  unknownLegs: number;
}

interface MeasuredLeg { usd: number; counts: ReviewCallCounts; run: string }

function kindOf(row: { call_site?: unknown; pass_id?: unknown }): ReviewCallKind {
  const pass = typeof row.pass_id === 'string' ? row.pass_id : '';
  if (pass.startsWith('challenge-lz-')) return 'lz-challenge';
  if (row.call_site === 'challenge' || pass.startsWith('challenge-')) return 'challenge';
  return 'pass';
}

/** The app id of a run folder (manifest.yaml `app_id`), or undefined. */
function runAppId(run: string): string | undefined {
  try {
    const m = loadYaml(readFileSync(join(run, 'manifest.yaml'), 'utf-8')) as { app_id?: unknown } | null;
    return typeof m?.app_id === 'string' ? m.app_id : undefined;
  } catch { return undefined; }
}

/**
 * The newest run folders of an app (run ids sort by time), at most `max`.
 * The orchestrator writes every run to llm-assessments/swao/<run>; the app is
 * named in the run's manifest.yaml.
 */
function runDirs(workspace: string, appId: string, max = 10): string[] {
  const dir = join(workspace, 'llm-assessments', 'swao');
  try {
    return readdirSync(dir).filter((r) => existsSync(join(dir, r, 'calls'))).sort().reverse().slice(0, 50)
      .map((r) => join(dir, r)).filter((r) => runAppId(r) === appId).slice(0, max);
  } catch { return []; }
}

/**
 * The earlier LLM Assessment runs of an app, read once: per connector and
 * model the newest complete leg (cost and call counts), and the call counts of
 * the newest run with any complete leg. Never throws.
 */
export function readMeasuredLegs(workspace: string, appId: string): { byLeg: Map<string, MeasuredLeg>; counts?: ReviewCallCounts } {
  const byLeg = new Map<string, MeasuredLeg>();
  let counts: ReviewCallCounts | undefined;
  for (const run of runDirs(workspace, appId)) {
    let files: string[] = [];
    try { files = readdirSync(join(run, 'calls')).filter((f) => f.endsWith('.ndjson')); } catch { continue; }
    let complete = new Set<string>();
    try {
      const st = JSON.parse(readFileSync(join(run, 'status.json'), 'utf-8')) as { legs?: Array<{ id?: string; status?: string }> };
      complete = new Set((st.legs ?? []).filter((l) => l.status === 'complete' && l.id).map((l) => l.id!));
    } catch { /* no status: no complete leg */ }
    for (const f of files) {
      let rows: Array<Record<string, unknown>> = [];
      try {
        rows = readFileSync(join(run, 'calls', f), 'utf-8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Record<string, unknown>);
      } catch { continue; }
      const leg = rows[0]?.['leg'] as { id?: string; connector?: string; model?: string } | undefined;
      if (!leg?.connector || !leg.model || !leg.id || !complete.has(leg.id)) continue;
      const c: ReviewCallCounts = { pass: 0, challenge: 0, 'lz-challenge': 0, source: 'measured' };
      let usd = 0;
      for (const r of rows) {
        c[kindOf(r)]++;
        const cost = (r['cost_usd'] as { computed?: unknown } | undefined)?.computed;
        if (typeof cost === 'number' && Number.isFinite(cost)) usd += cost;
      }
      const key = `${leg.connector}::${leg.model}`;
      if (!byLeg.has(key) && usd > 0) byLeg.set(key, { usd, counts: c, run: basename(run) });
      if (!counts) counts = c;
    }
  }
  return { byLeg, ...(counts ? { counts } : {}) };
}

/** The suite call counts when no earlier run of the app exists. */
export function suiteCallCounts(passCount: number): ReviewCallCounts {
  return { pass: Math.max(1, Math.round(passCount * LLM_PASS_SHARE)), challenge: DEFAULT_APP_CHALLENGES, 'lz-challenge': DEFAULT_LZ_CHALLENGES, source: 'suite' };
}

function priced(calls: ReviewCallCounts, r: ModelRates): number {
  let usd = 0;
  for (const k of ['pass', 'challenge', 'lz-challenge'] as const) {
    const t = REVIEW_CALL_TOKENS[k];
    usd += calls[k] * ((t.input * r.inputPerMillion + t.output * r.outputPerMillion) / 1_000_000);
  }
  return usd;
}

/**
 * #4497: the estimate of an LLM Assessment, per leg. `connectors` resolves a
 * connector id to its (refreshed) connector file; `measured` comes from
 * readMeasuredLegs (empty: price table only).
 */
export function estimateLlmReview(opts: {
  legs: readonly ReviewLegInput[];
  passCount: number;
  connectors: (id: string) => Connector | undefined;
  measured?: ReturnType<typeof readMeasuredLegs>;
}): ReviewEstimate {
  const counts = opts.measured?.counts ?? suiteCallCounts(opts.passCount);
  const legs = opts.legs.map((l): ReviewLegEstimate => {
    const m = opts.measured?.byLeg.get(`${l.connector}::${l.model}`);
    if (m) return { connector: l.connector, model: l.model, calls: m.counts, usd: m.usd, basis: 'measured', measuredRun: m.run };
    const rates = modelRates(opts.connectors(l.connector), l.model);
    if (!rates) return { connector: l.connector, model: l.model, calls: counts, usd: null, basis: 'unknown' };
    return { connector: l.connector, model: l.model, calls: counts, usd: priced(counts, rates), basis: 'price table', rates };
  });
  const known = legs.filter((l) => l.usd !== null);
  return { legs, knownUsd: known.length > 0 ? known.reduce((s, l) => s + (l.usd as number), 0) : null, unknownLegs: legs.length - known.length };
}

const usdText = (usd: number): string => `${usd.toFixed(usd < 0.01 ? 4 : 3)} USD`;

/** One line per leg for the Review step. */
export function reviewLegLine(l: ReviewLegEstimate): string {
  const calls = `${l.calls.pass} pass, ${l.calls.challenge} challenge, ${l.calls['lz-challenge']} LZ challenge calls`;
  if (l.basis === 'unknown') return `${l.connector} / ${l.model}: cost unknown (no price for this model), ${calls}`;
  if (l.basis === 'measured') return `${l.connector} / ${l.model}: about ${usdText(l.usd as number)}, measured in run ${l.measuredRun} (${calls})`;
  const src = l.rates?.source === 'bundled' ? 'bundled price' : l.rates?.source === 'connector' ? 'connector file price' : 'price table';
  const rate = l.rates ? `${l.rates.inputPerMillion}/${l.rates.outputPerMillion} USD per 1M tokens, ${src}` : src;
  return `${l.connector} / ${l.model}: about ${usdText(l.usd as number)} (${calls}; ${rate})`;
}

/** The total line: the known sum, and how many legs have no price. */
export function reviewTotalLine(e: ReviewEstimate): string {
  if (e.knownUsd === null) return 'cost unknown (no price for any model)';
  const unknown = e.unknownLegs > 0 ? `, plus ${e.unknownLegs} LLM Provider(s) with cost unknown` : '';
  return `about ${usdText(e.knownUsd)} in total${unknown}; the synthesis makes no LLM call`;
}
