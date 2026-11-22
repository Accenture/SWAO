// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- Client LZ Policy Baseline posture evaluator tests (#3871)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Per posture kind: pass, fail, unverified without the block, not_collected
// on a denied read, and partial (never a pass). Design 123 sections 5.4, 8.2a.

import { describe, it, expect } from 'vitest';
import {
  LzLiveCheckSchema,
  PolicyBaselineSchema,
  POLICY_KIND_CATEGORY,
  parseLzLiveScan,
  type LzLivePostureInput,
  type LzLiveScan,
  type LzLiveScanInput,
  type PolicyKind,
} from '@swao/core';
import { evaluateLzBaseline } from '../lz-baseline-eval.js';

const FW = 'CLIENT_LZ_POLICY_BASELINE';
const T = '2026-11-06T10:00:00Z';
const API = [{ source: 'api' as const, ref: '/v3/auth/catalog' }];
const OK = { calls: ['GET /x'] };
const PARTIAL = { calls: ['GET /x'], partial: true };
const DENIED = { calls: ['GET /x'], status: 'not_collected' as const, http_status: 403 };

type Resources = NonNullable<LzLiveScanInput['estate']['resources']>;

function scanOf(posture: LzLivePostureInput | undefined, resources: Resources = [], provider = 'otc'): LzLiveScan {
  return parseLzLiveScan({
    provider, collection_mode: 'live', confidence: 'observed', scanned_at: T,
    provenance: { source: 'live:lz-a/platform' },
    meta: { lz_id: 'lz-a', provider, scope_id: 'platform', scope_kind: 'platform', observed_at: T, driver_version: '0.1.0', read_only: 'verified', coverage: { readable: [], unreadable: [] } },
    offering: {
      regions: [{ id: 'eu-de', status: 'enabled', azs: [] }],
      services: [{ code: 'obs', name: 'obs', capability_tags: ['object_storage'], regions: { 'eu-de': { status: 'enabled', evidence: API, observed_at: T } } }],
    },
    estate: { resources, ...(posture ? { posture } : {}) },
  });
}

const CAT: Record<string, string> = { encryption: 'ENC', network_exposure: 'NET', identity: 'IAM', logging: 'LOG', resilience: 'BCK' };
function one(scan: LzLiveScan, kind: PolicyKind, params: Record<string, unknown>) {
  const id = `CPB-${CAT[POLICY_KIND_CATEGORY[kind]]}-01`;
  const baseline = PolicyBaselineSchema.parse({
    schema_version: '0.1', framework: FW, baseline_of: FW, catalogue_version: '1.0.0',
    policies: [{ id, kind, category: POLICY_KIND_CATEGORY[kind], control: id, state: 'enabled', params, default_source: 'assumption' }],
  });
  const out = evaluateLzBaseline(scan, { framework: FW, baseline, sha256: 'b'.repeat(64), controls: new Map(), regions: new Map(), sovereigntyDecls: [] });
  // every result is a valid live check (observability rules of section 5.3)
  expect(() => LzLiveCheckSchema.parse(out.checks[0])).not.toThrow();
  return out.result.policies[0]!;
}

/** The three shared gates: no block, a denied block, and a partial block that would pass. */
function gates(kind: PolicyKind, params: Record<string, unknown>, block: keyof LzLivePostureInput, passing: LzLivePostureInput, resources: Resources = []) {
  // encryption_at_rest without the block keeps the Phase 1 catalogue result (its offering is the catalogue's)
  const missing = one(scanOf(undefined, resources), kind, params);
  expect(missing, `${kind} missing`).toMatchObject(kind === 'encryption_at_rest'
    ? { estate: 'unverified', observability: 'catalogue' }
    : { estate: 'unverified', observability: 'not_collected', offering: 'NEEDS_VERIFICATION' });
  const deniedBlock = { ...(passing[block] as object), source: DENIED };
  const denied = one(scanOf({ [block]: deniedBlock }, resources), kind, params);
  expect(denied, `${kind} denied`).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
  expect(denied.detail).toContain('HTTP 403');
  const pass = one(scanOf(passing, resources), kind, params);
  expect(pass.estate, `${kind} pass`).toBe('pass');
  expect(pass.observability).toBe('observed');
  if (kind !== 'encryption_at_rest') expect(pass.offering).toBe('READY');
  const partialBlock = { ...(passing[block] as object), source: PARTIAL };
  const partial = one(scanOf({ [block]: partialBlock }, resources), kind, params);
  expect(partial, `${kind} partial`).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
  expect(partial.detail).toContain('partial source');
}

const vol = (id: string, extra: Record<string, unknown>) => ({ resource_id: id, type: 'evs.volumes', service_code: 'evs', layer: 'at_rest' as const, ...extra });

