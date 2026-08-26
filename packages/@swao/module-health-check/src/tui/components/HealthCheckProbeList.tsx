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

// Two-column interactive probe list (#0385, sprint-040) shared between the
// SetupWizard Step 3 Health Check and the main-menu Health Check screen.
//
// Replaces the wall-of-text LiveOutput render with a compact list (probe
// name | status icon, fixed-width columns) plus a per-cursor GuidanceBox
// below showing the selected probe's head message, continuation lines,
// and a business-user-readable next-action paragraph.
//
// Input: the raw stdout `lines` array streamed from `swao health-check`
// captured upstream. The list updates live as new probes complete.

import { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { parseHealthCheckOutput, probeAction, PROBE_DESCRIPTION, type HealthCheckProbe } from './health-check-parse.js';
import { computeProbeWindow } from './probe-window.js';
import { GuidanceBox } from '@swao/tui-kit';

interface HealthCheckProbeListProps {
  lines: ReadonlyArray<string>;
  done: boolean;
  active?: boolean;
  /** #0798: called whenever the GuidanceBox opens or closes. Wire to the parent
   *  screen's escape-guard so navigation does not fire while the panel is open. */
  onGuidanceOpenChange?: (open: boolean) => void;
}

const STATUS_GLYPH: Record<HealthCheckProbe['status'], string> = {
  ok:   'OK  ',
  INFO: 'INFO',
  WARN: 'WARN',
  FAIL: 'FAIL',
};

const STATUS_COLOR: Record<HealthCheckProbe['status'], string> = {
  ok:   'green',
  INFO: 'cyan',
  WARN: 'yellow',
  FAIL: 'red',
};

export function HealthCheckProbeList({ lines, done, active = true, onGuidanceOpenChange }: HealthCheckProbeListProps) {
  const probes = useMemo(() => parseHealthCheckOutput(lines), [lines]);
  const [idx, setIdx] = useState(0);
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout?.rows ?? 30);

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setRows(stdout.rows ?? 30);
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

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
  });

  if (probes.length === 0) {
    return (
      <Box marginTop={1}>
        <Text color="yellow">{done ? 'No probes detected in health-check output.' : 'Probing...'}</Text>
      </Box>
    );
  }

  const selected = probes[Math.min(idx, probes.length - 1)]!;
  const nameW = Math.max(...probes.map((p) => p.name.length)) + 2;

  // Viewport windowing (#1347, corrected by #1390): useStdout().rows is the
  // FULL terminal height and the wizard header + step title + guidance box +
  // footer render in the SAME Ink frame as this list, so the previous 8-row
  // buffer let the frame overflow the terminal on ~30-row windows -- Ink then
  // corrupted the render and probes vanished from the MIDDLE of the list with
  // no paging indicator. computeProbeWindow reserves the same 18-row chrome
  // budget as the assess pass picker, making paging mandatory whenever the
  // list does not fit the current window.
  const MIN_GUIDANCE = 8;
  const win = computeProbeWindow(idx, probes.length, rows);
  const visibleProbes = probes.slice(win.start, win.end);
  const hasAbove = win.aboveCount > 0;
  const hasBelow = win.belowCount > 0;

  // #0798: cap GuidanceBox expanded height so the total render height (probe list
  // + GuidanceBox) never exceeds the terminal height.
  const maxGuidanceRows = Math.max(MIN_GUIDANCE, rows - (win.end - win.start) - 6);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="column">
        {hasAbove && (
          <Box><Text color="gray">{`  ^ ${win.aboveCount} more probe${win.aboveCount !== 1 ? 's' : ''} above (arrow up)`}</Text></Box>
        )}
        {visibleProbes.map((p) => {
          const i = probes.indexOf(p);
          const cursor = i === idx;
          return (
            <Box key={`${p.num}-${p.name}`}>
              <Text color={cursor ? 'cyan' : undefined}>
                {cursor ? '> ' : '  '}
              </Text>
              <Text color={cursor ? 'cyan' : undefined}>
                {`[${p.num}/${p.total}]`.padEnd(8)}
              </Text>
              <Text color={cursor ? 'cyan' : undefined}>
                {p.name.padEnd(nameW)}
              </Text>
              <Text color={STATUS_COLOR[p.status]} bold>
                {STATUS_GLYPH[p.status]}
              </Text>
            </Box>
          );
        })}
        {hasBelow && (
          <Box><Text color="gray">{`  v ${win.belowCount} more probe${win.belowCount !== 1 ? 's' : ''} below (arrow down)`}</Text></Box>
        )}
      </Box>
      <GuidanceBox
        title={`[${selected.num}/${selected.total}] ${selected.name}`}
        what={PROBE_DESCRIPTION[selected.name] ?? selected.headMessage ?? 'No detail message reported.'}
        details={[
          { label: 'Status', value: selected.status },
          { label: 'Action', value: probeAction(selected) },
          // #1580: one entry per detail line so maxRows truncates by line count, not chars
          ...selected.detailLines.map((line, i) => ({
            label: i === 0 ? 'Detail' : '  ',
            value: line,
          })),
        ]}
        affordances={active ? ['Arrows -- highlight a probe', done ? 'Enter  -- return to menu' : 'Probing... wait for completion'] : []}
        onOpenChange={onGuidanceOpenChange}
        maxRows={maxGuidanceRows}
      />
    </Box>
  );
}
