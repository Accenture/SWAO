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

// #4236 (D-1): the cost estimate of the Service Portfolio Assessment confirmation.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump } from 'js-yaml';
import {
  DEFAULT_COST_CONFIRM_USD, MIN_MEASURED_RESEARCH_CALLS, TYPICAL_RESEARCH_SECONDS_PER_CALL, assessmentCost, callCost, cheaperModelLine,
  cheaperResearchModel, costConfirmationLines, estimateServiceRun, listedCallCost, measuredCostsByModel, readCostConfirmThreshold,
  readMeasuredBasis, readServiceModels, timeBasis, type AssessCost, type TimeBasis,
} from './service-run-estimate.js';
import { confirmKeyHints, planScope, serviceCostView, stageLabel } from './ServiceInitScreen.js';
import { formatKeyHints } from '@swao/tui-kit';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function ws(yml: Record<string, unknown> = {}): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-4236-'));
  dirs.push(d);
  writeFileSync(join(d, '.swao.yml'), dump({ wsp_version: '0.9', ...yml }));
  return d;
}
function logCalls(d: string, calls: Array<{ model: string; cost: number; caller?: string }>, extra: object[] = []): void {
  mkdirSync(join(d, 'wsp', 'logs'), { recursive: true });
  const lines = calls.map((c) => JSON.stringify({ ts: '2026-11-09T15:00:00Z', level: 'info', scope: 'portfolio', code: 'provider.llm.anthropic.ok', context: { provider: 'anthropic', model: c.model, tokens_in: 1000, tokens_out: 200, cost_usd: c.cost, ...(c.caller ? { caller: c.caller } : {}) } }));
  lines.push(JSON.stringify({ code: 'provider.llm.anthropic.start', context: { model: 'x', cost_usd: 99, caller: 'service.research.vendor-profile' } }));
  lines.push('not json');
  for (const e of extra) lines.push(JSON.stringify(e));
  writeFileSync(join(d, 'wsp', 'logs', 'portfolio-events-2026-11.ndjson'), `${lines.join('\n')}\n`);
}
const TOPICS = ['vendor-profile', 'certifications', 'data-residency', 'breach-history'];
const researchCalls = (model: string, cost: number, n: number): Array<{ model: string; cost: number; caller: string }> =>
  Array.from({ length: n }, (_, i) => ({ model, cost, caller: `service.research.${TOPICS[i % 4]}` }));

/**
 * #4374: the owner run of 2026-11-10 (workspace event mix and actuals): one Opus
 * preflight (tui.llm-assess.health-check, 0.002325 USD), Sonnet pings
 * (health-check.llm_gateway.ping, 0.000318 USD), challenge calls without a
 * research caller, a chat call, then research of 234 apps (772 calls, 5.93 USD,
 * 53.8 min) and an assessment of 3 apps (0.87 USD, 17.5 min).
 */
function ownerRunLog(d: string): void {
  logCalls(d, [
    { model: 'claude-opus-4-7', cost: 0.002325, caller: 'tui.llm-assess.health-check' },
    ...Array.from({ length: 8 }, () => ({ model: 'claude-sonnet-4-6', cost: 0.000318, caller: 'health-check.llm_gateway.ping' })),
    ...Array.from({ length: 5 }, () => ({ model: 'claude-sonnet-4-6', cost: 0.05378 })),
    { model: 'claude-haiku-4-5', cost: 0.001, caller: 'tui.chat' },
    ...researchCalls('claude-sonnet-4-6', 5.93 / 772, 772),
  ], [
    { code: 'service.research.complete', context: { apps_total: 234, apps_ok: 234, llm_calls: 772, cost_usd: 5.93, duration_ms: 53.8 * 60_000, dry_run: false } },
    { code: 'service.research.complete', context: { apps_total: 2, apps_ok: 2, llm_calls: 0, cost_usd: 0, duration_ms: 1000, dry_run: true } },
    ...[0.27, 0.29, 0.31].map((c, i) => ({ code: 'service.assess.batch.progress', context: { index: i + 1, total: 3, app_id: `app00${i}`, status: 'ok', duration_ms: (17.5 / 3) * 60_000, cost_usd: c, model: 'claude-sonnet-4-6' } })),
    { code: 'service.assess.batch.progress', context: { index: 4, total: 4, app_id: 'app009', status: 'failed', duration_ms: 1000, cost_usd: 5 } },
  ]);
}
function serviceApp(d: string, id: string, freshTopics: number): void {
  const r = join(d, 'apps', id, 'wsp', 'inputs', 'research');
  mkdirSync(r, { recursive: true });
  writeFileSync(join(d, 'apps', id, '.swao.yml'), dump({ app_id: id, app_name: id, assessment: { type: 'service' }, vendor: { name: 'V', version: '1' } }));
  const topics = ['vendor-profile', 'certifications', 'data-residency', 'breach-history'].slice(0, freshTopics);
  for (const t of topics) {
    writeFileSync(join(r, `${t}.md`), `---\n${dump({ topic: t, app_id: id, vendor_name: 'V', product_name: id, version: '1', status: 'researched', llm: { fetched_at: new Date().toISOString(), confidence: 'medium' } })}---\nbody\n`);
  }
}

