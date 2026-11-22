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

// #3883: the STACKIT tenant hierarchy collector (Design 123 section 5.6)
// against the in-process mock: the live shape of 2026-11-05 (one project
// directly under an organisation the Reader key cannot read), nested folders,
// and the route key guard against the Audit Log path.

import { describe, it, expect } from 'vitest';
import { LzLiveHierarchySchema } from '@swao/core';
import { createReadOnlyFetch } from '../../http.js';
import { routeOf, routePathOf } from '../../record.js';
import { prepareHierarchy } from '../../hierarchy.js';
import type { ScopeCtx } from '../../types.js';
import { stackitDriver } from '../stackit-driver.js';
import { STACKIT_DEFAULT_RESOURCE_MANAGER, STACKIT_HIERARCHY_ROUTES, listStackitHierarchy, stackitAncestorNode, stackitFolderNode, stackitProjectNode } from '../stackit-hierarchy.js';
import { PROJECT_ID, RM_ORG_CONTAINER, RM_ORG_ID, makeStackitMock, serviceAccountKey } from './stackit-mock.js';
import type { MockOptions } from './stackit-mock.js';

const SALT = 'x'.repeat(64);

function ctxFor(opts: MockOptions = {}, over: Partial<ScopeCtx> = {}): { ctx: ScopeCtx; calls: ReturnType<typeof makeStackitMock>['calls'] } {
  const mock = makeStackitMock(opts);
  const fetch = mock.fetch;
  return {
    ctx: {
      lzId: 'stackit-test', provider: 'stackit', scopeId: 'platform', scopeKind: 'platform', auth: 'key-flow', regions: ['eu01'], target: {},
      credentials: { 'service-account-key': serviceAccountKey() },
      http: { fetch: createReadOnlyFetch(fetch, 'stackit', stackitDriver.readAllowList), baseUrls: { ...stackitDriver.defaultBaseUrls } },
      sources: [],
      ...over,
    },
    calls: mock.calls,
  };
}

const FOLDER_A = { id: '00000000-0000-4000-8000-0000000000f1', containerId: 'folder-test-a1' };
const FOLDER_B = { id: '00000000-0000-4000-8000-0000000000f2', containerId: 'folder-test-b2' };
const ORG_PARENT = { id: RM_ORG_ID, containerId: RM_ORG_CONTAINER, type: 'ORGANIZATION' };
const STAMP = '2026-11-02T19:14:39Z';

describe('STACKIT hierarchy node mapping (#3883)', () => {
  it('project, folder and parents entries keep the UUIDs; names stay native for the scan boundary; containerId and labels are left out', () => {
    expect(stackitProjectNode({ projectId: 'p', containerId: 'my-project-ab12', name: 'my-project', parent: { id: 'o', containerId: 'org-x', type: 'ORGANIZATION' }, labels: { a: 'b' }, lifecycleState: 'ACTIVE', creationTime: STAMP }))
      .toEqual({ id: 'p', kind: 'project', native_kind: 'stackit:project', parent: 'o', name: 'my-project', attributes: { lifecycleState: 'ACTIVE', creationTime: STAMP } });
    expect(stackitFolderNode({ folderId: 'f', containerId: 'c', name: 'fold', parent: { id: 'o', containerId: 'org-x', type: 'ORGANIZATION' }, updateTime: STAMP }))
      .toEqual({ id: 'f', kind: 'folder', native_kind: 'stackit:folder', parent: 'o', name: 'fold', attributes: { updateTime: STAMP } });
    expect(stackitAncestorNode({ id: 'f', parentId: 'o', name: 'n', type: 'FOLDER', containerId: 'c' })).toEqual({ id: 'f', kind: 'folder', native_kind: 'stackit:folder', parent: 'o', name: 'n' });
    expect(stackitAncestorNode({ id: 'o', type: 'ORGANIZATION' })).toEqual({ id: 'o', kind: 'organisation', native_kind: 'stackit:organization' });
    expect(stackitAncestorNode({ id: 'x', type: 'PROJECT' })).toBeUndefined();
  });

  it('the driver declares listHierarchy, the Resource Manager host and its route templates', () => {
    expect(stackitDriver.listHierarchy).toBe(listStackitHierarchy);
    expect(stackitDriver.defaultBaseUrls['resource-manager']).toBe(STACKIT_DEFAULT_RESOURCE_MANAGER);
    expect(STACKIT_DEFAULT_RESOURCE_MANAGER).toBe('https://resource-manager.api.stackit.cloud');
    expect(stackitDriver.routeTemplates).toEqual(expect.arrayContaining(Object.values(STACKIT_HIERARCHY_ROUTES)));
  });
});

