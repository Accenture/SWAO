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

// #3574: the `aws` live driver (Design 120 sections 6.3, 7.1 to 7.3, 7.5).
// Operations and response shapes follow the published AWS API models
// (botocore service-2.json, aws-cli 2.35.13); every request goes through
// `ctx.http.fetch` (read-only allow-list, endpoint seam, recorder) and the
// AWS action guard (aws-client.ts).
//
// Status rules per (region, service), Design 120 section 5.3:
// - region `not-opted-in` (ec2 DescribeRegions) -> `available_not_enabled`
// - region enabled and the service has an endpoint in that region in the
//   botocore-derived catalogue (`lz-catalogues/aws.json`, 065 section 4: never
//   SSM global-infrastructure parameters) -> `enabled`, api evidence; tagged
//   resources of the service in the region add inventory evidence
// - region enabled, no endpoint in the catalogue -> `not_offered`
// - region list not readable -> `unknown` with the HTTP status
// - an SCP attached to the scope account or one of its ancestors denies the
//   whole service unconditionally -> `restricted` with policy evidence
//   (#3866, D-16, aws-scp.ts; not in the management account, where SCPs do
//   not apply).
//
// Privacy (Design 120 section 6.4): the probe labels the identity by role
// name, never by the session name (an SSO session name is the user's e-mail);
// activity is counted only (no user, source IP or request); raw responses
// exist only in the recording directory.

import type { LzLiveEvidence, LzLiveFactSource, LzLivePostureInput, LzLiveRegion, LzLiveScan, LzLiveService, LzServiceCatalogue } from '@swao/core';
import type { ActivityWindow, LiveLzDriver, ReadOnlyProbe, ScopeCtx } from '../types.js';
import { LiveAuthError, LiveSourceUnavailableError } from '../errors.js';
import { loadLzCatalogue, resolveLzCataloguesDir } from '../../catalogue/loader.js';
import { classifyTrace } from '../otc/otc-driver.js';
import { AWS_DEFAULT_BASE_URLS, AWS_PROVIDER, AwsApiError, awsJson, awsPartition, awsQuery, awsRegionOf, awsRestGet } from './aws-client.js';
import { find, kids, textOf } from './aws-xml.js';
import { parseArn } from './aws-arn.js';
import { listAwsHierarchy } from './aws-hierarchy.js';
import { evaluateScpDenies, scpDeniesService } from './aws-scp.js';
import type { ScpDenyResult } from './aws-scp.js';
import { atRestFacts, backupFacts, bucketNeeds, budgetFacts, dynamoEncryptionFact, ec2Arn, exposureFacts, identityFacts, ingressRules, lifecycleRetention, listenerFacts, logGroupKey, s3Arn, s3EncryptionFact, s3ExposureFact, trailFacts } from './aws-posture.js';
import type { AwsAddress, AwsBucketEncryption, AwsBudget, AwsDbExposure, AwsIamUser, AwsInstance, AwsKmsKey, AwsListener, AwsLoadBalancer, AwsPublicAccessBlock, AwsSgRule, AwsStoredResource, AwsTableSse, AwsTrail, Ec2Place } from './aws-posture.js';
import { accountPublicAccessBlock, bucketAclPublic, bucketEncryption, bucketLifecycle, bucketPolicyPublic, bucketPublicAccessBlock, bucketRegion, listBuckets } from './aws-s3.js';
import type { S3Bucket } from './aws-s3.js';
import type { XmlNode } from './aws-xml.js';

type Estate = LzLiveScan['estate'];

export const AWS_DRIVER_VERSION = '0.1.0';
const MAX_PAGES = 100;
/** CloudTrail LookupEvents returns at most 50 events per page. */
const ACTIVITY_MAX_PAGES = 40;

/** Region used for account-wide calls when the scope names none (Design 120 section 6.3, AWS test environment). */
export const AWS_HOME_REGION_DEFAULT = 'eu-central-1';

/** Write actions the probe simulates (Design 120 section 6.3); any `allowed` refuses the credential. */
export const AWS_PROBE_WRITE_ACTIONS = [
  'ec2:RunInstances', 'ec2:TerminateInstances', 'ec2:CreateVpc', 's3:PutObject', 's3:DeleteBucket',
  'iam:CreateUser', 'iam:AttachRolePolicy', 'iam:CreateAccessKey', 'rds:DeleteDBInstance', 'eks:DeleteCluster',
  'organizations:CreateAccount', 'cloudtrail:StopLogging', 'config:DeleteConfigurationRecorder', 'kms:ScheduleKeyDeletion',
] as const;

/** Read actions the driver needs, simulated for the coverage report. */
export const AWS_PROBE_READ_ACTIONS = [
  'ec2:DescribeRegions', 'ec2:DescribeAvailabilityZones', 'tag:GetResources', 'organizations:DescribeOrganization',
  'organizations:ListPolicies', 'cloudtrail:DescribeTrails', 'cloudtrail:GetTrailStatus', 'cloudtrail:LookupEvents',
  'config:DescribeConfigurationRecorderStatus', 'servicequotas:ListServiceQuotas', 'eks:ListClusters', 'eks:DescribeCluster',
  'rds:DescribeDBInstances',
  // #3866: the posture reads and the SCP deny evaluation (Design 123 section 5.4).
  // The recorded SimulatePrincipalPolicy answer of 2026-11-04 predates them; the
  // mock answers the actions it lacks spec-derived (routes.ts `simulate`).
  'organizations:ListParents', 'organizations:ListPoliciesForTarget', 'organizations:DescribePolicy',
  'ec2:DescribeVolumes', 'ec2:DescribeAddresses', 'ec2:DescribeInstances', 'ec2:DescribeSecurityGroupRules',
  'kms:ListKeys', 'kms:DescribeKey', 'elasticloadbalancing:DescribeLoadBalancers', 'elasticloadbalancing:DescribeListeners',
  'elasticloadbalancing:DescribeSSLPolicies', 'iam:ListUsers', 'iam:ListAccessKeys', 'iam:ListMFADevices',
  'iam:ListAttachedUserPolicies', 'iam:ListUserPolicies', 'iam:ListGroupsForUser', 'iam:ListAttachedGroupPolicies',
  'iam:ListGroupPolicies', 'iam:GetAccountSummary', 'logs:DescribeLogGroups', 'backup:ListBackupPlans', 'backup:ListProtectedResources',
  // #3935: S3 posture reads, by their IAM action (Service Authorization Reference, Amazon S3: ListBuckets is
  // s3:ListAllMyBuckets, GetBucketEncryption s3:GetEncryptionConfiguration, bucket GetPublicAccessBlock
  // s3:GetBucketPublicAccessBlock, S3 Control GetPublicAccessBlock s3:GetAccountPublicAccessBlock,
  // GetBucketLifecycleConfiguration s3:GetLifecycleConfiguration).
  's3:ListAllMyBuckets', 's3:GetBucketLocation', 's3:GetEncryptionConfiguration', 's3:GetBucketPublicAccessBlock',
  's3:GetAccountPublicAccessBlock', 's3:GetBucketPolicyStatus', 's3:GetBucketAcl', 's3:GetLifecycleConfiguration',
  // #3952: DynamoDB tables, their encryption and point-in-time recovery.
  'dynamodb:ListTables', 'dynamodb:DescribeTable', 'dynamodb:DescribeContinuousBackups',
  // #3936: DescribeBudgets, DescribeNotificationsForBudget and DescribeSubscribersForNotification are authorised by this one action.
  'budgets:ViewBudget',
  // #3882: the other hierarchy reads (organizations:ListRoots, ListOrganizationalUnitsForParent,
  // ListAccountsForParent) are not simulated yet; add them with the next AWS recording (D-17).
] as const;

const now = (): string => new Date().toISOString();

function httpStatusOf(err: unknown): number | undefined {
  if (err instanceof AwsApiError) return err.status;
  if (err instanceof LiveAuthError) return err.httpStatus;
  if (err instanceof LiveSourceUnavailableError) return err.httpStatus;
  return undefined;
}

function recordSource(ctx: ScopeCtx, name: string, err: unknown): void {
  if (err instanceof LiveAuthError) throw err;
  const http = httpStatusOf(err);
  ctx.sources.push(http !== undefined
    ? { name, status: 'not_collected', http_status: http }
    : { name, status: 'not_collected', reason: err instanceof Error ? err.message : String(err) });
}

/** Region for account-wide calls: `target.region`, the first scope region, or the default. */
export function awsHomeRegion(ctx: ScopeCtx): string {
  return ctx.target['region'] ?? ctx.regions[0] ?? AWS_HOME_REGION_DEFAULT;
}

// ---------------------------------------------------------------------------
// probeReadOnly
// ---------------------------------------------------------------------------

/** `arn:<p>:sts::<acct>:assumed-role/<role>/<session>` -> role name; null for other principals. */
export function assumedRoleName(arn: string): string | null {
  const m = /^arn:[^:]+:sts::\d+:assumed-role\/([^/]+)\/.+$/.exec(arn);
  return m ? (m[1] as string) : null;
}

function simulateParams(arn: string, actions: readonly string[]): Record<string, string> {
  const p: Record<string, string> = { PolicySourceArn: arn };
  actions.forEach((a, i) => { p[`ActionNames.member.${i + 1}`] = a; });
  return p;
}

