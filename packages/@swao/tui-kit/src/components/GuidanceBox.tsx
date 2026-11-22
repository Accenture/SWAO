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

// GuidanceBox -- bottom-of-screen explanatory panel (#0370 umbrella,
// sprint-040), the only implementation of the guidance text and the Ctrl+G
// toggle (#4123). Screens pass content through the props; they never repeat
// the close hint in their affordances. The frame stability across a toggle
// comes from TerminalFrame (run-app root), not from padding in this box.
//
// #4250 (TUI-06, Design 126 section 9, mockup M-10): the expanded box has a
// fixed structure, top to bottom:
//
//   title
//   explanation, at most three lines at 100 columns and four at 80 (Q-02),
//     the CLI equivalent as its last line ("CLI: ...")
//   inline sections ("Requirement: ..."), hanging indent, no blank line
//   pager line when the sections are paged (PgDn, PgUp)
//   one blank line
//   keys of the screen (KeyHints form="full")
//   rule line
//   close hint (Ctrl+G close guidance)
//
// The box is height-bounded: it never grows past `maxRows` (ScreenLayout
// passes the rows left under the content). Title, explanation, keys and
// close hint are always shown; sections that do not fit are paged, and an
// explanation longer than its lines continues in a "More" section. When even
// the fixed part does not fit, the box stays in its collapsed form. Text is
// wrapped here, line by line, so the line count the height bound uses is the
// line count on screen.

import { useState, useEffect, useRef, useContext } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { headerRuleWidth } from './header-width.js';
import { tone, tokenColor } from '../theme.js';
import { KeyHints, KEY_HINTS, KEY_HINT_SEPARATOR, formatKeyHint, formatKeyHints, type KeyHint } from './KeyHints.js';
import { useReportGuidancePresence, type GuidanceEntry, type GuidanceSection } from './guidance-entry.js';
import { GuidanceOpenContext } from './guidance-open.js';
import { FILTER_GUIDANCE_LABEL, useActiveFilter } from './list-filter.js';

// Helper: reset parent guidance state on unmount even if the panel was open.
// Defined outside the component so it is not recreated on each render.
function useOnOpenChangeCleanup(onOpenChange: ((open: boolean) => void) | undefined): void {
  const ref = useRef(onOpenChange);
  ref.current = onOpenChange;
  useEffect(() => {
    return () => { ref.current?.(false); };
  }, []); // empty deps -- fires only on unmount, not on prop changes
}

/** Retained for API compatibility. Since #4250 the explanation is bounded by lines, not characters (Q-02). */
export const MAX_WHAT_CHARS = 280;
/** Retained for API compatibility. Since #4123 the expanded box no longer truncates detail values; they wrap. */
export const MAX_DETAIL_VALUE_CHARS = 200;

/** Q-02: explanation lines (CLI line included) at a wide box (100 columns) and a narrow one (80 columns). */
export const EXPLANATION_LINES_WIDE = 3;
export const EXPLANATION_LINES_NARROW = 4;
/** Inner widths from this one up count as wide (the 100-column box is 92 wide, the 80-column box 72). */
export const EXPLANATION_WIDE_FROM = 90;

/** Label of the section that continues an explanation longer than its lines. */
export const MORE_SECTION_LABEL = 'More';

/** #4123: footer hint of the expanded box. The only place this text lives;
 *  screens must not repeat it in their affordances (gate: guidance-hint-central.test.ts).
 *  #4246 (Design 126 Q-01): rendered through KeyHints, so it reads "Ctrl+G close guidance". */
export const GUIDANCE_CLOSE_HINT = formatKeyHints(KEY_HINTS.guidanceClose);

/**
 * Truncate `text` at a word boundary so the displayed string never ends
 * mid-word. The result including "..." is at most `maxWidth` characters.
 * #2363: used for the collapsed GuidanceBox "what" row.
 */
export function truncateAtWordBoundary(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  return text.slice(0, Math.max(0, maxWidth - 3)).replace(/\s+\S*$/, '') + '...';
}

/**
 * Word-wrap `text` at `w` columns. Embedded \n start a new line; a word wider
 * than the line is broken hard, so no line is ever wider than `w`.
 */