describe('per-call cost (#4236)', () => {
  it('takes the measured mean cost_usd of earlier ok events per model', () => {
    // #4374: only calls with a service.research.* caller count.
    const d = ws();
    logCalls(d, [...researchCalls('claude-opus-4-7', 0.3, 3), ...researchCalls('claude-opus-4-7', 0.32, 3), { model: 'claude-opus-4-7', cost: 9, caller: 'tui.chat' }, { model: 'claude-opus-4-7', cost: 9 }]);
    const m = measuredCostsByModel(d);
    expect(m.get('claude-opus-4-7')!.samples).toBe(6);
    expect(m.get('claude-opus-4-7')!.mean).toBeCloseTo(0.31, 6);
    expect(m.has('x')).toBe(false);
    expect(callCost('claude-opus-4-7', 'research', m)).toEqual({ model: 'claude-opus-4-7', usd: m.get('claude-opus-4-7')!.mean, basis: 'measured', samples: 6 });
  });

  it('#4374: a mean replaces the price table only from MIN_MEASURED_RESEARCH_CALLS samples; assessment calls are never measured per call', () => {
    const few = new Map([['claude-sonnet-4-6', { mean: 0.001, samples: MIN_MEASURED_RESEARCH_CALLS - 1 }]]);
    expect(callCost('claude-sonnet-4-6', 'research', few)).toMatchObject({ basis: 'price table', usd: listedCallCost('claude-sonnet-4-6', 'research') });
    const many = new Map([['claude-sonnet-4-6', { mean: 0.001, samples: MIN_MEASURED_RESEARCH_CALLS }]]);
    expect(callCost('claude-sonnet-4-6', 'research', many)).toMatchObject({ basis: 'measured', usd: 0.001 });
    expect(callCost('claude-sonnet-4-6', 'assessment', many).basis).toBe('price table');
  });

  it('falls back to the price table with a typical call size, else unknown', () => {
    const listed = listedCallCost('claude-haiku-4-5', 'research')!;
    expect(listed).toBeCloseTo((3000 * 1 + 800 * 5) / 1_000_000, 9);
    expect(callCost('claude-haiku-4-5', 'research', new Map())).toMatchObject({ basis: 'price table', usd: listed });
    expect(callCost('gateway-model-x', 'assessment', new Map())).toEqual({ model: 'gateway-model-x', usd: null, basis: 'unknown' });
    expect(callCost(null, 'assessment', new Map()).basis).toBe('unknown');
  });

  it('#4374: offers only a model with a lower price-table cost; Opus is never cheaper, even with tiny measured costs', () => {
    const m = new Map([['claude-opus-4-7', { mean: 0.0001, samples: 10 }]]);
    expect(cheaperResearchModel(callCost('claude-sonnet-4-6', 'research', m), m)).toMatchObject({ model: 'claude-haiku-4-5', basis: 'price table' });
    expect(cheaperResearchModel(callCost('claude-haiku-4-5', 'research', m), m)).toBeNull();
    // A model without a price is never offered, nor is anything for an unpriced current model.
    const unpriced = new Map([['tiny', { mean: 0.0001, samples: 30 }]]);
    expect(cheaperResearchModel(callCost('claude-sonnet-4-6', 'research', unpriced), unpriced)?.model).toBe('claude-haiku-4-5');
    expect(cheaperResearchModel(callCost('tiny', 'research', unpriced), unpriced)).toBeNull();
  });

  it('#4374: scales the measured cost of the configured model by the price-table ratio for an unmeasured cheaper model', () => {
    const m = new Map([['claude-sonnet-4-6', { mean: 0.00769, samples: 772 }]]);
    const c = cheaperResearchModel(callCost('claude-sonnet-4-6', 'research', m), m)!;
    const ratio = listedCallCost('claude-haiku-4-5', 'research')! / listedCallCost('claude-sonnet-4-6', 'research')!;
    expect(c).toMatchObject({ model: 'claude-haiku-4-5', basis: 'scaled', scaledFrom: 'claude-sonnet-4-6', samples: 772 });
    expect(c.usd!).toBeCloseTo(0.00769 * ratio, 9);
    expect(cheaperModelLine(c)).toBe(`Cheaper research model available: claude-haiku-4-5, ${c.usd!.toFixed(4)} USD per call from claude-sonnet-4-6 measured over 772 research call(s), scaled by the price table; Tab switches to it`);
  });
});

