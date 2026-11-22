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

// #3866 (Design 123 section 5.4, AWS table): pure mappings from AWS read-only
// API answers to `estate.posture` facts (#3864). The reads are `listPosture`
// in aws-driver.ts; shapes from the botocore models (ec2 2016-11-15, rds
// 2014-10-31, kms 2014-11-01, elasticloadbalancing 2015-12-01, iam
// 2010-05-08, cloudtrail 2013-11-01, logs 2014-03-28, backup 2018-11-15;
// #3935 s3 2006-03-01 and s3control 2018-08-20; #3952 dynamodb 2012-08-10).
//
// Join key: `resource_id` is the ARN, the id of `estate.resources[]` (the
// tagging API lists ARNs), and `type` is the `parseArn` type, so an evaluator
// joins tags and capability tags. EC2 answers carry ids only; the ARN is
// built from the partition, region and account (`arn:<p>:ec2:<r>:<a>:volume/<id>`).

import type { LzLivePostureInput } from '@swao/core';
import { flattenAttributes } from '../attributes.js';
import { parseArn } from './aws-arn.js';

type Posture = LzLivePostureInput;
type Item<B extends 'encryption' | 'exposure' | 'ingress_rules' | 'backup'> = NonNullable<NonNullable<Posture[B]>['items']>[number];
type Doc = Record<string, unknown>;

/** Type and service code of an ARN as the inventory names them (`ec2.volume`, `ec2`). */
function typed(arn: string): { type?: string; service_code?: string; region?: string } {
  const a = parseArn(arn);
  if (!a) return {};
  return { type: `${a.service}.${a.type}`, service_code: a.service, ...(a.region ? { region: a.region } : {}) };
}

/** Where an EC2 id lives, for its ARN. */
export interface Ec2Place { partition: string; region: string; account: string }
export const ec2Arn = (p: Ec2Place, kind: string, id: string): string => `arn:${p.partition}:ec2:${p.region}:${p.account}:${kind}/${id}`;

// ---------------------------------------------------------------------------
// Encryption at rest
// ---------------------------------------------------------------------------

/** KMS DescribeKey `KeyMetadata`: the fields custody needs. */
export interface AwsKmsKey { arn: string; id: string; manager?: string; origin?: string }

/**
 * Key custody of a KMS key (KeyMetadata `KeyManager`, `Origin`):
 * `AWS` managed -> provider-managed; customer managed keys by origin:
 * `EXTERNAL` (imported key material) -> byok, `EXTERNAL_KEY_STORE` (key held
 * outside AWS) -> hyok, `AWS_KMS` and `AWS_CLOUDHSM` -> customer-managed.
 * Unknown values give no custody (never guessed).
 */
export function kmsKeyCustody(k: AwsKmsKey): Item<'encryption'>['key_custody'] {
  if (k.manager === 'AWS') return 'provider-managed';
  if (k.manager !== 'CUSTOMER') return undefined;
  switch (k.origin) {
    case 'EXTERNAL': return 'byok';
    case 'EXTERNAL_KEY_STORE': return 'hyok';
    case 'AWS_KMS':
    case 'AWS_CLOUDHSM':
      return 'customer-managed';
    default:
      return undefined;
  }
}

/** A key reference (ARN, key id or alias ARN) resolved against the described keys. */
export function findKey(keys: readonly AwsKmsKey[], ref: string | undefined): AwsKmsKey | undefined {
  if (!ref) return undefined;
  return keys.find((k) => k.arn === ref || k.id === ref || ref.endsWith(`:key/${k.id}`));
}

export interface AwsStoredResource { arn: string; region: string; encrypted?: boolean; kmsKeyId?: string; attributes?: Doc }

/** EBS volumes and RDS instances: `encrypted` and the custody of their KMS key. */
export function atRestFacts(resources: readonly AwsStoredResource[], keys: readonly AwsKmsKey[]): Item<'encryption'>[] {
  return resources.map((r) => {
    const key = r.encrypted === true ? findKey(keys, r.kmsKeyId) : undefined;
    const custody = key ? kmsKeyCustody(key) : undefined;
    const attributes = r.attributes ? flattenAttributes(r.attributes) : undefined;
    return {
      resource_id: r.arn,
      ...typed(r.arn),
      region: r.region,
      layer: 'at_rest' as const,
      ...(typeof r.encrypted === 'boolean' ? { encrypted: r.encrypted } : {}),
      ...(r.encrypted === true && r.kmsKeyId ? { key_id: r.kmsKeyId } : {}),
      ...(custody ? { key_custody: custody } : {}),
      ...(attributes ? { attributes } : {}),
    };
  });
}

