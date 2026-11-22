// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI and orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * #4273: batch events of a service assessment (one `swao assess --type
 * service` child per app, run one after another by `swao service assess` and
 * by the TUI Service Portfolio Assessment screen):
 *
 *   service.assess.batch.start     apps_total, selection
 *   service.assess.batch.progress  index, total, app_id, status, exit_code, duration_ms, cost_usd, llm_calls, model (one per app)
 *   service.assess.batch.complete  ok, failed, skipped, duration_ms, cost_usd, llm_calls
 *   service.assess.batch.cancel    last_completed_index (instead of complete)
 *
 * #4270: `service.research.estimate`, the expected LLM calls and cost of a
 * research run, logged before the run starts.
 *
 * #4457: `service.pipeline.step.start`, `.progress` (every 15 s) and `.complete`
 * name each step of the TUI pipeline (ServicePipelineStepLog), so a step that
 * runs for minutes (scaffold, research, export) never leaves the log silent.
 *
 * Events go to the portfolio log of the given workspace (logPortfolioAt). The
 * TUI passes `mirror: false` so a warn line never prints into the Ink frame.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logPortfolioAt, roundCostUsd } from '@swao/core';
import { cachedLlmResearch } from '@swao/module-service-assessment';
import { callCost, measuredCostsByModel, readCostConfirmThreshold, readServiceConnector } from '../tui/screens/service-run-estimate.js';

type Level = 'info' | 'warn' | 'error';

function write(workspace: string, mirror: boolean, level: Level, code: string, message: string, context: Record<string, unknown>): void {
  try { logPortfolioAt(workspace, level, code, message, { context, mirror }); } catch { /* logging never stops a run */ }
}

/**
 * #4485: the preparation lines of the service research child: `service.research.prepare.start`
 * as its first action, then `service.research.prepare.phase` after each step with its
 * duration (runServiceResearch logs its own phases and `prepare.complete`). Not mirrored
 * to the console. A null workspace logs nothing.
 */
export function researchPrepareLog(workspace: string | null, appId: string | null): { start: () => void; phase: (step: string) => void } {
  let at = Date.now();
  const ctx = appId ? { app_filter: appId } : {};
  return {
    start: () => {
      at = Date.now();
      if (workspace) write(workspace, false, 'info', 'service.research.prepare.start', `Service research preparation started${appId ? ` (app ${appId})` : ''}`, { ...ctx, pid: process.pid });
    },
    phase: (step: string) => {
      const ms = Date.now() - at;
      at = Date.now();
      if (workspace) write(workspace, false, 'info', 'service.research.prepare.phase', `Service research preparation: ${step} (${(ms / 1000).toFixed(1)} s)`, { ...ctx, step, duration_ms: ms });
    },
  };
}

/** Run folder of the latest service run of an app (`apps/<id>/wsp/latest-service.txt`), or null. */
export function latestServiceRun(workspace: string, appId: string): string | null {
  try {
    return readFileSync(join(workspace, 'apps', appId, 'wsp', 'latest-service.txt'), 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

/** #4457: the LLM figures of one service run, from its `run-manifest.json` `llm` block. */
export interface ServiceRunLlm {
  costUsd: number;
  /** `llm.call_count` (0 when the manifest omits it: the field is written only above 0). */
  calls: number;
  /** `llm.model`, the assessment model of the run; null when not recorded. */
  model: string | null;
}

/** #4457: cost, call count and model of one service run; null without a readable manifest. */
export function serviceRunLlm(workspace: string, appId: string, run: string | null): ServiceRunLlm | null {
  if (!run) return null;
  try {
    const doc = JSON.parse(readFileSync(join(workspace, 'apps', appId, 'wsp', run, 'run-manifest.json'), 'utf-8')) as { llm?: { total_cost_usd?: unknown; call_count?: unknown; model?: unknown } };
    const cost = doc.llm?.total_cost_usd;
    const calls = doc.llm?.call_count;
    const model = doc.llm?.model;
    return {
      costUsd: typeof cost === 'number' && Number.isFinite(cost) ? cost : 0,
      calls: typeof calls === 'number' && Number.isInteger(calls) && calls >= 0 ? calls : 0,
      model: typeof model === 'string' && model.trim() !== '' ? model.trim() : null,
    };
  } catch {
    return null;
  }
}

/** Total LLM cost of one service run (`run-manifest.json` `llm.total_cost_usd`); null when unknown. */
export function serviceRunCostUsd(workspace: string, appId: string, run: string | null): number | null {
  return serviceRunLlm(workspace, appId, run)?.costUsd ?? null;
}

/**
 * #4457: the LLM fields of a batch progress line for the run an app child just
 * wrote (`after` differs from `before`): cost, call count and model; all null
 * when the child wrote no new run.
 */
export function serviceRunLlmFields(workspace: string, appId: string, before: string | null, after: string | null): Pick<ServiceBatchAppResult, 'costUsd' | 'llmCalls' | 'model'> {
  const llm = after && after !== before ? serviceRunLlm(workspace, appId, after) : null;
  return { costUsd: llm ? llm.costUsd : null, llmCalls: llm ? llm.calls : null, model: llm ? llm.model : null };
}

export type ServiceBatchAppStatus = 'ok' | 'failed' | 'skipped';

export interface ServiceBatchAppResult {
  appId: string;
  status: ServiceBatchAppStatus;
  exitCode: number | null;
  durationMs: number;
  /** LLM cost of the app's run; null when the run wrote no manifest. */
  costUsd: number | null;
  /** #4457: LLM calls of the app's run (manifest `llm.call_count`); null or absent when unknown. */
  llmCalls?: number | null;
  /** #4457: assessment model of the app's run (manifest `llm.model`), the unit of the per-model cost estimate. */
  model?: string | null;
  reason?: string;
}

/** The batch log of one service assessment. Exactly one start, one progress per app, one complete or cancel. */
export class ServiceAssessBatchLog {
  private readonly startedAt = Date.now();
  private readonly results: ServiceBatchAppResult[] = [];
  private closed = false;

  constructor(
    private readonly workspace: string,
    private readonly apps: readonly string[],
    private readonly opts: { selection: string; caller: string; mirror?: boolean },
  ) {
    write(workspace, this.mirror, 'info', 'service.assess.batch.start', `Service assessment batch started: ${apps.length} app(s) (${opts.selection})`, {
      apps_total: apps.length, selection: opts.selection, caller: opts.caller,
    });
  }

  private get mirror(): boolean { return this.opts.mirror ?? true; }

  /** One app finished (or was skipped); logs its progress line. */
  progress(r: ServiceBatchAppResult): void {
    this.results.push(r);
    const index = this.results.length;
    write(this.workspace, this.mirror, r.status === 'failed' ? 'warn' : 'info', 'service.assess.batch.progress',
      `Service assessment ${index}/${this.apps.length}: ${r.appId} ${r.status}${r.reason ? ` (${r.reason})` : ''}`, {
        index, total: this.apps.length, app_id: r.appId, status: r.status, exit_code: r.exitCode, duration_ms: r.durationMs,
        ...(r.costUsd !== null ? { cost_usd: roundCostUsd(r.costUsd) } : {}),
        ...(r.llmCalls !== undefined && r.llmCalls !== null ? { llm_calls: r.llmCalls } : {}),
        ...(r.model ? { model: r.model } : {}),
        ...(r.reason ? { reason: r.reason } : {}),
      });
  }

  private totals(): Record<string, unknown> {
    const count = (s: ServiceBatchAppStatus): number => this.results.filter((r) => r.status === s).length;
    const cost = this.results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
    return {
      apps_total: this.apps.length, ok: count('ok'), failed: count('failed'), skipped: count('skipped'),
      duration_ms: Date.now() - this.startedAt, cost_usd: roundCostUsd(cost), llm_calls: this.llmCalls(), caller: this.opts.caller,
    };
  }

  /** #4457: LLM calls of the app runs finished so far (manifest call counts). */
  private llmCalls(): number {
    return this.results.reduce((sum, r) => sum + (r.llmCalls ?? 0), 0);
  }

  /** #4301: counts and cost of the apps finished so far, for assess.service.complete; #4457: and their LLM calls. */
  summary(): { ok: number; failed: number; skipped: number; costUsd: number; llmCalls: number } {
    const count = (st: ServiceBatchAppStatus): number => this.results.filter((r) => r.status === st).length;
    return { ok: count('ok'), failed: count('failed'), skipped: count('skipped'), costUsd: roundCostUsd(this.results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)), llmCalls: this.llmCalls() };
  }

  /** The batch ran to the end. */
  complete(): void {
    if (this.closed) return;
    this.closed = true;
    const t = this.totals();
    write(this.workspace, this.mirror, (t['failed'] as number) > 0 ? 'warn' : 'info', 'service.assess.batch.complete',
      `Service assessment batch complete: ${t['ok']} ok, ${t['failed']} failed, ${t['skipped']} skipped of ${this.apps.length}`, t);
  }

  /** The operator cancelled; logs the last completed index instead of a completion. */
  cancel(): void {
    if (this.closed) return;
    this.closed = true;
    write(this.workspace, this.mirror, 'warn', 'service.assess.batch.cancel',
      `Service assessment batch cancelled after ${this.results.length} of ${this.apps.length} app(s)`, {
        ...this.totals(), last_completed_index: this.results.length,
        ...(this.results.length > 0 ? { last_completed_app: this.results[this.results.length - 1]!.appId } : {}),
      });
  }
}

/**
 * #4270: before a research run, the expected LLM calls and cost (the rule of the
 * TUI confirmation, #4236: cached topics make no call). Logged at info; the
 * line says whether the estimate is above `service_portfolio.cost_confirm_usd`.
 * Nothing is logged when the run makes no LLM call.
 */
export function logResearchEstimate(workspace: string, opts: { model: string | null; appId?: string; mirror?: boolean }): void {
  let calls: number;
  let cached: number;
  try {
    // #4485 / #4497: One service reads the stubs of that app only and counts its cached topics.
    const c = cachedLlmResearch(workspace, new Date(), opts.appId ? { appId: opts.appId } : undefined);
    calls = c.topicsTotal - c.topicsCached;
    cached = c.topicsCached;
  } catch {
    return;
  }
  if (calls <= 0) return;
  // #4497: the price of the model from the workspace connector (connector file, discovery, bundled), else the table.
  const cost = callCost(opts.model, 'research', measuredCostsByModel(workspace), readServiceConnector(workspace));
  const usd = cost.usd === null ? null : roundCostUsd(calls * cost.usd);
  const threshold = readCostConfirmThreshold(workspace);
  write(workspace, opts.mirror ?? true, 'info', 'service.research.estimate',
    `Service research estimate: ${calls} LLM call(s), ${usd === null ? 'cost unknown' : `about ${usd.toFixed(2)} USD`}${usd !== null && usd > threshold ? ` (above the ${threshold} USD confirmation threshold)` : ''}`, {
      llm_calls_estimated: calls, llm_topics_cached: cached, model: opts.model, cost_usd_estimated: usd,
      cost_basis: cost.basis, threshold_usd: threshold, above_threshold: usd !== null && usd > threshold,
    });
}

/**
 * #4273 (Design 098 component observability): screen-level events of the TUI
 * Service Portfolio Assessment, analogous to assess.app.*: assess.service.start
 * when the operator confirms a run (pipeline or single-stage re-run) and
 * assess.service.complete when it finishes, with the outcome and duration.
 * The batch events above cover the assessment stage only, so the two pairs
 * never fire in the same moment. Never mirrored to the console (Ink frame).
 */
const screenRuns = new Map<string, { startedAt: number; run: string }>();

export function logServiceScreenStart(workspace: string, context: { run: string; scope?: string; apps?: number | null }): void {
  screenRuns.set(workspace, { startedAt: Date.now(), run: context.run });
  write(workspace, false, 'info', 'assess.service.start', `Service Portfolio Assessment started (${context.run})`, { ...context });
}

/**
 * #4301: what a TUI service run produced, collected by the screen: the apps of
 * the import, the research batch (its own `service.research.complete` event,
 * readServiceResearchFacts) and the assessment batch (ServiceAssessBatchLog
 * summary). Every field is optional: a re-run of one stage fills only its own.
 */
export interface ServiceRunFacts {
  appsImported?: number;
  research?: { appsOk: number; appsFailed: number; llmCalls: number; costUsd: number };
  /** #4457: `llmCalls`, the calls of the app runs (manifest call counts). */
  assess?: { ok: number; failed: number; costUsd: number; llmCalls?: number };
}

/** `85 min`, or `40 s` under a minute. */
function shortDuration(ms: number): string {
  return ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;
}

/** The outcome text without its final full stop (it ends the sentence of the event message). */
function clause(text: string): string {
  const t = text.trim();
  return t.endsWith('.') ? t.slice(0, -1) : t;
}

export function logServiceScreenComplete(workspace: string, outcome: { ok: boolean; text: string }, facts: ServiceRunFacts = {}): void {
  const open = screenRuns.get(workspace);
  if (!open) return;
  screenRuns.delete(workspace);
  const durationMs = Date.now() - open.startedAt;
  const assessed = facts.assess ? facts.assess.ok + facts.assess.failed : undefined;
  const apps = facts.appsImported ?? assessed ?? (facts.research ? facts.research.appsOk + facts.research.appsFailed : undefined);
  const cost = facts.research || facts.assess ? roundCostUsd((facts.research?.costUsd ?? 0) + (facts.assess?.costUsd ?? 0)) : undefined;
  // #4457: llm_calls counts research and assessment (the sum of the app runs).
  const llmCalls = facts.research || facts.assess ? (facts.research?.llmCalls ?? 0) + (facts.assess?.llmCalls ?? 0) : undefined;
  // #4301: one sentence; the outcome text only when the run did not complete (it names why).
  // #4457: with an import, the sentence names the imported and the assessed count
  // ("234 apps imported, 1 assessed"), so a one-app run never reads as a 234-app run.
  const count = facts.appsImported !== undefined && assessed !== undefined
    ? `${facts.appsImported} apps imported, ${assessed} assessed`
    : apps !== undefined ? `${apps} apps` : null;
  const what = [count, shortDuration(durationMs)].filter(Boolean).join(', ');
  const message = outcome.ok
    ? `Service Portfolio Assessment complete (${open.run}): ${what}`
    : `Service Portfolio Assessment ended (${open.run}) after ${shortDuration(durationMs)}: ${clause(outcome.text)}`;
  write(workspace, false, outcome.ok ? 'info' : 'warn', 'assess.service.complete', message, {
    run: open.run, ok: outcome.ok, exit_code: outcome.ok ? 0 : 1, duration_ms: durationMs,
    ...(facts.appsImported !== undefined ? { apps_imported: facts.appsImported } : {}),
    ...(facts.research ? { apps_researched: facts.research.appsOk, apps_research_failed: facts.research.appsFailed, llm_calls_research: facts.research.llmCalls } : {}),
    ...(facts.assess ? { apps_assessed: facts.assess.ok, apps_failed: facts.assess.failed, llm_calls_assess: facts.assess.llmCalls ?? 0 } : {}),
    ...(llmCalls !== undefined ? { llm_calls: llmCalls } : {}),
    ...(cost !== undefined ? { cost_usd: cost } : {}),
  });
}

/**
 * #4301: the facts of the research child's own `service.research.complete`
 * event (counts, LLM calls, cost), the newest one written at or after
 * `sinceMs` in the portfolio log of the workspace. Null when there is none.
 * `llm_calls` there counts the research calls; the per-app assessment calls
 * are in each run manifest.
 */
export function readServiceResearchFacts(workspace: string, sinceMs: number, now: Date = new Date()): ServiceRunFacts['research'] | null {
  const months = [...new Set([new Date(sinceMs), now].map((d) => d.toISOString().slice(0, 7)))];
  for (const month of months.reverse()) {
    let lines: string[];
    try { lines = readFileSync(join(workspace, 'wsp', 'logs', `portfolio-events-${month}.ndjson`), 'utf-8').split('\n'); } catch { continue; }
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!;
      if (!line.includes('"service.research.complete"')) continue;
      let ev: { ts?: unknown; code?: unknown; context?: Record<string, unknown> };
      try { ev = JSON.parse(line) as typeof ev; } catch { continue; }
      if (ev.code !== 'service.research.complete' || typeof ev.ts !== 'string' || Date.parse(ev.ts) < sinceMs) continue;
      const c = ev.context ?? {};
      const num = (k: string): number => (typeof c[k] === 'number' ? (c[k] as number) : 0);
      return { appsOk: num('apps_ok'), appsFailed: num('apps_failed'), llmCalls: num('llm_calls'), costUsd: num('cost_usd') };
    }
  }
  return null;
}

/** #4457: a pipeline step logs a progress line at this interval while it runs. */
export const PIPELINE_STEP_PROGRESS_MS = 15_000;

/** #4457: the steps of the TUI Service Portfolio Assessment pipeline. */
export type ServicePipelineStep = 'scaffold' | 'discover' | 'research' | 'rank' | 'assess' | 'export';

/** Operator wording of each step, for the event messages and the run screen. */
export const PIPELINE_STEP_LABEL: Readonly<Record<ServicePipelineStep, string>> = {
  scaffold: 'scaffold the service apps',
  discover: 'list the service apps',
  research: 'research the service apps',
  rank: 'rank the service apps',
  assess: 'assess the chosen apps',
  export: 'export the portfolio workbook and star schema',
};

/**
 * #4457 (Design 103 section 3.6): start, progress and complete events of each
 * pipeline step, written by the TUI parent, whose event loop stays free while a
 * child runs: `service.pipeline.step.start`, `service.pipeline.step.progress`
 * every PIPELINE_STEP_PROGRESS_MS with the elapsed time, and
 * `service.pipeline.step.complete` with the duration and the outcome. A step
 * that never started a child (an in-process step) still gets start and
 * complete. `setTimer` is injectable for tests.
 */
export class ServicePipelineStepLog {
  private open: { step: ServicePipelineStep; startedAt: number; timer: ReturnType<typeof setInterval> | null; context: Record<string, unknown> } | null = null;

  constructor(
    private readonly workspace: string,
    private readonly opts: { run: string; mirror?: boolean; intervalMs?: number; now?: () => number; setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>; clearTimer?: (t: ReturnType<typeof setInterval>) => void },
  ) {}

  private get now(): number { return (this.opts.now ?? Date.now)(); }

  /** Starts a step (completing an open one first, as `ok`). */
  start(step: ServicePipelineStep, context: Record<string, unknown> = {}): void {
    if (this.open) this.complete('ok');
    const startedAt = this.now;
    const setTimer = this.opts.setTimer ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
    const timer = setTimer(() => this.progress(), this.opts.intervalMs ?? PIPELINE_STEP_PROGRESS_MS);
    (timer as { unref?: () => void }).unref?.();
    this.open = { step, startedAt, timer, context };
    write(this.workspace, this.opts.mirror ?? false, 'info', 'service.pipeline.step.start', `Service pipeline step started: ${PIPELINE_STEP_LABEL[step]}`, {
      run: this.opts.run, step, ...context,
    });
  }

  /** The progress line of the open step (called by the timer). */
  progress(): void {
    const o = this.open;
    if (!o) return;
    const elapsed = this.now - o.startedAt;
    write(this.workspace, this.opts.mirror ?? false, 'info', 'service.pipeline.step.progress', `Service pipeline step running: ${PIPELINE_STEP_LABEL[o.step]} (${shortDuration(elapsed)})`, {
      run: this.opts.run, step: o.step, elapsed_ms: elapsed, ...o.context,
    });
  }

  /** Completes the open step; no-op when none is open. */
  complete(status: 'ok' | 'failed' | 'cancelled', context: Record<string, unknown> = {}): void {
    const o = this.open;
    if (!o) return;
    this.open = null;
    if (o.timer !== null) (this.opts.clearTimer ?? clearInterval)(o.timer);
    const durationMs = this.now - o.startedAt;
    write(this.workspace, this.opts.mirror ?? false, status === 'ok' ? 'info' : 'warn', 'service.pipeline.step.complete',
      `Service pipeline step ${status === 'ok' ? 'complete' : status}: ${PIPELINE_STEP_LABEL[o.step]} (${shortDuration(durationMs)})`, {
        run: this.opts.run, step: o.step, status, duration_ms: durationMs, ...o.context, ...context,
      });
  }

  /** The open step, or null. */
  get current(): ServicePipelineStep | null { return this.open?.step ?? null; }
}
