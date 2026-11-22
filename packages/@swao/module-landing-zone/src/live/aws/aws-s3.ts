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

// #3935 (Design 123 section 5.4, AWS table): the S3 and S3 Control reads of the
// posture collector, REST-XML GETs through `awsRestXmlGet` (read operations
// only, path-style `/<bucket>?<subresource>`), and the parsers of their
// answers. Shapes from the S3 API Reference (ListBuckets, GetBucketLocation,
// GetBucketEncryption, GetPublicAccessBlock, GetBucketPolicyStatus,
// GetBucketAcl, GetBucketLifecycleConfiguration; S3 Control
// GetPublicAccessBlock), read 2026-11-06. A 404 whose code says "not
// configured" is an answer (`absent`), never a failure.

import type { ScopeCtx } from '../types.js';
import { awsRestXmlGet } from './aws-client.js';
import { find, kids, textOf } from './aws-xml.js';
import type { XmlNode } from './aws-xml.js';
import type { AwsBucketEncryption, AwsLifecycleRule, AwsPublicAccessBlock } from './aws-posture.js';

const MAX_PAGES = 100;

/** S3 error codes that mean "this configuration does not exist" (S3 API Reference, error codes of each operation). */
export const S3_ABSENT = {
  encryption: 'ServerSideEncryptionConfigurationNotFoundError',
  publicAccessBlock: 'NoSuchPublicAccessBlockConfiguration',
  policy: 'NoSuchBucketPolicy',
  lifecycle: 'NoSuchLifecycleConfiguration',
} as const;

const bucketPath = (bucket: string): string => `/${encodeURIComponent(bucket)}`;
const bool = (v: string | undefined): boolean | undefined => (v === undefined ? undefined : v.toLowerCase() === 'true' ? true : v.toLowerCase() === 'false' ? false : undefined);

export interface S3Bucket { name: string; region?: string }

/**
 * ListBuckets (paginated form, `max-buckets`, `continuation-token`; the
 * paginated answer carries `BucketRegion`). Sent to the home region endpoint.
 */
export async function listBuckets(ctx: ScopeCtx, home: string): Promise<S3Bucket[]> {
  const out: S3Bucket[] = [];
  let token = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const a = await awsRestXmlGet(ctx, 's3', 'ListBuckets', home, '/', { 'max-buckets': '1000', ...(token ? { 'continuation-token': token } : {}) });
    const doc = a.doc as XmlNode;
    for (const b of kids(find(doc, 'Buckets'), 'Bucket')) {
      const name = textOf(b, 'Name');
      if (!name) continue;
      const region = textOf(b, 'BucketRegion');
      out.push({ name, ...(region ? { region } : {}) });
    }
    token = textOf(find(doc, 'ListAllMyBucketsResult'), 'ContinuationToken') ?? '';
    if (!token) break;
  }
  return out;
}

/**
 * GetBucketLocation `LocationConstraint`: empty means us-east-1 and the legacy
 * value `EU` means eu-west-1 (S3 API Reference, GetBucketLocation).
 */
export function locationToRegion(constraint: string | undefined): string {
  const c = (constraint ?? '').trim();
  if (c === '') return 'us-east-1';
  if (c === 'EU') return 'eu-west-1';
  return c;
}

export async function bucketRegion(ctx: ScopeCtx, home: string, bucket: string): Promise<string> {
  const a = await awsRestXmlGet(ctx, 's3', 'GetBucketLocation', home, bucketPath(bucket), { location: '' });
  const doc = a.doc as XmlNode;
  return locationToRegion(find(doc, 'LocationConstraint')?.text);
}

/** GetBucketEncryption: the first rule's default; null when no configuration exists. */
export async function bucketEncryption(ctx: ScopeCtx, region: string, bucket: string): Promise<AwsBucketEncryption | null> {
  const a = await awsRestXmlGet(ctx, 's3', 'GetBucketEncryption', region, bucketPath(bucket), { encryption: '' }, { absentCodes: [S3_ABSENT.encryption] });
  if (a.absent !== undefined) return null;
  const def = find(a.doc, 'ApplyServerSideEncryptionByDefault');
  const algorithm = textOf(def, 'SSEAlgorithm');
  const kmsKeyId = textOf(def, 'KMSMasterKeyID');
  return { ...(algorithm ? { algorithm } : {}), ...(kmsKeyId ? { kmsKeyId } : {}) };
}

function pab(doc: XmlNode): AwsPublicAccessBlock {
  const c = find(doc, 'PublicAccessBlockConfiguration') ?? doc;
  const out: AwsPublicAccessBlock = {};
  for (const k of ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'] as const) {
    const v = bool(textOf(c, k));
    // An element left out of the answer is false (S3 API Reference: the flags default to false).
    out[k] = v ?? false;
  }
  return out;
}

