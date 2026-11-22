// #3867 (Design 123 section 5.4, STACKIT table): the STACKIT posture
// collectors. Mapping rules on the shapes of the STACKIT API specifications
// and the live Reader run of 2026-11-05 (keys as specified or recorded,
// values synthetic), and `listPosture` against the in-process mock,
// including denied reads.
import { describe, it, expect } from 'vitest';
import { LzLivePostureSchema, parseLzLiveScan } from '@swao/core';
import { createReadOnlyFetch } from '../../http.js';
import type { ScopeCtx } from '../../types.js';
import { stackitDriver, STACKIT_AUDITLOG_UNANSWERED, STACKIT_DATA_ROUTES, STACKIT_POSTURE_ROUTES } from '../stackit-driver.js';
import { backupFacts, cdnInTransit, dataAtRest, dataBackup, exposureFacts, identityFacts, ingressRules, isReadOnlyRole, listenerFacts, volumeEncryption } from '../stackit-posture.js';
import { liveResourceCapabilityTags } from '../../resource-capabilities.js';
import { evalEncryptionAtRestEstate, evalEncryptionInTransit, evalNoPublicExposure } from '../../../evaluate/lz-baseline-posture.js';
import { makeStackitMock, serviceAccountKey } from './stackit-mock.js';
import type { MockOptions } from './stackit-mock.js';

function ctxFor(opts: MockOptions = {}): { ctx: ScopeCtx; calls: ReturnType<typeof makeStackitMock>['calls'] } {
  const mock = makeStackitMock(opts);
  return {
    ctx: {
      lzId: 'stackit-test', provider: 'stackit', scopeId: 'platform', scopeKind: 'platform', auth: 'key-flow', regions: ['eu01', 'eu02'], target: {},
      credentials: { 'service-account-key': serviceAccountKey() },
      http: { fetch: createReadOnlyFetch(mock.fetch, 'stackit', stackitDriver.readAllowList), baseUrls: { ...stackitDriver.defaultBaseUrls } },
      sources: [],
    },
    calls: mock.calls,
  };
}

const at = (region: string, item: Record<string, unknown>) => ({ region, item });

