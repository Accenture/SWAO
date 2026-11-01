// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI picker mouse-wheel contract (#3519)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// TU-WHEEL-01: SelectInput, wheel-down (SGR + X10) does not move the highlight or call onCursorChange
// TU-WHEEL-02: SelectInput, Enter after a wheel tick confirms the option the operator saw first
// TU-WHEEL-03: SelectInput, wheelNavigation opt-in still moves the highlight (path is exercised)
// TU-WHEEL-04: MultiSelect, wheel-down does not move the cursor by default
// TU-WHEEL-05: MultiSelect, wheelNavigation opt-in moves the cursor

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { SelectInput, MultiSelect } from '@swao/tui-kit';

const OPTIONS = [
  { label: 'Top 20 apps', value: 'top' },
  { label: 'Assess every app', value: 'all' },
  { label: 'None', value: 'none' },
];

// Wheel-down reports: SGR (button 65 = 64 wheel | 1 down) and X10 (cb = 32 + 65).
const SGR_WHEEL_DOWN = '\x1b[<65;10;5M';
const X10_WHEEL_DOWN = '\x1b[M' + String.fromCharCode(32 + 65) + '!!';

async function settle(ms = 60): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms));
}

function cursorLine(frame: string, marker: string): string | undefined {
  return frame.split('\n').find((l) => l.trimStart().startsWith(marker));
}

describe('SelectInput -- TU-WHEEL-01: wheel does not move the highlight (#3519)', () => {
  it('keeps index 0 and never calls onCursorChange beyond the mount notification', async () => {
    const onCursorChange = vi.fn();
    const { lastFrame, stdin } = render(
      <SelectInput label="Scope" options={OPTIONS} onSelect={vi.fn()} onCursorChange={onCursorChange} />,
    );
    await settle();
    expect(onCursorChange).toHaveBeenCalledTimes(1);
    expect(onCursorChange).toHaveBeenLastCalledWith('top');
    stdin.write(SGR_WHEEL_DOWN);
    await settle();
    stdin.write(X10_WHEEL_DOWN);
    await settle();
    expect(cursorLine(lastFrame() ?? '', '❯')).toContain('Top 20 apps');
    expect(onCursorChange).toHaveBeenCalledTimes(1);
  });
});

describe('SelectInput -- TU-WHEEL-02: Enter after a wheel tick confirms the first option', () => {
  it('onSelect receives "top", not "all"', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(<SelectInput label="Scope" options={OPTIONS} onSelect={onSelect} />);
    await settle();
    stdin.write(SGR_WHEEL_DOWN);
    await settle();
    stdin.write('\r');
    await settle();
    expect(onSelect).toHaveBeenCalledWith('top');
    expect(onSelect).not.toHaveBeenCalledWith('all');
  });
});

describe('SelectInput -- TU-WHEEL-03: wheelNavigation opt-in', () => {
  it('moves the highlight on wheel-down when explicitly enabled', async () => {
    const onCursorChange = vi.fn();
    const { lastFrame, stdin } = render(
      <SelectInput label="Scope" options={OPTIONS} onSelect={vi.fn()} onCursorChange={onCursorChange} wheelNavigation />,
    );
    await settle();
    stdin.write(SGR_WHEEL_DOWN);
    await settle();
    expect(cursorLine(lastFrame() ?? '', '❯')).toContain('Assess every app');
    expect(onCursorChange).toHaveBeenLastCalledWith('all');
  });
});

describe('MultiSelect -- TU-WHEEL-04: wheel does not move the cursor by default (#3519)', () => {
  it('keeps the cursor on the first row and never reports a cursor change', async () => {
    const onCursorChange = vi.fn();
    const { lastFrame, stdin } = render(
      <MultiSelect label="Pick" options={OPTIONS} onConfirm={vi.fn()} onCursorChange={onCursorChange} />,
    );
    await settle();
    const callsAfterMount = onCursorChange.mock.calls.length;
    stdin.write(SGR_WHEEL_DOWN);
    await settle();
    expect(cursorLine(lastFrame() ?? '', '>')).toContain('Top 20 apps');
    expect(onCursorChange.mock.calls.length).toBe(callsAfterMount);
    expect(onCursorChange).not.toHaveBeenCalledWith('all');
  });
});

describe('MultiSelect -- TU-WHEEL-05: wheelNavigation opt-in', () => {
  it('moves the cursor on wheel-down when explicitly enabled', async () => {
    const { lastFrame, stdin } = render(
      <MultiSelect label="Pick" options={OPTIONS} onConfirm={vi.fn()} wheelNavigation />,
    );
    await settle();
    stdin.write(SGR_WHEEL_DOWN);
    await settle();
    expect(cursorLine(lastFrame() ?? '', '>')).toContain('Assess every app');
  });
});
