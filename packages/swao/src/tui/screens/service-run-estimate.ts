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

// #4236 (owner decision D-1, 2026-11-09): the expected USD cost of a Service
// Portfolio Assessment run, for its confirmation step.
//
// - The Top N ranking needs research of every scaffolded app, so research is
//   priced for all apps, minus the LLM topics a research run keeps from its
//   cache (cachedLlmResearch in @swao/module-service-assessment).
// - #4374: measured figures come only from work of the same kind, read from
//   wsp/logs/portfolio-events-*.ndjson:
//   - research cost per call: `provider.llm.<provider>.ok` events whose caller
//     starts with `service.research.` (research.ts withLlmCallContext), per
//     model; pings, health checks, preflights and chat calls never count;
//   - research time per call: wall-clock `duration_ms / llm_calls` of
//     `service.research.complete` (topics run concurrently, so the latency of
//     one call would overstate the time);
//   - assessment cost and time per app: `service.assess.batch.progress` events
//     with status ok (the per-app `swao assess` child sets no caller on its LLM
//     calls, so the batch line of the service run is the measured unit).
//     #4457: the cost per app is measured per assessment model (the `model`
//     of the progress line, from the run manifest); a rate of another model, or
//     of lines that predate the field (no model), never stands for the
//     configured model: the confirmation names it and uses the price table.
//   A measured figure replaces the price table (or the typical time) only from
//   a minimum sample count.
// - Above `service_portfolio.cost_confirm_usd` (default 25 USD) the run needs a
//   second confirmation.
// - A cheaper research model is offered only when its price-table cost per call
//   is lower than the configured model's price-table cost, so a more expensive
//   model is never offered as cheaper.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { getConnector, modelRates, type Connector } from '@swao/module-llm-providers';

/** Default cost above which the confirmation asks a second time (D-1). */
export const DEFAULT_COST_CONFIRM_USD = 25;

/** Typical tokens of one call, for the price-table estimate when no call was measured. */
export const TYPICAL_CALL_TOKENS: Readonly<Record<CallKind, { input: number; output: number }>> = {
  research: { input: 3_000, output: 800 },
  assessment: { input: 12_000, output: 2_000 },
};

/** #4374: research calls of a model needed before their mean replaces the price table. */
export const MIN_MEASURED_RESEARCH_CALLS = 5;
/** #4374: assessed service apps needed before their mean replaces the price table and the typical time. */
export const MIN_MEASURED_ASSESS_APPS = 3;
/** #4374: caller prefix of the LLM topic calls of a service research run (research.ts). */
export const RESEARCH_CALLER_PREFIX = 'service.research.';
/** #4374: typical wall-clock seconds per research call before one was measured (owner run 2026-11-10: 772 calls in 53.8 min). */
export const TYPICAL_RESEARCH_SECONDS_PER_CALL = 4;
/** Typical minutes per service app with an LLM before one was measured (UAT 2026-10-11: 3 to 4 min). */
export const TYPICAL_ASSESS_MINUTES_PER_APP: readonly [number, number] = [3, 4];

/** Cheaper research candidates from the provider price tables, cheapest first. */
const LISTED_CHEAPER_MODELS: readonly string[] = ['claude-haiku-4-5', 'claude-sonnet-4-6'];

export type CallKind = 'research' | 'assessment';
/** `scaled`: the measured cost of the configured model times the price-table ratio of the two models. */
export type CostBasis = 'measured' | 'price table' | 'scaled' | 'unknown';

export interface CallCost {
  model: string | null;
  usd: number | null;
  basis: CostBasis;
  /** Measured calls the mean is taken from (measured and scaled). */
  samples?: number;
  /** Scaled: the model whose measured cost was scaled. */
  scaledFrom?: string;
}

export type MeasuredMeans = Map<string, { mean: number; samples: number }>;

/** #4374: the measured basis of the estimate, from the workspace portfolio logs. */
export interface MeasuredBasis {
  /** Mean cost per research call by model (every sample; the minimum applies in callCost). */
  researchByModel: MeasuredMeans;
  /** Wall-clock seconds per research call over the non-dry research runs; null without one. */
  researchTime: { secondsPerCall: number; calls: number } | null;
  /** Mean cost and minutes per assessed service app over every model (the time basis); null without one. */
  assessPerApp: { usd: number; minutes: number; samples: number } | null;
  /** #4457: mean cost and minutes per assessed service app by assessment model (lines with a model only). */
  assessPerAppByModel: Map<string, { usd: number; minutes: number; samples: number }>;
  /** #4457: assessed apps whose progress line names no model (logged before the field existed). */
  assessUnrecordedModel: number;
}