describe('owner run event mix (#4374)', () => {
  it('research mean from research calls only; time and assessment from the service run events', () => {
    const d = ws();
    ownerRunLog(d);
    const b = readMeasuredBasis(d);
    expect([...b.researchByModel.keys()]).toEqual(['claude-sonnet-4-6']);
    expect(b.researchByModel.get('claude-sonnet-4-6')!.samples).toBe(772);
    expect(b.researchByModel.get('claude-sonnet-4-6')!.mean).toBeCloseTo(5.93 / 772, 9);
    expect(b.researchTime!.calls).toBe(772);
    expect(b.researchTime!.secondsPerCall).toBeCloseTo((53.8 * 60) / 772, 6);
    expect(b.assessPerApp!.samples).toBe(3);
    expect(b.assessPerApp!.usd).toBeCloseTo(0.29, 6);
    expect(b.assessPerApp!.minutes).toBeCloseTo(17.5 / 3, 6);
  });

  it('a Sonnet workspace with this mix offers Haiku, never Opus, and takes every figure from the service run', () => {
    const d = ws({ providers: { llm: { primary: { type: 'anthropic', model: 'claude-sonnet-4-6' } } } });
    for (let i = 0; i < 4; i++) serviceApp(d, `app00${i}`, 0);
    ownerRunLog(d);
    const plan = planScope('top', 4, { skipLlmResearch: false, topN: 3 });
    const v = serviceCostView(d, plan, null);
    expect(v.cheaper).toMatchObject({ model: 'claude-haiku-4-5', basis: 'scaled' });
    expect(v.estimate.research).toMatchObject({ model: 'claude-sonnet-4-6', basis: 'measured', samples: 772 });
    expect(v.estimate.assessment).toMatchObject({ basis: 'measured', samples: 3 });
    expect(v.estimate.assessUsd!).toBeCloseTo(0.87, 6);
    expect(v.estimate.time).toMatchObject({ researchMeasuredCalls: 772, assessMeasuredApps: 3 });
    const switched = serviceCostView(d, plan, 'claude-haiku-4-5');
    expect(switched.estimate.research).toMatchObject({ model: 'claude-haiku-4-5', basis: 'scaled' });
    expect(switched.estimate.researchUsd!).toBeLessThan(v.estimate.researchUsd!);
  });

  it('234 apps, Top 3: cost and time near the actuals (5.93 + 0.87 USD, 53.8 + 17.5 min), the basis on every figure', () => {
    const d = ws();
    ownerRunLog(d);
    const b = readMeasuredBasis(d);
    const e = estimateServiceRun({
      researchTopics: 936, cachedTopics: 0, assessCallsMin: 12, assessApps: 3,
      research: callCost('claude-sonnet-4-6', 'research', b.researchByModel), assessment: assessmentCost('claude-sonnet-4-6', b), time: timeBasis(b), thresholdUsd: 25,
    });
    // Upper bound of 936 calls at the measured 0.0077 USD: 7.19 USD against 5.93 actual (the old mean gave 27.31).
    expect(e.researchUsd!).toBeGreaterThan(5.93);
    expect(e.researchUsd!).toBeLessThan(5.93 * 1.3);
    expect(e.needsCostConfirmation).toBe(false);
    expect(e.researchMinutes).toBeCloseTo((936 * 53.8) / 772, 6);
    const lines = costConfirmationLines(e, { totalApps: 234, assessApps: 3, topRanking: true });
    expect(lines).toEqual([
      'Research ranks all 234 apps to pick the top 3',
      'Research: up to 936 LLM call(s), 0 of 936 topics from the cache (0 percent); 7.19 USD (claude-sonnet-4-6, 0.0077 USD per call measured over 772 research call(s))',
      'Assessment: 3 app(s); about 0.87 USD (claude-sonnet-4-6, 0.290 USD per app measured over 3 service assessment(s) with this model)',
      'Expected cost: about 8.06 USD',
      'Estimated time: about 83 min',
      'Research time: 65 min (936 call(s) x 4.2 s per call, measured over 772 research call(s))',
      'Assessment time: 18 min (3 app(s) x 6 min per app, measured over 3 service assessment(s))',
    ]);
    for (const l of lines) expect(l).not.toMatch(new RegExp(`--|${String.fromCharCode(0x2014)}|${String.fromCharCode(0x2013)}`));
  });

  it('an Opus workspace with only the preflight and pings uses the price table and offers a cheaper listed model', () => {
    const d = ws({ providers: { llm: { primary: { type: 'anthropic', model: 'claude-opus-4-7' } } } });
    serviceApp(d, 'app001', 0);
    logCalls(d, [{ model: 'claude-opus-4-7', cost: 0.002325, caller: 'tui.llm-assess.health-check' }, ...Array.from({ length: 8 }, () => ({ model: 'claude-sonnet-4-6', cost: 0.000318, caller: 'health-check.llm_gateway.ping' }))]);
    const v = serviceCostView(d, planScope('top', 1, { skipLlmResearch: false, topN: 1 }), null);
    expect(v.estimate.research).toMatchObject({ model: 'claude-opus-4-7', basis: 'price table' });
    expect(v.cheaper).toMatchObject({ model: 'claude-haiku-4-5', basis: 'price table' });
  });
});