/**
 * #3935: S3 default encryption of one bucket (GetBucketEncryption
 * `ServerSideEncryptionConfiguration/Rule/ApplyServerSideEncryptionByDefault`).
 */
export interface AwsBucketEncryption { algorithm?: string; kmsKeyId?: string }

/** S3 bucket ARN (S3 bucket ARNs carry neither region nor account). */
export const s3Arn = (partition: string, bucket: string): string => `arn:${partition}:s3:::${bucket}`;

/**
 * #3935: at_rest item of an S3 bucket. `AES256` (SSE-S3) is an S3 managed key:
 * provider-managed. `aws:kms` and `aws:kms:dsse` without a key id use the AWS
 * managed key `aws/s3`: provider-managed; with a key id the custody comes from
 * that key's DescribeKey (`key` undefined = not described: custody unknown).
 * `enc` null = no default encryption configuration
 * (ServerSideEncryptionConfigurationNotFoundError): not encrypted by default.
 * An unknown algorithm gives neither a flag nor a custody (never guessed).
 */
export function s3EncryptionFact(b: { arn: string; region: string }, enc: AwsBucketEncryption | null, key: AwsKmsKey | undefined): Item<'encryption'> {
  const base = { resource_id: b.arn, ...typed(b.arn), region: b.region, layer: 'at_rest' as const };
  if (enc === null) return { ...base, encrypted: false, attributes: { sse_algorithm: 'none' } };
  const algo = enc.algorithm;
  const kms = algo === 'aws:kms' || algo === 'aws:kms:dsse';
  const custody = algo === 'AES256' || (kms && !enc.kmsKeyId) ? 'provider-managed' as const : kms && key ? kmsKeyCustody(key) : undefined;
  return {
    ...base,
    ...(algo === 'AES256' || kms ? { encrypted: true } : {}),
    ...(kms && enc.kmsKeyId ? { key_id: enc.kmsKeyId } : {}),
    ...(custody ? { key_custody: custody } : {}),
    ...(algo ? { attributes: { sse_algorithm: algo } } : {}),
  };
}

/** #3952: DescribeTable `Table.SSEDescription` (absent when the table uses the AWS owned key). */
export interface AwsTableSse { Status?: string; SSEType?: string; KMSMasterKeyArn?: string }

/**
 * #3952: at_rest item of a DynamoDB table. DynamoDB encrypts every table at
 * rest (Developer Guide, "DynamoDB encryption at rest"): without an
 * `SSEDescription`, or with `Status` DISABLED, the AWS owned key is used
 * (provider-managed). `ENABLED` with a `KMSMasterKeyArn` names a KMS key: the
 * AWS managed `aws/dynamodb` key is provider-managed, a customer managed key
 * takes its custody from DescribeKey (`key` undefined = not described). A
 * table in transition (ENABLING, DISABLING, UPDATING) is encrypted with
 * custody unknown.
 */
export function dynamoEncryptionFact(t: { arn: string; region: string }, sse: AwsTableSse | undefined, key: AwsKmsKey | undefined): Item<'encryption'> {
  const base = { resource_id: t.arn, ...typed(t.arn), region: t.region, layer: 'at_rest' as const, encrypted: true };
  if (sse === undefined || sse.Status === undefined || sse.Status === 'DISABLED') return { ...base, key_custody: 'provider-managed', attributes: { sse_type: 'aws_owned_key' } };
  const keyed = (sse.Status === 'ENABLED' || sse.Status === 'INACCESSIBLE_ENCRYPTION_CREDENTIALS') && sse.KMSMasterKeyArn !== undefined;
  const custody = keyed && key ? kmsKeyCustody(key) : undefined;
  return {
    ...base,
    ...(sse.KMSMasterKeyArn ? { key_id: sse.KMSMasterKeyArn } : {}),
    ...(custody ? { key_custody: custody } : {}),
    attributes: { sse_type: sse.SSEType ?? 'unknown', sse_status: sse.Status },
  };
}

