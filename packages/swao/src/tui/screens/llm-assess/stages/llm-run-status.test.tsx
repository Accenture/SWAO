// #4243: a failed or cancelled LLM Assessment never reads "complete" on screen.
//
// - RunningStage counts a failed leg as finished (the bar moves on) and shows
//   it in red with its reason;
// - ResultStage says failed / partial / cancelled with the per-leg reason and
//   "What next"; empty scores read "not measured", never "--".

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import type { OrchestrationResult, ResolvedLeg } from '@swao/module-llm-assessment';
import { isLegEndLine, isFailedLine, llmRunState, RunningStage } from './RunningStage.js';
import { ResultStage, finishTitle, llmFinishView, LLM_RUN_AGAIN, TABLE_KEYS, RELATIVE_SCORES_SENTENCE } from './ResultStage.js';
import { FINISH_MAIN_MENU, ERROR_BACK, RUN_PANEL_KEYS, formatKeyHints } from '@swao/tui-kit';
import { renderAt, widest } from '../../../../__tests__/helpers/render-at.js';
import { LlmResultTable } from '../LlmResultTable.js';

const legs: ResolvedLeg[] = [
  { id: 'anthropic--model-a', connector: 'anthropic', model: 'model-a', primary: true, costSource: 'billed' },
  { id: 'openrouter--model-b', connector: 'openrouter', model: 'model-b', primary: false, costSource: 'billed' },
];
const [a, b] = [legs[0]!.id, legs[1]!.id];

function result(status: OrchestrationResult['status'], outcomes: OrchestrationResult['legs']): OrchestrationResult {
  return {
    runDir: '/ws/llm-assessments/swao/2026-11-09T16-27-16',
    manifestPath: '/ws/llm-assessments/swao/2026-11-09T16-27-16/manifest.yaml',
    records: [],
    groups: [{ group: 'performance', score: { [a]: null, [b]: null }, rank: { [a]: null, [b]: null }, light: {} } as never],
    final: { score: { [a]: null, [b]: null }, rank: { [a]: null, [b]: null }, weights: {}, partial: {} } as never,
    findingsCount: 4,
    status,
    legs: outcomes,
  };
}

describe('RunningStage leg line helpers (#4243)', () => {
  it('a failed or cancelled leg ends the leg; a challenge complete line does not', () => {
    expect(isLegEndLine('leg a: complete (12 calls)')).toBe(true);
    expect(isLegEndLine('leg a: failed: exit 1: no usable live run')).toBe(true);
    expect(isLegEndLine('leg a: cancelled: cancelled by the operator')).toBe(true);
    expect(isLegEndLine('leg a: challenge complete (5 agents)')).toBe(false);
    expect(isLegEndLine('leg a: starting (anthropic / model-a)')).toBe(false);
  });

  it('failed lines are recognised for red rendering', () => {
    expect(isFailedLine('leg a: failed: exit 1')).toBe(true);
    expect(isFailedLine('leg a: complete (3 calls)')).toBe(false);
  });
});

