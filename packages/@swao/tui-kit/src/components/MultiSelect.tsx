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

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { classifyMouseInput, acquireMouseReporting } from '../input/mouse.js';

export interface MultiSelectOption {
  label: string;
  value: string;
  /** #3380: a non-selectable section header row (e.g. a country group). The
   *  cursor skips it, Space/A never toggle it, and it renders without a box. */
  header?: boolean;
}

interface MultiSelectProps {
  label: string;
  options: MultiSelectOption[];
  initialSelected?: string[];
  onConfirm: (values: string[]) => void;
  active?: boolean;
  /** If set, selecting this value deselects all others (and vice versa). */
  allValue?: string;
  /** Fired when the cursor moves so the parent can render per-active-row
   *  guidance below the picker (#0382, sprint-040). Receives the active
   *  option's value (not the index) so the parent can look up metadata by id. */
  onCursorChange?: (activeValue: string) => void;
  /** When true, Enter on an empty selection still fires onConfirm([]).
   *  Default false (legacy behaviour: Enter blocks until something is
   *  picked). Set to true for "optional flags" pickers where the
   *  meaningful default is "select nothing, use defaults" -- e.g. the BI
   *  export `--no-bom` / `--crlf` flags (#0390, sprint-040). */
  allowEmptyConfirm?: boolean;
  /** Maximum number of option rows rendered at once. When options.length
   *  exceeds this value the list scrolls and shows up/down count indicators
   *  so the frame height stays bounded (#0620). */
  visibleCount?: number;
  /** #3519: opt-in mouse wheel navigation (default false). When false, terminal
   *  mouse reporting is not enabled, so the wheel scrolls the terminal and
   *  never moves the cursor. Same contract as SelectInput. */
  wheelNavigation?: boolean;
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
}: MultiSelectProps): JSX.Element {
  // #0245: when allValue is set, treat it as a derived aggregate of the
  // individual options. The "all" row displays checked iff every other
  // option is checked; the sentinel value is never stored in the
  // internal selected set. Initial state expands the sentinel so the
  // picker opens with every individual row pre-checked when the caller
  // passes initialSelected: [allValue].
  const allRegularValues = allValue
    ? options.filter(o => o.value !== allValue && !o.header).map(o => o.value)
    : [];

  // #3380: the cursor only ever rests on a selectable (non-header) row.
  const firstSelectableIdx = (): number => {
    const i = options.findIndex(o => !o.header);
    return i >= 0 ? i : 0;
  };

  // #1086: start cursor on the first pre-selected (non-header) item so operators
  // see immediately which option is checked. Falls back to the first selectable.
  const [idx, setIdx] = useState(() => {
    const first = initialSelected.length > 0
      ? options.findIndex(o => !o.header && initialSelected.includes(o.value))
      : -1;
    return first >= 0 ? first : firstSelectableIdx();
  });

  // #0805: Ink re-registers the useInput listener on every render (inputHandler
  // is an inline function -- new reference each time). Between cleanup and
  // re-registration the OLD handler fires with a stale closure, meaning `options`
  // and `idx` captured at the previous render. If `options` shrank (e.g. filter
  // applied) or `idx` is now out of bounds, `options[idx]!.value` crashes.
  // Pattern mirrors GuidanceBox #0753: refs always hold the current value so
  // the stale-closure handler reads live data instead of a frozen snapshot.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const idxRef = useRef(idx);
  idxRef.current = idx;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (onCursorChange && options[idx]) onCursorChange(options[idx].value);
  }, [idx, options, onCursorChange]);

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
    const initial = new Set(initialSelected);
    if (allValue && initial.has(allValue)) {
      initial.delete(allValue);
      allRegularValues.forEach(v => initial.add(v));
    }
    return initial;
  });

  // #0620: scroll-window state -- keep the cursor row inside the visible band.
  const [scrollTop, setScrollTop] = useState(0);
  useLayoutEffect(() => {
    if (!visibleCount || visibleCount >= options.length) return;
    setScrollTop(prev => {
      if (idx < prev) return idx;
      if (idx >= prev + visibleCount) return idx - visibleCount + 1;
      return prev;
    });
  }, [idx, visibleCount, options.length]);

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
    const opts = optionsRef.current;
    const cur  = idxRef.current;
    // #3380: step over header rows so the cursor only lands on selectable options.
    const step = (i: number, dir: 1 | -1): number => {
      let n = i;
      do { n += dir; } while (n >= 0 && n < opts.length && opts[n]?.header);
      return (n >= 0 && n < opts.length) ? n : i;
    };
    const mouse = classifyMouseInput(input);
    if (mouse) {
      if (!wheelNavRef.current) return; // #3519: swallowed unless opted in
      if (mouse === 'wheel-up')   setIdx(i => step(i, -1));
      if (mouse === 'wheel-down') setIdx(i => step(i, 1));
      return;
    }
    if (key.upArrow)   setIdx(i => step(i, -1));
    if (key.downArrow) setIdx(i => step(i, 1));
    if (input === ' ') {
      const opt = opts[cur];
      if (opt && !opt.header) toggle(opt.value);
    }
    if (input === 'a' || input === 'A') {
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
        const allValues = opts.filter(o => !o.header).map(o => o.value);
        const allSelected = allValues.every(v => selected.has(v));
        setSelected(allSelected ? new Set() : new Set(allValues));
      }
    }
    if (key.return) {
      const values = Array.from(selected);
      if (values.length > 0 || allowEmptyConfirm) onConfirm(values);
    }
  };
  const processInputRef = useRef(processInput);
  processInputRef.current = processInput;
  useInput(useCallback((input: string, key: Key) => processInputRef.current(input, key), []));

  const isOptionSelected = (opt: MultiSelectOption): boolean => {
    if (opt.header) return false;
    if (allValue && opt.value === allValue) return allRegularSelected(selected);
    return selected.has(opt.value);
  };

  // Derive the visible slice for bounded rendering (#0620).
  const vc = (visibleCount && visibleCount < options.length) ? visibleCount : options.length;
  const visibleOpts = options.slice(scrollTop, scrollTop + vc);
  const aboveCount  = scrollTop;
  const belowCount  = options.length - scrollTop - vc;

  // #1087: pad every label to the longest label width so that when shorter
  // labels replace longer ones in the same terminal row (due to scroll-window
  // movement), the trailing spaces overwrite any leftover characters that Ink
  // does not clear to end-of-line on its own.
  const maxLabelLen = options.reduce((m, o) => Math.max(m, o.label.length), 0);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>{label}:</Text>
      {aboveCount > 0 && (
        <Box marginLeft={2}>
          <Text dimColor wrap="truncate">{`↑ ${aboveCount} more`.padEnd(6 + maxLabelLen)}</Text>
        </Box>
      )}
      {visibleOpts.map((opt, i) => {
        // #3380: a header row is a dim section label, no cursor caret, no checkbox.
        if (opt.header) {
          return (
            <Box key={opt.value} marginLeft={2}>
              <Text dimColor bold wrap="truncate">{opt.label.padEnd(maxLabelLen)}</Text>
            </Box>
          );
        }
        const isSelected = isOptionSelected(opt);
        const isCursor   = (scrollTop + i) === idx;
        return (
          <Box key={opt.value} marginLeft={2}>
            <Text wrap="truncate" color={isCursor || isSelected ? 'cyan' : undefined}>
              {isCursor ? '> ' : '  '}
              <Text color={isSelected ? 'cyan' : 'white'}>[{isSelected ? 'x' : ' '}] </Text>
              {opt.label.padEnd(maxLabelLen)}
            </Text>
          </Box>
        );
      })}
      {belowCount > 0 && (
        <Box marginLeft={2}>
          <Text dimColor wrap="truncate">{`↓ ${belowCount} more`.padEnd(6 + maxLabelLen)}</Text>
        </Box>
      )}
      {active && (
        <Box marginTop={1}>
          <Text dimColor> ↑↓ move   Space toggle   A toggle all   Enter confirm</Text>
        </Box>
      )}
    </Box>
  );
}
