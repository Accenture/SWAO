// #3865 (Design 123 section 5.4, OTC table): the OTC posture collectors.
// Mapping rules on document shapes as the live operator run of 2026-11-05
// returned them (keys as recorded, values synthetic), and `listPosture`
// against the in-process mock, including denied reads.
import { describe, it, expect } from 'vitest';
import { LzLivePostureSchema } from '@swao/core';
import { createReadOnlyFetch } from '../../http.js';
import type { ScopeCtx } from '../../types.js';
import { otcDriver, OTC_POSTURE_ROUTES } from '../otc-driver.js';
import { backupFacts, elbInTransit, evsEncryption, exposureFacts, identityFacts, ingressRules, loggingTrails, rdsEncryption, tlsFloor } from '../otc-posture.js';
import type { RmsResource } from '../otc-posture.js';
import { ADMIN_ROLE, MOCK_TEMP_AK, MOCK_TEMP_TOKEN, READONLY_ROLE, makeOtcMock } from './otc-mock.js';
import type { MockOptions } from './otc-mock.js';

const USERNAME = ['mock', 'user'].join('-');
const PASSWORD = ['mock', 'pass', 'value'].join('-');
const DOMAIN = ['MOCK', 'DOMAIN'].join('-');
const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const DAY = 86_400_000;

function ctxFor(opts: MockOptions = {}): { ctx: ScopeCtx; calls: ReturnType<typeof makeOtcMock>['calls'] } {
  const mock = makeOtcMock(opts);
  return {
    ctx: {
      lzId: 'otc-test', provider: 'otc', scopeId: 'platform', scopeKind: 'platform', auth: 'iam-password-token', regions: ['eu-de', 'eu-nl'], target: {},
      credentials: { username: USERNAME, password: PASSWORD, domain: DOMAIN },
      http: { fetch: createReadOnlyFetch(mock.fetch, 'otc', otcDriver.readAllowList), baseUrls: { ...otcDriver.defaultBaseUrls } },
      sources: [],
    },
    calls: mock.calls,
  };
}

const VOL: RmsResource = { id: 'vol-1', provider: 'evs', type: 'volumes', region_id: 'eu-de', properties: { encrypted: true, metadata: { __system__cmkid: 'kms-key-1', readonly: 'False' } } };
const VOL_PLAIN: RmsResource = { id: 'vol-2', provider: 'evs', type: 'volumes', region_id: 'eu-nl', properties: { encrypted: false, metadata: { readonly: 'False' } } };
const SERVER: RmsResource = { id: 'srv-1', provider: 'ecs', type: 'cloudservers', region_id: 'eu-de', properties: {} };
const EIP: RmsResource = { id: 'eip-1', provider: 'vpc', type: 'publicips', region_id: 'eu-de', properties: { associateInstanceId: 'port-1', associateInstanceType: 'PORT', type: 'EIP', status: 'ACTIVE' } };
const EIP_FREE: RmsResource = { id: 'eip-2', provider: 'vpc', type: 'publicips', region_id: 'eu-de', properties: { status: 'DOWN' } };
const LB: RmsResource = { id: 'lb-1', provider: 'elb', type: 'loadbalancers', region_id: 'eu-de', properties: { eips: [{ eip_id: 'eip-9', ip_version: 4 }], publicips: [] } };
const LB_PRIVATE: RmsResource = { id: 'lb-2', provider: 'elb', type: 'loadbalancers', region_id: 'eu-de', properties: { eips: [], publicips: [] } };
const SG: RmsResource = {
  id: 'sg-1', provider: 'vpc', type: 'securityGroups', region_id: 'eu-de',
  properties: {
    security_group_rules: [
      { direction: 'ingress', ethertype: 'IPv4', protocol: 'tcp', port_range_min: 22, port_range_max: 22, remote_ip_prefix: '0.0.0.0/0', remote_group_id: null, action: 'allow' },
      { direction: 'ingress', ethertype: 'IPv6', protocol: null, port_range_min: null, port_range_max: null, remote_ip_prefix: null, remote_group_id: null },
      { direction: 'ingress', ethertype: 'IPv4', protocol: 'tcp', port_range_min: 443, port_range_max: 443, remote_ip_prefix: null, remote_group_id: 'sg-2' },
      { direction: 'egress', ethertype: 'IPv4', protocol: null, remote_ip_prefix: '0.0.0.0/0' },
      { direction: 'ingress', ethertype: 'IPv4', protocol: 'tcp', port_range_min: 3389, port_range_max: 3389, remote_ip_prefix: '10.0.0.0/8', action: 'deny' },
    ],
  },
};
const user = (id: string, groups: string[], mfa: { vmfa?: boolean; protect?: boolean }, keys: { status: string; created: string }[] = []): RmsResource => ({
  id, provider: 'iam', type: 'users', region_id: 'global',
  properties: { group_list: groups, virtual_mfa_device: mfa.vmfa ?? false, login_protect: { enabled: mfa.protect ?? false, verification_method: 'email' }, credentials: keys.map((k) => ({ access: 'MOCKAK', status: k.status, create_time: k.created })) },
});

