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

// #4190 SET-01 (Design 125 sections 4, 5): the Ready step of one branch:
// its scoped health result, the recorded branch state, and what is set up or
// missing (the branch readySummary, else the `check` of its steps).
//
// #4223 (owner redesign 2026-11-10, Design 126 sections 6, 7 and 10): the
// state line in the colour of the branch state; one compact row per item
// (setup/ready-rows.ts), tool items grouped, one Health check row; the
// explanation of the highlighted row in the guidance box; the list pages
// through the shared height rule (useListBudget, computeListWindow) when it
// is taller than the rows the screen leaves. The CLI summary keeps the full
// text (formatBranchCheck).

import { useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, type DOMElement } from 'ink';
import { StatusLabel, StatusRow, pagedListStep, pagedListWindow, statusRowHeight, tone, useGuidanceOpen, useHeaderWidth, useListBudget, type KeyHint } from '@swao/tui-kit';
import type { SetupAssessmentType } from '@swao/core';
import type { SetupRegistry } from './registry.js';
import type { SetupHealthResult } from './types.js';
import { branchReadyItems, branchStateFromCheck } from './branch-check.js';
import { branchStateWord, readyLabelWidth, readyRowProps, readyRows, readyHealthLevel } from './ready-rows.js';
import { SetupStepFrame } from './setup-frame.js';

export { branchReadyItems, readyHealthLevel };

export interface BranchReadyStepProps {
  registry: SetupRegistry;
  type: SetupAssessmentType;
  workspaceRoot: string;
  health: SetupHealthResult | undefined;
  /** True when another branch follows in this run (Enter continues instead of returning to the menu). */
  hasNext: boolean;
  onNext: () => void;
}

export function BranchReadyStep({ registry, type, workspaceRoot, health, hasNext, onNext }: BranchReadyStepProps) {
  const label = registry.branch(type).branch.label;
  const items = useMemo(() => branchReadyItems(registry, type, workspaceRoot, health), [registry, type, workspaceRoot, health]);
  const state = branchStateFromCheck(health, items);
  const rows = useMemo(() => readyRows(items, health), [items, health]);
  const [cursor, setCursor] = useState(0);
  const width = useHeaderWidth();
  const listRef = useRef<DOMElement>(null);
  const budget = useListBudget(listRef);
  const pageSize = useRef(1);
  // #4394: the open state of the guidance box (the wizard's owner, tui-kit guidance-open.ts).
  const guidance = useGuidanceOpen();

  useInput((_input, key) => {
    // #4341: Esc belongs to the wizard (back to the main menu, nothing to lose here).
    if (key.return) { onNext(); return; }
    const last = Math.max(0, rows.length - 1);
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(last, c + 1));
    // The expanded guidance box pages its own sections (#4348).
    if ((key.pageUp || key.pageDown) && !guidance.isOpen()) {
      const step = Math.max(1, pageSize.current);
      setCursor((c) => (key.pageUp ? Math.max(0, c - step) : Math.min(last, c + step)));
    }
  });

  const at = Math.min(cursor, Math.max(0, rows.length - 1));
  const { labelWidth } = readyLabelWidth(rows, width);
  const props = rows.map((r) => readyRowProps(r, labelWidth, width));
  const heights = props.map((p) => statusRowHeight(p, width));
  // #4348: the shared paged-list window of tui-kit (its fallback before the first measurement).
  const win = pagedListWindow(heights, at, budget);
  pageSize.current = pagedListStep(win);
  const paged = win.above > 0 || win.below > 0;
  const word = branchStateWord(state);
  const keys: KeyHint[] = [
    { key: '↑↓', verb: 'select' },
    ...(paged ? [{ key: 'PgDn', verb: 'page' } as const] : []),
    { key: 'Enter', verb: hasNext ? 'next' : 'finish' },
    // #4254 (Design 126 section 7.9, last step): Esc leaves to the main menu; the wizard asks nothing on Ready.
    { key: 'Esc', verb: 'abort' },
  ];
  const row = rows[at];
  // The next action is a guidance section, not key words on the screen (G-04).
  const next = { label: 'Next', text: hasNext ? 'the setup of the next assessment type.' : 'the setup ends and SWAO returns to the main menu.' };
  return (
    <SetupStepFrame
      title="Ready"
      subtitle="What is set up for this assessment type and what is missing."
      keys={keys}
      guidance={row ? { ...row.guidance, sections: [...(row.guidance.sections ?? []), next] } : undefined}
    >
      <Box>
        <Text {...tone('text')}>{`${label}: `}</Text>
        <StatusLabel level={word.level} form="summary" text={word.text} />
      </Box>
      <Box ref={listRef} flexDirection="column" marginTop={1}>
        {win.above > 0 && <Box marginLeft={2}><Text {...tone('muted')}>{`↑ ${win.above} more`}</Text></Box>}
        {rows.slice(win.start, win.end).map((r, i) => (
          <StatusRow key={`${r.label}-${win.start + i}`} {...props[win.start + i]!} selected={win.start + i === at} textTone="text" />
        ))}
        {win.below > 0 && <Box marginLeft={2}><Text {...tone('muted')}>{`↓ ${win.below} more, rows ${win.start + 1} to ${win.end} of ${rows.length}`}</Text></Box>}
      </Box>
    </SetupStepFrame>
  );
}