async function simulate(ctx: ScopeCtx, arn: string, actions: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let marker: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const doc = await awsQuery(ctx, 'iam', 'SimulatePrincipalPolicy', awsHomeRegion(ctx), { ...simulateParams(arn, actions), ...(marker ? { Marker: marker } : {}) });
    const result = find(doc, 'SimulatePrincipalPolicyResult');
    for (const m of kids(find(result ?? doc, 'EvaluationResults'), 'member')) {
      const name = textOf(m, 'EvalActionName');
      const decision = textOf(m, 'EvalDecision');
      if (name && decision) out.set(name, decision);
    }
    marker = textOf(result, 'IsTruncated') === 'true' ? textOf(result, 'Marker') : undefined;
    if (!marker) return out;
  }
  return out;
}

async function probeReadOnly(ctx: ScopeCtx): Promise<ReadOnlyProbe> {
  const region = awsHomeRegion(ctx);
  const who = await awsQuery(ctx, 'sts', 'GetCallerIdentity', region);
  const callerArn = textOf(find(who, 'GetCallerIdentityResult'), 'Arn') ?? '';
  const role = assumedRoleName(callerArn);
  const identity = role ? `role: ${role}` : callerArn.includes(':user/') ? 'IAM user' : 'principal';
  const unverifiable = (reason: string): ReadOnlyProbe => ({ read_only: 'unverifiable', identity, reason, write_actions_allowed: [], coverage: { readable: [], unreadable: [] } });
  let principalArn = callerArn;
  if (role) {
    try {
      // The assumed-role ARN has no path; SSO roles live under
      // aws-reserved/sso.amazonaws.com/, so the role ARN comes from GetRole.
      const doc = await awsQuery(ctx, 'iam', 'GetRole', region, { RoleName: role });
      principalArn = textOf(find(doc, 'Role'), 'Arn') ?? '';
    } catch (err) {
      if (err instanceof LiveAuthError) throw err;
      return unverifiable(`the role ARN of the session is not readable (iam:GetRole, HTTP ${httpStatusOf(err) ?? 'error'})`);
    }
  }
  if (principalArn === '') return unverifiable('the caller identity has no principal ARN');
  let decisions: Map<string, string>;
  try {
    decisions = await simulate(ctx, principalArn, [...AWS_PROBE_WRITE_ACTIONS, ...AWS_PROBE_READ_ACTIONS]);
  } catch (err) {
    if (err instanceof LiveAuthError) throw err;
    return unverifiable(`iam:SimulatePrincipalPolicy is not permitted for this identity (HTTP ${httpStatusOf(err) ?? 'error'}, Q-27)`);
  }
  const allowedWrites = AWS_PROBE_WRITE_ACTIONS.filter((a) => decisions.get(a) === 'allowed');
  const readable = AWS_PROBE_READ_ACTIONS.filter((a) => decisions.get(a) === 'allowed');
  const unreadable = AWS_PROBE_READ_ACTIONS.filter((a) => decisions.get(a) !== 'allowed');
  if (allowedWrites.length > 0) {
    return { read_only: 'refused', identity, reason: `the identity may perform ${allowedWrites.length} write action(s) (iam:SimulatePrincipalPolicy)`, write_actions_allowed: [...allowedWrites], coverage: { readable: [...readable], unreadable: [...unreadable] } };
  }
  const missing = AWS_PROBE_WRITE_ACTIONS.filter((a) => !decisions.has(a));
  if (missing.length > 0) return unverifiable(`the simulator returned no decision for ${missing.join(', ')}`);
  return { read_only: 'verified', identity, write_actions_allowed: [], coverage: { readable: [...readable], unreadable: [...unreadable] } };
}

// ---------------------------------------------------------------------------
// Offering
// ---------------------------------------------------------------------------

interface AwsRegionInfo { id: string; optIn: string }

const regionCache = new WeakMap<ScopeCtx, Promise<AwsRegionInfo[]>>();

/** ec2 DescribeRegions with AllRegions=true: every region of the partition and its opt-in status. */
function describeRegions(ctx: ScopeCtx): Promise<AwsRegionInfo[]> {
  let p = regionCache.get(ctx);
  if (!p) {
    p = (async () => {
      const doc = await awsQuery(ctx, 'ec2', 'DescribeRegions', awsHomeRegion(ctx), { AllRegions: 'true' });
      return kids(find(doc, 'regionInfo'), 'item').map((it) => ({ id: textOf(it, 'regionName') ?? '', optIn: textOf(it, 'optInStatus') ?? '' })).filter((r) => r.id !== '');
    })();
    regionCache.set(ctx, p);
  }
  return p;
}

const isEnabled = (r: AwsRegionInfo): boolean => r.optIn === 'opt-in-not-required' || r.optIn === 'opted-in';

/** Scope regions: `.swao.yml` regions, else every enabled region of the account. */
async function scopeRegions(ctx: ScopeCtx): Promise<string[]> {
  if (ctx.regions.length > 0) return [...ctx.regions];
  return (await describeRegions(ctx)).filter(isEnabled).map((r) => r.id).sort();
}

let catalogueMemo: LzServiceCatalogue | null | undefined;
function awsCatalogue(): LzServiceCatalogue | null {
  if (catalogueMemo === undefined) {
    const dir = resolveLzCataloguesDir();
    try {
      catalogueMemo = dir ? loadLzCatalogue(dir, AWS_PROVIDER) : null;
    } catch {
      catalogueMemo = null;
    }
  }
  return catalogueMemo;
}
/** Test seam: replace the catalogue (null = not found). */
export function setAwsCatalogueForTests(c: LzServiceCatalogue | null | undefined): void {
  catalogueMemo = c;
}

async function listRegions(ctx: ScopeCtx): Promise<LzLiveRegion[]> {
  const all = await describeRegions(ctx);
  const wanted = new Set(await scopeRegions(ctx));
  const cat = awsCatalogue();
  const out: LzLiveRegion[] = [];
  for (const r of all.filter((x) => wanted.has(x.id))) {
    const country = cat?.regions.find((c) => c.id === r.id)?.country;
    const azs: LzLiveRegion['azs'] = [];
    if (isEnabled(r)) {
      try {
        const doc = await awsQuery(ctx, 'ec2', 'DescribeAvailabilityZones', r.id);
        for (const it of kids(find(doc, 'availabilityZoneInfo'), 'item')) {
          const name = textOf(it, 'zoneName');
          if (name && textOf(it, 'zoneType') !== 'local-zone' && textOf(it, 'zoneType') !== 'wavelength-zone') azs.push({ name, available: textOf(it, 'zoneState') === 'available' });
        }
      } catch (err) {
        recordSource(ctx, `azs:${r.id}`, err);
      }
    }
    out.push({ id: r.id, ...(country ? { country } : {}), azs, status: isEnabled(r) ? 'enabled' : 'available_not_enabled' });
  }
  for (const id of wanted) {
    if (!all.some((x) => x.id === id)) out.push({ id, azs: [], status: 'not_offered' });
  }
  return out;
}

const taggedCache = new WeakMap<ScopeCtx, Map<string, Promise<TaggedResource[] | null>>>();

interface TaggedResource { arn: string; tags: Record<string, string> }

/** Resource Groups Tagging API GetResources for one region (cached; null = not collected). */
function taggedResources(ctx: ScopeCtx, region: string): Promise<TaggedResource[] | null> {
  let byRegion = taggedCache.get(ctx);
  if (!byRegion) { byRegion = new Map(); taggedCache.set(ctx, byRegion); }
  let p = byRegion.get(region);
  if (!p) {
    p = (async () => {
      const out: TaggedResource[] = [];
      let token = '';
      for (let page = 0; page < MAX_PAGES; page++) {
        const doc = await awsJson<{ ResourceTagMappingList?: { ResourceARN?: string; Tags?: { Key?: string; Value?: string }[] }[]; PaginationToken?: string }>(
          ctx, 'tagging', 'GetResources', region, { ResourcesPerPage: 100, ...(token ? { PaginationToken: token } : {}) });
        for (const m of doc.ResourceTagMappingList ?? []) {
          if (!m.ResourceARN) continue;
          out.push({ arn: m.ResourceARN, tags: Object.fromEntries((m.Tags ?? []).filter((t) => t.Key).map((t) => [t.Key as string, t.Value ?? ''])) });
        }
        token = doc.PaginationToken ?? '';
        if (!token) return out;
      }
      ctx.sources.push({ name: `inventory:${region}`, status: 'not_collected', reason: `stopped after ${MAX_PAGES} pages` });
      return out;
    })().catch((err: unknown) => {
      recordSource(ctx, `inventory:${region}`, err);
      return null;
    });
    byRegion.set(region, p);
  }
  return p;
}

// #3801: parseArn derives the resource type from the published ARN formats (aws-arn.ts).
export { parseArn } from './aws-arn.js';

// ---------------------------------------------------------------------------
// Account, organisation and SCP deny evaluation (#3866, D-16)
// ---------------------------------------------------------------------------

function memo<T>(cache: WeakMap<ScopeCtx, Promise<T>>, ctx: ScopeCtx, fn: () => Promise<T>): Promise<T> {
  let p = cache.get(ctx);
  if (!p) { p = fn(); cache.set(ctx, p); }
  return p;
}

const accountCache = new WeakMap<ScopeCtx, Promise<string>>();
/** The scope's account (sts:GetCallerIdentity), cached per scope run. */
export function awsCallerAccount(ctx: ScopeCtx): Promise<string> {
  return memo(accountCache, ctx, async () => textOf(find(await awsQuery(ctx, 'sts', 'GetCallerIdentity', awsHomeRegion(ctx)), 'GetCallerIdentityResult'), 'Account') ?? '');
}