const NO_PAB: Required<AwsPublicAccessBlock> = { BlockPublicAcls: false, IgnorePublicAcls: false, BlockPublicPolicy: false, RestrictPublicBuckets: false };

/** Bucket-level GetPublicAccessBlock; every flag false when none is set. */
export async function bucketPublicAccessBlock(ctx: ScopeCtx, region: string, bucket: string): Promise<AwsPublicAccessBlock> {
  const a = await awsRestXmlGet(ctx, 's3', 'GetPublicAccessBlock', region, bucketPath(bucket), { publicAccessBlock: '' }, { absentCodes: [S3_ABSENT.publicAccessBlock] });
  return a.absent !== undefined ? { ...NO_PAB } : pab(a.doc);
}

/** S3 Control GetPublicAccessBlock of the account (`x-amz-account-id`); every flag false when none is set. */
export async function accountPublicAccessBlock(ctx: ScopeCtx, region: string, account: string): Promise<AwsPublicAccessBlock> {
  const a = await awsRestXmlGet(ctx, 's3control', 'GetPublicAccessBlock', region, '/v20180820/configuration/publicAccessBlock', {}, { absentCodes: [S3_ABSENT.publicAccessBlock], headers: { 'x-amz-account-id': account }, account });
  return a.absent !== undefined ? { ...NO_PAB } : pab(a.doc);
}

/** GetBucketPolicyStatus `PolicyStatus/IsPublic`; false when the bucket has no policy. */
export async function bucketPolicyPublic(ctx: ScopeCtx, region: string, bucket: string): Promise<boolean | undefined> {
  const a = await awsRestXmlGet(ctx, 's3', 'GetBucketPolicyStatus', region, bucketPath(bucket), { policyStatus: '' }, { absentCodes: [S3_ABSENT.policy] });
  if (a.absent !== undefined) return false;
  return bool(textOf(find(a.doc, 'PolicyStatus') ?? a.doc, 'IsPublic'));
}

/** The predefined groups that make an ACL grant public (S3 User Guide, "Access control list (ACL) overview", Amazon S3 predefined groups). */
const PUBLIC_GROUPS = /^https?:\/\/acs\.amazonaws\.com\/groups\/global\/(AllUsers|AuthenticatedUsers)$/;

/** GetBucketAcl: whether any grant goes to AllUsers or AuthenticatedUsers. Grantee ids, names and addresses are never kept. */
export async function bucketAclPublic(ctx: ScopeCtx, region: string, bucket: string): Promise<boolean> {
  const a = await awsRestXmlGet(ctx, 's3', 'GetBucketAcl', region, bucketPath(bucket), { acl: '' });
  return kids(find(a.doc as XmlNode, 'AccessControlList'), 'Grant').some((g) => PUBLIC_GROUPS.test(textOf(find(g, 'Grantee'), 'URI') ?? ''));
}

/** Lifecycle rules of a GetBucketLifecycleConfiguration answer (the rule-level legacy `Prefix`, `Filter/Prefix` or `Filter/And/Prefix`). */
export function parseLifecycleRules(doc: XmlNode): AwsLifecycleRule[] {
  const conf = find(doc, 'LifecycleConfiguration') ?? doc;
  return kids(conf, 'Rule').map((r) => {
    const filter = kids(r, 'Filter')[0];
    const and = filter ? kids(filter, 'And')[0] : undefined;
    const prefix = textOf(r, 'Prefix') ?? textOf(filter, 'Prefix') ?? textOf(and, 'Prefix') ?? '';
    const tagged = (filter !== undefined && kids(filter, 'Tag').length > 0) || (and !== undefined && kids(and, 'Tag').length > 0);
    const exp = kids(r, 'Expiration')[0];
    const days = textOf(exp, 'Days');
    return {
      enabled: textOf(r, 'Status') === 'Enabled',
      prefix,
      tagged,
      ...(days !== undefined && /^\d+$/.test(days) ? { expirationDays: Number(days) } : {}),
      ...(textOf(exp, 'Date') !== undefined ? { expirationDate: true } : {}),
    };
  });
}

/** GetBucketLifecycleConfiguration; an empty list when the bucket has no lifecycle. */
export async function bucketLifecycle(ctx: ScopeCtx, region: string, bucket: string): Promise<AwsLifecycleRule[]> {
  const a = await awsRestXmlGet(ctx, 's3', 'GetBucketLifecycleConfiguration', region, bucketPath(bucket), { lifecycle: '' }, { absentCodes: [S3_ABSENT.lifecycle] });
  return a.absent !== undefined ? [] : parseLifecycleRules(a.doc);
}