describe('STACKIT posture mappings (#3867)', () => {
  it('volumes: encrypted with a KMS key is customer-managed; the key protection is an attribute when the key list was read', () => {
    const out = volumeEncryption([
      at('eu01', { id: 'v1', encrypted: true, encryptionParameters: { kekKeyId: 'k1', kekKeyringId: 'r1', kekKeyVersion: 1 } }),
      at('eu01', { id: 'v2', encrypted: false }),
      at('eu02', { id: 'v3' }),
    ], new Map([['k1', 'hsm']]));
    expect(out).toEqual([
      { resource_id: 'v1', type: 'iaas.volume', service_code: 'iaas', region: 'eu01', layer: 'at_rest', encrypted: true, key_id: 'k1', key_custody: 'customer-managed', attributes: { kms_key_protection: 'hsm' } },
      { resource_id: 'v2', type: 'iaas.volume', service_code: 'iaas', region: 'eu01', layer: 'at_rest', encrypted: false },
      { resource_id: 'v3', type: 'iaas.volume', service_code: 'iaas', region: 'eu02', layer: 'at_rest' },
    ]);
  });

  it('load balancer listeners are in-transit entries that do not tell encryption (no TLS termination in the NLB API)', () => {
    const out = listenerFacts([at('eu01', { name: 'lb1', listeners: [{ name: 'l443', port: 443, protocol: 'PROTOCOL_TLS_PASSTHROUGH' }, { port: 80, protocol: 'PROTOCOL_TCP' }] })]);
    expect(out.map((e) => [e.resource_id, e.layer, e.encrypted, e.attributes?.['protocol']])).toEqual([['lb1/l443', 'in_transit', undefined, 'PROTOCOL_TLS_PASSTHROUGH'], ['lb1/80', 'in_transit', undefined, 'PROTOCOL_TCP']]);
  });

  it('exposure: public IPs (bound through networkInterface) and load balancers with an external address unless private-network-only', () => {
    const out = exposureFacts(
      [at('eu01', { id: 'ip1', networkInterface: 'nic1' }), at('eu01', { id: 'ip2', networkInterface: null })],
      [at('eu01', { name: 'lb1', externalAddress: '203.0.113.10' }), at('eu01', { name: 'lb2', options: { privateNetworkOnly: true } })],
    );
    expect(out.map((e) => [e.resource_id, e.exposure, e.public, e.bound_to])).toEqual([['ip1', 'public_ip', true, 'nic1'], ['ip2', 'public_ip', true, undefined], ['lb1', 'internet_endpoint', true, undefined], ['lb2', 'internet_endpoint', false, undefined]]);
  });

  it('ingress rules: inbound only; ipRange, remote group, or any source of the ethertype; protocol name or number; port range', () => {
    const out = ingressRules([at('eu01', { id: 'sg1', rules: [
      { direction: 'ingress', ethertype: 'IPv4', ipRange: '0.0.0.0/0', protocol: { name: 'tcp', number: 6 }, portRange: { min: 22, max: 22 } },
      { direction: 'ingress', ethertype: 'IPv6', remoteSecurityGroupId: 'sg1' },
      { direction: 'ingress', ethertype: 'IPv6', protocol: { number: 17 } },
      { direction: 'egress', ethertype: 'IPv4' },
    ] })]);
    expect(out.map((r) => [r.protocol, r.port_from, r.port_to, r.remote_cidr, r.remote_group_id, r.action])).toEqual([
      ['tcp', 22, 22, '0.0.0.0/0', undefined, 'allow'], ['any', undefined, undefined, undefined, 'sg1', 'allow'], ['17', undefined, undefined, '::/0', undefined, 'allow'],
    ]);
  });

  it('identity: members with a role that is not read-only are privileged; counts only; MFA not visible', () => {
    expect([isReadOnlyRole('reader'), isReadOnlyRole('iaas.reader'), isReadOnlyRole('owner'), isReadOnlyRole('editor')]).toEqual([true, true, false, false]);
    const facts = identityFacts([{ subject: 'a@x.invalid', role: 'owner' }, { subject: 'A@x.invalid', role: 'editor' }, { subject: 'b@x.invalid', role: 'reader' }, { subject: 'c@x.invalid', role: 'editor' }]);
    expect(facts).toEqual({ privileged_principals: 2, credentials: [] });
    expect(JSON.stringify(facts)).not.toContain('x.invalid');
  });

  it('backup: protected with an enabled schedule, longest retention; 404 (service not enabled) is unprotected', () => {
    const out = backupFacts([at('eu01', { id: 's1' }), at('eu01', { id: 's2' }), at('eu01', { id: 's3' })], new Map<string, Record<string, unknown>[] | undefined>([
      ['s1', [{ id: 1, enabled: true, backupProperties: { retentionPeriod: 7 } }, { id: 2, enabled: true, backupProperties: { retentionPeriod: 30 } }]],
      ['s2', [{ id: 3, enabled: false, backupProperties: { retentionPeriod: 90 } }]],
      ['s3', undefined],
    ]));
    expect(out.map((b) => [b.resource_id, b.protected, b.policy_id, b.retention_days])).toEqual([['s1', true, '1', 30], ['s2', false, undefined, undefined], ['s3', false, undefined, undefined]]);
  });
});

