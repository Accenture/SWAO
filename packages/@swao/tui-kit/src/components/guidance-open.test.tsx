// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, guidance box open state (#4394)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4394: one owner of the guidance open state. A GuidanceBox reports to the
// nearest GuidanceOpenContext; a reader takes it with useGuidanceOpen; a flow
// given the state (useFlowNavigation `guidance`) lets an open box take Esc.

import { describe, it, expect, vi } from 'vitest';
import { Text } from 'ink';
import { renderAt } from '../testing/render-at.js';
import { GuidanceBox } from './GuidanceBox.js';
import { GuidanceOpenContext, createGuidanceOpenState, useGuidanceOpen, type GuidanceOpenState } from './guidance-open.js';
import { useFlowNavigation } from '../hooks/useFlowNavigation.js';

const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));
const CTRL_G = String.fromCharCode(7);
const ESC = String.fromCharCode(27);

describe('createGuidanceOpenState (#4394)', () => {
  it('starts closed, notifies subscribers on a change only, and unsubscribes', () => {
    const s = createGuidanceOpenState();
    const seen: boolean[] = [];
    const off = s.subscribe((o) => seen.push(o));
    expect(s.isOpen()).toBe(false);
    s.setOpen(false);
    s.setOpen(true);
    s.setOpen(true);
    s.setOpen(false);
    off();
    s.setOpen(true);
    expect(seen).toEqual([true, false]);
    expect(s.isOpen()).toBe(true);
  });
});

describe('GuidanceBox reports to the nearest owner (#4394)', () => {
  it('Ctrl+G and Esc set the provided state; unmount closes it; a reader sees the same state', async () => {
    const state = createGuidanceOpenState();
    let reader: GuidanceOpenState | undefined;
    function Reader(): JSX.Element { reader = useGuidanceOpen(); return <Text>reader</Text>; }
    const r = renderAt(
      <GuidanceOpenContext.Provider value={state}>
        <Reader />
        <GuidanceBox title="Box" what="Explanation." />
      </GuidanceOpenContext.Provider>, 100,
    );
    await tick();
    expect(reader).toBe(state);
    expect(state.isOpen()).toBe(false);
    r.stdin.write(CTRL_G);
    await tick();
    expect(state.isOpen()).toBe(true);
    r.stdin.write(ESC);
    await tick();
    expect(state.isOpen()).toBe(false);
    r.stdin.write(CTRL_G);
    await tick();
    expect(state.isOpen()).toBe(true);
    r.unmount();
    await tick();
    expect(state.isOpen()).toBe(false);
  });

  it('useFlowNavigation given the state: Esc with the box open closes the box, the next Esc aborts', async () => {
    const state = createGuidanceOpenState();
    const onExit = vi.fn();
    function Flow(): JSX.Element {
      const nav = useFlowNavigation({ steps: ['One'], dirty: false, onExit, guidance: state });
      expect(nav.guidance).toBe(state);
      return (
        <GuidanceOpenContext.Provider value={state}>
          <GuidanceBox title="Box" what="Explanation." />
        </GuidanceOpenContext.Provider>
      );
    }
    const r = renderAt(<Flow />, 100);
    await tick();
    r.stdin.write(CTRL_G);
    await tick();
    expect(state.isOpen()).toBe(true);
    r.stdin.write(ESC);
    await tick();
    expect(state.isOpen()).toBe(false);
    expect(onExit).not.toHaveBeenCalled();
    r.stdin.write(ESC);
    await tick();
    expect(onExit).toHaveBeenCalledTimes(1);
    r.unmount();
  });
});
