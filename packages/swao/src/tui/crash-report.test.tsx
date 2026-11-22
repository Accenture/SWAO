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

// #4345: tui.crash records, the ErrorPanel of a screen and of the process,
// the process-level handler (panel or exit) and the Ctrl+C cause.

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';

const { logged } = vi.hoisted(() => ({ logged: [] as Array<{ level: string; code: string; context?: Record<string, unknown>; mirror?: boolean }> }));

vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return {
    ...actual,
    logPortfolio: vi.fn((level: string, code: string, _msg: string, opts?: { context?: Record<string, unknown>; mirror?: boolean }) => { logged.push({ level, code, context: opts?.context, mirror: opts?.mirror }); }),
    resolveWorkspaceRoot: vi.fn(() => '/ws'),
  };
});

import {
  CrashPanel, TuiCrashBoundary, TuiCrashOverlay, handleProcessCrash, markTuiExitCause, reportTuiCrash,
  resetTuiCrashState, sentence, setTuiLocation, stackTop, tuiExitCause,
} from './crash-report.js';

const tick = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));
afterEach(() => { logged.length = 0; resetTuiCrashState(); });

function Boom(): JSX.Element { throw new RangeError('row index out of range'); }

describe('tui.crash record (#4345)', () => {
  it('stackTop keeps the first frames only; sentence ends the message with a full stop', () => {
    const e = new Error('x');
    e.stack = 'Error: x\n    at a (f.ts:1:1)\n    at b (f.ts:2:1)\n    at c (f.ts:3:1)\n    at d (f.ts:4:1)';
    expect(stackTop(e)).toEqual(['at a (f.ts:1:1)', 'at b (f.ts:2:1)', 'at c (f.ts:3:1)']);
    expect(stackTop('not an error')).toEqual([]);
    expect(sentence('no folder')).toBe('no folder.');
    expect(sentence('done.  ')).toBe('done.');
    expect(sentence('')).toBe('An unexpected error occurred.');
  });

  it('records class, message, stack top, screen and step; a process crash marks the exit cause, a render error does not', () => {
    setTuiLocation({ screen: 'setup', step: 'Org Evidence' });
    const r = reportTuiCrash(new RangeError('row index out of range'), 'render');
    expect(r).toMatchObject({ origin: 'render', errorClass: 'RangeError', screen: 'setup', step: 'Org Evidence' });
    expect(r.logPath?.replace(/\\/g, '/')).toMatch(/^\/ws\/wsp\/logs\/portfolio-events-\d{4}-\d{2}\.ndjson$/);
    expect(logged[0]).toMatchObject({ level: 'error', code: 'tui.crash', mirror: false, context: { origin: 'render', error_class: 'RangeError', message: 'row index out of range', screen: 'setup', step: 'Org Evidence' } });
    expect(tuiExitCause()).toBeNull();
    reportTuiCrash('plain', 'unhandledRejection');
    expect(tuiExitCause()).toBe('crash');
    markTuiExitCause('ctrl_c');
    expect(tuiExitCause()).toBe('crash'); // a crash wins
  });
});

describe('process-level crash handler (#4345)', () => {
  it('without the overlay it exits with code 1', () => {
    const exit = vi.fn();
    expect(handleProcessCrash(new Error('late'), 'uncaughtException', exit)).toBe(false);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logged.map((l) => l.code)).toEqual(['tui.crash']);
  });

  it('with the overlay mounted the ErrorPanel replaces the app with the log path; Enter exits 1', async () => {
    const exit = vi.fn();
    const r = render(<TuiCrashOverlay exit={exit}><Text>THE APP</Text></TuiCrashOverlay>);
    await tick();
    expect(r.lastFrame()).toContain('THE APP');
    expect(handleProcessCrash(new TypeError('handler failed'), 'uncaughtException', vi.fn())).toBe(true);
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).not.toContain('THE APP');
    expect(frame).toContain('SWAO stopped with an error');
    expect(frame).toContain('handler failed.');
    expect(frame).toContain('Exit SWAO');
    r.stdin.write('\u0007'); // Ctrl+G opens the guidance with the log path
    await tick();
    expect(r.lastFrame()).toContain('wsp/logs/portfolio-events-');
    r.stdin.write('\r');
    await tick();
    expect(exit).toHaveBeenCalledWith(1);
    r.unmount();
  });
});

describe('TuiCrashBoundary (#4345)', () => {
  it('a throwing screen shows the ErrorPanel, logs tui.crash once and Back calls onBack', async () => {
    const onBack = vi.fn();
    const onCrash = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = render(<TuiCrashBoundary where="screen" onBack={onBack} onCrash={onCrash}><Boom /></TuiCrashBoundary>);
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain('This screen stopped with an error');
    expect(frame).toContain('row index out of range.');
    expect(frame).not.toContain('at Boom');
    expect(logged.filter((l) => l.code === 'tui.crash')).toHaveLength(1);
    expect(onCrash).toHaveBeenCalledTimes(1);
    r.stdin.write('\r'); // What now: Back
    await tick();
    expect(onBack).toHaveBeenCalledTimes(1);
    r.unmount();
    spy.mockRestore();
  });

  it('CrashPanel outside a frame draws its key hints and guidance box itself', async () => {
    const r = render(<CrashPanel report={{ origin: 'render', errorClass: 'Error', message: 'x', stackTop: [], logPath: null }} where="step" onBack={() => {}} />);
    await tick();
    expect(r.lastFrame()).toContain('This setup step stopped with an error');
    expect(r.lastFrame()).toContain('Ctrl+G for guidance');
    r.unmount();
  });
});
