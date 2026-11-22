// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, status words, status rows and detail rows
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4247 (TUI-03, Design 126 sections 5.2, 6 and mockups M-06, M-07): the only
// source of status words and their colours in the TUI. Lower case; brackets
// in lists (`[warn]`), none in summaries (`warn`). The CLI keeps its upper
// case words (Q-05 decided); only the TUI uses this map. A fact has one level
// on every screen: the accepted write-capable login is `warn` (Q-13 / D-4).
//
// StatusRow and DetailRow are two-line rows (#4223, section 8 rule 6): the
// label stays on line 1 and a text that does not fit wraps under its column
// with a hanging indent. Nothing is cut and no row ends in an ellipsis; only
// a `path` value is shortened, and only in the middle (section 8 rule 4).

import { Box, Text } from 'ink';
import { STATUS_TOKENS, TOKENS, tone, type InkStyle, type StatusLevel, type Token } from '../theme.js';
import { fitToWidth, useHeaderWidth } from './header-width.js';
import { wrapLines } from './GuidanceBox.js';

export type { StatusLevel } from '../theme.js';

export interface StatusEntry {
  /** The status word, lower case, without brackets. */
  word: string;
  /** The colour token of the level (section 15.4). */
  token: Token;
  /** The Ink style of the token. */
  style: Readonly<InkStyle>;
  /** What the level means (section 6). */
  meaning: string;
}

const MEANING: Readonly<Record<StatusLevel, string>> = {
  ok: 'configured and verified',
  info: 'informational, nothing to do',
  warn: 'degraded or optional part missing',
  waiting: 'your input is expected, nothing is wrong',
  cancelled: 'run stopped by the operator',
  fail: 'the next action fails without a fix',
  missing: 'required input absent',
};

/** The levels in the order of mockup M-07. */
export const STATUS_LEVELS: readonly StatusLevel[] = ['ok', 'info', 'warn', 'waiting', 'cancelled', 'fail', 'missing'];

/** Status level to word and colour token: the only source of both in the TUI (section 6). */
export const STATUS_MAP: Readonly<Record<StatusLevel, StatusEntry>> = Object.fromEntries(
  STATUS_LEVELS.map((level) => [level, { word: level, token: STATUS_TOKENS[level], style: TOKENS[STATUS_TOKENS[level]], meaning: MEANING[level] }]),
) as Record<StatusLevel, StatusEntry>;

/**
 * Q-13 / D-4 (decided 2026-11-09): an accepted write-capable operator login is
 * `warn` with this text on every screen (LZ Connections, Probe, Health Check,
 * Ready).
 */
export const WRITE_CAPABLE_ACCEPTED = {
  level: 'warn',
  text: 'write-capable, accepted for this run; SWAO only reads',
} as const satisfies { level: StatusLevel; text: string };

/** The status word as text: `[warn]` in lists, `warn` in summaries. */
export function statusText(level: StatusLevel, form: 'list' | 'summary' = 'list'): string {
  const word = STATUS_MAP[level].word;
  return form === 'list' ? `[${word}]` : word;
}

export interface StatusLabelProps {
  level: StatusLevel;
  form?: 'list' | 'summary';
  /**
   * #4294 / #4223: a state word of its own ("ready", "not set up") in the
   * colour of `level`; the level word when absent. Brackets follow `form`.
   */
  text?: string;
}

/** One status word in the colour of its level. */
export function StatusLabel({ level, form = 'list', text }: StatusLabelProps): JSX.Element {
  const word = text === undefined ? statusText(level, form) : form === 'list' ? `[${text}]` : text;
  return <Text {...tone(STATUS_MAP[level].token)}>{word}</Text>;
}

/** Columns of the row indent (the cursor marker of a selected row sits here). */
export const ROW_INDENT = 2;
/** Default width of the status column: `[missing]` plus one space (M-06). */
export const STATUS_COLUMN_WIDTH = 10;
const MARKER = '❯';

function labelWidthFor(width: number, labelWidth: number | undefined): number {
  // Mockup M-06: 20 columns at the 100-column rule, 18 at the 78-column rule.
  return labelWidth ?? (width >= 90 ? 20 : 18);
}

/** #4295 / #4348: the narrowest summary column a status row keeps next to its label. */
export const MIN_STATUS_SUMMARY_WIDTH = 20;

/** Columns of the status column and the counter of a row. */
function statusChrome(level: StatusLevel, statusWidth: number | undefined, counter: { total: number } | undefined): { statusCol: number; counterLen: number } {
  const statusCol = Math.max(statusWidth ?? STATUS_COLUMN_WIDTH, statusText(level).length + 1);
  const counterLen = counter ? formatCounter(counter.total, counter.total).length + 1 : 0;
  return { statusCol, counterLen };
}

/** The most columns a label may take: the row minus indent, status, counter and the minimum summary. */
function labelRoom(width: number, statusCol: number, counterLen: number): number {
  return Math.max(1, width - ROW_INDENT - statusCol - counterLen - MIN_STATUS_SUMMARY_WIDTH);
}

/**
 * #4295 / #4348 (Design 126 section 10): the label column of one status row.
 * The column widens to the label plus one space when the label is wider than
 * the given column and still fits the row, so a label never wraps inside its
 * column ("Vendor catalogue (Tier 2)" used to wrap after "(Tier"). StatusRow
 * and statusRowHeight both use it, so the height a list counts is the height
 * on screen.
 */
export function statusLabelColumnFor(width: number, labelWidth: number | undefined, label: string, statusCol: number, counterLen: number): number {
  const base = labelWidthFor(width, labelWidth);
  if (label.length < base) return base;
  return Math.max(base, Math.min(label.length + 1, labelRoom(width, statusCol, counterLen)));
}