describe('run estimate (#4236)', () => {
  const research = { model: 'r', usd: 0.035, basis: 'measured' as const, samples: 772 };
  const assessment: AssessCost = { model: 'a', basis: 'price table', usdPerApp: null, usdPerCall: 0.3 };
  const time: TimeBasis = { researchSecondsPerCall: TYPICAL_RESEARCH_SECONDS_PER_CALL, researchMeasuredCalls: null, assessMinutesPerApp: [3, 4], assessMeasuredApps: null };

  it('Top 10 of 234 apps: research for all apps minus the cache, assessment minimum, total, threshold and time', () => {
    const e = estimateServiceRun({ researchTopics: 936, cachedTopics: 236, assessCallsMin: 40, assessApps: 10, research, assessment, time, thresholdUsd: 25 });
    expect(e.researchCalls).toBe(700);
    expect(e.researchCached).toBe(236);
    expect(e.researchUsd).toBeCloseTo(24.5, 6);
    expect(e.assessUsd).toBeCloseTo(12, 6);
    expect(e.totalUsd).toBeCloseTo(36.5, 6);
    expect(e.needsCostConfirmation).toBe(true);
    const lines = costConfirmationLines(e, { totalApps: 234, assessApps: 10, topRanking: true });
    expect(lines[0]).toBe('Research ranks all 234 apps to pick the top 10');
    expect(lines[1]).toBe('Research: up to 700 LLM call(s), 236 of 936 topics from the cache (25 percent); 24.50 USD (r, 0.035 USD per call measured over 772 research call(s))');
    expect(lines[2]).toBe('Assessment: at least 40 LLM call(s); at least 12.00 USD (a, 0.300 USD per call from the price table (typical call size))');
    expect(lines[3]).toBe('Expected cost: about 36.50 USD');
    expect(lines.slice(4)).toEqual([
      'Estimated time: about 77 min to 87 min',
      'Research time: 47 min (700 call(s) x 4.0 s per call, typical value, not measured yet)',
      'Assessment time: 30 min to 40 min (10 app(s) x 3 to 4 min per app, typical value, not measured yet)',
    ]);
    for (const l of lines) expect(l).not.toMatch(new RegExp(`--|${String.fromCharCode(0x2014)}|${String.fromCharCode(0x2013)}`));
  });

  it('a fully cached run below the threshold needs no second confirmation; the cache never exceeds the topics', () => {
    const e = estimateServiceRun({ researchTopics: 40, cachedTopics: 60, assessCallsMin: 40, assessApps: 10, research, assessment, time, thresholdUsd: 25 });
    expect(e).toMatchObject({ researchCalls: 0, researchCached: 40, researchUsd: 0, researchMinutes: 0 });
    expect(e.needsCostConfirmation).toBe(false);
  });

  it('an unknown per-call cost shows unknown and does not ask twice', () => {
    const e = estimateServiceRun({ researchTopics: 8, cachedTopics: 0, assessCallsMin: 4, assessApps: 1, research: { model: null, usd: null, basis: 'unknown' }, assessment, time, thresholdUsd: 25 });
    expect(e.totalUsd).toBeNull();
    expect(e.needsCostConfirmation).toBe(false);
    expect(costConfirmationLines(e, { totalApps: 2, assessApps: 1, topRanking: false })).toContain('Expected cost: unknown (no price for a model)');
  });

  it('#4374: assessment per app needs three measured apps; fewer keep the price table and the typical time', () => {
    const two = { researchByModel: new Map(), researchTime: { secondsPerCall: 2, calls: 4 }, assessPerApp: { usd: 0.3, minutes: 6, samples: 2 }, assessPerAppByModel: new Map([['claude-sonnet-4-6', { usd: 0.3, minutes: 6, samples: 2 }]]), assessUnrecordedModel: 0 };
    expect(assessmentCost('claude-sonnet-4-6', two).basis).toBe('price table');
    expect(timeBasis(two)).toEqual({ researchSecondsPerCall: TYPICAL_RESEARCH_SECONDS_PER_CALL, researchMeasuredCalls: null, assessMinutesPerApp: [3, 4], assessMeasuredApps: null });
    const three = { ...two, assessPerApp: { usd: 0.3, minutes: 6, samples: 3 }, assessPerAppByModel: new Map([['claude-sonnet-4-6', { usd: 0.3, minutes: 6, samples: 3 }]]) };
    expect(assessmentCost('claude-sonnet-4-6', three)).toMatchObject({ basis: 'measured', usdPerApp: 0.3, samples: 3 });
    expect(timeBasis(three).assessMinutesPerApp).toEqual([6, 6]);
  });
});

