// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4249 (TUI-05, Design 126 sections 4.1, 4.2, 5.1, 7.8, mockup M-04): the
// single select. It owns the only cursor marker, adds the one label colon,
// caps the padding at the available width (no ellipsis on a short row, #4220),
// bounds the window whenever the list can exceed the space (#4239), filters
// as the operator types (`filter`), shows numbers only on menus (`numbered`,
// Q-06), and reports the highlighted option with its guidance entry through
// `onCursorChange` (#4230). It never looks at the guidance box: arrows,
// number keys and Enter keep working while the box is open (section 7.8);
// Esc belongs to the box and the flow, never to the picker.

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { Box, Text, useInput, useStdout, type DOMElement, type Key } from 'ink';
import { ListBudgetContext, pickerBudgetRows, useListBudget } from './list-window.js';
import { classifyMouseInput, acquireMouseReporting } from '../input/mouse.js';
import { tone } from '../theme.js';
import { useHeaderWidth } from './header-width.js';
import { KeyHints, type KeyHint } from './KeyHints.js';
import { DEFAULT_FILTER_GUIDANCE, FilterLine, useFilterRegistration } from './list-filter.js';
import { optionGuidanceKey, type GuidanceEntry } from './guidance-entry.js';
import {
  CURSOR_MARKER, MARKER_WIDTH, PICKER_ROW_INDENT, DETAIL_GAP,
  withLabelColon, resolveVisibleCount, labelColumnWidth, rowLabelWidth, detailLines, matchesFilter, nextFilterQuery,
  optionNumber, scrollTopFor, windowEnd, type DetailLines,
} from './picker.js';

export interface SelectOption {
  label: string;
  value: string;
  /** Dim second column (M-04): origin, last run, kind. Cut, never wrapped, when it does not fit. */
  detail?: string;
  /** The guidance entry of this option; the screen passes it to the guidance box (#4230). */
  guidance?: GuidanceEntry;
  /** Group header shown above the first option of each group (M-04 "Applications", "Service apps"). */
  group?: string;
  /** Number key of a numbered menu entry ("9", "0"); default 1 to 9 by position. */
  number?: string;
}

interface SelectInputProps {
  /** The label without a colon; the component adds one (a trailing colon is not doubled). */
  label: string;
  options: SelectOption[];
  /** Called when the user commits a selection (Enter key, or a number key on a numbered menu). */
  onSelect: (value: string) => void;
  /** Called whenever the highlighted cursor moves: on mount, on every Up/Down keystroke and on a
   *  filter change (#0800). The second argument is the option with its `guidance` (#4230). */
  onCursorChange?: (value: string, option?: SelectOption) => void;
  active?: boolean;
  /** Maximum number of rows visible at once (group headers count). When unset, the window is
   *  bounded by the terminal height whenever the list can exceed it (#4239). */
  visibleCount?: number;
  /** #3519: opt-in mouse wheel navigation. Default false: terminal mouse
   *  reporting stays off so the wheel scrolls the terminal scrollback and can
   *  never move the highlighted option behind the operator's back (a wheel
   *  tick before Enter used to confirm an option the operator did not pick).
   *  Leave false on any question that starts long-running or costly work. */
  wheelNavigation?: boolean;
  /** #4198 (Design 125 section 5.7): the option the cursor starts on (a preselected default). Default 0. */
  initialIndex?: number;
  /** Q-06: menus and the "What next" menu show numbers and accept number keys; pickers do not. */
  numbered?: boolean;
  /** Type-to-filter with the "n of m" line (pickers that can exceed one window). Not with `numbered`. */
  filter?: boolean;
  /** What the filter counts ("apps" in "2 of 235 apps"). Default "entries". */
  itemNoun?: string;
  /** #4492: the guidance line of the filter (default: "Type part of the name to narrow the list; PgUp and PgDn page through it."). */
  filterGuidance?: string;
  /** The picker's own hint line. Screens on ScreenLayout pass false: the key hints are block 7. */
  showKeyHints?: boolean;
}

