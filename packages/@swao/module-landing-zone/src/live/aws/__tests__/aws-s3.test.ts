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

// #3935, #3952: the REST-XML transport (S3, S3 Control), the DynamoDB JSON 1.0
// content type, the S3 parsers and the S3 and DynamoDB posture mappings. The
// driver side is pinned against the mock pack (ops/mock-csp/contract/aws-posture.contract.ts).

import { describe, expect, it } from 'vitest';
import { LzLivePostureSchema } from '@swao/core';
import type { FetchLike, LiveResponse, ScopeCtx } from '../../types.js';
import { createReadOnlyFetch, ReadOnlyViolationError } from '../../http.js';
import { LiveAuthError } from '../../errors.js';
import { awsDriver } from '../aws-driver.js';
import { AwsApiError, S3_EMPTY_PAYLOAD_SHA256, awsJson, awsRestXmlGet } from '../aws-client.js';
import { signAwsV4 } from '../aws-sign.js';
import { parseXml } from '../aws-xml.js';
import { accountPublicAccessBlock, bucketAclPublic, bucketEncryption, bucketLifecycle, bucketPolicyPublic, bucketPublicAccessBlock, listBuckets, locationToRegion, parseLifecycleRules } from '../aws-s3.js';
import { backupFacts, bucketNeeds, dynamoEncryptionFact, effectiveFlag, lifecycleRetention, s3EncryptionFact, s3ExposureFact, trailFacts } from '../aws-posture.js';

const AKID = ['MOCK', 'ACCESS', 'ID'].join('');
const SECRET = ['mock', 'secret', 'value'].join('-');
const ACCOUNT = '111122223333';

interface Seen { url: URL; method: string; headers: Record<string, string> }

function ctxWith(answer: (url: URL, headers: Record<string, string>) => { status: number; body: string; contentType?: string }): { ctx: ScopeCtx; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const headers = Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    seen.push({ url: u, method: (init?.method ?? 'GET').toUpperCase(), headers });
    const a = answer(u, headers);
    const res: LiveResponse = { ok: a.status >= 200 && a.status < 300, status: a.status, headers: new Headers({ 'content-type': a.contentType ?? 'application/xml' }), text: async () => a.body };
    return res;
  };
  const ctx: ScopeCtx = {
    lzId: 'aws-test', provider: 'aws', scopeId: 'platform', scopeKind: 'platform', auth: 'session-keys', regions: ['eu-central-1'], target: { region: 'eu-central-1' },
    credentials: { 'access-key-id': AKID, 'secret-access-key': SECRET },
    http: { fetch: createReadOnlyFetch(fetch, 'aws', awsDriver.readAllowList), baseUrls: { ...awsDriver.defaultBaseUrls } },
    sources: [],
  };
  return { ctx, seen };
}

const s3Error = (code: string, message: string): string => `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${message}</Message><RequestId>0000000000000000</RequestId><HostId>bW9jaw==</HostId></Error>`;

