// #4372: unpriced calls are recorded as `source: unpriced` with computed
// null (never 0 labelled billed); a billed gateway cost is kept; the run
// warns before the first leg and names the unpriced candidates.

import { describe, it, expect } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callCost, createRecordingProvider, type CallUsage, type UsageSnapshot } from './recording-provider.js';
import { CallRecordSchema, sizeBucket } from './call-record.js';
import { orchestrateLegs, type ResolvedLeg } from './orchestrator.js';
import { LEG_ENV } from './leg-recorder.js';

describe('callCost (#4372)', () => {
  it('local legs stay local; the driver source wins; 0 with tokens is unpriced', () => {
    expect(callCost('local', undefined, 0.5, 100)).toEqual({ computed: null, source: 'local' });
    expect(callCost('billed', { input_tokens: 1, output_tokens: 1, cost_usd: 0.02, cost_source: 'billed' }, 0.02, 2)).toEqual({ computed: 0.02, source: 'billed' });
    expect(callCost('billed', { input_tokens: 1, output_tokens: 1, cost_usd: 0.01, cost_source: 'configured' }, 0.01, 2)).toEqual({ computed: 0.01, source: 'configured' });
    expect(callCost('billed', { input_tokens: 1, output_tokens: 1, cost_usd: 0, cost_source: 'none' }, 0, 2)).toEqual({ computed: null, source: 'unpriced' });
    expect(callCost('billed', undefined, 0, 8240)).toEqual({ computed: null, source: 'unpriced' });
    expect(callCost('billed', undefined, 0.84, 8240)).toEqual({ computed: 0.84, source: 'billed' });
    expect(callCost('unpriced', undefined, 0.84, 10)).toEqual({ computed: null, source: 'unpriced' });
    // A billed gateway cost of 0 (free model) stays billed.
    expect(callCost('billed', { input_tokens: 1, output_tokens: 1, cost_usd: 0, cost_source: 'billed' }, 0, 2)).toEqual({ computed: 0, source: 'billed' });
  });
});

function harness(usage: CallUsage) {
  let snap: UsageSnapshot = { input_tokens: 0, output_tokens: 0, cost_usd: 0, call_count: 0 };
  const inner = {
    async complete(): Promise<string> { return '{"a":1}'; },
    async completeDetailed(): Promise<{ text: string; usage: CallUsage }> {
      snap = { input_tokens: snap.input_tokens + usage.input_tokens, output_tokens: snap.output_tokens + usage.output_tokens, cost_usd: snap.cost_usd + usage.cost_usd, call_count: snap.call_count + 1 };
      return { text: '{"a":1}', usage };
    },
  };
  return createRecordingProvider(inner, {
    leg: { id: 'openrouter--mistralai_mistral-large', connector: 'openrouter', model: 'mistralai/mistral-large' },
    usageSnapshot: () => snap, costSource: 'billed',
    currentContext: () => ({ passId: '03-data', callSite: 'site' }),
    onRecord: () => undefined,
  });
}

describe('recording provider cost source (#4372)', () => {
  it('an unpriced call (6640 + 1600 tokens, cost 0, no price) records computed null, source unpriced; schema-valid', async () => {
    const p = harness({ input_tokens: 6640, output_tokens: 1600, cost_usd: 0, cost_source: 'none' });
    await p.complete('x');
    const r = p.records()[0]!;
    expect(r.cost_usd).toEqual({ computed: null, source: 'unpriced' });
    expect(() => CallRecordSchema.parse(r)).not.toThrow();
  });

  it('an OpenRouter billed usage is recorded as billed with the cost', async () => {
    const p = harness({ input_tokens: 6640, output_tokens: 1600, cost_usd: 0.02236, cost_source: 'billed' });
    await p.complete('x');
    expect(p.records()[0]!.cost_usd).toEqual({ computed: 0.02236, source: 'billed' });
  });

  it('a native driver list price (configured) on a billed leg is recorded configured, not billed (decision 2, 2026-11-14)', async () => {
    const p = harness({ input_tokens: 6640, output_tokens: 1600, cost_usd: 0.0146, cost_source: 'configured' });
    await p.complete('x');
    expect(p.records()[0]!.cost_usd).toEqual({ computed: 0.0146, source: 'configured' });
  });
});

