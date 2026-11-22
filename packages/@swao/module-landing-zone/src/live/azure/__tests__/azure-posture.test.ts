// #3868 (Design 123 section 5.4, Azure table): the Azure posture collectors;
// #3940: the activity log diagnostic settings and budgets. Mapping rules on Resource Graph rows with the properties of the resource
// provider definitions in azure-rest-api-specs (values synthetic), and
// `listPosture` against an in-process fake, including denied reads.
// Mock-verified only: no Azure environment answered any of this (Q-21).
// The run against the spec-derived mock pack over HTTPS is
// swao/ops/mock-csp/contract/azure-posture.contract.ts.
import { describe, expect, it } from 'vitest';
import { LzLivePostureSchema } from '@swao/core';
import { createReadOnlyFetch } from '../../http.js';
import { routeOf } from '../../record.js';
import type { FetchLike, ScopeCtx } from '../../types.js';
import { AZURE_BUDGETS_SOURCE, AZURE_POSTURE_ROUTES, AZURE_RECOVERY_QUERY, azureDriver, readAzureBudgets } from '../azure-driver.js';
import { atRestFacts, backupFacts, budgetFacts, budgetPostureItems, dailyRetentionDays, exposureFacts, inTransitFacts, ingressRules, loggingTrails, owningResource, tlsVersion } from '../azure-posture.js';

const SUB = '11111111-1111-1111-1111-111111111111';
const RG = `/subscriptions/${SUB}/resourceGroups/rg`;
const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const ACCESS = `${b64({ alg: 'none' })}.${b64({ oid: 'o', tid: 't' })}.sig`;

const row = (type: string, name: string, properties: Record<string, unknown>): Record<string, unknown> => {
  const [ns, t] = type.split('/') as [string, string];
  return { id: `${RG}/providers/${ns}/${t}/${name}`, name, type: type.toLowerCase(), location: 'germanywestcentral', properties };
};

