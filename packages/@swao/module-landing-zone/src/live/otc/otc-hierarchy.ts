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

// #3881: OTC tenant hierarchy (Design 123 section 5.6, D-13). Read calls,
// all GET (no allow-list change):
//   - IAM `GET /v3/auth/domains`: the domain (tenant), the root node.
//   - IAM `GET /v3/projects?domain_id=<id>` with the domain-scoped token
//     (platform scope): region projects (parent = the domain) and their
//     sub-projects (parent = the region project).
//   - IAM `GET /v3/auth/projects` (application scope, and the platform
//     fallback when `/v3/projects` is denied): the projects the login can
//     use. An application scope keeps its own project and the ancestors it
//     can see; a parent it cannot see is an `unknown` node, never guessed.
//   - EPS `GET /v1.0/enterprise-projects` with the domain-scoped token
//     (platform scope): enterprise projects, the second grouping of the
//     domain, as `folder` nodes under the domain (`otc:enterprise-project`).
// A denied read of the domain or the enterprise projects is recorded in
// `sources` and makes the tree partial; a tree without any project read
// throws LiveSourceUnavailableError (the scan records `hierarchy` as
// not_collected). Every returned property goes into `attributes`; the scan
// boundary applies the privacy filter (#3886) and pseudonymises names.

import type { ScopeCtx, DriverHierarchy, DriverHierarchyNode } from '../types.js';
import { LiveAuthError, LiveSourceUnavailableError } from '../errors.js';
import { LiveTokenRejectedError } from '../http.js';
import { flattenAttributes } from '../attributes.js';
import { OtcHttpError, iamBase, otcDomainToken, otcGet, otcToken, trimTrailingSlashes } from './otc-client.js';
import type { OtcToken } from './otc-client.js';

/** EPS is read with the domain-scoped token, whose catalogue is empty (otc-client.ts), so the base URL is a default. */
// Live 2026-11-05 (#3881): the EPS host is regional (`eps.eu-de...`); `eps.otc...` does not resolve.
export const OTC_DEFAULT_EPS = 'https://eps.eu-de.otc.t-systems.com/v1.0';

export const OTC_HIERARCHY_ROUTES = ['/v3/projects', '/v1.0/enterprise-projects'] as const;

const MAX_PAGES = 50;

export interface IamProject { id?: string; name?: string; domain_id?: string; parent_id?: string; [k: string]: unknown }
interface IamPage { projects?: IamProject[]; links?: { next?: string | null } }
interface EpsDoc { enterprise_projects?: ({ id?: string; name?: string } & Record<string, unknown>)[]; total_count?: number }

const statusOf = (err: unknown): number | undefined => (err instanceof OtcHttpError ? err.status : err instanceof LiveAuthError ? err.httpStatus : undefined);

function denied(ctx: ScopeCtx, name: string, err: unknown): void {
  if (err instanceof LiveTokenRejectedError) throw err;
  const http = statusOf(err);
  // A network failure (DNS, TLS) of an optional read is a gap too, never a crash of the scan.
  if (!(err instanceof Error)) throw err;
  ctx.sources.push(http !== undefined ? { name, status: 'not_collected', http_status: http } : { name, status: 'not_collected', reason: (err as Error).message });
}

async function pagedProjects(ctx: ScopeCtx, token: OtcToken, first: string, route: string): Promise<IamProject[]> {
  const out: IamProject[] = [];
  let url: string | undefined = first;
  for (let i = 0; i < MAX_PAGES && url; i++) {
    const page: IamPage = await otcGet<IamPage>(ctx, token, url, route);
    out.push(...(page.projects ?? []));
    const next: string | null | undefined = page.links?.next;
    url = typeof next === 'string' && next !== '' && next !== url ? next : undefined;
  }
  return out;
}

const PROJECT_OMIT = ['id', 'name', 'parent_id', 'domain_id', 'links'];

/** OTC region names (`eu-de`, `eu-nl`, `eu-ch2`). */
const REGION_NAME = /^[a-z]{2}-[a-z]+\d*$/;

/**
 * Kind of one IAM project. Under the domain: a region project when its name
 * is a region, else a system project (live 2026-11-05: `MOS` sits next to
 * `eu-de` and `eu-nl`). Under a project: a sub-project.
 */
export function otcProjectNode(p: IamProject, domainId: string): DriverHierarchyNode {
  const topLevel = p.parent_id === undefined || p.parent_id === domainId;
  const region = topLevel && typeof p.name === 'string' && REGION_NAME.test(p.name);
  const attributes = flattenAttributes(p, { omit: PROJECT_OMIT });
  return {
    id: String(p.id),
    kind: region ? 'region' : 'project',
    native_kind: region ? 'otc:region-project' : topLevel ? 'otc:system-project' : 'otc:project',
    ...(p.parent_id ? { parent: p.parent_id } : {}),
    ...(p.name ? { name: p.name } : {}),
    ...(attributes ? { attributes } : {}),
  };
}

