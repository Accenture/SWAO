// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, the key and navigation model of a step flow
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4251 (TUI-07, Design 126 sections 5.2 and 7): one implementation of the
// navigation of every flow, replacing the per-screen Esc handlers and
// useCaptureEscape of step-ui.tsx.
//
// Key owners (Ink hands every key to every useInput, so each key has one):
//   - Enter belongs to the step content (SelectInput onSelect, TextInput
//     onSubmit, ConfirmPanel), which calls `next()`. On the last step
//     `next()` is `finish()`: back to the main menu (section 7.3).
//   - Left arrow: back to the previous step, values kept (section 7.2). In a
//     text input the left arrow moves the text cursor, so `textInput: true`
//     leaves it to the field and Shift+Tab goes back (Q-10 decided).
//   - Right arrow: forward to a step completed in this pass (section 7.3).
//   - Esc, in the order of section 7.5: an open guidance box closes (the box
//     takes the key; pass `onGuidanceOpenChange` to it); an open AbortDialog
//     closes (the dialog takes the key); a running process is cancelled (the
//     RunPanel takes the key; `running: true` hands Esc and the arrows to it);
//     otherwise the flow aborts: at once when nothing would be lost, after
//     the AbortDialog when `dirty` (section 7.4).
// While the dialog is open the content must not read Enter: pass
// `contentActive` as the `active` prop of the step's input.
//
// The hook keeps the step index only; the entered values stay in the
// screen's flow state, so going back and forth keeps them.

import { useCallback, useMemo, useRef, useState } from 'react';
import { useInput, type Key } from 'ink';
import { AbortDialog } from '../components/AbortDialog.js';
import { KEY_HINTS, type KeyHint } from '../components/KeyHints.js';
import { useGuidanceOpenOwner, type GuidanceOpenState } from '../components/guidance-open.js';

/** What an Esc abort leaves: a setup flow, an assessment flow, or SWAO itself (main menu, Q-03). */
export type FlowAbortKind = 'setup' | 'assessment' | 'exit';

/** The kind of input of the current step, for its standard hint line (section 7.9). */
export type FlowStepKind = 'picker' | 'multiSelect' | 'textInput' | 'confirm' | 'menu';

export interface FlowNavigationOptions {
  /** Step bar labels; their count is the number of steps. */
  steps: readonly string[];
  /** True when the flow holds input that an abort would lose. */
  dirty: boolean;
  /** Leave the flow to the main menu (Esc abort, and finish unless `onFinish` is given). */
  onExit(): void;
  /** Enter on the last step; default `onExit`. */
  onFinish?(): void;
  /** Which question the abort dialog asks; default `setup`. */
  what?: FlowAbortKind;
  /** First step shown; default 0. */
  initialStep?: number;
  /** The current step is a text input: left and right arrows belong to the field. */
  textInput?: boolean;
  /** A run is in progress: RunPanel owns Esc, the arrows do nothing. */
  running?: boolean;
  /** Keys are read only while active (default true). */
  active?: boolean;
  /**
   * #4341: the Right arrow moves forward to a completed step (default true).
   * The Setup Wizard passes false: a step that writes on its own completion
   * (LZ targets, intake) must not be left forward without it.
   */
  arrowForward?: boolean;
  /**
   * #4394: the guidance open state of the screen (guidance-open.ts). A screen
   * that provides one to its content (the Setup Wizard) passes it, so Esc reads
   * the state its steps read; without it the flow owns one of its own.
   */
  guidance?: GuidanceOpenState;
}

export interface FlowNavigation {
  /** Index of the current step. */
  current: number;
  /** Furthest step reached in this pass; every step before it is completed. */
  reached: number;
  isFirst: boolean;
  isLast: boolean;
  /** Enter: confirm the step and move on; on the last step, finish. */
  next(): void;
  /** Previous step, values kept; nothing on the first step. */
  back(): void;
  /** Next step when it was completed in this pass. */
  forward(): void;
  /** Leave the flow to the main menu after its last step. */
  finish(): void;
  /** Jump to a step reached in this pass (for example the step that started a cancelled run). */
  goTo(step: number): void;
  /** Esc without a guidance box or run: abort at once, or ask when dirty. */
  requestAbort(): void;
  /** True while the AbortDialog is shown. */
  dialogOpen: boolean;
  /** False while the dialog is shown: pass as `active` to the step's input. */
  contentActive: boolean;
  /** The AbortDialog while it is open; render it in the content block. */
  dialog: JSX.Element | null;
  /** Pass to the guidance box (`onOpenChange`), so Esc closes the box first. */
  onGuidanceOpenChange(open: boolean): void;
  /** #4394: the guidance open state the flow reads (`opts.guidance` or its own). */
  guidance: GuidanceOpenState;
  /** The standard hint line of the current step (section 7.9): no back on the first step, finish on the last. */
  hints(kind: FlowStepKind): readonly KeyHint[];
}