describe('workspace settings and the confirmation view (#4236)', () => {
  it('threshold from service_portfolio.cost_confirm_usd, default 25', () => {
    expect(readCostConfirmThreshold(ws())).toBe(DEFAULT_COST_CONFIRM_USD);
    expect(readCostConfirmThreshold(ws({ service_portfolio: { cost_confirm_usd: 5 } }))).toBe(5);
    expect(readCostConfirmThreshold(ws({ service_portfolio: { cost_confirm_usd: 'x' } }))).toBe(25);
  });

  it('research model: service_portfolio.research_model, else the primary', () => {
    expect(readServiceModels(ws({ providers: { llm: { primary: { type: 'anthropic', model: 'claude-opus-4-7' } } } }))).toEqual({ primary: 'claude-opus-4-7', research: 'claude-opus-4-7' });
    expect(readServiceModels(ws({ providers: { llm: { primary: { model: 'claude-opus-4-7' } } }, service_portfolio: { research_model: 'claude-haiku-4-5' } }))).toEqual({ primary: 'claude-opus-4-7', research: 'claude-haiku-4-5' });
  });

  it('serviceCostView counts the cached topics of the workspace and offers the cheaper model', () => {
    const d = ws({ providers: { llm: { primary: { type: 'anthropic', model: 'claude-opus-4-7' } } } });
    serviceApp(d, 'app001', 4);
    serviceApp(d, 'app002', 1);
    serviceApp(d, 'app003', 0);
    const plan = planScope('top', 3, { skipLlmResearch: false, topN: 1 });
    const v = serviceCostView(d, plan, null);
    expect(v.estimate).toMatchObject({ researchTopics: 12, researchCached: 5, researchCalls: 7, assessCallsMin: 4 });
    expect(v.estimate.research.basis).toBe('price table');
    expect(v.cheaper?.model).toBe('claude-haiku-4-5');
    const switched = serviceCostView(d, plan, 'claude-haiku-4-5');
    expect(switched.estimate.research.model).toBe('claude-haiku-4-5');
    expect(switched.estimate.researchUsd!).toBeLessThan(v.estimate.researchUsd!);
  });

  it('the hint line uses the Design 126 key hints without a double dash', () => {
    const d = ws({ providers: { llm: { primary: { type: 'anthropic', model: 'claude-opus-4-7' } } } });
    const v = serviceCostView(d, planScope('top', 3, { skipLlmResearch: false, topN: 1 }), null);
    const line = formatKeyHints(confirmKeyHints(v, false));
    expect(line).toBe('Enter confirm and start   Tab toggle research model   ← back to the scope question   Esc abort');
    expect(formatKeyHints(confirmKeyHints(v, true))).toBe('Enter confirm the cost and start   Tab toggle research model   ← back to the cost   Esc abort');
    expect(line).not.toContain('--');
  });

  it('the research stage of a Top N run says it ranks all apps', () => {
    expect(stageLabel('research', 'top', planScope('top', 234, { skipLlmResearch: false, topN: 10 }), 234, 0)).toBe('Researching all 234 apps to rank the top 10');
    expect(stageLabel('assess', 'top', planScope('top', 234, { skipLlmResearch: false, topN: 10 }), 234, 10)).toBe('Assessing the selected apps (Top 10)'.replace('Assessing the selected apps', stageLabel('assess', null, null, null, 0)));
  });
});