/**
 * #4457: the model id the per-model assessment cost is keyed on: trimmed, without
 * a trailing release date (claude-haiku-4-5-20251001 and claude-haiku-4-5 are
 * one model), so the configured id and the run manifest id meet.
 */
export function assessModelKey(model: string): string {
  return model.trim().replace(/-[0-9]{8}$/, '');
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const LOG_FILE = /^portfolio-events-\d{4}-\d{2}\.ndjson$/;

/** Portfolio log lines of the two newest months. */
function portfolioLogLines(workspace: string): string[] {
  const dir = join(workspace, 'wsp', 'logs');
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f) => LOG_FILE.test(f)).sort().slice(-2); } catch { return []; }
  const lines: string[] = [];
  for (const f of files) {
    try { lines.push(...readFileSync(join(dir, f), 'utf-8').split('\n')); } catch { /* unreadable month */ }
  }
  return lines;
}

/** #4374: one pass over the portfolio logs for the research and assessment basis. */
export function readMeasuredBasis(workspace: string): MeasuredBasis {
  const research = new Map<string, { sum: number; n: number }>();
  let rtMs = 0;
  let rtCalls = 0;
  let aUsd = 0;
  let aMs = 0;
  let aN = 0;
  const aByModel = new Map<string, { usd: number; ms: number; n: number }>();
  let aUnrecorded = 0;
  for (const line of portfolioLogLines(workspace)) {
    if (!line.includes('"code":"provider.llm.') && !line.includes('"code":"service.')) continue;
    let ev: { code?: unknown; context?: Record<string, unknown> };
    try { ev = JSON.parse(line) as typeof ev; } catch { continue; }
    const code = typeof ev.code === 'string' ? ev.code : '';
    const ctx = ev.context ?? {};
    if (code.startsWith('provider.llm.') && code.endsWith('.ok')) {
      const caller = ctx['caller'];
      const model = ctx['model'];
      const cost = num(ctx['cost_usd']);
      if (typeof caller !== 'string' || !caller.startsWith(RESEARCH_CALLER_PREFIX)) continue;
      if (typeof model !== 'string' || cost === null || cost <= 0) continue;
      const e = research.get(model) ?? { sum: 0, n: 0 };
      e.sum += cost;
      e.n += 1;
      research.set(model, e);
    } else if (code === 'service.research.complete') {
      const calls = num(ctx['llm_calls']);
      const ms = num(ctx['duration_ms']);
      if (ctx['dry_run'] === true || calls === null || calls <= 0 || ms === null || ms <= 0) continue;
      rtMs += ms;
      rtCalls += calls;
    } else if (code === 'service.assess.batch.progress') {
      const cost = num(ctx['cost_usd']);
      const ms = num(ctx['duration_ms']);
      if (ctx['status'] !== 'ok' || cost === null || cost <= 0 || ms === null || ms <= 0) continue;
      aUsd += cost;
      aMs += ms;
      aN += 1;
      const model = ctx['model'];
      if (typeof model === 'string' && model.trim() !== '') {
        const key = assessModelKey(model);
        const e = aByModel.get(key) ?? { usd: 0, ms: 0, n: 0 };
        e.usd += cost;
        e.ms += ms;
        e.n += 1;
        aByModel.set(key, e);
      } else {
        aUnrecorded += 1;
      }
    }
  }
  return {
    researchByModel: new Map([...research].map(([m, e]) => [m, { mean: e.sum / e.n, samples: e.n }])),
    researchTime: rtCalls > 0 ? { secondsPerCall: rtMs / 1000 / rtCalls, calls: rtCalls } : null,
    assessPerApp: aN > 0 ? { usd: aUsd / aN, minutes: aMs / 60_000 / aN, samples: aN } : null,
    assessPerAppByModel: new Map([...aByModel].map(([m, e]) => [m, { usd: e.usd / e.n, minutes: e.ms / 60_000 / e.n, samples: e.n }])),
    assessUnrecordedModel: aUnrecorded,
  };
}

/** Mean cost per research call by model (#4374: research calls of service runs only). */
export function measuredCostsByModel(workspace: string): MeasuredMeans {
  return readMeasuredBasis(workspace).researchByModel;
}

