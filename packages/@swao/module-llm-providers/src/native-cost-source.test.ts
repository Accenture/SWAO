// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- native driver cost source tests (#4372)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4372 (decision 2, coordinator 2026-11-14): native drivers price a call from
// rates (connector yaml, .swao.yml cost_per_token, or a code price table on
// the legacy factory path) and label it `configured`; a model without a price
// is `none` (unpriced). `billed` stays for a cost the provider returned.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AnthropicLlmProvider } from './anthropic.js';
import { OpenAiLlmProvider } from './openai.js';
import { ratedUsageCost, anthropicTableRates, openaiTableRates } from './types.js';
import { createProviderFromConnector, connectorModelHasPrice } from './gateway/resolve.js';
import { getConnector } from './gateway/connector-loader.js';
import type { LlmCompletion } from './types.js';

const KEY = 'sk-test-4372';

function anthropicSse(inputTokens: number, outputTokens: number): Partial<Response> {
  const enc = new TextEncoder();
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: inputTokens } } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"result":"ok","detail":"long enough"}' } },
    { type: 'message_delta', usage: { output_tokens: outputTokens }, delta: { stop_reason: 'end_turn' } },
  ];
  const payload = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({ start(c) { c.enqueue(enc.encode(payload)); c.close(); } }),
  };
}

function openaiJson(inputTokens: number, outputTokens: number): Partial<Response> {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: '{"result":"ok"}' } }],
      usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens },
    }),
  };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('ratedUsageCost (#4372)', () => {
  it('rates give a configured list price estimate', () => {
    expect(ratedUsageCost({ inputPerMillion: 2, outputPerMillion: 4 }, 1_000_000, 500_000))
      .toEqual({ cost_usd: 4, cost_source: 'configured' });
  });
  it('no rates give none with cost 0 (unpriced, not free)', () => {
    expect(ratedUsageCost(undefined, 1000, 1000)).toEqual({ cost_usd: 0, cost_source: 'none' });
  });
  it('table lookups return undefined for unknown models (no implicit 0 price)', () => {
    expect(anthropicTableRates('claude-mystery-9000')).toBeUndefined();
    expect(openaiTableRates('gpt-mystery')).toBeUndefined();
    expect(anthropicTableRates('claude-opus-4-7')).toEqual({ inputPerMillion: 5, outputPerMillion: 25 });
  });
});

describe('AnthropicLlmProvider cost source (#4372)', () => {
  it('legacy path: a model in the code table is configured, not billed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(anthropicSse(1_000_000, 100)));
    const r: LlmCompletion = await new AnthropicLlmProvider(KEY, 'claude-opus-4-7').completeDetailed('x');
    expect(r.usage?.cost_source).toBe('configured');
    expect(r.usage?.cost_usd).toBeCloseTo(5 + 100 * 25 / 1_000_000, 9);
  });

  it('legacy path: a model in no table is none (unpriced)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(anthropicSse(1000, 100)));
    const r = await new AnthropicLlmProvider(KEY, 'claude-mystery-9000').completeDetailed('x');
    expect(r.usage).toMatchObject({ cost_usd: 0, cost_source: 'none' });
  });

  it('given rates win over the code table', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(anthropicSse(1_000_000, 1000)));
    const p = new AnthropicLlmProvider(KEY, 'claude-opus-4-7', 0, undefined, undefined, undefined, { inputPerMillion: 2, outputPerMillion: 8 });
    const r = await p.completeDetailed('x');
    expect(r.usage?.cost_source).toBe('configured');
    expect(r.usage?.cost_usd).toBeCloseTo(2 + 1000 * 8 / 1_000_000, 9);
  });

  it('useCodeTable false (gateway): a table model without rates is none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(anthropicSse(1000, 100)));
    const p = new AnthropicLlmProvider(KEY, 'claude-opus-4-7', 0, undefined, undefined, undefined, undefined, false);
    const r = await p.completeDetailed('x');
    expect(r.usage).toMatchObject({ cost_usd: 0, cost_source: 'none' });
  });

  it('tool chat usage carries the cost source', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 1_000_000, output_tokens: 0 } }),
    }));
    const p = new AnthropicLlmProvider(KEY, 'claude-sonnet-4-6');
    const r = await p.completeWithToolsDetailed!({
      system: 's', messages: [{ role: 'user', content: 'q' }],
      tools: [{ name: 't', description: 'd', input_schema: { type: 'object' } }],
      onToolCall: async () => 'x',
    });
    expect(r.usage).toMatchObject({ cost_usd: 3, cost_source: 'configured' });
  });
});