// #4457: the owner run of 2026-11-15: One service on claude-opus-4-7 cost 1.47 USD while the
// confirmation estimated 0.29 USD from three earlier service assessments of another model.
describe('assessment cost per model (#4457)', () => {
  const progress = (n: number, cost: number, model?: string) => Array.from({ length: n }, (_, i) => ({
    code: 'service.assess.batch.progress',
    context: { index: i + 1, total: n, app_id: `app${model ?? 'none'}${i}`, status: 'ok', duration_ms: 180_000, cost_usd: cost, ...(model ? { model } : {}) },
  }));

  it('groups the per-app cost by the model of the progress line and counts lines without one', () => {
    const d = ws();
    logCalls(d, [], [...progress(3, 0.289, 'claude-haiku-4-5'), ...progress(2, 1.47, 'claude-opus-4-7'), ...progress(4, 0.3)]);
    const b = readMeasuredBasis(d);
    expect(b.assessPerAppByModel.get('claude-haiku-4-5')).toMatchObject({ samples: 3 });
    expect(b.assessPerAppByModel.get('claude-haiku-4-5')!.usd).toBeCloseTo(0.289, 6);
    expect(b.assessPerAppByModel.get('claude-opus-4-7')!.samples).toBe(2);
    expect(b.assessUnrecordedModel).toBe(4);
    // The time basis keeps every model.
    expect(b.assessPerApp!.samples).toBe(9);
  });

  it('a rate measured with another model is not used: price table of the configured model, and the line names the other rate', () => {
    const d = ws();
    logCalls(d, [], progress(3, 0.289, 'claude-haiku-4-5'));
    const a = assessmentCost('claude-opus-4-7', readMeasuredBasis(d));
    expect(a).toMatchObject({ model: 'claude-opus-4-7', basis: 'price table', usdPerApp: null });
    expect(a.notUsed!.otherModels).toEqual([{ model: 'claude-haiku-4-5', usdPerApp: expect.closeTo(0.289, 6), samples: 3 }]);
    const e = estimateServiceRun({ researchTopics: 0, cachedTopics: 0, assessCallsMin: 4, assessApps: 1, research: { model: null, usd: null, basis: 'unknown' }, assessment: a, time: timeBasis(readMeasuredBasis(d)), thresholdUsd: 25 });
    expect(e.assessUsd!).toBeCloseTo(4 * listedCallCost('claude-opus-4-7', 'assessment')!, 9);
    const line = costConfirmationLines(e, { totalApps: 1, assessApps: 1, topRanking: false }).find((l) => l.startsWith('Assessment:'))!;
    expect(line).toContain('claude-opus-4-7');
    expect(line).toContain('from the price table');
    expect(line).toContain('earlier service assessments not used for claude-opus-4-7: 0.289 USD per app measured over 3 with claude-haiku-4-5');
    // The owner's One service run on claude-opus-4-7 cost 1.47 USD with 4 or more calls; the price table (5/25 per MTok
    // since the 2026-11-16 catalogue update) prices the minimum of 4 calls, so the estimate is a lower bound of it.
    expect(e.assessUsd!).toBeGreaterThan(0);
    expect(e.assessUsd!).toBeLessThan(1.47);
  });

  it('the measured rate of the configured model wins over every other model', () => {
    const d = ws();
    logCalls(d, [], [...progress(5, 0.289, 'claude-haiku-4-5'), ...progress(3, 1.47, 'claude-opus-4-7')]);
    expect(assessmentCost('claude-opus-4-7', readMeasuredBasis(d))).toMatchObject({ basis: 'measured', usdPerApp: 1.47, samples: 3 });
  });

  it('a dated model id in the manifest meets the configured id without the date', () => {
    const d = ws();
    logCalls(d, [], progress(3, 0.05, 'claude-haiku-4-5-20251001'));
    expect(assessmentCost('claude-haiku-4-5', readMeasuredBasis(d))).toMatchObject({ basis: 'measured', samples: 3 });
    expect(assessmentCost('claude-haiku-4-5-20251001', readMeasuredBasis(d))).toMatchObject({ basis: 'measured', samples: 3 });
  });

  it('lines without a model never stand for the configured model: price table, and the line says why', () => {
    const d = ws();
    logCalls(d, [], progress(3, 0.289));
    const a = assessmentCost('claude-opus-4-7', readMeasuredBasis(d));
    expect(a).toMatchObject({ basis: 'price table', notUsed: { otherModels: [], unrecorded: 3 } });
    const e = estimateServiceRun({ researchTopics: 0, cachedTopics: 0, assessCallsMin: 4, assessApps: 1, research: { model: null, usd: null, basis: 'unknown' }, assessment: a, time: timeBasis(readMeasuredBasis(d)), thresholdUsd: 25 });
    const line = costConfirmationLines(e, { totalApps: 1, assessApps: 1, topRanking: false }).find((l) => l.startsWith('Assessment:'))!;
    expect(line).toContain('from the price table');
    expect(line).toContain('earlier service assessments not used for claude-opus-4-7: 3 without a recorded model');
    expect(line).not.toMatch(new RegExp(`--|${String.fromCharCode(0x2014)}|${String.fromCharCode(0x2013)}`));
  });
});