// ---------------------------------------------------------------------------
// Encryption in transit (ELBv2 listeners)
// ---------------------------------------------------------------------------

export interface AwsListener { arn: string; region: string; protocol?: string; port?: number; sslPolicy?: string }

const TLS_OF: Readonly<Record<string, '1.0' | '1.1' | '1.2' | '1.3'>> = { TLSv1: '1.0', 'TLSv1.1': '1.1', 'TLSv1.2': '1.2', 'TLSv1.3': '1.3' };

/** Lowest TLS version of an SSL policy (DescribeSSLPolicies `SslProtocols`); undefined when none is known. */
export function tlsFloor(protocols: readonly string[]): '1.0' | '1.1' | '1.2' | '1.3' | undefined {
  const v = protocols.map((p) => TLS_OF[p]).filter((x): x is '1.0' | '1.1' | '1.2' | '1.3' => x !== undefined).sort();
  return v[0];
}

/**
 * Listener protocols (elasticloadbalancing 2015-12-01 `ProtocolEnum`):
 * HTTPS and TLS terminate TLS with the listener's SSL policy (encrypted, the
 * floor from the policy); HTTP is not encrypted; TCP, UDP, TCP_UDP and GENEVE
 * pass the traffic through, so the listener cannot tell (`encrypted` absent).
 */
