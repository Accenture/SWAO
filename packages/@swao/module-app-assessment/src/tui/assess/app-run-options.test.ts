// #4255 (Design 126 section 7.10): the run options of the Application flow
// are list entries (were the letter keys S, C, P and I of the passes step).
import { describe, it, expect } from 'vitest';
import { RUN_OPT_CONTINUE, RUN_OPT_ITER, RUN_OPT_SOURCE, appRunOptions } from './app-run-options.js';
import { APP_PHASE_STEP, appBackPhase, isAppPreRunPhase } from './app-flow.js';

describe('Application run options (#4255)', () => {
  it('Continue first; every entry names its state and carries a guidance entry', () => {
    const o = appRunOptions({ showStats: true, useCassette: false, sourcePath: '', iter: '1' });
    expect(o[0]!.value).toBe(RUN_OPT_CONTINUE);
    expect(o.map((x) => x.label)).toEqual(['Continue', 'Stats table: on', 'LLM cache: off, always fresh', 'Source path: from .swao.yml', 'Iteration number: 1']);
    expect(o.every((x) => x.guidance && x.guidance.what.length > 0)).toBe(true);
    expect(o.map((x) => x.label).join(' ')).not.toMatch(/\([SCPI]\)| -- /);
  });

  it('the labels follow the state', () => {
    const o = appRunOptions({ showStats: false, useCassette: true, sourcePath: ' C:/src/app ', iter: '3' });
    expect(o.find((x) => x.value === RUN_OPT_SOURCE)!.label).toBe('Source path: C:/src/app');
    expect(o.find((x) => x.value === RUN_OPT_ITER)!.label).toBe('Iteration number: 3');
    expect(o[1]!.label).toBe('Stats table: off');
    expect(o[2]!.label).toBe('LLM cache: on, reuse cached answers');
  });

  it('the sub-step belongs to the Passes step; back goes to the passes, the text inputs back to the options', () => {
    expect(APP_PHASE_STEP['input-run-options']).toBe(APP_PHASE_STEP['input-passes']);
    const ctx = { hasLenses: true, reuseFromHub: false };
    expect(appBackPhase('input-run-options', ctx)).toBe('input-passes');
    expect(appBackPhase('input-source-path', ctx)).toBe('input-run-options');
    expect(appBackPhase('input-iter', ctx)).toBe('input-run-options');
    expect(appBackPhase('input-passes-save', ctx)).toBe('input-run-options');
    expect(isAppPreRunPhase('input-run-options')).toBe(true);
  });
});