describe('stackit listPosture against the mock (#3867)', () => {
  const R = STACKIT_POSTURE_ROUTES;
  it('fills the blocks from iaas, KMS, load balancer, authorization and server-backup reads; only the token POST and GETs reach the wire', async () => {
    const { ctx, calls } = ctxFor({
      resources: {
        'volumes-eu01': [{ id: 'v1', encrypted: true, encryptionParameters: { kekKeyId: 'k1' } } as never],
        'servers-eu01': [{ id: 's1' }, { id: 's2' }],
        'public-ips-eu01': [{ id: 'ip1', networkInterface: 'nic1' } as never],
        'security-groups-eu01': [{ id: 'sg1', rules: [{ direction: 'ingress', ethertype: 'IPv4', ipRange: '0.0.0.0/0', protocol: { name: 'tcp' }, portRange: { min: 22, max: 22 } }] } as never],
      },
      keyRings: { eu01: [{ id: 'r1' }] },
      keys: { r1: [{ id: 'k1', protection: 'software' }] },
      loadBalancers: { eu01: [{ name: 'lb1', externalAddress: '203.0.113.10', listeners: [{ name: 'l1', port: 443, protocol: 'PROTOCOL_TLS_PASSTHROUGH' }] }] },
      members: [{ subject: 'o@x.invalid', role: 'owner' }, { subject: 'r@x.invalid', role: 'reader' }],
      auditStatus: 200,
      schedules: { s1: [{ id: 9, enabled: true, backupProperties: { retentionPeriod: 14 } }] },
    });
    const p = LzLivePostureSchema.parse(await stackitDriver.listPosture!(ctx));
    expect(p.encryption?.items.find((e) => e.resource_id === 'v1')).toMatchObject({ encrypted: true, key_custody: 'customer-managed', attributes: { kms_key_protection: 'software' } });
    expect(p.encryption?.items.find((e) => e.resource_id === 'lb1/l1')).toMatchObject({ layer: 'in_transit' });
    expect(p.exposure?.items.map((e) => e.resource_id)).toEqual(['ip1', 'lb1']);
    expect(p.ingress_rules?.items).toHaveLength(1);
    expect(p.identity).toMatchObject({ source: { status: 'ok', calls: [R.members] }, privileged_principals: 1 });
    expect(p.logging).toEqual({ source: { calls: [R.auditLog], partial: false, status: 'ok' }, trails: [{ all_regions: true, enabled: true }] });
    expect(p.backup?.items.map((b) => [b.resource_id, b.protected, b.retention_days])).toEqual([['s1', true, 14], ['s2', false, undefined]]);
    expect(calls.every((c) => c.method === 'GET' || c.path === '/oauth/v2/token')).toBe(true);
  });

  it('as live 2026-11-05: audit log 404 is not_collected with the status; members denied (403) is not_collected; KMS denied makes encryption partial', async () => {
    const { ctx } = ctxFor({ fail: { members: 403, 'kms-rings-eu01': 403, 'kms-rings-eu02': 403 } });
    const p = LzLivePostureSchema.parse(await stackitDriver.listPosture!(ctx));
    // #3955: the empty 404 carries why this key cannot read the audit log (not observable)
    expect(p.logging?.source).toEqual({ calls: [R.auditLog], partial: false, status: 'not_collected', http_status: 404, reason: STACKIT_AUDITLOG_UNANSWERED });
    expect(p.identity?.source).toMatchObject({ status: 'not_collected', http_status: 403 });
    expect(p.identity).not.toHaveProperty('privileged_principals');
    expect(p.encryption?.source).toMatchObject({ status: 'ok', partial: true });
  });

  it('a refused region read without the documented no-presence answer stays a partial read', async () => {
    const { ctx } = ctxFor({ fail: { 'iaas-public-ips-eu02': 404, 'lb-eu02': 403, 'iaas-security-groups-eu02': 404 } });
    const p = LzLivePostureSchema.parse(await stackitDriver.listPosture!(ctx));
    expect(p.exposure?.source).toMatchObject({ status: 'ok', partial: true });
    expect(p.ingress_rules?.source).toMatchObject({ status: 'ok', partial: true });
  });

  // #3955: the eu02 answers of the live Reader runs of 2026-11-06 (bodies as recorded, ids neutral).
  const IAAS_KINDS = ['servers', 'volumes', 'networks', 'public-ips', 'security-groups'];
  const NO_PRESENCE = { code: 404, msg: 'resource not found: project' };
  const LB_NOT_ENABLED = { timestamp: '2026-11-06T00:00:00Z', path: '/v2/projects/p/regions/eu02/load-balancers', status: 403, error: 'Forbidden', message: 'Service not enabled' };
  const eu02 = (state: string, lbBody: Record<string, unknown> = LB_NOT_ENABLED): MockOptions => ({
    fail: { ...Object.fromEntries(IAAS_KINDS.map((k) => [`iaas-${k}-eu02`, 404])), 'lb-eu02': 403 },
    failBody: { ...Object.fromEntries(IAAS_KINDS.map((k) => [`iaas-${k}-eu02`, NO_PRESENCE])), 'lb-eu02': lbBody },
    services: { eu02: [[{ serviceId: 'cloud.stackit.iaas', state }, { serviceId: 'cloud.stackit.loadbalancer', state }]] },
    resources: { 'security-groups-eu01': [{ id: 'sg1', rules: [{ direction: 'ingress', ethertype: 'IPv4', remoteSecurityGroupId: 'sg1' }] } as never] },
    auditStatus: 200,
  });

  it('#3955: a region whose Service Enablement shows iaas and loadbalancer DISABLED and that answers 404 project / 403 Service not enabled is an empty answered region', async () => {
    const { ctx, calls } = ctxFor(eu02('DISABLED'));
    const p = LzLivePostureSchema.parse(await stackitDriver.listPosture!(ctx));
    for (const b of [p.encryption, p.exposure, p.ingress_rules, p.backup]) {
      expect(b?.source).toMatchObject({ status: 'ok', partial: false });
      expect(b?.source.reason).toMatch(/^eu02: service not enabled for the project in the region \(Service Enablement DISABLED\); answered empty$/);
    }
    expect(p.ingress_rules?.items).toHaveLength(1);
    // one Service Enablement read for eu02, shared by the posture and the inventory
    const resources = await stackitDriver.listResources(ctx);
    expect(resources.map((r) => r.id)).toEqual(['sg1']);
    expect(ctx.sources.filter((s) => s.name.endsWith(':eu02'))).toEqual(IAAS_KINDS.map((k) => ({ name: `inventory:${k}:eu02`, status: 'ok', reason: 'service not enabled for the project in the region (Service Enablement DISABLED); answered empty' })));
    expect(calls.filter((c) => /\/regions\/eu02\/services$/.test(c.path))).toHaveLength(1);
  });

  it('#3955: the same answers stay partial when Service Enablement shows the service ENABLED, and a 403 "not allowed" stays partial', async () => {
    const enabled = LzLivePostureSchema.parse(await stackitDriver.listPosture!(ctxFor(eu02('ENABLED')).ctx));
    expect(enabled.ingress_rules?.source).toMatchObject({ status: 'ok', partial: true });
    expect(enabled.exposure?.source).toMatchObject({ status: 'ok', partial: true });
    const denied = LzLivePostureSchema.parse(await stackitDriver.listPosture!(ctxFor(eu02('DISABLED', { status: 403, error: 'Forbidden', message: 'You are not allowed to perform this action.' })).ctx));
    expect(denied.ingress_rules?.source).toMatchObject({ partial: false });
    expect(denied.exposure?.source).toMatchObject({ status: 'ok', partial: true });
    expect(denied.exposure?.source.reason).toBe('eu02: service not enabled for the project in the region (Service Enablement DISABLED); answered empty');
  });

  it('#3955: Service Enablement refused keeps the region partial', async () => {
    const o = eu02('DISABLED');
    const p = LzLivePostureSchema.parse(await stackitDriver.listPosture!(ctxFor({ ...o, fail: { ...o.fail, 'se-eu02': 403 } }).ctx));
    expect(p.ingress_rules?.source).toMatchObject({ status: 'ok', partial: true });
  });
});