interface AwsOrganization { FeatureSet?: string; MasterAccountId?: string }
const orgCache = new WeakMap<ScopeCtx, Promise<AwsOrganization>>();
/** organizations:DescribeOrganization, cached per scope run (listServices and listGuardrails). */
function describeOrganization(ctx: ScopeCtx): Promise<AwsOrganization> {
  return memo(orgCache, ctx, async () => (await awsJson<{ Organization?: AwsOrganization }>(ctx, 'organizations', 'DescribeOrganization', awsHomeRegion(ctx))).Organization ?? {});
}

/** The AWS managed SCP that allows everything; its document is known and not read. */
const FULL_AWS_ACCESS = 'p-FullAWSAccess';
const MAX_ORG_DEPTH = 10;

async function orgPaged<T>(ctx: ScopeCtx, op: string, key: string, input: Record<string, unknown>): Promise<T[]> {
  const out: T[] = [];
  let token = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const doc = await awsJson<Record<string, unknown>>(ctx, 'organizations', op, awsHomeRegion(ctx), { ...input, ...(token ? { NextToken: token } : {}) });
    out.push(...((doc[key] ?? []) as T[]));
    token = typeof doc['NextToken'] === 'string' ? doc['NextToken'] : '';
    if (!token) break;
  }
  return out;
}

const scpCache = new WeakMap<ScopeCtx, Promise<ScpDenyResult | null>>();
/**
 * SCP deny evaluation of the scope account (D-16): the SCPs attached to the
 * account and every ancestor up to the root (`ListParents`,
 * `ListPoliciesForTarget`) and their documents (`DescribePolicy`), evaluated
 * in aws-scp.ts. In the management account SCPs do not apply: an empty
 * result without further reads. Null when not evaluated (a read denied or
 * failed: one `services:scp` source with the status), so no service is
 * claimed `restricted` on a guess.
 */
function scpDenies(ctx: ScopeCtx): Promise<ScpDenyResult | null> {
  return memo(scpCache, ctx, async () => {
    try {
      const account = await awsCallerAccount(ctx);
      const org = await describeOrganization(ctx);
      if (account === '' || org.MasterAccountId === account) return evaluateScpDenies(new Map());
      const targets = [account];
      let child = account;
      for (let depth = 0; depth < MAX_ORG_DEPTH; depth++) {
        const parent = (await orgPaged<{ Id?: string; Type?: string }>(ctx, 'ListParents', 'Parents', { ChildId: child }))[0];
        if (!parent?.Id) break;
        targets.push(parent.Id);
        if (parent.Type === 'ROOT') break;
        child = parent.Id;
      }
      const ids = new Set<string>();
      for (const t of targets) {
        for (const p of await orgPaged<{ Id?: string }>(ctx, 'ListPoliciesForTarget', 'Policies', { TargetId: t, Filter: 'SERVICE_CONTROL_POLICY' })) if (p.Id) ids.add(p.Id);
      }
      const docs = new Map<string, string>();
      for (const id of [...ids].sort()) {
        if (id === FULL_AWS_ACCESS) continue;
        const d = await awsJson<{ Policy?: { Content?: string } }>(ctx, 'organizations', 'DescribePolicy', awsHomeRegion(ctx), { PolicyId: id });
        if (typeof d.Policy?.Content === 'string') docs.set(id, d.Policy.Content);
      }
      return evaluateScpDenies(docs);
    } catch (err) {
      recordSource(ctx, 'services:scp', err);
      return null;
    }
  });
}

async function listServices(ctx: ScopeCtx, region: string): Promise<LzLiveService[]> {
  const observed_at = now();
  const cat = awsCatalogue();
  if (!cat) throw new LiveSourceUnavailableError(`services:${region}`, undefined, 'the AWS catalogue (lz-catalogues/aws.json) was not found');
  const info = (await describeRegions(ctx)).find((r) => r.id === region);
  const catRegion = cat.regions.find((r) => r.id === region);
  const tagged = info && isEnabled(info) ? await taggedResources(ctx, region) : null;
  const inRegion = new Set((tagged ?? []).map((t) => parseArn(t.arn)?.service).filter((s): s is string => !!s));
  const scp = info && isEnabled(info) ? await scpDenies(ctx) : null;
  const codes = new Set<string>();
  for (const r of cat.regions) for (const s of r.services) codes.add(s.code);
  return [...codes].sort().map((code): LzLiveService => {
    const entry = catRegion?.services.find((s) => s.code === code);
    const tags = entry?.fulfills ?? cat.regions.flatMap((r) => r.services).find((s) => s.code === code)?.fulfills ?? [];
    let status: LzLiveService['regions'][string];
    if (!info) {
      status = { status: 'not_offered', evidence: [{ source: 'api', ref: 'ec2:DescribeRegions' }], observed_at };
    } else if (!isEnabled(info)) {
      status = { status: 'available_not_enabled', evidence: [{ source: 'api', ref: `ec2:DescribeRegions:${info.optIn}` }], observed_at };
    } else if (entry) {
      const evidence: LzLiveEvidence[] = [{ source: 'api', ref: `botocore-endpoints:${code}` }];
      if (inRegion.has(code)) evidence.push({ source: 'inventory', ref: `tagging:${code}` });
      const denying = scp ? scpDeniesService(scp, code) : [];
      status = denying.length > 0
        ? { status: 'restricted', evidence: [...evidence, ...denying.map((id): LzLiveEvidence => ({ source: 'policy', ref: `scp:${id}` }))], observed_at }
        : { status: 'enabled', evidence, observed_at };
    } else {
      status = { status: 'not_offered', evidence: [{ source: 'api', ref: `botocore-endpoints:${region}` }], observed_at };
    }
    return { code, name: code, capability_tags: [...tags], catalogue_code: code, regions: { [region]: status }, frameworks: {} };
  });
}

// ---------------------------------------------------------------------------
// Estate
// ---------------------------------------------------------------------------

async function listResources(ctx: ScopeCtx): Promise<Estate['resources']> {
  const out: Estate['resources'] = [];
  let collected = 0;
  for (const region of await scopeRegions(ctx)) {
    const list = await taggedResources(ctx, region);
    if (list === null) continue;
    collected++;
    for (const t of list) {
      const a = parseArn(t.arn);
      if (!a) continue;
      out.push({
        id: t.arn,
        type: `${a.service}.${a.type}`,
        service_code: a.service,
        ...(a.region ? { region: a.region } : {}),
        ...(Object.keys(t.tags).length > 0 ? { tags: t.tags } : {}),
      });
    }
  }
  if (collected === 0) throw new LiveSourceUnavailableError('inventory:resources', undefined, 'no region of the tagging API was readable');
  return out;
}

async function listGuardrails(ctx: ScopeCtx): Promise<Estate['guardrails']> {
  const out: Estate['guardrails'] = [];
  const home = awsHomeRegion(ctx);
  let collected = 0;
  try {
    const fs = (await describeOrganization(ctx)).FeatureSet ?? 'unknown';
    out.push({ type: 'aws-organization', id: 'organization', status: fs === 'ALL' ? 'pass' : 'fail', detail: `feature set ${fs}` });
    let token = '';
    let count = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const doc = await awsJson<{ Policies?: { Id?: string; AwsManaged?: boolean }[]; NextToken?: string }>(ctx, 'organizations', 'ListPolicies', home, { Filter: 'SERVICE_CONTROL_POLICY', ...(token ? { NextToken: token } : {}) });
      for (const p of doc.Policies ?? []) {
        count++;
        if (p.Id) out.push({ type: 'aws-scp', id: p.Id, status: 'pass', detail: p.AwsManaged ? 'AWS managed' : 'customer managed' });
      }
      token = doc.NextToken ?? '';
      if (!token) break;
    }
    if (count === 0) out.push({ type: 'aws-scp', id: 'organization', status: 'fail', detail: 'no service control policy' });
    collected++;
  } catch (err) {
    recordSource(ctx, 'guardrails:organizations', err);
  }
  try {
    const list = await describeTrails(ctx);
    if (list.length === 0) out.push({ type: 'cloudtrail-trail', id: home, status: 'fail', detail: 'no trail' });
    for (const t of list) {
      let logging = 'unknown';
      try {
        logging = (await trailLogging(ctx, t)) ? 'on' : 'off';
      } catch (err) {
        recordSource(ctx, `guardrails:cloudtrail-status:${t.Name ?? '?'}`, err);
      }
      out.push({
        type: 'cloudtrail-trail',
        id: t.TrailARN ?? t.Name ?? 'trail',
        status: logging === 'on' && t.IsMultiRegionTrail === true ? 'pass' : 'fail',
        detail: `logging ${logging}, multi-region ${t.IsMultiRegionTrail === true ? 'yes' : 'no'}, organisation trail ${t.IsOrganizationTrail === true ? 'yes' : 'no'}, log file validation ${t.LogFileValidationEnabled === true ? 'on' : 'off'}`,
      });
    }
    collected++;
  } catch (err) {
    recordSource(ctx, 'guardrails:cloudtrail', err);
  }
  for (const region of await scopeRegions(ctx)) {
    try {
      const st = await awsJson<{ ConfigurationRecordersStatus?: { name?: string; recording?: boolean }[] }>(ctx, 'config', 'DescribeConfigurationRecorderStatus', region);
      const recs = st.ConfigurationRecordersStatus ?? [];
      // No recorder is a finding, not an error (Design 120 section 6.3: Config is optional).
      if (recs.length === 0) out.push({ type: 'config-recorder', id: region, status: 'fail', detail: 'no AWS Config recorder' });
      for (const r of recs) out.push({ type: 'config-recorder', id: `${region}/${r.name ?? 'default'}`, status: r.recording === true ? 'pass' : 'fail', detail: `recording ${r.recording === true ? 'on' : 'off'}` });
      collected++;
    } catch (err) {
      recordSource(ctx, `guardrails:config:${region}`, err);
    }
  }
  if (collected === 0) throw new LiveSourceUnavailableError('guardrails', undefined, 'neither Organizations, CloudTrail nor Config was readable');
  return out;
}

