// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health-check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Interactive probe list (#0385, sprint-040) shared between the SetupWizard
// Health Check step and the main-menu Health Check screen.
//
// #4257 (TUI-13, Design 126 mockup M-06, #4235 row 10): one StatusRow per
// probe: the status word from the central status map, the counter
// right-aligned ([ 1/15] and [10/15]) so the name column does not shift, and
// the reason of a warn or fail result on the row's second line. The selected
// probe's guidance entry goes to the screen's guidance box
// (`onCursorEntry`); with `guidance="box"` (default, the wizard step) the
// list renders its own box below the rows.
//
// Input: the raw stdout `lines` array streamed from `swao health-check`
// captured upstream. The list updates live as new probes complete.

import { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useInput, type DOMElement } from 'ink';
import { parseHealthCheckOutput, probeDetailRows, PROBE_DESCRIPTION, type HealthCheckProbe, type ProbeStatus } from './health-check-parse.js';
import { tuiRemedyText } from '../../probes/service-probes.js';
import { computeProbeWindow, withScrollSection, PROBE_LIST_SCROLL_TEXT } from './probe-window.js';
import { GuidanceBox, GUIDANCE_COLLAPSED_ROWS, StatusRow, statusLabelWidth, statusRowHeight, tone, useHeaderWidth, useListBudget, type GuidanceEntry, type KeyHint, type StatusLevel } from '@swao/tui-kit';

interface HealthCheckProbeListProps {
  lines: ReadonlyArray<string>;
  done: boolean;
  active?: boolean;
  /** #0798: called whenever the GuidanceBox opens or closes. Wire to the parent
   *  screen's escape-guard so navigation does not fire while the panel is open. */
  onGuidanceOpenChange?: (open: boolean) => void;
  /** `box` (default): the list renders the guidance box of the selected probe;
   *  `none`: the screen renders it (ScreenLayout block 8) from `onCursorEntry`. */
  guidance?: 'box' | 'none';
  /** The guidance entry of the selected probe, on every cursor or result change. */
  onCursorEntry?: (entry: GuidanceEntry | undefined) => void;
  /**
   * #4348: PgUp and PgDn page the list unless this returns false (the screen
   * passes false while its expanded guidance box pages its sections).
   */
  canPage?: () => boolean;
}

/** Health check status (ADR-0069 upper case in the CLI) to the central status level (Q-05). */
export const PROBE_LEVEL: Record<ProbeStatus, StatusLevel> = { ok: 'ok', INFO: 'info', WARN: 'warn', FAIL: 'fail' };

/** The reason shown on the second line of a warn or fail row (#4235 row 10). */
export function probeReason(probe: HealthCheckProbe): string | undefined {
  // #4295: CLI remedies of the service probes in TUI wording.
  return (probe.status === 'WARN' || probe.status === 'FAIL') && probe.headMessage ? tuiRemedyText(probe.headMessage) : undefined;
}

/** The guidance entry of one probe: what it checks, then status, result, action and details. */
export function probeGuidanceEntry(probe: HealthCheckProbe): GuidanceEntry {
  return {
    title: probe.name,
    what: PROBE_DESCRIPTION[probe.name] ?? (tuiRemedyText(probe.headMessage) || 'No detail message reported.'),
    sections: probeDetailRows(probe).map((r) => ({ label: r.label, text: r.value })),
    cli: 'swao health-check',
  };
}

const LIST_KEYS: readonly KeyHint[] = [{ key: '↑↓', verb: 'select' }, { key: 'PgDn', verb: 'page' }];

