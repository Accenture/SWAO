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

export interface GuidanceDetail {
  label: string;
  value: string;
}

export interface GuidanceBoxProps {
  /** Bold cyan title at the top of the box. Typically the step name or the
   *  currently-focused option label. */
  title: string;
  /** Plain-text "what this step / option does" -- 1-2 sentences. */
  what: string;
  /** Optional generic key/value detail rows. Each step picks its own labels
   *  ("Format", "Optionality", "Cost", "Duration", "Used in", etc.). */
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

  // #0753: use a ref so the useInput closure always reads the current collapsed
  // value rather than a potentially stale snapshot from the last render.
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  useInput((input, key) => {
    if (key.ctrl && input === 'g') {
      setCollapsed((c) => !c);
    }
    // Escape or Enter closes the panel when expanded.
    // Enter-to-close (#1412): lets the parent screen's Enter handler also fire
    // in the same keypress, advancing the wizard in one press rather than two.
    if ((key.escape || key.return) && !collapsedRef.current) {
      setCollapsed(true);
    }
  });

  // #0813: compute shared layout values for both collapsed and expanded paths
  // so we can keep the rendered height constant between states.
  // #0798: compute how many detail rows fit within maxRows.
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
  const fixedOverhead = 6 + (affordanceCount > 0 ? 1 + affordanceCount : 0);
  const maxDetailRows = props.maxRows !== undefined
    ? Math.max(0, props.maxRows - fixedOverhead - 1)
    : Infinity;
  // #1580: when truncating, reserve one slot for the "... (N more)" indicator
  const showTruncation = isFinite(maxDetailRows) && allDetails.length > maxDetailRows;
  const sliceEnd = showTruncation ? Math.max(0, maxDetailRows - 1) : (isFinite(maxDetailRows) ? maxDetailRows : allDetails.length);
  const visibleDetails = allDetails.slice(0, sliceEnd);

  // #0813: prevent ghost lines when collapsing by keeping total rendered height
  // constant. Ghost lines occur because Ink moves the cursor up by the previous
  // frame's height before repainting. If the new frame is shorter, lines below
  // the new content are not cleared. The \x1B[J workaround caused cursor-offset
  // corruption (ink-stdout-mutation-collision). Solution: once the box has been
  // expanded, the collapsed render pads with blank Text elements below the box
  // so Ink always sees the same total line count regardless of collapsed state.
  //
  // #1412: estimate physical terminal lines for the 'what' text (expanded state
  // has no wrap="truncate-end" so long strings wrap). The simple character-count
  // estimate is sufficient -- over-padding is harmless; under-padding leaves
  // ghost artefacts. Track the maximum height ever seen so a resize or prop
  // change that shrinks expandedHeight below the prior peak does not under-pad.
  const hasEverExpanded = useRef(false);
  const maxExpandedHeightRef = useRef(0);
  const innerWidth = Math.max(1, width - 4); // content area = box width minus borders + paddingX
  // Word-wrap-aware line count: character-count estimate (length/width) undershoots
  // when a word lands exactly on the wrap boundary, leaving ghost artefacts (#1661).
  function countWrappedLines(text: string, w: number): number {
    let lines = 1; let col = 0;
    for (const word of text.split(' ')) {
      if (col + word.length + (col > 0 ? 1 : 0) > w) { lines++; col = word.length; }
      else { col += word.length + (col > 0 ? 1 : 0); }
    }
    return lines;
  }
  const whatLines = Math.max(1, countWrappedLines(props.what, innerWidth));
  // fixedOverhead counts 'what' as 1 line; replace with the physical line estimate
  const expandedHeight = fixedOverhead - 1 + whatLines + (visibleDetails.length > 0 ? 1 + visibleDetails.length : 0);
  if (!collapsed) {
    hasEverExpanded.current = true;
    maxExpandedHeightRef.current = Math.max(maxExpandedHeightRef.current, expandedHeight);
  }
  const collapsedBoxHeight = 4; // border-top + title-row + what-row + border-bottom
  const ghostPadding = hasEverExpanded.current
    ? Math.max(0, maxExpandedHeightRef.current - collapsedBoxHeight)
    : 0;

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
          <Text color="white" wrap="truncate-end">{props.what.padEnd(Math.max(0, width - 4))}</Text>
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
      <Text color="white">{props.what}</Text>
      {(visibleDetails.length > 0 || showTruncation) && (
        <Box marginTop={1} flexDirection="column">
          {visibleDetails.map((d, i) => {
            // #0390 (sprint-040): two-column flex layout instead of
            // string padEnd. The previous padEnd(14) approach wrapped
            // long labels mid-word and broke vertical alignment when
            // the value spanned multiple lines. Fixed-width left column
            // for the label keeps everything aligned regardless of
            // terminal width; flex-grow on the right lets the value
            // wrap cleanly under its own column.
            const labelWidth = Math.max(
              16,
              Math.min(20, Math.max(...allDetails.map((dd) => dd.label.length + 1))),
            );
            return (
              <Box key={i} flexDirection="row">
                <Box width={labelWidth} flexShrink={0}>
                  <Text dimColor>{d.label}:</Text>
                </Box>
                <Box flexGrow={1}>
                  <Text color="white">{d.value}</Text>
                </Box>
              </Box>
            );
          })}
          {showTruncation && (
            <Box flexDirection="row">
              <Box width={16} flexShrink={0} />
              <Text dimColor>... ({allDetails.length - visibleDetails.length} more lines)</Text>
            </Box>
          )}
        </Box>
      )}
      {props.affordances && props.affordances.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          {props.affordances.map((a, i) => (
            <Text key={i} color="white">{a}</Text>
          ))}
        </Box>
      )}
      <Box marginTop={1} flexDirection="row">
        <Text dimColor>Ctrl+G to close</Text>
        <Text dimColor>  |  Esc to close</Text>
        <Text dimColor>  |  Enter to close</Text>
      </Box>
    </Box>
  );
}
