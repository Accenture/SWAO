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

// #4273: a service assessment of N apps writes one batch start, N progress
// lines and one batch complete (or cancel) in the workspace portfolio log;
// the TUI screen pair assess.service.start / complete. #4270: the research
// estimate line.

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runServiceAssessCli } from './service.js';
import { logResearchEstimate, researchPrepareLog, logServiceScreenComplete, logServiceScreenStart, PIPELINE_STEP_PROGRESS_MS, readServiceResearchFacts, ServiceAssessBatchLog, ServicePipelineStepLog, serviceRunCostUsd, serviceRunLlm, serviceRunLlmFields } from './service-batch-log.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function svcWorkspace(yml = 'wsp_version: "0.9"\n', ids = ['hosapp001', 'hosapp002', 'hosapp003']): string {
  const dir = mkdtempSync(join(tmpdir(), 'swao-svc-batch-'));
  dirs.push(dir);
  writeFileSync(join(dir, '.swao.yml'), yml);
  for (const id of ids) {
    mkdirSync(join(dir, 'apps', id), { recursive: true });
    writeFileSync(join(dir, 'apps', id, '.swao.yml'), `app_id: ${id}\napp_name: ${id}\nassessment:\n  type: service\n`);
  }
  return dir;
}

type Ev = { level: string; code: string; message: string; context: Record<string, unknown> };
function events(ws: string): Ev[] {
  const dir = join(ws, 'wsp', 'logs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.startsWith('portfolio-events-')).flatMap((f) =>
    readFileSync(join(dir, f), 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Ev));
}

/** A fake `swao assess` child: writes a run folder with a manifest cost (and #4457 calls and model), exits with `code`. */
function fakeRun(ws: string, codes: Record<string, number>, cost = 0.5, llm: { call_count?: number; model?: string } = {}) {
  return (args: string[]): number => {
    const id = args[2]!;
    const run = `runs/2026-11-10T00-00-0${Object.keys(codes).indexOf(id) + 1}`;
    mkdirSync(join(ws, 'apps', id, 'wsp', run), { recursive: true });
    writeFileSync(join(ws, 'apps', id, 'wsp', run, 'run-manifest.json'), JSON.stringify({ llm: { total_cost_usd: cost, ...llm } }));
    writeFileSync(join(ws, 'apps', id, 'wsp', 'latest-service.txt'), run);
    return codes[id] ?? 0;
  };
}