// #3970 (Design 123 section 5.4): object storage, PostgreSQL Flex, MongoDB
// Flex, SFS and CDN. Shapes of the STACKIT API specifications (object-storage
// v2, postgres-flex v3, mongodb-flex v2, sfs v1, cdn v1) and the live Reader
// run of 2026-11-06 (bucket list 404 project.not_found, SFS eu02 closes the
// connection); values synthetic.
const PG_ID = '00000000-0000-4000-8000-0000000000c1';
const MONGO_ID = '00000000-0000-4000-8000-0000000000c2';
const PG = {
  id: PG_ID, name: 'pg-planted-name', state: 'READY', flavorId: '2.4', isDeletable: true, version: '17', retentionDays: 35, backupSchedule: '0 2 * * *',
  storage: { class: 'premium', size: 20 }, labels: { env: 'test' },
  connectionInfo: { write: { host: 'planted-host.example.invalid', port: 5432 } },
  network: { accessScope: 'PUBLIC', acl: ['198.51.100.0/24'], instanceAddress: '198.51.100.7' },
  encryption: { kekKeyId: 'k-pg', kekKeyRingId: 'r1', kekKeyVersion: '1', serviceAccount: 'planted-sa@sa.example.invalid' },
};
// #3995: SQL Server Flex v3 GetInstanceResponse (no encryption block: the read does not tell).
const MSSQL_ID = '00000000-0000-4000-8000-0000000000c3';
const MSSQL = {
  id: MSSQL_ID, name: 'mssql-planted-name', state: 'READY', flavorId: '4.16', isDeletable: true, edition: 'Standard', version: '2022', replicas: 1,
  retentionDays: 32, backupSchedule: '0 3 * * *', storage: { class: 'premium', size: 50 }, labels: { env: 'mssql' },
  network: { accessScope: 'SNA', acl: ['198.51.100.0/24'], instanceAddress: '198.51.100.8', routerAddress: '198.51.100.1' },
};
const MONGO = { id: MONGO_ID, name: 'mongo-1', status: 'READY', replicas: 1, version: '7.0', acl: { items: ['198.51.100.0/24'] }, backupSchedule: '' };
const BUCKET = { name: 'bucket-1', objectLockEnabled: true, region: 'eu01', urlPathStyle: 'https://object.storage.example.invalid/bucket-1', urlVirtualHostedStyle: 'https://bucket-1.object.storage.example.invalid' };
const POOLS: Record<string, unknown>[] = [
  { id: 'pool-1', name: 'pool-1', ipAcl: ['198.51.100.0/24'], mountPath: '198.51.100.9:/pool-1', snapshotPolicy: { id: 'sp-1', name: 'daily' }, state: 'created' },
  { id: 'pool-2', name: 'pool-2', state: 'created' },
];
const DIST = (tls10: boolean, tls11: boolean): Record<string, unknown> => ({
  id: `cdn-${tls10 ? 10 : tls11 ? 11 : 12}`, projectId: 'p', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', status: 'ACTIVE',
  domains: [{ name: 'planted.cdn.example.invalid', type: 'managed', status: 'ACTIVE', certificateType: 'managed' }],
  config: { regions: ['EU'], backend: { type: 'http', originUrl: 'https://planted-origin.example.invalid' }, tls: { enableTls10: tls10, enableTls11: tls11 }, waf: { mode: 'DISABLED', type: 'FREE', enabledRuleIds: [] }, labels: { team: 'a' } },
});