/** Service Quotas of the services Pass 23 checks (EKS, RDS); applied values only, usage is not reported by the API. */
export const AWS_QUOTA_SERVICE_CODES = ['eks', 'rds'] as const;

async function listQuotas(ctx: ScopeCtx, region: string): Promise<Estate['quotas']> {
  const out: Estate['quotas'] = [];
  for (const code of AWS_QUOTA_SERVICE_CODES) {
    let token = '';
    for (let page = 0; page < MAX_PAGES; page++) {
      let doc: { Quotas?: { QuotaName?: string; QuotaCode?: string; Value?: number }[]; NextToken?: string };
      try {
        doc = await awsJson(ctx, 'servicequotas', 'ListServiceQuotas', region, { ServiceCode: code, MaxResults: 100, ...(token ? { NextToken: token } : {}) });
      } catch (err) {
        if (err instanceof LiveAuthError) throw err;
        throw new LiveSourceUnavailableError(`quotas:${region}`, httpStatusOf(err));
      }
      for (const q of doc.Quotas ?? []) {
        if (!q.QuotaCode) continue;
        out.push({ resource: `${code}:${q.QuotaCode}${q.QuotaName ? ` ${q.QuotaName}` : ''}`, region, ...(typeof q.Value === 'number' && q.Value >= 0 ? { limit: q.Value } : {}) });
      }
      token = doc.NextToken ?? '';
      if (!token) break;
    }
  }
  return out;
}

async function listActivity(ctx: ScopeCtx, window: ActivityWindow): Promise<NonNullable<Estate['activity_summary']>> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - window.days * 86_400;
  const by_kind: Record<string, number> = {};
  let total = 0;
  let collected = 0;
  let lastErr: unknown;
  for (const region of await scopeRegions(ctx)) {
    let token = '';
    try {
      let page = 0;
      for (; page < ACTIVITY_MAX_PAGES; page++) {
        const doc = await awsJson<{ Events?: { EventName?: string; ReadOnly?: string }[]; NextToken?: string }>(
          ctx, 'cloudtrail', 'LookupEvents', region, { StartTime: start, EndTime: end, MaxResults: 50, ...(token ? { NextToken: token } : {}) });
        // Counted only: user name, source IP and the event document stay out (section 6.4).
        for (const e of doc.Events ?? []) {
          const kind = classifyTrace(e.EventName, e.ReadOnly === 'true');
          by_kind[kind] = (by_kind[kind] ?? 0) + 1;
          total++;
        }
        token = doc.NextToken ?? '';
        if (!token) break;
      }
      if (token) ctx.sources.push({ name: `activity:${region}`, status: 'not_collected', reason: `partial: stopped after ${ACTIVITY_MAX_PAGES} pages of 50 events` });
      collected++;
    } catch (err) {
      lastErr = err;
      recordSource(ctx, `activity:${region}`, err);
    }
  }
  if (collected === 0) throw new LiveSourceUnavailableError('activity', httpStatusOf(lastErr), lastErr === undefined ? 'no region in scope' : undefined);
  return { window_days: window.days, events_total: total, by_kind };
}

// ---------------------------------------------------------------------------
// Posture (#3866, Design 123 section 5.4 AWS table; mappings in aws-posture.ts)
// ---------------------------------------------------------------------------

/** IAM users read for the identity block; more make the block partial. */
const MAX_IAM_USERS = 200;
/** Load balancers whose listeners are read, per region. */
const MAX_LOAD_BALANCERS = 200;

/** Reads of one posture block: the calls made, how many answered, the first failure. */
class BlockReads {
  readonly calls = new Set<string>();
  ok = 0;
  failed = 0;
  http: number | undefined;
  reason: string | undefined;
  success(call: string): void {
    this.calls.add(call);
    this.ok++;
  }
  failure(call: string, err: unknown): void {
    if (err instanceof LiveAuthError) throw err;
    this.calls.add(call);
    this.failed++;
    if (this.http === undefined && this.reason === undefined) {
      this.http = httpStatusOf(err);
      if (this.http === undefined) this.reason = err instanceof Error ? err.message : String(err);
    }
  }
  /** Run one read, recorded as success or failure; undefined on failure. */
  async read<T>(call: string, fn: () => Promise<T>): Promise<T | undefined> {
    try {
      const v = await fn();
      this.success(call);
      return v;
    } catch (err) {
      this.failure(call, err);
      return undefined;
    }
  }
  /** Merge the reads of another block into this one (a block fed by several reads). */
  absorb(o: BlockReads): void {
    for (const c of o.calls) this.calls.add(c);
    this.ok += o.ok;
    this.failed += o.failed;
    if (this.http === undefined && this.reason === undefined) {
      this.http = o.http;
      this.reason = o.reason;
    }
  }
  source(partial = false): LzLiveFactSource {
    const calls = [...this.calls].sort();
    if (this.ok === 0) return { calls: calls.length > 0 ? calls : ['none'], partial: false, status: 'not_collected', ...(this.http !== undefined ? { http_status: this.http } : { reason: this.reason ?? 'not collected' }) };
    return { calls, partial: partial || this.failed > 0, status: 'ok' };
  }
}

const bool = (v: string | undefined): boolean | undefined => (v === 'true' ? true : v === 'false' ? false : undefined);
const int = (v: string | undefined): number | undefined => (v !== undefined && /^-?\d+$/.test(v) ? Number(v) : undefined);

/** EC2 Query list with `NextToken` paging; `set` is the result list element (`volumeSet`). */
async function ec2Items(ctx: ScopeCtx, op: string, region: string, set: string, params: Record<string, string> = {}): Promise<XmlNode[]> {
  const out: XmlNode[] = [];
  let token = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const doc = await awsQuery(ctx, 'ec2', op, region, { ...params, ...(token ? { NextToken: token } : {}) });
    out.push(...kids(find(doc, set), 'item'));
    token = find(doc, 'nextToken')?.text.trim() ?? '';
    if (!token) break;
  }
  return out;
}

/** Query list with `Marker` paging (IAM, ELBv2); `result` names the `<Op>Result` element, `list` the member list. */
async function markerItems(ctx: ScopeCtx, api: 'iam' | 'elasticloadbalancing', op: string, region: string, list: string, params: Record<string, string> = {}): Promise<XmlNode[]> {
  const out: XmlNode[] = [];
  let marker = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const doc = await awsQuery(ctx, api, op, region, { ...params, ...(marker ? { Marker: marker } : {}) });
    const result = find(doc, `${op}Result`) ?? doc;
    out.push(...kids(find(result, list), 'member'));
    const truncated = api === 'iam' ? textOf(result, 'IsTruncated') === 'true' : true;
    marker = truncated ? (textOf(result, api === 'iam' ? 'Marker' : 'NextMarker') ?? '') : '';
    if (!marker) break;
  }
  return out;
}

const trailCache = new WeakMap<ScopeCtx, Promise<AwsTrailDoc[]>>();
interface AwsTrailDoc { Name?: string; TrailARN?: string; IsMultiRegionTrail?: boolean; IsOrganizationTrail?: boolean; LogFileValidationEnabled?: boolean; HomeRegion?: string; CloudWatchLogsLogGroupArn?: string; S3BucketName?: string; S3KeyPrefix?: string }
/** cloudtrail:DescribeTrails (with shadow trails), cached per scope run (listGuardrails and listPosture). */
function describeTrails(ctx: ScopeCtx): Promise<AwsTrailDoc[]> {
  return memo(trailCache, ctx, async () => (await awsJson<{ trailList?: AwsTrailDoc[] }>(ctx, 'cloudtrail', 'DescribeTrails', awsHomeRegion(ctx), { includeShadowTrails: true })).trailList ?? []);
}
const trailStatusCache = new WeakMap<ScopeCtx, Map<string, Promise<boolean>>>();
/** cloudtrail:GetTrailStatus `IsLogging`, cached per trail and scope run. */
function trailLogging(ctx: ScopeCtx, t: AwsTrailDoc): Promise<boolean> {
  let m = trailStatusCache.get(ctx);
  if (!m) { m = new Map(); trailStatusCache.set(ctx, m); }
  const key = t.TrailARN ?? t.Name ?? '';
  let p = m.get(key);
  if (!p) {
    p = awsJson<{ IsLogging?: boolean }>(ctx, 'cloudtrail', 'GetTrailStatus', t.HomeRegion ?? awsHomeRegion(ctx), { Name: t.TrailARN ?? t.Name }).then((st) => st.IsLogging === true);
    m.set(key, p);
  }
  return p;
}

