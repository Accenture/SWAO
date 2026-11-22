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

// #3883: STACKIT tenant hierarchy (Design 123 section 5.6, D-13). Resource
// Manager v2 (`services/resource-manager/v0/resource-manager.json` of
// stackitcloud/stackit-api-specifications, host
// resource-manager.api.stackit.cloud, global), all GET:
//   - `GET /v2/projects?member=<service account>`: the projects the key can
//     see, each with `parent` (`id`, `containerId`, `type` ORGANIZATION or
//     FOLDER).
//   - `GET /v2/folders/{containerId}?includeParents=true`: a parent folder
//     with its ancestor chain `parents` (`id`, `parentId`, `name`, `type`).
//   - `GET /v2/organizations/{id}`: the organisation, the root node.
//   - platform scope only: `GET /v2/folders?containerParentId=` and
//     `GET /v2/projects?containerParentId=` walk the tree below the
//     organisation (nested folders).
// The project read `GET /v2/projects/{id}` is deliberately not used: its path
// equals the Audit Log route `/v2/projects/{project_id}` of the posture
// collector (#3867, auditlog.api.stackit.cloud). The recorder and the mock
// pack match routes by path on one loopback origin, so the two reads would
// share one route key (Lane C flag, 2026-11-05). The project list gives the
// same `parent`, and the folder read gives the ancestor chain.
//
// Node ids are the UUIDs (`organizationId`, `folderId`, `projectId`, and
// `id` / `parentId` in `parent` and `parents`). `containerId` is left out of
// the attributes: it is built from the human-chosen name. A parent the key
// cannot read is an `unknown` node with kind and id only, never guessed; a
// denied read is recorded in `sources` and makes the tree partial.

import type { DriverHierarchy, DriverHierarchyNode, ScopeCtx } from '../types.js';
import { LiveAuthError, LiveSourceUnavailableError } from '../errors.js';
import { LiveTokenRejectedError } from '../http.js';
import { flattenAttributes } from '../attributes.js';
import { StackitHttpError, stackitBase, stackitGet, stackitProject, stackitToken } from './stackit-client.js';

export const STACKIT_DEFAULT_RESOURCE_MANAGER = 'https://resource-manager.api.stackit.cloud';

export const STACKIT_HIERARCHY_ROUTES = {
  projects: '/v2/projects',
  folders: '/v2/folders',
  folder: '/v2/folders/{container_id}',
  organization: '/v2/organizations/{organization_id}',
} as const;

const PAGE = 100;
const MAX_PAGES = 50;
/** Containers walked below the organisation on a platform scope. */
const MAX_CONTAINERS = 200;

type ParentType = 'ORGANIZATION' | 'FOLDER';
export interface RmParent { id?: string; containerId?: string; type?: string }
export interface RmAncestor { id?: string; containerId?: string; parentId?: string; containerParentId?: string; name?: string; type?: string }
export interface RmProject { projectId?: string; containerId?: string; name?: string; parent?: RmParent; [k: string]: unknown }
export interface RmFolder { folderId?: string; containerId?: string; name?: string; parent?: RmParent; parents?: RmAncestor[]; [k: string]: unknown }
export interface RmOrganization { organizationId?: string; containerId?: string; name?: string; [k: string]: unknown }
interface RmList<T> { items?: T[]; limit?: number; offset?: number }

const OMIT = ['projectId', 'folderId', 'organizationId', 'containerId', 'name', 'parent', 'parents', 'labels'];

const kindOf = (t: string | undefined): { kind: 'organisation' | 'folder'; native_kind: string } | undefined => {
  switch (t as ParentType | undefined) {
    case 'ORGANIZATION': return { kind: 'organisation', native_kind: 'stackit:organization' };
    case 'FOLDER': return { kind: 'folder', native_kind: 'stackit:folder' };
    case undefined: return undefined;
    default: return undefined;
  }
};

const statusOf = (err: unknown): number | undefined => (err instanceof StackitHttpError ? err.status : err instanceof LiveAuthError ? err.httpStatus : undefined);

function denied(ctx: ScopeCtx, name: string, err: unknown): void {
  if (err instanceof LiveTokenRejectedError) throw err;
  if (!(err instanceof Error)) throw err;
  const http = statusOf(err);
  ctx.sources.push(http !== undefined ? { name, status: 'not_collected', http_status: http } : { name, status: 'not_collected', reason: err.message });
}