describe('ResultStage finish screen (#4243)', () => {
  it('finishTitle: only a complete run says complete', () => {
    expect(finishTitle('complete', 2, 2).text).toBe('Assessment complete.');
    expect(finishTitle('failed', 0, 2)).toEqual({ text: 'Assessment failed: no LLM Provider completed, the comparison is incomplete.', tone: 'error' });
    expect(finishTitle('partial', 1, 2).text).toContain('1 of 2');
    expect(finishTitle('cancelled', 0, 2).text).toContain('cancelled');
  });

  it('a run where every leg failed shows failed, the per-leg reason and What next, no score table', () => {
    const r = result('failed', [
      { id: a, status: 'failed', exit: 1, calls: 0, wall_clock_ms: 260_000, reason: 'exit 1: --lz-source live: no usable live run', workspace: '/tmp/swao-leg-a' },
      { id: b, status: 'failed', exit: 1, calls: 0, wall_clock_ms: 244_000, reason: 'exit 1: --lz-source live: no usable live run' },
    ]);
    const { lastFrame } = render(<ResultStage stage="done" result={r} legs={legs} errorMsg="" guidanceOpen={false} onGuidanceOpenChange={() => undefined} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Assessment failed');
    expect(frame).not.toContain('Assessment complete');
    expect(frame).toContain('no usable live run');
    expect(frame).toContain('What next');
    expect(frame).toContain('4 finding(s)');
    expect(frame).not.toContain('FINAL');
    expect(frame).not.toMatch(/-- \(--\)/);
  });

  it('a partial run keeps the table; empty scores read not measured', () => {
    const r = result('partial', [
      { id: a, status: 'complete', exit: 0, calls: 10, wall_clock_ms: 1000 },
      { id: b, status: 'failed', exit: 1, calls: 0, wall_clock_ms: 1000, reason: 'exit 1' },
    ]);
    const { lastFrame } = render(<ResultStage stage="done" result={r} legs={legs} errorMsg="" guidanceOpen={false} onGuidanceOpenChange={() => undefined} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Assessment partial');
    expect(frame).toContain('not measured');
  });

  it('LlmResultTable never renders "--" for a missing score', () => {
    const r = result('partial', []);
    const { lastFrame } = render(<LlmResultTable result={r} legs={legs} />);
    expect(lastFrame() ?? '').not.toContain('--');
  });
});

// #4256 (TUI-12): the LLM finish screen is FinishPanel; a run in which every leg
// failed has a red title, the per-leg reason and "not measured" scores.
describe('LLM finish screen on FinishPanel (#4256)', () => {
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 50));
  const allFailed = (): OrchestrationResult => result('failed', [
    { id: a, status: 'failed', exit: 1, calls: 0, wall_clock_ms: 1000, reason: 'exit 1: no usable live run' },
    { id: b, status: 'cancelled', exit: 1, calls: 0, wall_clock_ms: 1000, reason: 'cancelled by the operator' },
  ]);

  it('llmFinishView: every leg failed is level fail, per-leg reasons, did not finish instead of a score, no score table entry', () => {
    const v = llmFinishView('failed', allFailed(), legs);
    expect(v.level).toBe('fail');
    expect(v.title).toBe('LLM Assessment failed: no LLM Provider completed, the comparison is incomplete');
    // #4474: a leg that did not finish has no score; it says so with its completed calls.
    expect(v.rows.slice(0, 2).map((r) => r.value)).toEqual(['did not finish, 0 calls completed', 'cancelled, 0 calls completed']);
    expect(v.items.map((i) => [i.level, i.reason])).toEqual([['fail', 'failed: exit 1: no usable live run'], ['cancelled', 'cancelled: cancelled by the operator']]);
    expect(v.next.map((n) => n.value)).toEqual([LLM_RUN_AGAIN]);
    expect(llmFinishView('complete', result('complete', [{ id: a, status: 'complete', exit: 0, calls: 1, wall_clock_ms: 1 }]), legs).level).toBe('ok');
    expect(llmFinishView('partial', result('partial', [{ id: a, status: 'complete', exit: 0, calls: 1, wall_clock_ms: 1 }]), legs).next.map((n) => n.label)).toEqual(['Show the score table', 'Run again with the same LLM Providers']);
  });

  // #4372 follow-up: the finish screen shows the run cost with the unpriced calls.
  it('llmFinishView: a Cost row says plus N unpriced calls, or not measured when no call has a price', () => {
    const totals = (cost: number, calls: number, unpriced: number) => ({
      call_count: calls, cost_usd: cost, assessment_calls: calls, assessment_cost_usd: cost, challenge_calls: 0, challenge_cost_usd: 0,
      lz_challenge_calls: 0, lz_challenge_cost_usd: 0, unpriced_calls: unpriced, assessment_unpriced_calls: unpriced, challenge_unpriced_calls: 0, lz_challenge_unpriced_calls: 0,
    });
    const done = [{ id: a, status: 'complete' as const, exit: 0, calls: 5, wall_clock_ms: 1 }, { id: b, status: 'complete' as const, exit: 0, calls: 5, wall_clock_ms: 1 }];
    const cost = (t: ReturnType<typeof totals>) => llmFinishView('complete', { ...result('complete', done), totals: t }, legs).rows.find((r) => r.label === 'Cost')?.value;
    expect(cost(totals(0.84, 10, 5))).toBe('0.8400 USD plus 5 unpriced calls');
    expect(cost(totals(0.84, 10, 1))).toBe('0.8400 USD plus 1 unpriced call');
    expect(cost(totals(0.84, 10, 0))).toBe('0.8400 USD');
    expect(cost(totals(0, 10, 10))).toBe('not measured');
    // A result without totals (older callers) has no Cost row.
    expect(llmFinishView('complete', result('complete', done), legs).rows.some((r) => r.label === 'Cost')).toBe(false);
  });

  for (const columns of [100, 80]) {
    it(`a failed run at ${columns} columns: red title, reasons, one key hint line, nothing wider than the frame`, () => {
      const r = renderAt(<ResultStage stage="done" result={allFailed()} legs={legs} errorMsg="" guidanceOpen={false} onGuidanceOpenChange={() => undefined} />, columns, 50);
      const lines = r.lines().map((l) => l.trimEnd());
      expect(lines[0]).toBe('LLM Assessment failed: no LLM Provider completed, the comparison is incomplete');
      expect(lines.join('\n')).toContain('no usable live run');
      expect(lines.filter((l) => l.includes('Enter'))).toEqual(['↑↓ select   Enter open   Esc abort']);
      expect(lines.join('\n')).not.toMatch(/Esc: back to menu| -- /);
      expect(widest(lines)).toBeLessThanOrEqual(columns);
      r.unmount();
    });
  }

  it('Show the score table opens the table; Enter closes it; Run again and Back to main menu go to onNext', async () => {
    const onNext = vi.fn();
    const onDetails = vi.fn();
    const r = renderAt(<ResultStage stage="done" result={result('partial', [{ id: a, status: 'complete', exit: 0, calls: 1, wall_clock_ms: 1 }, { id: b, status: 'failed', exit: 1, calls: 0, wall_clock_ms: 1 }])} legs={legs} errorMsg="" guidanceOpen={false} onGuidanceOpenChange={() => undefined} onNext={onNext} onDetailsChange={onDetails} />, 100, 50);
    await tick();
    r.stdin.write('\r');
    await tick();
    expect(r.lastFrame()).toContain('Score table');
    expect(onDetails).toHaveBeenLastCalledWith(true);
    r.stdin.write('\r');
    await tick();
    expect(r.lastFrame()).toContain('What next');
    expect(onDetails).toHaveBeenLastCalledWith(false);
    r.stdin.write('\u001B[B');
    await tick();
    r.stdin.write('\r');
    await tick();
    expect(onNext).toHaveBeenLastCalledWith(LLM_RUN_AGAIN);
    r.stdin.write('\u001B[B');
    await tick();
    r.stdin.write('\r');
    await tick();
    expect(onNext).toHaveBeenLastCalledWith(FINISH_MAIN_MENU);
    r.unmount();
  });

  // #4398: the table names one key per action; the guidance says the scores are
  // relative to the legs of the run; an open guidance box takes Esc (#4230).
  it('score table: hint "Enter back" only, the relative-score sentence in the guidance, Esc with the box open closes the box only', async () => {
    const ESC = String.fromCharCode(27);
    const CTRL_G = String.fromCharCode(7);
    const onDetails = vi.fn();
    function Host(): JSX.Element {
      const [open, setOpen] = React.useState(false);
      return <ResultStage stage="done" result={result('complete', [{ id: a, status: 'complete', exit: 0, calls: 1, wall_clock_ms: 1 }, { id: b, status: 'complete', exit: 0, calls: 1, wall_clock_ms: 1 }])} legs={legs} errorMsg="" guidanceOpen={open} onGuidanceOpenChange={setOpen} onDetailsChange={onDetails} />;
    }
    const r = renderAt(<Host />, 100, 60);
    await tick();
    r.stdin.write('\r');
    await tick();
    expect(r.lastFrame()).toContain('Score table');
    expect(TABLE_KEYS).toEqual([{ key: 'Enter', verb: 'back' }]);
    expect(r.lastFrame()).toContain(formatKeyHints(TABLE_KEYS));
    expect(r.lastFrame()).not.toContain('Esc back');
    r.stdin.write(CTRL_G);
    await tick();
    const open = (r.lastFrame() ?? '').replace(/\s+/g, ' ');
    expect(open).toContain(RELATIVE_SCORES_SENTENCE.slice(0, 40));
    r.stdin.write(ESC);
    await tick();
    expect(r.lastFrame()).toContain('Score table');
    expect(r.lastFrame()).toContain('Ctrl+G for guidance');
    r.stdin.write(ESC);
    await tick();
    expect(r.lastFrame()).toContain('What next');
    expect(onDetails).toHaveBeenLastCalledWith(false);
    r.unmount();
  });

  it('an error ends on ErrorPanel with a way back', async () => {
    const onNext = vi.fn();
    const r = renderAt(<ResultStage stage="error" result={null} legs={legs} errorMsg="Error: ECONNREFUSED 127.0.0.1:11434" guidanceOpen={false} onGuidanceOpenChange={() => undefined} onNext={onNext} />, 80, 40);
    await tick();
    expect(r.lines()[0]).toBe('[fail] LLM Assessment failed');
    expect(r.lastFrame()).toContain('ECONNREFUSED');
    r.stdin.write('\u001B[B');
    await tick();
    r.stdin.write('\r');
    await tick();
    expect(onNext).toHaveBeenLastCalledWith(ERROR_BACK);
    r.unmount();
  });
});

