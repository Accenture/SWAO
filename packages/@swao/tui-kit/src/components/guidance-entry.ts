// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, guidance entries per sub-step and option
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4249 / #4250 (Design 126 sections 5.2 and 9): the content of the guidance
// box. A step passes one entry per sub-step and an optional entry per picker
// option (`SelectOption.guidance`, `MultiSelectOption.guidance`); the box
// renders the entry of the current sub-step or of the highlighted option
// (#4230). `useOptionGuidance` is the glue a screen uses: it hands the picker
// an `onCursorChange` and returns the entry the box shows.

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/** One inline section of the expanded box: "Requirement: at least one run." */
export interface GuidanceSection {
  label: string;
  text: string;
}

/** The guidance of one sub-step or one option (Design 126 section 5.2). */
export interface GuidanceEntry {
  /** Step or sub-step name; the same words as the step bar and the header. */
  title: string;
  /** Plain explanation; three lines at 100 columns, four at 80 (Q-02). */
  what: string;
  /** Inline sections ("Requirement", "Next"); label and text on one line. */
  sections?: readonly GuidanceSection[];
  /** The CLI equivalent, rendered as the last explanation line "CLI: ...". */
  cli?: string;
}

/** An option that may carry its own guidance entry. */
export interface GuidedOption {
  value: string;
  guidance?: GuidanceEntry;
}

/**
 * The guidance entry that follows the picker cursor (#4230). Pass the returned
 * `onCursorChange` to `SelectInput` or `MultiSelect` and the returned `entry`
 * to the guidance box; an option without its own entry shows `fallback` (the
 * entry of the sub-step).
 */
export function useOptionGuidance(fallback: GuidanceEntry): {
  entry: GuidanceEntry;
  onCursorChange: (value: string, option?: GuidedOption) => void;
} {
  const [optionEntry, setOptionEntry] = useState<GuidanceEntry | undefined>(undefined);
  const onCursorChange = useCallback((_value: string, option?: GuidedOption) => {
    setOptionEntry(option?.guidance);
  }, []);
  return { entry: optionEntry ?? fallback, onCursorChange };
}

/**
 * #4230: what identifies the highlighted option for the guidance box: its value
 * and its entry. A picker notifies `onCursorChange` whenever this changes, so
 * options that arrive after the first render, or a new sub-step whose options
 * reuse the same values with other entries, update the box without a key press.
 */
export function optionGuidanceKey(option: GuidedOption | undefined): string {
  if (!option) return '';
  const g = option.guidance;
  return g ? `${option.value}|${g.title}|${g.what}` : option.value;
}

/** The keys `guidanceOwnsKey` looks at (a subset of Ink's `Key`). */
export interface GuidanceKey {
  escape?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
}

/**
 * #4230 (Design 126 section 7.8): the keys an open guidance box takes from the
 * screen. An expanded box owns Esc (it closes the box) and PgUp and PgDn (they
 * page its sections); every other key (arrows, number keys, Space, Enter,
 * letters) still reaches the screen, so the list keeps moving and the box
 * follows the highlighted option. A collapsed box owns no key besides Ctrl+G,
 * which no screen handles. Screens guard their input with
 * `if (guidanceOwnsKey(key, open)) return;` instead of ignoring every key while
 * the box is open.
 */
export function guidanceOwnsKey(key: GuidanceKey, open: boolean): boolean {
  if (!open) return false;
  return key.escape === true || key.pageUp === true || key.pageDown === true;
}

/**
 * #4342 (Design 126 section 3, block 8): a frame that draws a fallback
 * guidance box (the Setup Wizard draws the registry guidance of a step that
 * reports none) must know whether its content already renders a box of its
 * own, or the screen shows two boxes and Ctrl+G toggles both. Every
 * GuidanceBox reports its mount to the nearest provider; the frame provides
 * the context around its content only, so its own box does not count.
 */
export type GuidancePresenceReport = (delta: 1 | -1) => void;
export const GuidancePresenceContext = createContext<GuidancePresenceReport | null>(null);

/** Called by GuidanceBox: counts the box while it is mounted. */
export function useReportGuidancePresence(): void {
  const report = useContext(GuidancePresenceContext);
  useEffect(() => {
    if (!report) return undefined;
    report(1);
    return () => report(-1);
  }, [report]);
}

/** For a frame: whether the content renders a guidance box, and the report to provide. */
export function useGuidancePresence(): { present: boolean; report: GuidancePresenceReport } {
  const [count, setCount] = useState(0);
  const report = useCallback<GuidancePresenceReport>((delta) => setCount((c) => Math.max(0, c + delta)), []);
  return { present: count > 0, report };
}
