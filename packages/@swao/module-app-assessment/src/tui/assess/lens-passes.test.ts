// #4499: a lens adds its passes; the run summary names the left-out default passes.
import { describe, it, expect } from 'vitest';
import { lensPassPreselection, passesLeftOut } from './lens-passes.js';
import { appFinishView } from './app-finish.js';
import { DEFAULT_PASS_KEYS } from '../../orchestrator.js';

describe('lens passes (#4499)', () => {
  it('a lens without dynamic keeps dynamic preselected and adds its own passes', () => {
    const base = [...DEFAULT_PASS_KEYS];
    expect(base).toContain('dynamic');
    const next = lensPassPreselection(base, ['INV', 'STATE', 'sbom']);
    expect(next).toContain('dynamic');
    expect(next.filter((p) => p === 'inv')).toHaveLength(1);
    expect(lensPassPreselection(['inv'], ['STATE'])).toEqual(['inv', 'state']);
    expect(lensPassPreselection(['all'], ['state'])).toEqual(['all']);
  });

  it('names the default passes a selection leaves out; none for all passes', () => {
    expect(passesLeftOut(DEFAULT_PASS_KEYS.filter((p) => p !== 'dynamic'))).toEqual(['dynamic']);
    expect(passesLeftOut(['all'])).toEqual([]);
    expect(passesLeftOut([...DEFAULT_PASS_KEYS.filter((p) => p !== 'secrets'), 'malware'])).toEqual([]);
  });

  it('the run summary has a Left out row', () => {
    const view = appFinishView({
      app: 'sovereign-health', typeLabel: 'Application Assessment', totalPasses: 13, passesLabel: 'selected', passFiles: 13, llm: 'none', skipLlm: true,
      runFolder: null, lzFit: [], blockVerdicts: {}, degradedPasses: [], skippedPassGroups: [], detailLines: [], logAvailable: false, challenge: 'none',
      leftOutPasses: ['dynamic'],
    } as Parameters<typeof appFinishView>[0]);
    expect(view.rows.find((r) => r.label === 'Left out')?.value).toBe('dynamic (not in the pass selection of this run)');
  });
});