// #4256 (Design 126 sections 4.6 and 7.6): the running stage on RunPanel.
describe('RunningStage on RunPanel (#4256)', () => {
  const wait = (): Promise<void> => new Promise((r) => setTimeout(r, 40));
  const progress = ['leg ' + a + ': starting (anthropic / model-a)', 'leg ' + a + ': failed: exit 1: no usable live run', 'leg ' + b + ': starting (openrouter / model-b)'];

  it('llmRunState: the stage name and the guidance follow the run (preparing, provider n, synthesis)', () => {
    expect(llmRunState(legs, [], 'copying the app').label).toBe('Preparing: copying the app');
    expect(llmRunState(legs, [], null).guidance.title).toBe('Preparing the run');
    const mid = llmRunState(legs, progress);
    expect(mid).toMatchObject({ completed: 1, total: 2, synthesising: false });
    expect(mid.label).toContain('LLM Provider 2 of 2');
    expect(mid.label).toContain('openrouter');
    expect(mid.guidance.title).toBe('LLM Provider 2 of 2');
    const end = llmRunState(legs, [...progress, 'leg ' + b + ': complete (12 calls)']);
    expect(end).toMatchObject({ completed: 2, synthesising: true, label: 'Synthesising the results' });
    expect(end.guidance.title).toBe('Synthesising the results');
  });

  for (const columns of [100, 80]) {
    it(`running stage at ${columns} columns: title, stage, output with the failed leg, Esc cancel above the box`, () => {
      const r = renderAt(<RunningStage resolvedLegs={legs} progressLines={progress} legCallLines={[]} selectedAppId="sovereign-health" onCancel={() => undefined} guidanceOpen={false} onGuidanceOpenChange={() => undefined} />, columns);
      const ls = r.lines().map((l) => l.trimEnd());
      const text = ls.join('\n');
      expect(text).toContain('Comparing 2 LLM Providers on sovereign-health');
      expect(text).toContain('Stage 1 of 2: LLM Providers.');
      expect(text).toContain('LLM Provider 2 of 2');
      expect(text).toContain('failed');
      expect(text).toContain('no usable live run');
      const hints = ls.indexOf(formatKeyHints(RUN_PANEL_KEYS));
      expect(hints).toBeGreaterThan(ls.indexOf('Output'));
      expect(ls[hints + 1]!.startsWith(String.fromCodePoint(0x250c))).toBe(true);
      expect(text).not.toMatch(/ -- |Press Esc again|--- Output ---/);
      expect(widest(ls)).toBeLessThanOrEqual(columns);
      r.unmount();
    });
  }

  it('Esc asks (AbortDialog); Enter aborts the orchestrator and calls onCancel once', async () => {
    const abort = new AbortController();
    const onCancel = vi.fn();
    const r = renderAt(<RunningStage resolvedLegs={legs} progressLines={progress} legCallLines={[]} selectedAppId="sovereign-health" abort={abort} onCancel={onCancel} guidanceOpen={false} onGuidanceOpenChange={() => undefined} />, 100);
    await wait();
    r.stdin.write('\u001b');
    await wait();
    expect(r.lastFrame()).toContain('Cancel the run?');
    expect(abort.signal.aborted).toBe(false);
    r.stdin.write('\r');
    await wait();
    expect(abort.signal.aborted).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
    r.unmount();
  });
});

