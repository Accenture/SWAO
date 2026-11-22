// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, finish panel and error panel (mockups M-13, M-15)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4253 (TUI-09, Design 126 sections 4.7, 4.9 and 8 rule 9, mockups M-13,
// M-15, F-03). FinishPanel: a result title in the colour of its level
// (ok green, warn yellow, fail red), a short aligned block of DetailRows
// with the real run path (a row whose value still holds a placeholder such
// as <ts> is left out, rule 9), the per-item reasons of a failed or partial
// run, and the "What next" menu, which always ends with "Back to main menu"
// (the finish action, section 7.3). No letter keys (Q-08 decided): every
// action is a menu entry. ErrorPanel: `[fail]` and the title, the cause in
// words (no stack trace; the log path goes to the guidance), and a "What
// now" menu of recovery entries that always has a way back, so Enter is
// never dead (#4241).
//
// Both are content of ScreenLayout: the screen passes FINISH_PANEL_KEYS or
// ERROR_PANEL_KEYS as its key hints. The menus own Enter and the arrows up
// and down; the left arrow belongs to the flow (useFlowNavigation) unless
// `onBack` is given. The menus draw no hint line of their own (#4256, owner
// 2026-11-10 15:01): the screen's KeyHints line is the only one.

import { useCallback, useRef } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { tone } from '../theme.js';
import { SelectInput, type SelectOption } from './SelectInput.js';
import { StatusLabel, StatusRow, type DetailRowProps, type StatusLevel } from './StatusLabel.js';
import { SummaryBlock } from './ConfirmPanel.js';
import { KEY_HINTS, type KeyHint } from './KeyHints.js';
import { useHeaderWidth } from './header-width.js';
import { wrapWords } from './run-output.js';

/** The value of the "Back to main menu" entry every finish menu ends with. */
export const FINISH_MAIN_MENU = 'main-menu';
/** The value of the way back an error menu always has. */
export const ERROR_BACK = 'back';
/** Rows of the What next and What now menus shown at once (PICKER_VISIBLE_COUNT). */
const MENU_WINDOW = 10;

/** The key hints of a finish screen (section 4.7): `↑↓ select   Enter open   Esc abort`. */
export const FINISH_PANEL_KEYS: readonly KeyHint[] = KEY_HINTS.menu;
/** The key hints of an error screen (section 4.9, M-15): `↑↓ select   Enter open   ← back   Esc abort`. */
export const ERROR_PANEL_KEYS: readonly KeyHint[] = [
  { key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'open' }, { key: '←', verb: 'back' }, { key: 'Esc', verb: 'abort' },
];

/** A score as the finish block shows it: the number, or "not measured" (#4243). */
export function scoreText(score: number | null | undefined, digits = 1): string {
  return typeof score === 'number' && Number.isFinite(score) ? score.toFixed(digits) : 'not measured';
}

const PLACEHOLDER = /<(ts|latest)>/;
/** Rule 9: a placeholder never reaches the screen; the row is left out. An empty value reads "not measured". */
export function finishRows(rows: readonly DetailRowProps[]): DetailRowProps[] {
  return rows
    .filter((r) => !PLACEHOLDER.test(r.value))
    .map((r) => (r.value.trim() === '' || r.value.trim() === '-'.repeat(2) ? { ...r, value: 'not measured' } : r));
}

/** The What next entries with "Back to main menu" last (added when missing). */
export function finishMenu(next: readonly SelectOption[]): SelectOption[] {
  const rest = next.filter((o) => o.value !== FINISH_MAIN_MENU);
  return [...rest, { label: 'Back to main menu', value: FINISH_MAIN_MENU }];
}

/** The What now entries with a way back (added as "Back" when no entry has the value `back`). */
export function recoveryMenu(recovery: readonly SelectOption[]): SelectOption[] {
  return recovery.some((o) => o.value === ERROR_BACK) ? [...recovery] : [...recovery, { label: 'Back', value: ERROR_BACK }];
}

/** The cause in words: no stack frames, no "Error:" prefix (section 4.9). */
export function causeText(cause: string): string {
  return cause
    .split('\n')
    .filter((l) => !/^\s*at\s/.test(l))
    .join('\n')
    .replace(/^(\w*Error):\s*/, '')
    .trim();
}

/** A per-item result of a finished run: the failed leg or app and its reason. */
export interface FinishItem {
  level: StatusLevel;
  label: string;
  reason: string;
}

