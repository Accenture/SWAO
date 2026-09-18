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

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { classifyMouseInput, acquireMouseReporting } from '../input/mouse.js';

export interface SelectOption {
  label: string;
  value: string;
}

interface SelectInputProps {
  label: string;
  options: SelectOption[];
  /** Called when the user commits a selection (Enter key). Use for navigation and state transitions. */
  onSelect: (value: string) => void;
  /** Called whenever the highlighted cursor moves to a new item -- fires on mount (index 0)
   *  and on every Up/Down keystroke. Use for live preview or auto-advance logic. (#0800) */
  onCursorChange?: (value: string) => void;
  active?: boolean;
  /** Maximum number of options visible at once. When provided, a scroll-window is applied and
   *  above/below counters are shown -- same windowing pattern as MultiSelect (#0620). */
  visibleCount?: number;
}

export function SelectInput({ label, options, onSelect, onCursorChange, active = true, visibleCount }: SelectInputProps): JSX.Element {
  const [idx, setIdx] = useState(0);

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

  // #0805: Ink re-registers the useInput listener on every render (inputHandler
  // is an inline function -- new reference each time). Between cleanup and
  // re-registration the OLD handler fires with a stale closure, meaning `options`
  // and `idx` captured at the previous render. If `options` shrank or `idx` is
  // now out of bounds, `options[idx]!.value` crashes. Same pattern as MultiSelect.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const idxRef = useRef(idx);
  idxRef.current = idx;
  const activeRef = useRef(active);
  activeRef.current = active;
  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;

  // Notify parent of the initial cursor position (index 0).
  useEffect(() => {
    const opt = optionsRef.current[0];
    if (opt) onCursorChangeRef.current?.(opt.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // #1391: terminal mouse reporting while mounted -- see MultiSelect.
  useEffect(() => acquireMouseReporting(), []);

  // #1387: single stable useInput registration + mouse-report filtering.
  // Same rationale as MultiSelect -- see that component for the full note.
  const processInput = (input: string, key: Key): void => {
    if (!activeRef.current) return;
    const opts = optionsRef.current;
    const cur  = idxRef.current;
    const mouse = classifyMouseInput(input);
    if (mouse) {
      if (mouse === 'wheel-up') {
        const n = Math.max(0, cur - 1);
        setIdx(n);
        onCursorChangeRef.current?.(opts[n]?.value ?? '');
      }
      if (mouse === 'wheel-down') {
        const n = Math.min(opts.length - 1, cur + 1);
        setIdx(n);
        onCursorChangeRef.current?.(opts[n]?.value ?? '');
      }
      return;
    }
    if (key.upArrow) {
      const n = Math.max(0, cur - 1);
      setIdx(n);
      onCursorChangeRef.current?.(opts[n]?.value ?? '');
    }
    if (key.downArrow) {
      const n = Math.min(opts.length - 1, cur + 1);
      setIdx(n);
      onCursorChangeRef.current?.(opts[n]?.value ?? '');
    }
    if (key.return) {
      const opt = opts[cur];
      if (opt) onSelect(opt.value);
    }
  };
  const processInputRef = useRef(processInput);
  processInputRef.current = processInput;
  useInput(useCallback((input: string, key: Key) => processInputRef.current(input, key), []));

  // Derive the visible slice for bounded rendering (#0620).
  const vc = (visibleCount && visibleCount < options.length) ? visibleCount : options.length;
  const visibleOpts = options.slice(scrollTop, scrollTop + vc);
  const aboveCount  = scrollTop;
  const belowCount  = options.length - scrollTop - vc;

  // #1087: pad labels so shorter labels overwrite leftover chars when the window scrolls.
  const maxLabelLen = options.reduce((m, o) => Math.max(m, o.label.length), 0);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>{label}:</Text>
      {aboveCount > 0 && (
        <Box marginLeft={2}>
          <Text dimColor wrap="truncate">{`↑ ${aboveCount} more`.padEnd(6 + maxLabelLen)}</Text>
        </Box>
      )}
      {visibleOpts.map((opt, vi) => {
        const absIdx = scrollTop + vi;
        return (
          <Box key={opt.value} marginLeft={2}>
            <Text color={absIdx === idx ? 'cyan' : undefined} wrap="truncate">
              {absIdx === idx ? '❯ ' : '  '}{opt.label.padEnd(maxLabelLen)}
            </Text>
          </Box>
        );
      })}
      {belowCount > 0 && (
        <Box marginLeft={2}>
          <Text dimColor wrap="truncate">{`↓ ${belowCount} more`.padEnd(6 + maxLabelLen)}</Text>
        </Box>
      )}
      {active && <Box marginTop={1}><Text dimColor> ↑↓ select   Enter confirm</Text></Box>}
    </Box>
  );
}