describe('encryption_at_rest estate from posture.encryption (#3871 posture)', () => {
  const params = { min_key_custody: 'customer-managed', applies_to: ['block_storage'] };
  const passing = { encryption: { source: OK, items: [vol('v1', { encrypted: true, key_custody: 'customer-managed' })] } };
  it('pass, partial, denied; without the block the catalogue result stays', () => {
    gates('encryption_at_rest', params, 'encryption', passing);
  });
  it('fail on an unencrypted volume or a weaker key; the offering keeps the catalogue verdict', () => {
    const r = one(scanOf({ encryption: { source: OK, items: [vol('v1', { encrypted: false }), vol('v2', { encrypted: true, key_custody: 'provider-managed' })] } }), 'encryption_at_rest', params);
    expect(r).toMatchObject({ estate: 'fail', observability: 'observed' });
    expect(r.detail).toContain('1 unencrypted, 1 encrypted with keys weaker than customer-managed');
    expect(r.detail).toContain('offering:');
    expect(r.detail).not.toContain('v1');
  });
  it('an encrypted volume without custody is undecided; a resource of applies_to without an item is a named collector gap', () => {
    expect(one(scanOf({ encryption: { source: OK, items: [vol('v1', { encrypted: true, key_id: 'k' })] } }), 'encryption_at_rest', params))
      .toMatchObject({ estate: 'unverified', observability: 'not_collected' });
    const gap = one(scanOf({ encryption: { source: OK, items: [] } }, [{ id: 'b1', type: 'obs.buckets', service_code: 'obs' }]), 'encryption_at_rest', { ...params, applies_to: ['object_storage'] });
    expect(gap).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
    expect(gap.detail).toContain('not covered by the collector: 1 obs.buckets');
    // an answered block with nothing of applies_to is na
    expect(one(scanOf({ encryption: { source: OK, items: [] } }), 'encryption_at_rest', params)).toMatchObject({ estate: 'na', observability: 'observed' });
  });
  it('an item of an unmapped type is neither passed nor failed', () => {
    const r = one(scanOf({ encryption: { source: OK, items: [{ resource_id: 'd1', type: 'rds.instances', layer: 'at_rest', encrypted: false }] } }), 'encryption_at_rest', params);
    expect(r).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
    expect(r.detail).toContain('without a capability mapping: 1 rds.instances');
  });
});

describe('encryption_in_transit (#3871 posture)', () => {
  const params = { min_tls_version: '1.2', applies_to: ['load_balancer'] };
  const listener = (extra: Record<string, unknown>) => ({ resource_id: 'l1', type: 'elb.listeners', service_code: 'elb', layer: 'in_transit' as const, ...extra });
  it('pass, partial, denied, missing', () => {
    gates('encryption_in_transit', params, 'encryption', { encryption: { source: OK, items: [listener({ encrypted: true, min_tls_version: '1.2' })] } });
  });
  it('#3954: a gateway that publishes no API covers its instance without a verdict; without that item the instance is a named gap', () => {
    const apig = { applies_to: ['api_gateway'], min_tls_version: '1.2' };
    const gw = [{ id: 'gw-1', type: 'apig.instances', service_code: 'apig' }];
    const none = { resource_id: 'gw-1', type: 'apig.instances', service_code: 'apig', layer: 'in_transit' as const, attributes: { published_apis: 0 } };
    expect(one(scanOf({ encryption: { source: OK, items: [none] } }, gw), 'encryption_in_transit', apig)).toMatchObject({ estate: 'na', observability: 'observed' });
    const gap = one(scanOf({ encryption: { source: OK, items: [] } }, gw), 'encryption_in_transit', apig);
    expect(gap).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
    expect(gap.detail).toContain('1 apig.instances');
    const api = { resource_id: 'a1', type: 'apig.apis', service_code: 'apig', layer: 'in_transit' as const, encrypted: false };
    expect(one(scanOf({ encryption: { source: OK, items: [api] } }, gw), 'encryption_in_transit', apig).estate).toBe('fail');
  });
  it('fail on HTTP or a floor below the minimum; a pass-through listener is not_observable', () => {
    expect(one(scanOf({ encryption: { source: OK, items: [listener({ encrypted: false })] } }), 'encryption_in_transit', params).estate).toBe('fail');
    expect(one(scanOf({ encryption: { source: OK, items: [listener({ encrypted: true, min_tls_version: '1.0' })] } }), 'encryption_in_transit', params).estate).toBe('fail');
    expect(one(scanOf({ encryption: { source: OK, items: [listener({})] } }), 'encryption_in_transit', params)).toMatchObject({ estate: 'unverified', observability: 'not_observable' });
    // D-15: on AWS an empty answer is no evidence of absence (tagged inventory, API Gateway and CloudFront not read)
    expect(one(scanOf({ encryption: { source: OK, items: [] } }), 'encryption_in_transit', params)).toMatchObject({ estate: 'na', observability: 'observed' });
    const aws = one(scanOf({ encryption: { source: OK, items: [] } }, [], 'aws'), 'encryption_in_transit', params);
    expect(aws).toMatchObject({ estate: 'unverified', observability: 'not_observable' });
    expect(aws.detail).toContain('D-15');
  });
});

