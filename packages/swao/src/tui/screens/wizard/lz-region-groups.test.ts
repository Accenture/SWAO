// #4494 (owner decision 2026-11-16): regions grouped under country and area
// headings, no geography rows; a heading ticks its regions; a stored
// geography reads as the region a run resolves it to. Same rule for every
// catalogue: the bundled OTC and AWS catalogues are grouped here.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LzGeographyRegion } from '@swao/module-landing-zone';
import { groupLzRegions, regionRowText, regionsForConfigured, rowMark, toggleRow } from './lz-region-groups.js';
import { defaultLzRegionLoader } from '../../../setup/branches/lz-catalog-checks.js';

const OTC: LzGeographyRegion[] = [
  { id: 'eu-nl', sovereignty: { residency_country: 'NL' } },
  { id: 'eu-de', sovereignty: { residency_country: 'DE' } },
];

function bundled(provider: string): LzGeographyRegion[] {
  const ws = mkdtempSync(join(tmpdir(), 'swao-4494-'));
  try { return defaultLzRegionLoader(provider, ws) as LzGeographyRegion[]; } finally { rmSync(ws, { recursive: true, force: true }); }
}

describe('groupLzRegions (#4494)', () => {
  it('OTC: Europe over Germany (first) and the Netherlands; each region once, no geography row', () => {
    const rows = groupLzRegions(OTC);
    expect(rows.map((r) => regionRowText(r, new Set()))).toEqual([
      '[ ] Europe',
      '  [ ] Germany (DE)',
      '    [ ] eu-de',
      '  [ ] Netherlands (NL)',
      '    [ ] eu-nl',
    ]);
  });

  it('a heading ticks all its regions, and unticks them when all are ticked; the mark shows some', () => {
    const rows = groupLzRegions(OTC);
    const europe = rows[0]!;
    const all = toggleRow(europe, new Set(['eu-de']));
    expect([...all].sort()).toEqual(['eu-de', 'eu-nl']);
    expect(rowMark(europe, new Set(['eu-de']))).toBe('-');
    expect(rowMark(europe, all)).toBe('x');
    expect(toggleRow(europe, all).size).toBe(0);
  });

  it('a stored geography reads as its resolved region; a region id as itself; an unknown value as none', () => {
    expect(regionsForConfigured(['germany'], OTC)).toEqual(['eu-de']);
    expect(regionsForConfigured(['europe'], OTC)).toEqual(['eu-de']);
    expect(regionsForConfigured(['eu-nl', 'mars'], OTC)).toEqual(['eu-nl']);
  });

  it('the bundled OTC and AWS catalogues: every region exactly once, headings carry regions', () => {
    for (const provider of ['otc', 'aws']) {
      const regions = bundled(provider);
      expect(regions.length, provider).toBeGreaterThan(0);
      const rows = groupLzRegions(regions);
      const listed = rows.flatMap((r) => (r.kind === 'region' ? [r.region] : []));
      expect([...listed].sort(), provider).toEqual(regions.map((r) => r.id).sort());
      expect(rows.some((r) => r.kind === 'country'), provider).toBe(true);
      for (const r of rows) if (r.kind !== 'region') expect(r.regions.length, `${provider} ${r.label}`).toBeGreaterThan(0);
    }
    const aws = groupLzRegions(bundled('aws')).filter((r) => r.kind !== 'region').map((r) => r.label);
    expect(aws).toContain('Europe');
    expect(aws).toContain('Germany (DE)');
  });
});
