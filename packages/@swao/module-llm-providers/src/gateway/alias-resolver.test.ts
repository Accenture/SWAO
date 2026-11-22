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
import { isAlias, pickBestModel, resolveModelAlias } from './alias-resolver.js';
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
    // #4500: the plain id wins over its variants (deepseek/deepseek-v4-flash:free sorts after it)
    expect(result).toBe('deepseek/deepseek-v4-flash');
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

  it('resolves ~google/gemini-flash-latest via token-match fallback when prefix no longer exists (#2863)', async () => {
    // Discovery has google/gemini-2.5-flash (version injected mid-name); prefix
    // google/gemini-flash matches nothing -- token fallback picks the right model.
    mockDiscovery(DISCOVERY_MODELS);
    const result = await resolveModelAlias('~google/gemini-flash-latest', MOCK_CONNECTOR, 'sk-or-test');
    expect(result).toBe('google/gemini-2.5-flash');
  });
});

describe('alias resolution skips batch-only ids (#4500)', () => {
  const OPENROUTER_SONNET = [
    'anthropic/claude-sonnet-4.6',
    'anthropic/claude-sonnet-5.5',
    'anthropic/claude-sonnet-5.5:batch',
    'anthropic/claude-sonnet-5.5:thinking',
    'anthropic/claude-sonnet-5:batch',
  ];

  it('resolves ~anthropic/claude-sonnet-latest to the newest chat model, never the :batch variant', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ data: OPENROUTER_SONNET.map((id) => ({ id })) }) }));
    const result = await resolveModelAlias('~anthropic/claude-sonnet-latest', MOCK_CONNECTOR, 'sk-or-test');
    expect(result).toBe('anthropic/claude-sonnet-5.5');
  });

  it('takes a non-batch variant when no plain id matches; only batch ids give no match', () => {
    expect(pickBestModel('~vendor/model-latest', ['vendor/model-2:batch', 'vendor/model-2:thinking'])).toBe('vendor/model-2:thinking');
    expect(pickBestModel('~vendor/model-latest', ['vendor/model-2:batch'])).toBeNull();
  });

  it('other protocols are not filtered (a colon is an Ollama tag there)', () => {
    expect(pickBestModel('~llama3.3-latest', ['llama3.3:batch'], 'ollama')).toBe('llama3.3:batch');
  });
});
