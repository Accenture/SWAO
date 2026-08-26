// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Leg-mode recorder bridge tests (#1421).

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLegRecorderFromEnv, LEG_ENV } from './leg-recorder.js';
import { CallRecordSchema } from './call-record.js';
import type { UsageSnapshot } from './recording-provider.js';

describe('createLegRecorderFromEnv (#1421)', () => {
  it('is null outside leg mode (no env)', () => {
    expect(createLegRecorderFromEnv({})).toBeNull();
  });

  it('streams schema-valid NDJSON records per pass with the leg identity from env', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-legrec-'));
    try {
      const sink = join(dir, 'sub', 'calls.ndjson');
      const recorder = createLegRecorderFromEnv({
        [LEG_ENV.RECORD]: sink,
        [LEG_ENV.LEG_ID]: 'or--deepseek',
        [LEG_ENV.CONNECTOR]: 'openrouter',
        [LEG_ENV.MODEL]: 'deepseek/deepseek-v4-flash',
        [LEG_ENV.CONNECTOR_SHA256]: 'abc123',
        [LEG_ENV.COST_SOURCE]: 'billed',
      })!;
      expect(recorder).not.toBeNull();

      let usage: UsageSnapshot = { input_tokens: 0, output_tokens: 0, cost_usd: 0, call_count: 0 };
      const inner = {
        name: 'open-llm-provider',
        model: 'deepseek/deepseek-v4-flash',
        async complete(_p: string): Promise<string> {
          usage = {
            input_tokens: usage.input_tokens + 500,
            output_tokens: usage.output_tokens + 200,
            cost_usd: usage.cost_usd + 0.001,
            call_count: usage.call_count + 1,
          };
          return '{"ok": true}';
        },
      };

      recorder.setPass('03-data', 'data_classification');
      const wrapped = recorder.wrap(inner, () => usage);
      // Shape preserved: pass code reading provider props keeps working.
      expect(wrapped.name).toBe('open-llm-provider');
      expect(wrapped.model).toBe('deepseek/deepseek-v4-flash');

      await wrapped.complete('classify this');
      recorder.setPass('09-synth', 'synthesis');
      await wrapped.complete('synthesise that');

      const lines = readFileSync(sink, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(2);
      const records = lines.map((l) => CallRecordSchema.parse(JSON.parse(l)));
      expect(records[0]!.pass_id).toBe('03-data');
      expect(records[0]!.leg.id).toBe('or--deepseek');
      expect(records[0]!.leg.connector_sha256).toBe('abc123');
      expect(records[0]!.tokens.prompt).toBe(500);
      expect(records[1]!.pass_id).toBe('09-synth');
      expect(records[1]!.call_site).toBe('synthesis');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults cost source to billed and tolerates missing identity env', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-legrec2-'));
    try {
      const sink = join(dir, 'calls.ndjson');
      const recorder = createLegRecorderFromEnv({ [LEG_ENV.RECORD]: sink })!;
      recorder.setPass('04-ctx', 'context_ingestion');
      const wrapped = recorder.wrap(
        { async complete(): Promise<string> { return 'plain text'; } },
        () => ({ input_tokens: 1, output_tokens: 1, cost_usd: 0, call_count: 1 }),
      );
      await wrapped.complete('x');
      const record = CallRecordSchema.parse(JSON.parse(readFileSync(sink, 'utf-8').trim()));
      expect(record.cost_usd.source).toBe('billed');
      expect(record.leg.connector).toBe('unknown');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
