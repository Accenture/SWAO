// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI component tests: MultiSelect (#1618-F)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// TU-MS-01: unselected row shows "[ ]" and no cursor indicator
// TU-MS-02: cursor row shows the "❯ " cursor indicator (#4249: the one marker of SelectInput) and "[x]" when also selected
// TU-MS-03: selected-but-not-focused row shows "[x]" without ">" indicator
// TU-MS-04: cursor moves with arrow keys
// TU-MS-05: Space key toggles selection state
//
// Colour contract (source-verified):
//   Cursor row:              color={isCursor || isSelected ? 'cyan' : undefined}
//   Selected-not-focused:    same condition -> cyan
//   Unselected-not-focused:  color={undefined} -> default terminal colour
// ink-testing-library strips ANSI codes, so colour is verified at source level.
// Visual-state tests (cursor indicator, checkbox marker) are the runtime proxies.

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { MultiSelect } from '@swao/tui-kit';
import type { MultiSelectOption } from '@swao/tui-kit';

const MARKER = String.fromCodePoint(0x276f);

const OPTIONS: MultiSelectOption[] = [
  { label: 'Alpha', value: 'alpha' },
  { label: 'Beta',  value: 'beta'  },
  { label: 'Gamma', value: 'gamma' },
];

async function settle(ms = 60): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// TU-MS-01: unselected, not-focused row
// ---------------------------------------------------------------------------
describe('MultiSelect -- TU-MS-01: unselected not-focused row', () => {
  it('shows "[ ]" marker for an unselected option', () => {
    const { lastFrame } = render(
      <MultiSelect
        label="Pick options"
        options={OPTIONS}
        onConfirm={vi.fn()}
        initialSelected={[]}
      />,
    );
    const frame = lastFrame() ?? '';
    // All rows start unselected; at least one row shows empty checkbox
    expect(frame).toContain('[ ]');
  });

  it('shows no cursor on non-focused rows when cursor is elsewhere', () => {
    const { lastFrame } = render(
      <MultiSelect
        label="Pick options"
        options={OPTIONS}
        onConfirm={vi.fn()}
        initialSelected={[]}
      />,
    );
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    // Cursor starts at index 0 (Alpha). Beta and Gamma have no ">" prefix.
    const betaLine  = lines.find((l) => l.includes('Beta'));
    const gammaLine = lines.find((l) => l.includes('Gamma'));
    expect(betaLine).toBeDefined();
    expect(gammaLine).toBeDefined();
    expect(betaLine).not.toMatch(/^\s*>/);
    expect(gammaLine).not.toMatch(/^\s*>/);
  });
});

