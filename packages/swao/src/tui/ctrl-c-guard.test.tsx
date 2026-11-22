// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, Ctrl+C asks before quitting (#4379)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4379 (Design 126 section 7.11): one Ctrl+C shows the prompt and never
// quits; a second Ctrl+C within 2 seconds quits with exit cause ctrl_c; any
// other key clears the prompt; Ink never sees the Ctrl+C byte, other bytes
// (a paste) pass on unchanged; the prompt takes the last row of the frame.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Box, Text } from 'ink';
import { TerminalFrame } from '@swao/tui-kit';
import { resetTuiCrashState, tuiExitCause } from './crash-report.js';
import {
  CTRL_C_PROMPT, CTRL_C_WINDOW_MS, CtrlCQuitLine, createCtrlCGuard, installCtrlCGuard, activeCtrlCGuard,
  resetCtrlCGuard, useCtrlCArmed, type CtrlCGuard,
} from './ctrl-c-guard.js';

const CTRL_C = '\u0003';
const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function fakeStdin(chunks: Array<string | Buffer | null>) {
  return { read: (): unknown => (chunks.length > 0 ? chunks.shift() : null) };
}

beforeEach(() => {
  resetTuiCrashState();
  resetCtrlCGuard();
});

describe('createCtrlCGuard (#4379)', () => {
  it('a single Ctrl+C arms the prompt and does not quit', () => {
    const onQuit = vi.fn();
    const c = clock();
    const g = createCtrlCGuard({ onQuit, now: c.now, schedule: () => () => {} });
    expect(g.press()).toBe('armed');
    expect(g.armed()).toBe(true);
    expect(onQuit).not.toHaveBeenCalled();
    expect(tuiExitCause()).toBeNull();
  });

  it('a second Ctrl+C within 2 seconds quits and marks ctrl_c', () => {
    const onQuit = vi.fn();
    const c = clock();
    const g = createCtrlCGuard({ onQuit, now: c.now, schedule: () => () => {} });
    g.press();
    c.advance(CTRL_C_WINDOW_MS - 1);
    expect(g.press()).toBe('quit');
    expect(onQuit).toHaveBeenCalledTimes(1);
    expect(tuiExitCause()).toBe('ctrl_c');
    expect(g.armed()).toBe(false);
  });

  it('a second Ctrl+C after the window arms again instead of quitting', () => {
    const onQuit = vi.fn();
    const c = clock();
    const g = createCtrlCGuard({ onQuit, now: c.now, schedule: () => () => {} });
    g.press();
    c.advance(CTRL_C_WINDOW_MS + 1);
    expect(g.press()).toBe('armed');
    expect(onQuit).not.toHaveBeenCalled();
    expect(tuiExitCause()).toBeNull();
  });

  it('any other key clears the prompt, so the next Ctrl+C only arms', () => {
    const onQuit = vi.fn();
    const g = createCtrlCGuard({ onQuit, now: clock().now, schedule: () => () => {} });
    const seen: boolean[] = [];
    g.subscribe((a) => seen.push(a));
    g.press();
    g.otherKey();
    expect(g.armed()).toBe(false);
    expect(g.press()).toBe('armed');
    expect(onQuit).not.toHaveBeenCalled();
    expect(seen).toEqual([true, false, true]);
  });

  it('the prompt hides on its own after the window', () => {
    let fire: (() => void) | null = null;
    const g = createCtrlCGuard({ onQuit: vi.fn(), now: clock().now, schedule: (fn, ms) => { expect(ms).toBe(CTRL_C_WINDOW_MS); fire = fn; return () => { fire = null; }; } });
    g.press();
    expect(g.armed()).toBe(true);
    (fire as (() => void) | null)?.();
    expect(g.armed()).toBe(false);
  });
});