describe('OTC posture mappings (#3865)', () => {
  it('EVS encryption from RMS: encrypted flag and the KMS key of metadata.__system__cmkid', () => {
    expect(evsEncryption([VOL, VOL_PLAIN, SERVER])).toEqual([
      { resource_id: 'vol-1', type: 'evs.volumes', service_code: 'evs', region: 'eu-de', layer: 'at_rest', encrypted: true, key_id: 'kms-key-1' },
      { resource_id: 'vol-2', type: 'evs.volumes', service_code: 'evs', region: 'eu-nl', layer: 'at_rest', encrypted: false },
    ]);
  });

  it('RDS encryption: disk_encryption_id present means encrypted with that key', () => {
    const out = rdsEncryption([{ id: 'db-1', disk_encryption_id: 'kms-key-2', datastore: { type: 'PostgreSQL' } }, { id: 'db-2', disk_encryption_id: '' }], 'eu-de');
    expect(out.map((e) => [e.resource_id, e.encrypted, e.key_id])).toEqual([['db-1', true, 'kms-key-2'], ['db-2', false, undefined]]);
    expect(out[0]?.attributes).toEqual({ 'datastore.type': 'PostgreSQL' });
  });

  it('ELB listeners: TLS policy floor; HTTP not encrypted; TCP does not tell', () => {
    expect([tlsFloor('tls-1-2-strict'), tlsFloor('tls-1-0-with-1-3'), tlsFloor('tls-1-3'), tlsFloor('tls-1-1'), tlsFloor('hybrid-policy-1-0'), tlsFloor('custom'), tlsFloor(undefined)]).toEqual(['1.2', '1.0', '1.3', '1.1', '1.0', undefined, undefined]);
    const out = elbInTransit([
      { id: 'l-1', protocol: 'TERMINATED_HTTPS', tls_ciphers_policy: 'tls-1-2' },
      { id: 'l-2', protocol: 'HTTPS', tls_ciphers_policy: null },
      { id: 'l-3', protocol: 'HTTP' },
      { id: 'l-4', protocol: 'TCP', tls_ciphers_policy: null },
    ], 'eu-de');
    expect(out.map((e) => [e.resource_id, e.encrypted, e.min_tls_version])).toEqual([['l-1', true, '1.2'], ['l-2', true, '1.0'], ['l-3', false, undefined], ['l-4', undefined, undefined]]);
    expect(out.every((e) => e.layer === 'in_transit')).toBe(true);
  });

  it('#3930: the tenant domain and project ids that posture documents repeat are not copied into attributes', () => {
    const [l] = elbInTransit([{ id: 'l-1', protocol: 'HTTPS', tls_ciphers_policy: 'tls-1-2', project_id: 'p-native', admin_state_up: true }], 'eu-de');
    expect(l?.attributes).toEqual({ protocol: 'HTTPS', admin_state_up: true });
    const [r] = rdsEncryption([{ id: 'r-1', disk_encryption_id: 'k-1', project_id: 'p-native', region: 'eu-de', status: 'ACTIVE' }], 'eu-de');
    expect(JSON.stringify(r)).not.toContain('p-native');
  });

  it('exposure: EIPs are public (bound_to when associated); a load balancer is public with an EIP', () => {
    expect(exposureFacts([EIP, EIP_FREE, LB, LB_PRIVATE, VOL]).map((e) => [e.resource_id, e.exposure, e.public, e.bound_to])).toEqual([
      ['eip-1', 'public_ip', true, 'port-1'], ['eip-2', 'public_ip', true, undefined], ['lb-1', 'internet_endpoint', true, undefined], ['lb-2', 'internet_endpoint', false, undefined],
    ]);
  });

  it('#3953: a port-bound EIP is bound to the port owner (server of a compute port, instance of a VIP port) with its type', () => {
    const port = (id: string, vnic: Record<string, unknown>): RmsResource => ({ id, provider: 'vpc', type: 'publicips', region_id: 'eu-de', properties: { associateInstanceId: `port-${id}`, associateInstanceType: 'PORT', vnic } });
    const facts = exposureFacts([
      port('a', { deviceOwner: 'compute:eu-de-01', deviceId: 'srv-1', instanceId: '', portId: 'port-a' }),
      port('b', { deviceOwner: 'neutron:VIP_PORT', deviceId: '', instanceId: 'cce-1', instanceType: 'CCE' }),
      port('c', { deviceOwner: 'neutron:VIP_PORT', deviceId: '', instanceId: '' }),
      port('d', { deviceOwner: 'neutron:LOADBALANCERV2', deviceId: 'lb-7' }),
      { id: 'e', provider: 'vpc', type: 'publicips', region_id: 'eu-de', properties: { associateInstanceId: 'lb-8', associateInstanceType: 'ELB', vnic: { deviceOwner: 'neutron:LOADBALANCERV2' } } },
    ]);
    expect(facts.map((f) => [f.resource_id, f.bound_to, f.attributes?.['bound_type']])).toEqual([
      ['a', 'srv-1', 'ecs.cloudservers'], ['b', 'cce-1', undefined], ['c', 'port-c', undefined], ['d', 'lb-7', 'elb.loadbalancers'], ['e', 'lb-8', undefined],
    ]);
    expect(facts[0]?.attributes).toMatchObject({ device_owner: 'compute:eu-de-01', associate_instance_type: 'PORT' });
  });

  it('ingress rules: inbound only; no remote means any source of the ethertype; null protocol and ports are any; deny kept', () => {
    expect(ingressRules([SG]).map((r) => ({ p: r.protocol, f: r.port_from, t: r.port_to, c: r.remote_cidr, g: r.remote_group_id, a: r.action }))).toEqual([
      { p: 'tcp', f: 22, t: 22, c: '0.0.0.0/0', g: undefined, a: 'allow' },
      { p: 'any', f: undefined, t: undefined, c: '::/0', g: undefined, a: 'allow' },
      { p: 'tcp', f: 443, t: 443, c: undefined, g: 'sg-2', a: 'allow' },
      { p: 'tcp', f: 3389, t: 3389, c: '10.0.0.0/8', g: undefined, a: 'deny' },
    ]);
  });

  it('identity: privileged users by group, MFA as a virtual MFA device or login protection; access key ages; no principal', () => {
    const users = [
      user('u1', ['g-admin'], { vmfa: true }, [{ status: 'active', created: new Date(NOW - 100 * DAY).toISOString() }]),
      user('u2', ['g-admin', 'g-read'], { protect: true }),
      user('u3', ['g-admin'], {}, [{ status: 'inactive', created: '2026-10-06T12:00:00.000000' }]),
      user('u4', ['g-read'], {}),
    ];
    const facts = identityFacts({ users, privilegedGroups: new Set(['g-admin']), now: NOW });
    expect(facts).toEqual({
      privileged_principals: 3, privileged_without_mfa: 1, mfa_required_for_privileged: false,
      credentials: [{ kind: 'access_key', active: true, age_days: 100 }, { kind: 'access_key', active: false, age_days: 30 }],
    });
    expect(JSON.stringify(facts)).not.toMatch(/u1|u2|g-admin|MOCKAK/);
    // role queries not readable: no privileged counts, ages still reported
    expect(identityFacts({ users, privilegedGroups: undefined, now: NOW })).toEqual({ credentials: facts.credentials });
  });

  it('logging: one trail per tracker; OBS transfer lifecycle in days is the retention', () => {
    const trails = loggingTrails([
      { id: 't-1', tracker_type: 'system', status: 'enabled', obs_info: { bucket_lifecycle: 30, bucket_name: 'b' }, lts: { is_lts_enabled: true } },
      { id: 't-2', tracker_type: 'system', status: 'disabled', obs_info: { bucket_lifecycle: 0 } },
    ], 'eu-de');
    expect(trails.map((t) => [t.resource_id, t.region, t.enabled, t.retention_days])).toEqual([['t-1', 'eu-de', true, 30], ['t-2', 'eu-de', false, undefined]]);
    expect(trails[0]?.attributes?.['lts.is_lts_enabled']).toBe(true);
  });

  it('backup: servers and disks protected when a vault lists them; policy and retention from the associated backup policy', () => {
    const vaults = [{ id: 'v-1', resources: [{ id: 'srv-1', type: 'OS::Nova::Server' }] }];
    const policies = [
      { id: 'p-repl', operation_type: 'replication', associated_vaults: [{ vault_id: 'v-1' }] },
      { id: 'p-1', operation_type: 'backup', operation_definition: { retention_duration_days: 14 }, associated_vaults: [{ vault_id: 'v-1' }] },
    ];
    expect(backupFacts([SERVER, VOL, EIP], vaults, policies)).toEqual([
      { resource_id: 'srv-1', type: 'ecs.cloudservers', service_code: 'ecs', region: 'eu-de', protected: true, policy_id: 'p-1', retention_days: 14 },
      { resource_id: 'vol-1', type: 'evs.volumes', service_code: 'evs', region: 'eu-de', protected: false },
    ]);
  });
});