describe('service assessment batch events (#4273)', () => {
  it('N apps: exactly one start, N progress lines and one complete with ok, failed, duration and cost', () => {
    const ws = svcWorkspace();
    const r = runServiceAssessCli({ workspace: ws, top: '3' }, fakeRun(ws, { hosapp001: 0, hosapp002: 1, hosapp003: 0 }), () => {});
    expect(r.failed).toHaveLength(1);
    const ev = events(ws);
    expect(ev.filter((e) => e.code === 'service.assess.batch.start')).toHaveLength(1);
    expect(ev.find((e) => e.code === 'service.assess.batch.start')!.context).toMatchObject({ apps_total: 3, caller: 'cli.service.assess' });
    const progress = ev.filter((e) => e.code === 'service.assess.batch.progress');
    expect(progress).toHaveLength(3);
    expect(progress.map((e) => e.context['index'])).toEqual([1, 2, 3]);
    const failed = progress.find((e) => e.context['status'] === 'failed')!;
    expect(failed.level).toBe('warn');
    expect(failed.context).toMatchObject({ app_id: r.failed[0], exit_code: 1 });
    expect(String(failed.context['reason'])).toMatch(/exited with code 1/);
    const done = ev.filter((e) => e.code === 'service.assess.batch.complete');
    expect(done).toHaveLength(1);
    expect(done[0]!.context).toMatchObject({ apps_total: 3, ok: 2, failed: 1, skipped: 0, cost_usd: 1.5 });
    expect(typeof done[0]!.context['duration_ms']).toBe('number');
  });

  it('a cancelled batch logs a cancel line with the last completed index instead of a completion', () => {
    const ws = svcWorkspace();
    const batch = new ServiceAssessBatchLog(ws, ['hosapp001', 'hosapp002', 'hosapp003'], { selection: 'test', caller: 'tui.service', mirror: false });
    batch.progress({ appId: 'hosapp001', status: 'ok', exitCode: 0, durationMs: 5, costUsd: null });
    batch.cancel();
    batch.complete();
    const ev = events(ws);
    expect(ev.filter((e) => e.code === 'service.assess.batch.complete')).toHaveLength(0);
    const cancel = ev.filter((e) => e.code === 'service.assess.batch.cancel');
    expect(cancel).toHaveLength(1);
    expect(cancel[0]!.context).toMatchObject({ last_completed_index: 1, last_completed_app: 'hosapp001', ok: 1 });
  });

  it('the TUI screen pair: assess.service.start and assess.service.complete with the outcome', () => {
    const ws = svcWorkspace();
    logServiceScreenStart(ws, { run: 'pipeline', scope: 'top', apps: 3 });
    logServiceScreenComplete(ws, { ok: true, text: 'Service Portfolio Assessment complete.' });
    logServiceScreenComplete(ws, { ok: true, text: 'second call writes nothing' });
    const ev = events(ws);
    expect(ev.filter((e) => e.code === 'assess.service.start')).toHaveLength(1);
    const done = ev.filter((e) => e.code === 'assess.service.complete');
    expect(done).toHaveLength(1);
    expect(done[0]!.context).toMatchObject({ run: 'pipeline', ok: true, exit_code: 0 });
  });

  it('#4301: assess.service.complete carries apps imported, researched, assessed, failed, llm_calls and cost in one sentence', () => {
    const ws = svcWorkspace();
    logServiceScreenStart(ws, { run: 'pipeline', scope: 'all', apps: 234 });
    logServiceScreenComplete(ws, { ok: true, text: 'Service Portfolio Assessment complete.' }, {
      appsImported: 234,
      research: { appsOk: 230, appsFailed: 4, llmCalls: 772, costUsd: 5.933463 },
      assess: { ok: 233, failed: 1, costUsd: 1.5 },
    });
    const done = events(ws).filter((e) => e.code === 'assess.service.complete');
    expect(done).toHaveLength(1);
    expect(Object.keys(done[0]!.context).sort()).toEqual([
      'apps_assessed', 'apps_failed', 'apps_imported', 'apps_research_failed', 'apps_researched', 'cost_usd', 'duration_ms', 'exit_code', 'llm_calls', 'llm_calls_assess', 'llm_calls_research', 'ok', 'run',
    ]);
    expect(done[0]!.context).toMatchObject({ apps_imported: 234, apps_researched: 230, apps_research_failed: 4, apps_assessed: 233, apps_failed: 1, llm_calls: 772, llm_calls_research: 772, llm_calls_assess: 0 });
    expect(done[0]!.context['cost_usd'] as number).toBeCloseTo(7.4335, 3);
    // One sentence, no repeated text; #4457: the imported and the assessed count.
    expect(done[0]!.message).toMatch(/^Service Portfolio Assessment complete \(pipeline\): 234 apps imported, 234 assessed, \d+ s$/);
    expect(done[0]!.message.split('Service Portfolio Assessment')).toHaveLength(2);
  });

  it('#4301: an ended run names the reason once; a re-run carries only its own stage', () => {
    const ws = svcWorkspace();
    logServiceScreenStart(ws, { run: 're-run research' });
    logServiceScreenComplete(ws, { ok: false, text: 'Research exited with code 1.' }, { research: { appsOk: 2, appsFailed: 1, llmCalls: 8, costUsd: 0.1 } });
    const done = events(ws).filter((e) => e.code === 'assess.service.complete')[0]!;
    expect(done.level).toBe('warn');
    expect(done.message).toMatch(/^Service Portfolio Assessment ended \(re-run research\) after \d+ s: Research exited with code 1$/);
    expect(done.context).toMatchObject({ ok: false, exit_code: 1, apps_researched: 2, llm_calls: 8, cost_usd: 0.1 });
    expect(done.context['apps_imported']).toBeUndefined();
    expect(done.context['apps_assessed']).toBeUndefined();
  });

  it('#4301: readServiceResearchFacts reads the newest service.research.complete since the stage start', () => {
    const ws = svcWorkspace();
    const logs = join(ws, 'wsp', 'logs');
    mkdirSync(logs, { recursive: true });
    const line = (ts: string, calls: number) => JSON.stringify({ ts, level: 'info', scope: 'portfolio', code: 'service.research.complete', message: 'x', context: { apps_ok: 3, apps_failed: 0, llm_calls: calls, cost_usd: 0.25 } });
    writeFileSync(join(logs, 'portfolio-events-2026-11.ndjson'), [line('2026-11-10T10:00:00Z', 1), '{broken', line('2026-11-10T11:00:00Z', 12), ''].join('\n'));
    const now = new Date('2026-11-10T12:00:00Z');
    expect(readServiceResearchFacts(ws, Date.parse('2026-11-10T10:30:00Z'), now)).toEqual({ appsOk: 3, appsFailed: 0, llmCalls: 12, costUsd: 0.25 });
    expect(readServiceResearchFacts(ws, Date.parse('2026-11-10T11:30:00Z'), now)).toBeNull();
  });

  it('#4457: a One service run counts the LLM calls of research and assessment and names the assessed count', () => {
    const ws = svcWorkspace();
    logServiceScreenStart(ws, { run: 'pipeline', scope: 'one', apps: 234 });
    // The owner run of 2026-11-15: research skipped (0 calls), one app assessed with 8 calls.
    logServiceScreenComplete(ws, { ok: true, text: 'Service Portfolio Assessment complete.' }, {
      appsImported: 234,
      research: { appsOk: 1, appsFailed: 0, llmCalls: 0, costUsd: 0 },
      assess: { ok: 1, failed: 0, costUsd: 1.47192, llmCalls: 8 },
    });
    const done = events(ws).filter((e) => e.code === 'assess.service.complete')[0]!;
    expect(done.context).toMatchObject({ llm_calls: 8, llm_calls_research: 0, llm_calls_assess: 8, apps_imported: 234, apps_assessed: 1 });
    expect(done.message).toMatch(/^Service Portfolio Assessment complete \(pipeline\): 234 apps imported, 1 assessed, \d+ s$/);
  });

  it('#4457: the batch progress lines carry llm_calls and model from the run manifest; complete and summary sum the calls', () => {
    const ws = svcWorkspace();
    runServiceAssessCli({ workspace: ws, top: '3' }, fakeRun(ws, { hosapp001: 0, hosapp002: 0, hosapp003: 0 }, 0.5, { call_count: 8, model: 'claude-opus-4-7' }), () => {});
    const ev = events(ws);
    const progress = ev.filter((e) => e.code === 'service.assess.batch.progress');
    expect(progress).toHaveLength(3);
    for (const p of progress) expect(p.context).toMatchObject({ llm_calls: 8, model: 'claude-opus-4-7', cost_usd: 0.5 });
    expect(ev.find((e) => e.code === 'service.assess.batch.complete')!.context).toMatchObject({ llm_calls: 24 });
    const batch = new ServiceAssessBatchLog(ws, ['a', 'b'], { selection: 'test', caller: 'tui.service', mirror: false });
    batch.progress({ appId: 'a', status: 'ok', exitCode: 0, durationMs: 1, costUsd: 1, llmCalls: 8, model: 'm' });
    batch.progress({ appId: 'b', status: 'failed', exitCode: 1, durationMs: 1, costUsd: null, llmCalls: null });
    expect(batch.summary()).toMatchObject({ ok: 1, failed: 1, llmCalls: 8 });
  });

  it('#4457: serviceRunLlm reads cost, call count and model; an omitted call_count is 0; no new run gives nulls', () => {
    const ws = svcWorkspace();
    fakeRun(ws, { hosapp001: 0 }, 0.25, { call_count: 8, model: 'claude-opus-4-7' })(['assess', '--app', 'hosapp001']);
    expect(serviceRunLlm(ws, 'hosapp001', 'runs/2026-11-10T00-00-01')).toEqual({ costUsd: 0.25, calls: 8, model: 'claude-opus-4-7' });
    fakeRun(ws, { hosapp002: 0 }, 0)(['assess', '--app', 'hosapp002']);
    expect(serviceRunLlm(ws, 'hosapp002', 'runs/2026-11-10T00-00-01')).toEqual({ costUsd: 0, calls: 0, model: null });
    expect(serviceRunLlmFields(ws, 'hosapp001', 'runs/2026-11-10T00-00-01', 'runs/2026-11-10T00-00-01')).toEqual({ costUsd: null, llmCalls: null, model: null });
    expect(serviceRunLlmFields(ws, 'hosapp001', null, 'runs/2026-11-10T00-00-01')).toEqual({ costUsd: 0.25, llmCalls: 8, model: 'claude-opus-4-7' });
  });

  it('serviceRunCostUsd reads the run manifest; null without one', () => {
    const ws = svcWorkspace();
    expect(serviceRunCostUsd(ws, 'hosapp001', null)).toBeNull();
    expect(serviceRunCostUsd(ws, 'hosapp001', 'runs/x')).toBeNull();
    fakeRun(ws, { hosapp001: 0 }, 0.25)(['assess', '--app', 'hosapp001']);
    expect(serviceRunCostUsd(ws, 'hosapp001', 'runs/2026-11-10T00-00-01')).toBe(0.25);
  });
});