const SELECT_HINTS: readonly KeyHint[] = [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'confirm' }];

export interface PickerRowProps {
  /** True for the highlighted row: the cursor marker and the selection colour. */
  selected: boolean;
  /** The row after the marker; the caller colours its parts (a status word keeps its status colour). */
  children?: ReactNode;
  /** Indent the row under its label (Design 126 section 3 margin). Default true. */
  indent?: boolean;
  /** Text wrapping of the row. Default 'truncate' (the picker rows); 'wrap' for rows that wrap. */
  wrap?: 'wrap' | 'truncate';
}

/**
 * #4213 / #4254 (Design 126 sections 4.2 and 13.2 G-02): one picker row, the
 * only place besides MultiSelect's checkbox that draws the cursor marker. The
 * rows of SelectInput and MultiSelect are PickerRows; a list whose rows carry
 * more than a label and a dim detail (a status word in its colour, action
 * entries under status rows) draws PickerRows too, so its marker, colour and
 * indent are the pickers' own.
 */
export function PickerRow({ selected, children, indent = true, wrap = 'truncate' }: PickerRowProps): JSX.Element {
  return (
    <Box marginLeft={indent ? PICKER_ROW_INDENT : 0}>
      <Text wrap={wrap}>
        <Text {...tone(selected ? 'selection' : 'text')}>{selected ? CURSOR_MARKER : '  '}</Text>
        {children}
      </Text>
    </Box>
  );
}

/** A row without a detail column. */
const NO_DETAIL: DetailLines = { first: '', rest: [], restIndent: 0 };

/** Rows the options occupy, group headers included (for the window bound). */
function rowsNeeded(options: readonly SelectOption[]): number {
  let n = 0;
  let prev: string | undefined;
  for (const o of options) {
    if (o.group !== undefined && o.group !== prev) n++;
    prev = o.group;
    n++;
  }
  return n;
}

