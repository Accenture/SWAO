// #4472: the Stage bar of the LLM Assessment run screen moves with the passes
// of the running leg (then its challenges), the subtitle names the stage, and
// the Output lines name the pass or the challenge agent of a call and the
// pass and reason of a retry.
// #4474: a leg that did not finish has no score and no rank on the Done
// screen and in the score table; it reads "did not finish".

import { describe, it, expect } from 'vitest';
import React from 'react';
import type { OrchestrationResult, ResolvedLeg } from '@swao/module-llm-assessment';
import { llmStageShare, RunningStage } from './RunningStage.js';
import { llmFinishView } from './ResultStage.js';
import { LlmResultTable, DID_NOT_FINISH_CELL } from '../LlmResultTable.js';
import { createLegEventFormatter } from '../legEventLines.js';
import { renderAt } from '../../../../__tests__/helpers/render-at.js';
import { render } from 'ink-testing-library';

const legs: ResolvedLeg[] = [
  { id: 'anthropic--haiku', connector: 'anthropic', model: 'claude-haiku-4-5', primary: true, costSource: 'billed' },
  { id: 'openrouter--mistral', connector: 'openrouter', model: 'mistralai/mistral-large', primary: false, costSource: 'billed' },
];
const [a, b] = [legs[0]!.id, legs[1]!.id];
const legBRunning = [`leg ${a}: starting (anthropic / claude-haiku-4-5)`, `leg ${a}: complete (12 calls)`, `leg ${a}: challenges finished (1m 10s)`, `leg ${b}: starting (openrouter / mistralai/mistral-large)`];

const stageBar = (text: string): number => {
  const m = /Stage\s+\[[^\]]*\]\s+(\d+)%/.exec(text);
  return m ? parseInt(m[1]!, 10) : -1;
};

describe('Stage bar follows the passes of the running leg (#4472)', () => {
  it('llmStageShare: passes done of the pass suite, then the challenges', () => {
    // Leg 1 of 2 running, 13 passes + 2 challenge units.
    expect(llmStageShare(legs, [`leg ${a}: starting (x)`], 0, 13)).toBe(0);
    expect(llmStageShare(legs, [`leg ${a}: starting (x)`], 6, 13)).toBeCloseTo((6 / 15) / 2);
    // Its challenge runs: all passes plus one finished challenge.
    const inChallenge = [`leg ${a}: starting (x)`, `leg ${a}: complete (12 calls)`, `leg ${a}: running stakeholder challenge...`, `leg ${a}: challenge complete (5 agents)`, `leg ${a}: running LZ sovereignty challenge...`];
    expect(llmStageShare(legs, inChallenge, 13, 13)).toBeCloseTo((14 / 15) / 2);
    // Leg 2 at pass 3: one leg finished plus 3 of 15.
    expect(llmStageShare(legs, legBRunning, 3, 13)).toBeCloseTo((1 + 3 / 15) / 2);
    // Without a pass total only finished legs count.
    expect(llmStageShare(legs, legBRunning, 3, undefined)).toBe(0.5);
  });

  it('pass.complete events of a leg advance the Stage bar on the run screen; the subtitle names the stage', () => {
    const at = (passesDone: number): string => {
      const r = renderAt(<RunningStage resolvedLegs={legs} progressLines={legBRunning} legCallLines={[]} selectedAppId="sovereign-health" legPassesDone={passesDone} passTotal={13} onCancel={() => undefined} guidanceOpen={false} onGuidanceOpenChange={() => undefined} />, 100);
      const text = r.lines().join('\n');
      r.unmount();
      return text;
    };
    const t0 = at(0);
    const t8 = at(8);
    expect(t0).toContain('Stage 1 of 2: LLM Providers.');
    // Leg 2 at pass 0: 25 %; at pass 8: (1 + 8/15) / 2 of stage 1 of 2 = 38 %.
    expect(stageBar(t0)).toBe(25);
    expect(stageBar(t8)).toBe(38);
    expect(stageBar(t8)).toBeGreaterThan(stageBar(t0));
  });

  it('the synthesis is stage 2 of 2: synthesis', () => {
    const done = [...legBRunning, `leg ${b}: complete (10 calls)`];
    const r = renderAt(<RunningStage resolvedLegs={legs} progressLines={done} legCallLines={[]} selectedAppId="sovereign-health" statusLine="Synthesising: comparing the results, 15s" passTotal={13} onCancel={() => undefined} guidanceOpen={false} onGuidanceOpenChange={() => undefined} />, 100);
    const text = r.lines().join('\n');
    r.unmount();
    expect(text).toContain('Stage 2 of 2: synthesis.');
    expect(stageBar(text)).toBe(50);
  });
});

