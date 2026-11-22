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

// #3880: estate.hierarchy through the scan assembler (pseudonymised labels),
// the scope merge (union by id, partial visibility), the run diff and the
// portfolio (one tree per landing zone) (Design 123 sections 5.6, 12).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore, deriveLzScanBaseFields, parseLzLiveScan } from '@swao/core';
import type { LzLiveHierarchyInput, LzLiveScan } from '@swao/core';
import { runLzLiveScan } from '../scan.js';
import { mergeLzLiveScopes } from '../merge.js';
import { mergeLzLiveHierarchy, prepareHierarchy, pseudonymiseNodeLabel } from '../hierarchy.js';
import { formatLzDiff, lzHierarchyChangeCounts } from '../run-diff.js';
import { lzPseudonymSalt } from '../privacy.js';
import { LiveSourceUnavailableError } from '../errors.js';
import { registerLiveLzDriver, unregisterLiveLzDriver } from '../registry.js';
import { computeLzLiveDiff, computeLzLiveHierarchyChanges } from '../../evaluate/lz-live-diff.js';
import type { DriverHierarchy } from '../types.js';
import { VERIFIED, makeFakeDriver, makeTransport } from './fake-driver.js';

const NOW = new Date('2026-11-05T12:00:00Z');
const SALT = 's'.repeat(64);
const L = (name: string): string => pseudonymiseNodeLabel(name, SALT);
const SRC = (...calls: string[]) => ({ calls });

function scan(o: { scopeId: string; kind?: 'platform' | 'application'; hierarchy?: LzLiveHierarchyInput }): LzLiveScan {
  const meta = {
    lz_id: 'aws-lab', provider: 'aws', scope_id: o.scopeId, scope_kind: o.kind ?? 'platform',
    observed_at: '2026-11-05T08:00:00Z', driver_version: '0.1.0', read_only: 'verified' as const, read_only_overrides: [],
    coverage: { readable: [], unreadable: [] }, frameworks: [], sources: [],
  };
  const offering = { regions: [{ id: 'eu-central-1', azs: [], status: 'enabled' as const }], services: [] };
  const estate = { resources: [], workloads: [], guardrails: [], quotas: [], checks: [] };
  return parseLzLiveScan({ ...deriveLzScanBaseFields({ meta, offering, estate }), collection_mode: 'live', confidence: 'observed', meta, offering, estate: { ...estate, ...(o.hierarchy ? { hierarchy: o.hierarchy } : {}) } });
}

/** Platform view: organisation > root > OU > two accounts. */
const PLATFORM_TREE: LzLiveHierarchyInput = {
  source: SRC('organizations:ListRoots', 'organizations:ListOrganizationalUnitsForParent', 'organizations:ListAccountsForParent'),
  scope_node: 'acct-mgmt',
  nodes: [
    { id: 'o-1', kind: 'organisation', native_kind: 'aws:organization', label: L('org') },
    { id: 'r-1', kind: 'root', native_kind: 'aws:root', parent: 'o-1', label: L('Root'), policy_refs: ['p-full'] },
    { id: 'ou-1', kind: 'organisational_unit', native_kind: 'aws:ou', parent: 'r-1', label: L('Workloads') },
    { id: 'acct-mgmt', kind: 'account', native_kind: 'aws:account', parent: 'r-1', label: L('management') },
    { id: 'acct-app', kind: 'account', native_kind: 'aws:account', parent: 'ou-1', label: L('app') },
  ],
};

/** Application view: its own account; the parent OU is not readable. */
const APP_TREE: LzLiveHierarchyInput = {
  source: { calls: ['organizations:DescribeAccount'], partial: true },
  scope_node: 'acct-app',
  nodes: [
    { id: 'ou-1', kind: 'organisational_unit', status: 'unknown' },
    { id: 'acct-app', kind: 'account', native_kind: 'aws:account', parent: 'ou-1', label: L('app'), policy_refs: ['p-local'] },
  ],
  resource_nodes: { 'arn:res-1': 'acct-app' },
};