const ESTATE = [VOL, VOL_PLAIN, SERVER, EIP, LB, SG, user('u1', ['g-1'], { vmfa: true }), user('u2', ['g-1'], {})];

describe('otc listPosture against the mock (#3865)', () => {
  it('fills every block from RMS, ELB, RDS, CTS and CBR reads through the read-only allow-list; the result validates', async () => {
    const { ctx, calls } = ctxFor({
      resourcesPages: [ESTATE as unknown[]],
      roles: [ADMIN_ROLE],
      listeners: [{ id: 'l-1', protocol: 'TERMINATED_HTTPS', tls_ciphers_policy: 'tls-1-2' }],
      rdsInstances: [{ id: 'db-1', disk_encryption_id: 'kms-key-2' }],
      vaults: [{ id: 'v-1', resources: [{ id: 'srv-1' }] }],
      policies: [{ id: 'p-1', operation_type: 'backup', operation_definition: { retention_duration_days: 7 }, associated_vaults: [{ vault_id: 'v-1' }] }],
      trackers: [{ id: 't-1', tracker_name: 'system', tracker_type: 'system', status: 'enabled', obs_info: { bucket_lifecycle: 180 } }],
    });
    const raw = await otcDriver.listPosture!(ctx);
    const p = LzLivePostureSchema.parse(raw);
    expect(p.encryption?.source).toEqual({ calls: [OTC_POSTURE_ROUTES.rms, OTC_POSTURE_ROUTES.elb, OTC_POSTURE_ROUTES.rds].sort(), partial: false, status: 'ok' });
    // two regions answer ELB and RDS with the same mock lists
    expect(p.encryption?.items.filter((e) => e.type === 'evs.volumes')).toHaveLength(2);
    expect(p.encryption?.items.filter((e) => e.resource_id === 'db-1').every((e) => e.encrypted === true)).toBe(true);
    expect(p.encryption?.items.find((e) => e.resource_id === 'l-1')).toMatchObject({ layer: 'in_transit', encrypted: true, min_tls_version: '1.2' });
    expect(p.exposure?.items.map((e) => e.resource_id)).toEqual(['eip-1', 'lb-1']);
    expect(p.ingress_rules?.items).toHaveLength(4);
    expect(p.identity).toMatchObject({ privileged_principals: 2, privileged_without_mfa: 1, mfa_required_for_privileged: false });
    expect(p.logging?.trails.map((t) => t.retention_days)).toEqual([180, 180]);
    expect(p.backup?.items.find((b) => b.resource_id === 'srv-1')).toMatchObject({ protected: true, policy_id: 'p-1', retention_days: 7 });
    // reads only: the token POSTs and GETs
    expect(calls.every((c) => c.method === 'GET' || c.path.endsWith('/v3/auth/tokens'))).toBe(true);
    // the IAM role queries go with the domain-scoped token
    expect(calls.filter((c) => c.path.endsWith('/roles')).every((c) => c.headers['x-auth-token'] === 'mock-token-domain')).toBe(true);
  });

  it('a read-only role is not privileged', async () => {
    const { ctx } = ctxFor({ resourcesPages: [ESTATE as unknown[]], roles: [READONLY_ROLE] });
    const p = LzLivePostureSchema.parse(await otcDriver.listPosture!(ctx));
    expect(p.identity).toMatchObject({ privileged_principals: 0, privileged_without_mfa: 0, mfa_required_for_privileged: true });
  });

  it('denied reads: CBR 403 makes backup not_collected; ELB 403 in both regions makes encryption partial; role queries 403 drop the privileged counts', async () => {
    const { ctx } = ctxFor({ resourcesPages: [ESTATE as unknown[]], fail: { 'cbr-vaults': 403, 'cbr-policies': 403, 'elb-listeners': 403, 'domain-roles': 403 } });
    const p = LzLivePostureSchema.parse(await otcDriver.listPosture!(ctx));
    expect(p.backup).toEqual({ source: { calls: [OTC_POSTURE_ROUTES.policies, OTC_POSTURE_ROUTES.vaults], partial: false, status: 'not_collected', http_status: 403 }, items: [] });
    expect(p.encryption?.source).toMatchObject({ status: 'ok', partial: true });
    expect(p.identity?.source).toMatchObject({ status: 'ok', partial: true });
    expect(p.identity).not.toHaveProperty('privileged_principals');
  });

  it('RMS denied: the RMS blocks are not_collected with the HTTP status, the others still read', async () => {
    const { ctx } = ctxFor({ fail: { 'rms-resources': 403 } });
    const p = LzLivePostureSchema.parse(await otcDriver.listPosture!(ctx));
    expect(p.exposure).toEqual({ source: { calls: [OTC_POSTURE_ROUTES.rms], partial: false, status: 'not_collected', http_status: 403 }, items: [] });
    expect(p.ingress_rules?.source.status).toBe('not_collected');
    expect(p.logging?.source.status).toBe('ok');
    expect(p.encryption?.source).toMatchObject({ status: 'ok', partial: true });
  });

  // #3951: OBS buckets from RMS, signed with a temporary AK/SK issued from the login's token.
  const BUCKET = (id: string): RmsResource => ({ id, provider: 'obs', type: 'buckets', region_id: 'eu-de', properties: { policy_document: '' } });
  const GW: RmsResource = { id: 'gw-1', provider: 'apig', type: 'instances', region_id: 'eu-de', properties: {} };
  const PUBLIC_POLICY = JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: { ID: ['*'] }, Action: ['GetObject'], Resource: ['b-pub/*'] }] });
  const ACL_PRIVATE = '<AccessControlPolicy><Owner><ID>o1</ID></Owner><AccessControlList><Grant><Grantee><ID>o1</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>';
  const ACL_EVERYONE = '<AccessControlPolicy><Owner><ID>o1</ID></Owner><AccessControlList><Grant><Grantee><Canned>Everyone</Canned></Grantee><Permission>READ</Permission></Grant></AccessControlList></AccessControlPolicy>';
  const SSE = '<ServerSideEncryptionConfiguration><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>kms</SSEAlgorithm><KMSMasterKeyID>kms-9</KMSMasterKeyID></ApplyServerSideEncryptionByDefault></Rule></ServerSideEncryptionConfiguration>';
  const obsEstate = [...ESTATE, BUCKET('b-pub'), BUCKET('b-acl'), BUCKET('b-enc'), BUCKET('b-trace'), GW];
  const obsOpts = (extra: MockOptions = {}): MockOptions => ({
    resourcesPages: [obsEstate as unknown[]],
    buckets: {
      'b-pub': { encryption: null, acl: ACL_PRIVATE, policy: PUBLIC_POLICY },
      'b-acl': { encryption: null, acl: ACL_EVERYONE, policy: null },
      'b-enc': { encryption: SSE, acl: ACL_PRIVATE, policy: null },
      'b-trace': { encryption: null, acl: ACL_PRIVATE, policy: null, lifecycle: null },
    },
    trackers: [{ id: 't-1', tracker_name: 'system', tracker_type: 'system', status: 'enabled', obs_info: { bucket_name: 'b-trace', file_prefix_name: 'cts', bucket_lifecycle: 0 } }],
    apigGroups: [{ id: 'g1', url_domains: [] }],
    apigApis: [],
    ...extra,
  });

  it('#3951 / #3954: OBS encryption, public access and the trace bucket lifecycle; APIG without an API; one temporary AK/SK, signed GETs only', async () => {
    const { ctx, calls } = ctxFor(obsOpts());
    const p = LzLivePostureSchema.parse(await otcDriver.listPosture!(ctx));
    const atRest = p.encryption?.items.filter((e) => e.type === 'obs.buckets').map((e) => [e.resource_id, e.encrypted, e.key_id]);
    expect(atRest).toEqual([['b-pub', false, undefined], ['b-acl', false, undefined], ['b-enc', true, 'kms-9'], ['b-trace', false, undefined]]);
    expect(p.exposure?.items.filter((e) => e.exposure === 'public_storage').map((e) => [e.resource_id, e.public, e.attributes])).toEqual([
      ['b-pub', true, { public_acl: false, public_policy: true }], ['b-acl', true, { public_acl: true, public_policy: false }],
      ['b-enc', false, { public_acl: false, public_policy: false }], ['b-trace', false, { public_acl: false, public_policy: false }],
    ]);
    expect(p.exposure?.source).toEqual({ calls: [OTC_POSTURE_ROUTES.rms, '/{bucket}'], partial: false, status: 'ok' });
    // no lifecycle on the trace bucket: the trace files never expire (both regions read the same mock tracker)
    expect(p.logging?.trails.map((t) => t.attributes?.['log_retention'])).toEqual(['never_expires', 'never_expires']);
    expect(p.encryption?.items.find((e) => e.resource_id === 'gw-1')).toMatchObject({ type: 'apig.instances', layer: 'in_transit', attributes: { published_apis: 0, api_groups: 1 } });
    expect(p.encryption?.source).toMatchObject({ status: 'ok', partial: false });
    // the only POSTs: the IAM tokens and one temporary AK/SK with the domain token
    const posts = calls.filter((c) => c.method !== 'GET');
    expect(posts.filter((c) => c.path.endsWith('/securitytokens'))).toHaveLength(1);
    expect(posts.find((c) => c.path.endsWith('/securitytokens'))?.headers['x-auth-token']).toBe('mock-token-domain');
    expect(posts.every((c) => c.path.endsWith('/v3/auth/tokens') || c.path === '/v3.0/OS-CREDENTIAL/securitytokens')).toBe(true);
    const obs = calls.filter((c) => c.url.includes('.obs.'));
    expect(obs.length).toBe(4 * 3 + 2);
    expect(obs.every((c) => c.headers['x-obs-security-token'] === MOCK_TEMP_TOKEN && c.headers['authorization']?.startsWith(`OBS ${MOCK_TEMP_AK}:`) && c.headers['x-auth-token'] === undefined)).toBe(true);
    expect(obs[0]?.url).toBe('https://b-pub.obs.eu-de.mock.otc.example/?encryption');
  });

  it('#3951: a refused bucket read (403) leaves the bucket uncovered and the blocks partial; the trace lifecycle refused leaves the retention unset', async () => {
    const o = obsOpts();
    const { ctx } = ctxFor({ ...o, buckets: { ...o.buckets, 'b-pub': { encryption: 403, acl: 403 }, 'b-trace': { encryption: null, acl: ACL_PRIVATE, policy: null, lifecycle: 403 } } });
    const p = LzLivePostureSchema.parse(await otcDriver.listPosture!(ctx));
    expect(p.encryption?.items.some((e) => e.resource_id === 'b-pub')).toBe(false);
    expect(p.exposure?.items.some((e) => e.resource_id === 'b-pub')).toBe(false);
    expect(p.encryption?.source).toMatchObject({ status: 'ok', partial: true });
    expect(p.exposure?.source).toMatchObject({ status: 'ok', partial: true });
    expect(p.logging?.source).toMatchObject({ status: 'ok', partial: true });
    expect(p.logging?.trails.every((t) => t.retention_days === undefined && t.attributes?.['log_retention'] === undefined)).toBe(true);
  });

  it('#3951: the temporary AK/SK refused (403) makes every OBS read fail, the RMS facts stay', async () => {
    const { ctx, calls } = ctxFor({ ...obsOpts(), fail: { securitytokens: 403 } });
    const p = LzLivePostureSchema.parse(await otcDriver.listPosture!(ctx));
    // requested once per scope run, not once per bucket read
    expect(calls.filter((c) => c.path === '/v3.0/OS-CREDENTIAL/securitytokens')).toHaveLength(1);
    expect(p.exposure?.items.filter((e) => e.exposure === 'public_storage')).toEqual([]);
    expect(p.exposure?.source).toMatchObject({ status: 'ok', partial: true });
    expect(p.encryption?.items.filter((e) => e.type === 'evs.volumes')).toHaveLength(2);
  });

  it('#3954: APIG APIs are in-transit items; an APIG read refused makes encryption partial', async () => {
    const ok = LzLivePostureSchema.parse(await otcDriver.listPosture!(ctxFor(obsOpts({ apigGroups: [{ id: 'g1', url_domains: [{ id: 'd1', min_ssl_version: 'TLSv1.2' }] }], apigApis: [{ id: 'a1', group_id: 'g1', req_protocol: 'HTTPS' }, { id: 'a2', group_id: 'g1', req_protocol: 'BOTH' }] })).ctx));
    expect(ok.encryption?.items.filter((e) => e.type === 'apig.apis').map((e) => [e.resource_id, e.encrypted, e.min_tls_version])).toEqual([['a1', true, '1.2'], ['a2', false, undefined]]);
    const denied = LzLivePostureSchema.parse(await otcDriver.listPosture!(ctxFor({ ...obsOpts(), fail: { 'apig-groups': 403 } }).ctx));
    expect(denied.encryption?.items.some((e) => e.resource_id === 'gw-1')).toBe(false);
    expect(denied.encryption?.source).toMatchObject({ status: 'ok', partial: true });
  });

  it('a region without the service endpoint is a partial read, not a failure', async () => {
    const { ctx } = ctxFor({ resourcesPages: [ESTATE as unknown[]], catalogTypes: { 'eu-de': ['identity', 'rms', 'ctsv3', 'cbr', 'elbv3', 'rdsv3'], 'eu-nl': ['identity', 'rms', 'ctsv3'] } });
    const p = LzLivePostureSchema.parse(await otcDriver.listPosture!(ctx));
    expect(p.backup?.source).toMatchObject({ status: 'ok', partial: true });
    expect(p.encryption?.source).toMatchObject({ status: 'ok', partial: true });
  });
});
