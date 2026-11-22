// #4498: after the last pass the run screen names the post-pass step and its progress.
import { describe, it, expect } from 'vitest';
import { runGuidance, runStage, type RunState } from './run-view.js';

const DONE: RunState = { kind: 'application', app: 'sovereign-health', passName: 'blocks', passSubLabel: '', completed: 14, total: 14 };

describe('run view post-pass step (#4498)', () => {
  it('names the step with its progress on the stage line and in the guidance', () => {
    const s = runStage({ ...DONE, postStep: { label: 'Portfolio summary', done: 106, total: 235, noun: 'apps' } }, 1000);
    expect(s.label).toBe('Finishing, Portfolio summary: 106 of 235 apps');
    expect(s).toMatchObject({ stage: 14, stages: 14, itemsDone: 106, itemsTotal: 235, itemsLabel: 'Apps' });
    expect(runGuidance({ ...DONE, postStep: { label: 'Portfolio summary', done: 106, total: 235, noun: 'apps' } }).title).toBe('Finishing: Portfolio summary');
    expect(runStage({ ...DONE, postStep: { label: 'Run manifest' } }, 1000).label).toBe('Finishing, Run manifest');
    expect(runStage(DONE, 1000).label).toContain('Pass blocks');
  });
  it('#4506: the LZ Catalog run shows the fits as done, then the post-run step with its progress', () => {
    const lz: RunState = { kind: 'landing-zone', app: 'sovereign-health', passName: 'lz_fit', passSubLabel: '', completed: 2, total: 2 };
    const s = runStage({ ...lz, postStep: { label: 'Portfolio summary', done: 25, total: 235, noun: 'apps' } }, 1000);
    expect(s.label).toBe('Finishing, Portfolio summary: 25 of 235 apps');
    expect(s).toMatchObject({ stage: 2, stages: 2, itemsDone: 25, itemsTotal: 235 });
    expect(runGuidance({ ...lz, postStep: { label: 'Portfolio summary' } }).title).toBe('Finishing: Portfolio summary');
    // while a target fits, the stage names it (the [pass] marker of the CLI)
    expect(runStage({ ...lz, completed: 0, passSubLabel: 'otc:eu-de' }, 1000)).toMatchObject({ stage: 1, label: 'lz fit, otc:eu-de' });
  });
});