describe('prepareHierarchy at the scan boundary (#3880)', () => {
  it('replaces native names by stable Node- labels, keeps unknown nodes to id and kind, filters attributes (#3886)', () => {
    const raw: DriverHierarchy = {
      source: SRC('iam:ListProjects'),
      nodes: [
        { id: 'dom-1', kind: 'organisation', name: 'Example Agency Tenant', attributes: { description: 'free text', status: 'ACTIVE', owner: 'someone@example.com' } },
        { id: 'p-1', kind: 'project', parent: 'dom-1', name: 'eu-de_payments', native_kind: 'otc:project' },
        { id: 'ep-9', kind: 'folder', status: 'unknown', name: 'hidden', parent: 'dom-1', policy_refs: ['x'], attributes: { status: 'x' } },
      ],
      scope_node: 'p-1',
    };
    const h = prepareHierarchy(raw, SALT);
    expect(h.nodes.map((n) => n.label)).toEqual([L('Example Agency Tenant'), L('eu-de_payments'), undefined]);
    expect(h.nodes[2]).toEqual({ id: 'ep-9', kind: 'folder', status: 'unknown', policy_refs: [] });
    expect(h.nodes[0]!.attributes).toEqual({ status: 'ACTIVE', owner: expect.stringMatching(/^Person-[0-9a-f]{10}$/) });
    const text = JSON.stringify(h);
    for (const name of ['Example Agency', 'payments', 'hidden', 'free text', 'example.com']) expect(text).not.toContain(name);
    expect(prepareHierarchy(raw, SALT).nodes[0]!.label).toBe(h.nodes[0]!.label);
    expect(prepareHierarchy(raw, 't'.repeat(64)).nodes[0]!.label).not.toBe(h.nodes[0]!.label);
  });

  it('an invalid tree from a driver is refused with the path', () => {
    expect(() => prepareHierarchy({ source: SRC('x'), nodes: [{ id: 'a', kind: 'account', parent: 'b' }] }, SALT)).toThrow(/invalid hierarchy: nodes: node a: parent b is not a node/);
  });
});

describe('scan assembler passes the driver hierarchy through (#3880)', () => {
  const tmp: string[] = [];
  const dir = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); tmp.push(d); return d; };
  beforeEach(() => unregisterLiveLzDriver());
  afterEach(() => { unregisterLiveLzDriver(); for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

  async function run(): Promise<{ scan: LzLiveScan; store: CredentialStore }> {
    const ws = dir('swao-tree-ws-');
    writeFileSync(join(ws, '.swao.yml'), ['name: demo', 'landing_zones:', '  - id: fake-prod', '    provider: fakecsp', '    scopes:', '      - id: platform', '        kind: platform', '        auth: aksk', '        regions: [eu-de]', ''].join('\n'));
    const store = new CredentialStore(dir('swao-tree-vault-'));
    await store.set('lz:fake-prod:platform:access-key-id', ['fake', 'ak'].join('-'));
    await store.set('lz:fake-prod:platform:secret-access-key', ['fake', 'sk'].join('-'));
    const out = await runLzLiveScan({ workspaceRoot: ws, lzId: 'fake-prod', store, env: {}, fetchImpl: makeTransport([]) });
    return { scan: out.results[0]!.scan!, store };
  }

  it('without listHierarchy the scan has no estate.hierarchy', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    expect('hierarchy' in (await run()).scan.estate).toBe(false);
  });

  it('listHierarchy lands in estate.hierarchy with labels keyed by the landing zone salt', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED, { listHierarchy: async () => ({ source: SRC('rm:ListFolders'), nodes: [{ id: 'org-1', kind: 'organisation', name: 'Tenant Name' }, { id: 'prj-1', kind: 'project', parent: 'org-1', name: 'Project Name' }], scope_node: 'prj-1' }) }));
    const { scan: s, store } = await run();
    const salt = await lzPseudonymSalt(store, 'fake-prod');
    expect(s.estate.hierarchy?.nodes.map((n) => n.label)).toEqual([pseudonymiseNodeLabel('Tenant Name', salt), pseudonymiseNodeLabel('Project Name', salt)]);
    expect(JSON.stringify(s)).not.toContain('Name');
    expect(s.meta.sources).toContainEqual({ name: 'hierarchy', status: 'ok' });
  });

  it('a denied hierarchy read is a not_collected source', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED, { listHierarchy: async () => { throw new LiveSourceUnavailableError('hierarchy', 403); } }));
    const { scan: s } = await run();
    expect('hierarchy' in s.estate).toBe(false);
    expect(s.meta.sources).toContainEqual({ name: 'hierarchy', status: 'not_collected', http_status: 403 });
  });
});