// #4497: the owner UAT of 2026-11-16: primary openrouter / anthropic/claude-sonnet-5.5 showed
// "cost per call unknown" although the workspace connector file holds the discovered price.
describe('connector and discovery prices; One service cache share (#4497)', () => {
  function openrouterWs(): string {
    const d = ws({ providers: { llm: { primary: { connector: 'openrouter', model: 'anthropic/claude-sonnet-5.5' } } } });
    mkdirSync(join(d, 'wsp', 'inputs', 'llm-gateway'), { recursive: true });
    writeFileSync(join(d, 'wsp', 'inputs', 'llm-gateway', 'openrouter.yaml'), dump({
      schema_version: '1.0',
      connector: {
        id: 'openrouter', name: 'OpenRouter', protocol: 'openai-chat', base_url: 'https://openrouter.example/api',
        auth: { env_var: 'SWAO_TEST_NO_KEY' },
        models: { default: 'mistralai/mistral-large-2512', catalogue: [{ id: 'anthropic/claude-sonnet-5.5', discovered: true, cost: { input_per_million: 2, output_per_million: 10 } }] },
      },
    }));
    return d;
  }

  it('research and assessment take the discovered price of the workspace connector, not unknown', () => {
    const d = openrouterWs();
    serviceApp(d, 'app001', 0);
    const v = serviceCostView(d, planScope('top', 1, { skipLlmResearch: false, topN: 1 }), null);
    expect(v.estimate.research.basis).toBe('price table');
    expect(v.estimate.research.usd).toBeCloseTo((3_000 * 2 + 800 * 10) / 1_000_000, 9);
    expect(v.estimate.assessment.basis).toBe('price table');
    expect(v.estimate.totalUsd).not.toBeNull();
    // Without the connector the model has no price in the Anthropic table.
    expect(listedCallCost('anthropic/claude-sonnet-5.5', 'research')).toBeNull();
  });

  it('One service counts the cached topics of that app only', () => {
    const d = ws({ providers: { llm: { primary: { type: 'anthropic', model: 'claude-opus-4-7' } } } });
    serviceApp(d, 'app001', 4);
    serviceApp(d, 'app002', 3);
    const one = serviceCostView(d, planScope('one', 2, { skipLlmResearch: false }), null, new Date(), 'app002');
    expect(one.estimate).toMatchObject({ researchCached: 3, researchCalls: one.estimate.researchTopics - 3 });
  });
});