describe('no_public_exposure (#3871 posture)', () => {
  const params = { allow_capabilities: ['load_balancer'] };
  const eip = (bound?: string) => ({ resource_id: 'e1', type: 'vpc.publicips', service_code: 'vpc', exposure: 'public_ip' as const, public: true, ...(bound ? { bound_to: bound } : {}) });
  const lb = { id: 'lb1', type: 'elb.loadbalancers', service_code: 'elb' };
  const ecs = { id: 's1', type: 'ecs.cloudservers', service_code: 'ecs' };
  it('pass (bound to an allowed load balancer), partial, denied, missing; an empty answered block passes', () => {
    gates('no_public_exposure', params, 'exposure', { exposure: { source: OK, items: [eip('lb1')] } }, [lb]);
    expect(one(scanOf({ exposure: { source: OK, items: [] } }), 'no_public_exposure', params)).toMatchObject({ estate: 'na', observability: 'observed' });
  });
  it('fail when bound to a server; unbound exposes nothing; an unknown target is undecided', () => {
    const f = one(scanOf({ exposure: { source: OK, items: [eip('s1')] } }, [ecs]), 'no_public_exposure', params);
    expect(f).toMatchObject({ estate: 'fail', observability: 'observed' });
    expect(f.detail).toContain('1 vpc.publicips');
    expect(one(scanOf({ exposure: { source: OK, items: [eip()] } }), 'no_public_exposure', params).estate).toBe('pass');
    expect(one(scanOf({ exposure: { source: OK, items: [eip('port-1')] } }), 'no_public_exposure', params)).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
  });
  it('#3953: a target outside the inventory is judged by its recorded bound_type', () => {
    const typed = (t: string) => ({ ...eip('port-1'), attributes: { bound_type: t } });
    expect(one(scanOf({ exposure: { source: OK, items: [typed('ecs.cloudservers')] } }), 'no_public_exposure', params)).toMatchObject({ estate: 'fail', observability: 'observed' });
    expect(one(scanOf({ exposure: { source: OK, items: [typed('elb.loadbalancers')] } }), 'no_public_exposure', params)).toMatchObject({ estate: 'pass', observability: 'observed' });
    expect(one(scanOf({ exposure: { source: OK, items: [typed('no.such-type')] } }), 'no_public_exposure', params)).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
  });
  it('object storage without a public_storage item is a named gap', () => {
    const r = one(scanOf({ exposure: { source: OK, items: [] } }, [{ id: 'b1', type: 'obs.buckets', service_code: 'obs' }]), 'no_public_exposure', params);
    expect(r).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
    expect(r.detail).toContain('1 obs.buckets');
  });
  it('#3935: AWS S3 buckets read as not public pass (judged, not na); a public bucket fails; an unread bucket stays a gap', () => {
    const bucket = (name: string, pub: boolean) => ({ resource_id: `arn:aws:s3:::${name}`, type: 's3.bucket', service_code: 's3', exposure: 'public_storage' as const, public: pub });
    const inv = [{ id: 'arn:aws:s3:::b1', type: 's3.bucket', service_code: 's3' }, { id: 'arn:aws:s3:::b2', type: 's3.bucket', service_code: 's3' }];
    const ok = one(scanOf({ exposure: { source: OK, items: [bucket('b1', false), bucket('b2', false)] } }, inv, 'aws'), 'no_public_exposure', params);
    expect(ok).toMatchObject({ estate: 'pass', observability: 'observed' });
    expect(ok.detail).toContain('2 storage resources read, none public');
    const bad = one(scanOf({ exposure: { source: OK, items: [bucket('b1', true), bucket('b2', false)] } }, inv, 'aws'), 'no_public_exposure', params);
    expect(bad).toMatchObject({ estate: 'fail', observability: 'observed' });
    expect(bad.detail).toContain('1 s3.bucket');
    const gap = one(scanOf({ exposure: { source: OK, items: [] } }, inv, 'aws'), 'no_public_exposure', params);
    expect(gap).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
    expect(gap.detail).toContain('2 s3.bucket');
  });
});

