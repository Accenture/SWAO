import { describe, it, expect } from 'vitest';
import { formatPassStatsTable, passSignalsEmitted } from './pass-stats-table.js';
import type { PassStat } from '../schema/index.js';

const stats: PassStat[] = [
  { pass: 'inventory', num: '01', wall_clock_ms: 1000, signals_emitted: 7, iter: 1 },
  { pass: 'dynamic_analysis', num: '10', wall_clock_ms: 90_000, signals_emitted: 7, items_emitted: 60, iter: 1 },
  { pass: 'blocks', num: '12', wall_clock_ms: 2000, signals_emitted: 3, items_emitted: 3, iter: 1 },
] as PassStat[];

describe('Pass statistics (#4464)', () => {
  it('passSignalsEmitted sums the rows of one pass', () => {
    expect(passSignalsEmitted(stats, '10')).toBe(7);
    expect(passSignalsEmitted([...stats, { ...stats[1]!, signals_emitted: 2 }], '10')).toBe(9);
    expect(passSignalsEmitted(stats, '23')).toBe(0);
  });

  it('the Pass 10 row shows its signals and the crawled screens as Items; Signals sums to the total', () => {
    const lines = formatPassStatsTable(stats, 93_000, 17);
    expect(lines.find(l => l.includes('Signals') && l.includes('Items'))).toBeDefined();
    const p10 = lines.find(l => l.includes('dynamic'))!;
    expect(p10).toMatch(/\s7\s+60\s/);
    const p12 = lines.find(l => l.includes('blocks'))!;
    expect(p12).not.toMatch(/\s3\s+3\s/);
    expect(lines.find(l => l.startsWith('Total'))).toMatch(/\s17\s/);
    expect(lines.join('\n')).not.toContain(' -- ');
  });
});
