// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4256 (TUI-12, Design 126 section 4.7): the finish screen of the Landing Zone
// Live Assessment on FinishPanel. The done actions of #3589, #3830, #3885 and
// #3956 are What next entries (were the number keys 1 to 6 on a hand-drawn
// list); the run folder, the scopes and the baseline and organisational
// summaries are rows. Pure; the screen renders the view.

import { LIVE_DONE_ACTIONS, type LiveDoneAction } from './lz-live-flow.js';

/** The What next entry that shows the output of the run. */
export const LIVE_SHOW_OUTPUT = 'output';

export interface LiveFinishInput {
  lzLabel: string;
  scopes: readonly string[];
  frameworks: readonly string[];
  exitCode: number | null;
  /** The run folder as the CLI printed it (`landing-zones/<lz>/wsp/runs/<run>`), or null. */
  runDir: string | null;
  /** formatLiveBaselineSummary and formatLiveOrganisationalSummary lines (indented lines are details). */
  summaryLines: readonly string[];
}

export interface LiveFinishView {
  title: string;
  level: 'ok' | 'warn';
  rows: Array<{ label: string; value: string }>;
  next: Array<{ label: string; value: LiveDoneAction | typeof LIVE_SHOW_OUTPUT }>;
}

export function liveFinishView(i: LiveFinishInput): LiveFinishView {
  const ok = i.exitCode === 0;
  const rows: LiveFinishView['rows'] = [
    { label: 'Landing zone', value: i.lzLabel },
    { label: 'Scopes', value: i.scopes.join(', ') || 'none' },
  ];
  if (i.frameworks.length > 0) rows.push({ label: 'Frameworks', value: i.frameworks.join(', ') });
  if (!ok) rows.push({ label: 'Result', value: `exit ${i.exitCode ?? 'unknown'}: partial, failed or refused; run-status.json in the run folder has the reason` });
  if (i.runDir) {
    let dir = i.runDir.split('\\').join('/');
    while (dir.endsWith('/')) dir = dir.slice(0, -1);
    rows.push({ label: 'Run folder', value: `${dir}/` });
  }
  // The baseline and organisational summaries (#3875, #4050): a heading line, then indented details.
  for (const l of i.summaryLines) {
    const heading = !l.startsWith('  ');
    rows.push({ label: heading ? 'Summary' : '', value: l.trim() });
  }
  const next: LiveFinishView['next'] = [
    ...LIVE_DONE_ACTIONS.filter((a) => a.id !== 'back').map((a) => ({ label: a.label, value: a.id })),
    { label: 'Show the run output', value: LIVE_SHOW_OUTPUT },
  ];
  return { title: ok ? 'Landing Zone Live Assessment complete' : 'Landing Zone Live Assessment needs attention', level: ok ? 'ok' : 'warn', rows, next };
}

/** The finish guidance: each What next entry in words, the CLI last. */
export function liveFinishGuidance(lzId: string): { title: string; what: string; cli: string } {
  return {
    title: 'Done',
    what: 'Publish Live View writes the lz-live HTML publication. Use as source for Update LZ Catalogue runs a dry run of the catalogue update from this run (writing is a separate, confirmed step in Tools). Diff vs previous run compares each scope with its previous scan. Tenant hierarchy shows the tree of the tenant. Evidence references lists the references of the findings and resolves them locally. Show the run output: the lines of the run.',
    cli: `swao publish --lz-live ${lzId}; swao lz diff ${lzId}; swao lz hierarchy ${lzId}; swao lz evidence --lz ${lzId}`,
  };
}
