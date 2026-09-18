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
// TU-MS-02: cursor row shows "> " cursor indicator and "[x]" when also selected
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
  it('shows "> " on the first row when cursor is at index 0', () => {
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
    // The cursor row starts with "> " (within the indent)
    expect(alphaLine).toContain('> ');
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

  it('cursor row shows "[x]" AND ">" when cursor is on a selected option', () => {
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
    expect(alphaLine).toContain('> ');
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
    expect(betaLine).toContain('> ');
    // Alpha should no longer have the cursor
    const alphaLine = lines.find((l) => l.includes('Alpha'));
    expect(alphaLine).not.toContain('> ');
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