describe('no_open_admin_ingress (#3871 posture)', () => {
  const params = { ports: [22, 3389], forbidden_sources: ['0.0.0.0/0', '::/0'] };
  const rule = (extra: Record<string, unknown>) => ({ resource_id: 'sg1', type: 'vpc.securityGroups', protocol: 'tcp', action: 'allow' as const, ...extra });
  it('pass (internal source), partial, denied, missing; no rule at all is a pass', () => {
    gates('no_open_admin_ingress', params, 'ingress_rules', { ingress_rules: { source: OK, items: [rule({ port_from: 22, port_to: 22, remote_cidr: '10.0.0.0/8' })] } });
    expect(one(scanOf({ ingress_rules: { source: OK, items: [] } }), 'no_open_admin_ingress', params)).toMatchObject({ estate: 'pass', observability: 'observed' });
  });
  it('fail on SSH or any protocol from the internet; ICMP, group sources and other ports do not match; never the CIDR of a rule in the detail', () => {
    const f = one(scanOf({ ingress_rules: { source: OK, items: [rule({ port_from: 22, port_to: 22, remote_cidr: '0.0.0.0/0' }), rule({ protocol: 'any', remote_cidr: '::/0' })] } }), 'no_open_admin_ingress', params);
    expect(f).toMatchObject({ estate: 'fail', observability: 'observed' });
    expect(f.detail).toContain('2 inbound rules in 1 security group open port 22, 3389');
    const none = [rule({ protocol: 'icmp', remote_cidr: '0.0.0.0/0' }), rule({ protocol: 'any', remote_group_id: 'sg2' }), rule({ port_from: 443, port_to: 443, remote_cidr: '0.0.0.0/0' }), rule({ port_from: 22, port_to: 22, remote_cidr: '0.0.0.0/0', action: 'deny' })];
    expect(one(scanOf({ ingress_rules: { source: OK, items: none } }), 'no_open_admin_ingress', params).estate).toBe('pass');
    const host = one(scanOf({ ingress_rules: { source: OK, items: [rule({ port_from: 22, port_to: 22, remote_cidr: '203.0.113.7/32' })] } }), 'no_open_admin_ingress', params);
    expect(host.detail).not.toContain('203.0.113.7');
  });
  it('a deny with a lower priority number shadows the allow (NSG order); a fail on a partial block stands', () => {
    const allow = rule({ port_from: 22, port_to: 22, remote_cidr: '0.0.0.0/0', attributes: { priority: 200 } });
    const deny = rule({ port_from: 22, port_to: 22, remote_cidr: '0.0.0.0/0', action: 'deny', attributes: { priority: 100 } });
    expect(one(scanOf({ ingress_rules: { source: OK, items: [allow, deny] } }), 'no_open_admin_ingress', params).estate).toBe('pass');
    expect(one(scanOf({ ingress_rules: { source: PARTIAL, items: [allow] } }), 'no_open_admin_ingress', params)).toMatchObject({ estate: 'fail', observability: 'observed' });
  });
});

describe('privileged_mfa and credential_age (#3871 posture)', () => {
  const identity = (extra: Record<string, unknown>) => ({ identity: { source: OK, credentials: [], ...extra } });
  it('privileged_mfa: pass, fail, partial, denied, missing', () => {
    gates('privileged_mfa', {}, 'identity', identity({ privileged_principals: 3, privileged_without_mfa: 0 }));
    const f = one(scanOf(identity({ privileged_principals: 5, privileged_without_mfa: 1 })), 'privileged_mfa', {});
    expect(f).toMatchObject({ estate: 'fail', observability: 'observed', offering: 'READY_WITH_CHANGES' });
    expect(f.detail).toBe('1 of 5 privileged principals without MFA');
  });
  it('privileged_mfa: counts without MFA are not_collected on OTC, not_observable on STACKIT (section 5.4)', () => {
    expect(one(scanOf(identity({ privileged_principals: 4 })), 'privileged_mfa', {})).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
    expect(one(scanOf(identity({ privileged_principals: 4 }), [], 'stackit'), 'privileged_mfa', {})).toMatchObject({ estate: 'unverified', observability: 'not_observable' });
    expect(one(scanOf(undefined, [], 'azure'), 'privileged_mfa', {})).toMatchObject({ estate: 'unverified', observability: 'not_observable' });
  });
  it('credential_age: pass, fail, partial, denied, missing; inactive keys and passwords do not count', () => {
    const creds = (ages: number[], active = true, kind = 'access_key') => identity({ credentials: ages.map((a) => ({ kind, active, age_days: a })) });
    gates('credential_age', { max_age_days: 90 }, 'identity', creds([10]));
    expect(one(scanOf(creds([10, 135])), 'credential_age', { max_age_days: 90 })).toMatchObject({ estate: 'fail', detail: '1 of 2 active long-lived keys older than 90 days (oldest 135 days)' });
    expect(one(scanOf(creds([400], false)), 'credential_age', { max_age_days: 90 }).estate).toBe('pass');
    expect(one(scanOf(creds([400], true, 'password')), 'credential_age', { max_age_days: 90 }).estate).toBe('pass');
    // STACKIT shows no credentials through the project APIs: an empty list says nothing
    expect(one(scanOf(identity({ privileged_principals: 4 }), [], 'stackit'), 'credential_age', { max_age_days: 90 })).toMatchObject({ estate: 'unverified', observability: 'not_observable' });
  });
});