/**
 * #3935: retention of a trail's S3 bucket (its primary store) from the bucket
 * lifecycle. The bucket region comes from ListBuckets, else GetBucketLocation;
 * a bucket of another account (an organisation trail delivering to a log
 * archive account) is usually not readable: `unread` names the HTTP status
 * (`http_403`), never a failure of the logging block, because the trail
 * itself was read. Only an authentication failure of this scope is thrown.
 *
 * #3975: a bucket this scope cannot read is read through the landing zone's
 * log archive scope (`ctx.logArchive`, `scopes[].purpose: log-archive`),
 * joined by bucket name to the archive's ListBuckets; the same read-only
 * GetBucketLocation and GetBucketLifecycleConfiguration, the retention still
 * for this scope's account (`AWSLogs/[<org id>/]<account>/`). Any trail whose
 * bucket did not answer is tried, not only organisation trails (live
 * 2026-11-07: every trail bucket of the platform scope answered 403).
 *
 * When this scope is the log archive itself (`ctx.isLogArchive`), its own read
 * was the archive's read: nothing is retried, and `logArchive` says whether
 * the archive lists the bucket (`archive_scope_refused`) or not
 * (`archive_scope_not_listed`, the bucket belongs to another account), from
 * this scope's own ListBuckets (`listed`; undefined when that read failed).
 * Live 2026-11-09: a trail of the log archive account delivering to a third
 * account's bucket was reported as `not_registered`.
 */
async function trailBucketRetention(ctx: ScopeCtx, t: AwsTrailDoc, bucketRegions: ReadonlyMap<string, string>, listed: ReadonlySet<string> | undefined, account: string, home: string): Promise<{ retention?: AwsTrail['s3Retention']; unread?: string; readBy?: string; logArchive?: string }> {
  const bucket = t.S3BucketName;
  if (!bucket) return { unread: 'no_bucket' };
  const unread = (err: unknown): { unread: string } => {
    if (err instanceof LiveAuthError) throw err;
    const status = httpStatusOf(err);
    return { unread: status !== undefined ? `http_${status}` : 'not_read' };
  };
  let region = bucketRegions.get(bucket);
  let own: { unread: string };
  try {
    region ??= await bucketRegion(ctx, t.HomeRegion ?? home, bucket);
    const rules = await bucketLifecycle(ctx, region, bucket);
    return { retention: lifecycleRetention(rules, t.S3KeyPrefix, account) };
  } catch (err) {
    own = unread(err);
  }
  if (ctx.isLogArchive) return { ...own, logArchive: listed === undefined ? 'not_read' : listed.has(bucket) ? 'archive_scope_refused' : 'archive_scope_not_listed' };
  const archived = await archiveBucketRetention(ctx, bucket, t.S3KeyPrefix, account);
  return 'retention' in archived ? { retention: archived.retention, readBy: archived.readBy } : { ...own, logArchive: archived.logArchive };
}

const archiveBucketCache = new WeakMap<ScopeCtx, Promise<Map<string, string | undefined>>>();

/**
 * #3975: the lifecycle of `bucket` read through the log archive scope.
 * Never throws: a missing archive, a bucket the archive does not list, a
 * refused read or a rejected archive login all come back as `logArchive`.
 */
async function archiveBucketRetention(ctx: ScopeCtx, bucket: string, keyPrefix: string | undefined, account: string): Promise<{ retention: AwsTrail['s3Retention']; readBy: string } | { logArchive: string }> {
  const ref = ctx.logArchive;
  if (!ref) return { logArchive: 'not_registered' };
  const opened = await ref.open();
  if ('unavailable' in opened) return { logArchive: opened.unavailable };
  const a = opened.ctx;
  const failed = (err: unknown): { logArchive: string } => {
    if (err instanceof LiveAuthError) return { logArchive: 'login_rejected' };
    const status = httpStatusOf(err);
    return { logArchive: status !== undefined ? `http_${status}` : 'not_read' };
  };
  try {
    const home = awsHomeRegion(a);
    const listed = await memo(archiveBucketCache, a, async () => new Map((await listBuckets(a, home)).map((b) => [b.name, b.region] as const)));
    if (!listed.has(bucket)) return { logArchive: 'bucket_not_in_scope' };
    const region = listed.get(bucket) ?? await bucketRegion(a, home, bucket);
    const rules = await bucketLifecycle(a, region, bucket);
    return { retention: lifecycleRetention(rules, keyPrefix, account), readBy: ref.scopeId };
  } catch (err) {
    return failed(err);
  }
}