describe('installCtrlCGuard: Ink never sees Ctrl+C (#4379)', () => {
  function guarded(chunks: Array<string | Buffer | null>, c = clock()) {
    const onQuit = vi.fn();
    const g = createCtrlCGuard({ onQuit, now: c.now, schedule: () => () => {} });
    const stdin = fakeStdin(chunks);
    const original = stdin.read;
    const uninstall = installCtrlCGuard(stdin, g);
    return { stdin, g, onQuit, uninstall, original };
  }

  it('a chunk of only Ctrl+C is skipped and the next chunk is returned', () => {
    const { stdin, g, onQuit } = guarded([CTRL_C, 'a', null]);
    expect(stdin.read()).toBe('a');
    expect(onQuit).not.toHaveBeenCalled();
    // 'a' came after the Ctrl+C, so it cleared the prompt.
    expect(g.armed()).toBe(false);
  });

  it('a single Ctrl+C leaves the prompt armed and returns null at the end of input', () => {
    const { stdin, g, onQuit } = guarded([CTRL_C, null]);
    expect(stdin.read()).toBeNull();
    expect(g.armed()).toBe(true);
    expect(onQuit).not.toHaveBeenCalled();
  });

  it('two Ctrl+C quit with ctrl_c, in one chunk or in two', () => {
    const one = guarded([CTRL_C + CTRL_C, null]);
    expect(one.stdin.read()).toBeNull();
    expect(one.onQuit).toHaveBeenCalledTimes(1);
    resetTuiCrashState();
    const two = guarded([CTRL_C, CTRL_C, null]);
    expect(two.stdin.read()).toBeNull();
    expect(two.onQuit).toHaveBeenCalledTimes(1);
    expect(tuiExitCause()).toBe('ctrl_c');
  });

  it('a pasted chunk passes on unchanged; Ctrl+C bytes inside a chunk are taken out', () => {
    const { stdin } = guarded(['https://example.test/a?b=c', `ab${CTRL_C}cd`, Buffer.from(`x${CTRL_C}y`), null]);
    expect(stdin.read()).toBe('https://example.test/a?b=c');
    expect(stdin.read()).toBe('abcd');
    const buf = stdin.read();
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(String(buf)).toBe('xy');
  });

  it('uninstall restores the read and clears the active guard', () => {
    const { stdin, g, uninstall, original } = guarded([null]);
    expect(activeCtrlCGuard()).toBe(g);
    uninstall();
    expect(stdin.read).toBe(original);
    expect(activeCtrlCGuard()).toBeNull();
  });
});

function Root({ guard }: { guard: CtrlCGuard }): JSX.Element {
  const armed = useCtrlCArmed(guard);
  return (
    <TerminalFrame rows={12} columns={80} statusLine={armed ? <CtrlCQuitLine /> : undefined}>
      <Box flexDirection="column">
        {Array.from({ length: 20 }, (_, i) => <Text key={i}>{`content line ${i + 1}`}</Text>)}
      </Box>
    </TerminalFrame>
  );
}

describe('the prompt on the last row of the frame (#4379)', () => {
  it('shows on the last row while armed, the frame keeps its height, and hides again', async () => {
    const g = createCtrlCGuard({ onQuit: vi.fn(), schedule: () => () => {} });
    const r = render(<Root guard={g} />);
    await tick();
    const before = (r.lastFrame() ?? '').split('\n');
    expect(before).toHaveLength(11);
    expect(before.join('\n')).not.toContain(CTRL_C_PROMPT);
    g.press();
    await tick();
    const armed = (r.lastFrame() ?? '').split('\n');
    expect(armed).toHaveLength(11);
    expect(armed[armed.length - 1]).toContain(CTRL_C_PROMPT);
    expect(armed[0]).toContain('content line 1');
    g.otherKey();
    await tick();
    const after = (r.lastFrame() ?? '').split('\n');
    expect(after).toHaveLength(11);
    expect(after.join('\n')).not.toContain(CTRL_C_PROMPT);
    r.unmount();
  });
});
