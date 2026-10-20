// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Challenge-to-run pairing (#3330).
//
// `swao challenge` writes stakeholder challenge files into
// wsp/challenge-lz/<ts>/LZCA_*.yaml (LZ) and wsp/challenge-app/[<ts>/]AA_*.yaml
// or combined.yaml (application). Since #3330 every file carries a
// `challenged_run` block naming the run it challenged. Report and
// publication readers use selectChallengeForRun() so that a report only
// embeds the challenge of the run it reports.
//
// Selection rule for a reported run R (candidates newest first):
//   1. A challenge whose `challenged_run.run_id` equals R is used.
//   2. A challenge that names another run is never used.
//   3. A challenge without a run id (written before #3330) is paired by
//      timestamp: it belongs to the newest usable run of the same kind whose
//      run id is at or before the challenge timestamp (R <= C < next run).
//      Failed or aborted runs are not boundaries, so a failed re-run does not
//      orphan the challenge of the run before it.
//   4. When no candidate belongs to R, nothing is used; `otherRunOmitted`
//      tells the reader to print CHALLENGE_OTHER_RUN_NOTE.
// Without a reported run (no runs/<ts>/ dir), the newest challenge is used
// as before, flagged `unscoped`.

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { basename, join } from 'path';
import { load as loadYaml } from 'js-yaml';
import { readRunStatus, isRunUsable } from './run-status.js';

/** Field name of the run reference written into every challenge file. */
export const CHALLENGED_RUN_FIELD = 'challenged_run';

/** Note printed when the only challenges on disk belong to other runs. */
export const CHALLENGE_OTHER_RUN_NOTE = 'challenge from another run not shown';

/** The run a challenge was produced for (written by `swao challenge`, #3330). */
export interface ChallengedRunRef {
  run_id: string;
  assessment_type?: string;
  targets?: string[];
  assessed_at?: string;
}

export type ChallengeKind = 'lz' | 'app';

export type ChallengeMatch = 'run-id' | 'timestamp' | 'unscoped' | 'none';

export interface ChallengeSelection {
  /** Directory holding the selected challenge files; null when none applies. */
  dir: string | null;
  /** Timestamp (folder form YYYY-MM-DDTHH-MM-SS) of the selected challenge. */
  challengeTs?: string;
  /** Run the selected challenge belongs to. */
  runId?: string;
  match: ChallengeMatch;
  /** True when at least one challenge of another run was skipped. */
  otherRunOmitted: boolean;
}

const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/;

function subDirName(kind: ChallengeKind): string {
  return kind === 'lz' ? 'challenge-lz' : 'challenge-app';
}

function isChallengeFile(kind: ChallengeKind, f: string): boolean {
  if (!/\.ya?ml$/.test(f)) return false;
  return kind === 'lz' ? /^LZCA_/.test(f) : true;
}

/** ISO date-time to the run / challenge folder form (2026-10-18T12-37-09). */
export function toFolderTs(iso: string): string | undefined {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 19).replace(/:/g, '-');
}

/** Run reference of one challenge file (top level or inside combined.yaml). */
export function readChallengedRun(file: string): ChallengedRunRef | undefined {
  try {
    const parsed = loadYaml(readFileSync(file, 'utf-8')) as Record<string, unknown> | null;
    const ref = parsed && typeof parsed === 'object' ? parsed[CHALLENGED_RUN_FIELD] : undefined;
    if (ref && typeof ref === 'object' && typeof (ref as Record<string, unknown>)['run_id'] === 'string') {
      return ref as ChallengedRunRef;
    }
  } catch { /* unreadable or malformed file: no reference */ }
  return undefined;
}

/** Timestamp of a challenge written without a folder (flat layout). */
function flatChallengeTs(dir: string, files: string[]): string | undefined {
  let newest: string | undefined;
  for (const f of files) {
    let ts: string | undefined;
    try {
      const parsed = loadYaml(readFileSync(join(dir, f), 'utf-8')) as Record<string, unknown> | null;
      const at = parsed?.['reviewed_at'] ?? parsed?.['assessed_at'];
      if (typeof at === 'string') ts = toFolderTs(at);
    } catch { /* fall back to mtime */ }
    if (!ts) {
      try { ts = toFolderTs(statSync(join(dir, f)).mtime.toISOString()); } catch { /* skip */ }
    }
    if (ts && (!newest || ts > newest)) newest = ts;
  }
  return newest;
}

/** Kind of a run dir: from run-status.json, else from its files (older runs). */
function runKind(runDir: string): ChallengeKind | 'other' {
  const s = readRunStatus(runDir);
  if (s) {
    if (s.assessment_type === 'landing-zone-catalog') return 'lz';
    if (s.assessment_type === 'application') return 'app';
    return 'other';
  }
  if (existsSync(join(runDir, 'wsp.yaml'))) return 'app';
  try {
    const passes = join(runDir, 'passes');
    if (existsSync(passes) && readdirSync(passes).some(f => /^lz-(catalogue-)?fit/.test(f))) return 'lz';
  } catch { /* unreadable */ }
  return 'other';
}

