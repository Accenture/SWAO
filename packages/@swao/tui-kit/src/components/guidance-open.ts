// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, guidance box open state
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4394 (Design 126 section 7.8, #4230): the one owner of "is a guidance box
// open". Before, the Setup Wizard kept a module flag of its own next to the
// state the assessment flows kept in GuidanceBox and useFlowNavigation. Now:
//
//   - a screen or flow that draws a guidance box owns one state
//     (`useGuidanceOpenOwner`, or `useFlowNavigation`, which creates one or
//     takes the one it is given) and provides it with `GuidanceOpenContext`
//     around everything that may draw a box or read the state;
//   - every GuidanceBox reports its open state to the nearest provider;
//   - a step or embedded screen reads it with `useGuidanceOpen()` at key
//     time (`isOpen()`), never from a copy of its own.
//
// An open box owns Esc, PgUp and PgDn only (`guidanceOwnsKey`); every other
// key still reaches the screen. Outside any provider (a step rendered on its
// own, a test), `useGuidanceOpen()` returns the default state that the box of
// that step reports to through `onOpenChange`.

import { createContext, useContext, useRef } from 'react';

/** The open state of the guidance box of one screen or flow. */
export interface GuidanceOpenState {
  /** Whether a guidance box of this owner is expanded; read at key time. */
  isOpen(): boolean;
  /** Set by the box (GuidanceBox reports it; pass it as `onOpenChange` where no provider is). */
  setOpen(open: boolean): void;
  /** Called on every change with the new value; returns the unsubscribe. */
  subscribe(listener: (open: boolean) => void): () => void;
}

export function createGuidanceOpenState(): GuidanceOpenState {
  let open = false;
  const listeners = new Set<(open: boolean) => void>();
  return {
    isOpen: () => open,
    setOpen: (next: boolean) => {
      if (next === open) return;
      open = next;
      for (const l of [...listeners]) l(next);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** Provided by the owner around its content; GuidanceBox reports to it. */
export const GuidanceOpenContext = createContext<GuidanceOpenState | null>(null);

/** The state outside any provider: one screen renders at a time. */
const DEFAULT_GUIDANCE_OPEN = createGuidanceOpenState();

/** For the owner: one state per mounted component, stable across renders. */
export function useGuidanceOpenOwner(): GuidanceOpenState {
  const ref = useRef<GuidanceOpenState | null>(null);
  if (ref.current === null) ref.current = createGuidanceOpenState();
  return ref.current;
}

/** For a reader: the state of the nearest owner, else the default state. */
export function useGuidanceOpen(): GuidanceOpenState {
  return useContext(GuidanceOpenContext) ?? DEFAULT_GUIDANCE_OPEN;
}
