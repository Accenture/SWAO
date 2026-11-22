// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4270: service research writes batch and per-app events, LLM calls carry
// caller and app id, and the per-app cost adds up to the batch cost and to
// the cost of the provider ok events.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Ev = { level: string; code: string; context: Record<string, unknown> };
const events: Ev[] = [];
vi.mock('@swao/core', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@swao/core')>();
  return {
    ...orig,
    logPortfolioAt: (_root: string, level: string, code: string, _msg: string, opts: { context?: Record<string, unknown> } = {}) => {
      events.push({ level, code, context: opts.context ?? {} });
    },
  };
});

const { llmCallContextFields, recordLlmCallUsage } = await import('@swao/core');
const { runServiceInit } = await import('../scaffold/init.js');
const { tier2Dir } = await import('../catalog/infra-cat.js');
const { runServiceResearch } = await import('../research/research.js');
const { DEFAULT_HEADERS, DEFAULT_TEMPLATE_ROWS, TIER2_YAML, writeWorkbook } = await import('./fixtures/scaffold-fixture.js');
const { fakeClock, localOnlyFetch, startMockResearchServer } = await import('./fixtures/mock-research-server.js');
type ServiceResearchOptions = import('../research/research.js').ServiceResearchOptions;

const dirs: string[] = [];
let mock: Awaited<ReturnType<typeof startMockResearchServer>>;
beforeAll(async () => { mock = await startMockResearchServer(); });
afterAll(async () => {
  await mock.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
beforeEach(() => { events.length = 0; });

async function scaffoldedWorkspace(): Promise<string> {
  const ws = mkdtempSync(join(tmpdir(), 'swao-research-events-'));
  dirs.push(ws);
  writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
  mkdirSync(tier2Dir(ws), { recursive: true });
  writeFileSync(join(tier2Dir(ws), 'custom.yaml'), TIER2_YAML);
  const xlsx = join(ws, 'intake.xlsx');
  await writeWorkbook(xlsx, [{ name: 'Sheet1', headers: DEFAULT_HEADERS, rows: DEFAULT_TEMPLATE_ROWS }]);
  expect((await runServiceInit({ workspacePath: ws, intakePath: xlsx })).ok).toBe(true);
  return ws;
}

const opts = (ws: string, extra: Partial<ServiceResearchOptions> = {}): ServiceResearchOptions => ({
  workspacePath: ws, fetch: localOnlyFetch, clock: fakeClock(), baseUrls: mock.baseUrls, now: new Date('2026-10-10T08:00:00Z'), ...extra,
});

const ANSWER = JSON.stringify({ summary: 'Vendor profile.', findings: [{ statement: 'EU subsidiary', confidence: 'medium', sources: ['https://vendor.example/legal'] }] });

/**
 * A research LLM that behaves like the provider helper (requestLlmWithRetry):
 * it reads the caller context, logs a provider.llm.mock.ok event with it and
 * records the call's cost on the context.
 */
function costedLlm(costPerCall: number) {
  return {
    name: 'mock',
    model: 'mock-model',
    complete: async (): Promise<string> => {
      events.push({ level: 'info', code: 'provider.llm.mock.ok', context: { ...llmCallContextFields(), cost_usd: costPerCall } });
      recordLlmCallUsage(costPerCall);
      return ANSWER;
    },
  };
}

describe('service research events (#4270)', () => {
  it('writes one start, one complete and one per-app line; LLM events carry caller and app_id; costs add up', async () => {
    const ws = await scaffoldedWorkspace();
    const r = await runServiceResearch(opts(ws, { llm: costedLlm(0.0125) }));
    const codes = events.map((e) => e.code);
    expect(codes.filter((c) => c === 'service.research.start')).toHaveLength(1);
    expect(codes.filter((c) => c === 'service.research.complete')).toHaveLength(1);
    const perApp = events.filter((e) => e.code === 'service.research.app.complete');
    expect(perApp).toHaveLength(r.apps.length);
    expect(perApp.map((e) => e.context['index'])).toEqual(r.apps.map((_, i) => i + 1));

    const llm = events.filter((e) => e.code === 'provider.llm.mock.ok');
    expect(llm.length).toBeGreaterThan(0);
    for (const e of llm) {
      expect(String(e.context['caller'])).toMatch(/^service\.research\.(vendor-profile|certifications|data-residency|breach-history)$/);
      expect(typeof e.context['app_id']).toBe('string');
    }
    // Per app, the LLM calls belong to that app.
    for (const app of perApp) {
      const appId = app.context['app_id'];
      const calls = llm.filter((e) => e.context['app_id'] === appId);
      expect(app.context['llm_calls']).toBe(calls.length);
    }
    const okSum = llm.reduce((s, e) => s + (e.context['cost_usd'] as number), 0);
    const perAppSum = perApp.reduce((s, e) => s + (e.context['cost_usd'] as number), 0);
    expect(perAppSum).toBeCloseTo(okSum, 6);
    const done = events.find((e) => e.code === 'service.research.complete')!;
    expect(done.context).toMatchObject({ apps_total: r.apps.length, apps_ok: r.apps.length, apps_failed: 0, llm_calls: llm.length });
    expect(done.context['cost_usd'] as number).toBeCloseTo(okSum, 6);
    expect(typeof done.context['duration_ms']).toBe('number');
    expect(r.costUsd).toBeCloseTo(okSum, 6);
  });

  it('counts per topic why apps had nothing to look up (#4238: VirusTotal without a key is no_api_key)', async () => {
    const ws = await scaffoldedWorkspace();
    const r = await runServiceResearch(opts(ws));
    const done = events.find((e) => e.code === 'service.research.complete')!;
    const reasons = done.context['skipped_reasons'] as Record<string, Record<string, number>>;
    expect(reasons['virustotal']).toEqual({ no_api_key: r.apps.length });
    expect(reasons['vendor-profile']?.['no_llm_configured']).toBeGreaterThan(0);
    expect(r.skippedReasons?.['virustotal']).toEqual({ no_api_key: r.apps.length });
  });

  it('a failing app logs a warn line with app id and reason, and the batch continues', async () => {
    const ws = await scaffoldedWorkspace();
    // A research folder that is a file makes the first app's stub write fail.
    const first = (await import('../research/research.js')).discoverServiceApps(ws)[0]!.appId;
    mkdirSync(join(ws, 'apps', first, 'wsp', 'inputs'), { recursive: true });
    writeFileSync(join(ws, 'apps', first, 'wsp', 'inputs', 'research'), 'not a folder');
    const r = await runServiceResearch(opts(ws));
    const failed = events.filter((e) => e.code === 'service.research.app.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.level).toBe('warn');
    expect(failed[0]!.context).toMatchObject({ app_id: first, status: 'failed' });
    expect(String(failed[0]!.context['reason']).length).toBeGreaterThan(0);
    expect(r.failed?.map((f) => f.appId)).toEqual([first]);
    const done = events.find((e) => e.code === 'service.research.complete')!;
    expect(done.level).toBe('warn');
    expect(done.context).toMatchObject({ apps_failed: 1, apps_ok: r.apps.length });
    expect(r.apps.length).toBeGreaterThan(1);
  });
});

describe('service intake import events (#4270)', () => {
  it('writes exactly one start and one complete event with the counts, the relative source and the duration', async () => {
    await scaffoldedWorkspace();
    const start = events.filter((e) => e.code === 'service.intake.import.start');
    const done = events.filter((e) => e.code === 'service.intake.import.complete');
    expect(start).toHaveLength(1);
    expect(done).toHaveLength(1);
    expect(start[0]!.context['source']).toBe('intake.xlsx');
    expect(done[0]!.context).toMatchObject({ source: 'intake.xlsx', status: 'ok', apps_created: 16, apps_updated: 0, apps_skipped: 0, apps_rejected: 0 });
    expect(done[0]!.context['rows_read'] as number).toBeGreaterThanOrEqual(16);
    expect(typeof done[0]!.context['duration_ms']).toBe('number');
  });

  it('a refused import (second workbook) completes with status refused and the reason', async () => {
    const ws = await scaffoldedWorkspace();
    events.length = 0;
    const other = join(ws, 'other.xlsx');
    await writeWorkbook(other, [{ name: 'Sheet1', headers: DEFAULT_HEADERS, rows: DEFAULT_TEMPLATE_ROWS.slice(0, 2) }]);
    const res = await runServiceInit({ workspacePath: ws, intakePath: other });
    expect(res.ok).toBe(false);
    const done = events.filter((e) => e.code === 'service.intake.import.complete');
    expect(done).toHaveLength(1);
    expect(done[0]!.level).toBe('warn');
    expect(done[0]!.context).toMatchObject({ status: 'refused', reason: 'other_intake_source' });
  });
});

describe('service research preparation lines and One service (#4485)', () => {
  it('logs the preparation phases and prepare.complete with durations, in order, before service.research.start', async () => {
    const ws = await scaffoldedWorkspace();
    await runServiceResearch(opts(ws, { prepareStartedAt: Date.now() - 2_000 }));
    const codes = events.map((e) => e.code);
    const phases = events.filter((e) => e.code === 'service.research.prepare.phase');
    expect(phases.map((e) => e.context['step'])).toEqual(['read the service apps', 'load the infrastructure catalogue']);
    for (const p of phases) expect(typeof p.context['duration_ms']).toBe('number');
    const complete = events.find((e) => e.code === 'service.research.prepare.complete')!;
    // Counted from the caller's prepare.start (2 s earlier), not from runServiceResearch.
    expect(complete.context['duration_ms'] as number).toBeGreaterThanOrEqual(2_000);
    expect(codes.indexOf('service.research.prepare.phase')).toBeLessThan(codes.indexOf('service.research.prepare.complete'));
    expect(codes.indexOf('service.research.prepare.complete')).toBeLessThan(codes.indexOf('service.research.start'));
  });

  it('One service reads that app only: discoverServiceApps and cachedLlmResearch with appId', async () => {
    const ws = await scaffoldedWorkspace();
    const { discoverServiceApps, cachedLlmResearch } = await import('../research/research.js');
    const all = discoverServiceApps(ws);
    expect(all.length).toBeGreaterThan(1);
    const id = all[1]!.appId;
    // Another app with a broken .swao.yml must not matter for the one-app read.
    writeFileSync(join(ws, 'apps', all[0]!.appId, '.swao.yml'), 'assessment: [unclosed');
    expect(discoverServiceApps(ws, { appId: id }).map((a) => a.appId)).toEqual([id]);
    expect(discoverServiceApps(ws, { appId: 'no-such-app' })).toEqual([]);
    expect(cachedLlmResearch(ws, new Date(), { appId: id })).toMatchObject({ apps: 1, topicsTotal: 4 });
    const r = await runServiceResearch(opts(ws, { appId: id }));
    expect(r.apps.map((a) => a.appId)).toEqual([id]);
    expect(events.find((e) => e.code === 'service.research.prepare.phase')!.context).toMatchObject({ app_filter: id, apps: 1 });
  });
});
