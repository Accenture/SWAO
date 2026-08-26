// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/** Lists longer than this trigger a filter-first step before the SelectInput. */
export const FILTER_THRESHOLD = 10;

/** Sentinel: user pressed Enter with empty input -- show all without re-opening the filter prompt. */
export const SHOW_ALL = '__all__';

/**
 * Filter a list of items by substring match on a string key.
 * Returns the full list when q is empty or equal to SHOW_ALL.
 * Case-insensitive; matches anywhere in the key string.
 */
export function filterList<T>(items: T[], q: string, key: (item: T) => string): T[] {
  if (!q || q === SHOW_ALL) return items;
  const lower = q.toLowerCase();
  return items.filter(item => key(item).toLowerCase().includes(lower));
}