describe('listStackitHierarchy against the in-process mock (#3883)', () => {
  it('live shape of 2026-11-05: the scope project under an organisation the key cannot read; unknown organisation, denied reads in sources', async () => {
    const { ctx, calls } = ctxFor();
    const h = prepareHierarchy(await listStackitHierarchy(ctx), SALT);
    expect(LzLiveHierarchySchema.safeParse(h).success).toBe(true);
    expect(h.nodes.map((n) => [n.kind, n.native_kind, n.status])).toEqual([['organisation', 'stackit:organization', 'unknown'], ['project', 'stackit:project', 'observed']]);
    expect(h.nodes[0]).toEqual({ id: RM_ORG_ID, kind: 'organisation', native_kind: 'stackit:organization', status: 'unknown', policy_refs: [] });
    expect(h.nodes[1]).toMatchObject({ id: PROJECT_ID, parent: RM_ORG_ID, attributes: { lifecycleState: 'ACTIVE' } });
    expect(h.nodes[1]?.label).toMatch(/^Node-[0-9a-f]{10}$/);
    expect(JSON.stringify(h)).not.toContain('test-project');
    expect(h.scope_node).toBe(PROJECT_ID);
    expect(h.source).toEqual({ calls: ['resource-manager:GET /v2/projects'], partial: true, status: 'ok' });
    expect(ctx.sources).toEqual([
      { name: 'hierarchy:organization', status: 'not_collected', http_status: 403 },
      { name: 'hierarchy:children', status: 'not_collected', http_status: 403 },
    ]);
    // Only Resource Manager reads, all GET; the project read GET /v2/projects/{id} is never sent.
    const rm = calls.filter((c) => c.url.startsWith(STACKIT_DEFAULT_RESOURCE_MANAGER));
    expect(rm.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /v2/projects', `GET /v2/organizations/${RM_ORG_CONTAINER}`, 'GET /v2/folders']);
    expect(new URL(rm[0]!.url).searchParams.get('member')).not.toBeNull();
  });

  it('nested folders: the parent folder read gives the chain; the organisation is the parent of the topmost folder; a platform scope walks the children', async () => {
    const a = { ...FOLDER_A, type: 'FOLDER' };
    const b = { ...FOLDER_B, type: 'FOLDER' };
    const folderA = { folderId: FOLDER_A.id, containerId: FOLDER_A.containerId, name: 'folder-a', parent: ORG_PARENT, labels: {}, creationTime: STAMP, updateTime: STAMP };
    const folderB = { folderId: FOLDER_B.id, containerId: FOLDER_B.containerId, name: 'folder-b', parent: a, labels: {}, creationTime: STAMP, updateTime: STAMP };
    const project = (n: number, parent: unknown) => ({ projectId: `00000000-0000-4000-8000-00000000000${n}`, containerId: `project-test000${n}`, name: `test-project-${n}`, parent, lifecycleState: 'ACTIVE', labels: {}, creationTime: STAMP, updateTime: STAMP });
    const opts: MockOptions = {
      rmProjects: [project(1, b)],
      rmFolders: { [FOLDER_B.containerId]: { ...folderB, parents: [{ id: FOLDER_A.id, containerId: FOLDER_A.containerId, name: 'folder-a', type: 'FOLDER', parentId: RM_ORG_ID, containerParentId: RM_ORG_CONTAINER }] } },
      rmOrganization: { organizationId: RM_ORG_ID, containerId: RM_ORG_CONTAINER, name: 'test-org', lifecycleState: 'ACTIVE', labels: {}, creationTime: STAMP, updateTime: STAMP },
      rmChildren: {
        [RM_ORG_CONTAINER]: { folders: [folderA], projects: [project(3, ORG_PARENT)] },
        [FOLDER_A.containerId]: { folders: [folderB], projects: [] },
        [FOLDER_B.containerId]: { folders: [], projects: [project(1, b)] },
      },
    };
    // Application scope: own project, folder B (read), folder A (chain), organisation (read); not partial.
    const app = ctxFor(opts, { scopeKind: 'application', scopeId: 'app1' });
    const ha = prepareHierarchy(await listStackitHierarchy(app.ctx), SALT);
    expect(LzLiveHierarchySchema.safeParse(ha).success).toBe(true);
    expect(ha.nodes.map((n) => [n.native_kind, n.status, n.parent])).toEqual([
      ['stackit:organization', 'observed', undefined],
      ['stackit:folder', 'observed', RM_ORG_ID],
      ['stackit:folder', 'observed', FOLDER_A.id],
      ['stackit:project', 'observed', FOLDER_B.id],
    ]);
    expect(ha.source.partial).toBe(false);
    expect(app.ctx.sources).toEqual([]);
    expect(app.calls.some((c) => new URL(c.url).searchParams.has('containerParentId'))).toBe(false);
    // Platform scope: also the children of the organisation and of each folder.
    const plat = ctxFor(opts);
    const hp = prepareHierarchy(await listStackitHierarchy(plat.ctx), SALT);
    expect(hp.nodes.filter((n) => n.kind === 'project').map((n) => n.id).sort()).toEqual([project(1, b).projectId, project(3, ORG_PARENT).projectId]);
    expect(hp.nodes.filter((n) => n.kind === 'folder')).toHaveLength(2);
    expect(hp.source).toEqual({ calls: ['resource-manager:GET /v2/projects', 'resource-manager:GET /v2/folders/{container_id}', 'resource-manager:GET /v2/organizations/{organization_id}', 'resource-manager:GET /v2/folders'], partial: false, status: 'ok' });
  });

  it('a parent folder the key cannot read is an unknown folder node, never guessed', async () => {
    const b = { ...FOLDER_B, type: 'FOLDER' };
    const { ctx } = ctxFor({ rmProjects: [{ projectId: PROJECT_ID, containerId: 'project-test0001', name: 'test-project', parent: b, lifecycleState: 'ACTIVE' }] }, { scopeKind: 'application', scopeId: 'app1' });
    const h = prepareHierarchy(await listStackitHierarchy(ctx), SALT);
    expect(h.nodes).toEqual([
      { id: FOLDER_B.id, kind: 'folder', native_kind: 'stackit:folder', status: 'unknown', policy_refs: [] },
      expect.objectContaining({ id: PROJECT_ID, parent: FOLDER_B.id, status: 'observed' }),
    ]);
    expect(h.source.partial).toBe(true);
    expect(ctx.sources).toEqual([{ name: 'hierarchy:folder', status: 'not_collected', http_status: 403 }]);
  });

  it('the member project list denied or without the scope project: the hierarchy source is not collected', async () => {
    const denied = ctxFor({ fail: { 'rm-list-projects': 403 } });
    await expect(listStackitHierarchy(denied.ctx)).rejects.toMatchObject({ name: 'LiveSourceUnavailableError', source: 'hierarchy', httpStatus: 403 });
    const other = ctxFor({ rmProjects: [] });
    await expect(listStackitHierarchy(other.ctx)).rejects.toMatchObject({ name: 'LiveSourceUnavailableError', source: 'hierarchy' });
  });
});

describe('STACKIT route keys stay unique per API (#3883, Lane C flag 2026-11-05)', () => {
  it('every route template the driver requests is served by one API host only', async () => {
    // Each API on its own host, as live; the recorder names a request by path only.
    const baseUrls = Object.fromEntries(Object.keys(stackitDriver.defaultBaseUrls).map((api) => [api, `https://${api}.test.invalid`]));
    const mock = makeStackitMock();
    const calls = mock.calls;
    const { ctx } = ctxFor({}, { http: { fetch: createReadOnlyFetch(mock.fetch, 'stackit', stackitDriver.readAllowList), baseUrls } });
    const swallow = async (f: () => Promise<unknown>): Promise<void> => { try { await f(); } catch { /* denied reads are fine here */ } };
    await swallow(() => stackitDriver.probeReadOnly(ctx));
    await swallow(() => stackitDriver.listRegions(ctx));
    await swallow(() => stackitDriver.listServices(ctx, 'eu01'));
    await swallow(() => stackitDriver.listResources(ctx));
    await swallow(() => stackitDriver.listQuotas(ctx, 'eu01'));
    await swallow(() => stackitDriver.listPosture!(ctx));
    await swallow(() => stackitDriver.listHierarchy!(ctx));
    // #3995: the route key is host-aware (record.ts routePathOf): the live host prefixes of the driver, moved to the test hosts.
    const apiOfHost = new Map(Object.entries(stackitDriver.defaultBaseUrls).map(([api, url]) => [new URL(url).hostname, api]));
    const testPrefixes = Object.fromEntries(Object.entries(stackitDriver.routeHostPrefixes ?? {}).map(([host, prefix]) => [`${apiOfHost.get(host)}.test.invalid`, prefix]));
    expect(Object.keys(testPrefixes)).toEqual(['sqlserver-flex.test.invalid']);
    const hostsByRoute = new Map<string, Set<string>>();
    for (const c of calls) {
      const u = new URL(c.url);
      const route = `${c.method} ${routeOf(routePathOf(u, testPrefixes), stackitDriver.routeTemplates)}`;
      hostsByRoute.set(route, (hostsByRoute.get(route) ?? new Set()).add(u.host));
    }
    expect(hostsByRoute.get('GET /v2/projects/{project_id}')).toEqual(new Set(['auditlog.test.invalid']));
    expect(hostsByRoute.get('GET /v2/projects')).toEqual(new Set(['resource-manager.test.invalid']));
    // #3995: PostgreSQL Flex and SQL Server Flex v3 share the request path, not the route key.
    expect(hostsByRoute.get('GET /v3/projects/{project_id}/regions/{region}/instances')).toEqual(new Set(['postgres-flex.test.invalid']));
    expect(hostsByRoute.get('GET /sqlserver-flex/v3/projects/{project_id}/regions/{region}/instances')).toEqual(new Set(['sqlserver-flex.test.invalid']));
    const shared = [...hostsByRoute].filter(([, hosts]) => hosts.size > 1).map(([r, hosts]) => `${r}: ${[...hosts].join(', ')}`);
    expect(shared).toEqual([]);
  });
});