async function listPosture(ctx: ScopeCtx): Promise<LzLivePostureInput> {
  const regions = await scopeRegions(ctx);
  const account = await awsCallerAccount(ctx);
  const place = (region: string): Ec2Place => ({ partition: awsPartition(region).id, region, account });

  // Encryption at rest: EBS volumes and RDS instances, custody from the KMS keys they name.
  const enc = new BlockReads();
  const stored: AwsStoredResource[] = [];
  const dbs: AwsDbExposure[] = [];
  const keyRefs = new Map<string, Set<string>>();
  const refKey = (region: string, ref: string | undefined): void => {
    if (!ref) return;
    const s = keyRefs.get(region) ?? new Set<string>();
    s.add(ref);
    keyRefs.set(region, s);
  };
  for (const region of regions) {
    const vols = await enc.read('ec2:DescribeVolumes', () => ec2Items(ctx, 'DescribeVolumes', region, 'volumeSet', { MaxResults: '500' }));
    for (const v of vols ?? []) {
      const id = textOf(v, 'volumeId');
      if (!id) continue;
      const kmsKeyId = textOf(v, 'kmsKeyId');
      refKey(region, kmsKeyId);
      stored.push({ arn: ec2Arn(place(region), 'volume', id), region, ...(bool(textOf(v, 'encrypted')) !== undefined ? { encrypted: bool(textOf(v, 'encrypted')) as boolean } : {}), ...(kmsKeyId ? { kmsKeyId } : {}), attributes: { volume_type: textOf(v, 'volumeType'), size_gib: int(textOf(v, 'size')), state: textOf(v, 'status') } });
    }
    const rds = await enc.read('rds:DescribeDBInstances', async () => {
      const out: XmlNode[] = [];
      let marker = '';
      for (let page = 0; page < MAX_PAGES; page++) {
        const doc = await awsQuery(ctx, 'rds', 'DescribeDBInstances', region, marker ? { Marker: marker } : {});
        out.push(...kids(find(doc, 'DBInstances'), 'DBInstance'));
        marker = textOf(find(doc, 'DescribeDBInstancesResult'), 'Marker') ?? '';
        if (!marker) break;
      }
      return out;
    });
    for (const d of rds ?? []) {
      const arn = textOf(d, 'DBInstanceArn');
      if (!arn) continue;
      const kmsKeyId = textOf(d, 'KmsKeyId');
      refKey(region, kmsKeyId);
      stored.push({ arn, region, ...(bool(textOf(d, 'StorageEncrypted')) !== undefined ? { encrypted: bool(textOf(d, 'StorageEncrypted')) as boolean } : {}), ...(kmsKeyId ? { kmsKeyId } : {}), attributes: { engine: textOf(d, 'Engine'), engine_version: textOf(d, 'EngineVersion'), multi_az: bool(textOf(d, 'MultiAZ')) } });
      const pub = bool(textOf(d, 'PubliclyAccessible'));
      dbs.push({ arn, region, ...(pub !== undefined ? { publiclyAccessible: pub } : {}) });
    }
  }
  // KMS: the key list per region, then DescribeKey for the keys a volume or instance names.
  const keys: AwsKmsKey[] = [];
  for (const region of regions) {
    const listed = await enc.read('kms:ListKeys', async () => {
      const out: { KeyId?: string; KeyArn?: string }[] = [];
      let marker = '';
      for (let page = 0; page < MAX_PAGES; page++) {
        const doc = await awsJson<{ Keys?: { KeyId?: string; KeyArn?: string }[]; NextMarker?: string; Truncated?: boolean }>(ctx, 'kms', 'ListKeys', region, { Limit: 1000, ...(marker ? { Marker: marker } : {}) });
        out.push(...(doc.Keys ?? []));
        marker = doc.Truncated === true ? (doc.NextMarker ?? '') : '';
        if (!marker) break;
      }
      return out;
    });
    const refs = keyRefs.get(region) ?? new Set<string>();
    for (const k of listed ?? []) {
      if (!k.KeyId || !k.KeyArn) continue;
      if (![...refs].some((r) => r === k.KeyArn || r === k.KeyId || r.endsWith(`:key/${k.KeyId}`))) continue;
      const meta = await enc.read('kms:DescribeKey', async () => (await awsJson<{ KeyMetadata?: { KeyManager?: string; Origin?: string } }>(ctx, 'kms', 'DescribeKey', region, { KeyId: k.KeyArn })).KeyMetadata);
      if (meta) keys.push({ arn: k.KeyArn, id: k.KeyId, ...(meta.KeyManager ? { manager: meta.KeyManager } : {}), ...(meta.Origin ? { origin: meta.Origin } : {}) });
    }
  }
  // #3935, #3952: a key named by a bucket or table is described directly (it can be an alias,
  // or live in another region or account than the ListKeys of the scope shows), once per reference.
  const keyByRef = new Map<string, Promise<AwsKmsKey | undefined>>();
  const describeKeyRef = (region: string, ref: string | undefined): Promise<AwsKmsKey | undefined> => {
    if (!ref) return Promise.resolve(undefined);
    const known = keys.find((k) => k.arn === ref || k.id === ref);
    if (known) return Promise.resolve(known);
    let p = keyByRef.get(ref);
    if (!p) {
      const keyRegion = /^arn:[^:]+:kms:([a-z0-9-]+):/.exec(ref)?.[1] ?? region;
      p = enc.read('kms:DescribeKey', async () => {
        const meta = (await awsJson<{ KeyMetadata?: { Arn?: string; KeyId?: string; KeyManager?: string; Origin?: string } }>(ctx, 'kms', 'DescribeKey', keyRegion, { KeyId: ref })).KeyMetadata;
        return meta?.Arn && meta.KeyId ? { arn: meta.Arn, id: meta.KeyId, ...(meta.KeyManager ? { manager: meta.KeyManager } : {}), ...(meta.Origin ? { origin: meta.Origin } : {}) } : undefined;
      });
      keyByRef.set(ref, p);
    }
    return p;
  };

  // #3952: DynamoDB tables: ListTables per region, DescribeTable `SSEDescription` per table.
  const tables: { arn: string; region: string }[] = [];
  const s3AndTableItems: ReturnType<typeof atRestFacts> = [];
  for (const region of regions) {
    const names = await enc.read('dynamodb:ListTables', async () => {
      const out: string[] = [];
      let start = '';
      for (let page = 0; page < MAX_PAGES; page++) {
        const doc = await awsJson<{ TableNames?: string[]; LastEvaluatedTableName?: string }>(ctx, 'dynamodb', 'ListTables', region, { Limit: 100, ...(start ? { ExclusiveStartTableName: start } : {}) });
        out.push(...(doc.TableNames ?? []));
        start = doc.LastEvaluatedTableName ?? '';
        if (!start) break;
      }
      return out;
    });
    for (const name of names ?? []) {
      const t = await enc.read('dynamodb:DescribeTable', async () => (await awsJson<{ Table?: { TableArn?: string; SSEDescription?: AwsTableSse } }>(ctx, 'dynamodb', 'DescribeTable', region, { TableName: name })).Table);
      if (!t?.TableArn) continue;
      tables.push({ arn: t.TableArn, region });
      const sse = t.SSEDescription;
      const key = sse?.KMSMasterKeyArn ? await describeKeyRef(region, sse.KMSMasterKeyArn) : undefined;
      s3AndTableItems.push(dynamoEncryptionFact({ arn: t.TableArn, region }, sse, key));
    }
  }

  // #3935: S3 buckets of the scope regions (ListBuckets `BucketRegion`, else GetBucketLocation):
  // default encryption (encryption block), Block Public Access, policy status and ACL (exposure block).
  const homeRegion = awsHomeRegion(ctx);
  const partitionOf = (region: string): string => awsPartition(region).id;
  const s3r = new BlockReads();
  const listedBuckets = await s3r.read('s3:ListBuckets', () => listBuckets(ctx, homeRegion));
  const bucketRegions = new Map<string, string>();
  // #3975: every listed name, whether or not its region was read (the log archive scope's own trail buckets).
  const listedNames = listedBuckets ? new Set(listedBuckets.map((b) => b.name)) : undefined;
  for (const b of listedBuckets ?? []) {
    const r = b.region ?? await s3r.read('s3:GetBucketLocation', () => bucketRegion(ctx, homeRegion, b.name));
    if (r) bucketRegions.set(b.name, r);
  }
  const scopeSet = new Set(regions);
  const inScope: S3Bucket[] = [...bucketRegions.entries()].filter(([, r]) => scopeSet.has(r)).map(([name, region]) => ({ name, region }));
  const s3Exposure: ReturnType<typeof exposureFacts> = [];
  const exp = new BlockReads();
  exp.absorb(s3r);
  enc.absorb(s3r);
  let accountPab: AwsPublicAccessBlock | undefined;
  if (inScope.length > 0) accountPab = await exp.read('s3control:GetPublicAccessBlock', () => accountPublicAccessBlock(ctx, homeRegion, account));
  for (const b of inScope) {
    const region = b.region as string;
    const arn = s3Arn(partitionOf(region), b.name);
    const sse: AwsBucketEncryption | null | undefined = await enc.read('s3:GetBucketEncryption', () => bucketEncryption(ctx, region, b.name));
    if (sse !== undefined) {
      const key = sse?.kmsKeyId ? await describeKeyRef(region, sse.kmsKeyId) : undefined;
      s3AndTableItems.push(s3EncryptionFact({ arn, region }, sse, key));
    }
    const bucketPab = await exp.read('s3:GetPublicAccessBlock', () => bucketPublicAccessBlock(ctx, region, b.name));
    const needs = bucketNeeds(bucketPab, accountPab);
    const policyPublic = needs.policy ? await exp.read('s3:GetBucketPolicyStatus', () => bucketPolicyPublic(ctx, region, b.name)) : undefined;
    const aclPublic = needs.acl ? await exp.read('s3:GetBucketAcl', () => bucketAclPublic(ctx, region, b.name)) : undefined;
    const item = s3ExposureFact({ arn, region, ...(bucketPab ? { bucketPab } : {}), ...(policyPublic !== undefined ? { policyPublic } : {}), ...(aclPublic !== undefined ? { aclPublic } : {}) }, accountPab);
    if (item) s3Exposure.push(item);
  }

  // Load balancers (exposure) and their listeners (in transit).
  const lbReads = new BlockReads();
  const lbs: AwsLoadBalancer[] = [];
  const listeners: AwsListener[] = [];
  const sslPolicies = new Map<string, string[]>();
  let lbCapped = false;
  for (const region of regions) {
    const found = await lbReads.read('elasticloadbalancing:DescribeLoadBalancers', () => markerItems(ctx, 'elasticloadbalancing', 'DescribeLoadBalancers', region, 'LoadBalancers', { PageSize: '400' }));
    const list = (found ?? []).flatMap((m) => {
      const arn = textOf(m, 'LoadBalancerArn');
      return arn ? [{ arn, region, ...(textOf(m, 'Scheme') ? { scheme: textOf(m, 'Scheme') as string } : {}), ...(textOf(m, 'Type') ? { type: textOf(m, 'Type') as string } : {}) }] : [];
    });
    if (list.length > MAX_LOAD_BALANCERS) lbCapped = true;
    lbs.push(...list);
    const wanted = new Set<string>();
    for (const lb of list.slice(0, MAX_LOAD_BALANCERS)) {
      const ls = await lbReads.read('elasticloadbalancing:DescribeListeners', () => markerItems(ctx, 'elasticloadbalancing', 'DescribeListeners', region, 'Listeners', { LoadBalancerArn: lb.arn }));
      for (const l of ls ?? []) {
        const arn = textOf(l, 'ListenerArn');
        if (!arn) continue;
        const ssl = textOf(l, 'SslPolicy');
        if (ssl && !sslPolicies.has(ssl)) wanted.add(ssl);
        listeners.push({ arn, region, ...(textOf(l, 'Protocol') ? { protocol: textOf(l, 'Protocol') as string } : {}), ...(int(textOf(l, 'Port')) !== undefined ? { port: int(textOf(l, 'Port')) as number } : {}), ...(ssl ? { sslPolicy: ssl } : {}) });
      }
    }
    if (wanted.size > 0) {
      const names = [...wanted].sort();
      const pol = await lbReads.read('elasticloadbalancing:DescribeSSLPolicies', async () => {
        const params: Record<string, string> = {};
        names.forEach((n, i) => { params[`Names.member.${i + 1}`] = n; });
        return markerItems(ctx, 'elasticloadbalancing', 'DescribeSSLPolicies', region, 'SslPolicies', params);
      });
      for (const p of pol ?? []) {
        const name = textOf(p, 'Name');
        if (name) sslPolicies.set(name, kids(find(p, 'SslProtocols'), 'member').map((x) => textOf(x, 'Name') ?? '').filter((x) => x !== ''));
      }
    }
  }
  enc.absorb(lbReads);

  // Exposure: elastic IPs, instance public IPs, load balancers, RDS public access (S3 buckets above).
  const addresses: AwsAddress[] = [];
  const instances: AwsInstance[] = [];
  for (const region of regions) {
    const eips = await exp.read('ec2:DescribeAddresses', async () => kids(find(await awsQuery(ctx, 'ec2', 'DescribeAddresses', region), 'addressesSet'), 'item'));
    for (const a of eips ?? []) {
      const allocationId = textOf(a, 'allocationId');
      const publicIp = textOf(a, 'publicIp');
      const instanceId = textOf(a, 'instanceId');
      const networkInterfaceId = textOf(a, 'networkInterfaceId');
      addresses.push({ place: place(region), ...(allocationId ? { allocationId } : {}), ...(publicIp ? { publicIp } : {}), ...(instanceId ? { instanceId } : {}), ...(networkInterfaceId ? { networkInterfaceId } : {}) });
    }
    const res = await exp.read('ec2:DescribeInstances', () => ec2Items(ctx, 'DescribeInstances', region, 'reservationSet', { MaxResults: '1000' }));
    for (const r of res ?? []) {
      for (const i of kids(find(r, 'instancesSet'), 'item')) {
        const id = textOf(i, 'instanceId');
        const ip = textOf(i, 'ipAddress');
        if (id) instances.push({ place: place(region), instanceId: id, ...(ip ? { publicIp: ip } : {}) });
      }
    }
  }
  exp.absorb(lbReads);
  if (dbs.length > 0) exp.success('rds:DescribeDBInstances');

  // Ingress: security group rules.
  const ing = new BlockReads();
  const rules: AwsSgRule[] = [];
  for (const region of regions) {
    const items = await ing.read('ec2:DescribeSecurityGroupRules', () => ec2Items(ctx, 'DescribeSecurityGroupRules', region, 'securityGroupRuleSet', { MaxResults: '1000' }));
    for (const r of items ?? []) {
      const groupId = textOf(r, 'groupId');
      if (!groupId) continue;
      const ref = textOf(find(r, 'referencedGroupInfo'), 'groupId');
      const opt = (k: string): string | undefined => textOf(r, k);
      rules.push({
        place: place(region), groupId, isEgress: opt('isEgress') === 'true',
        ...(opt('ipProtocol') ? { ipProtocol: opt('ipProtocol') as string } : {}),
        ...(int(opt('fromPort')) !== undefined ? { fromPort: int(opt('fromPort')) as number } : {}),
        ...(int(opt('toPort')) !== undefined ? { toPort: int(opt('toPort')) as number } : {}),
        ...(opt('cidrIpv4') ? { cidrIpv4: opt('cidrIpv4') as string } : {}),
        ...(opt('cidrIpv6') ? { cidrIpv6: opt('cidrIpv6') as string } : {}),
        ...(opt('prefixListId') ? { prefixListId: opt('prefixListId') as string } : {}),
        ...(ref ? { referencedGroupId: ref } : {}),
      });
    }
  }

  // Identity: IAM users, their keys, MFA devices and policies; root MFA (GetAccountSummary).
  const id = new BlockReads();
  const home = awsHomeRegion(ctx);
  const users: AwsIamUser[] = [];
  let usersCapped = false;
  const listed = await id.read('iam:ListUsers', () => markerItems(ctx, 'iam', 'ListUsers', home, 'Users', { MaxItems: '1000' }));
  const groupCache = new Map<string, { policies: string[]; inline: number }>();
  const names = (listed ?? []).map((u) => textOf(u, 'UserName')).filter((n): n is string => !!n);
  if (names.length > MAX_IAM_USERS) usersCapped = true;
  for (const name of names.slice(0, MAX_IAM_USERS)) {
    const p = { UserName: name };
    const keys = await id.read('iam:ListAccessKeys', () => markerItems(ctx, 'iam', 'ListAccessKeys', home, 'AccessKeyMetadata', p));
    const mfa = await id.read('iam:ListMFADevices', () => markerItems(ctx, 'iam', 'ListMFADevices', home, 'MFADevices', p));
    const attached = await id.read('iam:ListAttachedUserPolicies', () => markerItems(ctx, 'iam', 'ListAttachedUserPolicies', home, 'AttachedPolicies', p));
    const inline = await id.read('iam:ListUserPolicies', () => markerItems(ctx, 'iam', 'ListUserPolicies', home, 'PolicyNames', p));
    const groups = await id.read('iam:ListGroupsForUser', () => markerItems(ctx, 'iam', 'ListGroupsForUser', home, 'Groups', p));
    if (keys === undefined || mfa === undefined || attached === undefined || inline === undefined || groups === undefined) continue;
    const policies = attached.map((a) => textOf(a, 'PolicyArn') ?? '').filter((x) => x !== '');
    let inlineCount = inline.length;
    let complete = true;
    for (const g of groups.map((x) => textOf(x, 'GroupName')).filter((n): n is string => !!n)) {
      let gi = groupCache.get(g);
      if (!gi) {
        const ga = await id.read('iam:ListAttachedGroupPolicies', () => markerItems(ctx, 'iam', 'ListAttachedGroupPolicies', home, 'AttachedPolicies', { GroupName: g }));
        const gp = await id.read('iam:ListGroupPolicies', () => markerItems(ctx, 'iam', 'ListGroupPolicies', home, 'PolicyNames', { GroupName: g }));
        if (ga === undefined || gp === undefined) { complete = false; continue; }
        gi = { policies: ga.map((a) => textOf(a, 'PolicyArn') ?? '').filter((x) => x !== ''), inline: gp.length };
        groupCache.set(g, gi);
      }
      policies.push(...gi.policies);
      inlineCount += gi.inline;
    }
    if (!complete) continue;
    users.push({
      policies, inlinePolicies: inlineCount, mfaDevices: mfa.length,
      accessKeys: keys.map((k) => ({ active: textOf(k, 'Status') === 'Active', created: textOf(k, 'CreateDate') ?? '' })),
    });
  }
  const summary = await id.read('iam:GetAccountSummary', () => awsQuery(ctx, 'iam', 'GetAccountSummary', home));
  const rootMfaValue = summary ? kids(find(summary, 'SummaryMap'), 'entry').find((e) => textOf(e, 'key') === 'AccountMFAEnabled') : undefined;
  const rootMfa = rootMfaValue ? textOf(rootMfaValue, 'value') === '1' : undefined;
  const identityComplete = names.length === 0 || users.length === Math.min(names.length, MAX_IAM_USERS);

  // Logging: trails, their status and the retention of their CloudWatch Logs group.
  const log = new BlockReads();
  const trailDocs = await log.read('cloudtrail:DescribeTrails', () => describeTrails(ctx));
  const trails: AwsTrail[] = [];
  const retention = new Map<string, number | null>();
  for (const t of trailDocs ?? []) {
    const arn = t.TrailARN ?? t.Name;
    if (!arn) continue;
    const logging = await log.read('cloudtrail:GetTrailStatus', () => trailLogging(ctx, t));
    const s3 = await trailBucketRetention(ctx, t, bucketRegions, listedNames, account, homeRegion);
    if (s3.retention !== undefined) log.success('s3:GetBucketLifecycleConfiguration');
    trails.push({ arn, ...(t.HomeRegion ? { homeRegion: t.HomeRegion } : {}), ...(typeof t.IsMultiRegionTrail === 'boolean' ? { multiRegion: t.IsMultiRegionTrail } : {}), ...(logging !== undefined ? { logging } : {}), ...(typeof t.IsOrganizationTrail === 'boolean' ? { organisationTrail: t.IsOrganizationTrail } : {}), ...(t.CloudWatchLogsLogGroupArn ? { logGroupArn: t.CloudWatchLogsLogGroupArn } : {}), ...(s3.retention !== undefined ? { s3Retention: s3.retention } : {}), ...(s3.unread !== undefined ? { s3Unread: s3.unread } : {}), ...(s3.readBy !== undefined ? { s3ReadBy: s3.readBy } : {}), ...(s3.logArchive !== undefined ? { logArchive: s3.logArchive } : {}) });
    const group = t.CloudWatchLogsLogGroupArn ? logGroupKey(t.CloudWatchLogsLogGroupArn) : undefined;
    const m = group ? /^arn:[^:]+:logs:([a-z0-9-]+):\d*:log-group:(.+)$/.exec(group) : null;
    if (!group || !m || retention.has(group)) continue;
    const [, groupRegion, groupName] = m as unknown as [string, string, string];
    const found = await log.read('logs:DescribeLogGroups', async () => (await awsJson<{ logGroups?: { logGroupName?: string; retentionInDays?: number }[] }>(ctx, 'logs', 'DescribeLogGroups', groupRegion, { logGroupNamePrefix: groupName, limit: 50 })).logGroups ?? []);
    const g = found?.find((x) => x.logGroupName === groupName);
    if (g) retention.set(group, typeof g.retentionInDays === 'number' ? g.retentionInDays : null);
  }

  // Backup: plans and protected resources per region; stateful resources from the reads above and the inventory.
  // Per region (plans and recovery points are regional): items only for the
  // regions where both reads answered, so a denied region never shows its
  // resources as unprotected; such a region makes the block partial.
  const bk = new BlockReads();
  const backupItems: ReturnType<typeof backupFacts> = [];
  for (const region of regions) {
    const pl = await bk.read('backup:ListBackupPlans', async () => {
      let n = 0;
      let next = '';
      for (let page = 0; page < MAX_PAGES; page++) {
        const doc = await awsRestGet<{ BackupPlansList?: unknown[]; NextToken?: string }>(ctx, 'backup', 'ListBackupPlans', region, '/backup/plans/', { MaxResults: '1000', ...(next ? { NextToken: next } : {}) });
        n += (doc.BackupPlansList ?? []).length;
        next = doc.NextToken ?? '';
        if (!next) break;
      }
      return n;
    });
    const prot = await bk.read('backup:ListProtectedResources', async () => {
      const out = new Set<string>();
      let next = '';
      for (let page = 0; page < MAX_PAGES; page++) {
        const doc = await awsRestGet<{ Results?: { ResourceArn?: string }[]; NextToken?: string }>(ctx, 'backup', 'ListProtectedResources', region, '/resources/', { MaxResults: '1000', ...(next ? { NextToken: next } : {}) });
        for (const r of doc.Results ?? []) if (r.ResourceArn) out.add(r.ResourceArn);
        next = doc.NextToken ?? '';
        if (!next) break;
      }
      return out;
    });
    if (pl === undefined || prot === undefined) continue;
    const stateful: { arn: string; region?: string }[] = stored.filter((x) => x.region === region).map((x) => ({ arn: x.arn, region }));
    for (const t of (await taggedResources(ctx, region)) ?? []) if (parseArn(t.arn)?.type === 'table' && parseArn(t.arn)?.service === 'dynamodb') stateful.push({ arn: t.arn, region });
    // #3952: every table ListTables named (also untagged ones), and its point-in-time recovery.
    const continuous = new Set<string>();
    for (const t of tables.filter((x) => x.region === region)) {
      if (!stateful.some((x) => x.arn === t.arn)) stateful.push({ arn: t.arn, region });
      const pitr = await bk.read('dynamodb:DescribeContinuousBackups', async () => (await awsJson<{ ContinuousBackupsDescription?: { PointInTimeRecoveryDescription?: { PointInTimeRecoveryStatus?: string } } }>(ctx, 'dynamodb', 'DescribeContinuousBackups', region, { TableName: t.arn })).ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus);
      if (pitr === 'ENABLED') continuous.add(t.arn);
    }
    backupItems.push(...backupFacts(stateful, prot, pl, continuous));
  }

  // Budgets (#3936): the account's budgets, their notifications and the subscriber count of each (never the addresses).
  const bud = new BlockReads();
  const budgets: AwsBudget[] = [];
  let budgetsPartial = false;
  type BudgetDoc = { BudgetName?: string; BudgetType?: string; BudgetLimit?: { Amount?: string; Unit?: string }; TimeUnit?: string };
  type NotificationDoc = { NotificationType?: string; ComparisonOperator?: string; Threshold?: number; ThresholdType?: string };
  const budgetList = await bud.read('budgets:DescribeBudgets', async () => {
    const out: BudgetDoc[] = [];
    let next = '';
    for (let page = 0; page < MAX_PAGES; page++) {
      const doc = await awsJson<{ Budgets?: BudgetDoc[]; NextToken?: string }>(ctx, 'budgets', 'DescribeBudgets', home, { AccountId: account, MaxResults: 100, ...(next ? { NextToken: next } : {}) });
      out.push(...(doc.Budgets ?? []));
      next = doc.NextToken ?? '';
      if (!next) break;
    }
    return out;
  });
  for (const b of budgetList ?? []) {
    if (!b.BudgetName) continue;
    const name = b.BudgetName;
    const notes = await bud.read('budgets:DescribeNotificationsForBudget', async () => {
      const out: NotificationDoc[] = [];
      let next = '';
      for (let page = 0; page < MAX_PAGES; page++) {
        const doc = await awsJson<{ Notifications?: NotificationDoc[]; NextToken?: string }>(ctx, 'budgets', 'DescribeNotificationsForBudget', home, { AccountId: account, BudgetName: name, MaxResults: 100, ...(next ? { NextToken: next } : {}) });
        out.push(...(doc.Notifications ?? []));
        next = doc.NextToken ?? '';
        if (!next) break;
      }
      return out;
    });
    if (notes === undefined) budgetsPartial = true;
    const notifications: NonNullable<AwsBudget['notifications']>[number][] = [];
    for (const n of notes ?? []) {
      // Counted only: the subscriber addresses (e-mail, SNS topic) never leave this loop.
      const subs = await bud.read('budgets:DescribeSubscribersForNotification', async () => {
        let count = 0;
        let next = '';
        for (let page = 0; page < MAX_PAGES; page++) {
          const doc = await awsJson<{ Subscribers?: unknown[]; NextToken?: string }>(ctx, 'budgets', 'DescribeSubscribersForNotification', home, { AccountId: account, BudgetName: name, Notification: n, MaxResults: 100, ...(next ? { NextToken: next } : {}) });
          count += (doc.Subscribers ?? []).length;
          next = doc.NextToken ?? '';
          if (!next) break;
        }
        return count;
      });
      notifications.push({ ...(n.NotificationType ? { type: n.NotificationType } : {}), ...(typeof n.Threshold === 'number' ? { threshold: n.Threshold } : {}), ...(n.ThresholdType ? { thresholdType: n.ThresholdType } : {}), ...(subs !== undefined ? { subscribers: subs } : {}) });
    }
    budgets.push({ name, ...(b.BudgetType ? { budgetType: b.BudgetType } : {}), ...(b.BudgetLimit ? { limit: b.BudgetLimit } : {}), ...(b.TimeUnit ? { timeUnit: b.TimeUnit } : {}), ...(notes !== undefined ? { notifications } : {}) });
  }

  return {
    encryption: { source: enc.source(), items: [...atRestFacts(stored, keys), ...s3AndTableItems, ...listenerFacts(listeners, sslPolicies)] },
    exposure: { source: exp.source(lbCapped), items: [...exposureFacts(addresses, instances, lbs, dbs), ...s3Exposure] },
    ingress_rules: { source: ing.source(), items: ingressRules(rules) },
    identity: { source: id.source(usersCapped || !identityComplete), ...(id.ok > 0 ? identityFacts(users, rootMfa) : { credentials: [] }) },
    logging: { source: log.source(), trails: trailFacts(trails, retention) },
    backup: { source: bk.source(), items: backupItems },
    budgets: { source: bud.source(budgetsPartial), items: budgetFacts(budgets, { partition: awsPartition(home).id, account }) },
  };
}

