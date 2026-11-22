// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module, run state of the Application and LZ Catalog run screens
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4256 (TUI-12, Design 126 section 4.6, A-20): the run screens of the
// Application and LZ Catalog flows show the stage name, and the guidance box
// follows the run state: preparing (clone, catalogue load), then the pass or
// target that runs now. Pure functions, so the stage label and the guidance
// text are tested without a child process.

import { normalizeRunDashes, type GuidanceEntry, type StageProgressProps } from '@swao/tui-kit';
import type { PostStepLine } from '@swao/core';
import { PASS_DESCRIPTIONS } from './passDescriptions.js';

export type RunKind = 'application' | 'landing-zone';

export interface RunState {
  kind: RunKind;
  app: string;
  /** Current pass (Application: "context_ingestion"; LZ Catalog: the `[pass]` token). Empty while preparing. */
  passName: string;
  /** Sub-progress of the pass ("BSI_C5 (3/7)") or the LZ target; empty when none. */
  passSubLabel: string;
  /** Passes (Application) or targets (LZ Catalog) finished. */
  completed: number;
  /** Passes (Application) or targets (LZ Catalog) of the run. */
  total: number;
  /** #4498: the post-pass step that runs after the last pass ("[post] Portfolio summary: 106 of 235 apps"). */
  postStep?: PostStepLine | null;
}

/** A pass id in words: "context_ingestion" reads "context ingestion". */
export function passWords(passName: string): string {
  return passName.split('_').join(' ');
}

/** "BSI_C5 (3/7)": the done and total counts of the sub-progress, else null. */
export function subProgress(sub: string): { done: number; total: number } | null {
  const open = sub.lastIndexOf('(');
  const close = sub.lastIndexOf(')');
  if (open < 0 || close < open) return null;
  const parts = sub.slice(open + 1, close).split('/');
  if (parts.length !== 2) return null;
  const done = Number(parts[0]);
  const total = Number(parts[1]);
  return Number.isInteger(done) && Number.isInteger(total) && total > 0 ? { done, total } : null;
}

/** The title of the run panel (block 4): what the run does. */
export function runTitle(s: Pick<RunState, 'kind' | 'app'>): string {
  return s.kind === 'application' ? `Assessing ${s.app}` : `Fitting ${s.app} to the landing zone catalogue`;
}

/** The stage bar of the run: stage n of the passes (or targets) and the stage name. */
export function runStage(s: RunState, elapsedMs: number): StageProgressProps {
  const stages = Math.max(1, s.total);
  // #4498: after the last pass the stage names the post-pass step and its progress.
  if (s.postStep) {
    const p = s.postStep;
    const counted = p.done !== undefined && p.total !== undefined;
    const label = counted ? `${p.label}: ${p.done} of ${p.total} ${p.noun ?? 'items'}` : p.label;
    return {
      stage: stages, stages, label: normalizeRunDashes(`Finishing, ${label}`), elapsedMs,
      ...(counted ? { itemsDone: p.done!, itemsTotal: p.total!, itemsLabel: 'Apps', itemsNoun: p.noun ?? 'items' } : {}),
    };
  }
  const stage = Math.min(stages, s.completed + 1);
  const preparing = s.passName === '';
  const sub = s.passSubLabel.trim();
  const label = preparing
    ? (s.kind === 'application' ? 'Preparing: cloning the source and preparing the passes' : 'Preparing: loading the catalogue and the app inputs')
    : `${s.kind === 'application' ? 'Pass ' : ''}${passWords(s.passName)}${sub ? `, ${sub}` : ''}`;
  const items = preparing ? null : subProgress(sub);
  return {
    stage, stages, label: normalizeRunDashes(label), elapsedMs,
    ...(items ? { itemsDone: items.done, itemsTotal: items.total, itemsLabel: 'Steps', itemsNoun: 'steps of this pass' } : {}),
  };
}

/** The guidance entry of the run (section 4.6: the box follows the run state). */
export function runGuidance(s: RunState): GuidanceEntry {
  const { cli } = { cli: s.kind === 'application' ? `swao assess --app ${s.app}` : `swao assess --type landing-zone --app ${s.app}` };
  if (s.passName === '') {
    return s.kind === 'application'
      ? { title: 'Preparing the run', what: 'SWAO clones or reads the source of the app and prepares the selected passes. The first pass starts in a few seconds.', sections: [{ label: 'Cancel', text: 'Esc asks first; the passes finished so far stay in the run folder.' }], cli }
      : { title: 'Preparing the run', what: 'SWAO loads the landing zone catalogue of the selected targets and the inputs of the app. The first target starts in a few seconds.', sections: [{ label: 'Cancel', text: 'Esc asks first; the targets finished so far stay in the run folder.' }], cli };
  }
  if (s.postStep) {
    const p = s.postStep;
    return {
      title: `Finishing: ${p.label}`,
      what: p.label === 'Portfolio summary'
        ? 'All passes are done. SWAO rebuilds the portfolio summary of the workspace (every app, unchanged apps from the cache) so the portfolio views include this run.'
        : 'All passes are done. SWAO writes the run outputs (manifest, findings, plan) before the run closes.',
      sections: [{ label: 'Progress', text: p.done !== undefined && p.total !== undefined ? `${p.done} of ${p.total} ${p.noun ?? 'items'}` : `${s.completed} of ${Math.max(1, s.total)} passes finished` }],
      cli,
    };
  }
  if (s.kind === 'landing-zone') {
    const sub = s.passSubLabel.trim();
    return {
      title: `Running: ${passWords(s.passName)}`,
      what: `SWAO compares the services the app needs with the landing zone catalogue${sub ? ` (${sub})` : ''} and records a verdict per target: ready, needs verification or blocked.`,
      sections: [{ label: 'Progress', text: `${s.completed} of ${Math.max(1, s.total)} targets finished` }],
      cli,
    };
  }
  const desc = PASS_DESCRIPTIONS[s.passName];
  const sections = [
    { label: 'Progress', text: `${s.completed} of ${Math.max(1, s.total)} passes finished` },
    ...(desc?.tip ? [{ label: 'Tip', text: normalizeRunDashes(desc.tip) }] : []),
  ];
  return {
    title: `Running: Pass ${passWords(s.passName)}`,
    what: desc ? normalizeRunDashes(desc.summary) : 'Each pass analyses a different dimension of the workload; its results go to the run folder.',
    sections,
    cli,
  };
}