export async function listOtcHierarchy(ctx: ScopeCtx): Promise<DriverHierarchy> {
  const iam = iamBase(ctx);
  const application = ctx.scopeKind === 'application';
  const calls: string[] = [];
  let partial = false;

  // The application scope reads with its own project token; the platform
  // scope with the domain-scoped token (IAM project lists and EPS).
  let token: OtcToken;
  try {
    token = application ? await otcToken(ctx, ctx.target['project'] ?? ctx.regions[0] ?? 'eu-de') : await otcDomainToken(ctx);
  } catch (err) {
    if (err instanceof LiveAuthError) throw new LiveSourceUnavailableError('hierarchy', err.httpStatus);
    throw err;
  }
  const domainId = token.domainId;

  // Domain (root).
  let domain: DriverHierarchyNode | undefined;
  try {
    const doc = await otcGet<{ domains?: ({ id?: string; name?: string } & Record<string, unknown>)[] }>(ctx, token, `${iam}/auth/domains`, '/v3/auth/domains');
    const d = (doc.domains ?? []).find((x) => x.id === domainId) ?? doc.domains?.[0];
    if (d?.id) {
      const attributes = flattenAttributes(d, { omit: ['id', 'name', 'links'] });
      domain = { id: d.id, kind: 'organisation', native_kind: 'otc:domain', ...(d.name ? { name: d.name } : {}), ...(attributes ? { attributes } : {}) };
      calls.push('iam:GET /v3/auth/domains');
    }
  } catch (err) {
    denied(ctx, 'hierarchy:domain', err);
    partial = true;
  }

  // Projects.
  let projects: IamProject[] | undefined;
  if (!application) {
    try {
      projects = await pagedProjects(ctx, token, `${iam}/projects?domain_id=${encodeURIComponent(domainId)}`, '/v3/projects');
      calls.push('iam:GET /v3/projects');
    } catch (err) {
      denied(ctx, 'hierarchy:projects', err);
      partial = true;
    }
  }
  if (projects === undefined) {
    try {
      projects = await pagedProjects(ctx, token, `${iam}/auth/projects`, '/v3/auth/projects');
      calls.push('iam:GET /v3/auth/projects');
    } catch (err) {
      if (err instanceof LiveTokenRejectedError) throw err;
      throw new LiveSourceUnavailableError('hierarchy', statusOf(err), statusOf(err) === undefined ? (err as Error).message : undefined);
    }
    if (!application) partial = true;
  }

  const byId = new Map(projects.filter((p) => typeof p.id === 'string' && p.id !== '').map((p) => [String(p.id), p] as const));
  let keep: IamProject[] = [...byId.values()];
  let scopeNode: string | undefined = domain?.id;
  if (application) {
    const target = ctx.target['project'] ?? ctx.regions[0];
    const own = [...byId.values()].find((p) => p.name === target) ?? byId.get(token.projectId);
    if (!own) throw new LiveSourceUnavailableError('hierarchy', undefined, `project ${target ?? '(none)'} is not in the projects the login can see`);
    scopeNode = String(own.id);
    keep = [];
    for (let p: IamProject | undefined = own; p && keep.length < 16; p = p.parent_id ? byId.get(p.parent_id) : undefined) keep.push(p);
    keep.reverse();
  }

  const nodes: DriverHierarchyNode[] = [];
  if (domain) nodes.push(domain);
  const present = new Set(nodes.map((n) => n.id));
  for (const p of keep) {
    const n = otcProjectNode(p, domainId);
    nodes.push(n);
    present.add(n.id);
  }
  // A parent the scope cannot see becomes an unknown node (Design 123 section 5.6).
  for (const n of [...nodes]) {
    if (n.parent === undefined || present.has(n.parent)) continue;
    const isDomain = n.parent === domainId;
    nodes.unshift({ id: n.parent, kind: isDomain ? 'organisation' : 'region', native_kind: isDomain ? 'otc:domain' : 'otc:region-project', status: 'unknown' });
    present.add(n.parent);
    partial = true;
  }
  // Sort parents before children for a readable tree (domain, regions, sub-projects).
  const depth = (id: string, seen = 0): number => { const p = nodes.find((x) => x.id === id)?.parent; return p === undefined || seen > 16 ? 0 : 1 + depth(p, seen + 1); };
  nodes.sort((a, b) => depth(a.id) - depth(b.id));

  // Enterprise projects (platform scope only; a second grouping under the domain).
  if (!application) {
    const eps = trimTrailingSlashes(ctx.http.baseUrls['eps'] ?? OTC_DEFAULT_EPS);
    try {
      const doc = await otcGet<EpsDoc>(ctx, token, `${eps}/enterprise-projects?limit=1000`, '/v1.0/enterprise-projects');
      calls.push('eps:GET /v1.0/enterprise-projects');
      for (const ep of doc.enterprise_projects ?? []) {
        if (!ep.id) continue;
        const attributes = flattenAttributes(ep, { omit: ['id', 'name'] });
        nodes.push({ id: `ep:${ep.id}`, kind: 'folder', native_kind: 'otc:enterprise-project', ...(present.has(domainId) ? { parent: domainId } : {}), ...(ep.name ? { name: ep.name } : {}), ...(attributes ? { attributes } : {}) });
      }
    } catch (err) {
      denied(ctx, 'hierarchy:enterprise-projects', err);
      partial = true;
    }
  }

  return { nodes, source: { calls: calls.length > 0 ? calls : ['iam:GET /v3/auth/projects'], partial }, ...(scopeNode ? { scope_node: scopeNode } : {}) };
}
