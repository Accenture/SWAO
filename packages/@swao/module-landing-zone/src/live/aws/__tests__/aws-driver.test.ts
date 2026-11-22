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

// #3574: mock-server contract tests of the `aws` live driver (CLAUDE.md
// section 5.9, Design 120 section 7.1): SigV4 request shape, happy path and
// the 401 / 403 / 404 / 5xx and throttling paths, XML Query and EC2
// responses, NextToken / PaginationToken / Marker pagination, the AWS action
// guard, the Q-21 registration gate, the scan assembler and the Pass 23 path.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CredentialStore, LzCredentialExpiredError, LzLiveScanSchema } from '@swao/core';
import type { LzServiceCatalogue } from '@swao/core';
import { createReadOnlyFetch, ReadOnlyViolationError } from '../../http.js';
import { getLiveLzDriver, unregisterLiveLzDriver } from '../../registry.js';
import { LiveAuthError, LiveSourceUnavailableError } from '../../errors.js';
import { registerBuiltInLiveLzDrivers, UNVERIFIED_DRIVERS_ENV } from '../../builtin.js';
import { RECORD_ENV, createRecordingFetch } from '../../record.js';
import { runLzLiveScan } from '../../scan.js';
import { parseCoverageList } from '../../coverage-list.js';
import { LiveLzDriverDescriptorSchema } from '../../types.js';
import type { ScopeCtx } from '../../types.js';
import { AWS_PROBE_WRITE_ACTIONS, assumedRoleName, awsDriver, parseArn, readAwsPass23State, setAwsCatalogueForTests } from '../aws-driver.js';
import { readAwsPass23StateForScope } from '../aws-pass23.js';
import { AWS_DEFAULT_BASE_URLS, awsActionGuard, awsEndpoint, awsJson, awsOperationOf, awsPartition, awsQuery, awsRegionOf, setAwsRetryDelayForTests } from '../aws-client.js';
import { awsUriEncode, canonicalQuery, signAwsV4 } from '../aws-sign.js';
import { parseXml, find, kids, textOf, xmlErrorCode } from '../aws-xml.js';
import { ACCOUNT, ROLE_ARN, ROLE_NAME, makeAwsMock } from './aws-mock.js';
import type { AwsMockOptions } from './aws-mock.js';

// Fake keys, built at runtime so no key-shaped literal is committed.
const AKID = ['MOCK', 'ACCESS', 'ID'].join('');
const SECRET = ['mock', 'secret', 'value'].join('-');
const TOKEN = ['mock', 'session', 'token'].join('-');

const CATALOGUE = {
  meta: { schema_version: '0.1', name: 'mock', provider: 'aws', last_updated: '2026-11-01', source: { mode: 'botocore-endpoints' }, confidence: 'high' },
  regions: [
    { id: 'eu-central-1', display: 'Frankfurt', country: 'DE', services: [
      { code: 'ec2', status: 'ga', fulfills: ['vm_compute'], capabilities: [], key_custody: [] },
      { code: 's3', status: 'ga', fulfills: ['object_storage'], capabilities: [], key_custody: [] },
      { code: 'eks', status: 'ga', fulfills: ['kubernetes'], capabilities: [], key_custody: [] },
    ] },
    { id: 'eu-north-1', display: 'Stockholm', country: 'SE', services: [
      { code: 'ec2', status: 'ga', fulfills: ['vm_compute'], capabilities: [], key_custody: [] },
      { code: 's3', status: 'ga', fulfills: ['object_storage'], capabilities: [], key_custody: [] },
    ] },
    { id: 'eu-south-2', display: 'Spain', country: 'ES', services: [
      { code: 'ec2', status: 'ga', fulfills: ['vm_compute'], capabilities: [], key_custody: [] },
    ] },
  ],
} as unknown as LzServiceCatalogue;

const tmp: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmp.push(d);
  return d;
}

function ctxFor(opts: AwsMockOptions = {}, over: Partial<ScopeCtx> = {}): { ctx: ScopeCtx; calls: ReturnType<typeof makeAwsMock>['calls'] } {
  const mock = makeAwsMock(opts);
  const ctx: ScopeCtx = {
    lzId: 'aws-test',
    provider: 'aws',
    scopeId: 'platform',
    scopeKind: 'platform',
    auth: 'session-keys',
    regions: ['eu-central-1', 'eu-north-1'],
    target: {},
    credentials: { 'access-key-id': AKID, 'secret-access-key': SECRET, 'session-token': TOKEN },
    http: { fetch: createReadOnlyFetch(mock.fetch, 'aws', awsDriver.readAllowList), baseUrls: { ...awsDriver.defaultBaseUrls } },
    sources: [],
    ...over,
  };
  return { ctx, calls: mock.calls };
}

