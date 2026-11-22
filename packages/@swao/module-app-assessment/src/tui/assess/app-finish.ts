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

// #4256 (TUI-12, Design 126 sections 4.7 and 8 rule 9): the finish screen of
// the Application Assessment on FinishPanel. Owner screenshot 2026-11-10 10:51:
// the old screen showed "apps/<app>/wsp/passes/ + wsp/runs/<ts>/" (there is no
// wsp/passes/ and <ts> is a placeholder), letter keys written with a double
// dash, a hand-written "Press Esc (or Enter)" line and menu numbers "(4)",
// "(6)" in the guidance. Now: the real run folder, the pass count, the LZ fit
// verdict and next steps as menu entries. Pure functions; the screen renders.

import { existsSync, readFileSync, readdirSync } from 'fs';
import { basename, join } from 'path';
import { load as loadYaml } from 'js-yaml';

const RUN_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;

/**
 * The folder of the latest application run, relative to the workspace:
 * `apps/<app>/wsp/runs/<run>/` from latest-application.txt (else latest.txt,
 * else the newest folder under runs/). Null when the app has no run.
 */
export function readAppRunFolder(workspace: string | null, app: string): string | null {
  if (!workspace || !app) return null;
  const wspDir = join(workspace, 'apps', app, 'wsp');
  for (const pointer of ['latest-application.txt', 'latest.txt']) {
    try {
      const run = basename(readFileSync(join(wspDir, pointer), 'utf-8').trim());
      if (RUN_SEGMENT_RE.test(run) && existsSync(join(wspDir, 'runs', run))) return `apps/${app}/wsp/runs/${run}/`;
    } catch { /* next pointer */ }
  }
  try {
    const runs = readdirSync(join(wspDir, 'runs')).filter((r) => RUN_SEGMENT_RE.test(r)).sort();
    const last = runs[runs.length - 1];
    return last ? `apps/${app}/wsp/runs/${last}/` : null;
  } catch {
    return null;
  }
}

/** One LZ catalogue fit result of a run: `otc/eu-de NEEDS_VERIFICATION`. */
export interface LzFitVerdict { target: string; verdict: string }

/** The LZ catalogue fit verdicts of a run folder (lz-catalogue-fit*.yaml: provider, region, overall). */
export function readLzFitVerdicts(workspace: string | null, runFolder: string | null): LzFitVerdict[] {
  if (!workspace || !runFolder) return [];
  const dir = join(workspace, runFolder);
  let files: string[];
  try { files = readdirSync(dir).filter((f) => f.startsWith('lz-catalogue-fit') && f.endsWith('.yaml')).sort(); } catch { return []; }
  const out: LzFitVerdict[] = [];
  for (const f of files) {
    try {
      const y = loadYaml(readFileSync(join(dir, f), 'utf-8')) as { provider?: unknown; region?: unknown; overall?: unknown } | null;
      if (!y || typeof y.overall !== 'string') continue;
      const target = [y.provider, y.region].filter((p): p is string => typeof p === 'string' && p !== '').join('/');
      out.push({ target: target || f.slice(0, -'.yaml'.length), verdict: y.overall });
    } catch { /* an unreadable fit file is left out */ }
  }
  return out;
}

/** Block verdicts as one row: "2 satisfactory, 1 partial, 1 unsatisfactory". */
export function blockVerdictSummary(verdicts: Record<string, string>): string {
  const order = ['SATISFACTORY', 'PARTIAL', 'UNSATISFACTORY'];
  const counts = new Map<string, number>();
  for (const v of Object.values(verdicts)) counts.set(v, (counts.get(v) ?? 0) + 1);
  const known = order.filter((k) => counts.has(k)).map((k) => `${counts.get(k)} ${k.toLowerCase()}`);
  const other = [...counts.entries()].filter(([k]) => !order.includes(k)).map(([k, n]) => `${n} ${k.toLowerCase().replace(/_/g, ' ')}`);
  return [...known, ...other].join(', ');
}

/** Whether the Stakeholder Challenge is offered on the finish menu. */
export type AppChallengeOffer = 'offer' | 'no-llm' | 'not-licensed' | 'none';

export interface AppFinishInput {
  app: string;
  /** "Application Assessment", "Infrastructure Assessment", ... */
  typeLabel: string;
  totalPasses: number;
  passesLabel: string;
  passFiles: number;
  /** The LLM of the run; ignored for a deterministic-only run. */
  llm: string;
  skipLlm: boolean;
  runFolder: string | null;
  lzFit: readonly LzFitVerdict[];
  blockVerdicts: Record<string, string>;
  degradedPasses: readonly string[];
  skippedPassGroups: ReadonlyArray<{ passes: string; reason: string }>;
  /** Baseline decision lines (#3981) shown behind "Show details". */
  detailLines: readonly string[];
  logAvailable: boolean;
  challenge: AppChallengeOffer;
  /** #4499: default passes this run left out (by the lens, the profile or an untick); a Left out row names them. */
  leftOutPasses?: readonly string[];
}

export type AppFinishChoice = 'challenge' | 'details' | 'log';

export interface AppFinishView {
  title: string;
  level: 'ok' | 'warn';
  rows: Array<{ label: string; value: string }>;
  items: Array<{ level: 'warn'; label: string; reason: string }>;
  /** What next; FinishPanel appends "Back to main menu". */
  next: Array<{ label: string; value: AppFinishChoice }>;
}

