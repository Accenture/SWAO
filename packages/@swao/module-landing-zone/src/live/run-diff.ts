// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3830: `swao lz diff <lz-id> [--from <ts>] [--to <ts>] [--scope <id>]`
// (Design 120 sections 13.2, 14.3 "Diff vs previous run"). Compares the scans
// of two run folders of a landing zone (`landing-zones/<lz-id>/wsp/runs/<ts>/`)
// per scope with `computeLzLiveDiff`, the same diff the run writer stores in
// each scan. Default: `--to` = the latest run (`latest-lz-live.txt`, else the
// newest run with a scan), and for each scope of it the newest earlier run
// that holds a scan of the same scope. Only the run folders are read (no
// `.raw/`, recordings or network). Resources are reported as counts, never by
// provider id, as in the publication (Design 120 section 6.4).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LzLiveScanSchema } from '@swao/core';
import type { LzLiveScan } from '@swao/core';
import { computeLzLiveDiff } from '../evaluate/lz-live-diff.js';
import { LZ_LIVE_LATEST_FILE } from './assess.js';

const RUN_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;
const LZ_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCAN_SUFFIX = '.lz-live-scan.json';

export class LzDiffError extends Error {
  readonly exitCode = 1;
}

export interface LzScopeDiff {
  scope_id: string;
  from_run: string;
  to_run: string;
  simulated: boolean;
  new_regions: string[];
  new_services: string[];
  new_resources: number;
  removed_regions: string[];
  removed_services: string[];
  removed_resources: number;
  status_changes: Array<{ service: string; region: string; from: string; to: string }>;
  /** #3864: posture entry changes per block, as counts (refs are provider ids); absent without posture. */
  posture_changes?: Record<string, { new: number; removed: number; changed: number }>;
  /** #3880: hierarchy node changes as counts (refs are native ids); absent without hierarchy. */
  hierarchy_changes?: { new: number; removed: number; moved: number };
}

export interface LzRunDiffResult {
  lz_id: string;
  to_run: string;
  scopes: LzScopeDiff[];
  /** Scopes of the `to` run with no earlier scan to compare with. */
  first_scans: string[];
}

/** `--from` / `--to` accept the run folder name or an ISO time (`:` and fractions normalised). */
function runName(ts: string): string {
  return ts.replace(/:/g, '-').replace(/\.\d{1,9}Z?$|Z$/, '');
}

/** #3885: the valid scans of one landing zone in a run folder, by scope id (shared with `swao lz hierarchy`). */
export function scansOf(runDir: string, lzId: string): Map<string, LzLiveScan> {
  const out = new Map<string, LzLiveScan>();
  let names: string[] = [];
  try { names = readdirSync(runDir); } catch { return out; }
  for (const name of names.sort()) {
    if (!name.startsWith(`${lzId}.`) || !name.endsWith(SCAN_SUFFIX)) continue;
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(join(runDir, name), 'utf-8')); } catch { continue; }
    const r = LzLiveScanSchema.safeParse(raw);
    if (r.success && r.data.meta.lz_id === lzId) out.set(r.data.meta.scope_id, r.data);
  }
  return out;
}

export interface LzRunDiffOptions {
  workspaceRoot: string;
  lzId: string;
  from?: string;
  to?: string;
  scopeId?: string;
}