// ---------------------------------------------------------------------------
// Pass 23 (Design 120 section 7.5): the EKS and RDS reads of the LZR adapter
// ---------------------------------------------------------------------------

export interface AwsPass23State {
  eks_clusters: { name: string; status: string; version?: string }[];
  rds_instances: { identifier: string; engine: string; status: string; engineVersion?: string }[];
}

function rdsInstances(doc: XmlNode): AwsPass23State['rds_instances'] {
  return kids(find(doc, 'DBInstances'), 'DBInstance').map((i) => ({
    identifier: textOf(i, 'DBInstanceIdentifier') ?? '',
    engine: textOf(i, 'Engine') ?? '',
    status: textOf(i, 'DBInstanceStatus') ?? '',
    ...(textOf(i, 'EngineVersion') ? { engineVersion: textOf(i, 'EngineVersion') as string } : {}),
  }));
}

/** EKS ListClusters / DescribeCluster and RDS DescribeDBInstances (XML, Marker pagination) in one region. */
export async function readAwsPass23State(ctx: ScopeCtx, region: string): Promise<AwsPass23State> {
  const names: string[] = [];
  let next = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const doc = await awsRestGet<{ clusters?: string[]; nextToken?: string | null }>(ctx, 'eks', 'ListClusters', region, '/clusters', next ? { nextToken: next } : {});
    names.push(...(doc.clusters ?? []));
    next = doc.nextToken ?? '';
    if (!next) break;
  }
  const eks_clusters: AwsPass23State['eks_clusters'] = [];
  for (const name of names) {
    const d = await awsRestGet<{ cluster?: { status?: string; version?: string } }>(ctx, 'eks', 'DescribeCluster', region, `/clusters/${encodeURIComponent(name)}`);
    eks_clusters.push({ name, status: d.cluster?.status ?? 'UNKNOWN', ...(d.cluster?.version ? { version: d.cluster.version } : {}) });
  }
  const rds_instances: AwsPass23State['rds_instances'] = [];
  let marker = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const doc = await awsQuery(ctx, 'rds', 'DescribeDBInstances', region, marker ? { Marker: marker } : {});
    rds_instances.push(...rdsInstances(doc));
    marker = textOf(find(doc, 'DescribeDBInstancesResult'), 'Marker') ?? '';
    if (!marker) break;
  }
  return { eks_clusters, rds_instances };
}

