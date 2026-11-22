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

// #3885 (Design 123 sections 5.6, 9.3 and 9.4): the tenant tree of a landing
// zone as shown to people: the CLI (`swao lz hierarchy`), the TUI results view
// and the `lz-live-hierarchy` publication block share this one view.
//
// The view never carries a native node id. Nodes get a positional reference
// (`n1`, `n2`, ... in depth-first order) for the parent link; the name shown is
// the pseudonymised label (`Node-<10 hex>`, #3880) or, for a node the scope
// could not read, `unknown <kind>`. Baseline fail and unverified counts are
// attached to the node a check names (`node_id`) or, without one, to the node
// of the check's scope, and are rolled up to every ancestor.

import { z } from 'zod';
import { LZ_LIVE_HIERARCHY_NODE_KINDS } from './lz-live-scan.js';
import type { LzLiveCheckStatus, LzLiveHierarchyNode } from './lz-live-scan.js';

const Counts = z.object({ fail: z.number().int().nonnegative(), unverified: z.number().int().nonnegative() }).strict();

export const LzHierarchyViewNodeSchema = z.object({
  /** Positional reference in depth-first order; never the native id. */
  ref: z.string().regex(/^n\d+$/),
  parent_ref: z.string().regex(/^n\d+$/).optional(),
  depth: z.number().int().nonnegative(),
  kind: z.enum(LZ_LIVE_HIERARCHY_NODE_KINDS),
  native_kind: z.string().min(1).optional(),
  /** Pseudonymised label; absent for an unknown node or a node without a name. */
  label: z.string().regex(/^Node-[0-9a-f]{10}$/).optional(),
  status: z.enum(['observed', 'unknown']),
  /** #3956: evidence reference of the node (`ev:<run>:hierarchy:Ref-<hex>`), resolved locally; never the native id. */
  evidence_ref: z.string().regex(/^ev:[A-Za-z0-9][A-Za-z0-9_.-]{0,80}:hierarchy:Ref-[0-9a-f]{10}$/).optional(),
  /** Checks attached to this node. */
  own: Counts,
  /** This node and every descendant. */
  rolled: Counts,
}).strict();
export type LzHierarchyViewNode = z.infer<typeof LzHierarchyViewNodeSchema>;

export const LzHierarchyViewSchema = z.object({
  nodes: z.array(LzHierarchyViewNodeSchema),
  nodes_by_kind: z.partialRecord(z.enum(LZ_LIVE_HIERARCHY_NODE_KINDS), z.number().int().nonnegative()),
  /** Levels of the deepest tree (a lone root is 1). */
  depth: z.number().int().nonnegative(),
  unknown_nodes: z.number().int().nonnegative(),
  /** The collection was partial (a scope lacked the tree, a source was partial, an unknown node remains). */
  partial: z.boolean(),
  /** Native kind per normalised kind, for the legend (CSP terms, no ids). */
  legend: z.array(z.object({ kind: z.enum(LZ_LIVE_HIERARCHY_NODE_KINDS), native_kind: z.string().min(1) }).strict()),
  /** False when no check could be placed in the tree (no check results given). */
  has_check_counts: z.boolean(),
}).strict();
export type LzHierarchyView = z.infer<typeof LzHierarchyViewSchema>;

export interface LzHierarchyViewInput {
  nodes: readonly Pick<LzLiveHierarchyNode, 'id' | 'kind' | 'native_kind' | 'parent' | 'label' | 'status'>[];
  partial?: boolean;
  /** Node of each scope (merged `scope_nodes`, or a scan's `scope_node`). */
  scopeNodes?: Readonly<Record<string, string>>;
  /** Check results; `node_id` wins, else the scope's node. Omit when unknown (portfolio). */
  checks?: ReadonlyArray<{ status: LzLiveCheckStatus; node_id?: string; scope_id?: string }>;
  /** #3956: evidence reference per native node id (lzEvidencePublicIndex().node); omitted when the run has no evidence map. */
  evidenceRef?: (nativeId: string) => string | undefined;
}

