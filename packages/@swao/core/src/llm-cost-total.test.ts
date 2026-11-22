import { describe, expect, it } from 'vitest';
import { COST_NOT_MEASURED, costAllUnpriced, formatCostTotal, unpricedCallsSuffix } from './llm-cost-total.js';

describe('#4372 formatCostTotal: totals carry the unpriced calls', () => {
  it('a fully priced total has no suffix', () => {
    expect(formatCostTotal({ usd: 0.84, calls: 5, unpricedCalls: 0 })).toBe('0.8400 USD');
  });
  it('a partly priced total says plus N unpriced calls (singular and plural)', () => {
    expect(formatCostTotal({ usd: 0.84, calls: 8, unpricedCalls: 3 })).toBe('0.8400 USD plus 3 unpriced calls');
    expect(formatCostTotal({ usd: 0.84, calls: 8, unpricedCalls: 1 })).toBe('0.8400 USD plus 1 unpriced call');
  });
  it('a total of only unpriced calls is not measured, never 0 USD', () => {
    expect(formatCostTotal({ usd: 0, calls: 5, unpricedCalls: 5 })).toBe(COST_NOT_MEASURED);
    expect(formatCostTotal({ usd: null, calls: 5, unpricedCalls: 0 })).toBe(COST_NOT_MEASURED);
  });
  it('uses the caller format', () => {
    expect(formatCostTotal({ usd: 1.5, calls: 3, unpricedCalls: 2, format: (v) => `$${v.toFixed(2)}` })).toBe('$1.50 plus 2 unpriced calls');
  });
  it('a total without counts (older runs) shows the value', () => {
    expect(formatCostTotal({ usd: 0.5 })).toBe('0.5000 USD');
    expect(unpricedCallsSuffix(undefined)).toBe('');
    expect(costAllUnpriced(0, 0)).toBe(false);
  });
});
