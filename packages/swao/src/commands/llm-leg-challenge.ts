// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3336: reader for the per-leg challenge passes of an LLM Assessment
// (assess --type llm, CLI and TUI).
//
// #4277: every leg runs `swao challenge` in its OWN leg workspace (cwd), never
// in the main workspace: before #4277 the leg challenge rewrote the app's
// canonical challenge-app/combined.yaml and added challenge-lz/<ts>/ folders
// (Design 092 s7: apps/<app>/wsp is never written by an LLM Assessment run).
// #4291: the stakeholder challenge works on the leg's own application run
// (passed as `--run`); the orchestrator stages only the main workspace's LZ
// Catalog run for the LZ challenge. The leg reader therefore ignores the run id BY DESIGN: it does not pair a
// challenge with a run, it only collects the agent ids the leg's own challenge
// subprocess produced, for the per-leg call metrics of the comparison report.
//
// What it must not do is read a challenge that the leg did not write: before
// #3336 it took combined.yaml or the newest folder regardless of age, so a
// failed leg reported the agents of an earlier challenge (another leg, or a
// stakeholder challenge of the main run). Only files written at or after the
// leg's spawn time count.

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { toFolderTs } from '@swao/core';

export type LegChallengeAgent = { agent_id?: string; [k: string]: unknown };

export interface LegChallengeRead {
  agents: LegChallengeAgent[];
  /** File or folder the agents were read from; null when the leg wrote nothing. */
  source: string | null;
}

function writtenSince(path: string, sinceMs: number): boolean {
  try { return statSync(path).mtimeMs >= sinceMs - 1_000; } catch { return false; }
}

function parseYaml(path: string): LegChallengeAgent | undefined {
  try {
    const parsed = load(readFileSync(path, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed as LegChallengeAgent : undefined;
  } catch { return undefined; }
}

/**
 * #4277: arguments of a leg challenge (CLI and TUI share them). `runId` is
 * the leg's own application run (#4291) or, for the LZ challenge, the staged
 * LZ Catalog run inside the leg workspace (LegChallengeContext).
 */
export function legChallengeArgs(
  kind: 'app' | 'lz',
  appId: string,
  leg: { connector: string; model: string },
  runId?: string,
): string[] {
  return [
    'challenge',
    ...(kind === 'lz' ? ['--type', 'lz'] : []),
    '--app', appId, '--all-agents',
    ...(kind === 'app' ? ['--report'] : []),
    '--connector', leg.connector,
    ...(leg.model !== 'default' ? ['--model', leg.model] : []),
    ...(runId ? ['--run', runId] : []),
  ];
}

/** #4277: apps/<app>/wsp of the LEG workspace, where a leg challenge writes. */
export function legChallengeWspDir(legWorkspaceRoot: string, appId: string): string {
  return join(legWorkspaceRoot, 'apps', appId, 'wsp');
}

/**
 * Agents of the challenge a leg's subprocess wrote into `wspDir`
 * (apps/<app>/wsp of the LEG workspace, #4277) at or after `sinceMs`.
 *
 * app: challenge-app/combined.yaml (base folder, older layout), else flat
 *      AA_*.yaml, else the newest challenge-app/<ts>/ folder: its
 *      combined.yaml `reports` (what `--all-agents --report` writes, #4322),
 *      else its AA_*.yaml files.
 * lz:  the newest challenge-lz/<ts>/ folder (LZCA_<agent>.yaml).
 */
export function readLegChallengeAgents(wspDir: string, kind: 'app' | 'lz', sinceMs: number): LegChallengeRead {
  const sinceTs = toFolderTs(new Date(sinceMs - 1_000).toISOString()) ?? '';
  const newestFolderSince = (base: string): string | undefined => {
    try {
      return readdirSync(base, { withFileTypes: true })
        .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/.test(d.name) && d.name >= sinceTs)
        .map(d => d.name)
        .sort()
        .reverse()[0];
    } catch { return undefined; }
  };

  if (kind === 'lz') {
    const base = join(wspDir, 'challenge-lz');
    const folder = existsSync(base) ? newestFolderSince(base) : undefined;
    if (!folder) return { agents: [], source: null };
    const dir = join(base, folder);
    const agents = readdirSync(dir)
      .filter(f => f.startsWith('LZCA_') && f.endsWith('.yaml'))
      .sort()
      .map(f => ({ agent_id: f.replace(/^LZCA_/, '').replace(/\.yaml$/, '') }));
    return { agents, source: dir };
  }

  const base = join(wspDir, 'challenge-app');
  if (!existsSync(base)) return { agents: [], source: null };
  const combined = join(base, 'combined.yaml');
  if (existsSync(combined) && writtenSince(combined, sinceMs)) {
    const reports = (parseYaml(combined) as { reports?: LegChallengeAgent[] } | undefined)?.reports;
    return { agents: Array.isArray(reports) ? reports : [], source: combined };
  }
  const flat = readdirSync(base)
    .filter(f => f.startsWith('AA_') && f.endsWith('.yaml') && writtenSince(join(base, f), sinceMs))
    .sort();
  if (flat.length > 0) {
    return { agents: flat.map(f => parseYaml(join(base, f))).filter((a): a is LegChallengeAgent => !!a), source: base };
  }
  const folder = newestFolderSince(base);
  if (!folder) return { agents: [], source: null };
  const dir = join(base, folder);
  // #4322: `challenge --all-agents --report` writes only <ts>/combined.yaml
  // into the dated folder (no AA_ files); its `reports` are the agents.
  const datedCombined = join(dir, 'combined.yaml');
  if (existsSync(datedCombined) && writtenSince(datedCombined, sinceMs)) {
    const reports = (parseYaml(datedCombined) as { reports?: LegChallengeAgent[] } | undefined)?.reports;
    if (Array.isArray(reports) && reports.length > 0) return { agents: reports, source: datedCombined };
  }
  const agents = readdirSync(dir)
    .filter(f => f.startsWith('AA_') && f.endsWith('.yaml'))
    .sort()
    .map(f => parseYaml(join(dir, f)))
    .filter((a): a is LegChallengeAgent => !!a);
  return { agents, source: dir };
}