describe('service research estimate (#4270)', () => {
  it('logs the expected LLM calls, the cost and whether it is above the confirmation threshold', () => {
    const ws = svcWorkspace('wsp_version: "0.9"\nservice_portfolio:\n  cost_confirm_usd: 0\n');
    logResearchEstimate(ws, { model: 'claude-opus-4-7' });
    const e = events(ws).find((x) => x.code === 'service.research.estimate')!;
    expect(e.context).toMatchObject({ llm_calls_estimated: 12, llm_topics_cached: 0, model: 'claude-opus-4-7', threshold_usd: 0 });
    expect(typeof e.context['cost_usd_estimated']).toBe('number');
    expect(e.context['above_threshold']).toBe(true);
  });

  it('#4374: pings and preflight calls never make the measured basis; research calls of the model do', () => {
    const ws = svcWorkspace();
    mkdirSync(join(ws, 'wsp', 'logs'), { recursive: true });
    const ok = (caller: string, cost: number): string => JSON.stringify({ level: 'info', code: 'provider.llm.anthropic.ok', context: { model: 'claude-sonnet-4-6', cost_usd: cost, caller } });
    const pings = Array.from({ length: 8 }, () => ok('health-check.llm_gateway.ping', 0.000318));
    writeFileSync(join(ws, 'wsp', 'logs', 'portfolio-events-2026-11.ndjson'), `${pings.join('\n')}\n`);
    logResearchEstimate(ws, { model: 'claude-sonnet-4-6' });
    expect(events(ws).filter((x) => x.code === 'service.research.estimate').at(-1)!.context['cost_basis']).toBe('price table');
    const research = Array.from({ length: 5 }, () => ok('service.research.certifications', 0.0077));
    writeFileSync(join(ws, 'wsp', 'logs', 'portfolio-events-2026-11.ndjson'), `${[...pings, ...research].join('\n')}\n`);
    logResearchEstimate(ws, { model: 'claude-sonnet-4-6' });
    const e = events(ws).filter((x) => x.code === 'service.research.estimate').at(-1)!;
    expect(e.context).toMatchObject({ cost_basis: 'measured', llm_calls_estimated: 12 });
    expect(e.context['cost_usd_estimated'] as number).toBeCloseTo(12 * 0.0077, 6);
  });
});

