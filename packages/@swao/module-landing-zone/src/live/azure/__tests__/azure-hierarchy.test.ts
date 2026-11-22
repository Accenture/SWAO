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

// #3884: ResourceContainers rows to hierarchy nodes (Design 123 section 5.6).

import { describe, it, expect } from 'vitest';
import { lzLiveHierarchyProblems } from '@swao/core';
import { AZURE_HIERARCHY_QUERY, azureHierarchyFromRows, listAzureHierarchy, mgId } from '../azure-hierarchy.js';
import { azureDriver } from '../azure-driver.js';

const T = '00000000-0000-4000-8000-0000000000aa';
const S = '00000000-0000-4000-8000-0000000000bb';
const mg = (name: string, chain: string[]): Record<string, unknown> => ({
  id: mgId(name),
  name,
  type: 'microsoft.management/managementgroups',
  properties: { displayName: `display ${name}`, details: { managementGroupAncestorsChain: chain.map((n) => ({ name: n, displayName: `display ${n}` })) } },
});

describe('azureHierarchyFromRows (#3884)', () => {
  it('maps management groups, subscriptions and resource groups; the Tenant Root Group is the organisation', () => {
    const rows = [
      mg(T, []),
      mg('mg-a', [T]),
      { id: `/subscriptions/${S}`, name: 'sub', type: 'microsoft.resources/subscriptions', subscriptionId: S, properties: { state: 'Enabled', managementGroupAncestorsChain: [{ name: 'mg-a', displayName: 'x' }, { name: T, displayName: 'root' }] } },
      { id: `/subscriptions/${S}/resourceGroups/rg1`, name: 'rg1', type: 'microsoft.resources/subscriptions/resourcegroups', subscriptionId: S, location: 'germanywestcentral' },
    ];
    const t = azureHierarchyFromRows(rows, T, [{ id: `/subscriptions/${S}/resourcegroups/RG1/providers/Microsoft.Compute/disks/d1` }, { id: '/subscriptions/x/providers/Microsoft.Foo/bar' }]);
    expect(t.nodes.map((n) => [n.kind, n.native_kind, n.parent])).toEqual([
      ['organisation', 'azure:tenant-root-group', undefined],
      ['management_group', 'azure:management-group', mgId(T)],
      ['subscription', 'azure:subscription', mgId('mg-a')],
      ['resource_group', 'azure:resource-group', `/subscriptions/${S}`],
    ]);
    expect(t.nodes[1]).toMatchObject({ name: 'display mg-a', attributes: expect.objectContaining({ 'properties.displayName': 'display mg-a' }) });
    expect(t.partial).toBe(false);
    // Resource ids match the resource group case-insensitively and keep the node's spelling.
    expect(t.resource_nodes).toEqual({ [`/subscriptions/${S}/resourcegroups/RG1/providers/Microsoft.Compute/disks/d1`]: `/subscriptions/${S}/resourceGroups/rg1` });
    expect(lzLiveHierarchyProblems(t.nodes)).toEqual([]);
  });

  it('a subscription without an ancestor chain has no guessed parent; a resource group without its subscription row gets an unknown subscription', () => {
    const t = azureHierarchyFromRows([
      { id: `/subscriptions/${S}`, name: 'sub', type: 'microsoft.resources/subscriptions', subscriptionId: S, properties: {} },
      { id: '/subscriptions/other/resourceGroups/rg', name: 'rg', type: 'microsoft.resources/subscriptions/resourcegroups', subscriptionId: 'other' },
      { id: '/x', type: 'microsoft.something/else' },
    ], T);
    expect(t.nodes.find((n) => n.id === `/subscriptions/${S}`)?.parent).toBeUndefined();
    expect(t.nodes.find((n) => n.id === '/subscriptions/other')).toEqual({ id: '/subscriptions/other', kind: 'subscription', native_kind: 'azure:subscription', status: 'unknown' });
    expect(t.partial).toBe(true);
    expect(t.nodes).toHaveLength(3);
  });

  it('the driver declares listHierarchy, no new route (the Resource Graph POST is already allow-listed) and stays unverified', () => {
    expect(azureDriver.listHierarchy).toBe(listAzureHierarchy);
    expect(AZURE_HIERARCHY_QUERY).toBe('ResourceContainers');
    expect(azureDriver.routeTemplates).toContain('/providers/Microsoft.ResourceGraph/resources');
    expect(azureDriver.liveVerified).toBe(false);
  });
});