describe('log_retention (#3871 posture)', () => {
  const params = { min_days: 180 };
  const logging = (trails: Record<string, unknown>[], source: Record<string, unknown> = OK) => ({ logging: { source, trails } });
  it('pass, partial, denied, missing', () => {
    gates('log_retention', params, 'logging', logging([{ enabled: true, all_regions: true, retention_days: 365 }]));
  });
  it('OTC: a trail below the minimum fails; a trail without retention is undecided', () => {
    expect(one(scanOf(logging([{ enabled: true, region: 'eu-de', retention_days: 30 }])), 'log_retention', params)).toMatchObject({ estate: 'fail', observability: 'observed' });
    expect(one(scanOf(logging([{ enabled: true, region: 'eu-de' }])), 'log_retention', params)).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
    expect(one(scanOf(logging([{ enabled: false }])), 'log_retention', params).estate).toBe('fail');
    // a trail with a second destination (an Azure diagnostic setting to a workspace and a storage account) cannot fail on the workspace retention
    expect(one(scanOf(logging([{ enabled: true, all_regions: true, retention_days: 90, attributes: { destinations: 'workspaceId,storageAccountId' } }]), [], 'azure'), 'log_retention', params))
      .toMatchObject({ estate: 'unverified', observability: 'not_collected' });
    expect(one(scanOf(logging([{ enabled: true, all_regions: true, retention_days: 90, attributes: { destinations: 'workspaceId' } }]), [], 'azure'), 'log_retention', params).estate).toBe('fail');
  });
  it('#3955: STACKIT audit log refused (404) is not_observable with the status; the same block on OTC is not_collected', () => {
    const refused = logging([], { calls: ['/v2/projects/{project_id}'], status: 'not_collected', http_status: 404, reason: 'Audit Log API v2 answers 404' });
    const s = one(scanOf(refused, [], 'stackit'), 'log_retention', params);
    expect(s).toMatchObject({ estate: 'unverified', observability: 'not_observable' });
    expect(s.detail).toContain('HTTP 404');
    expect(one(scanOf(refused, [], 'otc'), 'log_retention', params)).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
  });
  it('#3951: an OTC trace bucket without an expiring lifecycle rule keeps the logs (never_expires) and passes', () => {
    expect(one(scanOf(logging([{ enabled: true, region: 'eu-de', attributes: { log_retention: 'never_expires' } }])), 'log_retention', params)).toMatchObject({ estate: 'pass', observability: 'observed' });
  });
  it('#3951: a region in use without an enabled per-region trail keeps no log: fail, also when the trail of another region keeps its logs', () => {
    const res = [{ id: 'v1', type: 'evs.volumes', service_code: 'evs', region: 'eu-de' }, { id: 'v2', type: 'evs.volumes', service_code: 'evs', region: 'eu-nl' }, { id: 'u1', type: 'iam.users', service_code: 'iam', region: 'global' }];
    const kept = logging([{ enabled: true, region: 'eu-de', attributes: { log_retention: 'never_expires' } }]);
    const r = one(scanOf(kept, res), 'log_retention', params);
    expect(r).toMatchObject({ estate: 'fail', observability: 'observed' });
    expect(r.detail).toBe('1 region in use without an enabled trail: no audit log is kept there');
    // a multi-region trail covers every region; the global IAM region is not a region in use
    expect(one(scanOf(logging([{ enabled: true, all_regions: true, retention_days: 365 }]), res), 'log_retention', params).estate).toBe('pass');
    expect(one(scanOf(kept, res.filter((x) => x.region !== 'eu-nl')), 'log_retention', params).estate).toBe('pass');
  });
  it('AWS: the CloudWatch copy below the minimum cannot fail (S3 lifecycle not read, #3935); never_expires passes', () => {
    const short = one(scanOf(logging([{ enabled: true, all_regions: true, retention_days: 14 }]), [], 'aws'), 'log_retention', params);
    expect(short).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
    expect(short.detail).toContain('primary store (S3 bucket lifecycle) is not in the read');
    expect(one(scanOf(logging([{ enabled: true, all_regions: true, attributes: { log_retention: 'never_expires' } }]), [], 'aws'), 'log_retention', params).estate).toBe('pass');
    // a multi-region trail with its home region covers every region in use, also when its copy is short or unread
    const res = [{ id: 'arn:a', type: 'ec2:volume', region: 'eu-central-1' }, { id: 'arn:b', type: 'ec2:volume', region: 'eu-north-1' }];
    for (const retention of [{ retention_days: 14 }, {}]) {
      const r = one(scanOf(logging([{ enabled: true, all_regions: true, region: 'eu-central-1', ...retention }]), res, 'aws'), 'log_retention', params);
      expect(r).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
      // Design 123 section 8.2a: a not_collected detail carries "the HTTP status or reason" (here the
      // unread primary store); it names no issue number.
      expect(r.detail).toContain('primary store (S3 bucket lifecycle) is not in the read');
    }
  });
  it('#3935: AWS with the S3 lifecycle read (retention_source s3_lifecycle): the primary store decides, a short one fails, a long one passes', () => {
    const s3 = (days: number) => ({ enabled: true, all_regions: true, retention_days: days, attributes: { retention_source: 's3_lifecycle', s3_retention: days } });
    expect(one(scanOf(logging([s3(90)]), [], 'aws'), 'log_retention', params)).toMatchObject({ estate: 'fail', observability: 'observed' });
    expect(one(scanOf(logging([s3(365)]), [], 'aws'), 'log_retention', params)).toMatchObject({ estate: 'pass', observability: 'observed' });
    expect(one(scanOf(logging([{ enabled: true, all_regions: true, attributes: { retention_source: 's3_lifecycle', s3_retention: 'never_expires', log_retention: 'never_expires' } }]), [], 'aws'), 'log_retention', params).estate).toBe('pass');
    // one trail with its bucket read short, one whose bucket is in another account (copy only): undecided, never a fail
    const mixed = one(scanOf(logging([s3(90), { enabled: true, region: 'eu-central-1', retention_days: 14, attributes: { retention_source: 'cloudwatch_logs_copy', s3_lifecycle: 'http_403' } }]), [], 'aws'), 'log_retention', params);
    expect(mixed).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
    expect(mixed.detail).toContain('not readable from this scope (HTTP 403)');
  });
  it('#3975: the LOG-02 detail says what the log archive scope did for an unread trail bucket', () => {
    const unread = (logArchive: string) => ({ enabled: true, all_regions: true, retention_days: 14, attributes: { retention_source: 'cloudwatch_logs_copy', s3_lifecycle: 'http_403', log_archive: logArchive } });
    const detail = (...codes: string[]) => one(scanOf(logging(codes.map(unread)), [], 'aws'), 'log_retention', params).detail;
    expect(detail('not_registered')).toContain('; the landing zone registers no log archive scope (scopes[].purpose: log-archive) to read it from');
    expect(detail('http_403')).toContain('; nor from the log archive scope: the bucket answers HTTP 403 (its bucket policy must admit the log archive role)');
    expect(detail('bucket_not_in_scope', 'login_expired')).toContain('nor from the log archive scope: it does not list the bucket, its login has expired');
    expect(detail('read_only_refused')).toContain('its login is write-capable and was not accepted for this run');
    // a trail without the attribute (a scan from before #3975) keeps the earlier detail
    const before = one(scanOf(logging([{ enabled: true, all_regions: true, retention_days: 14, attributes: { retention_source: 'cloudwatch_logs_copy', s3_lifecycle: 'http_403' } }]), [], 'aws'), 'log_retention', params).detail;
    expect(before).not.toContain('log archive');
  });
  it('#3975 live 2026-11-09: on the log archive scope itself the note says what the archive holds, never that none is registered', () => {
    const unread = (logArchive: string) => ({ enabled: true, all_regions: true, retention_days: 14, attributes: { retention_source: 'cloudwatch_logs_copy', s3_lifecycle: 'http_403', log_archive: logArchive } });
    const detail = (...codes: string[]) => one(scanOf(logging(codes.map(unread)), [], 'aws'), 'log_retention', params).detail;
    expect(detail('archive_scope_not_listed')).toContain('; this scope is the log archive scope: it does not list the bucket (the bucket belongs to another account)');
    expect(detail('archive_scope_refused')).toContain('; this scope is the log archive scope: it lists the bucket but its read was refused (the bucket policy must admit its role)');
    expect(detail('archive_scope_not_listed')).not.toContain('registers no log archive scope');
  });
  it('#3975 live 2026-11-09: a primary store read through the log archive scope is named apart from the log copies', () => {
    const viaArchive = { enabled: true, all_regions: true, region: 'eu-central-1', retention_days: 90, attributes: { organisation_trail: true, retention_source: 's3_lifecycle', log_archive_scope: 'log-archive', s3_retention: 90, cloudwatch_retention: 14 } };
    const copy = { enabled: true, all_regions: true, region: 'us-east-1', retention_days: 14, attributes: { retention_source: 'cloudwatch_logs_copy', s3_lifecycle: 'http_403', log_archive: 'bucket_not_in_scope' } };
    const noRetention = { enabled: true, all_regions: false, region: 'eu-central-1', attributes: { retention_source: 'cloudwatch_logs_copy', s3_lifecycle: 'http_403', log_archive: 'bucket_not_in_scope', log_retention: 'no_cloudwatch_logs_group' } };
    const r = one(scanOf(logging([copy, viaArchive, noRetention]), [], 'aws'), 'log_retention', params);
    expect(r).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
    expect(r.detail).toContain('1 trail with retention below 180 days (longest 90 days, read through the log archive scope log-archive), 1 trail with a log copy below 180 days (longest 14 days), 1 trail without a retention in the read');
    expect(r.detail).toContain('nor from the log archive scope: it does not list the bucket');
  });
});

