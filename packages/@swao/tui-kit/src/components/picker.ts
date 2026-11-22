// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, shared picker rules (SelectInput, MultiSelect)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4249 (TUI-05, Design 126 sections 4.2 and 5.1, mockups M-04 and M-05): the
// rules both pickers share, as pure functions so they are tested once.
//
//   - one cursor marker, owned by the pickers (gate G-02);
//   - one label colon, added here (A-23);
//   - padding capped at the available width, so a short row never ends in an
//     ellipsis because another label is too wide (#4220, #1087);
//   - a bounded window whenever the list can exceed the space (#4239);
//   - type-to-filter with "n of m".

import type { Key } from 'ink';

/** #1680: shared window size for pickers whose options grow with workspace content. */
export const PICKER_VISIBLE_COUNT = 10;

/** Rows a screen keeps for everything around a picker (header, title, hints, collapsed guidance). */
export const PICKER_RESERVED_ROWS = 14;

/** The only cursor marker of the TUI (Design 126 rule 3), with its trailing space. */
export const CURSOR_MARKER = '❯ ';

/** Width of the marker column (marker or two spaces). */
export const MARKER_WIDTH = 2;

/** Left margin of a picker row. */
export const PICKER_ROW_INDENT = 2;

/** Gap between the label column and the dim detail column. */
export const DETAIL_GAP = 2;

/** "Select application:" from "Select application" or "Select application:" (one colon, A-23). */
export function withLabelColon(label: string): string {
  const trimmed = label.trimEnd();
  if (trimmed === '') return '';
  return trimmed.endsWith(':') ? trimmed : `${trimmed}:`;
}

/**
 * Window size of a picker: an explicit `visibleCount` wins; otherwise the list
 * is bounded when the terminal height is known and the list is longer than the
 * space left for it (never fewer than PICKER_VISIBLE_COUNT rows). Unknown
 * height (tests without a terminal) leaves the list unbounded.
 */
export function resolveVisibleCount(visibleCount: number | undefined, rows: number | undefined, length: number): number {
  if (visibleCount !== undefined && visibleCount > 0) return Math.min(visibleCount, Math.max(1, length));
  if (rows === undefined || !Number.isFinite(rows) || rows <= 0) return Math.max(1, length);
  const space = Math.max(PICKER_VISIBLE_COUNT, rows - PICKER_RESERVED_ROWS);
  return Math.max(1, Math.min(space, length));
}

/** The narrowest detail column worth showing next to a label (#4220). */
export const MIN_DETAIL_WIDTH = 8;

/**
 * Width the label column is padded to (#4220, the DetailRow pattern): the
 * longest label that fits the row, so one over-wide label never pushes the
 * other rows to the edge. When the list has a detail column, a label fits only
 * when the gap and MIN_DETAIL_WIDTH columns of detail still fit after it. A
 * label longer than the column keeps its own width: only that row is cut.
 */
export function labelColumnWidth(labels: readonly string[], rowWidth: number, prefixWidth: number, withDetail = false): number {
  const room = Math.max(0, rowWidth - prefixWidth);
  const fitRoom = withDetail ? Math.max(0, room - DETAIL_GAP - MIN_DETAIL_WIDTH) : room;
  let longest = 0;
  let anyFits = false;
  for (const l of labels) {
    if (l.length <= fitRoom) { anyFits = true; longest = Math.max(longest, l.length); }
  }
  if (anyFits) return longest;
  // No label leaves room for a detail: pad to the longest label that fits the row at all.
  return labels.reduce((m, l) => (l.length <= room ? Math.max(m, l.length) : m), 0);
}

/** The columns a row's label takes: the padded column, or the label itself when it is longer. */
export function rowLabelWidth(label: string, labelWidth: number): number {
  return Math.max(labelWidth, label.length);
}

/** The dim detail column text that fits after the label column, or '' when nothing useful fits. */
export function fitDetail(detail: string | undefined, rowWidth: number, usedWidth: number): string {
  if (!detail) return '';
  const room = rowWidth - usedWidth - DETAIL_GAP;
  if (room < 4) return '';
  if (detail.length <= room) return detail;
  return `${detail.slice(0, room - 3).trimEnd()}...`;
}

