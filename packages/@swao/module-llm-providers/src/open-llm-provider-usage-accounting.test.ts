// #4372: the OpenRouter driver requests usage accounting and records the
// billed cost the response carries; configured rates are the fallback and a
// call without either is marked as not priced. Mocked fetch only.

import { describe, it, expect, vi, afterEach } from 'vitest';

const { originalGlobalFetch } = vi.hoisted(() => ({ originalGlobalFetch: globalThis.fetch }));
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return {
    ...actual,
    fetch: (...args: Parameters<typeof globalThis.fetch>) => {
      if (globalThis.fetch === originalGlobalFetch) {
        throw new Error('network access blocked in tests: stub global fetch first (#3159)');
      }
      return globalThis.fetch(...args);
    },
  };
});
vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return { ...actual, logPortfolio: vi.fn(), logApp: vi.fn() };
});

import { OpenLlmProvider } from './open-llm-provider.js';
import { connectorModelHasPrice, isOpenRouterConnector } from './gateway/resolve.js';

const ORIGINAL_FETCH = global.fetch;
afterEach(() => { global.fetch = ORIGINAL_FETCH; });

function stubFetch(usage: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }], usage }),
  } as unknown as Response);
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

function sentBody(mock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = mock.mock.calls[0]![1] as { body: string };
  return JSON.parse(init.body) as Record<string, unknown>;
}

const key = (): string => 'test-' + 'k'.repeat(12);

describe('OpenRouter usage accounting (#4372)', () => {
  it('requests usage accounting and records the billed cost from usage.cost', async () => {
    const mock = stubFetch({ prompt_tokens: 6640, completion_tokens: 1600, cost: 0.02236 });
    const p = new OpenLlmProvider(key(), 'mistralai/mistral-large', 'https://openrouter.ai/api', '', 0, undefined, undefined, { usageAccounting: true });
    const r = await p.completeDetailed('prompt');
    expect(sentBody(mock)['usage']).toEqual({ include: true });
    expect(r.usage).toEqual({ input_tokens: 6640, output_tokens: 1600, cost_usd: 0.02236, cost_source: 'billed' });
  });

  it('billed cost missing: configured rates are the fallback (source configured)', async () => {
    stubFetch({ prompt_tokens: 1_000_000, completion_tokens: 0 });
    const p = new OpenLlmProvider(key(), 'm', 'https://openrouter.ai/api', '', 0, undefined, { inputPerMillion: 2, outputPerMillion: 6 }, { usageAccounting: true });
    const r = await p.completeDetailed('prompt');
    expect(r.usage).toMatchObject({ cost_usd: 2, cost_source: 'configured' });
  });

  it('no billed cost and no rates: source none (the recorder records it as unpriced)', async () => {
    stubFetch({ prompt_tokens: 100, completion_tokens: 10 });
    const p = new OpenLlmProvider(key(), 'm', 'https://openrouter.ai/api', '', 0, undefined, undefined, { usageAccounting: true });
    const r = await p.completeDetailed('prompt');
    expect(r.usage).toMatchObject({ cost_usd: 0, cost_source: 'none' });
  });

  it('other OpenAI-compatible gateways: no usage field in the request; a usage.cost is ignored', async () => {
    const mock = stubFetch({ prompt_tokens: 100, completion_tokens: 10, cost: 9 });
    const p = new OpenLlmProvider(key(), 'm', 'https://gateway.example.test', '', 0, undefined, undefined, {});
    const r = await p.completeDetailed('prompt');
    expect(sentBody(mock)['usage']).toBeUndefined();
    expect(r.usage).toMatchObject({ cost_usd: 0, cost_source: 'none' });
  });

  it('isOpenRouterConnector: id openrouter or an openrouter.ai base URL', () => {
    expect(isOpenRouterConnector('openrouter', undefined)).toBe(true);
    expect(isOpenRouterConnector('my-router', 'https://openrouter.ai/api')).toBe(true);
    expect(isOpenRouterConnector('gateway', 'https://gateway.example.test')).toBe(false);
    expect(isOpenRouterConnector('gateway', 'not a url')).toBe(false);
  });

  it('connectorModelHasPrice: catalogue cost or cost_per_token', () => {
    const base = { id: 'c', models: { default: 'a', catalogue: [{ id: 'a', cost: { input_per_million: 1, output_per_million: 2 } }, { id: 'b' }] } };
    expect(connectorModelHasPrice(base as never, 'a')).toBe(true);
    expect(connectorModelHasPrice(base as never, 'b')).toBe(false);
    expect(connectorModelHasPrice({ ...base, cost_per_token: { input_per_million: 1, output_per_million: 1 } } as never, 'b')).toBe(true);
  });
});