const withoutBack = (hints: readonly KeyHint[]): readonly KeyHint[] =>
  hints.filter((h) => h.verb !== 'back');

export function useFlowNavigation(opts: FlowNavigationOptions): FlowNavigation {
  const total = Math.max(1, opts.steps.length);
  const start = Math.max(0, Math.min(opts.initialStep ?? 0, total - 1));
  const [current, setCurrent] = useState(start);
  const [reached, setReached] = useState(start);
  const [dialogOpen, setDialogOpen] = useState(false);
  // #4394: the open state of the guidance box, owned in guidance-open.ts.
  const ownGuidance = useGuidanceOpenOwner();
  const guidance = opts.guidance ?? ownGuidance;
  const guidanceRef = useRef(guidance);
  guidanceRef.current = guidance;

  // Current values for the stable callbacks and the single input listener.
  const live = useRef({ opts, current, reached, total, dialogOpen });
  live.current = { opts, current, reached, total, dialogOpen };

  const finish = useCallback((): void => {
    const o = live.current.opts;
    (o.onFinish ?? o.onExit)();
  }, []);

  const next = useCallback((): void => {
    const { current: cur, total: n } = live.current;
    if (cur >= n - 1) { finish(); return; }
    const to = cur + 1;
    live.current.current = to;
    setCurrent(to);
    setReached((r) => Math.max(r, to));
  }, [finish]);

  const back = useCallback((): void => {
    const cur = live.current.current;
    if (cur <= 0) return;
    live.current.current = cur - 1;
    setCurrent(cur - 1);
  }, []);

  const forward = useCallback((): void => {
    const { current: cur, reached: r } = live.current;
    if (cur >= r) return;
    live.current.current = cur + 1;
    setCurrent(cur + 1);
  }, []);

  const goTo = useCallback((step: number): void => {
    const { reached: r } = live.current;
    const to = Math.max(0, Math.min(step, r));
    live.current.current = to;
    setCurrent(to);
  }, []);

  const requestAbort = useCallback((): void => {
    if (live.current.opts.dirty) {
      live.current.dialogOpen = true;
      setDialogOpen(true);
    } else {
      live.current.opts.onExit();
    }
  }, []);

  const onGuidanceOpenChange = useCallback((open: boolean): void => { guidanceRef.current.setOpen(open); }, []);

  useInput(useCallback((_input: string, key: Key) => {
    const { opts: o, dialogOpen: open } = live.current;
    if (open) return; // the AbortDialog owns Enter and Esc
    if (o.running) return; // the RunPanel owns Esc; no navigation during a run
    if (key.escape) {
      if (guidanceRef.current.isOpen()) return; // the guidance box closes first
      requestAbort();
      return;
    }
    if (key.tab && key.shift) { back(); return; }
    if (o.textInput) return; // the arrows move the text cursor
    if (key.leftArrow) back();
    else if (key.rightArrow && (o.arrowForward ?? true)) forward();
  }, [back, forward, requestAbort]), { isActive: opts.active ?? true });

  // The ref keeps "open" until the next render, so the Esc or Enter that
  // closes the dialog is not read a second time by the flow listener,
  // whatever the listener order.
  const stay = useCallback((): void => { setDialogOpen(false); }, []);
  const abort = useCallback((): void => {
    setDialogOpen(false);
    live.current.opts.onExit();
  }, []);

  const isFirst = current === 0;
  const isLast = current >= total - 1;
  const hints = useCallback((kind: FlowStepKind): readonly KeyHint[] => {
    if (kind === 'menu') return KEY_HINTS.menu;
    if (isLast && kind !== 'textInput' && kind !== 'confirm') return KEY_HINTS.lastStep;
    const line = KEY_HINTS[kind];
    return isFirst ? withoutBack(line) : line;
  }, [isFirst, isLast]);

  const what = opts.what ?? 'setup';
  const dialog = useMemo(
    () => (dialogOpen ? <AbortDialog what={what} onAbort={abort} onStay={stay} /> : null),
    [dialogOpen, what, abort, stay],
  );

  return {
    current, reached, isFirst, isLast,
    next, back, forward, finish, goTo, requestAbort,
    dialogOpen, contentActive: !dialogOpen && (opts.active ?? true), dialog,
    onGuidanceOpenChange, guidance, hints,
  };
}