/**
 * The common label column of a status list (DetailRow pattern): the longest
 * label plus two spaces, at least `min`, at most what leaves the minimum
 * summary column after status and counter. Lists pass it as `labelWidth` so
 * every row has the same column and no label wraps.
 */
export function statusLabelWidth(
  labels: readonly string[],
  width: number,
  opts: { statusWidth?: number; counter?: { total: number }; min?: number } = {},
): number {
  const { statusCol, counterLen } = statusChrome('missing', opts.statusWidth, opts.counter);
  const longest = labels.reduce((m, l) => Math.max(m, l.length), 0);
  return Math.max(opts.min ?? 1, Math.min(longest + 2, labelRoom(width, statusCol, counterLen)));
}

export interface StatusRowProps {
  level: StatusLevel;
  label: string;
  /** Short text on line 1 after the label ("not found"). */
  summary?: string;
  /** Longer text on line 2 and following, under the label column (two-line row). */
  detail?: string;
  /** Cursor row: the marker in the indent and the label in `selection`. */
  selected?: boolean;
  /** Label column width; default as drawn in M-06. */
  labelWidth?: number;
  /** Status column width; default 10, at least the word plus one space. */
  statusWidth?: number;
  /** A counter such as [1/15], right-aligned to the width of [total/total]. */
  counter?: { index: number; total: number };
  /** #4223: the tone of summary and detail; default `muted` (the Ready step shows its values in `text`). */
  textTone?: Token;
}

/** `[ 1/15]`-style counter, right-aligned so the name column does not shift (#4235 row 10). */
export function formatCounter(index: number, total: number): string {
  const inner = `${index}/${total}`;
  return `[${inner}]`.padStart(`[${total}/${total}]`.length);
}

/** A status list row (M-06): status, label, summary on line 1; the detail wrapped under the label. */
export function StatusRow({ level, label, summary, detail, selected = false, labelWidth, statusWidth, counter, textTone = 'muted' }: StatusRowProps): JSX.Element {
  const width = useHeaderWidth();
  const statusCol = Math.max(statusWidth ?? STATUS_COLUMN_WIDTH, statusText(level).length + 1);
  const counterText = counter ? formatCounter(counter.index, counter.total) + ' ' : '';
  const labelCol = statusLabelColumnFor(width, labelWidth, label, statusCol, counterText.length);
  const detailIndent = ROW_INDENT + statusCol;
  const summaryWidth = Math.max(1, width - detailIndent - counterText.length - labelCol);
  return (
    <Box flexDirection="column" width={width}>
      <Box>
        <Box width={ROW_INDENT}><Text {...tone('selection')}>{selected ? MARKER : ''}</Text></Box>
        <Box width={statusCol}><StatusLabel level={level} /></Box>
        {counter && <Box width={counterText.length}><Text {...tone('muted')}>{counterText}</Text></Box>}
        <Box width={labelCol}><Text {...tone(selected ? 'selection' : 'text')} wrap="wrap">{label}</Text></Box>
        {summary && <Box width={summaryWidth}><Text {...tone(textTone)} wrap="wrap">{summary}</Text></Box>}
      </Box>
      {detail && (
        <Box marginLeft={detailIndent} width={Math.max(1, width - detailIndent)}>
          <Text {...tone(textTone)} wrap="wrap">{detail}</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * #4348: the terminal lines one StatusRow takes at the header rule `width`,
 * with the label, summary and detail word-wrapped as the row wraps them, so a
 * paged list can count its real row heights (computeListWindow).
 */
export function statusRowHeight(row: Pick<StatusRowProps, 'level' | 'label' | 'summary' | 'detail' | 'labelWidth' | 'statusWidth' | 'counter'>, width: number): number {
  const statusCol = Math.max(row.statusWidth ?? STATUS_COLUMN_WIDTH, statusText(row.level).length + 1);
  const counterText = row.counter ? formatCounter(row.counter.index, row.counter.total) + ' ' : '';
  const labelCol = statusLabelColumnFor(width, row.labelWidth, row.label, statusCol, counterText.length);
  const detailIndent = ROW_INDENT + statusCol;
  const summaryWidth = Math.max(1, width - detailIndent - counterText.length - labelCol);
  const first = Math.max(1, wrapLines(row.label, labelCol).length, row.summary ? wrapLines(row.summary, summaryWidth).length : 0);
  const detail = row.detail ? wrapLines(row.detail, Math.max(1, width - detailIndent)).length : 0;
  return first + detail;
}

/** Default label column of a DetailRow block (M-06: "Outputs" plus padding). */
export const DETAIL_LABEL_WIDTH = 11;

export interface DetailRowProps {
  label: string;
  /** The value; `\n` starts a further line under the value column. */
  value: string;
  labelWidth?: number;
  /** A path: shown in `accent`, each line shortened in the middle only when it does not fit. */
  path?: boolean;
}

/** `Label  value` (M-06, M-11, M-13): the value wraps with a hanging indent under the value column. */
export function DetailRow({ label, value, labelWidth = DETAIL_LABEL_WIDTH, path = false }: DetailRowProps): JSX.Element {
  const width = useHeaderWidth();
  const labelCol = Math.max(labelWidth, label.length + 1);
  const valueWidth = Math.max(1, width - ROW_INDENT - labelCol);
  const lines = value.split('\n').map((l) => (path ? fitToWidth(l, valueWidth, 'middle') : l));
  return (
    <Box width={width}>
      <Box width={ROW_INDENT} />
      <Box width={labelCol}><Text {...tone('muted')}>{label}</Text></Box>
      <Box width={valueWidth} flexDirection="column">
        {lines.map((l, i) => (
          <Text key={i} {...tone(path ? 'accent' : 'text')} wrap="wrap">{l}</Text>
        ))}
      </Box>
    </Box>
  );
}
