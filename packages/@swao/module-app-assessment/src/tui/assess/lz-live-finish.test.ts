// #4256 (TUI-12): the Landing Zone Live finish screen on FinishPanel: the done
// actions as What next entries (no number keys), the run folder and the
// summaries as rows, a run that did not complete at level warn with its reason.
import { describe, it, expect } from 'vitest';
import { LIVE_SHOW_OUTPUT, liveFinishGuidance, liveFinishView } from './lz-live-finish.js';

describe('liveFinishView (#4256)', () => {
  it('rows with the run folder and the summaries; the done actions without Back, then Show the run output', () => {
    const v = liveFinishView({
      lzLabel: 'otc-test (OTC, T Cloud Public)', scopes: ['platform'], frameworks: ['BSI_C5'], exitCode: 0,
      runDir: 'landing-zones/otc-test/wsp/runs/2026-11-05T08-00-00', summaryLines: ['Client LZ Policy Baseline: X 1.0.0', '  scope platform: BLOCKED'],
    });
    expect(v).toMatchObject({ title: 'Landing Zone Live Assessment complete', level: 'ok' });
    expect(v.rows).toEqual([
      { label: 'Landing zone', value: 'otc-test (OTC, T Cloud Public)' },
      { label: 'Scopes', value: 'platform' },
      { label: 'Frameworks', value: 'BSI_C5' },
      { label: 'Run folder', value: 'landing-zones/otc-test/wsp/runs/2026-11-05T08-00-00/' },
      { label: 'Summary', value: 'Client LZ Policy Baseline: X 1.0.0' },
      { label: '', value: 'scope platform: BLOCKED' },
    ]);
    expect(v.next.map((n) => n.value)).toEqual(['publish', 'catalogue-source', 'diff', 'hierarchy', 'evidence', LIVE_SHOW_OUTPUT]);
    expect(JSON.stringify(v)).not.toMatch(/\[\d\]| -- /);
  });

  it('a run that did not complete is level warn with the reason; the guidance names every entry, the CLI last', () => {
    const v = liveFinishView({ lzLabel: 'otc-test', scopes: [], frameworks: [], exitCode: 3, runDir: null, summaryLines: [] });
    expect(v).toMatchObject({ title: 'Landing Zone Live Assessment needs attention', level: 'warn' });
    expect(v.rows.find((r) => r.label === 'Result')?.value).toContain('exit 3');
    expect(v.rows.some((r) => r.label === 'Run folder')).toBe(false);
    const g = liveFinishGuidance('otc-test');
    for (const t of ['Publish Live View', 'Diff vs previous run', 'Tenant hierarchy', 'Evidence references', 'Show the run output']) expect(g.what).toContain(t);
    expect(g.cli).toBe('swao publish --lz-live otc-test; swao lz diff otc-test; swao lz hierarchy otc-test; swao lz evidence --lz otc-test');
  });
});