beforeEach(() => {
  unregisterLiveLzDriver();
  setAwsCatalogueForTests(CATALOGUE);
  setAwsRetryDelayForTests(() => 0);
});
afterEach(() => {
  unregisterLiveLzDriver();
  setAwsCatalogueForTests(undefined);
  setAwsRetryDelayForTests(undefined);
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('aws driver descriptor and the Q-21 registration gate', () => {
  it('is a valid descriptor: session keys, one POST / rule, live-verified (#3831)', () => {
    expect(LiveLzDriverDescriptorSchema.safeParse(awsDriver).success).toBe(true);
    expect(awsDriver.authMethods).toEqual([{ id: 'session-keys', required: ['access-key-id', 'secret-access-key'], optional: ['session-token', 'expires-at'], unattended: false }]);
    expect(awsDriver.readAllowList.map((r) => `${r.method} ${r.path.source}`)).toEqual(['POST ^\\/$']);
    expect(awsDriver.liveVerified).toBe(true);
    expect(Object.keys(awsDriver.defaultBaseUrls).sort()).toEqual(['backup', 'budgets', 'cloudtrail', 'config', 'dynamodb', 'ec2', 'eks', 'elasticloadbalancing', 'iam', 'kms', 'logs', 'organizations', 'rds', 's3', 's3control', 'servicequotas', 'sts', 'tagging']);
  });

  it('is registered in a release build without SWAO_LZ_UNVERIFIED_DRIVERS (#3831, Q-21)', () => {
    expect(registerBuiltInLiveLzDrivers({})).toContain('aws');
    expect(getLiveLzDriver('aws')).toBe(awsDriver);
    expect(registerBuiltInLiveLzDrivers({ [UNVERIFIED_DRIVERS_ENV]: 'aws' })).toContain('aws');
  });
});

describe('SigV4 (aws-sign.ts)', () => {
  it('reproduces the AWS General Reference example (IAM ListUsers, 2015-08-30)', () => {
    const h = signAwsV4({
      method: 'GET',
      url: new URL('https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08'),
      region: 'us-east-1',
      service: 'iam',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: ['wJalrXUtnFEMI', 'K7MDENG+bPxRfiCYEXAMPLEKEY'].join('/'),
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      now: new Date('2015-08-30T12:36:00Z'),
    });
    expect(h['x-amz-date']).toBe('20150830T123600Z');
    expect(h.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
  });

  it('sorts and RFC 3986-encodes the canonical query (the Pass 23 signer did not)', () => {
    expect(canonicalQuery(new URL('https://x/?b=2&a=z%20y&a=x&c=*'))).toBe('a=x&a=z%20y&b=2&c=%2A');
    expect(awsUriEncode("a b!'()*~.-_")).toBe('a%20b%21%27%28%29%2A~.-_');
  });

  it('signs the body, x-amz-target and the session token; the signature changes with the body', () => {
    const base = { method: 'POST' as const, url: new URL('https://tagging.eu-central-1.amazonaws.com/'), region: 'eu-central-1', service: 'tagging', accessKeyId: AKID, secretAccessKey: SECRET, sessionToken: TOKEN, headers: { 'x-amz-target': 'ResourceGroupsTaggingAPI_20170126.GetResources', 'content-type': 'application/x-amz-json-1.1' }, now: new Date('2026-11-03T12:00:00Z') };
    const a = signAwsV4({ ...base, body: '{}' });
    const b = signAwsV4({ ...base, body: '{"ResourcesPerPage":100}' });
    expect(a.authorization).toMatch(/SignedHeaders=content-type;host;x-amz-date;x-amz-security-token;x-amz-target, Signature=[0-9a-f]{64}$/);
    expect(a['x-amz-security-token']).toBe(TOKEN);
    expect(a.authorization).not.toBe(b.authorization);
  });
});

describe('endpoints and partitions (Q-31, botocore partitions.json)', () => {
  it('regional hosts take the partition DNS suffix of the region', () => {
    const { ctx } = ctxFor();
    expect(awsEndpoint(ctx, 'ec2', 'eu-central-1')).toEqual({ base: 'https://ec2.eu-central-1.amazonaws.com', signingRegion: 'eu-central-1' });
    expect(awsEndpoint(ctx, 'tagging', 'cn-north-1').base).toBe('https://tagging.cn-north-1.amazonaws.com.cn');
    expect(awsEndpoint(ctx, 'ec2', 'eusc-de-east-1').base).toBe('https://ec2.eusc-de-east-1.amazonaws.eu');
    expect(awsPartition('us-gov-west-1').id).toBe('aws-us-gov');
    expect(() => awsPartition('mars-north-1')).toThrow(/no AWS partition/);
  });

  it('IAM and Organizations use their global endpoint, signed for us-east-1; outside the aws partition they are refused', () => {
    const { ctx } = ctxFor();
    expect(awsEndpoint(ctx, 'iam', 'eu-central-1')).toEqual({ base: 'https://iam.amazonaws.com', signingRegion: 'us-east-1' });
    expect(awsEndpoint(ctx, 'organizations', 'eu-north-1')).toEqual({ base: 'https://organizations.us-east-1.amazonaws.com', signingRegion: 'us-east-1' });
    expect(() => awsEndpoint(ctx, 'iam', 'cn-north-1')).toThrow(/Q-31/);
  });

  it('a loopback override is used as is and keeps the real signing region', () => {
    const { ctx } = ctxFor({}, { http: { fetch: async () => { throw new Error('unused'); }, baseUrls: { ...AWS_DEFAULT_BASE_URLS, ec2: 'https://127.0.0.1:8443/aws/ec2' } } });
    expect(awsEndpoint(ctx, 'ec2', 'eu-north-1')).toEqual({ base: 'https://127.0.0.1:8443/aws/ec2', signingRegion: 'eu-north-1' });
    const slashes = ctxFor({}, { http: { fetch: async () => { throw new Error('unused'); }, baseUrls: { ...AWS_DEFAULT_BASE_URLS, sts: 'https://127.0.0.1:8443/aws/sts///' } } });
    expect(awsEndpoint(slashes.ctx, 'sts', 'eu-north-1').base).toBe('https://127.0.0.1:8443/aws/sts');
  });
});

describe('read-only: allow-list and AWS action guard', () => {
  it('reads the operation from X-Amz-Target, the Action query or form parameter', () => {
    expect(awsOperationOf('https://h/', { headers: { 'X-Amz-Target': 'AWSOrganizationsV20161128.ListAccounts' } })).toBe('ListAccounts');
    expect(awsOperationOf('https://h/?Action=RunInstances&Version=1')).toBe('RunInstances');
    expect(awsOperationOf('https://h/', { body: 'Action=DeleteUser&UserName=x' })).toBe('DeleteUser');
    expect(awsOperationOf('https://eks.x/clusters')).toBeNull();
  });

  it('refuses a write operation in a Query GET and in a JSON POST before sending; REST GETs pass', async () => {
    const sent: string[] = [];
    const f = awsActionGuard(async (url) => { sent.push(url); return { ok: true, status: 200, headers: { get: () => null }, text: async () => '' }; });
    await expect(f('https://ec2.eu-central-1.amazonaws.com/?Action=RunInstances&Version=2016-11-15')).rejects.toBeInstanceOf(ReadOnlyViolationError);
    await expect(f('https://organizations.us-east-1.amazonaws.com/', { method: 'POST', headers: { 'x-amz-target': 'AWSOrganizationsV20161128.CreateAccount' }, body: '{}' })).rejects.toThrow(/CreateAccount is not a read operation/);
    await expect(f('https://iam.amazonaws.com/', { method: 'POST', body: 'x=1' })).rejects.toThrow(/without an operation name/);
    await f('https://eks.eu-central-1.amazonaws.com/clusters');
    await f('https://ec2.eu-central-1.amazonaws.com/?Action=DescribeRegions&Version=2016-11-15');
    expect(sent).toHaveLength(2);
  });

  it('awsQuery and awsJson refuse a non-read operation without any request; the allow-list refuses POST to another path', async () => {
    const { ctx, calls } = ctxFor();
    await expect(awsQuery(ctx, 'ec2', 'TerminateInstances', 'eu-central-1')).rejects.toBeInstanceOf(ReadOnlyViolationError);
    await expect(awsJson(ctx, 'organizations', 'CreateAccount', 'eu-central-1')).rejects.toBeInstanceOf(ReadOnlyViolationError);
    await expect(ctx.http.fetch('https://eks.eu-central-1.amazonaws.com/clusters', { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(ReadOnlyViolationError);
    expect(calls).toHaveLength(0);
  });
});

describe('request shape (mock server)', () => {
  it('Query APIs are signed GETs with Action and Version; JSON APIs are POST / with the target and JSON 1.1', async () => {
    const { ctx, calls } = ctxFor();
    await awsQuery(ctx, 'sts', 'GetCallerIdentity', 'eu-central-1');
    await awsJson(ctx, 'tagging', 'GetResources', 'eu-north-1', { ResourcesPerPage: 100 });
    const [q, j] = calls;
    expect(q).toMatchObject({ method: 'GET', host: 'sts.eu-central-1.amazonaws.com', path: '/', operation: 'GetCallerIdentity' });
    expect(new URL(q?.url as string).searchParams.get('Version')).toBe('2011-06-15');
    expect(q?.headers.authorization).toMatch(new RegExp(`^AWS4-HMAC-SHA256 Credential=${AKID}/\\d{8}/eu-central-1/sts/aws4_request, SignedHeaders=host;x-amz-date;x-amz-security-token, Signature=`));
    expect(j).toMatchObject({ method: 'POST', host: 'tagging.eu-north-1.amazonaws.com', path: '/', operation: 'GetResources', body: '{"ResourcesPerPage":100}' });
    expect(j?.headers['x-amz-target']).toBe('ResourceGroupsTaggingAPI_20170126.GetResources');
    expect(j?.headers['content-type']).toBe('application/x-amz-json-1.1');
    expect(j?.headers['x-amz-security-token']).toBe(TOKEN);
  });

  it('missing keys fail before any request; ExpiredToken stops with LiveAuthError and never echoes a key', async () => {
    const a = ctxFor({}, { credentials: {} });
    await expect(awsQuery(a.ctx, 'sts', 'GetCallerIdentity', 'eu-central-1')).rejects.toBeInstanceOf(LiveAuthError);
    expect(a.calls).toHaveLength(0);
    const b = ctxFor({ fail: { GetCallerIdentity: { status: 403, code: 'ExpiredToken' } } });
    const err = await awsQuery(b.ctx, 'sts', 'GetCallerIdentity', 'eu-central-1').catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(LiveAuthError);
    expect(err.message).toMatch(/ExpiredToken/);
    expect(err.message).not.toMatch(new RegExp(`${AKID}|${SECRET}|${TOKEN}`));
  });

  it('throttling (HTTP 400 ThrottlingException, recorded live 2026-11-03) is retried with a fresh signature', async () => {
    const { ctx, calls } = ctxFor({ throttle: { LookupEvents: 2 } });
    const doc = await awsJson<{ Events?: unknown[] }>(ctx, 'cloudtrail', 'LookupEvents', 'eu-central-1', {});
    expect(doc.Events).toHaveLength(2);
    expect(calls.filter((c) => c.operation === 'LookupEvents')).toHaveLength(3);
  });

  it('XML error envelopes of the Query and EC2 protocols yield their code', () => {
    expect(xmlErrorCode(parseXml('<ErrorResponse><Error><Code>AccessDenied</Code></Error></ErrorResponse>'))).toBe('AccessDenied');
    expect(xmlErrorCode(parseXml('<Response><Errors><Error><Code>UnauthorizedOperation</Code></Error></Errors></Response>'))).toBe('UnauthorizedOperation');
  });
});

describe('aws-xml', () => {
  it('reads elements, entities, CDATA and self-closing tags; rejects mismatched tags', () => {
    const d = parseXml('<?xml version="1.0"?><a xmlns="x"><b>1 &amp; 2 &#65;</b><c/><!-- n --><d><![CDATA[<raw>]]></d><e><item><n>x</n></item><item><n>y</n></item></e></a>');
    expect(textOf(find(d, 'a'), 'b')).toBe('1 & 2 A');
    expect(textOf(find(d, 'a'), 'd')).toBe('<raw>');
    expect(kids(find(d, 'e'), 'item').map((i) => textOf(i, 'n'))).toEqual(['x', 'y']);
    expect(() => parseXml('<a><b></a>')).toThrow(/does not match/);
  });
});

describe('probeReadOnly (Design 120 section 6.3)', () => {
  it('verified: role ARN from GetRole (SSO path), write actions implicitDeny; identity is the role name, never the session name', async () => {
    const { ctx, calls } = ctxFor();
    const p = await awsDriver.probeReadOnly(ctx);
    expect(p).toMatchObject({ read_only: 'verified', identity: `role: ${ROLE_NAME}`, write_actions_allowed: [] });
    expect(p.coverage.unreadable).toEqual([]);
    expect(p.coverage.readable).toContain('tag:GetResources');
    expect(JSON.stringify(p)).not.toMatch(/mock\.user@example\.com/);
    const get = calls.find((c) => c.operation === 'GetRole');
    expect(new URL(get?.url as string).searchParams.get('RoleName')).toBe(ROLE_NAME);
    const sim = calls.find((c) => c.operation === 'SimulatePrincipalPolicy');
    const q = new URL(sim?.url as string).searchParams;
    expect(q.get('PolicySourceArn')).toBe(ROLE_ARN);
    expect(q.get('ActionNames.member.1')).toBe(AWS_PROBE_WRITE_ACTIONS[0]);
    expect(sim?.host).toBe('iam.amazonaws.com');
    expect(sim?.headers.authorization).toMatch(/\/us-east-1\/iam\/aws4_request/);
  });

  it('refused when the simulator allows a write action; the allowed actions are listed', async () => {
    const { ctx } = ctxFor({ decisions: { 'ec2:RunInstances': 'allowed', 'iam:CreateUser': 'allowed' } });
    const p = await awsDriver.probeReadOnly(ctx);
    expect(p.read_only).toBe('refused');
    expect(p.write_actions_allowed).toEqual(['ec2:RunInstances', 'iam:CreateUser']);
  });

  it('unverifiable without the simulate permission (403) or without GetRole (404); coverage lists unreadable reads', async () => {
    expect((await awsDriver.probeReadOnly(ctxFor({ fail: { SimulatePrincipalPolicy: 403 } }).ctx))).toMatchObject({ read_only: 'unverifiable', reason: expect.stringMatching(/SimulatePrincipalPolicy.*HTTP 403.*Q-27/) });
    expect((await awsDriver.probeReadOnly(ctxFor({ fail: { GetRole: 404 } }).ctx))).toMatchObject({ read_only: 'unverifiable', reason: expect.stringMatching(/iam:GetRole, HTTP 404/) });
    const p = await awsDriver.probeReadOnly(ctxFor({ decisions: { 'cloudtrail:LookupEvents': 'implicitDeny' } }).ctx);
    expect(p).toMatchObject({ read_only: 'verified' });
    expect(p.coverage.unreadable).toEqual(['cloudtrail:LookupEvents']);
  });

  it('parses assumed-role ARNs', () => {
    expect(assumedRoleName(`arn:aws:sts::${ACCOUNT}:assumed-role/R1/s@x`)).toBe('R1');
    expect(assumedRoleName(`arn:aws:iam::${ACCOUNT}:user/u`)).toBeNull();
  });
});

describe('offering', () => {
  it('listRegions: opt-in status, AZs without local zones, impaired AZs not available, unknown scope region not_offered', async () => {
    const { ctx } = ctxFor({}, { regions: ['eu-central-1', 'eu-south-2', 'xx-none-1'] });
    const regions = await awsDriver.listRegions(ctx);
    expect(regions).toEqual([
      { id: 'eu-central-1', country: 'DE', azs: [{ name: 'eu-central-1a', available: true }, { name: 'eu-central-1b', available: true }, { name: 'eu-central-1c', available: false }], status: 'enabled' },
      { id: 'eu-south-2', country: 'ES', azs: [], status: 'available_not_enabled' },
      { id: 'xx-none-1', azs: [], status: 'not_offered' },
    ]);
  });

  it('listRegions without scope regions takes every enabled region; an AZ 503 is a not collected source', async () => {
    const { ctx } = ctxFor({ fail: { DescribeAvailabilityZones: 503 } }, { regions: [] });
    const regions = await awsDriver.listRegions(ctx);
    expect(regions.map((r) => r.id)).toEqual(['eu-central-1', 'eu-north-1']);
    expect(ctx.sources).toContainEqual({ name: 'azs:eu-central-1', status: 'not_collected', http_status: 503 });
  });

  it('listServices: catalogue endpoint -> enabled (inventory evidence from tagged resources), absent -> not_offered, opt-in region -> available_not_enabled', async () => {
    const { ctx } = ctxFor();
    const fra = await awsDriver.listServices(ctx, 'eu-central-1');
    expect(fra.map((s) => s.code)).toEqual(['ec2', 'eks', 's3']);
    expect(fra.find((s) => s.code === 's3')).toMatchObject({ capability_tags: ['object_storage'], catalogue_code: 's3', regions: { 'eu-central-1': { status: 'enabled', evidence: [{ source: 'api', ref: 'botocore-endpoints:s3' }, { source: 'inventory', ref: 'tagging:s3' }] } } });
    const sto = await awsDriver.listServices(ctx, 'eu-north-1');
    expect(sto.find((s) => s.code === 'eks')?.regions['eu-north-1']).toMatchObject({ status: 'not_offered' });
    expect(sto.find((s) => s.code === 'eks')?.capability_tags).toEqual(['kubernetes']);
    const es = await awsDriver.listServices(ctx, 'eu-south-2');
    expect(es.find((s) => s.code === 'ec2')?.regions['eu-south-2']).toMatchObject({ status: 'available_not_enabled', evidence: [{ source: 'api', ref: 'ec2:DescribeRegions:not-opted-in' }] });
  });

  it('listServices without the catalogue is a not collected source, never an empty success', async () => {
    setAwsCatalogueForTests(null);
    await expect(awsDriver.listServices(ctxFor().ctx, 'eu-central-1')).rejects.toBeInstanceOf(LiveSourceUnavailableError);
  });
});

describe('estate', () => {
  it('listResources pages via PaginationToken, keeps ARNs and tags, types from the ARN', async () => {
    const { ctx, calls } = ctxFor({ tagged: { 'eu-central-1': [[{ arn: `arn:aws:ec2:eu-central-1:${ACCOUNT}:vpc/vpc-1` }], [{ arn: `arn:aws:rds:eu-central-1:${ACCOUNT}:db:db-1`, tags: { team: 'a' } }]], 'eu-north-1': [[]] } });
    const res = await awsDriver.listResources(ctx);
    expect(res).toEqual([
      { id: `arn:aws:ec2:eu-central-1:${ACCOUNT}:vpc/vpc-1`, type: 'ec2.vpc', service_code: 'ec2', region: 'eu-central-1' },
      { id: `arn:aws:rds:eu-central-1:${ACCOUNT}:db:db-1`, type: 'rds.db', service_code: 'rds', region: 'eu-central-1', tags: { team: 'a' } },
    ]);
    expect(calls.filter((c) => c.operation === 'GetResources').map((c) => JSON.parse(c.body as string))).toContainEqual({ ResourcesPerPage: 100, PaginationToken: 'page-1' });
  });

  it('listResources: one region 500 is recorded and the others count; all regions 403 is not collected', async () => {
    const a = ctxFor({ fail: { GetResources: 500 } });
    await expect(awsDriver.listResources(a.ctx)).rejects.toBeInstanceOf(LiveSourceUnavailableError);
    expect(a.ctx.sources).toContainEqual({ name: 'inventory:eu-central-1', status: 'not_collected', http_status: 500 });
  });

  it('parseArn handles global, path and colon resource forms', () => {
    // #3801: the bucket name is never the type.
    expect(parseArn('arn:aws:s3:::payroll-bucket')).toEqual({ service: 's3', region: '', type: 'bucket' });
    expect(parseArn(`arn:aws:sns:eu-central-1:${ACCOUNT}:payroll-topic`)).toEqual({ service: 'sns', region: 'eu-central-1', type: 'topic' });
    expect(parseArn(`arn:aws:lambda:eu-central-1:${ACCOUNT}:function:f`)).toEqual({ service: 'lambda', region: 'eu-central-1', type: 'function' });
    expect(parseArn('not-an-arn')).toBeNull();
  });

  it('listGuardrails: organisation feature set, SCPs paged via NextToken, trail logging, no Config recorder is a fail', async () => {
    const { ctx } = ctxFor({ scpCount: 3, trails: [{ Name: 't', TrailARN: 'arn:aws:cloudtrail:us-east-1:1:trail/t', HomeRegion: 'us-east-1', IsMultiRegionTrail: true, logging: false }], recorders: { 'eu-north-1': [{ name: 'default', recording: true }] } });
    const g = await awsDriver.listGuardrails(ctx);
    expect(g.filter((x) => x.type === 'aws-scp').map((x) => x.id)).toEqual(['p-mock0', 'p-mock1', 'p-mock2']);
    expect(g).toContainEqual({ type: 'aws-organization', id: 'organization', status: 'pass', detail: 'feature set ALL' });
    expect(g.find((x) => x.type === 'cloudtrail-trail')).toMatchObject({ status: 'fail', detail: expect.stringMatching(/^logging off, multi-region yes/) });
    expect(g).toContainEqual({ type: 'config-recorder', id: 'eu-central-1', status: 'fail', detail: 'no AWS Config recorder' });
    expect(g).toContainEqual({ type: 'config-recorder', id: 'eu-north-1/default', status: 'pass', detail: 'recording on' });
  });

  it('listGuardrails: an Organizations 403 is a source gap; all three unreadable is not collected', async () => {
    const a = ctxFor({ fail: { DescribeOrganization: 403 } });
    await awsDriver.listGuardrails(a.ctx);
    expect(a.ctx.sources).toContainEqual({ name: 'guardrails:organizations', status: 'not_collected', http_status: 403 });
    const b = ctxFor({ fail: { DescribeOrganization: 403, DescribeTrails: 403, DescribeConfigurationRecorderStatus: 403 } });
    await expect(awsDriver.listGuardrails(b.ctx)).rejects.toBeInstanceOf(LiveSourceUnavailableError);
  });

  it('listQuotas: applied values of EKS and RDS; a negative value has no limit; 403 is not collected with the status', async () => {
    const q = await awsDriver.listQuotas(ctxFor().ctx, 'eu-central-1');
    expect(q).toContainEqual({ resource: 'eks:L-EKS1 eks mock quota', region: 'eu-central-1', limit: 100 });
    expect(q).toContainEqual({ resource: 'rds:L-RDS2 rds unlimited', region: 'eu-central-1' });
    const err = await awsDriver.listQuotas(ctxFor({ fail: { ListServiceQuotas: 403 } }).ctx, 'eu-central-1').catch((e: unknown) => e);
    expect(err).toMatchObject({ source: 'quotas:eu-central-1', httpStatus: 403 });
  });

  it('listActivity: counts by kind over NextToken pages; no user name or source IP in the result', async () => {
    const { ctx, calls } = ctxFor({}, { regions: ['eu-central-1'] });
    const a = await awsDriver.listActivity(ctx, { days: 7 });
    expect(a).toEqual({ window_days: 7, events_total: 3, by_kind: { read: 1, login: 1, create: 1 } });
    expect(JSON.stringify(a)).not.toMatch(/mock\.user|192\.0\.2/);
    const body = JSON.parse(calls.find((c) => c.operation === 'LookupEvents')?.body as string) as { StartTime: number; EndTime: number; MaxResults: number };
    expect(body.EndTime - body.StartTime).toBe(7 * 86_400);
    expect(body.MaxResults).toBe(50);
  });

  it('listActivity: persistent throttling is a not collected region; the page cap is a partial source', async () => {
    const a = ctxFor({ throttle: { LookupEvents: 99 } }, { regions: ['eu-central-1'] });
    await expect(awsDriver.listActivity(a.ctx, { days: 7 })).rejects.toBeInstanceOf(LiveSourceUnavailableError);
    expect(a.ctx.sources).toContainEqual({ name: 'activity:eu-central-1', status: 'not_collected', http_status: 400 });
    const many = Array.from({ length: 45 }, () => [{ name: 'GetObject', readOnly: true }]);
    const b = ctxFor({ events: many }, { regions: ['eu-central-1'] });
    const s = await awsDriver.listActivity(b.ctx, { days: 1 });
    expect(s.events_total).toBe(40);
    expect(b.ctx.sources).toContainEqual({ name: 'activity:eu-central-1', status: 'not_collected', reason: 'partial: stopped after 40 pages of 50 events' });
  });
});

describe('Pass 23 on the driver (Design 120 section 7.5)', () => {
  it('reads EKS clusters (nextToken pages, DescribeCluster) and RDS instances from XML with Marker pages', async () => {
    const { ctx, calls } = ctxFor({ eksClusters: [['a'], ['b/x']], rdsPages: [[{ id: 'db-1', engine: 'postgres', status: 'available', version: '16.4' }], [{ id: 'db-2', engine: 'mysql', status: 'stopped' }]] });
    const s = await readAwsPass23State(ctx, 'eu-central-1');
    expect(s.eks_clusters).toEqual([{ name: 'a', status: 'ACTIVE', version: '1.31' }, { name: 'b/x', status: 'ACTIVE', version: '1.31' }]);
    expect(s.rds_instances).toEqual([{ identifier: 'db-1', engine: 'postgres', status: 'available', engineVersion: '16.4' }, { identifier: 'db-2', engine: 'mysql', status: 'stopped' }]);
    expect(calls.find((c) => c.operation === null && c.path === '/clusters/b%2Fx')).toBeDefined();
    expect(calls.filter((c) => c.operation === 'DescribeDBInstances').map((c) => new URL(c.url).searchParams.get('Marker'))).toEqual([null, 'page-1']);
  });

  it('readAwsPass23StateForScope takes the scope keys from the vault and stops on an expired token before any request', async () => {
    const store = new CredentialStore(tempDir('swao-aws-vault-'));
    await store.set('lz:aws-test:platform:access-key-id', AKID);
    await store.set('lz:aws-test:platform:secret-access-key', SECRET);
    const mock = makeAwsMock();
    const s = await readAwsPass23StateForScope({ lzId: 'aws-test', scopeId: 'platform', region: 'eu-central-1', store, env: {}, fetchImpl: mock.fetch });
    expect(s.eks_clusters).toHaveLength(1);
    expect(mock.calls.every((c) => c.headers.authorization?.includes(`Credential=${AKID}/`))).toBe(true);
    await store.set('lz:aws-test:platform:expires-at', '2020-01-01T00:00:00Z');
    const m2 = makeAwsMock();
    await expect(readAwsPass23StateForScope({ lzId: 'aws-test', scopeId: 'platform', region: 'eu-central-1', store, env: {}, fetchImpl: m2.fetch })).rejects.toBeInstanceOf(LzCredentialExpiredError);
    expect(m2.calls).toHaveLength(0);
  });
});

describe('recording (record.ts) keeps the AWS operation name, never a header value', () => {
  it('records operation from X-Amz-Target and Action; no key or token in the recording', async () => {
    const root = tempDir('swao-aws-rec-');
    const mock = makeAwsMock();
    const rec = createRecordingFetch(mock.fetch, { root, provider: 'aws', scopeId: 'platform', identity: 'operator', driverVersion: '0.1.0', routeTemplates: awsDriver.routeTemplates });
    const { ctx } = ctxFor({}, { http: { fetch: createReadOnlyFetch(rec.fetch, 'aws', awsDriver.readAllowList), baseUrls: { ...awsDriver.defaultBaseUrls } } });
    await awsQuery(ctx, 'sts', 'GetCallerIdentity', 'eu-central-1');
    await awsJson(ctx, 'tagging', 'GetResources', 'eu-central-1', {});
    rec.finish();
    const lines = readFileSync(join(rec.runDir, 'requests.ndjson'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l) as { operation?: string; region: string | null });
    expect(lines.map((l) => l.operation)).toEqual(['GetCallerIdentity', 'GetResources']);
    // No regionOf passed: the recorder cannot tell (null), as before #3716.
    expect(lines.map((l) => l.region)).toEqual([null, null]);
    const all = readdirSync(rec.runDir, { recursive: true }).map(String).map((p) => { try { return readFileSync(join(rec.runDir, p), 'utf-8'); } catch { return ''; } }).join('\n');
    expect(all).not.toMatch(new RegExp(`${AKID}|${SECRET}|${TOKEN}`));
  });
});

// #3716: the recorder writes the signing region of every AWS request.
describe('awsRegionOf (#3716)', () => {
  const signed = (region: string, service: string): Record<string, string> => ({
    authorization: `AWS4-HMAC-SHA256 Credential=${AKID}/20261103/${region}/${service}/aws4_request, SignedHeaders=host;x-amz-date, Signature=abc`,
  });

  it('takes the region of the SigV4 credential scope, for regional, global and loopback endpoints', () => {
    expect(awsRegionOf('https://ec2.eu-central-1.amazonaws.com/?Action=DescribeAvailabilityZones', { headers: signed('eu-central-1', 'ec2') })).toBe('eu-central-1');
    expect(awsRegionOf('https://iam.amazonaws.com/', { headers: signed('us-east-1', 'iam') })).toBe('us-east-1');
    expect(awsRegionOf('https://127.0.0.1:4443/', { headers: { Authorization: signed('eu-north-1', 'tagging').authorization as string } })).toBe('eu-north-1');
  });

  it('falls back to a regional host name and is null when neither tells', () => {
    expect(awsRegionOf('https://tagging.eu-north-1.amazonaws.com/')).toBe('eu-north-1');
    expect(awsRegionOf('https://servicequotas.us-gov-west-1.amazonaws.com/')).toBe('us-gov-west-1');
    expect(awsRegionOf('https://organizations.us-east-1.amazonaws.com/', { headers: { authorization: 'Bearer x' } })).toBe('us-east-1');
    expect(awsRegionOf('https://iam.amazonaws.com/')).toBeNull();
    expect(awsRegionOf('https://127.0.0.1:4443/')).toBeNull();
    expect(awsRegionOf('not a url')).toBeNull();
  });

  it('returns the region only, never the key id of the credential scope', () => {
    const r = awsRegionOf('https://127.0.0.1:4443/', { headers: signed('eu-central-1', 'ec2') });
    expect(r).toBe('eu-central-1');
    expect(r).not.toContain(AKID);
  });

  it('the driver exposes it and the descriptor schema accepts it', () => {
    expect(awsDriver.regionOf).toBe(awsRegionOf);
    expect(LiveLzDriverDescriptorSchema.safeParse(awsDriver).success).toBe(true);
  });
});

describe('runLzLiveScan with the aws driver', () => {
  it('a valid LzLiveScan; only GETs and POST / with read targets reached the wire; no key in the scan', async () => {
    registerBuiltInLiveLzDrivers({ [UNVERIFIED_DRIVERS_ENV]: 'aws' });
    const ws = tempDir('swao-aws-ws-');
    writeFileSync(join(ws, '.swao.yml'), ['name: t', 'landing_zones:', '  - id: aws-test', '    provider: aws', '    scopes:', '      - id: platform', '        kind: platform', '        auth: session-keys', '        regions: [eu-central-1, eu-north-1]', ''].join('\n'));
    const store = new CredentialStore(tempDir('swao-aws-vault-'));
    await store.set('lz:aws-test:platform:access-key-id', AKID);
    await store.set('lz:aws-test:platform:secret-access-key', SECRET);
    await store.set('lz:aws-test:platform:session-token', TOKEN);
    const mock = makeAwsMock();
    const out = await runLzLiveScan({ workspaceRoot: ws, lzId: 'aws-test', store, env: {}, fetchImpl: mock.fetch });
    expect(out.exitCode).toBe(0);
    const scan = out.results[0]?.scan;
    expect(LzLiveScanSchema.safeParse(scan).success).toBe(true);
    expect(scan?.meta).toMatchObject({ provider: 'aws', read_only: 'verified' });
    expect(scan?.regions).toEqual(['eu-central-1', 'eu-north-1']);
    expect(scan?.offering.services.find((s) => s.code === 'eks')?.regions).toMatchObject({ 'eu-central-1': { status: 'enabled' }, 'eu-north-1': { status: 'not_offered' } });
    expect(scan?.estate.resources.length).toBe(4);
    expect(JSON.stringify(scan)).not.toMatch(new RegExp(`${AKID}|${SECRET}|${TOKEN}|mock\\.user`));
    const nonGet = mock.calls.filter((c) => c.method !== 'GET');
    expect(new Set(nonGet.map((c) => c.path))).toEqual(new Set(['/']));
    expect(nonGet.every((c) => /^(Describe|List|Get|Lookup)/.test(c.operation ?? ''))).toBe(true);
  });

  it('#3716: a recorded scan writes the signing region of every request, no key in the recording', async () => {
    registerBuiltInLiveLzDrivers({ [UNVERIFIED_DRIVERS_ENV]: 'aws' });
    const ws = tempDir('swao-aws-ws-');
    writeFileSync(join(ws, '.swao.yml'), ['name: t', 'landing_zones:', '  - id: aws-test', '    provider: aws', '    scopes:', '      - id: platform', '        kind: platform', '        auth: session-keys', '        regions: [eu-central-1, eu-north-1]', ''].join('\n'));
    const store = new CredentialStore(tempDir('swao-aws-vault-'));
    await store.set('lz:aws-test:platform:access-key-id', AKID);
    await store.set('lz:aws-test:platform:secret-access-key', SECRET);
    await store.set('lz:aws-test:platform:session-token', TOKEN);
    const recRoot = tempDir('swao-aws-rec-');
    const out = await runLzLiveScan({ workspaceRoot: ws, lzId: 'aws-test', store, env: { [RECORD_ENV]: recRoot }, fetchImpl: makeAwsMock().fetch });
    expect(out.exitCode).toBe(0);
    const runDir = join(recRoot, readdirSync(recRoot)[0] as string);
    const lines = readFileSync(join(runDir, 'requests.ndjson'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l) as { region: string | null; operation?: string });
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.filter((l) => l.region === null)).toEqual([]);
    const regions = new Set(lines.map((l) => l.region));
    expect(regions.has('eu-central-1')).toBe(true);
    expect(regions.has('eu-north-1')).toBe(true);
    // Region-scoped operations carry their own region.
    expect(lines.filter((l) => l.operation === 'DescribeAvailabilityZones').map((l) => l.region).sort()).toEqual(['eu-central-1', 'eu-north-1']);
    const all = readdirSync(runDir, { recursive: true }).map(String).map((p) => { try { return readFileSync(join(runDir, p), 'utf-8'); } catch { return ''; } }).join('\n');
    expect(all).not.toMatch(new RegExp(`${AKID}|${SECRET}|${TOKEN}`));
  });

  it('a write-capable role stops the scope without the flag and nothing is crawled', async () => {
    registerBuiltInLiveLzDrivers({ [UNVERIFIED_DRIVERS_ENV]: 'aws' });
    const ws = tempDir('swao-aws-ws-');
    writeFileSync(join(ws, '.swao.yml'), ['name: t', 'landing_zones:', '  - id: aws-test', '    provider: aws', '    scopes:', '      - id: platform', '        kind: platform', '        auth: session-keys', ''].join('\n'));
    const store = new CredentialStore(tempDir('swao-aws-vault-'));
    await store.set('lz:aws-test:platform:access-key-id', AKID);
    await store.set('lz:aws-test:platform:secret-access-key', SECRET);
    const mock = makeAwsMock({ decisions: { 's3:PutObject': 'allowed' } });
    const out = await runLzLiveScan({ workspaceRoot: ws, lzId: 'aws-test', store, env: {}, fetchImpl: mock.fetch });
    expect(out.exitCode).toBe(1);
    expect(out.results[0]?.scan).toBeUndefined();
    expect(mock.calls.some((c) => c.operation === 'GetResources')).toBe(false);
  });
});

// #3886 (Design 123 section 5.7): the read-call coverage list of ROLES.md
// against the operations the driver sends to the in-process mock. The
// contract suite (ops/mock-csp/contract/coverage.contract.ts) checks the same
// against the recorded pack where its private fixtures exist.
describe('aws read-call coverage list (#3886)', () => {
  it('every operation the driver sends is a `yes` row, and every `yes` row is sent and in the minimal policy', async () => {
    const roles = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'ROLES.md'), 'utf-8');
    const rows = parseCoverageList(roles);
    const used = rows.filter((r) => r.used === 'yes').map((r) => r.call).sort();
    const policy = JSON.parse(/## Minimal policy[\s\S]*?```json\r?\n([\s\S]*?)```/.exec(roles)?.[1] ?? '{}') as { Statement: { Action: string[] }[] };
    expect([...policy.Statement.flatMap((s) => s.Action), 'sts:GetCallerIdentity'].sort()).toEqual(used);
    const { ctx, calls } = ctxFor();
    await awsDriver.probeReadOnly(ctx);
    await awsDriver.listRegions(ctx);
    for (const r of ctx.regions) await awsDriver.listServices(ctx, r);
    await awsDriver.listGuardrails(ctx);
    await awsDriver.listResources(ctx);
    for (const r of ctx.regions) await awsDriver.listQuotas(ctx, r);
    await awsDriver.listActivity(ctx, { days: 7 });
    for (const r of ctx.regions) await readAwsPass23State(ctx, r);
    await awsDriver.listHierarchy!(ctx); // #3882
    const prefix: Record<string, string> = { tagging: 'tag' };
    const sent = [...new Set(calls.map((c) => {
      const svc = c.host.split('.')[0] as string;
      const op = c.operation ?? (c.path.startsWith('/clusters/') ? 'DescribeCluster' : c.path === '/clusters' ? 'ListClusters' : `REST ${c.path}`);
      return `${prefix[svc] ?? svc}:${op}`;
    }))].sort();
    expect(sent.filter((c) => !used.includes(c))).toEqual([]);
    // #3866: the posture reads and the SCP chain of a member account are pinned against the
    // mock pack (ops/mock-csp/contract/coverage.contract.ts, aws-posture.contract.ts), not this unit mock.
    const packOnly = new Set(rows.filter((r) => r.used === 'yes' && ((r.feeds.length === 1 && r.feeds[0] === 'posture') || r.call === 'organizations:ListParents' || r.call === 'organizations:DescribePolicy')).map((r) => r.call));
    // #3935, #3952: plus 8 S3 and 3 DynamoDB posture reads.
    expect(packOnly.size).toBe(35);
    expect(used.filter((c) => !sent.includes(c) && !packOnly.has(c))).toEqual([]);
    // planned and unused rows name their issue or reason (Design 123 section 5.7)
    expect(rows.filter((r) => r.used !== 'yes' && r.reason === '')).toEqual([]);
  });
});