export function wrapLines(text: string, w: number): string[] {
  const width = Math.max(1, w);
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const raw of para.split(' ')) {
      let word = raw;
      while (word.length > width) {
        if (line !== '') { out.push(line); line = ''; }
        out.push(word.slice(0, width));
        word = word.slice(width);
      }
      if (line === '') line = word;
      else if (line.length + 1 + word.length <= width) line = `${line} ${word}`;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

/**
 * Number of terminal lines `text` occupies when word-wrapped at `w` columns.
 * Handles embedded \n (#2321) and words wider than the line.
 */
export function countWrappedLines(text: string, w: number): number {
  return wrapLines(text, w).length;
}

export interface GuidanceDetail {
  label: string;
  value: string;
}

/** The explanation lines of a box `innerWidth` wide (CLI line included): three wide, four narrow (Q-02). */
export function explanationLineLimit(innerWidth: number): number {
  return innerWidth >= EXPLANATION_WIDE_FROM ? EXPLANATION_LINES_WIDE : EXPLANATION_LINES_NARROW;
}

/** One rendered section line: the label on the first line of a section, an indent on the others. */
interface SectionLine {
  label?: string;
  indent: number;
  text: string;
}

/** Hanging indent of a section: under the text after "Label: ", at most half the box. */
function sectionIndent(label: string, innerWidth: number): number {
  if (label === '') return 0;
  return Math.min(label.length + 2, Math.floor(innerWidth / 2));
}

/** The lines of one inline section (#4250, section 9.3 item 3). */
function sectionLines(s: GuidanceSection, innerWidth: number): SectionLine[] {
  const indent = sectionIndent(s.label, innerWidth);
  const lines = wrapLines(s.text, Math.max(1, innerWidth - indent));
  return lines.map((text, i) => (i === 0 && s.label !== '' ? { label: s.label, indent, text } : { indent, text }));
}

/**
 * #4123 / #4250: split the inline sections into pages that each fit in
 * `budget` lines. Every section lands on exactly one page when it fits a
 * page; a page always holds at least one section.
 */
export function paginateDetails(
  details: ReadonlyArray<GuidanceDetail>,
  innerWidth: number,
  budget: number,
): GuidanceDetail[][] {
  const pages: GuidanceDetail[][] = [];
  let page: GuidanceDetail[] = [];
  let used = 0;
  for (const d of details) {
    const n = sectionLines({ label: d.label, text: d.value }, innerWidth).length;
    if (page.length > 0 && used + n > budget) {
      pages.push(page);
      page = [];
      used = 0;
    }
    used += n;
    page.push(d);
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

/** A page of section lines and the (1-based) section numbers it shows. */
interface SectionPage {
  lines: SectionLine[];
  first: number;
  last: number;
}

/** Pages of at most `budget` lines; a section taller than a page continues on the next one. */
function pageSections(sections: readonly GuidanceSection[], innerWidth: number, budget: number): SectionPage[] {
  const pages: SectionPage[] = [];
  let cur: SectionPage | null = null;
  sections.forEach((s, i) => {
    const lines = sectionLines(s, innerWidth);
    if (cur && cur.lines.length + lines.length > budget) { pages.push(cur); cur = null; }
    for (let at = 0; at < lines.length; at += budget) {
      const chunk = lines.slice(at, at + budget);
      if (!cur) cur = { lines: [], first: i + 1, last: i + 1 };
      if (cur.lines.length + chunk.length > budget) { pages.push(cur); cur = { lines: [], first: i + 1, last: i + 1 }; }
      cur.lines.push(...chunk);
      cur.last = i + 1;
    }
  });
  if (cur) pages.push(cur);
  return pages;
}

/** Lines the keys section takes at `innerWidth`: whole hints packed, never split (as KeyHints wraps). */
export function keyHintLineCount(hints: readonly KeyHint[], innerWidth: number, form: 'line' | 'full' = 'full'): number {
  if (hints.length === 0) return 0;
  let lines = 1;
  let col = 0;
  for (const h of hints) {
    const w = formatKeyHint(h, form).length;
    const need = col === 0 ? w : KEY_HINT_SEPARATOR.length + w;
    if (col > 0 && col + need > innerWidth) { lines++; col = w; } else col += need;
  }
  return lines;
}

export interface GuidanceBoxProps {
  /** #4250: the guidance entry (title, explanation, inline sections, CLI line). Wins over
   *  `title`, `what` and `details`; screens pass the entry of the current sub-step or of the
   *  highlighted option (#4230, `useOptionGuidance`). */
  entry?: GuidanceEntry;
  /** Title line: the step or sub-step name (the same words as the step bar). Used without `entry`. */
  title?: string;
  /** Plain explanation of the step or option. Used without `entry`. Shown up to its line
   *  limit when expanded (three lines at 100 columns, four at 80), first line when collapsed. */
  what?: string;
  /** Legacy key/value sections; rendered inline ("Label: value") like `entry.sections`. */
  details?: ReadonlyArray<GuidanceDetail>;
  /** Optional action affordances ("Enter: confirm", "Escape: skip").
   *  Never include the Ctrl+G close hint; the box renders it (#4123). */
  affordances?: readonly string[];
  /** #4246 (Design 126 section 9.3): the keys of the screen, rendered in the
   *  expanded box by KeyHints form="full" (key names in words). Replaces
   *  `affordances`; when both are given, `keys` wins. */
  keys?: readonly KeyHint[];
  /** Blank lines above the box (default 1). ScreenLayout passes 0 so the key
   *  hints sit directly above the box (#4246, Design 126 section 3). */
  marginTop?: number;
  /** Sprint-055: collapsed by default on all screens. Press Ctrl+G to expand. */
  initiallyCollapsed?: boolean;
  /** #0760: called whenever the panel opens or closes. Parent components use
   *  this to guard their own Escape handlers from firing while the panel is open. */
  onOpenChange?: (open: boolean) => void;
  /** #0798 / #4250: the most rows the box may take, borders included. ScreenLayout passes the
   *  rows left under the content. When unset, the box takes at most the terminal height minus
   *  20 rows (unbounded when the height is unknown). Sections beyond it are paged; when even
   *  title, explanation, keys and close hint do not fit, the box stays collapsed. */
  maxRows?: number;
}

/** The entry a box shows: `entry`, else the legacy props. */
function resolveEntry(props: GuidanceBoxProps): GuidanceEntry {
  if (props.entry) return props.entry;
  return {
    title: props.title ?? '',
    what: props.what ?? '',
    sections: (props.details ?? []).map((d) => ({ label: d.label, text: d.value })),
  };
}

export function GuidanceBox(props: GuidanceBoxProps): JSX.Element {
  // Sprint-055 TUI design law: guidance boxes default to collapsed.
  const [collapsed, setCollapsed] = useState(props.initiallyCollapsed ?? true);
  const [page, setPage] = useState(0);
  const { stdout } = useStdout();
  // #4342: a frame with a fallback box skips it while this box is mounted.
  useReportGuidancePresence();
  // #0760: notify parent whenever open/closed state changes so parent useInput
  // handlers can guard their Escape handling while the panel is expanded.
  const onOpenChange = props.onOpenChange;
  useEffect(() => { onOpenChange?.(!collapsed); }, [collapsed, onOpenChange]);
  // #0804: on unmount, always notify parent that the panel is closed.
  useOnOpenChangeCleanup(onOpenChange);
  // #4394: the open state lives with the owner of the screen (guidance-open.ts);
  // every box reports to the nearest provider, closed again on unmount.
  const sharedOpen = useContext(GuidanceOpenContext);
  useEffect(() => { sharedOpen?.setOpen(!collapsed); }, [collapsed, sharedOpen]);
  useEffect(() => () => { sharedOpen?.setOpen(false); }, [sharedOpen]);

  // #0741: match the header bar width so all bordered boxes stay aligned.
  const [cols, setCols] = useState(stdout?.columns ?? 80);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setCols(stdout.columns ?? 80);
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);
  // #0857 / #4110: the box (borders included) stays inside the header rule
  // even when the screen indents it by up to 2 columns (paddingX).
  const width = headerRuleWidth(cols) - 2;
  const innerWidth = Math.max(1, width - 4); // content area = box width minus borders + paddingX

  // #4492: the guidance of a filterable list adds one Filter section.
  const activeFilter = useActiveFilter();
  const base = resolveEntry(props);
  const entry: GuidanceEntry = activeFilter && !(base.sections ?? []).some((x) => x.label === FILTER_GUIDANCE_LABEL)
    ? { ...base, sections: [...(base.sections ?? []), { label: FILTER_GUIDANCE_LABEL, text: activeFilter.guidance }] }
    : base;
  // #4230: the box follows the sub-step or the highlighted option; a new entry starts on page 1.
  useEffect(() => { setPage(0); }, [entry.title, entry.what]);

  // Explanation: at most three lines wide and four narrow, the CLI line included (Q-02);
  // the rest continues in a "More" section so nothing is cut.
  const cliLines = entry.cli ? wrapLines(`CLI: ${entry.cli}`, innerWidth) : [];
  const allWhatLines = entry.what === '' ? [] : wrapLines(entry.what, innerWidth);
  const whatBudget = Math.max(1, explanationLineLimit(innerWidth) - cliLines.length);
  const whatLines = allWhatLines.slice(0, whatBudget);
  const overflow = allWhatLines.slice(whatBudget).join(' ').trim();
  const sections: GuidanceSection[] = [
    ...(overflow !== '' ? [{ label: MORE_SECTION_LABEL, text: overflow }] : []),
    ...(entry.sections ?? []),
  ];

  const keys = props.keys && props.keys.length > 0 ? props.keys : null;
  const affordances = !keys ? (props.affordances ?? []) : [];
  const keyLines = keys
    ? keyHintLineCount(keys, innerWidth)
    : affordances.reduce((n, a) => n + countWrappedLines(a, innerWidth), 0);
  // Fixed part: borders 2, title 1, explanation, CLI, blank 1, keys, rule 1, close hint 1.
  const fixedRows = 2 + 1 + whatLines.length + cliLines.length + 1 + keyLines + 1 + 1;
  const terminalRows = stdout?.rows;
  const maxRows = props.maxRows !== undefined
    ? props.maxRows
    : (terminalRows !== undefined ? Math.max(fixedRows + 2, terminalRows - 20) : Number.POSITIVE_INFINITY);

  const sectionBudget = maxRows - fixedRows;
  const totalSectionLines = sections.reduce((n, s) => n + sectionLines(s, innerWidth).length, 0);
  let pages: SectionPage[] = [];
  let fits = maxRows >= fixedRows;
  if (sections.length > 0 && fits) {
    if (totalSectionLines <= sectionBudget) {
      pages = pageSections(sections, innerWidth, Math.max(1, totalSectionLines));
    } else if (sectionBudget - 1 >= 1) {
      pages = pageSections(sections, innerWidth, sectionBudget - 1); // one line for the pager
    } else {
      fits = false;
    }
  }
  const pageCount = pages.length;
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const shown = pages[currentPage];

  useInput((input, key) => {
    if (key.ctrl && input === 'g') {
      setCollapsed((c) => !c);
      setPage(0);
    } else if (key.escape && !collapsed) {
      // #2559: ESC while box is open collapses it so the parent ESC handler
      // can fire on the same or next keypress without the box blocking it.
      setCollapsed(true);
      setPage(0);
    } else if (!collapsed && pageCount > 1 && key.pageDown) {
      setPage((p) => Math.min(pageCount - 1, p + 1));
    } else if (!collapsed && pageCount > 1 && key.pageUp) {
      setPage((p) => Math.max(0, p - 1));
    }
  });

  // #4250 (section 9.5): the box never grows past maxRows; when even the fixed
  // part does not fit, it stays collapsed (title and first line).
  if (collapsed || !fits) {
    // #2363: pre-truncate at word boundary for the collapsed what-row (one line only).
    const whatParas = entry.what.split('\n');
    const firstWhatLine = whatParas[0] ?? '';
    const collapsedWhat = truncateAtWordBoundary(
      whatParas.length > 1 ? `${firstWhatLine} ...` : firstWhatLine,
      innerWidth,
    );
    // #1459: flexShrink={0} prevents Ink layout engine from compressing the
    // collapsed box to content-minimum width after a transition from expanded state.
    return (
      <Box flexDirection="column" marginTop={props.marginTop ?? 1} borderStyle="single" borderColor={tokenColor('border')} paddingX={1} width={width} flexShrink={0}>
        <Box flexDirection="row" width={width - 4} overflow="hidden">
          {/* #4254: a long title is cut at its end; the "(Ctrl+G for guidance)" hint is never squeezed. */}
          <Box flexShrink={1}><Text {...tone('brand')} wrap="truncate-end">{entry.title}</Text></Box>
          <Box flexShrink={0}>
            <Text {...tone('muted')}>   (</Text>
            <Text {...tone('brand')}>Ctrl+G</Text>
            <Text {...tone('muted')}> for guidance)</Text>
          </Box>
        </Box>
        <Text {...tone('text')} wrap="truncate-end">{collapsedWhat}</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      marginTop={props.marginTop ?? 1}
      borderStyle="single"
      borderColor={tokenColor('border')}
      paddingX={1}
      width={width}
      flexShrink={0}
    >
      <Text {...tone('brand')}>{entry.title}</Text>
      {whatLines.map((l, i) => <Text key={`w-${i}`} {...tone('text')}>{l}</Text>)}
      {cliLines.map((l, i) => <Text key={`c-${i}`} {...tone('text')}>{l}</Text>)}
      {shown && shown.lines.map((l, i) => (
        <Text key={`s-${currentPage}-${i}`}>
          {l.label !== undefined
            ? <Text {...tone('accent')}>{`${l.label}:`.padEnd(l.indent)}</Text>
            : <Text>{' '.repeat(l.indent)}</Text>}
          <Text {...tone('text')}>{l.text}</Text>
        </Text>
      ))}
      {pageCount > 1 && shown && (
        <Box>
          <Text {...tone('muted')}>{`Sections ${shown.first} to ${shown.last} of ${sections.length}.${'   '}`}</Text>
          <KeyHints hints={KEY_HINTS.guidancePager} />
        </Box>
      )}
      <Text> </Text>
      {keys && <KeyHints hints={keys} form="full" />}
      {!keys && affordances.map((a, i) => (
        <Text key={`a-${i}`} {...tone('text')} wrap="wrap">{a}</Text>
      ))}
      <Text {...tone('border')}>{'─'.repeat(innerWidth)}</Text>
      <KeyHints hints={KEY_HINTS.guidanceClose} />
    </Box>
  );
}