describe('One service research estimate and preparation lines (#4485, #4497)', () => {
  it('One service counts the cached topics of that app (unchanged topics no longer show as 0 cached)', () => {
    const ws = svcWorkspace();
    const dir = join(ws, 'apps', 'hosapp002', 'wsp', 'inputs', 'research');
    mkdirSync(dir, { recursive: true });
    const NL = String.fromCharCode(10);
    writeFileSync(join(ws, 'apps', 'hosapp002', '.swao.yml'), ['app_id: hosapp002', 'app_name: hosapp002', 'assessment:', '  type: service', 'vendor:', '  name: V', '  version: "1"', ''].join(NL));
    for (const t of ['vendor-profile', 'certifications', 'data-residency']) {
      writeFileSync(join(dir, `${t}.md`), ['---', `topic: ${t}`, 'app_id: hosapp002', 'vendor_name: V', 'product_name: hosapp002', 'version: "1"', 'status: researched', 'llm:', `  fetched_at: "${new Date().toISOString()}"`, '---', 'body', ''].join(NL));
    }
    logResearchEstimate(ws, { model: 'claude-opus-4-7', appId: 'hosapp002' });
    const e = events(ws).find((x) => x.code === 'service.research.estimate')!;
    expect(e.context).toMatchObject({ llm_calls_estimated: 1, llm_topics_cached: 3 });
  });

  it('the preparation lines: prepare.start first, then a phase line with its duration', () => {
    const ws = svcWorkspace();
    const prep = researchPrepareLog(ws, 'hosapp001');
    prep.start();
    prep.phase('check the licence and the workspace');
    const ev = events(ws).filter((x) => x.code.startsWith('service.research.prepare.'));
    expect(ev.map((x) => x.code)).toEqual(['service.research.prepare.start', 'service.research.prepare.phase']);
    expect(ev[0]!.context).toMatchObject({ app_filter: 'hosapp001' });
    expect(ev[1]!.context).toMatchObject({ step: 'check the licence and the workspace' });
    expect(typeof ev[1]!.context['duration_ms']).toBe('number');
    researchPrepareLog(null, null).start();
  });
});

