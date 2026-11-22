// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4270: every provider.llm.* event of a call made inside withLlmCallContext
// carries caller and app_id, and the caller's cost equals the sum of the ok
// events' cost_usd.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const events: Array<{ code: string; context: Record<string, unknown> }> = [];
vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return {
    ...actual,
    logPortfolio: (_level: string, code: string, _msg: string, opts: { context?: Record<string, unknown> } = {}) => { events.push({ code, context: opts.context ?? {} }); },
    logApp: vi.fn(),
  };
});

const { withLlmCallContext } = await import('@swao/core');
const { requestLlmWithRetry, withLlmCaller } = await import('./llm-request.js');

function call(costUsd: number): Promise<string> {
  return requestLlmWithRetry<string>({
    provider: 'fake', label: 'Fake', model: 'fake-1', kind: 'text', endpoint: 'https://llm.example/v1',
    limiterKey: 'fake-caller-test', streaming: false, promptChars: 10,
    run: async () => ({ value: 'ok', status: 200, okContext: { tokens_in: 1, tokens_out: 1, cost_usd: costUsd } }),
  });
}

beforeEach(() => { events.length = 0; });

describe('LLM caller context (#4270)', () => {
  it('stamps caller and app_id on attempt and ok events', async () => {
    await withLlmCallContext({ caller: 'service.research.vendor-profile', appId: 'app-1' }, () => call(0.01));
    const llm = events.filter((e) => e.code.startsWith('provider.llm.fake.'));
    expect(llm.map((e) => e.code)).toEqual(['provider.llm.fake.attempt', 'provider.llm.fake.ok']);
    for (const e of llm) expect(e.context).toMatchObject({ caller: 'service.research.vendor-profile', app_id: 'app-1' });
  });

  it('outside a context the events carry no caller', async () => {
    await call(0.01);
    expect(events.find((e) => e.code === 'provider.llm.fake.ok')?.context).not.toHaveProperty('caller');
  });

  it('per-app cost sums to the batch cost and to the sum of the ok events', async () => {
    const perApp: number[] = [];
    const batch = await withLlmCallContext({ caller: 'service.research' }, async (b) => {
      for (const [app, costs] of [['a', [0.01, 0.02]], ['b', [0.03]]] as const) {
        await withLlmCallContext({ caller: 'service.research.app', appId: app }, async (ctx) => {
          await Promise.all(costs.map((c, i) => withLlmCallContext({ caller: `service.research.topic-${i}` }, () => call(c))));
          perApp.push(ctx.costUsd);
          expect(ctx.llmCalls).toBe(costs.length);
        });
      }
      return b;
    });
    const okSum = events.filter((e) => e.code === 'provider.llm.fake.ok').reduce((s, e) => s + (e.context['cost_usd'] as number), 0);
    expect(perApp.reduce((s, c) => s + c, 0)).toBeCloseTo(okSum, 10);
    expect(batch.costUsd).toBeCloseTo(okSum, 10);
    expect(batch.llmCalls).toBe(3);
    // The nested topic context inherits the app id.
    expect(events.filter((e) => e.code === 'provider.llm.fake.ok').map((e) => e.context['app_id'])).toEqual(['a', 'a', 'b']);
  });

  it('withLlmCaller (connectivity checks, chat) names the caller', async () => {
    await withLlmCaller({ caller: 'tui.llm-assess.health-check' }, () => call(0));
    expect(events.find((e) => e.code === 'provider.llm.fake.attempt')?.context['caller']).toBe('tui.llm-assess.health-check');
  });
});
