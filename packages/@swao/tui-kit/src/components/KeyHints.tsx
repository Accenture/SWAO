// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, key hints with the fixed verb list
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4246 (TUI-02, Design 126 sections 5.2, 7.9 and mockup M-09): the only
// renderer of key hints. A hint is a key, one space, a verb from the fixed
// list (and an optional object such as "guidance"); hints are joined by three
// spaces; no colon, no vertical bar, no double hyphen. `form="line"` is the
// compact line directly above the guidance box; `form="full"` is the keys
// section inside the expanded box, with key names in words.
//
// Verb list (Q-04 decided: `next` in flows, `continue` is not a verb; Q-01
// decided: the pager reads `PgDn next   PgUp previous`, so `previous` is a
// verb; Q-03 decided: the main menu asks "Exit SWAO?" with `Enter exit`).

import { Box, Text } from 'ink';
import { tone } from '../theme.js';
import { useActiveFilter, withFilterHint } from './list-filter.js';

/** The fixed verbs of a key hint. A verb outside this union is a type error. */
export type KeyVerb =
  | 'select' | 'open' | 'next' | 'back' | 'finish' | 'confirm' | 'abort' | 'stay'
  | 'cancel' | 'toggle' | 'filter' | 'page' | 'retry' | 'scroll' | 'close'
  | 'previous' | 'exit' | 'send'
  // #4347: list editors (LLM Setup candidates): A add, D remove, Enter save.
  | 'add' | 'remove' | 'save';

/** The keys a hint may name (section 7.1), in their compact form. */
export type KeyName =
  | '↑↓' | '←' | '→' | 'Enter' | 'Esc' | 'Space' | 'Tab' | 'Shift+Tab'
  | 'Ctrl+G' | 'PgUp' | 'PgDn' | '1 to 9' | 'Type'
  // #4249: the one letter key a hint names (MultiSelect "A toggle all", section 7.1 letters).
  | 'A'
  // #4347: D removes the highlighted entry of a list editor.
  | 'D'
  // #4257: L opens the Licence screen from the licence gate.
  | 'L';

/** Every verb, for checks and documentation. */
export const KEY_VERBS: readonly KeyVerb[] = [
  'select', 'open', 'next', 'back', 'finish', 'confirm', 'abort', 'stay',
  'cancel', 'toggle', 'filter', 'page', 'retry', 'scroll', 'close', 'previous', 'exit',
  // #4257: the Chat screen sends a message with Enter.
  'send',
  // #4347: list editors.
  'add', 'remove', 'save',
];

/** Key names in words for the keys section of the expanded guidance box (M-10). */
export const KEY_NAME_FULL: Readonly<Record<KeyName, string>> = {
  '↑↓': 'Up and Down arrows',
  '←': 'Left arrow',
  '→': 'Right arrow',
  Enter: 'Enter',
  Esc: 'Esc',
  Space: 'Space',
  Tab: 'Tab',
  'Shift+Tab': 'Shift+Tab',
  'Ctrl+G': 'Ctrl+G',
  PgUp: 'PgUp',
  PgDn: 'PgDn',
  '1 to 9': 'Number keys',
  Type: 'Type',
  A: 'A',
  D: 'D',
  L: 'L',
};

export interface KeyHint {
  key: KeyName;
  verb: KeyVerb;
  /** What the verb acts on, for example "guidance" or "all". */
  object?: string;
}

export interface KeyHintsProps {
  hints: readonly KeyHint[];
  /** `line` (default): compact keys; `full`: key names in words. */
  form?: 'line' | 'full';
}

/** The separator between two hints: three spaces. */
export const KEY_HINT_SEPARATOR = '   ';

function keyText(h: KeyHint, form: 'line' | 'full'): string {
  return form === 'full' ? KEY_NAME_FULL[h.key] : h.key;
}

function verbText(h: KeyHint): string {
  return h.object ? `${h.verb} ${h.object}` : h.verb;
}

/** One hint as plain text: "Enter next". */
export function formatKeyHint(h: KeyHint, form: 'line' | 'full' = 'line'): string {
  return `${keyText(h, form)} ${verbText(h)}`;
}

/** A hint line as plain text: "Enter next   ← back   Esc abort". */
export function formatKeyHints(hints: readonly KeyHint[], form: 'line' | 'full' = 'line'): string {
  return hints.map((h) => formatKeyHint(h, form)).join(KEY_HINT_SEPARATOR);
}

/** The standard hint lines of Design 126 section 7.9. */
export const KEY_HINTS = {
  menu: [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'open' }, { key: 'Esc', verb: 'abort' }],
  picker: [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'next' }, { key: '←', verb: 'back' }, { key: 'Esc', verb: 'abort' }],
  multiSelect: [{ key: '↑↓', verb: 'select' }, { key: 'Space', verb: 'toggle' }, { key: 'Enter', verb: 'next' }, { key: '←', verb: 'back' }, { key: 'Esc', verb: 'abort' }],
  textInput: [{ key: 'Enter', verb: 'next' }, { key: 'Shift+Tab', verb: 'back' }, { key: 'Esc', verb: 'abort' }],
  confirm: [{ key: 'Enter', verb: 'confirm' }, { key: '←', verb: 'back' }, { key: 'Esc', verb: 'abort' }],
  lastStep: [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'finish' }, { key: 'Esc', verb: 'abort' }],
  run: [{ key: 'Esc', verb: 'cancel' }],
  abortDialog: [{ key: 'Enter', verb: 'abort' }, { key: 'Esc', verb: 'stay' }],
  cancelDialog: [{ key: 'Enter', verb: 'cancel' }, { key: 'Esc', verb: 'stay' }],
  exitDialog: [{ key: 'Enter', verb: 'exit' }, { key: 'Esc', verb: 'stay' }],
  guidanceClose: [{ key: 'Ctrl+G', verb: 'close', object: 'guidance' }],
  guidancePager: [{ key: 'PgDn', verb: 'next' }, { key: 'PgUp', verb: 'previous' }],
} as const satisfies Record<string, readonly KeyHint[]>;

/**
 * The hint line: key names in the `accent` token, verbs in `muted`
 * (section 15.3). Hints wrap as whole hints when the line is narrower than
 * the hints; a hint is never split.
 */
export function KeyHints({ hints: given, form = 'line' }: KeyHintsProps): JSX.Element {
  // #4492 (Design 126 section 7.14): a list hint row names the filter of an active filterable list.
  const filterActive = useActiveFilter() !== null;
  const hints = filterActive && given.some((h) => h.key === '↑↓') ? withFilterHint(given) : given;
  return (
    <Box flexDirection="row" flexWrap="wrap">
      {hints.map((h, i) => (
        <Box key={`${h.key}-${h.verb}-${i}`} marginRight={i < hints.length - 1 ? KEY_HINT_SEPARATOR.length : 0}>
          <Text>
            <Text {...tone('accent')}>{keyText(h, form)}</Text>
            <Text {...tone('muted')}>{` ${verbText(h)}`}</Text>
          </Text>
        </Box>
      ))}
    </Box>
  );
}