describe('service pipeline step events (#4457)', () => {
  it('each step logs start, a progress line every 15 s while it runs, and complete with the duration', () => {
    const ws = svcWorkspace();
    let t = 1_000_000;
    let tick: (() => void) | null = null;
    let cleared = 0;
    const steps = new ServicePipelineStepLog(ws, {
      run: 'pipeline', now: () => t,
      setTimer: (fn, ms) => { expect(ms).toBe(PIPELINE_STEP_PROGRESS_MS); tick = fn; return 1 as unknown as ReturnType<typeof setInterval>; },
      clearTimer: () => { cleared += 1; },
    });
    steps.start('research', { app_id: 'hosapp001' });
    expect(steps.current).toBe('research');
    t += 15_000; tick!();
    t += 15_000; tick!();
    t += 25_000;
    steps.complete('ok', { exit_code: 0 });
    // A new step completes the open one first; complete without an open step writes nothing.
    steps.start('export');
    t += 255_000; tick!();
    steps.start('rank');
    steps.complete('failed');
    steps.complete('ok');
    expect(cleared).toBe(3);
    const ev = events(ws).filter((e) => e.code.startsWith('service.pipeline.step.'));
    expect(ev.map((e) => `${e.code.replace('service.pipeline.step.', '')}:${e.context['step']}`)).toEqual([
      'start:research', 'progress:research', 'progress:research', 'complete:research',
      'start:export', 'progress:export', 'complete:export',
      'start:rank', 'complete:rank',
    ]);
    expect(ev[2]!.context).toMatchObject({ run: 'pipeline', elapsed_ms: 30_000, app_id: 'hosapp001' });
    expect(ev[3]!.context).toMatchObject({ status: 'ok', duration_ms: 55_000, exit_code: 0 });
    expect(ev[3]!.message).toBe('Service pipeline step complete: research the service apps (55 s)');
    expect(ev[5]!.message).toBe('Service pipeline step running: export the portfolio workbook and star schema (4 min)');
    expect(ev[8]!.level).toBe('warn');
    for (const e of ev) expect(e.message).not.toMatch(new RegExp(`--|${String.fromCharCode(0x2014)}|${String.fromCharCode(0x2013)}`));
  });
});