describe('STACKIT data service mappings (#3970)', () => {
  it('at rest: a PostgreSQL Flex KMS key is customer-managed; buckets, MongoDB Flex and SFS pools carry no encryption flag; addresses, URLs and the key service account are not copied', () => {
    const out = [
      ...dataAtRest('postgres-flex.instance', 'cloud.stackit.postgres-flex', [at('eu01', PG)]),
      ...dataAtRest('mongodb-flex.instance', 'cloud.stackit.mongodb-flex', [at('eu01', MONGO)]),
      ...dataAtRest('object-storage.bucket', 'cloud.stackit.object-storage', [at('eu01', BUCKET)]),
      ...dataAtRest('sfs.resource-pool', 'cloud.stackit.sfs', [at('eu01', POOLS[0] as Record<string, unknown>)]),
    ];
    expect(out.map((e) => [e.resource_id, e.type, e.layer, e.encrypted, e.key_custody, e.key_id])).toEqual([
      [PG_ID, 'postgres-flex.instance', 'at_rest', true, 'customer-managed', 'k-pg'],
      [MONGO_ID, 'mongodb-flex.instance', 'at_rest', undefined, undefined, undefined],
      ['bucket-1', 'object-storage.bucket', 'at_rest', undefined, undefined, undefined],
      ['pool-1', 'sfs.resource-pool', 'at_rest', undefined, undefined, undefined],
    ]);
    expect(out[2]?.attributes).toEqual({ objectLockEnabled: true });
    const text = JSON.stringify(out);
    for (const planted of ['planted-host', '198.51.100', 'planted-sa', 'object.storage.example', 'pg-planted-name']) expect(text, planted).not.toContain(planted);
  });

  it('backup: a Flex backupSchedule protects (PostgreSQL retentionDays is the retention); an empty schedule does not; an SFS snapshot policy protects', () => {
    const out = [
      ...dataBackup('postgres-flex.instance', 'cloud.stackit.postgres-flex', [at('eu01', PG)]),
      ...dataBackup('mongodb-flex.instance', 'cloud.stackit.mongodb-flex', [at('eu01', MONGO)]),
      ...dataBackup('sfs.resource-pool', 'cloud.stackit.sfs', POOLS.map((p) => at('eu01', p))),
    ];
    expect(out.map((b) => [b.resource_id, b.protected, b.retention_days, b.policy_id])).toEqual([
      [PG_ID, true, 35, undefined], [MONGO_ID, false, undefined, undefined], ['pool-1', true, undefined, 'sp-1'], ['pool-2', false, undefined, undefined],
    ]);
  });

  it('CDN: the TLS floor is the lowest enabled version, 1.2 by default; encryption itself stays absent; domains and origins are not copied', () => {
    const out = cdnInTransit([at('global', DIST(false, false)), at('global', DIST(false, true)), at('global', DIST(true, true)), at('global', { id: 'cdn-x', config: {} })]);
    expect(out.map((e) => [e.resource_id, e.layer, e.min_tls_version, e.encrypted, e.region])).toEqual([
      ['cdn-12', 'in_transit', '1.2', undefined, 'global'], ['cdn-11', 'in_transit', '1.1', undefined, 'global'], ['cdn-10', 'in_transit', '1.0', undefined, 'global'], ['cdn-x', 'in_transit', undefined, undefined, 'global'],
    ]);
    expect(JSON.stringify(out)).not.toContain('planted');
  });
});

/** A STACKIT scan of `resources` and `posture` whose offering enables `enabled` in eu01. */
function scanOf(resources: Awaited<ReturnType<typeof stackitDriver.listResources>>, posture: ReturnType<typeof LzLivePostureSchema.parse>, enabled: readonly string[], provider = 'stackit') {
  const T = '2026-11-06T10:00:00Z';
  return parseLzLiveScan({
    provider, collection_mode: 'live', confidence: 'observed', scanned_at: T,
    provenance: { source: 'live:stackit-test/platform' },
    meta: { lz_id: 'stackit-test', provider, scope_id: 'platform', scope_kind: 'platform', observed_at: T, driver_version: '0.1.0', read_only: 'verified', coverage: { readable: [], unreadable: [] },
      // #4026: a scan holds the service inventory source when listServiceResources ran (scan.ts records it).
      sources: [{ name: 'inventory:service-resources', status: 'ok' }] },
    offering: { regions: [], services: enabled.map((code) => ({ code, name: code, capability_tags: code.endsWith('object-storage') ? ['object_storage'] : code.endsWith('.cdn') ? ['cdn'] : [], regions: { eu01: { status: 'enabled', evidence: [{ source: 'api', ref: 'test' }], observed_at: T } }, frameworks: {} })) },
    estate: { resources, posture },
  });
}

