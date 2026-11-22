// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- tenant hierarchy view (#3885)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3885 (Design 123 sections 5.6 and 9.4): `swao lz hierarchy <lz-id>` reads
// the tenant tree of one live run (the latest by default, the same lookup as
// `swao lz diff`, #3830): the merged view `lz-live-merged.yaml` when the run has
// one, else the tree of the platform scan (else the first scan with a tree).
// Check results of the run's scans give the fail and unverified counts per
// node. The output is the pseudonymised view of @swao/core: no native id.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { LzLiveMergedSchema, buildLzHierarchyView, formatLzHierarchyTree, lzEvidencePublicIndex, readLzEvidenceMap } from '@swao/core';
import type { LzHierarchyView, LzLiveScan } from '@swao/core';
import { LZ_LIVE_LATEST_FILE } from './assess.js';
import { LZ_LIVE_MERGED_FILE } from './merge.js';
import { LzDiffError, scansOf } from './run-diff.js';

const LZ_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RUN_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;

export interface LzHierarchyResult {
  lz_id: string;
  run_id: string;
  /** Where the tree came from. */
  source: 'merged' | 'scan';
  /** Undefined when the run has no tree (driver without listHierarchy, or not collected). */
  view: LzHierarchyView | undefined;
  /** Reason when the tree was not collected (from the source status), else undefined. */
  not_collected?: string;
}

/** Tree view of one run, from the merged view or the scans. */
export function lzHierarchyViewOfRun(runDir: string, lzId: string): Omit<LzHierarchyResult, 'lz_id' | 'run_id'> {
  const scans = [...scansOf(runDir, lzId).values()];
  const checks = scans.flatMap((s) => s.estate.checks.map((c) => ({ status: c.status, ...(c.node_id ? { node_id: c.node_id } : {}), scope_id: s.meta.scope_id })));
  // #3956: the node's evidence reference from the run's local evidence map (no native id leaves).
  const evidence = lzEvidencePublicIndex(readLzEvidenceMap(runDir));
  const evidenceRef = (id: string): string | undefined => evidence.node(id);
  const mergedPath = join(runDir, LZ_LIVE_MERGED_FILE);
  if (existsSync(mergedPath)) {
    try {
      const m = LzLiveMergedSchema.safeParse(yamlLoad(readFileSync(mergedPath, 'utf-8')));
      const h = m.success ? m.data.estate.hierarchy : undefined;
      if (h) {
        return {
          source: 'merged',
          view: buildLzHierarchyView({ nodes: h.nodes, partial: h.source.partial, scopeNodes: h.scope_nodes, checks, evidenceRef }),
          ...(h.source.status === 'not_collected' ? { not_collected: h.source.reason ?? `HTTP ${h.source.http_status}` } : {}),
        };
      }
    } catch { /* fall back to the scans */ }
  }
  const withTree = scans.filter((s) => s.estate.hierarchy !== undefined);
  const pick: LzLiveScan | undefined = withTree.find((s) => s.meta.scope_kind === 'platform') ?? withTree[0];
  const h = pick?.estate.hierarchy;
  if (!pick || !h) return { source: 'scan', view: undefined };
  return {
    source: 'scan',
    view: buildLzHierarchyView({
      nodes: h.nodes, partial: h.source.partial,
      scopeNodes: h.scope_node ? { [pick.meta.scope_id]: h.scope_node } : {},
      checks: checks.filter((c) => c.scope_id === pick.meta.scope_id),
      evidenceRef,
    }),
    ...(h.source.status === 'not_collected' ? { not_collected: h.source.reason ?? `HTTP ${h.source.http_status}` } : {}),
  };
}

export interface LzHierarchyOptions {
  workspaceRoot: string;
  lzId: string;
  /** Run folder name or ISO time; default latest-lz-live.txt, else the newest run. */
  run?: string;
}

/** `swao lz hierarchy <lz-id> [--run <ts>]`. Throws LzDiffError (exit 1) when no run matches. */
export function runLzHierarchy(o: LzHierarchyOptions): LzHierarchyResult {
  if (!LZ_ID_RE.test(o.lzId)) throw new LzDiffError(`[lz live] landing zone id '${o.lzId}' must be kebab-case`);
  const wsp = join(o.workspaceRoot, 'landing-zones', o.lzId, 'wsp');
  const runsDir = join(wsp, 'runs');
  const runs = existsSync(runsDir) ? readdirSync(runsDir).filter((r) => RUN_SEGMENT_RE.test(r) && scansOf(join(runsDir, r), o.lzId).size > 0).sort() : [];
  if (runs.length === 0) throw new LzDiffError(`[lz live] no live run of landing zone ${o.lzId}; run swao assess --type landing-zone-live --lz ${o.lzId} first`);
  let run: string;
  if (o.run) {
    const name = o.run.replace(/:/g, '-').replace(/\.\d{1,9}Z?$|Z$/, '');
    if (!runs.includes(name)) throw new LzDiffError(`[lz live] --run ${o.run}: no run with live scans of ${o.lzId} (runs: ${runs.join(', ')})`);
    run = name;
  } else {
    const ptr = join(wsp, LZ_LIVE_LATEST_FILE);
    const pointed = existsSync(ptr) ? readFileSync(ptr, 'utf-8').trim() : '';
    run = runs.includes(pointed) ? pointed : (runs[runs.length - 1] as string);
  }
  return { lz_id: o.lzId, run_id: run, ...lzHierarchyViewOfRun(join(runsDir, run), o.lzId) };
}

/** CLI and TUI lines of the result. */
export function formatLzHierarchy(r: LzHierarchyResult): string[] {
  const head = `landing zone ${r.lz_id}, run ${r.run_id}`;
  if (!r.view) return [head, r.not_collected ? `tenant hierarchy not collected: ${r.not_collected}` : 'no tenant hierarchy in this run (the driver lists none, or it was not collected)'];
  const legend = r.view.legend.length > 0 ? [`legend: ${r.view.legend.map((l) => `${l.kind} = ${l.native_kind}`).join('; ')}`] : [];
  return [`${head} (${r.source === 'merged' ? 'merged view' : 'scan'})`, ...formatLzHierarchyTree(r.view), ...legend];
}
