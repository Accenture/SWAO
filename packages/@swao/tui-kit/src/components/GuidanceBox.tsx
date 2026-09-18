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

// GuidanceBox -- bottom-of-screen explanatory panel used across the
// Setup wizard (#0370 umbrella, sprint-040). Mirrors the bordered-box
// pattern already used by MainMenu.tsx for the per-row "what does this
// do" guidance.
//
// Each Setup-wizard step renders a GuidanceBox after the interaction
// body, explaining: what this step does, what input is expected (when
// applicable), optionality, where the value ends up being used, and
// the action affordances (Enter / Escape / arrows). For dynamic steps
// where the guidance updates per cursor position (e.g. LLM model
// picker, planned Health Check interactive list), the parent computes
// the props per active item.
//
// Visual style: single-line border, gray, dim labels, slight top margin
// to separate from the interaction area above.

import { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';

// Helper: reset parent guidance state on unmount even if the panel was open.
// Defined outside the component so it is not recreated on each render.
function useOnOpenChangeCleanup(onOpenChange: ((open: boolean) => void) | undefined): void {
  const ref = useRef(onOpenChange);
  ref.current = onOpenChange;
  useEffect(() => {
    return () => { ref.current?.(false); };
  }, []); // empty deps -- fires only on unmount, not on prop changes
}

/** Maximum characters for the "what" description before GuidanceBox truncates with "...". */
export const MAX_WHAT_CHARS = 280;
/** Maximum characters for each detail value before GuidanceBox truncates with "...". */
export const MAX_DETAIL_VALUE_CHARS = 200;

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + '...';
}

/**
 * Truncate `text` at a word boundary so the displayed string never ends
 * mid-word. The result including "..." is at most `maxWidth` characters.
 * #2363: used for the collapsed GuidanceBox "what" row.
 */
export function truncateAtWordBoundary(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  return text.slice(0, Math.max(0, maxWidth - 3)).replace(/\s+\S*$/, '') + '...';
}

export interface GuidanceDetail {
  label: string;
  value: string;
}

export interface GuidanceBoxProps {
  /** Bold cyan title at the top of the box. Typically the step name or the
   *  currently-focused option label. */
  title: string;
  /** Plain-text "what this step / option does" -- 1-2 sentences. Max 280 chars. */
  what: string;
  /** Optional generic key/value detail rows. Each step picks its own labels
   *  ("Format", "Optionality", "Cost", "Duration", "Used in", etc.).
   *  Detail values are truncated at 200 chars. */
  details?: ReadonlyArray<GuidanceDetail>;
  /** Optional action affordances ("Enter -- confirm", "Escape -- skip"). */
  affordances?: readonly string[];
  /** Sprint-055: collapsed by default on all screens. Press Ctrl+G to expand.
   *  Pass initiallyCollapsed={false} only for screens where guidance must
   *  be visible on first render (currently: none -- main menu has no GuidanceBox). */
  initiallyCollapsed?: boolean;
  /** #0760: called whenever the panel opens or closes. Parent components use
   *  this to guard their own Escape handlers from firing while the panel is open. */
  onOpenChange?: (open: boolean) => void;
  /** #0798: cap expanded panel height to prevent Ink terminal overflow on
   *  height-constrained screens (e.g. HealthCheckProbeList with 11 probe rows).
   *  Callers should pass (stdout.rows - rows_consumed_above). When unset, no
   *  cap is applied. Title, what, affordances, and footer are always shown;
   *  only detail rows are truncated when maxRows is too small. */
  maxRows?: number;
}