export function SelectInput({
  label, options, onSelect, onCursorChange, active = true, visibleCount, wheelNavigation = false,
  initialIndex = 0, numbered = false, filter = false, itemNoun = 'entries', showKeyHints = true, filterGuidance = DEFAULT_FILTER_GUIDANCE,
}: SelectInputProps): JSX.Element {
  const { stdout } = useStdout();
  const width = useHeaderWidth();
  const filtering = filter && !numbered;
  // #4492: the key hints and the guidance box name the filter while this list is active.
  useFilterRegistration(filtering && active, filterGuidance);
  const [query, setQuery] = useState('');
  const shown = useMemo(
    () => (filtering && query !== '' ? options.filter((o) => matchesFilter(o.label, query, o.detail)) : options),
    [filtering, query, options],
  );

  const [idx, setIdx] = useState(() => Math.max(0, Math.min(initialIndex, options.length - 1)));
  const cur = Math.max(0, Math.min(idx, shown.length - 1));

  // #0620 / #4239: scroll-window state; the window holds `rows` rows, group headers included.
  // #4348: inside a measured frame (ScreenLayout, ListBudgetScope) the shared
  // height rule lowers the window so the frame never grows past the terminal;
  // `visibleCount` stays the most rows.
  const rootRef = useRef<DOMElement>(null);
  const framed = useContext(ListBudgetContext) !== null;
  const budget = useListBudget(rootRef);
  // #1087 / #4220: pad labels so shorter labels overwrite leftover characters
  // when the window scrolls, but never past the row width: a short row must
  // not be cut because another label is too wide.
  const rowWidth = Math.max(1, width - PICKER_ROW_INDENT);
  const numberWidth = numbered ? 3 : 0;
  const prefixWidth = MARKER_WIDTH + numberWidth;
  const hasDetail = shown.some((o) => o.detail);
  const labelWidth = labelColumnWidth(shown.map((o) => o.label), rowWidth, prefixWidth, hasDetail);
  // #4213 (Design 126 section 8 rules 5 and 6): the detail wraps under its column,
  // never cut; each row counts with its wrapped height in the window (#4348).
  const details = shown.map((o) => (hasDetail ? detailLines(o.detail, rowWidth, prefixWidth + rowLabelWidth(o.label, labelWidth), prefixWidth) : NO_DETAIL));
  const heights = details.map((d) => 1 + d.rest.length);
  const extraLines = heights.reduce((n, h) => n + h - 1, 0);
  const needed = rowsNeeded(shown) + extraLines;
  const fixedRows = (withLabelColon(label) !== '' ? 1 : 0) + (filtering ? 1 : 0) + (active && showKeyHints ? 2 : 0)
    + (filtering && shown.length === 0 ? 1 : 0);
  const budgetRows = framed ? pickerBudgetRows(budget, fixedRows, needed) : undefined;
  const resolvedRows = resolveVisibleCount(visibleCount, stdout?.rows, needed - extraLines) + extraLines;
  const rows = budgetRows === undefined ? resolvedRows : Math.min(resolvedRows, budgetRows);
  const groups = useMemo(() => shown.map((o) => o.group), [shown]);
  const [scrollTop, setScrollTop] = useState(0);
  useLayoutEffect(() => {
    setScrollTop((prev) => scrollTopFor(groups, prev, cur, rows, heights));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, rows, groups, heights.join(',')]);

  // #0805: Ink re-registers the useInput listener on every render; the refs
  // always hold the current list and cursor so a stale handler never reads a
  // frozen snapshot (an out-of-range index used to crash).
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const idxRef = useRef(cur);
  idxRef.current = cur;
  const queryRef = useRef(query);
  queryRef.current = query;
  const activeRef = useRef(active);
  activeRef.current = active;
  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // #4230: the last option reported to the parent (value and guidance entry).
  const lastNotified = useRef<string | null>(null);
  const notify = (list: readonly SelectOption[], n: number): void => {
    const opt = list[n];
    lastNotified.current = optionGuidanceKey(opt);
    onCursorChangeRef.current?.(opt?.value ?? '', opt);
  };

  // Notify the parent of the initial cursor position (index 0, or initialIndex),
  // and again whenever the highlighted option changes without a key press:
  // options that arrive after the first render, a filter or a new option list
  // (#4230: the guidance box never stays on the step entry by mistake).
  const curKey = optionGuidanceKey(shown[cur]);
  useEffect(() => {
    if (curKey === lastNotified.current) return;
    notify(shownRef.current, idxRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curKey]);

  // #1391: terminal mouse reporting while mounted -- see MultiSelect.
  // #3519: only when wheel navigation is explicitly enabled.
  const wheelNavRef = useRef(wheelNavigation);
  wheelNavRef.current = wheelNavigation;
  useEffect(() => (wheelNavigation ? acquireMouseReporting() : undefined), [wheelNavigation]);

  const move = (n: number): void => {
    idxRef.current = n;
    setIdx(n);
    notify(shownRef.current, n);
  };

  // #1387: single stable useInput registration + mouse-report filtering.
  const processInput = (input: string, key: Key): void => {
    if (!activeRef.current) return;
    const opts = shownRef.current;
    const at = idxRef.current;
    const mouse = classifyMouseInput(input);
    if (mouse) {
      // #3519: mouse reports never move the cursor unless wheel navigation is opted in.
      if (!wheelNavRef.current) return;
      if (mouse === 'wheel-up') move(Math.max(0, at - 1));
      if (mouse === 'wheel-down') move(Math.min(opts.length - 1, at + 1));
      return;
    }
    if (key.upArrow) { move(Math.max(0, at - 1)); return; }
    if (key.downArrow) { move(Math.min(opts.length - 1, at + 1)); return; }
    if (key.return) {
      const opt = opts[at];
      if (opt) onSelectRef.current(opt.value);
      return;
    }
    if (numbered) {
      if (key.ctrl || key.meta || !/^[0-9]$/.test(input)) return;
      const all = optionsRef.current;
      const n = all.findIndex((o, i) => optionNumber(i, o.number) === input);
      if (n >= 0) {
        move(n);
        onSelectRef.current(all[n]!.value);
      }
      return;
    }
    if (filtering) {
      const q = nextFilterQuery(queryRef.current, input, key, { space: true });
      if (q === null) return;
      const next = optionsRef.current.filter((o) => matchesFilter(o.label, q, o.detail));
      queryRef.current = q;
      shownRef.current = next;
      setQuery(q);
      setScrollTop(0);
      move(0);
    }
  };
  const processInputRef = useRef(processInput);
  processInputRef.current = processInput;
  useInput(useCallback((input: string, key: Key) => processInputRef.current(input, key), []));

  // Visible slice (#0620): from scrollTop, `rows` rows including group headers.
  const end = windowEnd(groups, scrollTop, rows, heights);
  const visibleOpts = shown.slice(scrollTop, end);
  const aboveCount = scrollTop;
  const belowCount = shown.length - end;

  const moreWidth = Math.min(rowWidth, prefixWidth + labelWidth);
  const title = withLabelColon(label);

  const rowsOut: JSX.Element[] = [];
  let prevGroup: string | undefined;
  visibleOpts.forEach((opt, vi) => {
    const absIdx = scrollTop + vi;
    if (opt.group !== undefined && opt.group !== prevGroup) {
      rowsOut.push(
        <Box key={`group-${opt.group}-${absIdx}`} marginLeft={PICKER_ROW_INDENT}>
          <Text {...tone('brand', { bold: false })} wrap="truncate">{opt.group.padEnd(moreWidth)}</Text>
        </Box>,
      );
    }
    prevGroup = opt.group;
    const isCursor = absIdx === cur;
    const num = numbered ? optionNumber(options.indexOf(opt), opt.number).padEnd(numberWidth) : '';
    const detail = details[absIdx] ?? NO_DETAIL;
    rowsOut.push(
      <PickerRow key={opt.value} selected={isCursor}>
        <Text {...tone(isCursor ? 'selection' : 'text')}>{num}{opt.label.padEnd(labelWidth)}</Text>
        {detail.first !== '' && <Text {...tone('muted')}>{' '.repeat(DETAIL_GAP)}{detail.first}</Text>}
      </PickerRow>,
    );
    detail.rest.forEach((line, li) => {
      rowsOut.push(
        <Box key={`${opt.value}-detail-${li}`} marginLeft={PICKER_ROW_INDENT}>
          <Text {...tone('muted')} wrap="truncate">{`${' '.repeat(detail.restIndent)}${line}`}</Text>
        </Box>,
      );
    });
  });


  return (
    <Box ref={rootRef} flexDirection="column" marginBottom={1} width={width} flexShrink={0}>
      {title !== '' && <Text bold>{title}</Text>}
      {filtering && <FilterLine query={query} shown={shown.length} total={options.length} itemNoun={itemNoun} width={rowWidth} indent={PICKER_ROW_INDENT} />}
      {aboveCount > 0 && (
        <Box marginLeft={PICKER_ROW_INDENT}>
          <Text {...tone('muted')} wrap="truncate">{`↑ ${aboveCount} more`.padEnd(moreWidth)}</Text>
        </Box>
      )}
      {rowsOut}
      {filtering && shown.length === 0 && (
        <Box marginLeft={PICKER_ROW_INDENT}>
          <Text {...tone('muted')}>No entry matches the filter.</Text>
        </Box>
      )}
      {belowCount > 0 && (
        <Box marginLeft={PICKER_ROW_INDENT}>
          <Text {...tone('muted')} wrap="truncate">{`↓ ${belowCount} more`.padEnd(moreWidth)}</Text>
        </Box>
      )}
      {active && showKeyHints && (
        <Box marginTop={1} marginLeft={1}>
          <KeyHints hints={SELECT_HINTS} />
        </Box>
      )}
    </Box>
  );
}