export function runLzDiff(o: LzRunDiffOptions): LzRunDiffResult {
  if (!LZ_ID_RE.test(o.lzId)) throw new LzDiffError(`[lz live] landing zone id '${o.lzId}' must be kebab-case`);
  const wsp = join(o.workspaceRoot, 'landing-zones', o.lzId, 'wsp');
  const runsDir = join(wsp, 'runs');
  const runs = existsSync(runsDir)
    ? readdirSync(runsDir).filter((r) => RUN_SEGMENT_RE.test(r) && scansOf(join(runsDir, r), o.lzId).size > 0).sort()
    : [];
  if (runs.length === 0) throw new LzDiffError(`[lz live] no live run of landing zone ${o.lzId}; run swao assess --type landing-zone-live --lz ${o.lzId} first`);
  const pick = (ts: string, flag: string): string => {
    const name = runName(ts);
    if (!RUN_SEGMENT_RE.test(name) || !runs.includes(name)) throw new LzDiffError(`[lz live] ${flag} ${ts}: no run with live scans of ${o.lzId} (runs: ${runs.join(', ')})`);
    return name;
  };
  let toRun: string;
  if (o.to) toRun = pick(o.to, '--to');
  else {
    const ptr = join(wsp, LZ_LIVE_LATEST_FILE);
    const pointed = existsSync(ptr) ? readFileSync(ptr, 'utf-8').trim() : '';
    toRun = runs.includes(pointed) ? pointed : (runs[runs.length - 1] as string);
  }
  const fromRun = o.from ? pick(o.from, '--from') : undefined;
  if (fromRun !== undefined && fromRun >= toRun) throw new LzDiffError(`[lz live] --from ${fromRun} is not older than --to ${toRun}`);

  const toScans = scansOf(join(runsDir, toRun), o.lzId);
  if (o.scopeId !== undefined && !toScans.has(o.scopeId)) throw new LzDiffError(`[lz live] run ${toRun} holds no scan of scope ${o.scopeId}`);
  const scopes: LzScopeDiff[] = [];
  const firstScans: string[] = [];
  const earlier = runs.filter((r) => r < toRun).reverse();
  for (const [scopeId, current] of [...toScans.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (o.scopeId !== undefined && scopeId !== o.scopeId) continue;
    let prevRun: string | undefined;
    let previous: LzLiveScan | undefined;
    for (const r of fromRun !== undefined ? [fromRun] : earlier) {
      const s = scansOf(join(runsDir, r), o.lzId).get(scopeId);
      if (s) { prevRun = r; previous = s; break; }
    }
    if (!previous || !prevRun) { firstScans.push(scopeId); continue; }
    const d = computeLzLiveDiff(current, previous, prevRun);
    const refs = (side: 'new' | 'removed', kind: 'region' | 'service'): string[] => d[side].filter((x) => x.kind === kind).map((x) => x.ref);
    scopes.push({
      scope_id: scopeId,
      from_run: prevRun,
      to_run: toRun,
      simulated: current.meta.simulated !== undefined || previous.meta.simulated !== undefined,
      new_regions: refs('new', 'region'),
      new_services: refs('new', 'service'),
      new_resources: d.new.filter((x) => x.kind === 'resource').length,
      removed_regions: refs('removed', 'region'),
      removed_services: refs('removed', 'service'),
      removed_resources: d.removed.filter((x) => x.kind === 'resource').length,
      status_changes: d.status_changes.map((c) => ({ service: c.service, region: c.region, from: c.from, to: c.to })),
      ...(d.posture_changes ? { posture_changes: lzPostureChangeCounts(d.posture_changes) } : {}),
      ...(d.hierarchy_changes ? { hierarchy_changes: lzHierarchyChangeCounts(d.hierarchy_changes) } : {}),
    });
  }
  if (scopes.length === 0) {
    throw new LzDiffError(`[lz live] nothing to compare: run ${toRun} of ${o.lzId} has no scope with an earlier scan${fromRun ? ` in run ${fromRun}` : ''}${firstScans.length > 0 ? ` (first scans: ${firstScans.join(', ')})` : ''}`);
  }
  return { lz_id: o.lzId, to_run: toRun, scopes, first_scans: firstScans };
}

export function lzPostureChangeCounts(changes: NonNullable<LzLiveScan['diff']['posture_changes']>): NonNullable<LzScopeDiff['posture_changes']> {
  const out: NonNullable<LzScopeDiff['posture_changes']> = {};
  for (const c of changes) {
    const row = out[c.block] ?? (out[c.block] = { new: 0, removed: 0, changed: 0 });
    row[c.change] += 1;
  }
  return out;
}

/** #3880: hierarchy node changes as counts. */
export function lzHierarchyChangeCounts(changes: NonNullable<LzLiveScan['diff']['hierarchy_changes']>): NonNullable<LzScopeDiff['hierarchy_changes']> {
  const out = { new: 0, removed: 0, moved: 0 };
  for (const c of changes) out[c.change] += 1;
  return out;
}

/** Text lines of `swao lz diff` (the TUI shows the same lines). */
export function formatLzDiff(r: LzRunDiffResult): string[] {
  const list = (xs: readonly string[]): string => (xs.length > 0 ? xs.join(', ') : 'none');
  const lines: string[] = [];
  for (const s of r.scopes) {
    lines.push(`scope ${s.scope_id}: ${s.from_run} -> ${s.to_run}${s.simulated ? ' [SIM]' : ''}`);
    lines.push(`  new: regions ${list(s.new_regions)}; services ${list(s.new_services)}; resources ${s.new_resources}`);
    lines.push(`  removed: regions ${list(s.removed_regions)}; services ${list(s.removed_services)}; resources ${s.removed_resources}`);
    if (s.status_changes.length === 0) lines.push('  status changes: none');
    for (const c of s.status_changes) lines.push(`  status change: ${c.service} in ${c.region}: ${c.from} -> ${c.to}`);
    if (s.hierarchy_changes) lines.push(`  hierarchy nodes: new ${s.hierarchy_changes.new}, removed ${s.hierarchy_changes.removed}, moved ${s.hierarchy_changes.moved}`);
    if (s.posture_changes) {
      const rows = Object.entries(s.posture_changes).sort(([a], [b]) => a.localeCompare(b));
      lines.push(rows.length === 0 ? '  posture changes: none' : `  posture changes: ${rows.map(([b, c]) => `${b} new ${c.new}, removed ${c.removed}, changed ${c.changed}`).join('; ')}`);
    }
  }
  if (r.first_scans.length > 0) lines.push(`first scan, nothing to compare: ${r.first_scans.join(', ')}`);
  return lines;
}