describe('#3955: STACKIT inventory reads iaas and load balancers only: na is never claimed for an enabled service it does not read', () => {
  // A scan of the current driver holds the #3970 service inventory source (live/scan.ts).
  const SERVICE_INVENTORY_OK = [{ name: 'inventory:service-resources', status: 'ok' as const }];
  const stackit = (services: { code: string; tags: string[]; status: string }[], posture: LzLivePostureInput, sources: Record<string, unknown>[] = SERVICE_INVENTORY_OK) => parseLzLiveScan({
    provider: 'stackit', collection_mode: 'live', confidence: 'observed', scanned_at: T,
    provenance: { source: 'live:lz-s/platform' },
    meta: { lz_id: 'lz-s', provider: 'stackit', scope_id: 'platform', scope_kind: 'platform', observed_at: T, driver_version: '0.1.0', read_only: 'verified', coverage: { readable: [], unreadable: [] }, sources },
    offering: { regions: [{ id: 'eu01', status: 'enabled', azs: [] }], services: services.map((x) => ({ code: x.code, name: x.code, capability_tags: x.tags, regions: { eu01: { status: x.status as 'enabled', evidence: API, observed_at: T } } })) },
    estate: { resources: [], posture },
  });
  const empty: LzLivePostureInput = { encryption: { source: OK, items: [] }, exposure: { source: OK, items: [] }, backup: { source: OK, items: [] } };
  const objectStorage = (status: string) => ({ code: 'cloud.stackit.object-storage', tags: ['object_storage'], status });
  const iaasOnly = [{ code: 'cloud.stackit.iaas', tags: ['vm_compute', 'block_storage'], status: 'enabled' }];
  it('#3970: an enabled service the inventory does not read, in applies_to: encryption at rest is unverified (not_collected) naming its capability', () => {
    const scan = stackit([...iaasOnly, { code: 'cloud.stackit.unread-service', tags: ['message_queue'], status: 'enabled' }], empty);
    const r = one(scan, 'encryption_at_rest', { applies_to: ['message_queue', 'block_storage'], min_key_custody: 'provider-managed' });
    expect(r).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
    expect(r.detail).toContain('not read by the stackit inventory: message_queue');
  });
  it('#3995: SQL Server Flex is read (sqlserver-flex.instance): enabled and in applies_to, an answered empty block is na, not uninventoried', () => {
    const scan = stackit([...iaasOnly, { code: 'cloud.stackit.sqlserver-flex', tags: ['sql_server'], status: 'enabled' }], empty);
    const r = one(scan, 'encryption_at_rest', { applies_to: ['sql_server', 'block_storage'], min_key_custody: 'provider-managed' });
    expect(r).toMatchObject({ estate: 'na', observability: 'observed' });
    expect(one(scan, 'backup_configured', { applies_to: ['sql_server'] })).toMatchObject({ estate: 'na', observability: 'observed' });
  });
  it('#3970: object storage, PostgreSQL Flex, MongoDB Flex, SFS and CDN are read: with answered (not partial) blocks, na stands', () => {
    const services = [...iaasOnly, objectStorage('enabled'), ...[['cloud.stackit.postgres-flex', 'postgresql'], ['cloud.stackit.mongodb-flex', 'nosql_database'], ['cloud.stackit.sfs', 'file_storage'], ['cloud.stackit.cdn', 'cdn']].map(([code, tag]) => ({ code: code as string, tags: [tag as string], status: 'enabled' }))];
    const scan = stackit(services, empty);
    expect(one(scan, 'encryption_at_rest', { applies_to: ['object_storage', 'file_storage', 'postgresql', 'nosql_database'], min_key_custody: 'provider-managed' })).toMatchObject({ estate: 'na', observability: 'observed' });
    expect(one(scan, 'no_public_exposure', { allow_capabilities: ['load_balancer'] })).toMatchObject({ estate: 'na', observability: 'observed' });
    expect(one(scan, 'backup_configured', { applies_to: ['postgresql', 'nosql_database', 'file_storage'] })).toMatchObject({ estate: 'na', observability: 'observed' });
  });
  it('#3871: a stored scan without the service inventory (driver before #3970, or that read refused) never claims na for its types', () => {
    const services = [...iaasOnly, objectStorage('enabled'), ...[['cloud.stackit.postgres-flex', 'postgresql'], ['cloud.stackit.mongodb-flex', 'nosql_database'], ['cloud.stackit.sfs', 'file_storage'], ['cloud.stackit.cdn', 'cdn']].map(([code, tag]) => ({ code: code as string, tags: [tag as string], status: 'enabled' }))];
    for (const sources of [[], [{ name: 'inventory:service-resources', status: 'not_collected', http_status: 403 }]]) {
      const scan = stackit(services, empty, sources);
      const enc = one(scan, 'encryption_at_rest', { applies_to: ['object_storage', 'block_storage', 'postgresql'], min_key_custody: 'provider-managed' });
      expect(enc).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
      expect(enc.detail).toContain('not read by the stackit inventory: object_storage, postgresql');
      expect(one(scan, 'encryption_in_transit', { applies_to: ['load_balancer', 'cdn'], min_tls_version: '1.2' })).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
      expect(one(scan, 'no_public_exposure', { allow_capabilities: ['load_balancer'] })).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
      expect(one(scan, 'backup_configured', { applies_to: ['nosql_database', 'file_storage'] })).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
      // the iaas kinds are read by every STACKIT scan: block storage alone stays na
      expect(one(scan, 'backup_configured', { applies_to: ['block_storage'] })).toMatchObject({ estate: 'na', observability: 'observed' });
    }
  });
  it('#4026: a refused read of one data type in a region (inventory:<type>:<region> not_collected) is no read of it; an answered empty list keeps na', () => {
    const services = [...iaasOnly, objectStorage('enabled')];
    const params = { applies_to: ['object_storage', 'block_storage'], min_key_custody: 'provider-managed' };
    const refused = stackit(services, empty, [...SERVICE_INVENTORY_OK, { name: 'inventory:object-storage.bucket:eu01', status: 'not_collected', http_status: 403 }]);
    const r = one(refused, 'encryption_at_rest', params);
    expect(r).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
    expect(r.detail).toContain('not read by the stackit inventory: object_storage');
    const answeredEmpty = stackit(services, empty, [...SERVICE_INVENTORY_OK, { name: 'inventory:object-storage.bucket:eu01', status: 'ok', reason: 'project.not_found' }]);
    expect(one(answeredEmpty, 'encryption_at_rest', params)).toMatchObject({ estate: 'na', observability: 'observed' });
  });
  it('only iaas offered, or object storage only available: na stands', () => {
    for (const services of [iaasOnly, [...iaasOnly, objectStorage('available_not_enabled')]]) {
      expect(one(stackit(services, empty), 'encryption_at_rest', { applies_to: ['object_storage', 'block_storage'], min_key_custody: 'provider-managed' })).toMatchObject({ estate: 'na', observability: 'observed' });
      expect(one(stackit(services, empty), 'backup_configured', { applies_to: ['block_storage', 'postgresql'] })).toMatchObject({ estate: 'na' });
    }
  });
  it('an allowed object storage capability does not block na of the exposure', () => {
    expect(one(stackit([...iaasOnly, objectStorage('enabled')], empty), 'no_public_exposure', { allow_capabilities: ['object_storage'] })).toMatchObject({ estate: 'na' });
  });
});

