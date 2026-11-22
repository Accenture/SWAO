// #4256 (TUI-12): the Landing Zone Catalog Assessment finish screen on
// FinishPanel: verdicts in one row, blocked targets with their gap type, the
// real run folder (never a placeholder), What next entries, no double dash.
import { describe, it, expect } from 'vitest';
import { lzFinishGuidance, lzFinishView, lzVerdictText, type LzFinishInput } from './lz-finish.js';

const BASE: LzFinishInput = {
  app: 'sovereign-health', typeLabel: 'Landing Zone Catalog Assessment',
  targets: [{ target: 'otc/eu-de', verdict: 'needs_verification', gaps: 2 }, { target: 'stackit/eu01', verdict: 'ready', gaps: 0 }],
  overallVerdict: 'advisory', gapDetails: {},
  runFolder: 'apps/sovereign-health/wsp/runs/2026-11-09T16-11-31/', catalogueOnly: false, logAvailable: true, challenge: 'offer',
};

describe('lzFinishView (#4256)', () => {
  it('verdicts in one row, the real run folder, What next as entries', () => {
    const v = lzFinishView(BASE);
    expect(v.title).toBe('Landing Zone Catalog Assessment complete');
    expect(v.level).toBe('warn');
    expect(v.rows).toEqual([
      { label: 'App', value: 'sovereign-health' },
      { label: 'Targets', value: '2 (lz_fit)' },
      { label: 'Verdict', value: 'otc/eu-de NEEDS_VERIFICATION (2 gaps), stackit/eu01 READY' },
      { label: 'Outputs', value: 'apps/sovereign-health/wsp/runs/2026-11-09T16-11-31/' },
    ]);
    expect(v.next.map((n) => n.label)).toEqual(['LZ Sovereignty Challenge', 'View the log']);
    expect(JSON.stringify(v)).not.toMatch(/<ts>|<latest>| -- /);
  });

  it('a blocked target is a fail item with its gap type; partial coverage and catalogue only are warn items', () => {
    const v = lzFinishView({
      ...BASE,
      targets: [{ target: 'aws/eu-central-1', verdict: 'sovereignty_blocked', gaps: 1 }],
      gapDetails: { 'eu-central-1': { gapType: 'sovereignty', sovereigntyStatement: 'Not EU-owned.', assessmentMode: 'partial' } },
      catalogueOnly: true, runFolder: null, challenge: 'no-llm',
    });
    expect(v.items.map((i) => [i.level, i.label])).toEqual([['fail', 'aws/eu-central-1'], ['warn', 'aws/eu-central-1'], ['warn', 'Catalogue only']]);
    expect(v.items[0]!.reason).toContain('BLOCKED');
    expect(v.rows.some((r) => r.label === 'Outputs')).toBe(false);
    expect(v.next.map((n) => n.value)).toEqual(['log']);
    const g = lzFinishGuidance({ ...BASE, targets: [{ target: 'aws/eu-central-1', verdict: 'sovereignty_blocked', gaps: 1 }], gapDetails: { 'eu-central-1': { gapType: 'sovereignty', sovereigntyStatement: 'Not EU-owned.', assessmentMode: 'full' } }, overallVerdict: 'sovereignty_blocked', challenge: 'no-llm' });
    expect(g.what).toContain('Sovereignty statement: Not EU-owned.');
    expect(g.what).toContain('needs an LLM');
    expect(g.cli).toBe('swao publish --app sovereign-health');
  });

  it('all ready is level ok; the overall verdict stands in when no per-target verdicts were read', () => {
    expect(lzFinishView({ ...BASE, targets: [{ target: 'otc/eu-de', verdict: 'ready', gaps: 0 }] }).level).toBe('ok');
    const single = lzFinishView({ ...BASE, targets: [], overallVerdict: 'blocked' });
    expect(single.rows.find((r) => r.label === 'Verdict')?.value).toBe('BLOCKED');
    expect(single.level).toBe('warn');
    expect(lzVerdictText('unknown')).toContain('run folder');
  });
});