export const awsDriver: LiveLzDriver = {
  provider: AWS_PROVIDER,
  driverVersion: AWS_DRIVER_VERSION,
  // Short-lived STS keys from an SSO profile (stored with swao lz connect or swao credential set, #4459);
  // `expires-at` is checked before any request (#3570). `sso-profile`,
  // `credential-process` and `instance-profile` (Design 120 section 7.1) need
  // a credential source outside the vault and are not in this run.
  authMethods: [{ id: 'session-keys', required: ['access-key-id', 'secret-access-key'], optional: ['session-token', 'expires-at'], unattended: false }],
  defaultBaseUrls: { ...AWS_DEFAULT_BASE_URLS },
  readAllowList: [{ method: 'POST', path: /^\/$/, reason: 'AWS JSON protocol: every operation is a POST to /; the AWS action guard (aws-client.ts) admits only Describe, List, Get and Lookup operations' }],
  // #3866: AWS Backup REST-JSON reads (ListBackupPlans, ListProtectedResources).
  // #3935: S3 path-style bucket reads and the S3 Control account read; `/{bucket}` last, so the
  // fixed one-segment routes (`/`, `/clusters`) match first (record.ts routeOf takes the first template).
  routeTemplates: ['/', '/clusters', '/clusters/{name}', '/backup/plans/', '/resources/', '/v20180820/configuration/publicAccessBlock', '/{bucket}'],
  regionOf: awsRegionOf,
  probeReadOnly,
  listRegions,
  listServices,
  listGuardrails,
  listResources,
  listQuotas,
  listActivity,
  // #3882 (Design 123 section 5.6): organisation, root, nested OUs, accounts.
  // Mock only on 2026-11-05 (no SSO window, D-17); the live criterion is open.
  listHierarchy: (ctx) => listAwsHierarchy(ctx, awsHomeRegion(ctx)),
  // #3866 (Design 123 section 5.4): posture collectors. Mock only on
  // 2026-11-06 (no SSO window for this lane, D-17); the live criterion is open.
  listPosture,
  // #3831 (Q-21, owner decision 2026-11-04): registered for release on the
  // live evidence of the operator / Reader runs; minimal role set unverified (ROLES.md).
  liveVerified: true,
};
