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

// #4249 (TUI-05, Design 126 sections 4.2, 5.1, 7.8, mockup M-05): the multi
// select. Same marker, colour, label colon, width-capped padding, bounded
// window and filter as SelectInput; `[x]` selected, `[ ]` not selected, `[-]`
// on the "all" row when some but not all options are selected. The
// highlighted option and its guidance entry reach the screen through
// `onCursorChange` (#4230). Arrows, Space and Enter keep working while the
// guidance box is open; Esc is never handled here (section 7.5).

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useContext, useMemo } from 'react';
import { Box, Text, useInput, useStdout, type DOMElement, type Key } from 'ink';
import { ListBudgetContext, pickerBudgetRows, useListBudget } from './list-window.js';
import { classifyMouseInput, acquireMouseReporting } from '../input/mouse.js';
import { tone } from '../theme.js';
import { useHeaderWidth } from './header-width.js';
import { KeyHints, type KeyHint } from './KeyHints.js';
import { DEFAULT_FILTER_GUIDANCE, FilterLine, useFilterRegistration } from './list-filter.js';
import { optionGuidanceKey, type GuidanceEntry } from './guidance-entry.js';
import { PickerRow } from './SelectInput.js';
import {
  MARKER_WIDTH, PICKER_ROW_INDENT, DETAIL_GAP,
  withLabelColon, resolveVisibleCount, labelColumnWidth, rowLabelWidth, detailLines, matchesFilter, nextFilterQuery,
  scrollTopFor, windowEnd, type DetailLines,
} from './picker.js';

/** A row without a detail column (headers, actions, lists without details). */
const NO_DETAIL: DetailLines = { first: '', rest: [], restIndent: 0 };

export interface MultiSelectOption {
  label: string;
  value: string;
  /** #3380: a non-selectable section header row (e.g. a country group). The
   *  cursor skips it, Space/A never toggle it, and it renders without a box. */
  header?: boolean;
  /** Dim second column (M-05). Cut, never wrapped, when it does not fit. */
  detail?: string;
  /** The guidance entry of this option; the screen passes it to the guidance box (#4230). */
  guidance?: GuidanceEntry;
  /**
   * #4255 (Design 126 section 7.7): an action entry such as "Skip this step".
   * It has no checkbox, Space and A never toggle it, a filter never hides it,
   * and Enter on it calls `onAction` instead of confirming the selection.
   * Give it as the last option.
   */
  action?: boolean;
}

interface MultiSelectProps {
  /** The label without a colon; the component adds one (a trailing colon is not doubled). */
  label: string;
  options: MultiSelectOption[];
  initialSelected?: string[];
  onConfirm: (values: string[]) => void;
  active?: boolean;
  /** If set, selecting this value deselects all others (and vice versa). */
  allValue?: string;
  /** Fired when the highlighted option changes (#0382, sprint-040) so the parent can show its
   *  guidance. Receives the option's value and the option with its `guidance` (#4230). */
  onCursorChange?: (activeValue: string, option?: MultiSelectOption) => void;
  /** When true, Enter on an empty selection still fires onConfirm([]).
   *  Default false (legacy behaviour: Enter blocks until something is
   *  picked). Set to true for "optional flags" pickers where the
   *  meaningful default is "select nothing, use defaults" -- e.g. the BI
   *  export `--no-bom` / `--crlf` flags (#0390, sprint-040). */
  allowEmptyConfirm?: boolean;
  /** Maximum number of option rows rendered at once. When unset, the window is
   *  bounded by the terminal height whenever the list can exceed it (#0620, #4239). */
  visibleCount?: number;
  /** #3519: opt-in mouse wheel navigation (default false). When false, terminal
   *  mouse reporting is not enabled, so the wheel scrolls the terminal and
   *  never moves the cursor. Same contract as SelectInput. */
  wheelNavigation?: boolean;
  /** Type-to-filter with the "n of m" line; letters go to the filter, so "A" does not toggle all. */
  filter?: boolean;
  /** What the filter counts ("frameworks" in "3 of 12 frameworks"). Default "entries". */
  itemNoun?: string;
  /** #4492: the guidance line of the filter (default: "Type part of the name to narrow the list; PgUp and PgDn page through it."). */
  filterGuidance?: string;
  /** The picker's own hint line. Screens on ScreenLayout pass false: the key hints are block 7. */
  showKeyHints?: boolean;
  /** #4255: Enter on an action entry (`action: true`), with its value. */
  onAction?: (value: string) => void;
}