export interface FinishPanelProps {
  /** "Service Portfolio Assessment complete" (or "failed", "needs attention"). */
  title: string;
  level: 'ok' | 'warn' | 'fail';
  /** Three to five rows: App, Passes, Outputs with the real run path. */
  rows: DetailRowProps[];
  /** Per-item results with their reason (a failed or partial run). */
  items?: FinishItem[];
  /** What next entries; "Back to main menu" is appended. */
  next: SelectOption[];
  /** Enter on an entry; `FINISH_MAIN_MENU` for "Back to main menu". */
  onSelect(value: string): void;
  /** Called on "Back to main menu" in addition to onSelect. */
  onMainMenu?(): void;
  /** Keys are read only while active (default true). */
  active?: boolean;
}

const LEVEL_TOKEN = { ok: 'ok', warn: 'warning', fail: 'error' } as const;

export function FinishPanel({ title, level, rows, items = [], next, onSelect, onMainMenu, active = true }: FinishPanelProps): JSX.Element {
  const width = useHeaderWidth();
  const menu = finishMenu(next);
  const cb = useRef({ onSelect, onMainMenu });
  cb.current = { onSelect, onMainMenu };
  const select = useCallback((value: string): void => {
    cb.current.onSelect(value);
    if (value === FINISH_MAIN_MENU) cb.current.onMainMenu?.();
  }, []);
  return (
    <Box flexDirection="column" width={width}>
      <Text {...tone(LEVEL_TOKEN[level], { bold: true })} wrap="wrap">{title}</Text>
      <Box flexDirection="column" marginTop={1}>
        <SummaryBlock rows={finishRows(rows)} />
      </Box>
      {items.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {items.map((it, i) => <StatusRow key={`${it.label}-${i}`} level={it.level} label={it.label} detail={it.reason} />)}
        </Box>
      )}
      <Box marginTop={1}>
        <SelectInput label="What next" options={menu} onSelect={select} active={active} visibleCount={MENU_WINDOW} showKeyHints={false} />
      </Box>
    </Box>
  );
}

export interface ErrorPanelProps {
  /** "Read-only probe failed". */
  title: string;
  /** What happened, in words; stack frames are removed. */
  cause: string;
  /** Recovery entries (Probe again, Continue without this scope, Back); a "Back" entry is added when none has the value `back`. */
  recovery: SelectOption[];
  /** Enter on an entry; `ERROR_BACK` for the way back. */
  onSelect(value: string): void;
  /** Left arrow; give it only when no useFlowNavigation owns the left arrow. */
  onBack?(): void;
  /** The log with the details; shown in the guidance (errorGuidance), never on the panel. */
  logPath?: string;
  /** Keys are read only while active (default true). */
  active?: boolean;
}

/** The guidance entry of an error screen: the remedy, the shortened log path and the CLI equivalent last (section 4.9, rule 10). */
export function errorGuidance(opts: { title: string; remedy: string; logPath?: string; cli?: string }): { title: string; what: string } {
  const parts = [opts.remedy.trim()];
  if (opts.logPath) parts.push(`The log has the details: ${opts.logPath}.`);
  if (opts.cli) parts.push(`CLI: ${opts.cli}`);
  return { title: opts.title, what: parts.join(' ') };
}

export function ErrorPanel({ title, cause, recovery, onSelect, onBack, active = true }: ErrorPanelProps): JSX.Element {
  const width = useHeaderWidth();
  const menu = recoveryMenu(recovery);
  const cb = useRef({ onBack });
  cb.current = { onBack };
  useInput(useCallback((_input: string, key: Key) => {
    if (key.leftArrow) cb.current.onBack?.();
  }, []), { isActive: active });
  return (
    <Box flexDirection="column" width={width}>
      <Box width={width}>
        <StatusLabel level="fail" />
        <Text> </Text>
        <Box flexGrow={1}><Text {...tone('error', { bold: true })} wrap="wrap">{title}</Text></Box>
      </Box>
      {causeText(cause).split(/\r?\n/).flatMap((para) => wrapWords(para, width)).map((l, i) => (
        <Text key={i} {...tone('text')} wrap="wrap">{l}</Text>
      ))}
      <Box marginTop={1}>
        <SelectInput label="What now" options={menu} onSelect={onSelect} active={active} visibleCount={MENU_WINDOW} showKeyHints={false} />
      </Box>
    </Box>
  );
}
