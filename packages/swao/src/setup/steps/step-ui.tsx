// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4192 / #4196 (Design 125 section 9): small building blocks of the
// Application and LLM branch steps. The step title is the central StepTitle
// of @swao/tui-kit since #4248 (it wraps; the local one cut the text),
// menu lines cut at the header rule width (#4110). #4341: the steps no longer
// capture Esc (the old useCaptureEscape and useGuidanceOpen are gone); Esc
// belongs to the wizard, keep and skip are list entries (ActionRows).

import { Box, Text } from 'ink';
import { PickerRow, StatusRow, fitToWidth, statusLabelWidth, tone, useHeaderWidth } from '@swao/tui-kit';
import type { SetupCheckItem } from '../types.js';

/**
 * #4341 / #4254 (Design 126 section 7.7): the action entries below a list of
 * status rows ("Check again", "Continue", "Skip this step"). Keep, skip and
 * continue are visible entries, never Esc. `offset` is the cursor index of the
 * first entry (the rows above take the indexes before it). #4254 (run 9): the
 * rows are central PickerRows, the marker in the column of the StatusRow marker.
 */
export function ActionRows({ labels, cursor, offset = 0 }: { labels: readonly string[]; cursor: number; offset?: number }) {
  const width = useHeaderWidth();
  return (
    <Box flexDirection="column" marginTop={1}>
      {labels.map((label, i) => (
        <PickerRow key={`${i}-${label}`} selected={cursor === offset + i} indent={false}>
          <Text {...tone(cursor === offset + i ? 'selection' : 'text')}>{fitToWidth(label, Math.max(1, width - 2))}</Text>
        </PickerRow>
      ))}
    </Box>
  );
}

/** #4254: Up and Down move a cursor over `size` entries, wrapping at both ends; true when the key was used. */
export function moveCursor(key: { upArrow?: boolean; downArrow?: boolean }, size: number, set: (f: (c: number) => number) => void): boolean {
  if (size <= 0) return false;
  if (key.upArrow) { set((c) => (c + size - 1) % size); return true; }
  if (key.downArrow) { set((c) => (c + 1) % size); return true; }
  return false;
}

/**
 * Status rows (#4254, Design 126 M-06): the central StatusRow, the text
 * wrapped under its column instead of cut, optionally with a cursor.
 */
export function StatusRows({ rows, cursor }: { rows: ReadonlyArray<{ state: SetupCheckItem['state']; label: string; text: string }>; cursor?: number }) {
  // #4295 / #4348: the shared label column rule; labels widen to fit, never wrap inside the column.
  const width = useHeaderWidth();
  const labelWidth = statusLabelWidth(rows.map((r) => r.label), width, { min: 8 });
  return (
    <Box flexDirection="column" marginTop={1}>
      {rows.map((r, i) => (
        <StatusRow key={`${i}-${r.label}`} level={r.state} label={r.label} summary={r.text} selected={cursor === i} labelWidth={labelWidth} />
      ))}
    </Box>
  );
}