async function pagedList<T>(ctx: ScopeCtx, url: string, route: string): Promise<T[]> {
  const out: T[] = [];
  const sep = url.includes('?') ? '&' : '?';
  for (let page = 0; page < MAX_PAGES; page++) {
    const doc = await stackitGet<RmList<T>>(ctx, `${url}${sep}limit=${PAGE}&offset=${page * PAGE}`, route);
    const items = doc.items ?? [];
    out.push(...items);
    if (items.length < PAGE) break;
  }
  return out;
}

/** Project node from a Resource Manager project document. */
export function stackitProjectNode(p: RmProject): DriverHierarchyNode {
  const attributes = flattenAttributes(p, { omit: OMIT });
  return {
    id: String(p.projectId),
    kind: 'project',
    native_kind: 'stackit:project',
    ...(p.parent?.id ? { parent: p.parent.id } : {}),
    ...(p.name ? { name: p.name } : {}),
    ...(attributes ? { attributes } : {}),
  };
}

/** Folder node from a Resource Manager folder document. */
export function stackitFolderNode(f: RmFolder): DriverHierarchyNode {
  const attributes = flattenAttributes(f, { omit: OMIT });
  return {
    id: String(f.folderId),
    kind: 'folder',
    native_kind: 'stackit:folder',
    ...(f.parent?.id ? { parent: f.parent.id } : {}),
    ...(f.name ? { name: f.name } : {}),
    ...(attributes ? { attributes } : {}),
  };
}

/** Ancestor node from a `parents` entry (name and parent only; the entry has no other properties). */
export function stackitAncestorNode(a: RmAncestor): DriverHierarchyNode | undefined {
  const k = kindOf(a.type);
  if (!k || !a.id) return undefined;
  return { id: a.id, ...k, ...(a.parentId ? { parent: a.parentId } : {}), ...(a.name ? { name: a.name } : {}) };
}