export function GuidanceBox(props: GuidanceBoxProps): JSX.Element {
  // Sprint-055 TUI design law: guidance boxes default to collapsed.
  // Ctrl+G toggles between collapsed (title + hint) and expanded (full content).
  // Each GuidanceBox instance is independent; no global state needed.
  const [collapsed, setCollapsed] = useState(props.initiallyCollapsed ?? true);
  const { stdout } = useStdout();
  // #0760: notify parent whenever open/closed state changes so parent useInput
  // handlers can guard their Escape handling while the panel is expanded.
  const onOpenChange = props.onOpenChange;
  useEffect(() => { onOpenChange?.(!collapsed); }, [collapsed, onOpenChange]);
  // #0804: on unmount, always notify parent that the panel is closed.
  // Without this, a step transition while the box is expanded leaves the
  // parent's _wizardGuidanceOpen flag stuck at true, silently blocking all
  // subsequent useInput handlers in the wizard.
  useOnOpenChangeCleanup(onOpenChange);

  // #0741: match the header bar width so all bordered boxes stay aligned.
  const [cols, setCols] = useState(stdout?.columns ?? 80);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setCols(stdout.columns ?? 80);
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);
  // #0857: cap at 98 so the box outer visual width (98 + 2 border chars) matches
  // the HeaderView =====...===== bar (also capped at 100 display columns).
  const width = Math.min(98, Math.max(61, cols - 2));

  useInput((input, key) => {
    if (key.ctrl && input === 'g') {
      setCollapsed((c) => !c);
    } else if (key.escape && !collapsed) {
      // #2559: ESC while box is open collapses it so the parent ESC handler
      // can fire on the same or next keypress without the box blocking it.
      setCollapsed(true);
    }
  });

  // #0813: compute shared layout values for both collapsed and expanded paths
  // so we can keep the rendered height constant between states.
  // #0798: compute how many detail rows fit within maxRows.

  // #1412: safeWhat and innerWidth are needed early (before maxDetailRows) so
  // whatLines can inform the terminal-overflow guard (#2321).
  const safeWhat = truncate(props.what, MAX_WHAT_CHARS);
  const innerWidth = Math.max(1, width - 4); // content area = box width minus borders + paddingX

  // Word-wrap-aware line count: character-count estimate (length/width) undershoots
  // when a word lands exactly on the wrap boundary, leaving ghost artefacts (#1661).
  // #2321: handles embedded \n so explicit line breaks in `what` strings are counted correctly.
  function countWrappedLines(text: string, w: number): number {
    let total = 0;
    for (const para of text.split('\n')) {
      let lines = 1; let col = 0;
      for (const word of para.split(' ')) {
        if (col + word.length + (col > 0 ? 1 : 0) > w) { lines++; col = word.length; }
        else { col += word.length + (col > 0 ? 1 : 0); }
      }
      total += lines;
    }
    return total;
  }
  const whatLines = Math.max(1, countWrappedLines(safeWhat, innerWidth));

  // Fixed overhead per expanded box (borders, title, what, affordances, footer,
  // their marginTop separators) is calculated from the actual render structure:
  //   2 (borders) + 1 (title) + 1 (what)
  //   + (A > 0 ? 1 + A : 0)   affordance-box marginTop + affordance rows
  //   + 1 (footer marginTop) + 1 (footer)
  // = 6 + (A > 0 ? 1 + A : 0)
  // Detail rows add: (D > 0 ? 1 : 0) (detail-box marginTop) + D
  // So for given maxRows: D <= maxRows - fixedOverhead - (D > 0 ? 1 : 0)
  // Simplify: cap D at (maxRows - fixedOverhead - 1) to always reserve the margin.
  const allDetails = props.details ?? [];
  const affordanceCount = (props.affordances ?? []).length;
  // 2 (borders) + 1 (title) + 1 (what) + 1 (footer-sep) + 1 (footer-hints) = 6
  // + affordances block: 1 (margin) + A lines
  // + 1 extra for footer separator line added above hints
  const fixedOverhead = 7 + (affordanceCount > 0 ? 1 + affordanceCount : 0);
  // #2349: auto-cap expanded height to terminal size when no explicit maxRows.
  // When the GuidanceBox expands taller than stdout.rows Ink overwrites content
  // above by scrolling the terminal -- corrupting the header. Reserve 20 rows
  // for header (4) + typical screen content above guidance (12-16 rows) +
  // footer (2) + margins. When the terminal is very short, allow at least
  // fixedOverhead so the static frame structure remains visible.
  // Explicit maxRows from the caller wins.
  const terminalRows = stdout?.rows ?? 24;
  const resolvedMaxRows = props.maxRows !== undefined
    ? props.maxRows
    : Math.max(fixedOverhead, terminalRows - 20);
  // #2321: use the actual whatLines count (not the fixed 1-line estimate in fixedOverhead)
  // so that multi-line `what` text does not cause detail rows to overflow the terminal.
  const fixedOverheadActual = fixedOverhead - 1 + whatLines;
  const maxDetailRows = Math.max(0, resolvedMaxRows - fixedOverheadActual - 1);
  // #2613: truncate by accumulated line count (not item count) so multi-line
  // detail values cannot push expandedHeight past resolvedMaxRows and scroll
  // the terminal, which corrupts the header on collapse (#2624).
  // Reserve 2 lines for the "... (N more)" indicator when more items follow.
  const visibleDetails: GuidanceDetail[] = [];
  {
    let accLines = 0;
    for (let i = 0; i < allDetails.length; i++) {
      const d = allDetails[i]!;
      const vLines = Math.max(1, countWrappedLines(truncate(d.value, MAX_DETAIL_VALUE_CHARS), Math.max(1, innerWidth - 2)));
      const itemLines = (i > 0 ? 1 : 0) + 1 + vLines;
      const indicatorReserve = i < allDetails.length - 1 ? 2 : 0;
      if (isFinite(maxDetailRows) && accLines + itemLines + indicatorReserve > maxDetailRows) break;
      accLines += itemLines;
      visibleDetails.push(d);
    }
  }
  const showTruncation = visibleDetails.length < allDetails.length;

  // #0813: prevent ghost lines when collapsing by keeping total rendered height
  // constant. Ghost lines occur because Ink moves the cursor up by the previous
  // frame's height before repainting. If the new frame is shorter, lines below
  // the new content are not cleared. The \x1B[J workaround caused cursor-offset
  // corruption (ink-stdout-mutation-collision). Solution: once the box has been
  // expanded, the collapsed render pads with blank Text elements below the box
  // so Ink always sees the same total line count regardless of collapsed state.
  //
  // Track the maximum height ever seen so a resize or prop change that shrinks
  // expandedHeight below the prior peak does not under-pad.
  const hasEverExpanded = useRef(false);
  const maxExpandedHeightRef = useRef(0);
  // #2316: reset height tracking when the terminal is resized so the
  // ghost-padding estimate is recalculated at the new column width.
  // Without this, maxExpandedHeightRef holds a value computed at the old
  // width, causing overpadding and header corruption on collapse.
  useEffect(() => {
    maxExpandedHeightRef.current = 0;
    hasEverExpanded.current = false;
  }, [cols]);
  // Stacked layout: each detail = 1 label line + wrapped value lines + 1 gap between blocks.
  // Include the truncation indicator's 2 lines so expandedHeight is accurate (#2613).
  const detailsHeight = visibleDetails.reduce((sum, d, i) =>
    sum + (i > 0 ? 1 : 0) + 1 + Math.max(1, countWrappedLines(truncate(d.value, MAX_DETAIL_VALUE_CHARS), Math.max(1, innerWidth - 2))), 0)
    + (showTruncation ? 2 : 0);
  const separatorLines = visibleDetails.length > 0 ? 1 : 0;
  // fixedOverhead counts 'what' as 1 line; replace with the physical line estimate.
  const expandedHeight = fixedOverhead - 1 + whatLines + separatorLines + (visibleDetails.length > 0 ? detailsHeight : 0);
  if (!collapsed) {
    hasEverExpanded.current = true;
    maxExpandedHeightRef.current = Math.max(maxExpandedHeightRef.current, expandedHeight);
  }
  const collapsedBoxHeight = 4; // border-top + title-row + what-row + border-bottom
  const ghostPadding = hasEverExpanded.current
    ? Math.max(0, maxExpandedHeightRef.current - collapsedBoxHeight)
    : 0;

  // #2363: pre-truncate at word boundary for the collapsed what-row.
  const collapsedWhat = truncateAtWordBoundary(safeWhat, innerWidth);

  if (collapsed) {
    return (
      <>
        {/* #1459: flexShrink={0} prevents Ink layout engine from compressing the
            collapsed box to content-minimum width after a transition from expanded
            state. The inner row Box gets an explicit width so its Text children
            cannot cause the box to shrink or wrap chaotically. */}
        <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} width={width} flexShrink={0}>
          <Box flexDirection="row" width={width - 4} overflow="hidden">
            <Text bold color="cyanBright">{props.title}</Text>
            <Text dimColor>   (</Text>
            <Text bold color="cyanBright">Ctrl+G</Text>
            <Text dimColor> for guidance)</Text>
          </Box>
          {/* #1148: pad to inner box width so previous-frame text (e.g. license
              bar) is fully overwritten when the GuidanceBox renders shorter. */}
          <Text color="white" wrap="truncate-end">{collapsedWhat.padEnd(Math.max(0, width - 4))}</Text>
        </Box>
        {/* #1148: ghost-padding lines must fill the terminal width to erase any
            leftover content from the prior taller frame (e.g. MainMenu footer). */}
        {Array.from({ length: ghostPadding }, (_, i) => <Text key={i}>{' '.repeat(cols)}</Text>)}
      </>
    );
  }

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      width={width}
    >
      <Text bold color="cyanBright">{props.title}</Text>
      <Text color="white" wrap="wrap">{safeWhat}</Text>
      {(visibleDetails.length > 0 || showTruncation) && (
        <>
          <Text dimColor>{'─'.repeat(Math.min(innerWidth, width - 4))}</Text>
          <Box flexDirection="column">
            {visibleDetails.map((d, i) => (
              <Box key={i} flexDirection="column" marginTop={i > 0 ? 1 : 0}>
                <Text bold color="cyan">{d.label}:</Text>
                <Box marginLeft={2}>
                  <Text color="white" wrap="wrap">{truncate(d.value, MAX_DETAIL_VALUE_CHARS)}</Text>
                </Box>
              </Box>
            ))}
            {showTruncation && (
              <Box marginTop={1}>
                <Text dimColor>... ({allDetails.length - visibleDetails.length} more sections)</Text>
              </Box>
            )}
          </Box>
        </>
      )}
      {props.affordances && props.affordances.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          {props.affordances.map((a, i) => (
            <Text key={i} color="white">{a}</Text>
          ))}
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>{'─'.repeat(Math.min(innerWidth, width - 4))}</Text>
        <Text dimColor>Ctrl+G -- close guidance</Text>
      </Box>
    </Box>
  );
}
