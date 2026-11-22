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

// #3880: `estate.hierarchy`, the tenant structure (Design 123 section 5.6,
// owner decision D-13), at the scan boundary and in the scope merge.
//   - Scan boundary (`prepareHierarchy`): a driver returns nodes with the
//     native `name`; the name becomes the label `Node-<10 hex>`, an
//     HMAC-SHA256 keyed by the landing zone pseudonym salt (the salt of
//     live/privacy.ts, Design 120 section 6.4), so the same node keeps its
//     label across runs and the name is never written. An `unknown` node
//     keeps id and kind only. Node `attributes` pass the one attribute
//     privacy filter of #3886 (`filterAttributes`, live/privacy.ts; Design
//     123 sections 5.7 and 12) with the same salt and the scope's login names.
//   - Scope merge (`mergeLzLiveHierarchy`): nodes of all merged scopes are
//     unioned by id. An observed node beats an unknown one; between observed
//     nodes the first scope in merge order (platform first) wins, and a later
//     scope only fills what is missing (parent, native kind, label). Policy
//     refs are unioned. A parent that would close a cycle is not taken.
//     `scope_nodes` names each scope's own node.

import { createHmac } from 'node:crypto';
import { LzLiveHierarchySchema, LzLiveMergedHierarchySchema } from '@swao/core';
import type { LzLiveFactSource, LzLiveHierarchy, LzLiveHierarchyNode, LzLiveMergedHierarchy, LzLiveScan } from '@swao/core';
import type { DriverHierarchy } from './types.js';
import { filterAttributes } from './privacy.js';

/** `Node-<10 hex>`: HMAC-SHA256(salt, trimmed native name). */
export function pseudonymiseNodeLabel(name: string, salt: string): string {
  if (salt.length === 0) throw new Error('[lz live] pseudonymisation needs a salt');
  return `Node-${createHmac('sha256', salt).update(name.trim()).digest('hex').slice(0, 10)}`;
}

/** Validate a driver's tenant structure and pseudonymise its node names (see the header). */
export function prepareHierarchy(raw: DriverHierarchy, salt: string, people: readonly string[] = []): LzLiveHierarchy {
  const nodes = raw.nodes.map((n) => {
    const unknown = n.status === 'unknown';
    const attributes = unknown ? undefined : filterAttributes(n.attributes, salt, people).attributes;
    return {
      id: n.id,
      kind: n.kind,
      ...(n.native_kind ? { native_kind: n.native_kind } : {}),
      ...(!unknown && n.parent !== undefined ? { parent: n.parent } : {}),
      ...(!unknown && n.name !== undefined && n.name.trim() !== '' ? { label: pseudonymiseNodeLabel(n.name, salt) } : {}),
      status: unknown ? 'unknown' as const : 'observed' as const,
      ...(attributes ? { attributes } : {}),
      ...(!unknown && n.policy_refs ? { policy_refs: [...n.policy_refs] } : {}),
    };
  });
  const parsed = LzLiveHierarchySchema.safeParse({
    nodes,
    source: raw.source,
    ...(raw.scope_node !== undefined ? { scope_node: raw.scope_node } : {}),
    ...(raw.resource_nodes ? { resource_nodes: raw.resource_nodes } : {}),
  });
  if (!parsed.success) throw new Error(`[lz live] the driver returned an invalid hierarchy: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return parsed.data;
}

/** Would `child.parent = parent` close a cycle in `byId`? */
function closesCycle(byId: ReadonlyMap<string, LzLiveHierarchyNode>, child: string, parent: string): boolean {
  const seen = new Set<string>([child]);
  let cur: string | undefined = parent;
  while (cur !== undefined) {
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = byId.get(cur)?.parent;
  }
  return false;
}

/** The tenant tree of the merged scopes, in merge order (platform first); undefined when none has one. */
export function mergeLzLiveHierarchy(scans: readonly LzLiveScan[]): LzLiveMergedHierarchy | undefined {
  const withTree = scans.filter((s) => s.estate.hierarchy !== undefined);
  if (withTree.length === 0) return undefined;
  const byId = new Map<string, LzLiveHierarchyNode>();
  const order: string[] = [];
  const resourceNodes: Record<string, string> = {};
  const scopeNodes: Record<string, string> = {};
  const sources: LzLiveFactSource[] = [];
  for (const scan of withTree) {
    const h = scan.estate.hierarchy!;
    sources.push(h.source);
    if (h.scope_node !== undefined) scopeNodes[scan.meta.scope_id] = h.scope_node;
    for (const [res, node] of Object.entries(h.resource_nodes)) if (!(res in resourceNodes)) resourceNodes[res] = node;
    for (const n of h.nodes) {
      const prev = byId.get(n.id);
      if (!prev) {
        byId.set(n.id, { ...n, policy_refs: [...n.policy_refs] });
        order.push(n.id);
        continue;
      }
      if (prev.status === 'unknown' && n.status === 'observed') {
        // An observed node replaces the unknown placeholder, unless its parent closes a cycle.
        const next = { ...n, policy_refs: [...n.policy_refs] };
        if (next.parent !== undefined && closesCycle(byId, n.id, next.parent)) delete next.parent;
        byId.set(n.id, next);
        continue;
      }
      if (n.status !== 'observed') continue;
      if (prev.parent === undefined && n.parent !== undefined && !closesCycle(byId, n.id, n.parent)) prev.parent = n.parent;
      if (prev.native_kind === undefined && n.native_kind !== undefined) prev.native_kind = n.native_kind;
      if (prev.label === undefined && n.label !== undefined) prev.label = n.label;
      prev.policy_refs = [...new Set([...prev.policy_refs, ...n.policy_refs])];
    }
  }
  const ok = sources.filter((s) => s.status === 'ok');
  const calls = [...new Set(sources.flatMap((s) => s.calls))].sort();
  const nodes = order.map((id) => byId.get(id)!);
  const source: LzLiveFactSource = ok.length === 0
    ? { ...sources[0]!, calls }
    : { calls, status: 'ok', partial: ok.length < scans.length || ok.some((s) => s.partial) || nodes.some((n) => n.status === 'unknown') };
  return LzLiveMergedHierarchySchema.parse({ nodes, source, resource_nodes: resourceNodes, scope_nodes: scopeNodes });
}
