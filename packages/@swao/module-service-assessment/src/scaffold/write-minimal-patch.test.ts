// #4283 (b): the service intake writer patches the workspace .swao.yml through
// the central minimal-patch writer: the analyst key `intake` keeps its place
// and quoting, comments and blank lines stay, only the metadata keys change.

import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import { upsertServicePortfolioBlock, type ServicePortfolioMeta } from './write.js';

const META: ServicePortfolioMeta = {
  source: 'intake.xlsx',
  source_sha256: 'a'.repeat(64),
  mapping: null,
  imported_at: '2026-11-12T08:00:00.000Z',
  app_count: 2,
  row_count: 3,
  sheets: ['Apps'],
  headers: { Apps: { A: 'Name', B: 'Owner' } },
  pii_columns: ['B'],
  cluster_threshold: 3,
};

const BEFORE = [
  '# .swao.yml -- SWAO workspace configuration',
  'wsp_version: "0.9"',
  'workspace:',
  '  setup_state: { application: done, service: started }',
  '  imports_dir: "wsp/imports"   # intake files land here',
  '',
  'service_portfolio:',
  '  intake: "wsp/imports/intake.xlsx"',
  '',
  'landing_zones:',
  '  - id: "lz-a"',
  '# publication:',
  '#   cover_subtitle: "..."',
  '',
].join('\n');

describe('upsertServicePortfolioBlock through the central writer (#4283 b)', () => {
  it('adds the metadata keys and keeps intake, quoting, comments, blank lines and the other blocks', () => {
    const out = upsertServicePortfolioBlock(BEFORE, META);
    const before = BEFORE.split('\n');
    const after = out.split('\n');
    // Every original line is still there, in the same order.
    let j = 0;
    for (const line of before) {
      while (j < after.length && after[j] !== line) j++;
      expect(j, `line kept: ${line}`).toBeLessThan(after.length);
      j++;
    }
    expect(after[after.indexOf('service_portfolio:') + 1]).toBe('  intake: "wsp/imports/intake.xlsx"');
    expect(after.indexOf('landing_zones:')).toBeGreaterThan(after.indexOf('service_portfolio:'));
    expect(after[after.indexOf('landing_zones:') - 1]).toBe('');
    const doc = load(out) as { service_portfolio: Record<string, unknown> };
    expect(doc.service_portfolio).toEqual({ intake: 'wsp/imports/intake.xlsx', ...META });
  });

  it('a refresh changes only the metadata values; a second identical run changes nothing', () => {
    const first = upsertServicePortfolioBlock(BEFORE, META);
    expect(upsertServicePortfolioBlock(first, META)).toBe(first);
    const refreshed = upsertServicePortfolioBlock(first, { ...META, app_count: 5, imported_at: '2026-11-13T08:00:00.000Z' });
    const a = first.split('\n');
    const b = refreshed.split('\n');
    expect(b.length).toBe(a.length);
    const changed = a.map((l, i) => (l === b[i] ? null : b[i])).filter((l) => l !== null);
    expect(changed).toHaveLength(2);
    expect(changed.join('\n')).toMatch(/app_count: 5/);
  });

  it('keeps CRLF line ends', () => {
    const out = upsertServicePortfolioBlock(BEFORE.replace(/\n/g, '\r\n'), META);
    expect(out.includes('\r\n')).toBe(true);
    expect(out.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });
});