/**
 * Price-table estimate of one call; null when no price is known. #4497: the
 * rates come from the workspace connector of the model (its connector file,
 * a discovery price, the bundled price), else the Anthropic code table
 * (modelRates); without a connector the code table only.
 */
export function listedCallCost(model: string, kind: CallKind, connector?: Connector): number | null {
  const t = TYPICAL_CALL_TOKENS[kind];
  const r = modelRates(connector, model);
  if (!r) return null;
  const usd = (t.input * r.inputPerMillion + t.output * r.outputPerMillion) / 1_000_000;
  return usd > 0 ? usd : null;
}

/** #4497: the workspace connector of providers.llm.primary (the service research and assessment model), or undefined. */
export function readServiceConnector(workspace: string): Connector | undefined {
  try {
    const doc = loadYaml(readFileSync(join(workspace, '.swao.yml'), 'utf-8')) as { providers?: { llm?: { primary?: { connector?: unknown } } } } | null;
    const id = doc?.providers?.llm?.primary?.connector;
    return typeof id === 'string' && id.trim() ? getConnector(id.trim(), { workspaceRoot: workspace })?.file.connector : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Cost of one call. Research: the measured mean of the model's research calls
 * once there are MIN_MEASURED_RESEARCH_CALLS of them, else the price table.
 * Assessment calls are never measured per call (see readMeasuredBasis).
 */
export function callCost(model: string | null, kind: CallKind, measured: MeasuredMeans, connector?: Connector): CallCost {
  if (!model) return { model, usd: null, basis: 'unknown' };
  const m = kind === 'research' ? measured.get(model) : undefined;
  if (m && m.samples >= MIN_MEASURED_RESEARCH_CALLS) return { model, usd: m.mean, basis: 'measured', samples: m.samples };
  const listed = listedCallCost(model, kind, connector);
  return listed !== null ? { model, usd: listed, basis: 'price table' } : { model, usd: null, basis: 'unknown' };
}

/**
 * The cheapest research model that costs less per call than `current`; null
 * when none is known. #4374: a candidate needs a lower price-table cost than
 * the current model (a model without a price is never offered, nor is any
 * model when the current one has no price), and a lower cost on the basis
 * shown: its own measured mean, else the current model's measured mean scaled
 * by the price-table ratio, else its price-table cost.
 */
export function cheaperResearchModel(current: CallCost, measured: MeasuredMeans, connector?: Connector): CallCost | null {
  if (!current.model || current.usd === null) return null;
  const currentListed = listedCallCost(current.model, 'research', connector);
  if (currentListed === null) return null;
  const candidates = [...new Set<string>([...LISTED_CHEAPER_MODELS, ...measured.keys()])];
  let best: CallCost | null = null;
  for (const m of candidates) {
    if (m === current.model) continue;
    const listed = listedCallCost(m, 'research', connector);
    if (listed === null || listed >= currentListed) continue;
    const own = callCost(m, 'research', measured, connector);
    const c: CallCost = own.basis !== 'measured' && current.basis === 'measured'
      ? { model: m, usd: (current.usd * listed) / currentListed, basis: 'scaled', ...(current.samples !== undefined ? { samples: current.samples } : {}), scaledFrom: current.model }
      : own;
    if (c.usd === null || c.usd >= current.usd) continue;
    if (!best || (best.usd as number) > c.usd) best = c;
  }
  return best;
}

/**
 * #4374: assessment cost: measured per app over earlier service assessments, else the price table per call.
 * #4457: measured per assessment model. A rate measured with another model is not
 * scaled: the price-table ratio of two models is a poor guide for a whole
 * assessment (claude-opus-4-7 to claude-haiku-4-5 is 15 in the table). The price
 * table of the configured model applies, and the confirmation names the models
 * and rates it did not use.
 */
export interface AssessCost {
  model: string | null;
  basis: 'measured' | 'price table' | 'unknown';
  /** Measured: USD per assessed app. */
  usdPerApp: number | null;
  /** Price table: USD per call. */
  usdPerCall: number | null;
  /** Measured: assessed apps the mean is taken from. */
  samples?: number;
  /** #4457: earlier service assessments not used for this model: per-app rates of other models, and lines without a model. */
  notUsed?: { otherModels: Array<{ model: string; usdPerApp: number; samples: number }>; unrecorded: number };
}

export function assessmentCost(model: string | null, basis: MeasuredBasis, connector?: Connector): AssessCost {
  const byModel = basis.assessPerAppByModel;
  const own = model ? byModel.get(assessModelKey(model)) : undefined;
  if (model && own && own.samples >= MIN_MEASURED_ASSESS_APPS) return { model, basis: 'measured', usdPerApp: own.usd, usdPerCall: null, samples: own.samples };
  const c = callCost(model, 'assessment', new Map(), connector);
  const otherModels = [...byModel].filter(([m]) => !model || m !== assessModelKey(model)).sort((x, y) => x[0].localeCompare(y[0])).map(([m, e]) => ({ model: m, usdPerApp: e.usd, samples: e.samples }));
  const notUsed = otherModels.length > 0 || basis.assessUnrecordedModel > 0 ? { notUsed: { otherModels, unrecorded: basis.assessUnrecordedModel } } : {};
  return { model, basis: c.basis === 'price table' ? 'price table' : 'unknown', usdPerApp: null, usdPerCall: c.usd, ...notUsed };
}

/** #4374: time figures: research seconds per call and assessment minutes per app, measured or typical. */
export interface TimeBasis {
  researchSecondsPerCall: number;
  /** Research calls the figure is measured over; null: typical value. */
  researchMeasuredCalls: number | null;
  assessMinutesPerApp: readonly [number, number];
  /** Assessed apps the figure is measured over; null: typical value. */
  assessMeasuredApps: number | null;
}

export function timeBasis(basis: MeasuredBasis): TimeBasis {
  const r = basis.researchTime;
  const a = basis.assessPerApp;
  const rMeasured = r !== null && r.calls >= MIN_MEASURED_RESEARCH_CALLS;
  const aMeasured = a !== null && a.samples >= MIN_MEASURED_ASSESS_APPS;
  return {
    researchSecondsPerCall: rMeasured ? r.secondsPerCall : TYPICAL_RESEARCH_SECONDS_PER_CALL,
    researchMeasuredCalls: rMeasured ? r.calls : null,
    assessMinutesPerApp: aMeasured ? [a.minutes, a.minutes] : TYPICAL_ASSESS_MINUTES_PER_APP,
    assessMeasuredApps: aMeasured ? a.samples : null,
  };
}

/** `service_portfolio.cost_confirm_usd` of the workspace .swao.yml, else 25 USD. */
export function readCostConfirmThreshold(workspace: string): number {
  try {
    const doc = loadYaml(readFileSync(join(workspace, '.swao.yml'), 'utf-8')) as { service_portfolio?: { cost_confirm_usd?: unknown } } | null;
    const v = doc?.service_portfolio?.cost_confirm_usd;
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_COST_CONFIRM_USD;
  } catch {
    return DEFAULT_COST_CONFIRM_USD;
  }
}

/** The primary model and the research model (service_portfolio.research_model, else the primary). */
export function readServiceModels(workspace: string): { primary: string | null; research: string | null } {
  if (!existsSync(join(workspace, '.swao.yml'))) return { primary: null, research: null };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = loadYaml(readFileSync(join(workspace, '.swao.yml'), 'utf-8')) as Record<string, any> | null;
    const llm = doc?.['providers']?.['llm'];
    const envName = typeof llm?.['activeEnv'] === 'string' ? llm['activeEnv'] : undefined;
    const envModel = envName ? llm?.['environments']?.[envName]?.['model'] : undefined;
    const primaryRaw = llm?.['primary']?.['model'] ?? envModel;
    const primary = typeof primaryRaw === 'string' && primaryRaw.trim() ? primaryRaw.trim() : null;
    const r = doc?.['service_portfolio']?.['research_model'];
    return { primary, research: typeof r === 'string' && r.trim() ? r.trim() : primary };
  } catch {
    return { primary: null, research: null };
  }
}

export interface ServiceRunEstimate {
  /** LLM research calls the run makes at most (topics not served from the cache). */
  researchCalls: number;
  /** LLM research topics kept from the cache. */
  researchCached: number;
  /** All LLM research topics of the run (apps x 4). */
  researchTopics: number;
  assessCallsMin: number;
  /** Apps the assessment stage runs for; null when not known in advance. */
  assessApps: number | null;
  research: CallCost;
  assessment: AssessCost;
  time: TimeBasis;
  researchUsd: number | null;
  assessUsd: number | null;
  /** Research plus assessment; null when a cost is unknown and calls are made. */
  totalUsd: number | null;
  /** #4374: research stage minutes (calls x seconds per call). */
  researchMinutes: number;
  /** #4374: assessment stage minutes, low and high; null when the app count is not known. */
  assessMinutes: readonly [number, number] | null;
  thresholdUsd: number;
  /** True when the total is above the threshold: the run needs a second confirmation. */
  needsCostConfirmation: boolean;
}

export function estimateServiceRun(opts: {
  /** Research topics of the run (all scaffolded apps x 4; 0 when LLM research is skipped). */
  researchTopics: number;
  /** Topics a research run keeps from the cache (capped at researchTopics). */
  cachedTopics: number;
  assessCallsMin: number;
  /** Apps the assessment stage runs for; null when not known in advance. */
  assessApps: number | null;
  research: CallCost;
  assessment: AssessCost;
  time: TimeBasis;
  thresholdUsd: number;
}): ServiceRunEstimate {
  const researchCached = Math.min(opts.cachedTopics, opts.researchTopics);
  const researchCalls = opts.researchTopics - researchCached;
  const researchUsd = researchCalls === 0 ? 0 : opts.research.usd === null ? null : researchCalls * opts.research.usd;
  const a = opts.assessment;
  const assessUsd = a.basis === 'measured' && opts.assessApps !== null && opts.assessApps > 0
    ? opts.assessApps * (a.usdPerApp as number)
    : opts.assessCallsMin === 0 ? 0 : a.usdPerCall === null ? null : opts.assessCallsMin * a.usdPerCall;
  const totalUsd = researchUsd === null || assessUsd === null ? null : researchUsd + assessUsd;
  const [lo, hi] = opts.time.assessMinutesPerApp;
  return {
    researchCalls, researchCached, researchTopics: opts.researchTopics, assessCallsMin: opts.assessCallsMin, assessApps: opts.assessApps,
    research: opts.research, assessment: a, time: opts.time, researchUsd, assessUsd, totalUsd,
    researchMinutes: (researchCalls * opts.time.researchSecondsPerCall) / 60,
    assessMinutes: opts.assessApps === null ? null : [opts.assessApps * lo, opts.assessApps * hi],
    thresholdUsd: opts.thresholdUsd,
    // An unknown cost (no model configured, or no price for it) shows as unknown; only a
    // known total above the threshold asks the second time.
    needsCostConfirmation: totalUsd !== null && totalUsd > opts.thresholdUsd,
  };
}

export const formatUsd = (usd: number | null): string => (usd === null ? 'unknown' : `${usd.toFixed(2)} USD`);

/** #4374: a per-call or per-app figure; small figures keep four decimals so they never show as 0.00. */
export const formatUnitUsd = (usd: number | null): string => (usd === null ? 'unknown' : `${usd.toFixed(usd < 0.01 ? 4 : 3)} USD`);

/** Minutes as "N min" or "N.N h". */
export function formatMinutes(min: number): string {
  if (min < 1) return 'under 1 min';
  return min >= 90 ? `${(min / 60).toFixed(1)} h` : `${Math.round(min)} min`;
}

const formatSeconds = (s: number): string => `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;

/** #4374: the basis of a per-call figure, as shown on the confirmation. */
export function basisText(c: CallCost): string {
  if (c.usd === null) return `${c.model ?? 'no model'}, cost per call unknown`;
  const per = `${formatUnitUsd(c.usd)} per call`;
  switch (c.basis) {
    case 'measured': return `${c.model}, ${per} measured over ${c.samples} research call(s)`;
    case 'scaled': return `${c.model}, ${per} from ${c.scaledFrom} measured over ${c.samples} research call(s), scaled by the price table`;
    case 'price table': return `${c.model}, ${per} from the price table (typical call size)`;
    case 'unknown': return `${c.model ?? 'no model'}, cost per call unknown`;
    default: {
      const never: never = c.basis;
      return String(never);
    }
  }
}

/** #4457: why earlier service assessments were not used for the configured model. */
function notUsedText(a: AssessCost): string {
  const n = a.notUsed;
  if (!n) return '';
  const parts = [
    ...n.otherModels.map((o) => `${formatUnitUsd(o.usdPerApp)} per app measured over ${o.samples} with ${o.model}`),
    n.unrecorded > 0 ? `${n.unrecorded} without a recorded model` : null,
  ].filter(Boolean);
  return `; earlier service assessments not used for ${a.model ?? 'this model'}: ${parts.join(', ')}`;
}

export function assessBasisText(a: AssessCost): string {
  switch (a.basis) {
    case 'measured': return `${a.model}, ${formatUnitUsd(a.usdPerApp)} per app measured over ${a.samples} service assessment(s) with this model`;
    case 'price table': return `${a.model}, ${formatUnitUsd(a.usdPerCall)} per call from the price table (typical call size)${notUsedText(a)}`;
    case 'unknown': return `${a.model ?? 'no model'}, cost per call unknown${notUsedText(a)}`;
    default: {
      const never: never = a.basis;
      return String(never);
    }
  }
}

const minutesRange = (lo: number, hi: number): string =>
  (formatMinutes(lo) === formatMinutes(hi) ? formatMinutes(lo) : `${formatMinutes(lo)} to ${formatMinutes(hi)}`);

/**
 * #4374: the time lines: the total, then research (calls x seconds per call)
 * and assessment (apps x minutes per app), each with its basis.
 */
export function timeConfirmationLines(e: ServiceRunEstimate): string[] {
  const t = e.time;
  const lines: string[] = [];
  if (e.researchTopics > 0) {
    const basis = t.researchMeasuredCalls !== null ? `measured over ${t.researchMeasuredCalls} research call(s)` : 'typical value, not measured yet';
    lines.push(`Research time: ${formatMinutes(e.researchMinutes)} (${e.researchCalls} call(s) x ${formatSeconds(t.researchSecondsPerCall)} per call, ${basis})`);
  }
  const [lo, hi] = t.assessMinutesPerApp;
  const perApp = lo === hi ? `${formatMinutes(lo)} per app` : `${lo} to ${hi} min per app`;
  const aBasis = t.assessMeasuredApps !== null ? `measured over ${t.assessMeasuredApps} service assessment(s)` : 'typical value, not measured yet';
  if (e.assessMinutes !== null && e.assessApps !== null && e.assessApps > 0) {
    lines.push(`Assessment time: ${minutesRange(e.assessMinutes[0], e.assessMinutes[1])} (${e.assessApps} app(s) x ${perApp}, ${aBasis})`);
  } else if (e.assessApps === null) {
    lines.push(`Assessment time: ${perApp} (${aBasis})`);
  }
  if (lines.length === 0) return [];
  const total = e.assessMinutes === null ? null : minutesRange(e.researchMinutes + e.assessMinutes[0], e.researchMinutes + e.assessMinutes[1]);
  return [total === null ? 'Estimated time: not known in advance (app count unknown)' : `Estimated time: about ${total}`, ...lines];
}

/** Confirmation lines with the money and time figures (D-1, #4374). */
export function costConfirmationLines(e: ServiceRunEstimate, opts: { totalApps: number | null; assessApps: number | null; topRanking: boolean }): string[] {
  const lines: string[] = [];
  if (opts.topRanking && opts.totalApps !== null && opts.assessApps !== null) {
    lines.push(`Research ranks all ${opts.totalApps} apps to pick the top ${opts.assessApps}`);
  }
  if (e.researchTopics > 0) {
    lines.push(`Research: up to ${e.researchCalls} LLM call(s), ${e.researchCached} of ${e.researchTopics} topics from the cache (${Math.round((100 * e.researchCached) / e.researchTopics)} percent); ${formatUsd(e.researchUsd)} (${basisText(e.research)})`);
  }
  if (e.assessment.basis === 'measured' && e.assessApps !== null && e.assessApps > 0) {
    lines.push(`Assessment: ${e.assessApps} app(s); about ${formatUsd(e.assessUsd)} (${assessBasisText(e.assessment)})`);
  } else if (e.assessCallsMin > 0) {
    lines.push(`Assessment: at least ${e.assessCallsMin} LLM call(s); at least ${formatUsd(e.assessUsd)} (${assessBasisText(e.assessment)})`);
  }
  lines.push(`Expected cost: ${e.totalUsd === null ? 'unknown (no price for a model)' : `about ${formatUsd(e.totalUsd)}`}`);
  lines.push(...timeConfirmationLines(e));
  return lines;
}

/** #4374: the cheaper-model line of the confirmation, with the basis of its figure. */
export function cheaperModelLine(cheaper: CallCost): string {
  return `Cheaper research model available: ${basisText(cheaper)}; Tab switches to it`;
}
