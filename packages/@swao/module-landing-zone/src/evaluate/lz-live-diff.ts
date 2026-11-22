// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- live run diff (Design 120 section 7.3, #3579)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { LZ_LIVE_POSTURE_BLOCKS, lzLivePostureEntryKey } from '@swao/core';
import type { LzLiveHierarchy, LzLivePosture, LzLiveScan } from '@swao/core';

type Diff = LzLiveScan['diff'];
type Ref = Diff['new'][number];
type PostureChange = NonNullable<Diff['posture_changes']>[number];
type HierarchyChange = NonNullable<Diff['hierarchy_changes']>[number];

/**
 * #3880: hierarchy nodes added, removed or moved (parent changed) against
 * the previous run (Design 123 section 5.6). Undefined when neither run has
 * `estate.hierarchy`; empty when one run could not read it (`not_collected`),
 * so a denied read is no mass removal. An `unknown` node that becomes
 * observed (or back) is not a change; its parent is not compared.
 */
export function computeLzLiveHierarchyChanges(current: LzLiveHierarchy | undefined, previous: LzLiveHierarchy | undefined): HierarchyChange[] | undefined {
  if (!current && !previous) return undefined;
  const readable = (h: LzLiveHierarchy | undefined): h is LzLiveHierarchy => h !== undefined && h.source.status === 'ok';
  if (!readable(current) || !readable(previous)) return [];
  const prev = new Map(previous.nodes.map((n) => [n.id, n] as const));
  const cur = new Map(current.nodes.map((n) => [n.id, n] as const));
  const changes: HierarchyChange[] = [];
  for (const id of [...cur.keys()].sort()) {
    const before = prev.get(id);
    const now = cur.get(id)!;
    if (!before) changes.push({ change: 'new', ref: id });
    else if (before.status === 'observed' && now.status === 'observed' && before.parent !== now.parent) changes.push({ change: 'moved', ref: id });
  }
  for (const id of [...prev.keys()].sort()) if (!cur.has(id)) changes.push({ change: 'removed', ref: id });
  return changes;
}

/** Key-order independent JSON, so a reordered but equal entry is not a change. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Entries of one posture block by key; identity and logging are one entry named after the block. */
function postureEntries(posture: LzLivePosture | undefined, block: PostureChange['block']): Map<string, string> {
  const out = new Map<string, string>();
  if (!posture) return out;
  switch (block) {
    case 'encryption':
    case 'exposure':
    case 'ingress_rules':
    case 'backup':
    case 'budgets':
      for (const item of posture[block]?.items ?? []) out.set(lzLivePostureEntryKey(block, item as never), stable(item));
      return out;
    case 'identity':
    case 'logging': {
      const b = posture[block];
      if (b) out.set(block, stable({ ...b, source: undefined }));
      return out;
    }
    default: {
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

/**
 * #3864: posture entries added, removed or changed (Design 123 section 9.1).
 * Undefined when neither run carries posture, so a diff of scans without
 * posture keeps its exact shape. A block that one run did not collect
 * (absent) is not compared, so a collector outage is no mass removal.
 */
export function computeLzLivePostureChanges(current: LzLivePosture | undefined, previous: LzLivePosture | undefined): PostureChange[] | undefined {
  if (!current && !previous) return undefined;
  const changes: PostureChange[] = [];
  for (const block of LZ_LIVE_POSTURE_BLOCKS) {
    const collected = (p: LzLivePosture | undefined): boolean => p?.[block] !== undefined && p[block]!.source.status === 'ok';
    if (!collected(current) || !collected(previous)) continue;
    const cur = postureEntries(current, block);
    const prev = postureEntries(previous, block);
    for (const ref of [...cur.keys()].sort()) {
      const before = prev.get(ref);
      if (before === undefined) changes.push({ block, change: 'new', ref });
      else if (before !== cur.get(ref)) changes.push({ block, change: 'changed', ref });
    }
    for (const ref of [...prev.keys()].sort()) if (!cur.has(ref)) changes.push({ block, change: 'removed', ref });
  }
  return changes;
}

/**
 * Diff of a live scan against the previous run of the same scope
 * (`diff` block, Design 120 section 7.3). Regions are keyed by id, services by
 * native `code`, resources by provider `id`. `status_changes` lists every
 * (service, region) present in both runs whose status changed. A region newly
 * listed for an existing service is not a status change; it shows in the
 * service's `regions` and, if the region itself is new, in `new`.
 * #3864: `posture_changes` compares `estate.posture` per block (see
 * computeLzLivePostureChanges).
 * Without a previous run the lists are empty and `previous_run` is unset.
 * Output is sorted, so two diffs of the same runs are byte-identical.
 */
export function computeLzLiveDiff(current: LzLiveScan, previous: LzLiveScan | undefined, previousRun?: string): Diff {
  if (!previous) return { new: [], removed: [], status_changes: [] };

  const sets = (scan: LzLiveScan): Record<Ref['kind'], Set<string>> => ({
    region: new Set(scan.offering.regions.map((r) => r.id)),
    service: new Set(scan.offering.services.map((s) => s.code)),
    resource: new Set(scan.estate.resources.map((r) => r.id)),
  });
  const cur = sets(current);
  const prev = sets(previous);
  const kinds: Ref['kind'][] = ['region', 'service', 'resource'];
  const added: Ref[] = [];
  const removed: Ref[] = [];
  for (const kind of kinds) {
    for (const ref of [...cur[kind]].sort()) if (!prev[kind].has(ref)) added.push({ kind, ref });
    for (const ref of [...prev[kind]].sort()) if (!cur[kind].has(ref)) removed.push({ kind, ref });
  }

  const prevServices = new Map(previous.offering.services.map((s) => [s.code, s] as const));
  const statusChanges: Diff['status_changes'] = [];
  for (const svc of [...current.offering.services].sort((a, b) => a.code.localeCompare(b.code))) {
    const before = prevServices.get(svc.code);
    if (!before) continue;
    for (const region of Object.keys(svc.regions).sort()) {
      const from = before.regions[region]?.status;
      const to = svc.regions[region]!.status;
      if (from !== undefined && from !== to) statusChanges.push({ service: svc.code, region, from, to });
    }
  }

  const postureChanges = computeLzLivePostureChanges(current.estate.posture, previous.estate.posture);
  const hierarchyChanges = computeLzLiveHierarchyChanges(current.estate.hierarchy, previous.estate.hierarchy);
  return {
    previous_run: previousRun ?? previous.meta.observed_at,
    new: added,
    removed,
    status_changes: statusChanges,
    ...(postureChanges ? { posture_changes: postureChanges } : {}),
    ...(hierarchyChanges ? { hierarchy_changes: hierarchyChanges } : {}),
  };
}
