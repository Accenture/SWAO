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
// Catalog Assessment on FinishPanel: the verdict per target in one row, the
// blocked targets with their gap type, the real run folder (never a
// placeholder), What next as menu entries (LZ Sovereignty Challenge, View the
// log, Back to main menu). Pure functions; the screen renders the view.

import { lzBlockedGapLabel, type LzGapType } from './lz-gap-type.js';

export interface LzFinishTarget {
  target: string;
  verdict: string;
  gaps: number;
}

export interface LzFinishGapDetail {
  gapType: LzGapType;
  sovereigntyStatement: string;
  assessmentMode: 'catalogue-sovereignty-only' | 'partial' | 'full';
}

/** Whether the LZ Sovereignty Challenge is offered on the finish menu. */
export type LzChallengeOffer = 'offer' | 'no-llm' | 'not-licensed' | 'none';

export interface LzFinishInput {
  app: string;
  typeLabel: string;
  targets: readonly LzFinishTarget[];
  /** The single verdict when no per-target verdicts were read. */
  overallVerdict: string;
  gapDetails: Readonly<Record<string, LzFinishGapDetail>>;
  /** `apps/<app>/wsp/runs/<run>/` from latest-landing-zone-catalog.txt; null when unknown. */
  runFolder: string | null;
  catalogueOnly: boolean;
  logAvailable: boolean;
  challenge: LzChallengeOffer;
}

export type LzFinishChoice = 'challenge' | 'log';

export interface LzFinishView {
  title: string;
  level: 'ok' | 'warn';
  rows: Array<{ label: string; value: string }>;
  items: Array<{ level: 'fail' | 'warn'; label: string; reason: string }>;
  next: Array<{ label: string; value: LzFinishChoice }>;
}

const regionOf = (target: string): string => target.split('/').at(-1) ?? target;
const isBlocked = (v: string): boolean => v === 'blocked' || v === 'sovereignty_blocked';

export function lzFinishView(i: LzFinishInput): LzFinishView {
  const rows: LzFinishView['rows'] = [
    { label: 'App', value: i.app },
    { label: 'Targets', value: `${i.targets.length} (lz_fit)` },
  ];
  const verdicts = i.targets.length > 0
    ? i.targets.map((t) => `${t.target} ${t.verdict.toUpperCase()}${t.gaps > 0 ? ` (${t.gaps} gap${t.gaps !== 1 ? 's' : ''})` : ''}`).join(', ')
    : i.overallVerdict ? i.overallVerdict.toUpperCase() : '';
  if (verdicts) rows.push({ label: 'Verdict', value: verdicts });
  if (i.runFolder) rows.push({ label: 'Outputs', value: i.runFolder });
  const items: LzFinishView['items'] = [];
  for (const t of i.targets) {
    const d = i.gapDetails[regionOf(t.target)];
    if (isBlocked(t.verdict)) {
      const gap = d ? lzBlockedGapLabel(d.gapType).trim() : '';
      items.push({ level: 'fail', label: t.target, reason: gap || 'BLOCKED' });
    }
    if (d?.assessmentMode === 'partial') items.push({ level: 'warn', label: t.target, reason: 'partial coverage: some baseline service categories are missing from the service signals' });
  }
  if (i.catalogueOnly) items.push({ level: 'warn', label: 'Catalogue only', reason: 'no service signals from a prior App Assessment; run the App Assessment first, then this assessment again' });
  const attention = items.length > 0 || i.targets.some((t) => t.verdict !== 'ready') || (i.targets.length === 0 && !!i.overallVerdict && i.overallVerdict !== 'ready');
  const next: LzFinishView['next'] = [];
  if (i.challenge === 'offer') next.push({ label: 'LZ Sovereignty Challenge', value: 'challenge' });
  if (i.logAvailable) next.push({ label: 'View the log', value: 'log' });
  return { title: `${i.typeLabel} complete`, level: attention ? 'warn' : 'ok', rows, items, next };
}

/** The verdict in words (was the guidance text of the old finish screen). */
export function lzVerdictText(verdict: string): string {
  switch (verdict) {
    case 'ready': return 'No blockers detected. Catalogue-level service requirements are met.';
    case 'sovereignty_blocked': return 'One or more target regions fail sovereignty requirements: they lack required certifications. Select compliant regions or adjust the framework selection.';
    case 'blocked': return 'One or more compliance controls failed with severity blocker. Review 23-lzr.yaml in the run folder.';
    case 'advisory': return 'No hard blockers, but advisory-severity controls raised warnings. Review the advisory items before proceeding.';
    default: return 'The landing zone fit is written to the run folder.';
  }
}

/** The finish guidance: the verdict, each What next entry, the sovereignty statement of a blocked target; the CLI last. */
export function lzFinishGuidance(i: LzFinishInput): { title: string; what: string; cli: string } {
  const parts = [lzVerdictText(i.overallVerdict)];
  if (i.challenge === 'offer') parts.push('LZ Sovereignty Challenge: four landing zone stakeholder roles review the landing zone fit (LLM, Enterprise).');
  if (i.challenge === 'no-llm') parts.push('The LZ Sovereignty Challenge is not offered: it needs an LLM and this run was deterministic only.');
  if (i.challenge === 'not-licensed') parts.push('The LZ Sovereignty Challenge needs an Enterprise licence.');
  parts.push('View the log: the full output of the run. Publish in the main menu adds the LZ Catalogue section to the HTML report.');
  const blocked = i.targets.find((t) => isBlocked(t.verdict));
  const stmt = blocked ? i.gapDetails[regionOf(blocked.target)]?.sovereigntyStatement : '';
  if (stmt) parts.push(`Sovereignty statement: ${stmt}`);
  if (i.runFolder) parts.push(`Run folder: ${i.runFolder}.`);
  return { title: `${i.typeLabel} complete`, what: parts.join(' '), cli: `swao publish --app ${i.app}` };
}