export function appFinishView(i: AppFinishInput): AppFinishView {
  const rows: AppFinishView['rows'] = [
    { label: 'App', value: i.app },
    { label: 'Passes', value: `${i.totalPasses} (${i.passesLabel}), ${i.passFiles} pass results written` },
    { label: 'LLM', value: i.skipLlm ? 'deterministic only (no LLM)' : i.llm },
  ];
  if (i.leftOutPasses && i.leftOutPasses.length > 0) rows.push({ label: 'Left out', value: `${i.leftOutPasses.join(', ')} (not in the pass selection of this run)` });
  const blocks = blockVerdictSummary(i.blockVerdicts);
  if (blocks) rows.push({ label: 'Blocks', value: blocks });
  if (i.lzFit.length > 0) rows.push({ label: 'LZ fit', value: i.lzFit.map((f) => `${f.target} ${f.verdict}`).join(', ') });
  if (i.runFolder) rows.push({ label: 'Outputs', value: `${i.runFolder} (passes/ inside)` });
  const items: AppFinishView['items'] = [];
  if (i.degradedPasses.length > 0) {
    items.push({ level: 'warn', label: 'Degraded', reason: `${i.degradedPasses.join(', ')}: LLM connectivity failure, results incomplete; run again when the network is back` });
  }
  for (const sg of i.skippedPassGroups) items.push({ level: 'warn', label: 'Skipped', reason: `${sg.passes}: ${sg.reason}` });
  const next: AppFinishView['next'] = [];
  if (i.challenge === 'offer') next.push({ label: 'Stakeholder Challenge', value: 'challenge' });
  if (blocks || i.detailLines.length > 0) next.push({ label: 'Show details', value: 'details' });
  if (i.logAvailable) next.push({ label: 'View the log', value: 'log' });
  return { title: `${i.typeLabel} complete`, level: items.length > 0 ? 'warn' : 'ok', rows, items, next };
}

/**
 * #4256: the finish view of a run that did not complete (Application or LZ
 * Catalog): level fail, App and exit code, View the log when there is one; the
 * output stays above the panel. Replaces "Press Enter or Escape to return".
 */
export function failedRunView(typeLabel: string, app: string, code: number | null, logAvailable: boolean): {
  title: string; level: 'fail'; rows: Array<{ label: string; value: string }>; next: Array<{ label: string; value: 'log' }>;
} {
  return {
    title: `${typeLabel} failed`,
    level: 'fail',
    rows: [{ label: 'App', value: app }, { label: 'Exit code', value: code === null ? 'unknown' : String(code) }],
    next: logAvailable ? [{ label: 'View the log', value: 'log' }] : [],
  };
}

/** The finish guidance: each What next entry, why the challenge is missing, the next main menu steps; the CLI last. */
export function appFinishGuidance(i: Pick<AppFinishInput, 'app' | 'typeLabel' | 'challenge' | 'runFolder'>): { title: string; what: string; cli: string } {
  const parts = ['All passes are complete.'];
  if (i.challenge === 'offer') parts.push('Stakeholder Challenge: four stakeholder roles review the result of this run (LLM, Enterprise).');
  if (i.challenge === 'no-llm') parts.push('The Stakeholder Challenge is not offered: it needs an LLM and this run was deterministic only.');
  if (i.challenge === 'not-licensed') parts.push('The Stakeholder Challenge needs an Enterprise licence.');
  parts.push('Show details: the block verdicts and the policy baseline decisions. View the log: the full output of the run.');
  parts.push('Next steps from the main menu: Publish writes the HTML report of this app; Export BI writes the Power BI bundle.');
  if (i.runFolder) parts.push(`Run folder: ${i.runFolder}.`);
  return { title: `${i.typeLabel} complete`, what: parts.join(' '), cli: `swao publish --app ${i.app}` };
}

/**
 * #4256 (Design 126 sections 4.7 and 4.9): the guidance of a run that did not
 * complete: the likely cause in words (clone failure, GitHub tree URL, a
 * failed pass), where the log is and how to run again. No placeholders and
 * no raw exception text; the CLI last.
 */
export function failedRunGuidance(i: { typeLabel: string; app: string; code: number | null; lastLines: string; logPath: string | null; failedPassAdvice?: string }): {
  title: string; what: string; sections: Array<{ label: string; text: string }>; cli: string;
} {
  const cloneFailed = i.lastLines.toLowerCase().includes('git clone failed');
  const treeUrl = i.lastLines.includes('/tree/');
  const what = cloneFailed
    ? (treeUrl
      ? 'The source URL of this app is a GitHub tree view URL. Edit source.vcs.url in the .swao.yml of the app to the bare repository URL, put the branch and the subfolder into their own fields, then run again.'
      : 'git clone failed before any pass ran. Common causes: a wrong URL, no VCS token for a private repository, or a proxy that blocks HTTPS to the git host. The log names the exact reason.')
    : (i.failedPassAdvice ?? 'A pass ended with an error. The log of the run has the full output; after fixing the cause, run the failed pass alone from the Passes step.');
  return {
    title: `${i.typeLabel} failed`,
    what,
    sections: [
      { label: 'Exit code', text: i.code === null ? 'unknown' : String(i.code) },
      ...(i.logPath ? [{ label: 'Log', text: i.logPath }] : []),
    ],
    cli: 'swao log tail --level error',
  };
}