/** Word-wrap `text` to lines of at most `width` columns; a word wider than the line is broken hard. */
function wrapWords(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const out: string[] = [];
  let line = '';
  for (const raw of text.split(' ').filter((s) => s !== '')) {
    let word = raw;
    while (word.length > w) {
      if (line !== '') { out.push(line); line = ''; }
      out.push(word.slice(0, w));
      word = word.slice(w);
    }
    if (word === '') continue;
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= w) line = `${line} ${word}`;
    else { out.push(line); line = word; }
  }
  if (line !== '') out.push(line);
  return out;
}

/** The dim detail of one picker row, wrapped instead of cut (#4213, Design 126 section 8 rules 5 and 6). */
export interface DetailLines {
  /** The text on the row itself, after the gap; '' when the detail starts on the next line. */
  first: string;
  /** Continuation lines, each starting at column `restIndent` of the row. */
  rest: string[];
  /** Columns before a continuation line: the detail column, or the label column when no detail fits beside the label. */
  restIndent: number;
}

/**
 * #4213 (Design 126 section 8 rules 5 and 6): the detail column of a picker row
 * wraps, it is never cut with an ellipsis. A detail that fits stays on the row;
 * a longer one wraps with a hanging indent under the detail column; when the
 * label leaves fewer than MIN_DETAIL_WIDTH columns, the detail moves under the
 * label (a two-line row). `usedWidth` is the marker, number and label columns;
 * `labelStart` the column the label starts at.
 */
export function detailLines(detail: string | undefined, rowWidth: number, usedWidth: number, labelStart: number): DetailLines {
  if (!detail) return { first: '', rest: [], restIndent: 0 };
  const room = rowWidth - usedWidth - DETAIL_GAP;
  if (detail.length <= room) return { first: detail, rest: [], restIndent: 0 };
  if (room >= MIN_DETAIL_WIDTH) {
    const lines = wrapWords(detail, room);
    return { first: lines[0] ?? '', rest: lines.slice(1), restIndent: usedWidth + DETAIL_GAP };
  }
  return { first: '', rest: wrapWords(detail, rowWidth - labelStart), restIndent: labelStart };
}

/** Case-insensitive substring filter on the label and the detail. */
export function matchesFilter(label: string, query: string, detail?: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return label.toLowerCase().includes(q) || (detail ?? '').toLowerCase().includes(q);
}

/** The new filter text after a key press, or null when the key is not a filter key. */
export function nextFilterQuery(query: string, input: string, key: Key, opts: { space: boolean }): string | null {
  if (key.ctrl || key.meta || key.escape || key.tab || key.return) return null;
  if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.pageUp || key.pageDown) return null;
  if (key.backspace || key.delete) return query.length > 0 ? query.slice(0, -1) : null;
  if (input === '' || input.length !== [...input].length) return null;
  if (input === ' ' && !opts.space) return null;
  // Printable characters only; terminal escape sequences never reach the query.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(input)) return null;
  return query + input;
}

/** Row numbers of a numbered menu: the option's own key, else 1 to 9 by position (Q-06). */
export function optionNumber(index: number, own?: string): string {
  if (own !== undefined) return own;
  return index < 9 ? String(index + 1) : '';
}

/**
 * End (exclusive) of the window that starts at `start` and holds at most
 * `rows` rows, counting a group header row each time the group changes.
 * #4213: `heights` gives the lines of each option (a wrapped detail adds
 * lines, Design 126 section 3 and #4348); one line each when absent.
 */
export function windowEnd(groups: ReadonlyArray<string | undefined>, start: number, rows: number, heights?: readonly number[]): number {
  let used = 0;
  let i = start;
  let prev: string | undefined;
  while (i < groups.length) {
    const g = groups[i];
    const header = g !== undefined && g !== prev ? 1 : 0;
    const h = heights?.[i] ?? 1;
    if (i > start && used + header + h > rows) break;
    used += header + h;
    prev = g;
    i++;
  }
  return i;
}

/** First visible index so that `idx` stays inside the window (scrolls by the smallest step). */
export function scrollTopFor(groups: ReadonlyArray<string | undefined>, prevTop: number, idx: number, rows: number, heights?: readonly number[]): number {
  if (groups.length === 0) return 0;
  let top = Math.max(0, Math.min(prevTop, groups.length - 1));
  if (idx < top) return Math.max(0, idx);
  while (top < idx && windowEnd(groups, top, rows, heights) <= idx) top++;
  return top;
}