describe('Azure posture mappings (#3868)', () => {
  it('TLS floors: TLS1_2 (Storage) and 1.2 (SQL, Redis); None and unknown values are no floor', () => {
    expect([tlsVersion('TLS1_0'), tlsVersion('TLS1_3'), tlsVersion('1.2'), tlsVersion('None'), tlsVersion('2.0'), tlsVersion(undefined)]).toEqual(['1.0', '1.3', '1.2', undefined, undefined, undefined]);
  });

  it('at rest: disk encryption type and set, storage key source and Key Vault key, PostgreSQL data encryption', () => {
    const out = atRestFacts([
      row('Microsoft.Compute/disks', 'd1', { encryption: { type: 'EncryptionAtRestWithPlatformKey' } }),
      row('Microsoft.Compute/disks', 'd2', { encryption: { type: 'EncryptionAtRestWithPlatformAndCustomerKeys', diskEncryptionSetId: 'des-1' } }),
      row('Microsoft.Compute/disks', 'd3', {}),
      row('Microsoft.Storage/storageAccounts', 's1', { encryption: { keySource: 'Microsoft.Keyvault', keyvaultproperties: { keyvaulturi: 'https://kv.invalid/', keyname: 'k' } } }),
      row('Microsoft.Storage/storageAccounts', 's2', { encryption: { keySource: 'Microsoft.Storage' } }),
      row('Microsoft.DBforPostgreSQL/flexibleServers', 'p1', { dataEncryption: { type: 'AzureKeyVault', primaryKeyURI: 'https://kv.invalid/keys/pk' } }),
      row('Microsoft.Network/virtualNetworks', 'v1', {}),
    ]);
    expect(out.map((e) => [e.resource_id.split('/').pop(), e.layer, e.encrypted, e.key_custody, e.key_id])).toEqual([
      ['d1', 'at_rest', true, 'provider-managed', undefined],
      ['d2', 'at_rest', true, 'customer-managed', 'des-1'],
      ['d3', 'at_rest', undefined, undefined, undefined],
      ['s1', 'at_rest', true, 'customer-managed', 'https://kv.invalid/keys/k'],
      ['s2', 'at_rest', true, 'provider-managed', undefined],
      ['p1', 'at_rest', true, 'customer-managed', 'https://kv.invalid/keys/pk'],
    ]);
    expect(out[0]).toMatchObject({ type: 'microsoft.compute/disks', service_code: 'microsoft.compute/disks', region: 'germanywestcentral', attributes: { encryption_type: 'EncryptionAtRestWithPlatformKey' } });
  });

  it('in transit: storage HTTPS only and TLS floor, SQL minimal TLS, Redis non-TLS port', () => {
    const out = inTransitFacts([
      row('Microsoft.Storage/storageAccounts', 's1', { minimumTlsVersion: 'TLS1_2', supportsHttpsTrafficOnly: true }),
      row('Microsoft.Storage/storageAccounts', 's2', { minimumTlsVersion: 'TLS1_0', supportsHttpsTrafficOnly: false }),
      row('Microsoft.Sql/servers', 'q1', { minimalTlsVersion: '1.2' }),
      row('Microsoft.Sql/servers', 'q2', { minimalTlsVersion: 'None' }),
      row('Microsoft.Cache/Redis', 'r1', { minimumTlsVersion: '1.2', enableNonSslPort: true }),
    ]);
    expect(out.map((e) => [e.resource_id.split('/').pop(), e.layer, e.encrypted, e.min_tls_version])).toEqual([
      ['s1', 'in_transit', true, '1.2'], ['s2', 'in_transit', false, '1.0'], ['q1', 'in_transit', true, '1.2'], ['q2', 'in_transit', undefined, undefined], ['r1', 'in_transit', false, '1.2'],
    ]);
  });

  it('exposure: public IPs bound to the owner of their ip configuration; storage with anonymous blob access on a public endpoint', () => {
    expect(owningResource('/x/networkInterfaces/nic1/ipConfigurations/ip1')).toBe('/x/networkInterfaces/nic1');
    expect(owningResource('/x/loadBalancers/lb1/frontendIPConfigurations/fe')).toBe('/x/loadBalancers/lb1');
    const out = exposureFacts([
      row('Microsoft.Network/publicIPAddresses', 'ip1', { ipConfiguration: { id: `${RG}/providers/Microsoft.Network/networkInterfaces/nic1/ipConfigurations/c1` } }),
      row('Microsoft.Network/publicIPAddresses', 'ip2', {}),
      row('Microsoft.Storage/storageAccounts', 's1', { allowBlobPublicAccess: true, publicNetworkAccess: 'Enabled' }),
      row('Microsoft.Storage/storageAccounts', 's2', { allowBlobPublicAccess: true, publicNetworkAccess: 'Disabled' }),
      row('Microsoft.Storage/storageAccounts', 's3', {}),
    ]);
    expect(out.map((e) => [e.resource_id.split('/').pop(), e.exposure, e.public, e.bound_to?.split('/').pop()])).toEqual([
      ['ip1', 'public_ip', true, 'nic1'], ['ip2', 'public_ip', true, undefined], ['s1', 'public_storage', true, undefined], ['s2', 'public_storage', false, undefined],
    ]);
  });

  it('ingress: inbound rules only; Internet and * are 0.0.0.0/0; service tags are no CIDR; plural prefixes and ranges expand; deny kept', () => {
    const rule = (properties: Record<string, unknown>) => ({ name: 'r', properties });
    const out = ingressRules([row('Microsoft.Network/networkSecurityGroups', 'nsg', { securityRules: [
      rule({ direction: 'Inbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: 'Internet', destinationPortRange: '22', priority: 100 }),
      rule({ direction: 'Inbound', access: 'Allow', protocol: '*', sourceAddressPrefixes: ['10.0.0.0/8', 'VirtualNetwork'], destinationPortRanges: ['80', '8000-8080'] }),
      rule({ direction: 'Inbound', access: 'Allow', protocol: 'Udp', sourceApplicationSecurityGroups: [{ id: 'asg-1' }], destinationPortRange: '*' }),
      rule({ direction: 'Inbound', access: 'Deny', protocol: '*', sourceAddressPrefix: '*', destinationPortRange: '*', priority: 4096 }),
      rule({ direction: 'Inbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: '*', destinationPortRange: 'bogus' }),
      rule({ direction: 'Outbound', access: 'Allow', protocol: '*', sourceAddressPrefix: '*', destinationPortRange: '*' }),
    ] })]);
    expect(out.map((r) => [r.protocol, r.port_from, r.port_to, r.remote_cidr, r.remote_group_id, r.action, r.attributes?.['source_service_tag']])).toEqual([
      ['tcp', 22, 22, '0.0.0.0/0', undefined, 'allow', undefined],
      ['any', 80, 80, '10.0.0.0/8', undefined, 'allow', undefined],
      ['any', 8000, 8080, '10.0.0.0/8', undefined, 'allow', undefined],
      ['any', 80, 80, undefined, undefined, 'allow', 'VirtualNetwork'],
      ['any', 8000, 8080, undefined, undefined, 'allow', 'VirtualNetwork'],
      ['udp', undefined, undefined, undefined, 'asg-1', 'allow', undefined],
      ['any', undefined, undefined, '0.0.0.0/0', undefined, 'deny', undefined],
    ]);
    expect(out[0]?.attributes).toEqual({ priority: 100 });
  });

  it('backup: a VM named by a protected item in an active state is protected with the daily retention of its policy', () => {
    const vm = (n: string) => row('Microsoft.Compute/virtualMachines', n, {});
    const vms = [vm('vm0'), vm('vm1'), vm('vm2'), vm('vm3')];
    const policy = { id: '/v/backupPolicies/P', type: 'microsoft.recoveryservices/vaults/backuppolicies', properties: { retentionPolicy: { dailySchedule: { retentionDuration: { count: 30, durationType: 'Days' } } } } };
    const item = (src: string, extra: Record<string, unknown>) => ({ id: `/v/items/${src}`, type: 'microsoft.recoveryservices/vaults/backupfabrics/protectioncontainers/protecteditems', properties: { sourceResourceId: src, ...extra } });
    const out = backupFacts(vms, [
      policy,
      item(String(vms[0]!['id']).toUpperCase(), { policyId: '/v/backuppolicies/p', protectionState: 'Protected' }),
      item(String(vms[1]!['id']), { policyId: '/v/backupPolicies/P', currentProtectionState: 'ProtectionStopped' }),
      item(String(vms[2]!['id']), { policyId: '/v/backupPolicies/missing', protectionState: 'IRPending' }),
    ]);
    expect(out.map((b) => [b.resource_id.split('/').pop(), b.protected, b.policy_id, b.retention_days])).toEqual([
      ['vm0', true, '/v/backuppolicies/p', 30], ['vm1', false, undefined, undefined], ['vm2', true, '/v/backupPolicies/missing', undefined], ['vm3', false, undefined, undefined],
    ]);
    expect(dailyRetentionDays({ properties: { retentionPolicy: { dailySchedule: { retentionDuration: { count: 4, durationType: 'Weeks' } } } } })).toBeUndefined();
  });
});

describe('Azure logging and budget mappings (#3940)', () => {
  const law = row('Microsoft.OperationalInsights/workspaces', 'law', { retentionInDays: 90 });
  const setting = (id: string, properties: Record<string, unknown>) => ({ id, name: id, properties });
  it('a setting with Administrative (or allLogs) and a destination is an enabled all-region trail; retention from the named workspace, matched case-insensitively', () => {
    const out = loggingTrails([
      setting('s1', { workspaceId: String(law['id']).toLowerCase(), logs: [{ category: 'Administrative', enabled: true }] }),
      setting('s2', { storageAccountId: 'st', logs: [{ category: 'Administrative', enabled: false }, { category: 'Security', enabled: true }] }),
      setting('s3', { logs: [{ category: 'Administrative', enabled: true }] }),
      setting('s4', { eventHubAuthorizationRuleId: 'eh', marketplacePartnerId: 'mp', logs: [{ categoryGroup: 'allLogs', enabled: true }] }),
      setting('s5', { workspaceId: 'other-workspace', logs: [{ category: 'Administrative', enabled: true }] }),
    ], [law]);
    expect(out).toEqual([
      { resource_id: 's1', all_regions: true, enabled: true, retention_days: 90, attributes: { destinations: 'workspaceId' } },
      { resource_id: 's2', all_regions: true, enabled: false, attributes: { destinations: 'storageAccountId' } },
      { resource_id: 's3', all_regions: true, enabled: false },
      { resource_id: 's4', all_regions: true, enabled: true, attributes: { destinations: 'eventHubAuthorizationRuleId,marketplacePartnerId' } },
      { resource_id: 's5', all_regions: true, enabled: true, attributes: { destinations: 'workspaceId' } },
    ]);
  });

  it('budgets: amount, grain, category, enabled notifications and their thresholds; contacts are dropped', () => {
    const out = budgetFacts([
      { id: 'b1', properties: { category: 'Cost', amount: 1000, timeGrain: 'Monthly', notifications: {
        a: { enabled: true, operator: 'GreaterThan', threshold: 100, contactEmails: ['finops@x.invalid'], contactRoles: ['Owner'], contactGroups: ['g'] },
        b: { enabled: true, operator: 'GreaterThan', threshold: 80, contactEmails: ['finops@x.invalid'] },
        c: { enabled: false, operator: 'GreaterThan', threshold: 50, contactEmails: ['finops@x.invalid'] },
      } } },
      { id: 'b2', properties: { amount: 5 } },
      { properties: {} },
    ]);
    expect(out).toEqual([
      { resource_id: 'b1', amount: 1000, time_grain: 'Monthly', category: 'Cost', notifications_enabled: 2, thresholds: [80, 100] },
      { resource_id: 'b2', amount: 5, notifications_enabled: 0, thresholds: [] },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/x\.invalid|Owner|contact/);
  });

  it('#3936: budget posture items: grain, unit, forecasted basis, recipients counted (contacts dropped), disabled alerts kept as disabled', () => {
    const out = budgetPostureItems([
      { id: 'b1', properties: { category: 'Cost', amount: 1000, timeGrain: 'BillingQuarter', currentSpend: { amount: 10, unit: 'EUR' }, notifications: {
        a: { enabled: true, operator: 'GreaterThan', threshold: 100, thresholdType: 'Forecasted', contactEmails: ['finops@x.invalid'], contactRoles: ['Owner'], contactGroups: ['g'] },
        c: { enabled: false, operator: 'GreaterThan', threshold: 50, contactEmails: ['finops@x.invalid'] },
      } } },
      { id: 'b2', properties: { category: 'Usage', amount: 5, timeGrain: 'Custom' } },
      { properties: {} },
    ], 'sub-1');
    expect(out).toEqual([
      { resource_id: 'b1', type: 'microsoft.consumption/budgets', scope: 'sub-1', budget_kind: 'cost', amount: 1000, currency: 'EUR', period: 'quarterly', alerts: [
        { threshold: 50, threshold_type: 'percentage', basis: 'actual', recipients: 1, enabled: false },
        { threshold: 100, threshold_type: 'percentage', basis: 'forecasted', recipients: 3, enabled: true },
      ] },
      { resource_id: 'b2', type: 'microsoft.consumption/budgets', scope: 'sub-1', budget_kind: 'usage', amount: 5, period: 'custom', alerts: [] },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/x\.invalid|Owner/);
  });
});

type Reply = { status: number; body?: unknown };
type Routes = { graph: (query: string) => Reply; diagnostic?: Reply; budgets?: Reply };
function fake(r: Routes | ((query: string) => Reply)): { ctx: ScopeCtx; calls: { method: string; path: string; query?: string }[] } {
  const routes: Routes = typeof r === 'function' ? { graph: r } : r;
  const calls: { method: string; path: string; query?: string }[] = [];
  const impl: FetchLike = async (url, init) => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    let reply: Reply;
    if (u.pathname.endsWith('/oauth2/v2.0/token')) reply = { status: 200, body: { token_type: 'Bearer', access_token: ACCESS } };
    else if (method === 'POST' && u.pathname === AZURE_POSTURE_ROUTES.resourceGraph) {
      const query = String((JSON.parse(init?.body ?? '{}') as { query?: unknown }).query);
      calls.push({ method, path: u.pathname, query });
      reply = routes.graph(query);
    } else if (method === 'GET' && u.pathname === `/subscriptions/${SUB}/providers/Microsoft.Insights/diagnosticSettings`) {
      calls.push({ method, path: u.pathname, query: u.searchParams.get('api-version') ?? '' });
      reply = routes.diagnostic ?? { status: 200, body: { value: [] } };
    } else if (method === 'GET' && u.pathname === `/subscriptions/${SUB}/providers/Microsoft.Consumption/budgets`) {
      calls.push({ method, path: u.pathname, query: u.searchParams.get('api-version') ?? '' });
      reply = routes.budgets ?? { status: 200, body: { value: [] } };
    } else {
      calls.push({ method, path: u.pathname });
      reply = { status: 404, body: {} };
    }
    const text = reply.body === undefined ? '' : JSON.stringify(reply.body);
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, headers: { get: () => null }, text: async () => text };
  };
  return {
    ctx: {
      lzId: 'az', provider: 'azure', scopeId: 'platform', scopeKind: 'platform', auth: 'service-principal-secret', regions: ['germanywestcentral'],
      target: { subscription: SUB },
      credentials: { 'tenant-id': 't', 'client-id': 'c', 'client-secret': ['fake', 'value'].join('-') },
      http: { fetch: createReadOnlyFetch(impl, 'azure', azureDriver.readAllowList, { routeOf: (p) => routeOf(p, azureDriver.routeTemplates) }), baseUrls: { login: 'https://login.mock.invalid', arm: 'https://arm.mock.invalid' } },
      sources: [],
    },
    calls,
  };
}

const LAW = row('Microsoft.OperationalInsights/workspaces', 'law', { retentionInDays: 60 });
const ESTATE = [
  row('Microsoft.Compute/virtualMachines', 'vm0', {}),
  row('Microsoft.Compute/disks', 'd1', { encryption: { type: 'EncryptionAtRestWithCustomerKey', diskEncryptionSetId: 'des' } }),
  row('Microsoft.Network/publicIPAddresses', 'ip1', {}),
  row('Microsoft.Network/networkSecurityGroups', 'nsg', { securityRules: [{ properties: { direction: 'Inbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: '*', destinationPortRange: '3389' } }] }),
  LAW,
];
const RECOVERY = [{ id: '/v/i', type: 'microsoft.recoveryservices/vaults/backupfabrics/protectioncontainers/protecteditems', properties: { sourceResourceId: ESTATE[0]!['id'], protectionState: 'Protected' } }];
const DIAG_ID = 'subscriptions/s/providers/AzureResourceManager/diagnosticSettings/ds';
const DIAG: Reply = { status: 200, body: { value: [{ id: DIAG_ID, name: 'ds', properties: { workspaceId: LAW['id'], logs: [{ category: 'Administrative', enabled: true }] } }] } };
const BUDGET_ID = `/subscriptions/${SUB}/providers/Microsoft.Consumption/budgets/b`;
const BUDGETS: Reply = { status: 200, body: { value: [{ id: BUDGET_ID, name: 'b', properties: { category: 'Cost', amount: 10, timeGrain: 'Monthly', timePeriod: { startDate: '2026-01-01' }, notifications: { n: { enabled: true, operator: 'GreaterThan', threshold: 80, contactEmails: ['a@x.invalid'] } } } }] } };
const graphOk = (q: string): Reply => ({ status: 200, body: { data: q === AZURE_RECOVERY_QUERY ? RECOVERY : ESTATE } });

describe('azure listPosture against a fake ARM (#3868, #3940)', () => {
  it('fills encryption, exposure, ingress, backup, logging and budgets (#3936); no identity block; one inventory read shared with listResources', async () => {
    const { ctx, calls } = fake({ graph: graphOk, diagnostic: DIAG, budgets: BUDGETS });
    expect(azureDriver.liveVerified).toBe(false);
    const p = LzLivePostureSchema.parse(await azureDriver.listPosture!(ctx));
    const ok = { calls: [AZURE_POSTURE_ROUTES.resourceGraph], partial: false, status: 'ok' };
    expect(p.encryption).toMatchObject({ source: ok, items: [{ key_custody: 'customer-managed', key_id: 'des' }] });
    expect(p.exposure?.items).toHaveLength(1);
    expect(p.ingress_rules?.items).toEqual([expect.objectContaining({ protocol: 'tcp', port_from: 3389, remote_cidr: '0.0.0.0/0', action: 'allow' })]);
    expect(p.backup).toMatchObject({ source: ok, items: [{ protected: true }] });
    expect(p.logging).toEqual({
      source: { calls: [AZURE_POSTURE_ROUTES.resourceGraph, AZURE_POSTURE_ROUTES.diagnosticSettings], partial: false, status: 'ok' },
      trails: [{ resource_id: DIAG_ID, all_regions: true, enabled: true, retention_days: 60, attributes: { destinations: 'workspaceId' } }],
    });
    expect(p.identity).toBeUndefined();
    expect(JSON.stringify(p)).not.toContain('x.invalid');
    expect(p.budgets).toEqual({
      source: { calls: [AZURE_POSTURE_ROUTES.budgets], partial: false, status: 'ok' },
      items: [{ resource_id: BUDGET_ID, type: 'microsoft.consumption/budgets', scope: SUB, budget_kind: 'cost', amount: 10, period: 'monthly', alerts: [{ threshold: 80, threshold_type: 'percentage', basis: 'actual', recipients: 1, enabled: true }] }],
    });
    await azureDriver.listResources(ctx);
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.query)).toEqual(['Resources', AZURE_RECOVERY_QUERY]);
    expect(calls.filter((c) => c.method === 'GET').map((c) => [c.path.split('/').pop(), c.query])).toEqual([['diagnosticSettings', '2021-05-01-preview'], ['budgets', '2026-06-01']]);
  });

  it('readAzureBudgets returns the budget facts without contacts', async () => {
    const { ctx } = fake({ graph: graphOk, budgets: BUDGETS });
    expect(await readAzureBudgets(ctx)).toEqual([{ resource_id: BUDGET_ID, amount: 10, time_grain: 'Monthly', category: 'Cost', notifications_enabled: 1, thresholds: [80] }]);
  });

  it('a denied Resource Graph read (403) makes every Resource Graph block not_collected; logging stays ok without the workspace retention (partial)', async () => {
    const { ctx } = fake({ graph: () => ({ status: 403, body: { error: { code: 'AuthorizationFailed', message: 'denied' } } }), diagnostic: DIAG });
    const p = LzLivePostureSchema.parse(await azureDriver.listPosture!(ctx));
    for (const b of [p.encryption, p.exposure, p.ingress_rules, p.backup]) expect(b).toEqual({ source: { calls: [AZURE_POSTURE_ROUTES.resourceGraph], partial: false, status: 'not_collected', http_status: 403 }, items: [] });
    expect(p.logging?.source).toEqual({ calls: [AZURE_POSTURE_ROUTES.diagnosticSettings], partial: true, status: 'ok' });
    expect(p.logging?.trails[0]).not.toHaveProperty('retention_days');
  });

  it('a denied diagnostic settings read (403) makes logging not_collected with the status; a denied budgets read makes the budgets block not_collected (#3936)', async () => {
    const { ctx } = fake({ graph: graphOk, diagnostic: { status: 403, body: {} }, budgets: { status: 403, body: {} } });
    const p = LzLivePostureSchema.parse(await azureDriver.listPosture!(ctx));
    expect(p.logging).toEqual({ source: { calls: [AZURE_POSTURE_ROUTES.diagnosticSettings], partial: false, status: 'not_collected', http_status: 403 }, trails: [] });
    expect(p.budgets).toEqual({ source: { calls: [AZURE_POSTURE_ROUTES.budgets], partial: false, status: 'not_collected', http_status: 403 }, items: [] });
    expect(p.encryption?.source.status).toBe('ok');
    expect(p.backup?.source.status).toBe('ok');
    // readAzureBudgets (#3940) still records its own source.
    await readAzureBudgets(ctx);
    expect(ctx.sources).toContainEqual({ name: AZURE_BUDGETS_SOURCE, status: 'not_collected', http_status: 403 });
  });

  it('a denied RecoveryServicesResources query leaves the other blocks ok and the backup block not_collected', async () => {
    const { ctx } = fake((q) => (q === AZURE_RECOVERY_QUERY ? { status: 403, body: {} } : { status: 200, body: { data: ESTATE } }));
    const p = LzLivePostureSchema.parse(await azureDriver.listPosture!(ctx));
    expect(p.encryption?.source.status).toBe('ok');
    expect(p.backup).toEqual({ source: { calls: [AZURE_POSTURE_ROUTES.resourceGraph], partial: false, status: 'not_collected', http_status: 403 }, items: [] });
  });

  it('a 401 on Resource Graph, diagnostic settings or budgets fails the run fast (LiveAuthError)', async () => {
    const cases: Routes[] = [{ graph: () => ({ status: 401, body: {} }) }, { graph: graphOk, diagnostic: { status: 401, body: {} } }, { graph: graphOk, budgets: { status: 401, body: {} } }];
    for (const r of cases) {
      const { ctx } = fake(r);
      await expect(azureDriver.listPosture!(ctx)).rejects.toMatchObject({ name: 'LiveAuthError' });
    }
  });

  it('the read-only guard lets only GET reach the diagnostic settings and budgets routes', async () => {
    const { ctx, calls } = fake({ graph: graphOk });
    for (const path of ['providers/Microsoft.Insights/diagnosticSettings', 'providers/Microsoft.Consumption/budgets']) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        await expect(ctx.http.fetch(`https://arm.mock.invalid/subscriptions/${SUB}/${path}?api-version=x`, { method, headers: {}, body: '{}' })).rejects.toThrow();
      }
    }
    expect(calls).toEqual([]);
    expect(azureDriver.routeTemplates).toEqual(expect.arrayContaining([AZURE_POSTURE_ROUTES.diagnosticSettings, AZURE_POSTURE_ROUTES.budgets]));
  });
});
