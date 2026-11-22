// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, a load that runs after the first frame
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4484 (Design 126 section 7.12): a screen draws before a workspace scan.
// The scan is synchronous (file reads), so running it in a useMemo blocks the
// first frame; in the packaged binary that is seconds on a large workspace.
// useAfterFirstFrame runs the load in a timer after the first frame was
// written, and exposes the value one more timer later, so keys typed while
// the scan blocked the event loop reach the loading frame (and are dropped
// there) instead of the list drawn after it.

import { useEffect, useState, type DependencyList } from 'react';

/** Delay before the load; lets the terminal flush the first frame (TTY writes are asynchronous on Windows). */
export const FIRST_FRAME_DELAY_MS = 40;

/**
 * The value of `load`, computed after the first frame; `null` while loading.
 * `deps` re-run the load (the value goes back to `null` meanwhile).
 */
export function useAfterFirstFrame<T>(load: () => T, deps: DependencyList): T | null {
  const [state, setState] = useState<{ value: T; ready: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    let settle: ReturnType<typeof setTimeout> | undefined;
    setState(null);
    const start = setTimeout(() => {
      if (!alive) return;
      const value = load();
      setState({ value, ready: false });
      // Keys buffered during the load arrive in the next poll phase, before this timer.
      settle = setTimeout(() => { if (alive) setState({ value, ready: true }); }, 0);
    }, FIRST_FRAME_DELAY_MS);
    return () => { alive = false; clearTimeout(start); if (settle) clearTimeout(settle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state && state.ready ? state.value : null;
}

/** #4484: the line of an app list while the workspace apps load (the app pickers, the Publish app step). */
export const APPS_LOADING_LINE = 'Loading apps';
