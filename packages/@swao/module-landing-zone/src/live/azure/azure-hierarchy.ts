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

// #3884: Azure tenant hierarchy (Design 123 section 5.6, D-13). Mock only:
// there is no Azure environment (Q-21), so the driver stays
// `liveVerified: false`. One read, the Resource Graph table
// `ResourceContainers` (the allow-listed POST the inventory already uses,
// Resource Graph 2024-04-01). Row shapes from the Microsoft Learn page
// "Azure Resource Graph sample queries for management groups":
//   - management groups, type `microsoft.management/managementgroups`, the
//     ancestors in `properties.details.managementGroupAncestorsChain`
//     (`name`, `displayName`, the direct parent first); the Tenant Root Group
//     is the management group whose name is the tenant id;
//   - subscriptions, type `microsoft.resources/subscriptions`, the ancestors
//     in `properties.managementGroupAncestorsChain`;
//   - resource groups, type `microsoft.resources/subscriptions/resourcegroups`.
// Platform scope: tenant scope (no `subscriptions` in the query), which
// returns the management groups the principal can read. Application scope:
// its own subscription. A management group known only from an ancestor chain
// is a node with its name and parent from the chain and no attributes, and
// the source is partial; a parent nobody returned (the subscription of a
// resource group the principal reads without the subscription) is an
// `unknown` node with kind and id only. Resources attach to their resource
// group through `resource_nodes`, from the rows `listResources` read (the
// whole `Resources` table since #3886; no second inventory query).

import type { DriverHierarchy, DriverHierarchyNode, ScopeCtx } from '../types.js';
import { LiveAuthError, LiveSourceUnavailableError } from '../errors.js';
import { flattenAttributes } from '../attributes.js';
import { AzureHttpError, azureSubscription, resourceGraph } from './azure-client.js';

export const AZURE_HIERARCHY_QUERY = 'ResourceContainers';

const T_MG = 'microsoft.management/managementgroups';
const T_SUB = 'microsoft.resources/subscriptions';
const T_RG = 'microsoft.resources/subscriptions/resourcegroups';

type Doc = Record<string, unknown>;
interface ChainEntry { name?: unknown; displayName?: unknown }

export const mgId = (name: string): string => `/providers/Microsoft.Management/managementGroups/${name}`;

const lower = (v: unknown): string => String(v ?? '').toLowerCase();
const props = (r: Doc): Doc => (r['properties'] && typeof r['properties'] === 'object' ? r['properties'] as Doc : {});
const chainOf = (v: unknown): ChainEntry[] => (Array.isArray(v) ? v.filter((e): e is ChainEntry => e !== null && typeof e === 'object' && typeof (e as ChainEntry).name === 'string' && (e as ChainEntry).name !== '') : []);

/** Kind of a management group: the Tenant Root Group (name = tenant id) is the organisation. */
function mgKind(name: string, tenantId: string): Pick<DriverHierarchyNode, 'kind' | 'native_kind'> {
  return lower(name) === lower(tenantId) ? { kind: 'organisation', native_kind: 'azure:tenant-root-group' } : { kind: 'management_group', native_kind: 'azure:management-group' };
}

/** Resource rows of `listResources`, per scope run (resource_nodes without a second query). */
const resourceRows = new WeakMap<ScopeCtx, readonly Doc[]>();
export function rememberAzureResources(ctx: ScopeCtx, rows: readonly Doc[]): void {
  resourceRows.set(ctx, rows);
}