function record(legId: string, connector: string, model: string, cost: { computed: number | null; source: string }): string {
  return JSON.stringify({
    leg: { id: legId, connector, model },
    pass_id: '03-data', call_site: 'site', call_index: 0,
    prompt: { sha256: 'p', chars: 400, tokens_est: 100, size_bucket: sizeBucket(100) },
    timing: { started: '2026-11-10T12:00:00Z', total_ms: 100 },
    tokens: { prompt: 6640, completion: 1600 },
    cost_usd: cost,
    quality: { parse_valid: true, schema_conform: true, truncated: false, refusal_detected: false },
    reliability: { retries: 0, rate_limited: false, dnf: false },
    security: { redaction_marker_altered: false, foreign_path_count: 0, pii_reproduction_detected: false, prompt_injection_detected: false },
    response_sha256: 'r',
  }) + '\n';
}

describe('orchestrator: unpriced candidates (#4372)', () => {
  it('price preflight warns before the first leg; one finding per unpriced leg; result carries costUsd and unpriced', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-4372-'));
    try {
      writeFileSync(join(ws, '.swao.yml'), 'workspace: {}\n', 'utf-8');
      mkdirSync(join(ws, 'apps', 'demo-app', 'src'), { recursive: true });
      writeFileSync(join(ws, 'apps', 'demo-app', 'src', 'main.ts'), 'export const x = 1;\n', 'utf-8');
      const legs: ResolvedLeg[] = [
        { id: 'anthropic--claude-opus-4-7', connector: 'anthropic', model: 'claude-opus-4-7', primary: true, costSource: 'billed' },
        { id: 'openrouter--mistralai_mistral-large', connector: 'openrouter', model: 'mistralai/mistral-large', primary: false, costSource: 'billed' },
      ];
      const progress: string[] = [];
      const result = await orchestrateLegs({
        workspaceRoot: ws, appId: 'demo-app', legs, execution: 'serial', repeat: 1, weights: { quality: 1, cost: 1 },
        keepLegWsp: false, passSuiteVersion: 'v158', timestamp: () => '2026-11-10T12:00:00.000Z',
        onProgress: (m) => progress.push(m),
        pricePreflight: (leg) => (leg.connector === 'openrouter' ? `no price for ${leg.model} in ${leg.connector}.yaml` : undefined),
        spawnLeg: async (leg, _w, env) => {
          appendFileSync(env[LEG_ENV.RECORD]!, record(leg.id, leg.connector, leg.model,
            leg.connector === 'openrouter' ? { computed: null, source: 'unpriced' } : { computed: 0.84, source: 'billed' }));
          return { exitCode: 0, durationMs: 5 };
        },
      });
      const lines = readFileSync(join(result.runDir, 'log.ndjson'), 'utf-8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as { level: string; code: string; message: string });
      const pre = lines.filter((l) => l.code === 'leg.preflight.price');
      expect(pre).toHaveLength(1);
      expect(pre[0]!.level).toBe('warn');
      expect(pre[0]!.message).toContain('no price for mistralai/mistral-large in openrouter.yaml');
      expect(lines.findIndex((l) => l.code === 'leg.preflight.price')).toBeLessThan(lines.findIndex((l) => l.code === 'leg.start'));
      expect(progress[0]).toContain('warning, no price for mistralai/mistral-large');
      expect(result.costUsd).toEqual({ 'anthropic--claude-opus-4-7': 0.84, 'openrouter--mistralai_mistral-large': null });
      expect(result.unpriced).toEqual([{ legId: 'openrouter--mistralai_mistral-large', message: 'no price for mistralai/mistral-large in openrouter.yaml' }]);
      const findings = readFileSync(join(result.runDir, 'findings.yaml'), 'utf-8');
      expect(findings).toContain('no price for mistralai/mistral-large in openrouter.yaml');
      expect(findings).not.toContain('no price available for a billed call');
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
