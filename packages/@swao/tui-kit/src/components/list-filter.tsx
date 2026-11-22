// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, the visible type-to-filter field
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4492 (Design 126 section 7.14): a filterable list shows that it filters.
// 1. The filter line is in the accent colour with a cursor:
//    "Filter: ▏ type to narrow 436 models", while typing "Filter: eu.▏  12 of 436 models".
// 2. The key hints carry "Type filter" while a filterable list is active:
//    the list registers itself here and KeyHints adds the hint after the
//    arrow hint (a screen that already names it keeps its own).
// 3. The guidance box adds one "Filter" section with the list's own text.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Box, Text } from 'ink';
import { tone } from '../theme.js';
import type { KeyHint } from './KeyHints.js';

/** The cursor of the filter field. */
export const FILTER_CURSOR = '▏';
/** The key hint of a filterable list. */
export const FILTER_KEY_HINT: KeyHint = { key: 'Type', verb: 'filter' };
/** The guidance line of a filterable list unless the list names its own. */
export const DEFAULT_FILTER_GUIDANCE = 'Type part of the name to narrow the list; PgUp and PgDn page through it.';
/** The label of the guidance section. */
export const FILTER_GUIDANCE_LABEL = 'Filter';

interface Registration { id: number; guidance: string }
let registrations: Registration[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = (): void => { for (const l of listeners) l(); };
const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = (): Registration | null => registrations[registrations.length - 1] ?? null;

/** A filterable list reports itself while `active` (the latest one wins). */
export function useFilterRegistration(active: boolean, guidance: string = DEFAULT_FILTER_GUIDANCE): void {
  const id = useRef(0);
  if (id.current === 0) id.current = nextId++;
  useEffect(() => {
    if (!active) return undefined;
    const me = id.current;
    registrations = [...registrations.filter((r) => r.id !== me), { id: me, guidance }];
    emit();
    return () => { registrations = registrations.filter((r) => r.id !== me); emit(); };
  }, [active, guidance]);
}

/** The active filterable list (its guidance text), or null. */
export function useActiveFilter(): { guidance: string } | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The hints with "Type filter" after the arrow hint (or first), unless already present. */
export function withFilterHint(hints: readonly KeyHint[]): KeyHint[] {
  if (hints.some((h) => h.key === FILTER_KEY_HINT.key && h.verb === FILTER_KEY_HINT.verb)) return [...hints];
  const arrows = hints.findIndex((h) => h.key === '↑↓');
  const at = arrows >= 0 ? arrows + 1 : 0;
  return [...hints.slice(0, at), FILTER_KEY_HINT, ...hints.slice(at)];
}

/** The text of the filter line: the query with the cursor, and the count (or the invitation when empty). */
export function filterLineText(query: string, shown: number, total: number, itemNoun: string, width: number): string {
  if (query === '') return `Filter: ${FILTER_CURSOR} type to narrow ${total} ${itemNoun}`;
  const left = `Filter: ${query}${FILTER_CURSOR}`;
  const count = `${shown} of ${total} ${itemNoun}`;
  return `${left}${' '.repeat(Math.max(2, width - left.length - count.length))}${count}`;
}

/** The filter line of a list (accent colour, Design 126 section 7.14). */
export function FilterLine({ query, shown, total, itemNoun, width, indent }: { query: string; shown: number; total: number; itemNoun: string; width: number; indent: number }): JSX.Element {
  return (
    <Box marginLeft={indent}>
      <Text {...tone('accent')} wrap="truncate">{filterLineText(query, shown, total, itemNoun, width)}</Text>
    </Box>
  );
}

/** #4492: the filter guidance of the model pickers. */
export const MODEL_FILTER_GUIDANCE = 'Type part of a model id, for example eu. or mistral, to narrow the list; PgUp and PgDn page through it.';
