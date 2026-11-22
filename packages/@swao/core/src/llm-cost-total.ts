// #4372 (follow-up, owner 2026-11-12): one wording for a total LLM cost that
// carries the calls without a price. A call without a price is never counted
// as 0 USD silently: the total says "plus N unpriced calls", and a total of
// only unpriced calls is "not measured". Used by the orchestrator log line,
// the CLI summary, the TUI result and finish screens and the publication.

/** Text of a total without a measured value. */
export const COST_NOT_MEASURED = 'not measured';

/** `''`, `' plus 1 unpriced call'` or `' plus N unpriced calls'`. */
export function unpricedCallsSuffix(unpricedCalls: number | null | undefined): string {
  const n = typeof unpricedCalls === 'number' && Number.isFinite(unpricedCalls) ? Math.max(0, Math.floor(unpricedCalls)) : 0;
  if (n === 0) return '';
  return ` plus ${n} unpriced call${n === 1 ? '' : 's'}`;
}

/** True when every call of a total is unpriced (nothing was measured). */
export function costAllUnpriced(callCount: number | null | undefined, unpricedCalls: number | null | undefined): boolean {
  return typeof callCount === 'number' && typeof unpricedCalls === 'number' && callCount > 0 && unpricedCalls >= callCount;
}

export interface CostTotalInput {
  /** Sum of the priced calls in USD; null or undefined = nothing measured. */
  usd: number | null | undefined;
  /** Calls behind the total (all of them, priced or not). */
  calls?: number | null;
  /** Calls of the total without a price. */
  unpricedCalls?: number | null;
  /** Formats the USD value; default `0.1234 USD`. */
  format?: (usd: number) => string;
}

/** `0.8400 USD`, `0.8400 USD plus 3 unpriced calls` or `not measured`. */
export function formatCostTotal(input: CostTotalInput): string {
  const { usd, calls, unpricedCalls } = input;
  if (usd === null || usd === undefined || !Number.isFinite(usd) || costAllUnpriced(calls, unpricedCalls)) return COST_NOT_MEASURED;
  const format = input.format ?? ((v: number) => `${v.toFixed(4)} USD`);
  return `${format(usd)}${unpricedCallsSuffix(unpricedCalls)}`;
}
