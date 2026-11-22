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

// #3866: the pure AWS posture mappings (aws-posture.ts) and the SCP deny
// evaluation (aws-scp.ts). The HTTP side is pinned against the mock pack
// (ops/mock-csp/contract/aws-posture.contract.ts).

import { describe, expect, it } from 'vitest';
import { LzLivePostureSchema } from '@swao/core';
import { atRestFacts, backupFacts, ec2Arn, exposureFacts, identityFacts, ingressRules, isReadOnlyPolicy, kmsKeyCustody, listenerFacts, tlsFloor, trailFacts } from '../aws-posture.js';
import { evaluateScpDenies, scpDeniesService } from '../aws-scp.js';

const P = { partition: 'aws', region: 'eu-central-1', account: '111122223333' };
const KEY = 'arn:aws:kms:eu-central-1:111122223333:key/00000000-0000-4000-8000-000000000001';

describe('aws posture mappings (#3866)', () => {
  it('KMS custody by key manager and origin; unknown values give none', () => {
    expect(kmsKeyCustody({ arn: KEY, id: 'k', manager: 'AWS', origin: 'AWS_KMS' })).toBe('provider-managed');
    expect(kmsKeyCustody({ arn: KEY, id: 'k', manager: 'CUSTOMER', origin: 'AWS_KMS' })).toBe('customer-managed');
    expect(kmsKeyCustody({ arn: KEY, id: 'k', manager: 'CUSTOMER', origin: 'AWS_CLOUDHSM' })).toBe('customer-managed');
    expect(kmsKeyCustody({ arn: KEY, id: 'k', manager: 'CUSTOMER', origin: 'EXTERNAL' })).toBe('byok');
    expect(kmsKeyCustody({ arn: KEY, id: 'k', manager: 'CUSTOMER', origin: 'EXTERNAL_KEY_STORE' })).toBe('hyok');
    expect(kmsKeyCustody({ arn: KEY, id: 'k', manager: 'CUSTOMER', origin: 'SOMETHING_NEW' })).toBeUndefined();
    expect(kmsKeyCustody({ arn: KEY, id: 'k' })).toBeUndefined();
  });

  it('at rest: the ARN joins the inventory (type ec2.volume), custody only for an encrypted resource with a described key', () => {
    const vol = ec2Arn(P, 'volume', 'vol-0001');
    const items = atRestFacts([
      { arn: vol, region: P.region, encrypted: true, kmsKeyId: KEY },
      { arn: ec2Arn(P, 'volume', 'vol-0002'), region: P.region, encrypted: false },
      { arn: ec2Arn(P, 'volume', 'vol-0003'), region: P.region, encrypted: true, kmsKeyId: 'arn:aws:kms:eu-central-1:111122223333:key/unknown' },
    ], [{ arn: KEY, id: '00000000-0000-4000-8000-000000000001', manager: 'CUSTOMER', origin: 'AWS_KMS' }]);
    expect(items[0]).toMatchObject({ resource_id: vol, type: 'ec2.volume', service_code: 'ec2', layer: 'at_rest', encrypted: true, key_custody: 'customer-managed', key_id: KEY });
    expect(items[1]).toMatchObject({ encrypted: false });
    expect(items[1]).not.toHaveProperty('key_custody');
    expect(items[2]).not.toHaveProperty('key_custody');
    LzLivePostureSchema.parse({ encryption: { source: { calls: ['ec2:DescribeVolumes'] }, items } });
  });

  it('in transit: HTTPS and TLS encrypted with the policy floor, HTTP not, TCP does not tell', () => {
    const lb = 'arn:aws:elasticloadbalancing:eu-central-1:111122223333:listener/app/web/0001/0002';
    const pol = new Map([['ELBSecurityPolicy-TLS13-1-2-2021-06', ['TLSv1.3', 'TLSv1.2']], ['ELBSecurityPolicy-2016-08', ['TLSv1', 'TLSv1.1', 'TLSv1.2']]]);
    const items = listenerFacts([
      { arn: lb, region: P.region, protocol: 'HTTPS', port: 443, sslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06' },
      { arn: `${lb}1`, region: P.region, protocol: 'TLS', port: 8443, sslPolicy: 'ELBSecurityPolicy-2016-08' },
      { arn: `${lb}2`, region: P.region, protocol: 'HTTP', port: 80 },
      { arn: `${lb}3`, region: P.region, protocol: 'TCP', port: 22 },
    ], pol);
    expect(items.map((i) => [i.encrypted, i.min_tls_version])).toEqual([[true, '1.2'], [true, '1.0'], [false, undefined], [undefined, undefined]]);
    expect(items[0]?.type).toBe('elasticloadbalancing.listener/app');
    expect(tlsFloor([])).toBeUndefined();
    LzLivePostureSchema.parse({ encryption: { source: { calls: ['elasticloadbalancing:DescribeListeners'] }, items } });
  });

  it('exposure: elastic IPs bound to instances, instance public IPs, internet-facing load balancers, public RDS', () => {
    const items = exposureFacts(
      [{ place: P, allocationId: 'eipalloc-0001', publicIp: '198.51.100.1', instanceId: 'i-0001' }, { place: P, allocationId: 'eipalloc-0002' }],
      [{ place: P, instanceId: 'i-0002', publicIp: '198.51.100.2' }, { place: P, instanceId: 'i-0003' }],
      [{ arn: 'arn:aws:elasticloadbalancing:eu-central-1:111122223333:loadbalancer/app/web/0001', region: P.region, scheme: 'internet-facing', type: 'application' }, { arn: 'arn:aws:elasticloadbalancing:eu-central-1:111122223333:loadbalancer/net/int/0002', region: P.region, scheme: 'internal' }],
      [{ arn: 'arn:aws:rds:eu-central-1:111122223333:db:mock-db-1', region: P.region, publiclyAccessible: true }, { arn: 'arn:aws:rds:eu-central-1:111122223333:db:mock-db-2', region: P.region }],
    );
    expect(items.map((i) => [i.type, i.exposure, i.public, i.bound_to])).toEqual([
      ['ec2.elastic-ip', 'public_ip', true, ec2Arn(P, 'instance', 'i-0001')],
      ['ec2.elastic-ip', 'public_ip', true, undefined],
      ['ec2.instance', 'public_ip', true, undefined],
      ['elasticloadbalancing.alb', 'internet_endpoint', true, undefined],
      ['elasticloadbalancing.nlb', 'internet_endpoint', false, undefined],
      ['rds.db', 'internet_endpoint', true, undefined],
    ]);
    LzLivePostureSchema.parse({ exposure: { source: { calls: ['ec2:DescribeAddresses'] }, items } });
  });

  it('ingress: inbound rules only; -1 protocol is any without ports; -1 ports are left out', () => {
    const items = ingressRules([
      { place: P, groupId: 'sg-0001', isEgress: false, ipProtocol: 'tcp', fromPort: 22, toPort: 22, cidrIpv4: '0.0.0.0/0' },
      { place: P, groupId: 'sg-0001', isEgress: false, ipProtocol: '-1', fromPort: -1, toPort: -1, referencedGroupId: 'sg-0001' },
      { place: P, groupId: 'sg-0001', isEgress: false, ipProtocol: 'icmp', fromPort: -1, toPort: -1, cidrIpv6: '::/0' },
      { place: P, groupId: 'sg-0001', isEgress: true, ipProtocol: '-1', cidrIpv4: '0.0.0.0/0' },
    ]);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ resource_id: ec2Arn(P, 'security-group', 'sg-0001'), type: 'ec2.security-group', protocol: 'tcp', port_from: 22, port_to: 22, remote_cidr: '0.0.0.0/0', action: 'allow' });
    expect(items[1]).toMatchObject({ protocol: 'any', remote_group_id: 'sg-0001' });
    expect(items[1]).not.toHaveProperty('port_from');
    expect(items[2]).toMatchObject({ protocol: 'icmp', remote_cidr: '::/0' });
    expect(items[2]).not.toHaveProperty('port_from');
    LzLivePostureSchema.parse({ ingress_rules: { source: { calls: ['ec2:DescribeSecurityGroupRules'] }, items } });
  });

  it('identity: privileged users (non read-only or inline policies) without MFA, the root user, access key ages; no names', () => {
    const now = Date.parse('2026-11-06T00:00:00Z');
    expect(isReadOnlyPolicy('arn:aws:iam::aws:policy/ReadOnlyAccess')).toBe(true);
    expect(isReadOnlyPolicy('arn:aws:iam::aws:policy/job-function/ViewOnlyAccess')).toBe(true);
    expect(isReadOnlyPolicy('arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess')).toBe(true);
    expect(isReadOnlyPolicy('arn:aws:iam::aws:policy/AdministratorAccess')).toBe(false);
    expect(isReadOnlyPolicy('arn:aws:iam::111122223333:policy/ReadOnlyAccess')).toBe(false);
    const facts = identityFacts([
      { policies: ['arn:aws:iam::aws:policy/AdministratorAccess'], inlinePolicies: 0, mfaDevices: 0, accessKeys: [{ active: true, created: '2026-08-08T00:00:00Z' }] },
      { policies: ['arn:aws:iam::aws:policy/ReadOnlyAccess'], inlinePolicies: 0, mfaDevices: 0, accessKeys: [{ active: false, created: '2026-11-05T00:00:00Z' }] },
      { policies: [], inlinePolicies: 1, mfaDevices: 1, accessKeys: [] },
      { policies: [], inlinePolicies: 0, mfaDevices: 0, accessKeys: [{ active: true, created: 'not a date' }] },
    ], false, now);
    expect(facts).toEqual({ privileged_principals: 3, privileged_without_mfa: 2, credentials: [{ kind: 'access_key', active: true, age_days: 90 }, { kind: 'access_key', active: false, age_days: 1 }] });
    expect(identityFacts([], undefined, now)).toEqual({ privileged_principals: 0, privileged_without_mfa: 0, credentials: [] });
  });

  it('logging: trail status, multi-region, CloudWatch Logs retention; never-expiring groups are named, not given a day count', () => {
    const g1 = 'arn:aws:logs:eu-central-1:111122223333:log-group:trail-a';
    const g2 = 'arn:aws:logs:us-east-1:111122223333:log-group:trail-b';
    const trails = trailFacts([
      { arn: 'arn:aws:cloudtrail:eu-central-1:111122223333:trail/a', homeRegion: 'eu-central-1', multiRegion: true, logging: true, organisationTrail: true, logGroupArn: `${g1}:*` },
      { arn: 'arn:aws:cloudtrail:us-east-1:111122223333:trail/b', homeRegion: 'us-east-1', multiRegion: false, logging: false, logGroupArn: `${g2}:*` },
      { arn: 'arn:aws:cloudtrail:eu-central-1:111122223333:trail/c', logging: true },
    ], new Map([[g1, 365], [g2, null]]));
    expect(trails[0]).toMatchObject({ all_regions: true, enabled: true, retention_days: 365, attributes: { organisation_trail: true } });
    expect(trails[1]).toMatchObject({ all_regions: false, enabled: false, attributes: { log_retention: 'never_expires' } });
    expect(trails[1]).not.toHaveProperty('retention_days');
    expect(trails[2]).toMatchObject({ enabled: true, attributes: { log_retention: 'no_cloudwatch_logs_group' } });
    LzLivePostureSchema.parse({ logging: { source: { calls: ['cloudtrail:DescribeTrails'] }, trails } });
  });

  it('#3975: a lifecycle read through the log archive scope names the scope; an unread bucket names why the archive did not decide', () => {
    const g = 'arn:aws:logs:eu-central-1:111122223333:log-group:org';
    const trails = trailFacts([
      { arn: 'arn:aws:cloudtrail:eu-central-1:111122223333:trail/org', multiRegion: true, logging: true, organisationTrail: true, logGroupArn: `${g}:*`, s3Retention: { days: 90 }, s3ReadBy: 'log-archive' },
      { arn: 'arn:aws:cloudtrail:eu-central-1:111122223333:trail/b', logging: true, s3Unread: 'http_403', logArchive: 'bucket_not_in_scope' },
      { arn: 'arn:aws:cloudtrail:eu-central-1:111122223333:trail/c', logging: true, s3Unread: 'http_403' },
    ], new Map([[g, 14]]));
    expect(trails[0]).toMatchObject({ retention_days: 90, attributes: { retention_source: 's3_lifecycle', s3_retention: 90, cloudwatch_retention: 14, log_archive_scope: 'log-archive' } });
    expect(trails[0]?.attributes).not.toHaveProperty('log_archive');
    expect(trails[1]?.attributes).toMatchObject({ retention_source: 'cloudwatch_logs_copy', s3_lifecycle: 'http_403', log_archive: 'bucket_not_in_scope' });
    expect(trails[2]?.attributes).not.toHaveProperty('log_archive');
    LzLivePostureSchema.parse({ logging: { source: { calls: ['cloudtrail:DescribeTrails'] }, trails } });
  });

  it('backup: protected needs a recovery point and a plan; protected resources outside the stateful list are added', () => {
    const vol = ec2Arn(P, 'volume', 'vol-0001');
    const db = 'arn:aws:rds:eu-central-1:111122223333:db:mock-db-1';
    const table = 'arn:aws:dynamodb:eu-central-1:111122223333:table/mock-table';
    const items = backupFacts([{ arn: vol, region: P.region }, { arn: db, region: P.region }], new Set([vol, table]), 1);
    expect(items.map((i) => [i.resource_id, i.type, i.protected])).toEqual([[vol, 'ec2.volume', true], [db, 'rds.db', false], [table, 'dynamodb.table', true]]);
    expect(backupFacts([{ arn: vol }], new Set([vol]), 0)[0]?.protected).toBe(false);
    LzLivePostureSchema.parse({ backup: { source: { calls: ['backup:ListBackupPlans'] }, items } });
  });
});