// ---------------------------------------------------------------------------
// TU-MS-02: cursor row
// ---------------------------------------------------------------------------
describe('MultiSelect -- TU-MS-02: cursor row has ">" indicator', () => {
  it('shows the cursor marker on the first row when cursor is at index 0', () => {
    const { lastFrame } = render(
      <MultiSelect
        label="Pick options"
        options={OPTIONS}
        onConfirm={vi.fn()}
        initialSelected={[]}
      />,
    );
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    const alphaLine = lines.find((l) => l.includes('Alpha'));
    expect(alphaLine).toBeDefined();
    // The cursor row starts with the marker (within the indent)
    expect(alphaLine).toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// TU-MS-03: selected-but-not-focused row
// ---------------------------------------------------------------------------
describe('MultiSelect -- TU-MS-03: selected-but-not-focused row shows [x]', () => {
  it('shows "[x]" on a pre-selected row that is not the cursor', async () => {
    // Pre-select both 'alpha' and 'beta'. MultiSelect (#1086) places the cursor
    // on the first pre-selected item in options order, so cursor lands on 'alpha'
    // (index 0). 'beta' (index 1) is therefore selected-but-not-focused.
    const { lastFrame } = render(
      <MultiSelect
        label="Pick options"
        options={OPTIONS}
        onConfirm={vi.fn()}
        initialSelected={['alpha', 'beta']}
      />,
    );
    await settle();
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    const betaLine = lines.find((l) => l.includes('Beta'));
    expect(betaLine).toBeDefined();
    // Selected -> shows "[x]"
    expect(betaLine).toContain('[x]');
    // Not focused -> no cursor ">" indicator at start
    expect(betaLine).not.toMatch(/^\s*>/);
  });

  it('cursor row shows "[x]" AND the marker when cursor is on a selected option', () => {
    // Pre-select 'alpha'; cursor starts at index 0 ('alpha'): cursor + selected.
    const { lastFrame } = render(
      <MultiSelect
        label="Pick options"
        options={OPTIONS}
        onConfirm={vi.fn()}
        initialSelected={['alpha']}
      />,
    );
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    const alphaLine = lines.find((l) => l.includes('Alpha'));
    expect(alphaLine).toBeDefined();
    expect(alphaLine).toContain('[x]');
    expect(alphaLine).toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// TU-MS-04: cursor moves with arrow keys
// ---------------------------------------------------------------------------
describe('MultiSelect -- TU-MS-04: cursor moves with arrow keys', () => {
  it('moves cursor down on down-arrow key', async () => {
    const { lastFrame, stdin } = render(
      <MultiSelect
        label="Pick options"
        options={OPTIONS}
        onConfirm={vi.fn()}
        initialSelected={[]}
      />,
    );
    await settle();
    // Down arrow
    stdin.write('\x1B[B');
    await settle();
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    // After one down-arrow, cursor is on Beta (index 1)
    const betaLine = lines.find((l) => l.includes('Beta'));
    expect(betaLine).toBeDefined();
    expect(betaLine).toContain(MARKER);
    // Alpha should no longer have the cursor
    const alphaLine = lines.find((l) => l.includes('Alpha'));
    expect(alphaLine).not.toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// TU-MS-05: Space key toggles selection
// ---------------------------------------------------------------------------
describe('MultiSelect -- TU-MS-05: Space key toggles selection', () => {
  it('selects the focused option when Space is pressed', async () => {
    const { lastFrame, stdin } = render(
      <MultiSelect
        label="Pick options"
        options={OPTIONS}
        onConfirm={vi.fn()}
        initialSelected={[]}
      />,
    );
    await settle();
    stdin.write(' ');
    await settle();
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    const alphaLine = lines.find((l) => l.includes('Alpha'));
    // Alpha (cursor position) is now selected
    expect(alphaLine).toContain('[x]');
  });

  it('deselects the focused option when Space is pressed again', async () => {
    const { lastFrame, stdin } = render(
      <MultiSelect
        label="Pick options"
        options={OPTIONS}
        onConfirm={vi.fn()}
        initialSelected={['alpha']}
      />,
    );
    await settle();
    stdin.write(' ');
    await settle();
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    const alphaLine = lines.find((l) => l.includes('Alpha'));
    // Alpha toggled back to unselected
    expect(alphaLine).toContain('[ ]');
  });
});

// #3380: non-selectable header rows (country grouping).
describe('MultiSelect header rows (#3380)', () => {
  const HEADERED: MultiSelectOption[] = [
    { label: 'Germany', value: '__hdr:Germany', header: true },
    { label: 'otc / eu-de', value: 'otc:eu-de' },
    { label: 'Netherlands', value: '__hdr:Netherlands', header: true },
    { label: 'otc / eu-nl', value: 'otc:eu-nl' },
  ];

  it('renders a header row without a checkbox and starts the cursor on the first selectable row', async () => {
    const { lastFrame } = render(<MultiSelect label="Pick" options={HEADERED} onConfirm={vi.fn()} />);
    await settle();
    const lines = (lastFrame() ?? '').split('\n');
    const gerLine = lines.find((l) => l.includes('Germany'));
    expect(gerLine).not.toContain('['); // header: no checkbox
    const euDe = lines.find((l) => l.includes('eu-de'));
    expect(euDe).toContain(MARKER);       // cursor started on the first selectable, not the header
    expect(euDe).toContain('[ ]');
  });

  it('skips the header row when moving the cursor down', async () => {
    const { lastFrame, stdin } = render(<MultiSelect label="Pick" options={HEADERED} onConfirm={vi.fn()} />);
    await settle();
    stdin.write('\x1B[B'); // down: eu-de -> eu-nl, skipping the Netherlands header
    await settle();
    const lines = (lastFrame() ?? '').split('\n');
    expect(lines.find((l) => l.includes('eu-nl'))).toContain(MARKER);
    expect(lines.find((l) => l.includes('Netherlands'))).not.toContain(MARKER);
  });

  it('A (toggle all) selects only non-header rows', async () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<MultiSelect label="Pick" options={HEADERED} onConfirm={onConfirm} />);
    await settle();
    stdin.write('a');       // select all
    await settle();
    stdin.write('\r');      // confirm
    await settle();
    expect(onConfirm).toHaveBeenCalledWith(['otc:eu-de', 'otc:eu-nl']);
  });
});

// #4255 (Design 126 section 7.7): "Skip this step" as an action entry, the last row.
describe('MultiSelect -- TU-MS-ACT: action entry (#4255)', () => {
  const WITH_SKIP: MultiSelectOption[] = [...OPTIONS, { label: 'Skip this step', value: '__skip__', action: true }];
  const DOWN = '\u001B[B';

  it('renders the action entry without a checkbox, as the last row', async () => {
    const { lastFrame } = render(<MultiSelect label="Pick" options={WITH_SKIP} onConfirm={vi.fn()} onAction={vi.fn()} />);
    await settle();
    const rows = (lastFrame() ?? '').split('\n').filter((l) => l.trim() !== '');
    const skip = rows.find((l) => l.includes('Skip this step')) ?? '';
    expect(skip).not.toContain('[');
    expect(rows.indexOf(skip)).toBeGreaterThan(rows.findIndex((l) => l.includes('Gamma')));
  });

  it('Space and A never toggle it; Enter on it runs the action, not the confirmation', async () => {
    const onConfirm = vi.fn();
    const onAction = vi.fn();
    const { stdin, lastFrame } = render(<MultiSelect label="Pick" options={WITH_SKIP} onConfirm={onConfirm} onAction={onAction} allowEmptyConfirm />);
    await settle();
    stdin.write('A'); // toggle all: the three options, not the action
    await settle();
    expect((lastFrame() ?? '').match(/\[x\]/g)).toHaveLength(3);
    for (let i = 0; i < 3; i++) { stdin.write(DOWN); await settle(); }
    expect((lastFrame() ?? '').split('\n').find((l) => l.includes(MARKER))).toContain('Skip this step');
    stdin.write(' ');
    await settle();
    expect((lastFrame() ?? '').match(/\[x\]/g)).toHaveLength(3);
    stdin.write('\r');
    await settle();
    expect(onAction).toHaveBeenCalledWith('__skip__');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Enter on a regular option still confirms the selection without the action value', async () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<MultiSelect label="Pick" options={WITH_SKIP} onConfirm={onConfirm} onAction={vi.fn()} initialSelected={['beta', '__skip__']} />);
    await settle();
    stdin.write('\r');
    await settle();
    expect(onConfirm).toHaveBeenCalledWith(['beta']);
  });

  it('a filter never hides the action entry and does not count it', async () => {
    const { stdin, lastFrame } = render(<MultiSelect label="Pick" options={WITH_SKIP} onConfirm={vi.fn()} onAction={vi.fn()} filter itemNoun="options" />);
    await settle();
    expect(lastFrame()).toContain('type to narrow 3 options'); // #4492: the empty filter field invites typing
    stdin.write('g');
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('1 of 3 options');
    expect(frame).toContain('Gamma');
    expect(frame).toContain('Skip this step');
    expect(frame).not.toContain('Alpha');
  });
});