describe('stackit data service reads against the mock (#3970)', () => {
  const D = STACKIT_DATA_ROUTES;
  const full: MockOptions = {
    buckets: { eu01: [BUCKET], eu02: null },
    postgres: { eu01: [PG] },
    mongodb: { eu01: [MONGO] },
    resourcePools: { eu01: POOLS },
    sfsClosed: ['eu02'],
    distributions: [DIST(false, false)],
    services: { eu02: [[{ serviceId: 'cloud.stackit.iaas', state: 'ENABLED' }]] },
  };

  it('inventory: one resource per bucket, instance, pool and distribution, typed and joined to the Service Enablement id, labels as tags; the documented absent answers are ok', async () => {
    const { ctx, calls } = ctxFor(full);
    const r = await stackitDriver.listServiceResources!(ctx);
    expect(r.map((x) => [x.type, x.id, x.service_code, x.region])).toEqual([
      ['object-storage.bucket', 'bucket-1', 'cloud.stackit.object-storage', 'eu01'],
      ['postgres-flex.instance', PG_ID, 'cloud.stackit.postgres-flex', 'eu01'],
      ['mongodb-flex.instance', MONGO_ID, 'cloud.stackit.mongodb-flex', 'eu01'],
      ['sfs.resource-pool', 'pool-1', 'cloud.stackit.sfs', 'eu01'],
      ['sfs.resource-pool', 'pool-2', 'cloud.stackit.sfs', 'eu01'],
      ['cdn.distribution', 'cdn-12', 'cloud.stackit.cdn', 'global'],
    ]);
    expect(r.find((x) => x.type === 'postgres-flex.instance')?.tags).toEqual({ env: 'test' });
    expect(r.find((x) => x.type === 'cdn.distribution')?.tags).toEqual({ team: 'a' });
    for (const t of new Set(r.map((x) => x.type))) expect(liveResourceCapabilityTags('stackit', t), t).toBeDefined();
    expect(JSON.stringify(r)).not.toMatch(/planted|198\.51\.100/);
    expect(ctx.sources.filter((s) => s.name.endsWith(':eu02'))).toEqual([
      { name: 'inventory:object-storage.bucket:eu02', status: 'ok', reason: 'object storage not enabled for the project in the region (bucket list 404 project.not_found); answered empty' },
      { name: 'inventory:sfs.resource-pool:eu02', status: 'ok', reason: 'file storage not offered for the project in the region (not in the Service Enablement list; the API closes the connection); answered empty' },
    ]);
    // the MongoDB Flex list sends the required tag (empty, as the STACKIT CLI does); only GETs and the token POST
    expect(calls.some((c) => /\/v2\/projects\/[^/]+\/regions\/eu01\/instances$/.test(c.path) && new URL(c.url).searchParams.get('tag') === '')).toBe(true);
    expect(calls.every((c) => c.method === 'GET' || c.path === '/oauth/v2/token')).toBe(true);
  });

  it('posture: the reads fill encryption (at rest and CDN in transit), backup and the exposure source; one read per list shared with the inventory', async () => {
    const { ctx, calls } = ctxFor(full);
    await stackitDriver.listServiceResources!(ctx);
    const p = LzLivePostureSchema.parse(await stackitDriver.listPosture!(ctx));
    expect(p.encryption?.items.filter((e) => e.type !== 'iaas.volume').map((e) => [e.type, e.layer])).toEqual([
      ['object-storage.bucket', 'at_rest'], ['postgres-flex.instance', 'at_rest'], ['mongodb-flex.instance', 'at_rest'], ['sfs.resource-pool', 'at_rest'], ['sfs.resource-pool', 'at_rest'], ['cdn.distribution', 'in_transit'],
    ]);
    expect(p.backup?.items.map((b) => [b.type, b.protected])).toEqual([['postgres-flex.instance', true], ['mongodb-flex.instance', false], ['sfs.resource-pool', true], ['sfs.resource-pool', false]]);
    for (const b of [p.encryption, p.exposure, p.backup]) expect(b?.source).toMatchObject({ status: 'ok', partial: false });
    expect(p.exposure?.source.calls).toContain(D.buckets);
    expect(p.encryption?.source.calls).toEqual(expect.arrayContaining([D.buckets, D.postgresInstances, D.postgresInstance, D.mongodbInstances, D.mongodbInstance, D.resourcePools, D.distributions]));
    expect(p.encryption?.source.reason).toContain('eu02: object storage not enabled for the project in the region');
    // 2 bucket, 2 PostgreSQL, 2 SQL Server (#3995), 2 MongoDB, 2 SFS (eu02 refused at the transport) and 1 CDN list reads, once each
    expect(calls.filter((c) => /\/(buckets|instances|resourcePools|distributions)$/.test(c.path))).toHaveLength(11);
  });

  it('a denied bucket list keeps encryption and exposure partial, so neither policy claims na', async () => {
    const { ctx } = ctxFor({ fail: { 'os-buckets-eu01': 403 }, failBody: { 'os-buckets-eu01': { detail: [{ key: 'auth.forbidden', msg: 'forbidden' }] } } });
    const resources = await stackitDriver.listServiceResources!(ctx);
    expect(ctx.sources.find((s) => s.name === 'inventory:object-storage.bucket:eu01')).toEqual({ name: 'inventory:object-storage.bucket:eu01', status: 'not_collected', http_status: 403 });
    const posture = LzLivePostureSchema.parse(await stackitDriver.listPosture!(ctx));
    expect(posture.exposure?.source).toMatchObject({ status: 'ok', partial: true });
    expect(posture.encryption?.source).toMatchObject({ status: 'ok', partial: true });
    const scan = scanOf(resources, posture, ['cloud.stackit.object-storage']);
    expect(evalNoPublicExposure(scan, ['load_balancer', 'waf', 'api_gateway'])).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
    expect(evalEncryptionAtRestEstate(scan, 'customer-managed', ['object_storage'])).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
    // without the refusal the same empty project is na
    const ok = ctxFor({});
    const okScan = scanOf(await stackitDriver.listServiceResources!(ok.ctx), LzLivePostureSchema.parse(await stackitDriver.listPosture!(ok.ctx)), ['cloud.stackit.object-storage']);
    expect(evalNoPublicExposure(okScan, ['load_balancer', 'waf', 'api_gateway'])).toMatchObject({ estate: 'na', observability: 'observed' });
    expect(evalEncryptionAtRestEstate(okScan, 'customer-managed', ['object_storage'])).toMatchObject({ estate: 'na', observability: 'observed' });
  });

  // #3995: SQL Server Flex v3 lists and reads instances on the paths of PostgreSQL Flex v3 (host mssql-flex-service).
  it('SQL Server Flex and PostgreSQL Flex on the same paths keep their own answers: inventory, encryption and backup per API', async () => {
    const { ctx, calls } = ctxFor({ postgres: { eu01: [PG] }, sqlserver: { eu01: [MSSQL] } });
    const r = await stackitDriver.listServiceResources!(ctx);
    expect(r.map((x) => [x.type, x.id, x.service_code])).toEqual([
      ['postgres-flex.instance', PG_ID, 'cloud.stackit.postgres-flex'],
      ['sqlserver-flex.instance', MSSQL_ID, 'cloud.stackit.sqlserver-flex'],
    ]);
    expect(liveResourceCapabilityTags('stackit', 'sqlserver-flex.instance')).toEqual(['sql_server']);
    expect(r.find((x) => x.type === 'sqlserver-flex.instance')?.tags).toEqual({ env: 'mssql' });
    expect(JSON.stringify(r)).not.toMatch(/planted|198\.51\.100/);
    const p = LzLivePostureSchema.parse(await stackitDriver.listPosture!(ctx));
    expect(p.encryption?.items.find((e) => e.resource_id === PG_ID)).toMatchObject({ type: 'postgres-flex.instance', encrypted: true, key_custody: 'customer-managed' });
    const mssqlEnc = p.encryption?.items.find((e) => e.resource_id === MSSQL_ID);
    expect(mssqlEnc).toMatchObject({ type: 'sqlserver-flex.instance', layer: 'at_rest' });
    expect(mssqlEnc).not.toHaveProperty('encrypted');
    expect(p.backup?.items.filter((b) => b.type.endsWith('-flex.instance')).map((b) => [b.type, b.protected, b.retention_days])).toEqual([
      ['postgres-flex.instance', true, 35], ['sqlserver-flex.instance', true, 32],
    ]);
    expect(p.encryption?.source.calls).toEqual(expect.arrayContaining([STACKIT_DATA_ROUTES.sqlserverInstances, STACKIT_DATA_ROUTES.sqlserverInstance, STACKIT_DATA_ROUTES.postgresInstances]));
    // the requests go to the SQL Server Flex host with the plain v3 path (the prefix is the route key only)
    const mssqlCalls = calls.filter((c) => new URL(c.url).hostname === 'mssql-flex-service.api.stackit.cloud');
    expect(mssqlCalls.map((c) => c.path)).toEqual(expect.arrayContaining([expect.stringMatching(/^\/v3\/projects\/[^/]+\/regions\/eu01\/instances$/), expect.stringMatching(new RegExp(`/v3/projects/[^/]+/regions/eu01/instances/${MSSQL_ID}$`))]));
    expect(mssqlCalls.every((c) => !c.path.startsWith('/sqlserver-flex'))).toBe(true);
  });

  it('a denied SQL Server Flex list keeps encryption and backup partial; PostgreSQL Flex still answers', async () => {
    const { ctx } = ctxFor({ postgres: { eu01: [PG] }, sqlserver: { eu01: [MSSQL] }, fail: { 'mssql-list-eu01': 403 } });
    const r = await stackitDriver.listServiceResources!(ctx);
    expect(r.map((x) => x.type)).toEqual(['postgres-flex.instance']);
    expect(ctx.sources.find((s) => s.name === 'inventory:sqlserver-flex.instance:eu01')).toMatchObject({ status: 'not_collected', http_status: 403 });
    const p = LzLivePostureSchema.parse(await stackitDriver.listPosture!(ctx));
    expect(p.encryption?.source).toMatchObject({ status: 'ok', partial: true });
    expect(p.backup?.source).toMatchObject({ status: 'ok', partial: true });
    expect(p.backup?.items.map((b) => b.type)).toEqual(['postgres-flex.instance']);
  });

  it('a denied PostgreSQL Flex instance read (GET) keeps encryption and backup partial; the listed instance stays in the inventory', async () => {
    const { ctx } = ctxFor({ postgres: { eu01: [PG] }, fail: { [`pg-get-eu01-${PG_ID}`]: 403 } });
    const resources = await stackitDriver.listServiceResources!(ctx);
    expect(resources.map((r) => r.id)).toEqual([PG_ID]);
    expect(ctx.sources.find((s) => s.name === 'inventory:postgres-flex.instance:eu01:detail')).toMatchObject({ status: 'not_collected', http_status: 403 });
    const p = LzLivePostureSchema.parse(await stackitDriver.listPosture!(ctx));
    expect(p.backup?.source).toMatchObject({ status: 'ok', partial: true });
    expect(p.encryption?.source).toMatchObject({ status: 'ok', partial: true });
    expect(p.backup?.items.find((b) => b.resource_id === PG_ID)).toMatchObject({ protected: false });
  });

  it('the absent answers need their pair: a 404 with another key, or SFS closing in a region whose Service Enablement names SFS, stay failed reads', async () => {
    const { ctx } = ctxFor({
      fail: { 'os-buckets-eu02': 404 }, failBody: { 'os-buckets-eu02': { detail: [{ key: 'bucket.not_found', msg: 'x' }] } },
      sfsClosed: ['eu02'], services: { eu02: [[{ serviceId: 'cloud.stackit.sfs', state: 'ENABLED' }]] },
    });
    await stackitDriver.listServiceResources!(ctx);
    expect(ctx.sources.filter((s) => s.name.endsWith(':eu02')).map((s) => [s.name, s.status])).toEqual([
      ['inventory:object-storage.bucket:eu02', 'not_collected'], ['inventory:sfs.resource-pool:eu02', 'not_collected'],
    ]);
    const p = LzLivePostureSchema.parse(await stackitDriver.listPosture!(ctx));
    expect(p.exposure?.source).toMatchObject({ partial: true });
    expect(p.backup?.source).toMatchObject({ partial: true });
  });

  it('CDN TLS floor below the minimum fails encryption_in_transit; at 1.2 it is not_observable (plain HTTP handling not shown)', async () => {
    const weak = ctxFor({ distributions: [DIST(true, true)] });
    const pw = LzLivePostureSchema.parse(await stackitDriver.listPosture!(weak.ctx));
    expect(evalEncryptionInTransit(scanOf([], pw, []), '1.2', ['cdn'], 'not_collected')).toMatchObject({ estate: 'fail', observability: 'observed' });
    // the floor rule is STACKIT's: another provider keeps the pass-through rule for an item without `encrypted`
    const other = evalEncryptionInTransit(scanOf([], pw, ['cloud.stackit.cdn'], 'azure'), '1.2', ['cdn'], 'not_collected');
    expect(other.estate).toBe('unverified');
    expect(other.detail).toContain('pass-through');
    const def = ctxFor({ distributions: [DIST(false, false)] });
    const pd = LzLivePostureSchema.parse(await stackitDriver.listPosture!(def.ctx));
    const o = evalEncryptionInTransit(scanOf([], pd, []), '1.2', ['cdn'], 'not_collected');
    expect(o).toMatchObject({ estate: 'unverified', observability: 'not_observable' });
    expect(o.detail).toContain('1 with a TLS floor of 1.2 or higher, but whether plain HTTP is refused is not observable');
  });
});