describe('S3 SigV4 (#3935)', () => {
  it('signs the S3 API Reference example "GET Bucket Lifecycle" (sig-v4-header-based-auth) to its published signature', () => {
    // The published example credentials of the AWS documentation, assembled at runtime.
    const keyId = ['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('');
    const secret = ['wJalrXUtnFEMI', 'K7MDENG', 'bPxRfiCYEXAMPLEKEY'].join('/');
    const url = new URL('https://examplebucket.s3.amazonaws.com/');
    url.searchParams.set('lifecycle', '');
    const h = signAwsV4({ method: 'GET', url, region: 'us-east-1', service: 's3', accessKeyId: keyId, secretAccessKey: secret, headers: { 'x-amz-content-sha256': S3_EMPTY_PAYLOAD_SHA256 }, now: new Date('2013-05-24T00:00:00Z') });
    expect(h.authorization).toBe(`AWS4-HMAC-SHA256 Credential=${keyId}/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543`);
  });
});

describe('REST-XML transport (#3935)', () => {
  it('path-style GET to the bucket region with the signed x-amz-content-sha256 header', async () => {
    const { ctx, seen } = ctxWith(() => ({ status: 200, body: '<ServerSideEncryptionConfiguration><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>AES256</SSEAlgorithm></ApplyServerSideEncryptionByDefault></Rule></ServerSideEncryptionConfiguration>' }));
    expect(await bucketEncryption(ctx, 'eu-north-1', 'bucket-a')).toEqual({ algorithm: 'AES256' });
    const r = seen[0] as Seen;
    expect(r.method).toBe('GET');
    expect(`${r.url.origin}${r.url.pathname}`).toBe('https://s3.eu-north-1.amazonaws.com/bucket-a');
    expect([...r.url.searchParams.keys()]).toEqual(['encryption']);
    expect(r.headers['x-amz-content-sha256']).toBe(S3_EMPTY_PAYLOAD_SHA256);
    expect(r.headers['authorization']).toMatch(/\/eu-north-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date,/);
  });

  it('a "not configured" 404 is an answer; 403 AccessDenied throws with the status; InvalidAccessKeyId is an authentication failure', async () => {
    const { ctx } = ctxWith((u) => {
      if (u.searchParams.has('lifecycle')) return { status: 404, body: s3Error('NoSuchLifecycleConfiguration', 'The lifecycle configuration does not exist') };
      if (u.searchParams.has('policyStatus')) return { status: 404, body: s3Error('NoSuchBucketPolicy', 'The bucket policy does not exist') };
      if (u.searchParams.has('publicAccessBlock')) return { status: 404, body: s3Error('NoSuchPublicAccessBlockConfiguration', 'The public access block configuration was not found') };
      if (u.searchParams.has('encryption')) return { status: 403, body: s3Error('AccessDenied', 'Access Denied') };
      return { status: 403, body: s3Error('InvalidAccessKeyId', 'The AWS Access Key Id you provided does not exist in our records.') };
    });
    expect(await bucketLifecycle(ctx, 'eu-central-1', 'b')).toEqual([]);
    expect(await bucketPolicyPublic(ctx, 'eu-central-1', 'b')).toBe(false);
    expect(await bucketPublicAccessBlock(ctx, 'eu-central-1', 'b')).toEqual({ BlockPublicAcls: false, IgnorePublicAcls: false, BlockPublicPolicy: false, RestrictPublicBuckets: false });
    await expect(bucketEncryption(ctx, 'eu-central-1', 'b')).rejects.toMatchObject({ name: 'AwsApiError', status: 403, code: 'AccessDenied' });
    await expect(bucketAclPublic(ctx, 'eu-central-1', 'b')).rejects.toBeInstanceOf(LiveAuthError);
  });

  it('a 404 with another code (NoSuchBucket) is a failure, not an absent configuration', async () => {
    const { ctx } = ctxWith(() => ({ status: 404, body: s3Error('NoSuchBucket', 'The specified bucket does not exist') }));
    await expect(bucketLifecycle(ctx, 'eu-central-1', 'b')).rejects.toBeInstanceOf(AwsApiError);
  });

  it('refuses a write operation before any request', async () => {
    const { ctx, seen } = ctxWith(() => ({ status: 200, body: '<x/>' }));
    await expect(awsRestXmlGet(ctx, 's3', 'PutBucketPolicy', 'eu-central-1', '/b', { policy: '' })).rejects.toBeInstanceOf(ReadOnlyViolationError);
    expect(seen).toHaveLength(0);
  });

  it('S3 Control: the account host and the x-amz-account-id header', async () => {
    const { ctx, seen } = ctxWith(() => ({ status: 200, body: '<PublicAccessBlockConfiguration><BlockPublicAcls>true</BlockPublicAcls><IgnorePublicAcls>true</IgnorePublicAcls><BlockPublicPolicy>true</BlockPublicPolicy><RestrictPublicBuckets>true</RestrictPublicBuckets></PublicAccessBlockConfiguration>' }));
    expect(await accountPublicAccessBlock(ctx, 'eu-central-1', ACCOUNT)).toEqual({ BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true });
    const r = seen[0] as Seen;
    expect(`${r.url.origin}${r.url.pathname}`).toBe(`https://${ACCOUNT}.s3-control.eu-central-1.amazonaws.com/v20180820/configuration/publicAccessBlock`);
    expect(r.headers['x-amz-account-id']).toBe(ACCOUNT);
    expect(r.headers['authorization']).toContain('x-amz-account-id');
  });

  it('ListBuckets pages with continuation-token and keeps BucketRegion; GetBucketLocation empty is us-east-1, EU is eu-west-1', async () => {
    const { ctx, seen } = ctxWith((u) => ({ status: 200, body: u.searchParams.get('continuation-token') === 'next-1'
      ? '<ListAllMyBucketsResult><Buckets><Bucket><Name>b2</Name><BucketRegion>eu-north-1</BucketRegion></Bucket></Buckets><Owner><ID>0000</ID></Owner></ListAllMyBucketsResult>'
      : '<ListAllMyBucketsResult><Buckets><Bucket><Name>b1</Name><BucketRegion>eu-central-1</BucketRegion><CreationDate>2026-01-01T00:00:00.000Z</CreationDate></Bucket></Buckets><Owner><ID>0000</ID></Owner><ContinuationToken>next-1</ContinuationToken></ListAllMyBucketsResult>' }));
    expect(await listBuckets(ctx, 'eu-central-1')).toEqual([{ name: 'b1', region: 'eu-central-1' }, { name: 'b2', region: 'eu-north-1' }]);
    expect(seen.map((s) => s.url.pathname)).toEqual(['/', '/']);
    expect(seen[0]?.url.searchParams.get('max-buckets')).toBe('1000');
    expect(locationToRegion('')).toBe('us-east-1');
    expect(locationToRegion('EU')).toBe('eu-west-1');
    expect(locationToRegion('eu-central-1')).toBe('eu-central-1');
  });

  it('DynamoDB is JSON 1.0 (botocore jsonVersion), other JSON APIs stay 1.1', async () => {
    const { ctx, seen } = ctxWith(() => ({ status: 200, body: '{}', contentType: 'application/x-amz-json-1.0' }));
    await awsJson(ctx, 'dynamodb', 'ListTables', 'eu-central-1', {});
    await awsJson(ctx, 'kms', 'ListKeys', 'eu-central-1', {});
    expect(seen.map((s) => [s.url.host, s.headers['content-type'], s.headers['x-amz-target']])).toEqual([
      ['dynamodb.eu-central-1.amazonaws.com', 'application/x-amz-json-1.0', 'DynamoDB_20120810.ListTables'],
      ['kms.eu-central-1.amazonaws.com', 'application/x-amz-json-1.1', 'TrentService.ListKeys'],
    ]);
  });

  it('a public ACL grant is AllUsers or AuthenticatedUsers; owner grants are not', async () => {
    const acl = (uri: string) => `<AccessControlPolicy><Owner><ID>abc</ID></Owner><AccessControlList><Grant><Grantee><ID>abc</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant>${uri ? `<Grant><Grantee><URI>${uri}</URI></Grantee><Permission>READ</Permission></Grant>` : ''}</AccessControlList></AccessControlPolicy>`;
    for (const [uri, pub] of [['', false], ['http://acs.amazonaws.com/groups/global/AllUsers', true], ['http://acs.amazonaws.com/groups/global/AuthenticatedUsers', true], ['http://acs.amazonaws.com/groups/s3/LogDelivery', false]] as const) {
      const { ctx } = ctxWith(() => ({ status: 200, body: acl(uri) }));
      expect(await bucketAclPublic(ctx, 'eu-central-1', 'b'), uri).toBe(pub);
    }
  });
});

describe('S3 and DynamoDB posture mappings (#3935, #3952)', () => {
  const b = { arn: 'arn:aws:s3:::bucket-a', region: 'eu-central-1' };
  const cmk = { arn: 'arn:aws:kms:eu-central-1:111122223333:key/k1', id: 'k1', manager: 'CUSTOMER', origin: 'AWS_KMS' };

  it('bucket encryption: SSE-S3 and aws/s3 provider-managed, a customer key customer-managed, an undescribed key no custody, no configuration unencrypted', () => {
    expect(s3EncryptionFact(b, { algorithm: 'AES256' }, undefined)).toMatchObject({ type: 's3.bucket', layer: 'at_rest', encrypted: true, key_custody: 'provider-managed' });
    expect(s3EncryptionFact(b, { algorithm: 'aws:kms' }, undefined)).toMatchObject({ encrypted: true, key_custody: 'provider-managed' });
    expect(s3EncryptionFact(b, { algorithm: 'aws:kms', kmsKeyId: cmk.arn }, cmk)).toMatchObject({ encrypted: true, key_custody: 'customer-managed', key_id: cmk.arn });
    expect(s3EncryptionFact(b, { algorithm: 'aws:kms:dsse', kmsKeyId: cmk.arn }, undefined)).not.toHaveProperty('key_custody');
    expect(s3EncryptionFact(b, null, undefined)).toMatchObject({ encrypted: false });
    expect(s3EncryptionFact(b, { algorithm: 'SOMETHING_NEW' }, undefined)).not.toHaveProperty('encrypted');
  });

  it('table encryption: no SSEDescription is the AWS owned key, KMS with a customer key takes its custody', () => {
    const t = { arn: 'arn:aws:dynamodb:eu-central-1:111122223333:table/t1', region: 'eu-central-1' };
    expect(dynamoEncryptionFact(t, undefined, undefined)).toMatchObject({ type: 'dynamodb.table', encrypted: true, key_custody: 'provider-managed' });
    expect(dynamoEncryptionFact(t, { Status: 'ENABLED', SSEType: 'KMS', KMSMasterKeyArn: cmk.arn }, cmk)).toMatchObject({ encrypted: true, key_custody: 'customer-managed' });
    expect(dynamoEncryptionFact(t, { Status: 'ENABLED', SSEType: 'KMS', KMSMasterKeyArn: cmk.arn }, { ...cmk, manager: 'AWS' })).toMatchObject({ key_custody: 'provider-managed' });
    expect(dynamoEncryptionFact(t, { Status: 'UPDATING', SSEType: 'KMS', KMSMasterKeyArn: cmk.arn }, cmk)).not.toHaveProperty('key_custody');
  });

  it('bucket exposure: Block Public Access closes a path, an open policy or ACL makes it public, an unread path gives no item', () => {
    const all = { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true };
    const none = { BlockPublicAcls: false, IgnorePublicAcls: false, BlockPublicPolicy: false, RestrictPublicBuckets: false };
    expect(s3ExposureFact({ ...b }, all)).toMatchObject({ exposure: 'public_storage', public: false, attributes: { block_public_access: 'all' } });
    expect(s3ExposureFact({ ...b, bucketPab: none, policyPublic: true, aclPublic: false }, none)).toMatchObject({ public: true, attributes: { public_via: 'bucket_policy' } });
    expect(s3ExposureFact({ ...b, bucketPab: none, policyPublic: false, aclPublic: true }, none)).toMatchObject({ public: true, attributes: { public_via: 'acl' } });
    expect(s3ExposureFact({ ...b, bucketPab: none, policyPublic: false, aclPublic: false }, none)).toMatchObject({ public: false, attributes: { block_public_access: 'none' } });
    // the ACL was not read (denied) and nothing closes it: undecided
    expect(s3ExposureFact({ ...b, bucketPab: none, policyPublic: false }, none)).toBeUndefined();
    // account level unread, bucket level closes both paths
    expect(s3ExposureFact({ ...b, bucketPab: all }, undefined)).toMatchObject({ public: false });
    expect(effectiveFlag(false, undefined)).toBeUndefined();
    expect(bucketNeeds(none, all)).toEqual({ policy: false, acl: false });
    expect(bucketNeeds(none, none)).toEqual({ policy: true, acl: true });
  });

  it('lifecycle retention of the trail log objects: covering prefixes, tag filters ignored, shortest expiry, dates undecided', () => {
    const doc = parseXml('<LifecycleConfiguration><Rule><ID>r1</ID><Filter><Prefix>AWSLogs/</Prefix></Filter><Status>Enabled</Status><Expiration><Days>400</Days></Expiration></Rule><Rule><ID>r2</ID><Filter><And><Prefix>AWSLogs/</Prefix><Tag><Key>k</Key><Value>v</Value></Tag></And></Filter><Status>Enabled</Status><Expiration><Days>1</Days></Expiration></Rule><Rule><ID>r3</ID><Prefix>tmp/</Prefix><Status>Enabled</Status><Expiration><Days>2</Days></Expiration></Rule><Rule><ID>r4</ID><Filter></Filter><Status>Disabled</Status><Expiration><Days>3</Days></Expiration></Rule></LifecycleConfiguration>');
    const rules = parseLifecycleRules(doc);
    expect(rules.map((r) => [r.prefix, r.tagged, r.enabled, r.expirationDays])).toEqual([['AWSLogs/', false, true, 400], ['AWSLogs/', true, true, 1], ['tmp/', false, true, 2], ['', false, false, 3]]);
    expect(lifecycleRetention(rules, undefined, ACCOUNT)).toEqual({ days: 400 });
    expect(lifecycleRetention([], undefined, ACCOUNT)).toEqual({ never: true });
    // an organisation trail with a key prefix: a rule on this account's folder applies, another account's does not
    const r = (prefix: string, days: number) => ({ enabled: true, prefix, tagged: false, expirationDays: days });
    expect(lifecycleRetention([r(`org/AWSLogs/o-abcdefghij/${ACCOUNT}/`, 200), r('org/AWSLogs/o-abcdefghij/999999999999/', 5)], 'org/', ACCOUNT)).toEqual({ days: 200 });
    expect(lifecycleRetention([r('', 30)], 'org', ACCOUNT)).toEqual({ days: 30 });
    expect(lifecycleRetention([{ enabled: true, prefix: '', tagged: false, expirationDate: true }], undefined, ACCOUNT)).toEqual({ undecided: 'expiration_date' });
  });

  it('trail facts: the S3 lifecycle is the primary store; the longest read store wins; an unread bucket keeps the copy semantics', () => {
    const g = 'arn:aws:logs:eu-central-1:111122223333:log-group:g1';
    const trails = trailFacts([
      { arn: 'arn:aws:cloudtrail:eu-central-1:111122223333:trail/a', multiRegion: true, logging: true, logGroupArn: `${g}:*`, s3Retention: { days: 400 } },
      { arn: 'arn:aws:cloudtrail:eu-central-1:111122223333:trail/b', multiRegion: true, logging: true, s3Retention: { never: true } },
      { arn: 'arn:aws:cloudtrail:eu-central-1:111122223333:trail/c', multiRegion: true, logging: true, logGroupArn: `${g}:*`, s3Unread: 'http_403' },
    ], new Map([[g, 14]]));
    expect(trails[0]).toMatchObject({ retention_days: 400, attributes: { retention_source: 's3_lifecycle', s3_retention: 400, cloudwatch_retention: 14 } });
    expect(trails[1]).toMatchObject({ attributes: { retention_source: 's3_lifecycle', log_retention: 'never_expires' } });
    expect(trails[1]).not.toHaveProperty('retention_days');
    expect(trails[2]).toMatchObject({ retention_days: 14, attributes: { retention_source: 'cloudwatch_logs_copy', s3_lifecycle: 'http_403' } });
    LzLivePostureSchema.parse({ logging: { source: { calls: ['cloudtrail:DescribeTrails'] }, trails } });
  });

  it('backup: point-in-time recovery protects a table without a plan', () => {
    const t = 'arn:aws:dynamodb:eu-central-1:111122223333:table/t1';
    const items = backupFacts([{ arn: t, region: 'eu-central-1' }, { arn: `${t}x`, region: 'eu-central-1' }], new Set(), 0, new Set([t]));
    expect(items.map((i) => [i.type, i.protected, i.attributes?.['point_in_time_recovery']])).toEqual([['dynamodb.table', true, true], ['dynamodb.table', false, undefined]]);
  });
});
