// #4372: short candidate labels, the measured USD below the cost score, a
// legend with the full ids, and five candidates that fit at 80 and 100
// columns.

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import type { OrchestrationResult, ResolvedLeg } from '@swao/module-llm-assessment';
import { LlmResultTable, resultTableLayout, costUsdCell, legCostLine, legCallTimes, secondsCell } from './LlmResultTable.js';

const MODELS: Array<[string, string]> = [
  ['anthropic', 'claude-haiku-4-5-20251001'],
  ['openrouter', 'mistralai/mistral-large'],
  ['anthropic', 'claude-opus-4-7'],
  ['openrouter', 'meta-llama/llama-3.3-70b-instruct'],
  ['ollama', 'qwen3-coder'],
];
const legs: ResolvedLeg[] = MODELS.map(([connector, model], i) => ({
  id: `${connector}--${model.replace(/[^a-zA-Z0-9.-]/g, '_')}`, connector, model, primary: i === 0, costSource: 'billed',
}));
const ids = legs.map((l) => l.id);
const per = (f: (i: number) => number | null): Record<string, number | null> => Object.fromEntries(ids.map((id, i) => [id, f(i)]));

const result: OrchestrationResult = {
  runDir: '/mock/run', manifestPath: '/mock/run/manifest.yaml', records: [],
  groups: [
    { group: 'quality-content', score: per((i) => 90 - i * 10), rank: per((i) => i + 1), light: {} },
    { group: 'cost', score: per((i) => (i === 1 ? null : i === 2 ? 0 : 100 - i * 10)), rank: per((i) => (i === 1 ? null : i + 1)), light: {} },
  ],
  final: { score: per((i) => 80 - i * 5), rank: per((i) => i + 1), weights: {}, partial: {} } as OrchestrationResult['final'],
  findingsCount: 1, status: 'complete',
  legs: ids.map((id) => ({ id, status: 'complete' as const, exit: 0, calls: 5, wall_clock_ms: 1000 })),
  costUsd: per((i) => (i === 1 ? null : i === 2 ? 0.84 : 0.0123)),
  unpriced: [{ legId: ids[1]!, message: 'no price for mistralai/mistral-large in openrouter.yaml' }],
};

function lines(columns: number): string[] {
  const { lastFrame } = render(<LlmResultTable result={result} legs={legs} columns={columns} />);
  return (lastFrame() ?? '').split('\n');
}

