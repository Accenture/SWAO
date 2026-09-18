// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library -- mouse escape-sequence classifier tests
//  (#1082 / #1378 / #1387)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { classifyMouseInput, MouseReportingManager, ENABLE_MOUSE_REPORTING, DISABLE_MOUSE_REPORTING } from './mouse.js';

// X10: ESC [ M cb cx cy where cb = 32 + button code.
const x10 = (button: number, x = 33, y = 33): string =>
  `\x1b[M${String.fromCharCode(32 + button)}${String.fromCharCode(x)}${String.fromCharCode(y)}`;

// SGR: ESC [ < b ; x ; y M (press) or m (release).
const sgr = (button: number, final: 'M' | 'm' = 'M'): string => `\x1b[<${button};10;5${final}`;

describe('classifyMouseInput', () => {
  it('returns null for ordinary keyboard input', () => {
    expect(classifyMouseInput('a')).toBeNull();
    expect(classifyMouseInput(' ')).toBeNull();
    expect(classifyMouseInput('')).toBeNull();
  });

  it('returns null for non-mouse escape sequences (arrow keys)', () => {
    expect(classifyMouseInput('\x1b[A')).toBeNull(); // up arrow
    expect(classifyMouseInput('\x1b[B')).toBeNull(); // down arrow
  });

  it('classifies X10 wheel up and wheel down', () => {
    expect(classifyMouseInput(x10(64))).toBe('wheel-up');
    expect(classifyMouseInput(x10(65))).toBe('wheel-down');
  });

  it('classifies SGR wheel up and wheel down', () => {
    expect(classifyMouseInput(sgr(64))).toBe('wheel-up');
    expect(classifyMouseInput(sgr(65))).toBe('wheel-down');
  });

  it('classifies clicks and releases as noise, never navigation', () => {
    expect(classifyMouseInput(x10(0))).toBe('noise');   // left press
    expect(classifyMouseInput(x10(3))).toBe('noise');   // release
    expect(classifyMouseInput(sgr(0))).toBe('noise');   // left press
    expect(classifyMouseInput(sgr(0, 'm'))).toBe('noise'); // left release
  });

  it('classifies motion reports as noise (#1378 flicker driver)', () => {
    // Motion flag is bit 5 (32); moving with no button = 32 + 3 = 35.
    expect(classifyMouseInput(x10(35))).toBe('noise');
    expect(classifyMouseInput(sgr(35))).toBe('noise');
    // Wheel bit combined with motion flag stays noise.
    expect(classifyMouseInput(sgr(64 + 32))).toBe('noise');
  });

  it('classifies truncated chunks as noise instead of leaking bytes', () => {
    expect(classifyMouseInput('\x1b[M')).toBe('noise');
    expect(classifyMouseInput('\x1b[<64;10')).toBe('noise');
  });
});

describe('MouseReportingManager (#1391)', () => {
  it('writes enable on first acquire and disable on last release only', () => {
    const writes: string[] = [];
    const mgr = new MouseReportingManager((s) => writes.push(s));
    const r1 = mgr.acquire();
    const r2 = mgr.acquire();
    expect(writes).toEqual([ENABLE_MOUSE_REPORTING]);
    r1();
    expect(writes).toEqual([ENABLE_MOUSE_REPORTING]);
    r2();
    expect(writes).toEqual([ENABLE_MOUSE_REPORTING, DISABLE_MOUSE_REPORTING]);
    expect(mgr.activeCount).toBe(0);
  });

  it('double-release is a no-op (unmount + strict-mode double effects)', () => {
    const writes: string[] = [];
    const mgr = new MouseReportingManager((s) => writes.push(s));
    const r1 = mgr.acquire();
    r1();
    r1();
    expect(mgr.activeCount).toBe(0);
    expect(writes).toEqual([ENABLE_MOUSE_REPORTING, DISABLE_MOUSE_REPORTING]);
  });

  it('restoreOnExit disables when acquisitions are live and is idempotent', () => {
    const writes: string[] = [];
    const mgr = new MouseReportingManager((s) => writes.push(s));
    mgr.acquire();
    mgr.acquire();
    mgr.restoreOnExit();
    mgr.restoreOnExit();
    expect(writes).toEqual([ENABLE_MOUSE_REPORTING, DISABLE_MOUSE_REPORTING]);
    expect(mgr.activeCount).toBe(0);
  });

  it('re-acquire after full release re-enables', () => {
    const writes: string[] = [];
    const mgr = new MouseReportingManager((s) => writes.push(s));
    const r1 = mgr.acquire();
    r1();
    mgr.acquire();
    expect(writes).toEqual([ENABLE_MOUSE_REPORTING, DISABLE_MOUSE_REPORTING, ENABLE_MOUSE_REPORTING]);
  });
});