export async function listStackitHierarchy(ctx: ScopeCtx): Promise<DriverHierarchy> {
  const rm = stackitBase(ctx, 'resource-manager', STACKIT_DEFAULT_RESOURCE_MANAGER);
  const platform = ctx.scopeKind !== 'application';
  const token = await stackitToken(ctx);
  const projectId = await stackitProject(ctx);
  const calls = new Set<string>();
  const nodes = new Map<string, DriverHierarchyNode>();
  let partial = false;
  const put = (n: DriverHierarchyNode): void => {
    const had = nodes.get(n.id);
    if (had === undefined || (had.status === 'unknown' && n.status !== 'unknown')) nodes.set(n.id, n);
  };

  // 1. The projects the key can see (the scope's own project among them).
  let visible: RmProject[];
  try {
    visible = await pagedList<RmProject>(ctx, `${rm}/v2/projects?member=${encodeURIComponent(token.email)}`, STACKIT_HIERARCHY_ROUTES.projects);
    calls.add('resource-manager:GET /v2/projects');
  } catch (err) {
    if (err instanceof LiveTokenRejectedError) throw err;
    throw new LiveSourceUnavailableError('hierarchy', statusOf(err), statusOf(err) === undefined ? (err as Error).message : undefined);
  }
  visible = visible.filter((p) => typeof p.projectId === 'string' && p.projectId !== '');
  const own = visible.find((p) => p.projectId === projectId);
  if (!own) throw new LiveSourceUnavailableError('hierarchy', undefined, 'the scope project is not among the projects the key can see');
  for (const p of platform ? visible : [own]) put(stackitProjectNode(p));

  // 2. Ancestors. Every parent reference seen (project `parent`, folder
  // `parent`, `parents` entries) is kept by id with its type and container id,
  // so a parent nobody can read still gets its kind (live 2026-11-05: the
  // project's `parent` is the organisation, whose read answers 403).
  const refs = new Map<string, RmParent>();
  const ref = (r: RmParent | RmAncestor | undefined): void => {
    if (!r?.id) return;
    const had = refs.get(r.id);
    const containerId = had?.containerId ?? r.containerId;
    const type = had?.type ?? r.type;
    refs.set(r.id, { id: r.id, ...(containerId ? { containerId } : {}), ...(type ? { type } : {}) });
  };
  for (const n of nodes.values()) ref(visible.find((x) => x.projectId === n.id)?.parent);
  const folderReads = [...refs.values()].filter((r) => r.type === 'FOLDER' && r.containerId);
  for (const r of folderReads) {
    if (nodes.has(String(r.id))) continue;
    try {
      const f = await stackitGet<RmFolder>(ctx, `${rm}/v2/folders/${encodeURIComponent(String(r.containerId))}?includeParents=true`, STACKIT_HIERARCHY_ROUTES.folder);
      calls.add('resource-manager:GET /v2/folders/{container_id}');
      if (f.folderId) put(stackitFolderNode(f));
      ref(f.parent);
      const chain = f.parents ?? [];
      const inChain = new Set(chain.map((a) => a.id));
      for (const a of chain) {
        ref(a);
        const n = stackitAncestorNode(a);
        if (n) put(n);
        // The chain lists the folders above (live 2026-11-05: a project
        // directly under the organisation has `parents: []`); the parent of
        // the topmost folder outside the chain is the organisation, the only
        // container a top-level folder can hang under.
        if (a.parentId && !inChain.has(a.parentId)) ref({ id: a.parentId, ...(a.containerParentId ? { containerId: a.containerParentId } : {}), type: 'ORGANIZATION' });
      }
    } catch (err) {
      denied(ctx, 'hierarchy:folder', err);
      partial = true;
    }
  }
  const org = [...refs.values()].find((r) => r.type === 'ORGANIZATION');
  if (org?.id && org.containerId) {
    try {
      const o = await stackitGet<RmOrganization>(ctx, `${rm}/v2/organizations/${encodeURIComponent(org.containerId)}`, STACKIT_HIERARCHY_ROUTES.organization);
      calls.add('resource-manager:GET /v2/organizations/{organization_id}');
      const attributes = flattenAttributes(o, { omit: OMIT });
      put({ id: org.id, kind: 'organisation', native_kind: 'stackit:organization', ...(o.name ? { name: o.name } : {}), ...(attributes ? { attributes } : {}) });
    } catch (err) {
      denied(ctx, 'hierarchy:organization', err);
      partial = true;
    }
  }

  // 3. Platform scope: the tree below the organisation (nested folders).
  if (platform && org?.containerId) {
    const queue: string[] = [org.containerId];
    let i = 0;
    for (; i < queue.length && i < MAX_CONTAINERS; i++) {
      const c = queue[i] as string;
      try {
        const folders = await pagedList<RmFolder>(ctx, `${rm}/v2/folders?containerParentId=${encodeURIComponent(c)}`, STACKIT_HIERARCHY_ROUTES.folders);
        calls.add('resource-manager:GET /v2/folders');
        for (const f of folders) {
          if (!f.folderId) continue;
          put(stackitFolderNode(f));
          if (f.containerId) queue.push(f.containerId);
        }
        const projects = await pagedList<RmProject>(ctx, `${rm}/v2/projects?containerParentId=${encodeURIComponent(c)}`, STACKIT_HIERARCHY_ROUTES.projects);
        for (const p of projects) if (p.projectId) put(stackitProjectNode(p));
      } catch (err) {
        denied(ctx, 'hierarchy:children', err);
        partial = true;
        break;
      }
    }
    if (i < queue.length) partial = true;
  }

  // A parent nobody could read becomes an unknown node with kind and id only (Design 123 section 5.6).
  for (const n of [...nodes.values()]) {
    if (n.parent === undefined || nodes.has(n.parent)) continue;
    const k = kindOf(refs.get(n.parent)?.type) ?? { kind: 'folder' as const, native_kind: 'stackit:folder' };
    put({ id: n.parent, ...k, status: 'unknown' });
    partial = true;
  }

  // Parents before children for a readable tree.
  const all = [...nodes.values()];
  const depth = (id: string, seen = 0): number => { const p = nodes.get(id)?.parent; return p === undefined || seen > 32 ? 0 : 1 + depth(p, seen + 1); };
  all.sort((a, b) => depth(a.id) - depth(b.id));

  return { nodes: all, source: { calls: calls.size > 0 ? [...calls] : ['resource-manager:GET /v2/projects'], partial }, scope_node: projectId };
}