describe('the Stage bar is monotonic (#4472, owner dev11: 46 % then 39 %)', () => {
  // Leg 1 ended its passes and runs its challenge while leg 2 runs its passes (the dev11 order).
  const aChallenge = [`leg ${a}: starting (x)`, `leg ${a}: complete (12 calls)`, `leg ${a}: running stakeholder challenge...`, `leg ${b}: starting (y)`];

  it('the passes of the polled leg count for that leg only; leg 1 counts its whole suite while in its challenge', () => {
    // Leg 2 at pass 0 (its log is polled): leg 1 counts 13 of 15, leg 2 nothing.
    expect(llmStageShare(legs, aChallenge, 0, 13, b)).toBeCloseTo((13 / 15) / 2);
    // Leg 1's last pass count still on the screen state, but it belongs to leg 1: leg 2 gets nothing.
    expect(llmStageShare(legs, aChallenge, 13, 13, a)).toBeCloseTo((13 / 15) / 2);
    // Leg 2 at pass 10: both legs add up.
    expect(llmStageShare(legs, aChallenge, 10, 13, b)).toBeCloseTo((13 / 15 + 10 / 15) / 2);
  });

  it('the run screen never shows a lower Stage bar than before within a run', () => {
    const start = Date.now();
    const props = { resolvedLegs: legs, legCallLines: [], selectedAppId: 'sovereign-health', passTotal: 13, startedAt: start, onCancel: () => undefined, guidanceOpen: false, onGuidanceOpenChange: () => undefined };
    const r = render(<RunningStage {...props} progressLines={aChallenge} legPassesDone={13} legPassesLeg={a} />);
    const first = stageBar(r.lastFrame() ?? '');
    // A lower computed share (leg 2 restarts at pass 0 with fewer lines) keeps the bar where it was.
    r.rerender(<RunningStage {...props} progressLines={[`leg ${a}: starting (x)`, `leg ${b}: starting (y)`]} legPassesDone={0} legPassesLeg={b} />);
    const second = stageBar(r.lastFrame() ?? '');
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThanOrEqual(first);
    r.unmount();
  });
});

describe('Output lines name the call (#4472)', () => {
  it('pass calls, challenge agents and retries with pass and reason; passes done counted once each', () => {
    const f = createLegEventFormatter();
    expect(f.line({ code: 'assessment.pass.start', context: { num: '03', name: 'data_classification' } })).toBe('  pass 03: data_classification starting');
    expect(f.line({ code: 'provider.llm.open-llm-provider.retry', context: { attempt: 1, next_attempt: 2, max_attempts: 6, reason: 'timeout_idle_body' } }))
      .toBe('    pass 03: retry 1 of 5 after a body timeout');
    expect(f.line({ code: 'provider.llm.open-llm-provider.ok', context: { attempt: 2, latency_ms: 98_771 } })).toBe('    pass 03: LLM call complete (attempt 2, 99s)');
    expect(f.line({ code: 'assessment.pass.complete', context: { num: '03', name: 'data_classification', wall_clock_ms: 842_000 } })).toBe('  pass 03: data_classification complete (842s)');
    f.line({ code: 'assessment.pass.complete', context: { num: '03', name: 'data_classification' } });
    expect(f.passesDone()).toBe(1);
    // Challenge: the agent role comes from challenge.agent.start, the call from its caller.
    expect(f.line({ code: 'challenge.agent.start', context: { type: 'app', agent_id: 'grc-officer', role: 'GRC / Compliance Officer' } })).toBeNull();
    expect(f.line({ code: 'provider.llm.anthropic.ok', context: { attempt: 1, latency_ms: 46_000, caller: 'challenge.app.grc-officer' } }))
      .toBe('    Challenge, GRC / Compliance Officer: LLM call complete (46s)');
    expect(f.line({ code: 'provider.llm.anthropic.ok', context: { attempt: 1, latency_ms: 30_000, caller: 'challenge.lz.lzca-procurement' } }))
      .toBe('    LZ challenge, lzca-procurement: LLM call complete (30s)');
    expect(f.line({ code: 'assessment.heartbeat', context: {} })).toBeNull();
  });
});

describe('a leg that did not finish has no score and no rank (#4474)', () => {
  const failedResult: OrchestrationResult = {
    runDir: '/ws/llm-assessments/swao/2026-11-15T18-09-28',
    manifestPath: '/ws/llm-assessments/swao/2026-11-15T18-09-28/manifest.yaml',
    records: [],
    groups: [{ group: 'performance', score: { [a]: 100 }, rank: { [a]: 1 }, light: { [a]: 'ok' } }],
    final: { score: { [a]: 85 }, rank: { [a]: 1 }, weights: { quality: 1 }, partial: {}, did_not_finish: { [b]: { status: 'failed', reason: 'stall watchdog: no leg activity for 30 min, 2 calls completed', calls: 2 } } },
    findingsCount: 2,
    status: 'partial',
    legs: [
      { id: a, status: 'complete', exit: 0, calls: 12, wall_clock_ms: 600_000 },
      { id: b, status: 'failed', exit: 1, calls: 2, wall_clock_ms: 1_800_000, reason: 'stall watchdog: no leg activity for 30 min, 2 calls completed' },
    ],
  };

  it('Done screen: the complete leg has its score and rank, the failed leg reads did not finish with its calls', () => {
    const view = llmFinishView('partial', failedResult, legs);
    const rowA = view.rows[0]!;
    const rowB = view.rows[1]!;
    expect(rowA.value).toBe('85.0, rank 1');
    expect(rowB.value).toBe('did not finish, 2 calls completed');
    expect(rowB.value).not.toMatch(/rank/);
    expect(view.items[0]!.reason).toContain('stall watchdog');
  });

  it('score table: the failed leg column reads did not finish, with the reason below', () => {
    const r = renderAt(<LlmResultTable result={failedResult} legs={legs} columns={100} />, 100);
    const text = r.lines().map((l) => l.trim()).join(' ').replace(/ +/g, ' ');
    r.unmount();
    expect(text).toContain(DID_NOT_FINISH_CELL);
    expect(text).toContain('did not finish: stall watchdog: no leg activity for 30 min, 2 calls completed; not scored and not ranked');
    expect(text).toContain('85 (#1)');
    expect(text).not.toContain('(#2)');
  });
});