/** Build the view; undefined when the tree has no node. */
export function buildLzHierarchyView(input: LzHierarchyViewInput): LzHierarchyView | undefined {
  const nodes = input.nodes;
  if (nodes.length === 0) return undefined;
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string, string[]>();
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const sortKey = (id: string): string => { const n = byId.get(id)!; return `${n.kind}\u0000${n.label ?? '~'}\u0000${id}`; };
  for (const n of nodes) {
    if (n.parent !== undefined && ids.has(n.parent) && n.parent !== n.id) {
      const list = children.get(n.parent) ?? [];
      list.push(n.id);
      children.set(n.parent, list);
    }
  }
  for (const list of children.values()) list.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const roots = nodes.filter((n) => n.parent === undefined || !ids.has(n.parent) || n.parent === n.id).map((n) => n.id).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  const own = new Map<string, { fail: number; unverified: number }>();
  for (const c of input.checks ?? []) {
    if (c.status !== 'fail' && c.status !== 'unverified') continue;
    const at = c.node_id !== undefined && ids.has(c.node_id) ? c.node_id : c.scope_id !== undefined ? input.scopeNodes?.[c.scope_id] : undefined;
    if (at === undefined || !ids.has(at)) continue;
    const e = own.get(at) ?? { fail: 0, unverified: 0 };
    e[c.status]++;
    own.set(at, e);
  }

  const out: LzHierarchyViewNode[] = [];
  const refOf = new Map<string, string>();
  const visited = new Set<string>();
  const walk = (id: string, depth: number, parentRef: string | undefined): { fail: number; unverified: number } => {
    visited.add(id);
    const n = byId.get(id)!;
    const ref = `n${out.length + 1}`;
    refOf.set(id, ref);
    const o = own.get(id) ?? { fail: 0, unverified: 0 };
    const entry: LzHierarchyViewNode = {
      ref, ...(parentRef ? { parent_ref: parentRef } : {}), depth, kind: n.kind,
      ...(n.native_kind ? { native_kind: n.native_kind } : {}),
      ...(n.label && /^Node-[0-9a-f]{10}$/.test(n.label) ? { label: n.label } : {}),
      status: n.status ?? 'observed',
      ...(() => { const ev = input.evidenceRef?.(id); return ev ? { evidence_ref: ev } : {}; })(),
      own: { ...o }, rolled: { ...o },
    };
    out.push(entry);
    for (const c of children.get(id) ?? []) {
      if (visited.has(c)) continue;
      const r = walk(c, depth + 1, ref);
      entry.rolled.fail += r.fail;
      entry.rolled.unverified += r.unverified;
    }
    return entry.rolled;
  };
  for (const r of roots) if (!visited.has(r)) walk(r, 0, undefined);

  const nodesByKind: Partial<Record<LzHierarchyViewNode['kind'], number>> = {};
  for (const n of out) nodesByKind[n.kind] = (nodesByKind[n.kind] ?? 0) + 1;
  const legendSeen = new Set<string>();
  const legend: LzHierarchyView['legend'] = [];
  for (const n of out) {
    if (!n.native_kind) continue;
    const key = `${n.kind}|${n.native_kind}`;
    if (legendSeen.has(key)) continue;
    legendSeen.add(key);
    legend.push({ kind: n.kind, native_kind: n.native_kind });
  }
  legend.sort((a, b) => a.kind.localeCompare(b.kind) || a.native_kind.localeCompare(b.native_kind));
  const unknown = out.filter((n) => n.status === 'unknown').length;
  return {
    nodes: out,
    nodes_by_kind: nodesByKind,
    depth: out.reduce((m, n) => Math.max(m, n.depth + 1), 0),
    unknown_nodes: unknown,
    partial: input.partial === true || unknown > 0,
    legend,
    has_check_counts: input.checks !== undefined,
  };
}

/** Display name of a view node: the pseudonymised label, or `unknown <kind>`. */
export function lzHierarchyNodeName(n: LzHierarchyViewNode): string {
  if (n.status === 'unknown') return `unknown ${n.kind}`;
  return n.label ?? `unnamed ${n.kind}`;
}

/** Plain text tree lines (CLI and TUI): indentation by depth, kind, native kind, counts. */
export function formatLzHierarchyTree(v: LzHierarchyView): string[] {
  const lines: string[] = [];
  for (const n of v.nodes) {
    const counts = v.has_check_counts && (n.rolled.fail > 0 || n.rolled.unverified > 0) ? `  fail ${n.rolled.fail}, unverified ${n.rolled.unverified}` : '';
    lines.push(`${'  '.repeat(n.depth)}${n.depth > 0 ? '- ' : ''}${lzHierarchyNodeName(n)} (${n.kind}${n.native_kind ? `, ${n.native_kind}` : ''})${n.status === 'unknown' ? ' [unknown]' : ''}${counts}${n.evidence_ref ? `  ${n.evidence_ref}` : ''}`);
  }
  const kinds = Object.entries(v.nodes_by_kind).map(([k, c]) => `${k} ${c}`).join(', ');
  lines.push(`${v.nodes.length} node(s): ${kinds}; depth ${v.depth}${v.unknown_nodes > 0 ? `; ${v.unknown_nodes} unknown` : ''}${v.partial ? '; partial collection' : ''}`);
  return lines;
}