/** Nodes of the ResourceContainers rows (exported for the tests). */
export function azureHierarchyFromRows(rows: readonly Doc[], tenantId: string, resources: readonly Doc[] = []): { nodes: DriverHierarchyNode[]; partial: boolean; resource_nodes: Record<string, string> } {
  const nodes = new Map<string, DriverHierarchyNode>();
  let partial = false;
  const put = (n: DriverHierarchyNode): void => {
    const had = nodes.get(lower(n.id));
    // A row beats a chain entry; an observed node beats an unknown one.
    if (had === undefined || (had.status === 'unknown' && n.status !== 'unknown') || (had.attributes === undefined && n.attributes !== undefined)) nodes.set(lower(n.id), n);
  };
  const fromChain = new Set<string>();
  const chainNodes = (chain: ChainEntry[]): void => {
    chain.forEach((e, i) => {
      const id = mgId(String(e.name));
      if (nodes.has(lower(id))) return;
      const up = chain[i + 1];
      put({ id, ...mgKind(String(e.name), tenantId), ...(up ? { parent: mgId(String(up.name)) } : {}), ...(typeof e.displayName === 'string' && e.displayName !== '' ? { name: e.displayName } : {}) });
      fromChain.add(lower(id));
    });
  };

  for (const r of rows) {
    const type = lower(r['type']);
    const id = typeof r['id'] === 'string' ? r['id'] : '';
    if (id === '') continue;
    const attributes = flattenAttributes(r, { omit: ['id', 'name', 'type', 'tags'] });
    switch (type) {
      case T_MG: {
        const name = String(r['name'] ?? '');
        const details = (props(r)['details'] ?? {}) as Doc;
        const chain = chainOf(details['managementGroupAncestorsChain']);
        const parentName = chain[0]?.name ?? ((details['parent'] as Doc | undefined)?.['name']);
        const display = props(r)['displayName'];
        put({ id, ...mgKind(name, tenantId), ...(typeof parentName === 'string' && parentName !== '' ? { parent: mgId(parentName) } : {}), ...(typeof display === 'string' && display !== '' ? { name: display } : {}), ...(attributes ? { attributes } : {}) });
        fromChain.delete(lower(id));
        chainNodes(chain);
        break;
      }
      case T_SUB: {
        const chain = chainOf(props(r)['managementGroupAncestorsChain']);
        put({ id, kind: 'subscription', native_kind: 'azure:subscription', ...(chain[0] ? { parent: mgId(String(chain[0].name)) } : {}), ...(typeof r['name'] === 'string' ? { name: r['name'] } : {}), ...(attributes ? { attributes } : {}) });
        if (chain.length === 0) partial = true;
        chainNodes(chain);
        break;
      }
      case T_RG: {
        const sub = typeof r['subscriptionId'] === 'string' ? `/subscriptions/${r['subscriptionId']}` : undefined;
        put({ id, kind: 'resource_group', native_kind: 'azure:resource-group', ...(sub ? { parent: sub } : {}), ...(typeof r['name'] === 'string' ? { name: r['name'] } : {}), ...(attributes ? { attributes } : {}) });
        break;
      }
      default:
        break;
    }
  }
  if (fromChain.size > 0) partial = true;

  // A parent nobody returned becomes an unknown node with kind and id only (Design 123 section 5.6).
  for (const n of [...nodes.values()]) {
    if (n.parent === undefined || nodes.has(lower(n.parent))) continue;
    const isSub = lower(n.parent).startsWith('/subscriptions/');
    nodes.set(lower(n.parent), { id: n.parent, ...(isSub ? { kind: 'subscription' as const, native_kind: 'azure:subscription' } : { kind: 'management_group' as const, native_kind: 'azure:management-group' }), status: 'unknown' });
    partial = true;
  }
  // Parents keep the id spelling of their own node.
  for (const n of nodes.values()) if (n.parent !== undefined) n.parent = (nodes.get(lower(n.parent)) as DriverHierarchyNode).id;

  // Resources attach to their resource group (`/subscriptions/{s}/resourceGroups/{rg}/...`).
  const resource_nodes: Record<string, string> = {};
  for (const r of resources) {
    const id = typeof r['id'] === 'string' ? r['id'] : '';
    const m = /^(\/subscriptions\/[^/]+\/resourcegroups\/[^/]+)\//i.exec(id);
    const rg = m ? nodes.get(lower(m[1])) : undefined;
    if (rg !== undefined && rg.kind === 'resource_group') resource_nodes[id] = rg.id;
  }

  const all = [...nodes.values()];
  const depth = (id: string, seen = 0): number => { const p = nodes.get(lower(id))?.parent; return p === undefined || seen > 32 ? 0 : 1 + depth(p, seen + 1); };
  all.sort((a, b) => depth(a.id) - depth(b.id));
  return { nodes: all, partial, resource_nodes };
}

export async function listAzureHierarchy(ctx: ScopeCtx): Promise<DriverHierarchy> {
  const sub = azureSubscription(ctx);
  const tenantId = ctx.credentials['tenant-id'] ?? '';
  const platform = ctx.scopeKind !== 'application';
  let rows: Doc[];
  try {
    rows = await resourceGraph<Doc>(ctx, AZURE_HIERARCHY_QUERY, platform ? undefined : [sub]);
  } catch (err) {
    if (err instanceof LiveAuthError && err.httpStatus === 401) throw err;
    const http = err instanceof AzureHttpError ? err.status : err instanceof LiveAuthError ? err.httpStatus : undefined;
    throw new LiveSourceUnavailableError('hierarchy', http !== undefined && http >= 100 ? http : undefined, http === undefined || http < 100 ? (err as Error).message : undefined);
  }
  const t = azureHierarchyFromRows(rows, tenantId, resourceRows.get(ctx) ?? []);
  const own = t.nodes.find((n) => lower(n.id) === lower(`/subscriptions/${sub}`));
  return {
    nodes: t.nodes,
    source: { calls: ['arm:POST /providers/Microsoft.ResourceGraph/resources'], partial: t.partial || own === undefined },
    ...(own ? { scope_node: own.id } : {}),
    ...(Object.keys(t.resource_nodes).length > 0 ? { resource_nodes: t.resource_nodes } : {}),
  };
}