describe('backup_configured (#3871 posture)', () => {
  const params = { applies_to: ['block_storage'] };
  const item = (prot: boolean, type = 'evs.volumes') => ({ resource_id: `${type}-${String(prot)}`, type, protected: prot });
  it('pass, partial, denied, missing', () => {
    gates('backup_configured', params, 'backup', { backup: { source: OK, items: [item(true)] } });
  });
  it('fail on an unprotected volume; servers are outside applies_to; a volume without an item is a named gap', () => {
    expect(one(scanOf({ backup: { source: OK, items: [item(false), item(false, 'ecs.cloudservers')] } }), 'backup_configured', params)).toMatchObject({ estate: 'fail', detail: '1 of 1 stateful resource without a backup: 1 evs.volumes' });
    expect(one(scanOf({ backup: { source: OK, items: [item(true, 'ecs.cloudservers')] } }), 'backup_configured', params)).toMatchObject({ estate: 'na', observability: 'observed' });
    const gap = one(scanOf({ backup: { source: OK, items: [] } }, [{ id: 'v9', type: 'iaas.volume', service_code: 'iaas' }], 'stackit'), 'backup_configured', params);
    expect(gap).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
    expect(gap.detail).toContain('1 iaas.volume');
  });
  it('the inventory gap rule applies: no pass when the resource inventory was not read', () => {
    const s = scanOf({ backup: { source: OK, items: [item(true)] } });
    const gapScan = { ...s, meta: { ...s.meta, sources: [{ name: 'inventory:resources', status: 'not_collected' as const, http_status: 403 }] } };
    expect(one(gapScan, 'backup_configured', params)).toMatchObject({ estate: 'unverified', observability: 'not_collected' });
  });
});
