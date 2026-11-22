// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- LLM Assessment estimate per LLM Provider (#4497)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Connector } from '@swao/module-llm-providers';
import { estimateLlmReview, readMeasuredLegs, reviewLegLine, reviewTotalLine, suiteCallCounts } from './review-estimate.js';

// The stored pair of the owner UAT run of 2026-11-16 (llm-assessments/swao/2026-11-16T15-58-33):
// measured 0.2451 USD (anthropic claude-haiku-4-5-20251001) + 0.0301 USD (openrouter anthropic/claude-haiku-5.5) = 0.2752 USD.
const MEASURED_TOTAL = 0.2752;
const ANTHROPIC = {
  id: 'anthropic', name: 'Anthropic Claude', protocol: 'anthropic-messages', base_url: 'https://api.anthropic.example',
  auth: { header: 'x-api-key', scheme: 'raw' },
  models: { default: 'claude-haiku-4-5-20251001', catalogue: [{ id: 'claude-haiku-4-5-20251001', cost: { input_per_million: 1, output_per_million: 5 } }] },
} as unknown as Connector;
const OPENROUTER = {
  id: 'openrouter', name: 'OpenRouter', protocol: 'openai-chat', base_url: 'https://openrouter.example/api',
  auth: { header: 'Authorization', scheme: 'bearer' },
  models: { default: 'mistralai/mistral-large-2512', catalogue: [{ id: 'anthropic/claude-haiku-5.5', discovered: true, cost: { input_per_million: 0.1, output_per_million: 0.5 } }] },
} as unknown as Connector;
const connectors = (id: string): Connector | undefined => (id === 'anthropic' ? ANTHROPIC : id === 'openrouter' ? OPENROUTER : undefined);
const PAIR = [{ connector: 'anthropic', model: 'claude-haiku-4-5-20251001' }, { connector: 'openrouter', model: 'anthropic/claude-haiku-5.5' }];

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('estimateLlmReview (#4497)', () => {
  it('the stored pair of the dev11 run, priced per model with the challenges, is within a factor of 2 of the measured 0.2752 USD', () => {
    const e = estimateLlmReview({ legs: PAIR, passCount: 14, connectors });
    expect(e.legs.map((l) => l.basis)).toEqual(['price table', 'price table']);
    expect(e.legs[0]!.calls).toEqual(suiteCallCounts(14));
    expect(e.legs[0]!.calls).toMatchObject({ pass: 5, challenge: 5, 'lz-challenge': 4 });
    expect(e.knownUsd).not.toBeNull();
    expect(e.knownUsd!).toBeGreaterThan(MEASURED_TOTAL / 2);
    expect(e.knownUsd!).toBeLessThan(MEASURED_TOTAL * 2);
    // The legs differ by their model price (no flat rate).
    expect(e.legs[0]!.usd! / e.legs[1]!.usd!).toBeCloseTo(10, 0);
    expect(reviewLegLine(e.legs[1]!)).toContain('0.1/0.5 USD per 1M tokens, connector file price');
    expect(reviewTotalLine(e)).toContain('the synthesis makes no LLM call');
  });

  it('a model without a price shows cost unknown for its leg, not a flat default', () => {
    const e = estimateLlmReview({ legs: [...PAIR, { connector: 'openrouter', model: 'vendor/unpriced' }], passCount: 14, connectors });
    expect(e.legs[2]!.usd).toBeNull();
    expect(e.legs[2]!.basis).toBe('unknown');
    expect(reviewLegLine(e.legs[2]!)).toContain('cost unknown');
    expect(reviewTotalLine(e)).toContain('plus 1 LLM Provider(s) with cost unknown');
    expect(reviewTotalLine(estimateLlmReview({ legs: [{ connector: 'x', model: 'y' }], passCount: 14, connectors }))).toBe('cost unknown (no price for any model)');
  });

  it('an earlier complete run of the same connector and model gives the measured cost and the call counts', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-4497-'));
    dirs.push(ws);
    // The orchestrator layout: llm-assessments/swao/<run>, the app in manifest.yaml.
    const run = join(ws, 'llm-assessments', 'swao', '2026-11-16T15-58-33');
    mkdirSync(join(run, 'calls'), { recursive: true });
    writeFileSync(join(run, 'manifest.yaml'), JSON.stringify({ app_id: 'demo', run_ts: '2026-11-16T15-58-33' }, null, 2));
    // A newer run of another app with the same leg must not be used.
    const other = join(ws, 'llm-assessments', 'swao', '2026-11-17T09-00-00');
    mkdirSync(join(other, 'calls'), { recursive: true });
    writeFileSync(join(other, 'manifest.yaml'), JSON.stringify({ app_id: 'other-app' }));
    writeFileSync(join(other, 'status.json'), JSON.stringify({ status: 'complete', legs: [{ id: 'anthropic--claude-haiku-4-5-20251001', status: 'complete' }] }));
    writeFileSync(join(other, 'calls', 'anthropic--claude-haiku-4-5-20251001.ndjson'), JSON.stringify({ leg: { id: 'anthropic--claude-haiku-4-5-20251001', connector: 'anthropic', model: 'claude-haiku-4-5-20251001' }, pass_id: '03-data', cost_usd: { computed: 9 } }) + String.fromCharCode(10));
    const leg = { id: 'anthropic--claude-haiku-4-5-20251001', connector: 'anthropic', model: 'claude-haiku-4-5-20251001' };
    const rows = [
      { leg, pass_id: '03-data', call_site: 'data', cost_usd: { computed: 0.02 } },
      { leg, pass_id: 'challenge-finops-lead', call_site: 'challenge', cost_usd: { computed: 0.03 } },
      { leg, pass_id: 'challenge-lz-lzca-procurement', call_site: 'challenge', cost_usd: { computed: 0.01 } },
    ];
    writeFileSync(join(run, 'calls', 'anthropic--claude-haiku-4-5-20251001.ndjson'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    writeFileSync(join(run, 'status.json'), JSON.stringify({ status: 'complete', legs: [{ id: leg.id, status: 'complete' }] }));
    const measured = readMeasuredLegs(ws, 'demo');
    const e = estimateLlmReview({ legs: PAIR, passCount: 14, connectors, measured });
    expect(e.legs[0]).toMatchObject({ basis: 'measured', measuredRun: '2026-11-16T15-58-33', calls: { pass: 1, challenge: 1, 'lz-challenge': 1 } });
    expect(e.legs[0]!.usd).toBeCloseTo(0.06, 6);
    // The other leg takes the call counts of that run, priced.
    expect(e.legs[1]).toMatchObject({ basis: 'price table', calls: { pass: 1, challenge: 1, 'lz-challenge': 1 } });
    expect(reviewLegLine(e.legs[0]!)).toContain('measured in run 2026-11-16T15-58-33');
  });
});
