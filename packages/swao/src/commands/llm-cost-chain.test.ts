// #4372: the cost source of the OpenRouter driver survives the leg wrapper
// chain (driver, UsageTrackingLlmProvider, leg recorder), as in the leg
// process (index.ts: legRecorder.wrap(tracking, ...)). Mocked fetch only.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { originalGlobalFetch } = vi.hoisted(() => ({ originalGlobalFetch: globalThis.fetch }));
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return {
    ...actual,
    fetch: (...args: Parameters<typeof globalThis.fetch>) => {
      if (globalThis.fetch === originalGlobalFetch) throw new Error('network access blocked in tests (#3159)');
      return globalThis.fetch(...args);
    },
  };
});

import { AnthropicLlmProvider, OpenLlmProvider, UsageTrackingLlmProvider } from '@swao/module-llm-providers';
import { createLegRecorderFromEnv, LEG_ENV } from '@swao/module-llm-assessment';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'swao-4372-chain-')); });
afterEach(() => { global.fetch = originalGlobalFetch; rmSync(dir, { recursive: true, force: true }); });

async function recordOne(usage: Record<string, unknown>, rates?: { inputPerMillion: number; outputPerMillion: number }): Promise<{ computed: number | null; source: string }> {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }], usage }),
  } as unknown as Response) as unknown as typeof fetch;
  const sink = join(dir, 'leg.ndjson');
  const recorder = createLegRecorderFromEnv({
    [LEG_ENV.RECORD]: sink, [LEG_ENV.LEG_ID]: 'openrouter--m', [LEG_ENV.CONNECTOR]: 'openrouter', [LEG_ENV.MODEL]: 'm', [LEG_ENV.COST_SOURCE]: 'billed',
  })!;
  const driver = new OpenLlmProvider('test-' + 'k'.repeat(12), 'm', 'https://openrouter.ai/api', '', 0, undefined, rates, { usageAccounting: true });
  const tracking = new UsageTrackingLlmProvider(driver);
  const wrapped = recorder.wrap(tracking, () => tracking.snapshot());
  await wrapped.complete('prompt');
  const rec = JSON.parse(readFileSync(sink, 'utf-8').trim().split('\n').pop()!) as { cost_usd: { computed: number | null; source: string } };
  return rec.cost_usd;
}

describe('cost source through the leg wrapper chain (#4372)', () => {
  it('billed usage.cost is recorded as billed', async () => {
    expect(await recordOne({ prompt_tokens: 6640, completion_tokens: 1600, cost: 0.02236 })).toEqual({ computed: 0.02236, source: 'billed' });
  });

  it('no usage.cost, rates set: configured', async () => {
    expect(await recordOne({ prompt_tokens: 1_000_000, completion_tokens: 0 }, { inputPerMillion: 2, outputPerMillion: 6 })).toEqual({ computed: 2, source: 'configured' });
  });

  it('no usage.cost, no rates: unpriced with computed null', async () => {
    expect(await recordOne({ prompt_tokens: 6640, completion_tokens: 1600 })).toEqual({ computed: null, source: 'unpriced' });
  });
});

// #4372 decision 2 (2026-11-14): the native Anthropic driver prices from rates
// (configured), never billed; a model without a price is unpriced. The leg
// source stays billed for every non-Ollama connector, as in assess.ts.
async function recordAnthropic(model: string, rates?: { inputPerMillion: number; outputPerMillion: number }, useCodeTable = true): Promise<{ computed: number | null; source: string }> {
  const enc = new TextEncoder();
  const NL = String.fromCharCode(10);
  const payload = [
    { type: 'message_start', message: { usage: { input_tokens: 1_000_000 } } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"ok":true,"detail":"long enough"}' } },
    { type: 'message_delta', usage: { output_tokens: 1000 }, delta: { stop_reason: 'end_turn' } },
  ].map((e) => 'data: ' + JSON.stringify(e) + NL + NL).join('');
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, status: 200,
    body: new ReadableStream({ start(c) { c.enqueue(enc.encode(payload)); c.close(); } }),
  } as unknown as Response) as unknown as typeof fetch;
  const sink = join(dir, 'leg-anthropic.ndjson');
  const recorder = createLegRecorderFromEnv({
    [LEG_ENV.RECORD]: sink, [LEG_ENV.LEG_ID]: 'anthropic--' + model, [LEG_ENV.CONNECTOR]: 'anthropic', [LEG_ENV.MODEL]: model, [LEG_ENV.COST_SOURCE]: 'billed',
  })!;
  const driver = new AnthropicLlmProvider('test-' + 'k'.repeat(12), model, 0, undefined, undefined, undefined, rates, useCodeTable);
  const tracking = new UsageTrackingLlmProvider(driver);
  const wrapped = recorder.wrap(tracking, () => tracking.snapshot());
  await wrapped.complete('prompt');
  const rec = JSON.parse(readFileSync(sink, 'utf-8').trim().split(NL).pop()!) as { cost_usd: { computed: number | null; source: string } };
  return rec.cost_usd;
}

describe('native Anthropic cost source through the leg wrapper chain (#4372 decision 2)', () => {
  it('code table price (legacy path): configured, not billed', async () => {
    expect(await recordAnthropic('claude-haiku-4-5-20251001')).toEqual({ computed: 1.005, source: 'configured' });
  });

  it('connector yaml rates (gateway): configured', async () => {
    expect(await recordAnthropic('claude-yaml-only', { inputPerMillion: 4, outputPerMillion: 20 }, false)).toEqual({ computed: 4.02, source: 'configured' });
  });

  it('no price (gateway, no yaml rates): unpriced with computed null', async () => {
    expect(await recordAnthropic('claude-opus-4-7', undefined, false)).toEqual({ computed: null, source: 'unpriced' });
  });
});