export function listenerFacts(listeners: readonly AwsListener[], policies: ReadonlyMap<string, readonly string[]>): Item<'encryption'>[] {
  return listeners.map((l) => {
    const p = (l.protocol ?? '').toUpperCase();
    const floor = (p === 'HTTPS' || p === 'TLS') && l.sslPolicy ? tlsFloor(policies.get(l.sslPolicy) ?? []) : undefined;
    const attributes = flattenAttributes({ protocol: l.protocol, port: l.port, ssl_policy: l.sslPolicy });
    return {
      resource_id: l.arn,
      ...typed(l.arn),
      region: l.region,
      layer: 'in_transit' as const,
      ...(p === 'HTTPS' || p === 'TLS' ? { encrypted: true } : p === 'HTTP' ? { encrypted: false } : {}),
      ...(floor ? { min_tls_version: floor } : {}),
      ...(attributes ? { attributes } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// Exposure
// ---------------------------------------------------------------------------

export interface AwsAddress { place: Ec2Place; allocationId?: string; publicIp?: string; instanceId?: string; networkInterfaceId?: string }
export interface AwsInstance { place: Ec2Place; instanceId: string; publicIp?: string }
export interface AwsLoadBalancer { arn: string; region: string; scheme?: string; type?: string }
export interface AwsDbExposure { arn: string; region: string; publiclyAccessible?: boolean }

/**
 * Elastic IPs (bound through `instanceId` or `networkInterfaceId`), instance
 * public IPv4 addresses (`ipAddress` of DescribeInstances), load balancers
 * (`Scheme` internet-facing) and RDS instances (`PubliclyAccessible`).
 */
export function exposureFacts(addresses: readonly AwsAddress[], instances: readonly AwsInstance[], lbs: readonly AwsLoadBalancer[], dbs: readonly AwsDbExposure[]): Item<'exposure'>[] {
  const out: Item<'exposure'>[] = [];
  for (const a of addresses) {
    const id = a.allocationId ?? a.publicIp;
    if (!id) continue;
    const arn = ec2Arn(a.place, 'elastic-ip', id);
    const bound = a.instanceId ? ec2Arn(a.place, 'instance', a.instanceId) : a.networkInterfaceId ? ec2Arn(a.place, 'network-interface', a.networkInterfaceId) : undefined;
    out.push({ resource_id: arn, ...typed(arn), region: a.place.region, exposure: 'public_ip', public: true, ...(bound ? { bound_to: bound } : {}) });
  }
  for (const i of instances) {
    if (!i.publicIp) continue;
    const arn = ec2Arn(i.place, 'instance', i.instanceId);
    out.push({ resource_id: arn, ...typed(arn), region: i.place.region, exposure: 'public_ip', public: true });
  }
  for (const lb of lbs) {
    out.push({ resource_id: lb.arn, ...typed(lb.arn), region: lb.region, exposure: 'internet_endpoint', public: lb.scheme === 'internet-facing', ...(lb.type ? { attributes: { type: lb.type } } : {}) });
  }
  for (const d of dbs) {
    if (typeof d.publiclyAccessible !== 'boolean') continue;
    out.push({ resource_id: d.arn, ...typed(d.arn), region: d.region, exposure: 'internet_endpoint', public: d.publiclyAccessible });
  }
  return out;
}

/** #3935: S3 Block Public Access flags (bucket or account level); an absent flag = not read. */
export interface AwsPublicAccessBlock { BlockPublicAcls?: boolean; IgnorePublicAcls?: boolean; BlockPublicPolicy?: boolean; RestrictPublicBuckets?: boolean }

/** Every flag false: GetPublicAccessBlock answered NoSuchPublicAccessBlockConfiguration. */
export const PAB_NONE: Required<AwsPublicAccessBlock> = { BlockPublicAcls: false, IgnorePublicAcls: false, BlockPublicPolicy: false, RestrictPublicBuckets: false };

/** Effective flag of bucket and account settings (S3 applies the most restrictive): true when either is true, false when both are read false, else unknown. */
export function effectiveFlag(bucket: boolean | undefined, account: boolean | undefined): boolean | undefined {
  if (bucket === true || account === true) return true;
  return bucket === false && account === false ? false : undefined;
}

export interface AwsBucketAccess {
  arn: string;
  region: string;
  /** Bucket-level Block Public Access (undefined = not read). */
  bucketPab?: AwsPublicAccessBlock;
  /** GetBucketPolicyStatus `IsPublic` (false when the bucket has no policy; undefined = not read). */
  policyPublic?: boolean;
  /** A grant to the AllUsers or AuthenticatedUsers group in GetBucketAcl (undefined = not read). */
  aclPublic?: boolean;
}

/** Which of the policy status and the ACL still need a read, given the effective Block Public Access flags. */
export function bucketNeeds(bucketPab: AwsPublicAccessBlock | undefined, account: AwsPublicAccessBlock | undefined): { policy: boolean; acl: boolean } {
  return {
    policy: effectiveFlag(bucketPab?.RestrictPublicBuckets, account?.RestrictPublicBuckets) !== true,
    acl: effectiveFlag(bucketPab?.IgnorePublicAcls, account?.IgnorePublicAcls) !== true,
  };
}

/**
 * #3935: public_storage item of an S3 bucket (S3 User Guide, "Blocking public
 * access to your Amazon S3 storage", "The meaning of public"). A bucket is
 * public through its policy (`IsPublic`) unless RestrictPublicBuckets is in
 * effect, or through a public ACL grant unless IgnorePublicAcls is in effect
 * (bucket or account level). Public when either path is open; not public when
 * both are closed or answered not public; otherwise the reads cannot tell and
 * no item is returned (the evaluator then names the bucket as not covered,
 * never as private). Object ACLs and access points are not read.
 */
export function s3ExposureFact(b: AwsBucketAccess, account: AwsPublicAccessBlock | undefined): Item<'exposure'> | undefined {
  const restrict = effectiveFlag(b.bucketPab?.RestrictPublicBuckets, account?.RestrictPublicBuckets);
  const ignoreAcls = effectiveFlag(b.bucketPab?.IgnorePublicAcls, account?.IgnorePublicAcls);
  const side = (closed: boolean | undefined, open: boolean | undefined): boolean | undefined => {
    if (closed === true || open === false) return false;
    if (open === true && closed === false) return true;
    return undefined;
  };
  const viaPolicy = side(restrict, b.policyPublic);
  const viaAcl = side(ignoreAcls, b.aclPublic);
  const pub = viaPolicy === true || viaAcl === true ? true : viaPolicy === false && viaAcl === false ? false : undefined;
  if (pub === undefined) return undefined;
  const all = [b.bucketPab, account].some((x) => x !== undefined && x.BlockPublicAcls === true && x.IgnorePublicAcls === true && x.BlockPublicPolicy === true && x.RestrictPublicBuckets === true);
  return {
    resource_id: b.arn, ...typed(b.arn), region: b.region, exposure: 'public_storage', public: pub,
    attributes: { block_public_access: all ? 'all' : restrict === true || ignoreAcls === true ? 'partial' : 'none', ...(viaPolicy === true ? { public_via: 'bucket_policy' } : viaAcl === true ? { public_via: 'acl' } : {}) },
  };
}

// ---------------------------------------------------------------------------
// Ingress rules (DescribeSecurityGroupRules)
// ---------------------------------------------------------------------------

export interface AwsSgRule { place: Ec2Place; groupId: string; isEgress: boolean; ipProtocol?: string; fromPort?: number; toPort?: number; cidrIpv4?: string; cidrIpv6?: string; prefixListId?: string; referencedGroupId?: string }

const port = (v: number | undefined): number | undefined => (v !== undefined && Number.isInteger(v) && v >= 0 && v <= 65535 ? v : undefined);

/**
 * Inbound rules only. `IpProtocol` `-1` is any protocol and has no ports;
 * `FromPort` / `ToPort` `-1` (ICMP any, or all ports) leave the port fields
 * out. A rule names one source: IPv4 CIDR, IPv6 CIDR, a prefix list or a
 * referenced group. Security groups hold allow rules only.
 */
export function ingressRules(rules: readonly AwsSgRule[]): Item<'ingress_rules'>[] {
  return rules.filter((r) => !r.isEgress).map((r) => {
    const arn = ec2Arn(r.place, 'security-group', r.groupId);
    const anyProto = r.ipProtocol === undefined || r.ipProtocol === '-1';
    const from = anyProto ? undefined : port(r.fromPort);
    const to = anyProto ? undefined : port(r.toPort);
    const cidr = r.cidrIpv4 ?? r.cidrIpv6;
    return {
      resource_id: arn,
      ...typed(arn),
      region: r.place.region,
      protocol: anyProto ? 'any' : (r.ipProtocol as string),
      ...(from !== undefined ? { port_from: from } : {}),
      ...(to !== undefined && (from === undefined || to >= from) ? { port_to: to } : {}),
      ...(cidr ? { remote_cidr: cidr } : {}),
      ...(r.referencedGroupId ? { remote_group_id: r.referencedGroupId } : {}),
      ...(r.prefixListId && !cidr ? { attributes: { prefix_list: r.prefixListId } } : {}),
      action: 'allow' as const,
    };
  });
}

// ---------------------------------------------------------------------------
// Identity (IAM list reads; no credential report)
// ---------------------------------------------------------------------------

/** AWS managed policies that only read (Service Authorization Reference: job function and audit policies). */
const READ_ONLY_POLICY = /^arn:aws[a-z-]*:iam::aws:policy\/(?:job-function\/)?(?:ReadOnlyAccess|ViewOnlyAccess|SecurityAudit|[A-Za-z0-9]+ReadOnly(?:Access)?)$/;
export const isReadOnlyPolicy = (arn: string): boolean => READ_ONLY_POLICY.test(arn);

export interface AwsIamUser {
  /** Attached managed policy ARNs, direct and through groups. */
  policies: readonly string[];
  /** Inline policies (user and groups); not read, so they count as privileged. */
  inlinePolicies: number;
  mfaDevices: number;
  accessKeys: readonly { active: boolean; created: string }[];
}

const DAY = 86_400_000;
const ageDays = (iso: string, now: number): number | undefined => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : Math.max(0, Math.floor((now - t) / DAY));
};

/**
 * Counts and ages only, never a user name (Design 120 section 6.4). A user is
 * privileged when an attached policy is not a read-only AWS managed policy or
 * when an inline policy exists (its document is not read). The root user is
 * privileged; its MFA comes from `GetAccountSummary` `AccountMFAEnabled`
 * (`rootMfa` undefined = not read). IAM Identity Center users are outside the
 * IAM API and not counted. `mfa_required_for_privileged` needs the policy
 * conditions and is left out.
 */
export function identityFacts(users: readonly AwsIamUser[], rootMfa: boolean | undefined, now = Date.now()): Omit<NonNullable<Posture['identity']>, 'source'> {
  let privileged = 0;
  let withoutMfa = 0;
  for (const u of users) {
    if (u.inlinePolicies === 0 && u.policies.every(isReadOnlyPolicy)) continue;
    privileged++;
    if (u.mfaDevices === 0) withoutMfa++;
  }
  if (rootMfa !== undefined) {
    privileged++;
    if (!rootMfa) withoutMfa++;
  }
  const credentials = users.flatMap((u) => u.accessKeys.flatMap((k) => {
    const age = ageDays(k.created, now);
    return age === undefined ? [] : [{ kind: 'access_key' as const, active: k.active, age_days: age }];
  }));
  return { privileged_principals: privileged, privileged_without_mfa: withoutMfa, credentials };
}

// ---------------------------------------------------------------------------
// Logging (CloudTrail trails, CloudWatch Logs retention)
// ---------------------------------------------------------------------------

/**
 * #3935: retention of a trail's S3 bucket from its lifecycle: `days` (the
 * shortest expiry of an enabled rule that covers the trail's log objects),
 * `never` (no such rule, or no lifecycle configuration), or `undecided` (a
 * rule expires on a date, which is no day count). Undefined = not read.
 */
export type AwsS3Retention = { days: number } | { never: true } | { undecided: string };

export interface AwsTrail {
  arn: string; homeRegion?: string; multiRegion?: boolean; logging?: boolean; organisationTrail?: boolean; logGroupArn?: string;
  /** #3935: bucket lifecycle retention; undefined = not read. */
  s3Retention?: AwsS3Retention;
  /** #3935: why the bucket lifecycle was not read (`http_403`, `no_bucket`); counts and codes only. */
  s3Unread?: string;
  /** #3975: the log archive scope id the lifecycle was read through (the bucket did not answer this scope). */
  s3ReadBy?: string;
  /**
   * #3975: why the log archive scope did not decide an unread bucket:
   * `not_registered` (no scope with purpose log-archive), `bucket_not_in_scope`
   * (the archive does not list the bucket), `http_<status>` of its read, or a
   * reason of `LogArchiveUnavailable` (types.ts). On the log archive scope
   * itself: `archive_scope_not_listed` (it does not list the bucket) or
   * `archive_scope_refused` (it lists it, its own read was refused). Codes only.
   */
  logArchive?: string;
}

/** One rule of GetBucketLifecycleConfiguration, reduced to what the retention needs. */
export interface AwsLifecycleRule { enabled: boolean; prefix: string; tagged: boolean; expirationDays?: number; expirationDate?: boolean }

/**
 * #3935: the shortest retention the lifecycle gives the trail's log objects
 * (CloudTrail User Guide, "Finding your CloudTrail log files": objects under
 * `<S3KeyPrefix>/AWSLogs/<account>/`, for an organisation trail
 * `<S3KeyPrefix>/AWSLogs/<organisation id>/<account>/`). A rule applies when
 * it is enabled, has no tag filter (CloudTrail log objects carry no tags)
 * and its prefix covers the account's log objects (a prefix of the log path,
 * or a deeper prefix that still names this account). Size filters count as
 * applying (the shortest expiry wins). Transitions and noncurrent-version
 * expiry do not delete current log objects.
 */
export function lifecycleRetention(rules: readonly AwsLifecycleRule[], keyPrefix: string | undefined, account: string): AwsS3Retention {
  let kp = keyPrefix ?? '';
  while (kp.endsWith('/')) kp = kp.slice(0, -1);
  const base = `${kp ? `${kp}/` : ''}AWSLogs/`;
  const covers = (p: string): boolean => {
    if (base.startsWith(p)) return true;
    if (!p.startsWith(base)) return false;
    let rest = p.slice(base.length);
    const org = /^o-[a-z0-9]{10,32}(?:\/|$)/.exec(rest);
    if (org) rest = rest.slice(org[0].length);
    const acct = `${account}/`;
    return acct.startsWith(rest) || rest.startsWith(acct);
  };
  const applying = rules.filter((r) => r.enabled && !r.tagged && covers(r.prefix));
  if (applying.some((r) => r.expirationDate === true)) return { undecided: 'expiration_date' };
  const days = applying.map((r) => r.expirationDays).filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0);
  return days.length > 0 ? { days: Math.min(...days) } : { never: true };
}

/** `retentionInDays` of each read log group by ARN; null = read and no retention set (never expires). */
export type LogGroupRetention = ReadonlyMap<string, number | null>;

/** Log group ARN without the trailing `:*` that CloudTrail writes. */
export const logGroupKey = (arn: string): string => arn.replace(/:\*$/, '');

/**
 * One entry per trail: enabled from GetTrailStatus `IsLogging`, all regions
 * from `IsMultiRegionTrail`. Every trail delivers to its S3 bucket (the
 * primary store); a CloudWatch Logs group is an optional copy.
 *
 * #3935: when the bucket lifecycle was read (`s3Retention` days or never),
 * `retention_source: s3_lifecycle` marks the primary store as read and the
 * entry carries the longest retention of the read stores (a copy that keeps
 * the logs longer still keeps them): `retention_days`, or
 * `log_retention: never_expires` when a store never expires them; the per
 * store values stay as attributes (`s3_retention`, `cloudwatch_retention`).
 * Otherwise (`retention_source: cloudwatch_logs_copy`) the entry carries the
 * CloudWatch Logs retention as before (a group without `retentionInDays` is
 * `never_expires`, no day count is invented) and `s3_lifecycle` says why the
 * bucket did not answer.
 *
 * #3975: a lifecycle read through the landing zone's log archive scope adds
 * `log_archive_scope: <scope id>`; a bucket the archive did not decide
 * either adds `log_archive: <reason>` (`not_registered` when the landing
 * zone registers no log archive scope).
 */
export function trailFacts(trails: readonly AwsTrail[], retention: LogGroupRetention): NonNullable<NonNullable<Posture['logging']>['trails']> {
  return trails.map((t) => {
    const key = t.logGroupArn ? logGroupKey(t.logGroupArn) : undefined;
    const r = key !== undefined ? retention.get(key) : undefined;
    const cwDays = typeof r === 'number' && Number.isInteger(r) && r >= 0 ? r : undefined;
    const attributes: Record<string, string | boolean | number> = {};
    if (t.organisationTrail !== undefined) attributes['organisation_trail'] = t.organisationTrail;
    const s3 = t.s3Retention;
    let days: number | undefined;
    if (s3 !== undefined && !('undecided' in s3)) {
      attributes['retention_source'] = 's3_lifecycle';
      if (t.s3ReadBy !== undefined) attributes['log_archive_scope'] = t.s3ReadBy;
      attributes['s3_retention'] = 'never' in s3 ? 'never_expires' : s3.days;
      attributes['cloudwatch_retention'] = key === undefined ? 'no_cloudwatch_logs_group' : r === null ? 'never_expires' : cwDays ?? 'not_read';
      if ('never' in s3 || r === null) attributes['log_retention'] = 'never_expires';
      else days = Math.max(s3.days, cwDays ?? 0);
    } else {
      attributes['retention_source'] = 'cloudwatch_logs_copy';
      attributes['s3_lifecycle'] = s3 !== undefined && 'undecided' in s3 ? s3.undecided : t.s3Unread ?? 'not_read';
      if (t.logArchive !== undefined) attributes['log_archive'] = t.logArchive;
      if (key !== undefined && r === null) attributes['log_retention'] = 'never_expires';
      if (key === undefined) attributes['log_retention'] = 'no_cloudwatch_logs_group';
      days = cwDays;
    }
    return {
      resource_id: t.arn,
      ...(t.homeRegion ? { region: t.homeRegion } : {}),
      ...(typeof t.multiRegion === 'boolean' ? { all_regions: t.multiRegion } : {}),
      enabled: t.logging === true,
      ...(days !== undefined ? { retention_days: days } : {}),
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// Budgets (#3936, AWS Budgets 2016-10-20)
// ---------------------------------------------------------------------------

/** One budget as DescribeBudgets returns it, with its notifications and their subscriber counts. */
export interface AwsBudget {
  name: string;
  budgetType?: string;
  limit?: { Amount?: string; Unit?: string };
  timeUnit?: string;
  /** Undefined when DescribeNotificationsForBudget was not readable. */
  notifications?: readonly { type?: string; threshold?: number; thresholdType?: string; subscribers?: number }[];
}

const PERIOD_OF: Readonly<Record<string, 'daily' | 'monthly' | 'quarterly' | 'annually' | 'custom'>> = { DAILY: 'daily', MONTHLY: 'monthly', QUARTERLY: 'quarterly', ANNUALLY: 'annually', CUSTOM: 'custom' };

/**
 * `estate.posture.budgets` items. `BudgetType` COST is `cost`, USAGE
 * `usage`, the reservation and Savings Plans types `other`; `BudgetLimit`
 * (`Amount` is a decimal string) gives amount and unit; `TimeUnit` the
 * period. Each notification is an alert: `ACTUAL` / `FORECASTED` basis,
 * `PERCENTAGE` / `ABSOLUTE_VALUE` threshold, and the number of subscribers
 * (DescribeSubscribersForNotification; the addresses are never kept). An
 * unread notification list leaves `alerts` empty and records
 * `notifications: not_read` in the attributes.
 */
export function budgetFacts(budgets: readonly AwsBudget[], place: { partition: string; account: string }): NonNullable<NonNullable<Posture['budgets']>['items']> {
  return budgets.map((b) => {
    const arn = `arn:${place.partition}:budgets::${place.account}:budget/${b.name}`;
    const amount = b.limit?.Amount !== undefined ? Number(b.limit.Amount) : undefined;
    const period = b.timeUnit ? PERIOD_OF[b.timeUnit] : undefined;
    const alerts = (b.notifications ?? []).flatMap((n) => (typeof n.threshold === 'number' && n.threshold >= 0 ? [{
      threshold: n.threshold,
      threshold_type: n.thresholdType === 'ABSOLUTE_VALUE' ? 'absolute' as const : 'percentage' as const,
      basis: n.type === 'FORECASTED' ? 'forecasted' as const : 'actual' as const,
      ...(n.subscribers !== undefined ? { recipients: n.subscribers } : {}),
    }] : []));
    return {
      resource_id: arn,
      ...(typed(arn).type ? { type: typed(arn).type as string } : {}),
      scope: place.account,
      budget_kind: b.budgetType === 'COST' ? 'cost' as const : b.budgetType === 'USAGE' ? 'usage' as const : 'other' as const,
      ...(amount !== undefined && Number.isFinite(amount) && amount >= 0 ? { amount } : {}),
      ...(b.limit?.Unit ? { currency: b.limit.Unit } : {}),
      ...(period ? { period } : {}),
      alerts,
      ...(b.notifications === undefined ? { attributes: { notifications: 'not_read' } } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// Backup (AWS Backup)
// ---------------------------------------------------------------------------

/**
 * Stateful resources (EBS volumes, RDS instances, DynamoDB tables from the
 * inventory) are protected when AWS Backup lists them as protected
 * (`ListProtectedResources`: a recovery point exists) and at least one backup
 * plan exists (`ListBackupPlans`), so a backup recurs. Protected resources
 * that are not in the stateful list are added. The plan that selects a
 * resource needs the selection documents (not read), so `policy_id` and the
 * retention stay out. #3952: a DynamoDB table with point-in-time recovery
 * enabled (`continuous`) is protected as well.
 */
export function backupFacts(stateful: readonly { arn: string; region?: string }[], protectedArns: ReadonlySet<string>, plans: number, continuous: ReadonlySet<string> = new Set()): Item<'backup'>[] {
  const seen = new Set<string>();
  const out: Item<'backup'>[] = [];
  const add = (arn: string, region: string | undefined): void => {
    if (seen.has(arn)) return;
    seen.add(arn);
    const t = typed(arn);
    // #3952: DynamoDB point-in-time recovery (DescribeContinuousBackups `PointInTimeRecoveryStatus` ENABLED) is a
    // continuous backup kept by DynamoDB itself (Developer Guide, "Point-in-time recovery"): protected without a plan.
    const pitr = continuous.has(arn);
    out.push({ resource_id: arn, ...t, ...(region ?? t.region ? { region: (region ?? t.region) as string } : {}), protected: pitr || (plans > 0 && protectedArns.has(arn)), ...(pitr ? { attributes: { point_in_time_recovery: true } } : {}) });
  };
  for (const s of stateful) add(s.arn, s.region);
  for (const arn of [...protectedArns].sort()) add(arn, undefined);
  return out;
}