describe('LlmResultTable (#4372)', () => {
  it('layout: five candidates fit at 80 and 100 columns; labels at most 14 characters', () => {
    for (const cols of [80, 100]) {
      const l = resultTableLayout(cols, 5);
      expect(l.labelW + 5 * l.colW).toBeLessThanOrEqual(cols);
      expect(l.labelMax).toBeLessThanOrEqual(14);
      expect(l.labelMax).toBeLessThan(l.colW);
    }
    expect(resultTableLayout(100, 5).labelMax).toBeGreaterThanOrEqual(13);
  });

  it('five columns at 80: the header and table rows fit; short labels; no run-together names', () => {
    const out = lines(80);
    const header = out.find((l) => l.startsWith('Dimension'))!;
    expect(header).toContain('Haiku 4.5');
    expect(header).toContain('Opus 4.7');
    expect(header).toContain('Mistral Large');
    expect(resultTableLayout(80, 5).compact).toBe(true);
    expect(header).not.toContain('20251001');
    expect(header).not.toContain('mistralai/');
    for (const l of out.slice(0, out.findIndex((x) => x.startsWith('FINAL')) + 1)) expect(l.length).toBeLessThanOrEqual(80);
  });

  it('100 columns: Mistral Large in full; cost USD row below the cost score; legend and unpriced guidance', () => {
    const out = lines(100);
    const frame = out.join('\n');
    expect(out.find((l) => l.startsWith('Dimension'))).toContain('Mistral Large');
    const costIdx = out.findIndex((l) => l.startsWith('cost '));
    expect(out[costIdx + 1]).toContain('cost USD');
    expect(out[costIdx + 1]).toContain('0.8400 USD');
    expect(out[costIdx + 1]).toContain('not measured');
    expect(frame).toContain('Haiku 4.5: anthropic claude-haiku-4-5-20251001');
    expect(frame).toContain('no price for mistralai/mistral-large in openrouter.yaml');
    expect(frame).toContain('content');
    expect(frame).not.toContain('--');
  });

  it('costUsdCell: USD, +N for unpriced calls, not measured', () => {
    expect(costUsdCell(0.84)).toBe('0.8400 USD');
    expect(costUsdCell(12.5)).toBe('12.50 USD');
    expect(costUsdCell(0.2, 2, 5)).toBe('0.2000 USD +2');
    expect(costUsdCell(null, 5, 5)).toBe('not measured');
    expect(costUsdCell(0, 5, 5)).toBe('not measured');
    expect(costUsdCell(undefined)).toBe('not measured');
    expect(legCostLine(0.2, 2, 5)).toBe('0.2000 USD plus 2 unpriced calls');
  });

  // #4372 follow-up: a leg with priced and unpriced calls never reads as fully measured.
  it('a mixed leg at 80 columns with five candidates: +N in the cell, the full line below, run total with the unpriced calls', () => {
    const mixed: OrchestrationResult = {
      ...result,
      unpricedCalls: Object.fromEntries(ids.map((id, i) => [id, i === 1 ? 5 : i === 3 ? 2 : 0])),
      totals: {
        call_count: 30, cost_usd: 0.9, assessment_calls: 25, assessment_cost_usd: 0.88, challenge_calls: 5, challenge_cost_usd: 0.02,
        lz_challenge_calls: 0, lz_challenge_cost_usd: 0, unpriced_calls: 8, assessment_unpriced_calls: 7, challenge_unpriced_calls: 1, lz_challenge_unpriced_calls: 0,
      },
    };
    const { lastFrame } = render(<LlmResultTable result={mixed} legs={legs} columns={80} />);
    const out = (lastFrame() ?? '').split('\n');
    const frame = out.join('\n');
    const costRow = out.find((l) => l.startsWith('cost USD'))!;
    expect(costRow).toContain('+2');
    expect(costRow).toContain('not measured');
    // #4372 decision 1 (owner 2026-11-14): any unpriced call, not ranked on cost.
    expect(frame).toContain('Llama 3.3 70b: cost 0.0123 USD plus 2 unpriced calls, not ranked on cost');
    const scoreRow = out.find((l) => l.startsWith('cost ') && !l.startsWith('cost USD'))!;
    expect(scoreRow).not.toContain('70 (#4)');
    expect(scoreRow.match(/not measured/g)?.length).toBe(2);
    expect(frame).toContain('Mistral Large: no price for mistralai/mistral-large in openrouter.yaml, the cost is not measured');
    expect(frame).toContain('Run cost: 0.9000 USD plus 8 unpriced calls (30 call(s), assessment and challenge).');
    for (const l of out.slice(0, out.findIndex((x) => x.startsWith('FINAL')) + 1)) expect(l.length).toBeLessThanOrEqual(80);
  });

  // #4398: the relative performance score gets its raw values below it: the
  // total assessment call time per leg and the slowest call (challenge calls left out).
  it('performance: call time and slowest call rows under the score at 80 and 100 columns', () => {
    const rec = (leg: string, ms: number, pass = '04-ctx') => ({ leg: { id: leg, connector: 'c', model: 'm' }, pass_id: pass, timing: { started: '2026-11-14T00:00:00Z', total_ms: ms } });
    const records = [
      rec(ids[0]!, 30_000), rec(ids[0]!, 75_000),
      rec(ids[1]!, 413_000), rec(ids[1]!, 123_000), rec(ids[1]!, 999_000, 'challenge-architect'),
      rec(ids[2]!, 4_200),
    ] as unknown as OrchestrationResult['records'];
    expect(legCallTimes(records, ids)).toEqual({
      [ids[0]!]: { totalMs: 105_000, slowestMs: 75_000, calls: 2 },
      [ids[1]!]: { totalMs: 536_000, slowestMs: 413_000, calls: 2 },
      [ids[2]!]: { totalMs: 4_200, slowestMs: 4_200, calls: 1 },
    });
    expect(secondsCell(4_200)).toBe('4.2 s');
    expect(secondsCell(536_000)).toBe('536 s');
    expect(secondsCell(undefined)).toBe('not measured');
    const perf: OrchestrationResult = {
      ...result, records,
      groups: [...result.groups, { group: 'performance', score: per((i) => (i === 1 ? 0 : 100)), rank: per((i) => (i === 1 ? 2 : 1)), light: {} }],
    };
    for (const cols of [80, 100]) {
      const { lastFrame } = render(<LlmResultTable result={perf} legs={legs} columns={cols} />);
      const out = (lastFrame() ?? '').split(String.fromCharCode(10));
      const at = out.findIndex((l) => /^perf/.test(l));
      expect(out[at + 1]).toMatch(/^call time/);
      expect(out[at + 1]).toContain('105 s');
      expect(out[at + 1]).toContain('536 s');
      expect(out[at + 1]).toContain('4.2 s');
      expect(out[at + 1]).toContain('not measured');
      expect(out[at + 2]).toMatch(/^slowest/);
      expect(out[at + 2]).toContain('75 s');
      expect(out[at + 2]).toContain('413 s');
      expect(out[at + 2]).not.toContain('999 s');
      for (const l of out.slice(0, out.findIndex((x) => x.startsWith('FINAL')) + 1)) expect(l.length).toBeLessThanOrEqual(cols);
    }
  });
});