describe('SCP deny evaluation (#3866, D-16)', () => {
  const doc = (st: unknown): string => JSON.stringify({ Version: '2012-10-17', Statement: st });

  it('an unconditional whole-service Deny restricts the service, by action prefix and catalogue alias', () => {
    const r = evaluateScpDenies(new Map([['p-ai', doc([{ Effect: 'Deny', Action: ['bedrock:*', 'sagemaker:*', 'cloudwatch:*'], Resource: '*' }])]]));
    expect(scpDeniesService(r, 'bedrock')).toEqual(['p-ai']);
    expect(scpDeniesService(r, 'api.sagemaker')).toEqual(['p-ai']);
    expect(scpDeniesService(r, 'monitoring')).toEqual(['p-ai']);
    expect(scpDeniesService(r, 'ec2')).toEqual([]);
    expect(r.skipped).toBe(0);
  });

  it('conditions, single actions, narrower resources and allow statements are not claimed', () => {
    const r = evaluateScpDenies(new Map([
      ['p-region', doc([{ Effect: 'Deny', NotAction: ['iam:*', 'sts:*'], Resource: '*', Condition: { StringNotEquals: { 'aws:RequestedRegion': ['eu-central-1'] } } }])],
      ['p-one', doc({ Effect: 'Deny', Action: 'bedrock:InvokeModel', Resource: '*' })],
      ['p-res', doc([{ Effect: 'Deny', Action: 's3:*', Resource: 'arn:aws:s3:::secret-bucket' }])],
      ['p-allow', doc([{ Effect: 'Allow', Action: '*', Resource: '*' }])],
      ['p-bad', '{not json'],
    ]));
    expect(scpDeniesService(r, 'bedrock')).toEqual([]);
    expect(scpDeniesService(r, 's3')).toEqual([]);
    expect(scpDeniesService(r, 'ec2')).toEqual([]);
    expect(r.skipped).toBe(4);
  });

  it('an unconditional NotAction Deny restricts every known service outside the exemptions, never an unmapped code', () => {
    const r = evaluateScpDenies(new Map([['p-only', doc([{ Effect: 'Deny', NotAction: ['ec2:*', 's3:Get*', 'iam:*'] }])]]));
    expect(scpDeniesService(r, 'ec2')).toEqual([]);
    expect(scpDeniesService(r, 's3')).toEqual([]);
    expect(scpDeniesService(r, 'lambda')).toEqual(['p-only']);
    expect(scpDeniesService(r, 'api.unknownservice')).toEqual([]);
  });

  it('Action * denies every service', () => {
    const r = evaluateScpDenies(new Map([['p-all', doc([{ Effect: 'Deny', Action: '*' }])]]));
    expect(scpDeniesService(r, 'ec2')).toEqual(['p-all']);
  });
});