describe('scope merge of the tenant tree (#3880, Design 120 section 11.1)', () => {
  const merge = (scans: LzLiveScan[]) => mergeLzLiveScopes({ lzId: 'aws-lab', provider: 'aws', scans, now: NOW });

  it('two scopes union by id: the observed platform node replaces the unknown placeholder, policy refs join', () => {
    const m = merge([scan({ scopeId: 'app-a', kind: 'application', hierarchy: APP_TREE }), scan({ scopeId: 'platform', hierarchy: PLATFORM_TREE })]);
    const h = m.estate.hierarchy!;
    expect(h.nodes.map((n) => n.id)).toEqual(['o-1', 'r-1', 'ou-1', 'acct-mgmt', 'acct-app']);
    expect(h.nodes.find((n) => n.id === 'ou-1')).toMatchObject({ status: 'observed', parent: 'r-1', label: L('Workloads') });
    expect(h.nodes.find((n) => n.id === 'acct-app')?.policy_refs).toEqual(['p-local']);
    expect(h.scope_nodes).toEqual({ platform: 'acct-mgmt', 'app-a': 'acct-app' });
    expect(h.resource_nodes).toEqual({ 'arn:res-1': 'acct-app' });
    expect(h.source).toMatchObject({ status: 'ok', partial: true });
  });

  it('an application scope alone keeps the unknown parent; the merged source is partial', () => {
    const h = mergeLzLiveHierarchy([scan({ scopeId: 'app-a', kind: 'application', hierarchy: APP_TREE })])!;
    expect(h.nodes[0]).toEqual({ id: 'ou-1', kind: 'organisational_unit', status: 'unknown', policy_refs: [] });
    expect(h.source.partial).toBe(true);
  });

  it('a later scope never closes a cycle and never overrides a platform parent', () => {
    const a: LzLiveHierarchyInput = { source: SRC('x'), nodes: [{ id: 'f1', kind: 'folder' }, { id: 'f2', kind: 'folder', parent: 'f1' }] };
    const b: LzLiveHierarchyInput = { source: SRC('x'), nodes: [{ id: 'f2', kind: 'folder' }, { id: 'f1', kind: 'folder', parent: 'f2' }] };
    const h = merge([scan({ scopeId: 'platform', hierarchy: a }), scan({ scopeId: 'app-a', kind: 'application', hierarchy: b })]).estate.hierarchy!;
    expect(h.nodes.map((n) => [n.id, n.parent])).toEqual([['f1', undefined], ['f2', 'f1']]);
  });

  it('no scope with a tree: no hierarchy key in the merged view', () => {
    expect('hierarchy' in merge([scan({ scopeId: 'platform' })]).estate).toBe(false);
  });
});

describe('run diff of the tenant tree (#3880)', () => {
  it('new, removed and moved nodes; counts only in swao lz diff', () => {
    const prev = scan({ scopeId: 'platform', hierarchy: PLATFORM_TREE });
    const moved = PLATFORM_TREE.nodes!.filter((n) => n.id !== 'acct-mgmt').map((n) => (n.id === 'acct-app' ? { ...n, parent: 'r-1' } : n));
    const cur = scan({ scopeId: 'platform', hierarchy: { ...PLATFORM_TREE, scope_node: 'acct-app', nodes: [...moved, { id: 'ou-2', kind: 'organisational_unit', parent: 'r-1' }] } });
    const d = computeLzLiveDiff(cur, prev);
    expect(d.hierarchy_changes).toEqual([{ change: 'moved', ref: 'acct-app' }, { change: 'new', ref: 'ou-2' }, { change: 'removed', ref: 'acct-mgmt' }]);
    const counts = lzHierarchyChangeCounts(d.hierarchy_changes!);
    expect(counts).toEqual({ new: 1, removed: 1, moved: 1 });
    const lines = formatLzDiff({ lz_id: 'aws-lab', to_run: 'b', first_scans: [], scopes: [{ scope_id: 'platform', from_run: 'a', to_run: 'b', simulated: false, new_regions: [], new_services: [], new_resources: 0, removed_regions: [], removed_services: [], removed_resources: 0, status_changes: [], hierarchy_changes: counts }] });
    expect(lines).toContain('  hierarchy nodes: new 1, removed 1, moved 1');
    expect(lines.join('\n')).not.toContain('acct-');
  });

  it('no tree in either run: no key; a denied read in one run is no mass removal; unknown to observed is no move', () => {
    expect('hierarchy_changes' in computeLzLiveDiff(scan({ scopeId: 'platform' }), scan({ scopeId: 'platform' }))).toBe(false);
    const denied = scan({ scopeId: 'platform', hierarchy: { source: { calls: ['organizations:ListRoots'], status: 'not_collected', http_status: 403 }, nodes: [] } });
    expect(computeLzLiveDiff(denied, scan({ scopeId: 'platform', hierarchy: PLATFORM_TREE })).hierarchy_changes).toEqual([]);
    const before = scan({ scopeId: 'app-a', kind: 'application', hierarchy: APP_TREE }).estate.hierarchy;
    const after = { ...before!, nodes: before!.nodes.map((n) => (n.id === 'ou-1' ? { ...n, status: 'observed' as const, parent: undefined } : n)) };
    expect(computeLzLiveHierarchyChanges(after, before)).toEqual([]);
  });
});