// #4453: the challenge of the last leg is its own stage text; the synthesis shows its step.
describe('RunningStage: challenge of a leg and the synthesis (#4453)', () => {
  // Orchestrator lines for leg.complete, leg.challenge.start, heartbeat, leg.challenge.complete, run.complete.
  const legA = ['leg ' + a + ': starting (anthropic / model-a)', 'leg ' + a + ': complete (12 calls)', 'leg ' + a + ': running stakeholder challenge...', 'leg ' + a + ': challenge complete (5 agents)', 'leg ' + a + ': challenges finished (1m 10s)'];
  const legBDone = [...legA, 'leg ' + b + ': starting (openrouter / model-b)', 'leg ' + b + ': complete (14 calls)'];
  const legBChallenge = [...legBDone, 'leg ' + b + ': running stakeholder challenge...'];

  it('leg.complete then leg.challenge.start: the leg is not finished, the stage names its challenge', () => {
    const s = llmRunState(legs, legBChallenge, 'leg ' + b + ': challenge running');
    expect(s).toMatchObject({ completed: 1, total: 2, synthesising: false });
    expect(s.label).toMatch(/^Challenge of .*openrouter model-b$/);
    expect(s.guidance.title).toBe('Challenge of LLM Provider 2 of 2');
  });

  it('heartbeat: the stage text carries the elapsed time of the challenge', () => {
    const s = llmRunState(legs, legBChallenge, 'leg ' + b + ': challenge running, 1m 45s');
    expect(s.label).toMatch(/^Challenge of .*openrouter model-b, 1m 45s$/);
  });

  it('leg.challenge.complete (LZ challenge still to come) keeps the challenge stage; challenges finished ends the leg', () => {
    const lzNext = [...legBChallenge, 'leg ' + b + ': challenge complete (5 agents)', 'leg ' + b + ': running LZ sovereignty challenge...'];
    expect(llmRunState(legs, lzNext, null)).toMatchObject({ completed: 1, synthesising: false });
    const done = [...lzNext, 'leg ' + b + ': LZ challenge complete (3 agents)', 'leg ' + b + ': challenges finished (1m 55s)'];
    const s = llmRunState(legs, done, 'Synthesising: comparing the results, 15s');
    expect(s).toMatchObject({ completed: 2, synthesising: true });
    expect(s.label).toBe('Synthesising the results: comparing the results, 15s');
    expect(s.guidance.title).toBe('Synthesising the results');
  });

  it('a leg without challenges is finished at its end line (no Enterprise tier)', () => {
    expect(llmRunState(legs, legBDone.filter((l) => !/challenge/.test(l)), null)).toMatchObject({ completed: 2, synthesising: true, label: 'Synthesising the results' });
  });

  it('renders the challenge stage on the run screen, no spaced double hyphen', () => {
    const r = renderAt(<RunningStage resolvedLegs={legs} progressLines={legBChallenge} statusLine={'leg ' + b + ': challenge running, 45s'} legCallLines={[]} selectedAppId="sovereign-health" onCancel={() => undefined} guidanceOpen={false} onGuidanceOpenChange={() => undefined} />, 100);
    const text = r.lines().map((l) => l.trimEnd()).join('\n');
    expect(text).toContain('Stage 1 of 2: LLM Providers.');
    expect(text).toMatch(/Challenge of .*openrouter model-b, 45s/);
    expect(text).not.toContain('Synthesising');
    expect(text).not.toMatch(/ -- /);
    r.unmount();
  });
});
