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
// Every leg runs `swao challenge` in the MAIN workspace (the leg workspace
// is a fresh copy without challenge agents, #1774), so every leg challenges
// the same main run and the `challenged_run` reference (#3330) is identical
// for all legs. The leg reader therefore ignores the run id BY DESIGN: it does
// not pair a challenge with a run, it only collects the agent ids the leg's
// own challenge subprocess produced, for the per-leg call metrics of the
// comparison report.
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
 * Agents of the challenge a leg's subprocess wrote into `wspDir`
 * (apps/<app>/wsp of the main workspace) at or after `sinceMs`.
 *
 * app: challenge-app/combined.yaml (`--all-agents --report`), else flat
 *      AA_*.yaml, else the newest challenge-app/<ts>/ folder (older layout).
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
  const agents = readdirSync(dir)
    .filter(f => f.startsWith('AA_') && f.endsWith('.yaml'))
    .sort()
    .map(f => parseYaml(join(dir, f)))
    .filter((a): a is LegChallengeAgent => !!a);
  return { agents, source: dir };
}
