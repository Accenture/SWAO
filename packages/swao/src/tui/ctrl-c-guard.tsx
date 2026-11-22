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

// #4379 (Design 126 section 7.11): Ctrl+C asks before SWAO quits.
//
// Windows Terminal copies on Ctrl+C only while text is selected; without a
// selection the key reaches SWAO. Ink used to end the app on the first Ctrl+C
// (exitOnCtrlC), so a chat conversation or a half-finished wizard step was
// lost. Now the first Ctrl+C shows "Press Ctrl+C again to quit SWAO" on the
// last row of the frame; a second Ctrl+C within 2 seconds quits (exit cause
// ctrl_c, #4345); any other key clears the prompt and works as usual.
//
// The guard sits where Ink reads its input (`stdin.read()`, the same place
// as the #4345 watcher): every Ctrl+C byte is taken out of the chunk before
// Ink parses it, so no screen handler ever sees Ctrl+C as the letter c and
// the rule holds on every screen without a per-screen change.

import { useEffect, useState } from 'react';
import { Text, useInput } from 'ink';
import { tone } from '@swao/tui-kit';
import { markTuiExitCause } from './crash-report.js';

export const CTRL_C_PROMPT = 'Press Ctrl+C again to quit SWAO';
export const CTRL_C_WINDOW_MS = 2000;

const CTRL_C = '\u0003';

type Listener = (armed: boolean) => void;

export interface CtrlCGuardOptions {
  /** Ends the TUI (run-app.ts: Ink unmount, then the alternate screen is left). */
  onQuit: () => void;
  windowMs?: number;
  /** Clock (tests). */
  now?: () => number;
  /** Timer to hide the prompt after the window (tests may pass a no-op). */
  schedule?: (fn: () => void, ms: number) => () => void;
}

export interface CtrlCGuard {
  /** One Ctrl+C: arms the prompt, or quits when it is armed and inside the window. */
  press(): 'armed' | 'quit';
  /** Any other key: clears the prompt. */
  otherKey(): void;
  armed(): boolean;
  subscribe(listener: Listener): () => void;
  dispose(): void;
}

function defaultSchedule(fn: () => void, ms: number): () => void {
  const t = setTimeout(fn, ms);
  if (typeof (t as { unref?: () => void }).unref === 'function') (t as { unref: () => void }).unref();
  return () => clearTimeout(t);
}

export function createCtrlCGuard(opts: CtrlCGuardOptions): CtrlCGuard {
  const windowMs = opts.windowMs ?? CTRL_C_WINDOW_MS;
  const now = opts.now ?? Date.now;
  const schedule = opts.schedule ?? defaultSchedule;
  const listeners = new Set<Listener>();
  let armedAt: number | null = null;
  let cancelTimer: (() => void) | null = null;
  let quit = false;

  const emit = (): void => {
    const a = armedAt !== null;
    for (const l of listeners) {
      try { l(a); } catch { /* a listener never breaks the guard */ }
    }
  };
  const clear = (): void => {
    if (cancelTimer) { cancelTimer(); cancelTimer = null; }
    if (armedAt !== null) { armedAt = null; emit(); }
  };

  return {
    press() {
      if (quit) return 'quit';
      const t = now();
      if (armedAt !== null && t - armedAt <= windowMs) {
        quit = true;
        if (cancelTimer) { cancelTimer(); cancelTimer = null; }
        armedAt = null;
        emit();
        markTuiExitCause('ctrl_c');
        try { opts.onQuit(); } catch { /* best-effort */ }
        return 'quit';
      }
      if (cancelTimer) cancelTimer();
      armedAt = t;
      cancelTimer = schedule(() => { cancelTimer = null; if (armedAt !== null) { armedAt = null; emit(); } }, windowMs);
      emit();
      return 'armed';
    },
    otherKey() { clear(); },
    armed() { return armedAt !== null; },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      if (cancelTimer) { cancelTimer(); cancelTimer = null; }
      listeners.clear();
    },
  };
}

/** The guard of the running TUI; the prompt line subscribes to it. */
let activeGuard: CtrlCGuard | null = null;

export function activeCtrlCGuard(): CtrlCGuard | null {
  return activeGuard;
}

/**
 * Patches `stdin.read` so every Ctrl+C byte goes to the guard and never to
 * Ink; the rest of the chunk passes on unchanged (a paste keeps working).
 * A chunk that held only Ctrl+C is skipped: the next chunk is read, so Ink's
 * read loop never sees an empty chunk. Returns the function that restores
 * the original read and clears the active guard.
 */
export function installCtrlCGuard(stdin: { read: (size?: number) => unknown }, guard: CtrlCGuard): () => void {
  const original = stdin.read;
  activeGuard = guard;
  stdin.read = function guardedRead(this: unknown, size?: number): unknown {
    for (;;) {
      const chunk = original.call(this, size);
      if (chunk === null || chunk === undefined) return chunk;
      const text = typeof chunk === 'string' ? chunk : String(chunk);
      if (!text.includes(CTRL_C)) {
        if (text.length > 0) guard.otherKey();
        return chunk;
      }
      let rest = '';
      for (const ch of text) {
        if (ch === CTRL_C) guard.press();
        else rest += ch;
      }
      if (rest.length > 0) {
        guard.otherKey();
        return typeof chunk === 'string' ? rest : Buffer.from(rest, 'utf8');
      }
    }
  };
  return () => {
    stdin.read = original;
    if (activeGuard === guard) activeGuard = null;
  };
}

/** True while the quit prompt shows. */
export function useCtrlCArmed(guard: CtrlCGuard | null = activeCtrlCGuard()): boolean {
  const [armed, setArmed] = useState<boolean>(() => guard?.armed() ?? false);
  useEffect(() => {
    if (!guard) return undefined;
    setArmed(guard.armed());
    return guard.subscribe(setArmed);
  }, [guard]);
  return armed;
}

/** The prompt line for the last row of the TerminalFrame (App.tsx). */
export function CtrlCQuitLine(): JSX.Element {
  return <Text {...tone('warning')}>{CTRL_C_PROMPT}</Text>;
}

/**
 * Keeps one input listener active for the whole TUI, so raw mode stays on
 * and a Ctrl+C always reaches the guard rather than ending the process as a
 * terminal interrupt (a screen without a key handler of its own).
 */
export function CtrlCRawMode(): null {
  useInput(() => { /* the guard reads Ctrl+C in stdin.read */ });
  return null;
}

/** Test hook. */
export function resetCtrlCGuard(): void {
  activeGuard = null;
}

