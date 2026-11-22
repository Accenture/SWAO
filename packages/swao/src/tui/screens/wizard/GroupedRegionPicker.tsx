// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, the grouped region picker
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4494: the regions of a provider catalogue under their country and area
// headings (lz-region-groups.ts), for the Add scope step of Landing Zone
// Connections: Space ticks a region or every region of a heading, Enter
// confirms. Enter without a tick keeps "all regions" (an empty list, as the
// free-text input of the step did with an empty value).

import { useRef, useState } from 'react';
import { Box, Text, useInput, type DOMElement } from 'ink';
import { PickerRow, fitToWidth, pagedListWindow, tone, useHeaderWidth, useListBudget } from '@swao/tui-kit';
import type { LzGeographyRegion } from '@swao/module-landing-zone';
import { groupLzRegions, regionRowText, toggleRow } from './lz-region-groups.js';

export interface GroupedRegionPickerProps {
  regions: readonly LzGeographyRegion[];
  initial?: readonly string[];
  /** The ticked region ids in catalogue order; [] means all regions. */
  onConfirm: (regions: string[]) => void;
  /** The last row "Type the regions instead": a region the catalogue does not list. */
  onType?: () => void;
  active?: boolean;
}

/** The last row of the picker: the free-text input for a region the catalogue does not list. */
export const TYPE_REGIONS_LABEL = 'Type the regions instead';

/** The line under the grouped region list of the Add scope step. */
export const ALL_REGIONS_HINT = 'Space ticks a region or all regions of a country; Enter without a tick keeps all regions.';

export function GroupedRegionPicker({ regions, initial = [], onConfirm, onType, active = true }: GroupedRegionPickerProps): JSX.Element {
  const width = useHeaderWidth();
  // Design 126 section 7.10: the window takes the rows the frame leaves (the shared height rule).
  const listRef = useRef<DOMElement>(null);
  const budget = useListBudget(listRef);
  const rows = groupLzRegions(regions);
  const typeIndex = onType ? rows.length : -1;
  const size = rows.length + (onType ? 1 : 0);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(initial));
  const [cursor, setCursor] = useState(0);
  useInput((input, key) => {
    if (size === 0) return;
    if (key.upArrow) { setCursor((c) => (c - 1 + size) % size); return; }
    if (key.downArrow) { setCursor((c) => (c + 1) % size); return; }
    if (input === ' ' && cursor < rows.length) { const row = rows[cursor]!; setTicked((s) => toggleRow(row, s)); return; }
    if (key.return && cursor === typeIndex) { onType?.(); return; }
    if (key.return) onConfirm(regions.map((r) => r.id).filter((id) => ticked.has(id)));
  }, { isActive: active });
  const win = pagedListWindow(rows.map(() => 1), Math.min(cursor, Math.max(0, rows.length - 1)), budget === undefined ? undefined : Math.max(3, budget - (onType ? 2 : 1)));
  return (
    <Box ref={listRef} flexDirection="column">
      <Text bold>Regions:</Text>
      {win.above > 0 && <Text {...tone('muted')}>{`  ↑ ${win.above} more`}</Text>}
      {rows.slice(win.start, win.end).map((r, i) => {
        const idx = win.start + i;
        return (
          <PickerRow key={r.key} selected={idx === cursor} indent={false}>
            <Text {...(idx === cursor ? tone('selection') : r.kind === 'region' ? {} : tone('brand', { bold: false }))}>{fitToWidth(regionRowText(r, ticked), Math.max(1, width - 2))}</Text>
          </PickerRow>
        );
      })}
      {win.below > 0 && <Text {...tone('muted')}>{`  ↓ ${win.below} more`}</Text>}
      {onType && (
        <PickerRow selected={cursor === typeIndex} indent={false}>
          <Text {...tone(cursor === typeIndex ? 'selection' : 'text')}>{TYPE_REGIONS_LABEL}</Text>
        </PickerRow>
      )}
      <Text {...tone('muted')} wrap="wrap">{ALL_REGIONS_HINT}</Text>
    </Box>
  );
}