/** Usable run ids of one kind in wsp/runs/, ascending; always includes `reportedRunId`. */
function runIdsOfKind(wspDir: string, kind: ChallengeKind, reportedRunId: string): string[] {
  const runsDir = join(wspDir, 'runs');
  const ids = new Set<string>([reportedRunId]);
  try {
    for (const d of readdirSync(runsDir)) {
      if (!TS_RE.test(d)) continue;
      const dir = join(runsDir, d);
      try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
      if (runKind(dir) === kind && isRunUsable(dir)) ids.add(d);
    }
  } catch { /* no runs dir */ }
  return [...ids].sort();
}

/** Run a challenge without a run id belongs to: the newest run at or before it. */
function pairByTimestamp(challengeTs: string, runIds: string[]): string | undefined {
  let owner: string | undefined;
  for (const id of runIds) {
    if (id <= challengeTs) owner = id;
  }
  return owner;
}

/**
 * Pick the challenge that belongs to the reported run (#3330).
 *
 * @param wspDir  apps/<app>/wsp
 * @param kind    'lz' (challenge-lz) or 'app' (challenge-app)
 * @param runDir  the reported run dir (apps/<app>/wsp/runs/<ts>); when it is
 *                not a runs/<ts> dir the newest challenge is used (`unscoped`)
 */
export function selectChallengeForRun(wspDir: string, kind: ChallengeKind, runDir: string | undefined): ChallengeSelection {
  const base = join(wspDir, subDirName(kind));
  const none: ChallengeSelection = { dir: null, match: 'none', otherRunOmitted: false };
  if (!existsSync(base)) return none;

  // Candidates: every sub-directory plus the flat base dir when it holds files.
  const candidates: Array<{ dir: string; ts: string; files: string[] }> = [];
  let entries: string[] = [];
  try { entries = readdirSync(base); } catch { return none; }
  const flatFiles: string[] = [];
  for (const e of entries) {
    const p = join(base, e);
    let isDir = false;
    try { isDir = statSync(p).isDirectory(); } catch { continue; }
    if (isDir) {
      let files: string[] = [];
      try { files = readdirSync(p).filter(f => isChallengeFile(kind, f)).sort(); } catch { /* skip */ }
      if (files.length > 0) candidates.push({ dir: p, ts: e, files });
    } else if (isChallengeFile(kind, e)) {
      flatFiles.push(e);
    }
  }
  if (flatFiles.length > 0) {
    candidates.push({ dir: base, ts: flatChallengeTs(base, flatFiles) ?? '', files: flatFiles.sort() });
  }
  if (candidates.length === 0) return none;
  candidates.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

  const reportedRunId = runDir && TS_RE.test(basename(runDir)) && basename(join(runDir, '..')) === 'runs'
    ? basename(runDir)
    : undefined;

  const refOf = (c: { dir: string; files: string[] }): ChallengedRunRef | undefined => {
    for (const f of c.files) {
      const r = readChallengedRun(join(c.dir, f));
      if (r) return r;
    }
    return undefined;
  };

  if (!reportedRunId) {
    const c = candidates[0]!;
    const ref = refOf(c);
    return { dir: c.dir, challengeTs: c.ts || undefined, ...(ref ? { runId: ref.run_id } : {}), match: 'unscoped', otherRunOmitted: false };
  }

  let runIds: string[] | undefined;
  let otherRunOmitted = false;
  for (const c of candidates) {
    const ref = refOf(c);
    if (ref) {
      if (ref.run_id === reportedRunId) {
        return { dir: c.dir, challengeTs: c.ts || undefined, runId: ref.run_id, match: 'run-id', otherRunOmitted };
      }
      otherRunOmitted = true;
      continue;
    }
    runIds ??= runIdsOfKind(wspDir, kind, reportedRunId);
    const owner = c.ts ? pairByTimestamp(c.ts, runIds) : undefined;
    if (owner === reportedRunId) {
      return { dir: c.dir, challengeTs: c.ts, runId: reportedRunId, match: 'timestamp', otherRunOmitted };
    }
    otherRunOmitted = true;
  }
  return { dir: null, match: 'none', otherRunOmitted };
}

/**
 * One-line label for a report section (#3330), e.g.
 * "challenge 2026-10-18T13-00-00 of run 2026-10-18T12-37-09".
 * Undefined when no challenge was selected.
 */
export function challengeSourceLabel(sel: ChallengeSelection): string | undefined {
  if (!sel.dir) return undefined;
  const ts = sel.challengeTs ?? 'undated';
  const run = sel.runId ? `run ${sel.runId}` : 'an unrecorded run';
  const how = sel.match === 'timestamp'
    ? ' (paired by timestamp)'
    : sel.match === 'unscoped' ? ' (no run to pair with; newest challenge shown)' : '';
  return `challenge ${ts} of ${run}${how}`;
}