describe('OpenAiLlmProvider cost source (#4372)', () => {
  it('a model in the code table is configured, not billed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(openaiJson(1_000_000, 0)));
    const r = await new OpenAiLlmProvider(KEY, 'gpt-4o').completeDetailed('x');
    expect(r.usage).toMatchObject({ cost_usd: 2.5, cost_source: 'configured' });
  });

  it('a model in no table is none (unpriced)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(openaiJson(1000, 100)));
    const r = await new OpenAiLlmProvider(KEY, 'gpt-mystery').completeDetailed('x');
    expect(r.usage).toMatchObject({ cost_usd: 0, cost_source: 'none' });
  });

  it('configured rates (.swao.yml cost_per_token) win over the code table', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(openaiJson(1_000_000, 0)));
    const r = await new OpenAiLlmProvider(KEY, 'gpt-mystery', 0, undefined, undefined, { inputPerMillion: 7, outputPerMillion: 9 }).completeDetailed('x');
    expect(r.usage).toMatchObject({ cost_usd: 7, cost_source: 'configured' });
  });
});

describe('gateway anthropic-messages connector prices from the yaml (#4372)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'swao-costsrc-'));
    const dir = join(root, 'wsp', 'inputs', 'llm-gateway');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'anthropic-test.yaml'), [
      'schema_version: "1.0"',
      'connector:',
      '  id: anthropic-test',
      '  name: Anthropic Test',
      '  protocol: anthropic-messages',
      '  base_url: https://anthropic.example.internal',
      '  auth:',
      '    env_var: SWAO_TEST_ANTHROPIC_4372',
      '    header: x-api-key',
      '    scheme: raw',
      '  models:',
      '    default: claude-yaml-only-model',
      '    catalogue:',
      '      - id: claude-yaml-only-model',
      '        cost: { input_per_million: 4.0, output_per_million: 20.0 }',
      '      - id: claude-opus-4-7',
      '  meta:',
      '    source: user',
    ].join('\n') + '\n');
    process.env['SWAO_TEST_ANTHROPIC_4372'] = KEY;
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    delete process.env['SWAO_TEST_ANTHROPIC_4372'];
  });

  const build = (model: string) => {
    const loaded = getConnector('anthropic-test', { workspaceRoot: root });
    if (!loaded) throw new Error('connector not found');
    return createProviderFromConnector(loaded, { model }).provider;
  };

  it('a model in the yaml but not in the code table is priced from the yaml (configured)', async () => {
    expect(anthropicTableRates('claude-yaml-only-model')).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(anthropicSse(1_000_000, 100_000)));
    const r = await build('claude-yaml-only-model').completeDetailed!('x');
    expect(r.usage?.cost_source).toBe('configured');
    expect(r.usage?.cost_usd).toBeCloseTo(4 + 2, 9);
  });

  it('a model without yaml rates falls back to the code table (configured); the preflight agrees', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(anthropicSse(1_000_000, 100_000)));
    const r = await build('claude-opus-4-7').completeDetailed!('x');
    const t = anthropicTableRates('claude-opus-4-7')!;
    expect(r.usage?.cost_source).toBe('configured');
    expect(r.usage?.cost_usd).toBeCloseTo(t.inputPerMillion + t.outputPerMillion / 10, 9);
    const loaded = getConnector('anthropic-test', { workspaceRoot: root })!;
    expect(connectorModelHasPrice(loaded.file.connector, 'claude-opus-4-7')).toBe(true);
    expect(connectorModelHasPrice(loaded.file.connector, 'claude-unknown-model')).toBe(false);
  });

  it('a model in neither the yaml nor the code table is unpriced (none)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(anthropicSse(1000, 100)));
    const r = await build('claude-unknown-model').completeDetailed!('x');
    expect(r.usage).toMatchObject({ cost_usd: 0, cost_source: 'none' });
  });
});