export function MultiSelect({
  label,
  options,
  initialSelected = [],
  onConfirm,
  active = true,
  allValue,
  onCursorChange,
  allowEmptyConfirm = false,
  visibleCount,
  wheelNavigation = false,
  filter = false,
  itemNoun = 'entries',
  showKeyHints = true,
  onAction,
  filterGuidance = DEFAULT_FILTER_GUIDANCE,
}: MultiSelectProps): JSX.Element {
  const { stdout } = useStdout();
  // #4492: the key hints and the guidance box name the filter while this list is active.
  useFilterRegistration(filter && active, filterGuidance);
  const width = useHeaderWidth();
  const [query, setQuery] = useState('');
  // A filter hides header rows: a header without its options says nothing.
  // #4255: an action entry stays visible under a filter (it is the step's last entry).
  const shown = useMemo(
    () => (filter && query !== '' ? options.filter((o) => o.action || (!o.header && matchesFilter(o.label, query, o.detail))) : options),
    [filter, query, options],
  );

  // #0245: when allValue is set, treat it as a derived aggregate of the
  // individual options. The "all" row displays checked iff every other
  // option is checked; the sentinel value is never stored in the
  // internal selected set. Initial state expands the sentinel so the
  // picker opens with every individual row pre-checked when the caller
  // passes initialSelected: [allValue].
  const allRegularValues = allValue
    ? options.filter(o => o.value !== allValue && !o.header && !o.action).map(o => o.value)
    : [];

  // #3380: the cursor only ever rests on a selectable (non-header) row.
  const firstSelectableIdx = (list: readonly MultiSelectOption[]): number => {
    const i = list.findIndex(o => !o.header);
    return i >= 0 ? i : 0;
  };

  // #1086: start cursor on the first pre-selected (non-header) item so operators
  // see immediately which option is checked. Falls back to the first selectable.
  const [idx, setIdx] = useState(() => {
    const first = initialSelected.length > 0
      ? options.findIndex(o => !o.header && !o.action && initialSelected.includes(o.value))
      : -1;
    return first >= 0 ? first : firstSelectableIdx(options);
  });
  const cur = Math.max(0, Math.min(idx, shown.length - 1));

  // #0805: Ink re-registers the useInput listener on every render (inputHandler
  // is an inline function -- new reference each time). Between cleanup and
  // re-registration the OLD handler fires with a stale closure, meaning `options`
  // and `idx` captured at the previous render. If `options` shrank (e.g. filter
  // applied) or `idx` is now out of bounds, `options[idx]!.value` crashes.
  // Pattern mirrors GuidanceBox #0753: refs always hold the current value so
  // the stale-closure handler reads live data instead of a frozen snapshot.
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

  // #4249: notify only when the highlighted option changes, not on every
  // render (a new `options` array per render would otherwise re-fire it).
  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;
  const lastNotified = useRef<string | null>(null);
  // #4230: the key holds the value and the guidance entry, so a new option
  // list that reuses a value with another entry still updates the box.
  const curOpt = shown[cur];
  const curKey = optionGuidanceKey(curOpt);
  useEffect(() => {
    if (!curOpt || curKey === lastNotified.current) return;
    lastNotified.current = curKey;
    onCursorChangeRef.current?.(curOpt.value, curOpt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curKey]);

  // #1391: switch terminal mouse reporting on while a picker is mounted so
  // wheel ticks reach the app (otherwise the terminal scrolls its own
  // scrollback and the cursor appears frozen). Restored on unmount and on
  // process exit via the shared refcounted manager.
  // #3519: only when wheel navigation is explicitly enabled; by default the
  // wheel belongs to the terminal scrollback and cannot move the cursor.
  const wheelNavRef = useRef(wheelNavigation);
  wheelNavRef.current = wheelNavigation;
  useEffect(() => (wheelNavigation ? acquireMouseReporting() : undefined), [wheelNavigation]);
  const [selected, setSelected] = useState<Set<string>>(() => {
    // #4255: an action entry is never selected.
    const initial = new Set(initialSelected.filter((v) => !options.some((o) => o.action && o.value === v)));
    if (allValue && initial.has(allValue)) {
      initial.delete(allValue);
      allRegularValues.forEach(v => initial.add(v));
    }
    return initial;
  });

  // #0620 / #4239: scroll-window state -- keep the cursor row inside the visible band.
  // #4348: inside a measured frame the shared height rule lowers the window.
  const rootRef = useRef<DOMElement>(null);
  const framed = useContext(ListBudgetContext) !== null;
  const budget = useListBudget(rootRef);
  const fixedRows = (withLabelColon(label) !== '' ? 1 : 0) + (filter ? 1 : 0) + (active && showKeyHints ? 2 : 0)
    + (filter && shown.filter((o) => !o.action).length === 0 ? 1 : 0);
  // #1087 / #4220: pad every label to the longest label width so that when
  // shorter labels replace longer ones in the same terminal row (due to
  // scroll-window movement), the trailing spaces overwrite any leftover
  // characters; capped at the row width so a short row is never cut.
  const rowWidth = Math.max(1, width - PICKER_ROW_INDENT);
  const prefixWidth = MARKER_WIDTH + 4; // marker + "[x] "
  const hasDetail = shown.some((o) => o.detail);
  const labelWidth = labelColumnWidth(shown.map((o) => o.label), rowWidth, prefixWidth, hasDetail);
  // #4213 (Design 126 section 8 rules 5 and 6): the detail wraps under its column,
  // never cut; each row counts with its wrapped height in the window (#4348).
  const details = shown.map((o) => (hasDetail && !o.header && !o.action ? detailLines(o.detail, rowWidth, prefixWidth + rowLabelWidth(o.label, labelWidth), prefixWidth) : NO_DETAIL));
  const heights = details.map((d) => 1 + d.rest.length);
  const extraLines = heights.reduce((n, h) => n + h - 1, 0);
  const totalLines = shown.length + extraLines;
  const budgetRows = framed ? pickerBudgetRows(budget, fixedRows, totalLines) : undefined;
  const resolvedVc = resolveVisibleCount(visibleCount, stdout?.rows, shown.length) + extraLines;
  const vc = budgetRows === undefined ? resolvedVc : Math.min(resolvedVc, budgetRows);
  const flat = useMemo(() => shown.map(() => undefined), [shown]);
  const [scrollTop, setScrollTop] = useState(0);
  useLayoutEffect(() => {
    if (vc >= totalLines) { setScrollTop(0); return; }
    setScrollTop((prev) => scrollTopFor(flat, prev, cur, vc, heights));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, vc, totalLines, flat, heights.join(',')]);

  const allRegularSelected = (set: Set<string>): boolean =>
    allRegularValues.length > 0 && allRegularValues.every(v => set.has(v));

  const toggle = (value: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allValue && value === allValue) {
        // Toggling the "all" row: select every individual when not all
        // are currently selected; otherwise clear them. The sentinel
        // value never lands in `next` -- "all" is a derived display.
        if (allRegularSelected(next)) {
          allRegularValues.forEach(v => next.delete(v));
        } else {
          allRegularValues.forEach(v => next.add(v));
        }
        next.delete(allValue);
      } else {
        if (next.has(value)) next.delete(value);
        else next.add(value);
        if (allValue) next.delete(allValue);
      }
      return next;
    });
  };

  // #1387: the handler body runs via a ref so the ONE registered listener
  // below never changes identity. Previously the inline handler was a new
  // function every render, so Ink unsubscribed/resubscribed constantly; a
  // keypress arriving around that boundary could be processed by both the
  // old and the new handler instance, moving the cursor two rows per press
  // (worst on pickers whose onCursorChange re-renders the parent per move).
  const processInput = (input: string, key: Key): void => {
    if (!activeRef.current) return;
    // #1082/#1378: terminal mouse reports arrive through stdin as escape
    // sequences with no key flags set. Swallow them entirely so they cannot
    // jitter cursor or toggle state; synthesise wheel ticks as navigation.
    const opts = shownRef.current;
    const at = idxRef.current;
    // #3380: step over header rows so the cursor only lands on selectable options.
    const step = (i: number, dir: 1 | -1): number => {
      let n = Math.max(0, Math.min(i, opts.length - 1));
      const from = n;
      do { n += dir; } while (n >= 0 && n < opts.length && opts[n]?.header);
      return (n >= 0 && n < opts.length) ? n : from;
    };
    const mouse = classifyMouseInput(input);
    if (mouse) {
      if (!wheelNavRef.current) return; // #3519: swallowed unless opted in
      if (mouse === 'wheel-up')   setIdx(i => step(i, -1));
      if (mouse === 'wheel-down') setIdx(i => step(i, 1));
      return;
    }
    if (key.upArrow)   { setIdx(i => step(i, -1)); return; }
    if (key.downArrow) { setIdx(i => step(i, 1)); return; }
    if (input === ' ' && !key.ctrl && !key.meta) {
      const opt = opts[at];
      if (opt && !opt.header && !opt.action) toggle(opt.value);
      return;
    }
    if (key.return) {
      // #4255: Enter on an action entry runs the action, not the confirmation.
      const opt = opts[at];
      if (opt?.action) { onAction?.(opt.value); return; }
      const values = Array.from(selected);
      if (values.length > 0 || allowEmptyConfirm) onConfirm(values);
      return;
    }
    if (filter) {
      const q = nextFilterQuery(queryRef.current, input, key, { space: false });
      if (q === null) return;
      const next = optionsRef.current.filter((o) => o.action || (!o.header && matchesFilter(o.label, q, o.detail)));
      queryRef.current = q;
      shownRef.current = next;
      setQuery(q);
      setScrollTop(0);
      setIdx(firstSelectableIdx(next));
      return;
    }
    if ((input === 'a' || input === 'A') && !key.ctrl && !key.meta) {
      if (allValue) {
        // Same semantics as toggling the "all" row via Space.
        setSelected(prev => {
          const next = new Set(prev);
          if (allRegularSelected(next)) {
            allRegularValues.forEach(v => next.delete(v));
          } else {
            allRegularValues.forEach(v => next.add(v));
          }
          next.delete(allValue);
          return next;
        });
      } else {
        // Toggle all: if every option is selected, deselect all; otherwise select all
        const allValues = opts.filter(o => !o.header && !o.action).map(o => o.value);
        const allSelected = allValues.every(v => selected.has(v));
        setSelected(allSelected ? new Set() : new Set(allValues));
      }
    }
  };
  const processInputRef = useRef(processInput);
  processInputRef.current = processInput;
  useInput(useCallback((input: string, key: Key) => processInputRef.current(input, key), []));

  /** `x` selected, ` ` not selected, `-` the "all" row with some options selected (M-05). */
  const boxState = (opt: MultiSelectOption): 'x' | ' ' | '-' => {
    if (allValue && opt.value === allValue) {
      if (allRegularSelected(selected)) return 'x';
      return allRegularValues.some(v => selected.has(v)) ? '-' : ' ';
    }
    return selected.has(opt.value) ? 'x' : ' ';
  };

  // Derive the visible slice for bounded rendering (#0620).
  const windowStop  = windowEnd(flat, scrollTop, vc, heights);
  const visibleOpts = shown.slice(scrollTop, windowStop);
  const aboveCount  = scrollTop;
  const belowCount  = Math.max(0, shown.length - windowStop);

  const moreWidth = Math.min(rowWidth, prefixWidth + labelWidth);
  const title = withLabelColon(label);

  const hints: KeyHint[] = [{ key: '↑↓', verb: 'select' }, { key: 'Space', verb: 'toggle' }];
  if (!filter) hints.push({ key: 'A', verb: 'toggle', object: 'all' });
  hints.push({ key: 'Enter', verb: 'confirm' });

  const selectable = options.filter((o) => !o.header && !o.action).length;
  const shownSelectable = shown.filter((o) => !o.header && !o.action).length;

  return (
    <Box ref={rootRef} flexDirection="column" marginBottom={1} width={width} flexShrink={0}>
      {title !== '' && <Text bold>{title}</Text>}
      {filter && <FilterLine query={query} shown={shownSelectable} total={selectable} itemNoun={itemNoun} width={rowWidth} indent={PICKER_ROW_INDENT} />}
      {aboveCount > 0 && (
        <Box marginLeft={PICKER_ROW_INDENT}>
          <Text {...tone('muted')} wrap="truncate">{`↑ ${aboveCount} more`.padEnd(moreWidth)}</Text>
        </Box>
      )}
      {visibleOpts.map((opt, i) => {
        // #3380: a header row is a section label, no cursor marker, no checkbox.
        if (opt.header) {
          return (
            <Box key={opt.value} marginLeft={PICKER_ROW_INDENT}>
              <Text {...tone('brand', { bold: false })} wrap="truncate">{opt.label.padEnd(moreWidth)}</Text>
            </Box>
          );
        }
        const isCursor = (scrollTop + i) === cur;
        // #4255: an action entry has no checkbox; its label sits in the label column.
        if (opt.action) {
          return (
            <PickerRow key={opt.value} selected={isCursor}>
              <Text>{'    '}</Text>
              <Text {...tone(isCursor ? 'selection' : 'text')}>{opt.label}</Text>
            </PickerRow>
          );
        }
        const state = boxState(opt);
        const detail = details[scrollTop + i] ?? NO_DETAIL;
        const row = (
          <PickerRow key={opt.value} selected={isCursor}>
            <Text {...tone(state === 'x' ? 'ok' : 'text')}>[{state}] </Text>
            <Text {...tone(isCursor ? 'selection' : 'text')}>{opt.label.padEnd(labelWidth)}</Text>
            {detail.first !== '' && <Text {...tone('muted')}>{' '.repeat(DETAIL_GAP)}{detail.first}</Text>}
          </PickerRow>
        );
        if (detail.rest.length === 0) return row;
        return (
          <Box key={opt.value} flexDirection="column">
            {row}
            {detail.rest.map((line, li) => (
              <Box key={`detail-${li}`} marginLeft={PICKER_ROW_INDENT}>
                <Text {...tone('muted')} wrap="truncate">{`${' '.repeat(detail.restIndent)}${line}`}</Text>
              </Box>
            ))}
          </Box>
        );
      })}
      {filter && shownSelectable === 0 && (
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
          <KeyHints hints={hints} />
        </Box>
      )}
    </Box>
  );
}