export function HealthCheckProbeList({
  lines, done, active = true, onGuidanceOpenChange, guidance = 'box', onCursorEntry, canPage,
}: HealthCheckProbeListProps) {
  const probes = useMemo(() => parseHealthCheckOutput(lines), [lines]);
  const [idx, setIdx] = useState(0);
  const width = useHeaderWidth();
  // #4348: the rows this list may take on the screen (shared tui-kit height rule).
  const listRef = useRef<DOMElement>(null);
  const budget = useListBudget(listRef);
  const pageSize = useRef(1);
  // The list's own guidance box pages its sections with PgUp and PgDn while it is open.
  const ownOpen = useRef(false);

  // Clamp the cursor as probes stream in; otherwise an empty list at first
  // render leaves the cursor pointing past the end.
  useEffect(() => {
    if (probes.length === 0) { setIdx(0); return; }
    if (idx >= probes.length) setIdx(probes.length - 1);
  }, [probes.length, idx]);

  useInput((_input, key) => {
    if (!active) return;
    if (key.upArrow)   setIdx((i) => Math.max(0, i - 1));
    if (key.downArrow) setIdx((i) => Math.min(Math.max(0, probes.length - 1), i + 1));
    if ((key.pageUp || key.pageDown) && !ownOpen.current && (canPage?.() ?? true)) {
      const step = Math.max(1, pageSize.current);
      setIdx((i) => (key.pageUp ? Math.max(0, i - step) : Math.min(Math.max(0, probes.length - 1), i + step)));
    }
  });

  const selected = probes.length > 0 ? probes[Math.min(idx, probes.length - 1)] : undefined;
  const entry = useMemo(() => (selected ? withScrollSection(probeGuidanceEntry(selected)) : undefined), [selected]);
  useEffect(() => { onCursorEntry?.(entry); }, [entry, onCursorEntry]);

  if (probes.length === 0 || !selected) {
    return (
      <Box ref={listRef}>
        <Text {...tone(done ? 'warning' : 'muted')}>{done ? 'No probes detected in the health check output.' : 'Probing...'}</Text>
      </Box>
    );
  }

  // Viewport windowing (#1347, #1390; #4348): the list takes the rows the
  // screen leaves after its measured chrome and the guidance box, each probe
  // counted with its real wrapped height. A list that draws its own guidance
  // box (guidance 'box') keeps room for it collapsed.
  // #4295 / #4348: the label column widens to the longest probe name ("Vendor catalogue (Tier 2)"), never wraps.
  const labelWidth = statusLabelWidth(probes.map((p) => p.name), width, { counter: { total: Math.max(...probes.map((p) => p.total)) } });
  const heights = probes.map((p) => statusRowHeight({ level: PROBE_LEVEL[p.status], label: p.name, detail: probeReason(p), labelWidth, counter: { index: p.num, total: p.total } }, width));
  const ownBox = guidance === 'box' && entry ? GUIDANCE_COLLAPSED_ROWS + 1 : 0;
  const win = computeProbeWindow(idx, heights, budget === undefined ? undefined : Math.max(1, budget - ownBox));
  const { start, end } = win;
  pageSize.current = end - start;
  const visibleProbes = probes.slice(start, end);
  const above = win.aboveCount;
  const below = win.belowCount;

  return (
    <Box ref={listRef} flexDirection="column">
      {above > 0 && <Box marginLeft={2}><Text {...tone('muted')}>{`↑ ${above} more`}</Text></Box>}
      {visibleProbes.map((p) => (
        <StatusRow
          key={`${p.num}-${p.name}`}
          level={PROBE_LEVEL[p.status]}
          label={p.name}
          detail={probeReason(p)}
          selected={p === selected}
          labelWidth={labelWidth}
          counter={{ index: p.num, total: p.total }}
        />
      ))}
      {below > 0 && <Box marginLeft={2}><Text {...tone('muted')}>{`↓ ${below} more`}</Text></Box>}
      {guidance === 'box' && entry && (
        <GuidanceBox entry={entry} keys={active ? LIST_KEYS : []} onOpenChange={(o) => { ownOpen.current = o; onGuidanceOpenChange?.(o); }} />
      )}
    </Box>
  );
}

export { PROBE_LIST_SCROLL_TEXT };
