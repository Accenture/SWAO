// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- alias resolver tests (#1817)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { isAlias, resolveModelAlias } from './alias-resolver.js';
import type { Connector } from './connector-schema.js';

const MOCK_CONNECTOR: Connector = {
  id: 'openrouter',
  name: 'OpenRouter',
  protocol: 'openai-chat',
  base_url: 'https://openrouter.ai/api',
  path_prefix: '',
  auth: { header: 'Authorization', scheme: 'bearer' },
  models: {
    default: 'mistralai/mistral-large',
    discovery_endpoint: '/v1/models',
  },
};

const DISCOVERY_MODELS = [
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v4-flash:free',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-pro',
  'openai/gpt-4.1',
  'openai/gpt-4.1-mini',
  'x-ai/grok-4.5',
  'x-ai/grok-4.6',
  'moonshotai/kimi-k2',
  'moonshotai/kimi-k3',
  'mistralai/mistral-large',
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isAlias', () => {
  it('returns true for ~-prefix', () => {
    expect(isAlias('~deepseek/deepseek-v4-flash-latest')).toBe(true);
  });

  it('returns false for concrete IDs', () => {
    expect(isAlias('deepseek/deepseek-v4-flash')).toBe(false);
    expect(isAlias('openai/gpt-4.1-mini')).toBe(false);
  });
});

describe('resolveModelAlias (#1817)', () => {
  function mockDiscovery(models: string[]): void {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ data: models.map((id) => ({ id })) }),
    }));
  }

  it('passes through concrete model IDs unchanged', async () => {
    const result = await resolveModelAlias('deepseek/deepseek-v4-flash', MOCK_CONNECTOR, 'sk-or-test');
    expect(result).toBe('deepseek/deepseek-v4-flash');
  });

  it('resolves ~deepseek/deepseek-v4-flash-latest to the newest matching concrete id', async () => {
    mockDiscovery(DISCOVERY_MODELS);
    const result = await resolveModelAlias('~deepseek/deepseek-v4-flash-latest', MOCK_CONNECTOR, 'sk-or-test');
    // deepseek/deepseek-v4-flash:free sorts after deepseek/deepseek-v4-flash
    expect(result).toBe('deepseek/deepseek-v4-flash:free');
  });

  it('resolves ~x-ai/grok-latest to x-ai/grok-4.6 (highest)', async () => {
    mockDiscovery(DISCOVERY_MODELS);
    const result = await resolveModelAlias('~x-ai/grok-latest', MOCK_CONNECTOR, 'sk-or-test');
    expect(result).toBe('x-ai/grok-4.6');
  });

  it('resolves ~moonshotai/kimi-latest to moonshotai/kimi-k3', async () => {
    mockDiscovery(DISCOVERY_MODELS);
    const result = await resolveModelAlias('~moonshotai/kimi-latest', MOCK_CONNECTOR, 'sk-or-test');
    expect(result).toBe('moonshotai/kimi-k3');
  });

  it('returns base id with error log when no match exists in discovery', async () => {
    mockDiscovery(['openai/gpt-4.1']);
    const result = await resolveModelAlias('~z-ai/glm-latest', MOCK_CONNECTOR, 'sk-or-test');
    expect(result).toBe('z-ai/glm');
  });

  it('returns base id with warn when discovery endpoint is unreachable', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('ECONNREFUSED'); });
    const result = await resolveModelAlias('~openai/gpt-mini-latest', MOCK_CONNECTOR, 'sk-or-test');
    expect(result).toBe('openai/gpt-mini');
  });

  it('returns base id with error log when connector has no discovery_endpoint', async () => {
    const noDiscovery: Connector = { ...MOCK_CONNECTOR, models: { default: 'test-model' } };
    const result = await resolveModelAlias('~google/gemini-flash-latest', noDiscovery, 'key');
    expect(result).toBe('google/gemini-flash');
  });
});
