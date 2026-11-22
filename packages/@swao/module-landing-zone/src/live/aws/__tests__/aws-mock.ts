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

// #3574 test fixture: an in-process mock of the AWS APIs the `aws` driver
// reads, served through the injected transport. Wire formats follow the
// published AWS API models (botocore service-2.json) and the shapes recorded
// on a test organisation on 2026-11-03 (Query XML with PascalCase
// elements for STS / IAM / RDS, EC2 XML with lowerCamel elements and `item`
// lists, JSON protocol with `X-Amz-Target`, CloudTrail throttling as HTTP 400
// `ThrottlingException`). Every id, name and ARN here is neutral test data.

import type { FetchLike } from '../../types.js';

export const ACCOUNT = '111122223333';
export const ROLE_NAME = 'AWSReservedSSO_ps-Mock-ReadOnly_0000000000000000';
export const ROLE_ARN = `arn:aws:iam::${ACCOUNT}:role/aws-reserved/sso.amazonaws.com/eu-central-1/${ROLE_NAME}`;
export const SESSION_ARN = `arn:aws:sts::${ACCOUNT}:assumed-role/${ROLE_NAME}/mock.user@example.com`;

export interface MockCall {
  method: string;
  url: string;
  host: string;
  path: string;
  operation: string | null;
  headers: Record<string, string>;
  body?: string;
}

export interface AwsMockOptions {
  /** Decision per action name; default implicitDeny for writes, allowed for reads. */
  decisions?: Record<string, string>;
  /** Status (and optional error code) per operation, e.g. { GetResources: 403 }. */
  fail?: Record<string, number | { status: number; code: string }>;
  /** Number of times an operation answers ThrottlingException before succeeding. */
  throttle?: Record<string, number>;
  regions?: { name: string; optIn: string }[];
  /** Tagging pages per region. */
  tagged?: Record<string, { arn: string; tags?: Record<string, string> }[][]>;
  /** CloudTrail event pages (every region). */
  events?: { name: string; readOnly: boolean }[][];
  trails?: { Name: string; TrailARN: string; HomeRegion: string; IsMultiRegionTrail: boolean; logging: boolean }[];
  recorders?: Record<string, { name: string; recording: boolean }[]>;
  eksClusters?: string[][];
  rdsPages?: { id: string; engine: string; status: string; version?: string }[][];
  scpCount?: number;
  /**
   * #3882 Organizations tree: OUs and accounts per parent id. Default: root
   * r-mock > ou-mock-a > ou-mock-b (nested) > the caller account, and a
   * second account directly under the root.
   */
  orgTree?: { ous: Record<string, string[]>; accounts: Record<string, string[]> };
}

export const ORG_ROOT = 'r-mock';
const DEFAULT_ORG_TREE: { ous: Record<string, string[]>; accounts: Record<string, string[]> } = { ous: { [ORG_ROOT]: ['ou-mock-a'], 'ou-mock-a': ['ou-mock-b'] }, accounts: { [ORG_ROOT]: ['444455556666'], 'ou-mock-b': [ACCOUNT] } };

const DEFAULT_REGIONS = [
  { name: 'eu-central-1', optIn: 'opt-in-not-required' },
  { name: 'eu-north-1', optIn: 'opt-in-not-required' },
  { name: 'eu-south-2', optIn: 'not-opted-in' },
];

const xmlEsc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function res(status: number, body: string, contentType: string, headers: Record<string, string> = {}): ReturnType<FetchLike> {
  const h = new Map(Object.entries({ 'content-type': contentType, ...headers }).map(([k, v]) => [k.toLowerCase(), v]));
  return Promise.resolve({ ok: status >= 200 && status < 300, status, headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null }, text: async () => body });
}

const xmlRes = (status: number, body: string): ReturnType<FetchLike> => res(status, `<?xml version="1.0" encoding="UTF-8"?>\n${body}`, 'text/xml');
const jsonRes = (status: number, body: unknown): ReturnType<FetchLike> => res(status, JSON.stringify(body), 'application/x-amz-json-1.1');

function queryError(status: number, code: string): ReturnType<FetchLike> {
  return xmlRes(status, `<ErrorResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><Error><Type>Sender</Type><Code>${code}</Code><Message>mock</Message></Error><RequestId>r-1</RequestId></ErrorResponse>`);
}
function ec2Error(status: number, code: string): ReturnType<FetchLike> {
  return xmlRes(status, `<Response><Errors><Error><Code>${code}</Code><Message>mock</Message></Error></Errors><RequestID>r-1</RequestID></Response>`);
}

const WRITE_PREFIXES = /^(\w+):(Run|Terminate|Create|Put|Delete|Attach|Stop|Schedule)/;

export function makeAwsMock(opts: AwsMockOptions = {}): { fetch: FetchLike; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const throttled: Record<string, number> = { ...(opts.throttle ?? {}) };
  const pageOf = (token: string | undefined): number => (token ? Number(token.replace('page-', '')) : 0);

  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const headers = Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const target = headers['x-amz-target'];
    const operation = target ? target.slice(target.lastIndexOf('.') + 1) : u.searchParams.get('Action');
    calls.push({ method: init?.method ?? 'GET', url, host: u.host, path: u.pathname, operation, headers, ...(init?.body !== undefined ? { body: init.body } : {}) });
    const svc = u.hostname.split('.')[0] as string;
    const region = u.hostname.split('.')[1] as string;
    const key = operation ?? (u.pathname.startsWith('/clusters/') ? 'DescribeCluster' : u.pathname === '/clusters' ? 'ListClusters' : u.pathname);
    if (!headers['authorization']?.startsWith('AWS4-HMAC-SHA256 Credential=')) return queryError(403, 'MissingAuthenticationToken');
    if ((throttled[key] ?? 0) > 0) {
      throttled[key] = (throttled[key] as number) - 1;
      return target ? jsonRes(400, { __type: 'ThrottlingException', message: 'Rate exceeded' }) : queryError(400, 'Throttling');
    }
    const f = opts.fail?.[key];
    if (f !== undefined) {
      const status = typeof f === 'number' ? f : f.status;
      const code = typeof f === 'number' ? (status === 403 ? 'AccessDenied' : status === 404 ? 'NotFound' : 'InternalFailure') : f.code;
      if (target) return jsonRes(status, { __type: code === 'AccessDenied' ? 'AccessDeniedException' : code, message: 'mock' });
      if (svc === 'ec2') return ec2Error(status, code === 'AccessDenied' ? 'UnauthorizedOperation' : code);
      if (svc === 'eks') return res(status, JSON.stringify({ message: 'mock' }), 'application/json', { 'x-amzn-errortype': `${code}Exception:` });
      return queryError(status, code);
    }
    const body = init?.body ? JSON.parse(init.body) as Record<string, unknown> : {};
    switch (key) {
      case 'GetCallerIdentity':
        return xmlRes(200, `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Arn>${xmlEsc(SESSION_ARN)}</Arn><UserId>AROAMOCK:mock.user@example.com</UserId><Account>${ACCOUNT}</Account></GetCallerIdentityResult><ResponseMetadata><RequestId>r-1</RequestId></ResponseMetadata></GetCallerIdentityResponse>`);
      case 'GetRole':
        return xmlRes(200, `<GetRoleResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><GetRoleResult><Role><Path>/aws-reserved/sso.amazonaws.com/eu-central-1/</Path><RoleName>${u.searchParams.get('RoleName') ?? ''}</RoleName><Arn>${ROLE_ARN}</Arn></Role></GetRoleResult></GetRoleResponse>`);
      case 'SimulatePrincipalPolicy': {
        const actions = [...u.searchParams.entries()].filter(([k]) => k.startsWith('ActionNames.member.')).map(([, v]) => v);
        const members = actions.map((a) => {
          const d = opts.decisions?.[a] ?? (WRITE_PREFIXES.test(a) ? 'implicitDeny' : 'allowed');
          return `<member><OrganizationsDecisionDetail><AllowedByOrganizations>true</AllowedByOrganizations></OrganizationsDecisionDetail><MatchedStatements/><EvalResourceName>*</EvalResourceName><EvalActionName>${a}</EvalActionName><EvalDecision>${d}</EvalDecision></member>`;
        }).join('');
        return xmlRes(200, `<SimulatePrincipalPolicyResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><SimulatePrincipalPolicyResult><IsTruncated>false</IsTruncated><EvaluationResults>${members}</EvaluationResults></SimulatePrincipalPolicyResult></SimulatePrincipalPolicyResponse>`);
      }
      case 'DescribeRegions':
        return xmlRes(200, `<DescribeRegionsResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/"><requestId>r-1</requestId><regionInfo>${(opts.regions ?? DEFAULT_REGIONS).map((r) => `<item><regionName>${r.name}</regionName><regionEndpoint>ec2.${r.name}.amazonaws.com</regionEndpoint><optInStatus>${r.optIn}</optInStatus><geographySet><item><name>Mock</name></item></geographySet></item>`).join('')}</regionInfo></DescribeRegionsResponse>`);
      case 'DescribeAvailabilityZones':
        return xmlRes(200, `<DescribeAvailabilityZonesResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/"><requestId>r-1</requestId><availabilityZoneInfo>${['a', 'b', 'c'].map((z, i) => `<item><zoneName>${region}${z}</zoneName><zoneId>mock-az${i}</zoneId><zoneState>${i === 2 ? 'impaired' : 'available'}</zoneState><regionName>${region}</regionName><zoneType>availability-zone</zoneType></item>`).join('')}<item><zoneName>${region}-lz-1a</zoneName><zoneState>available</zoneState><zoneType>local-zone</zoneType></item></availabilityZoneInfo></DescribeAvailabilityZonesResponse>`);
      case 'GetResources': {
        const pages = opts.tagged?.[region] ?? [[{ arn: `arn:aws:s3:::mock-bucket-${region}`, tags: { env: 'test' } }, { arn: `arn:aws:ec2:${region}:${ACCOUNT}:instance/i-0000000000000001` }]];
        const n = pageOf(body['PaginationToken'] as string | undefined);
        const list = pages[n] ?? [];
        return jsonRes(200, { ResourceTagMappingList: list.map((r) => ({ ResourceARN: r.arn, Tags: Object.entries(r.tags ?? {}).map(([Key, Value]) => ({ Key, Value })) })), PaginationToken: n + 1 < pages.length ? `page-${n + 1}` : '' });
      }
      case 'DescribeOrganization':
        return jsonRes(200, { Organization: { Id: 'o-mock', FeatureSet: 'ALL', MasterAccountId: ACCOUNT, MasterAccountEmail: 'root@example.com' } });
      case 'ListRoots':
        return jsonRes(200, { Roots: [{ Id: ORG_ROOT, Arn: `arn:aws:organizations::${ACCOUNT}:root/o-mock/${ORG_ROOT}`, Name: 'Root', PolicyTypes: [{ Type: 'SERVICE_CONTROL_POLICY', Status: 'ENABLED' }] }] });
      case 'ListOrganizationalUnitsForParent': {
        const ids = (opts.orgTree ?? DEFAULT_ORG_TREE).ous[String(body['ParentId'])] ?? [];
        return jsonRes(200, { OrganizationalUnits: ids.map((Id) => ({ Id, Arn: `arn:aws:organizations::${ACCOUNT}:ou/o-mock/${Id}`, Name: `name-${Id}` })) });
      }
      case 'ListAccountsForParent': {
        const ids = (opts.orgTree ?? DEFAULT_ORG_TREE).accounts[String(body['ParentId'])] ?? [];
        // One account per page, so the NextToken paging is exercised.
        const n = pageOf(body['NextToken'] as string | undefined);
        const slice = ids.slice(n, n + 1);
        return jsonRes(200, { Accounts: slice.map((Id) => ({ Id, Arn: `arn:aws:organizations::${ACCOUNT}:account/o-mock/${Id}`, Email: `owner-${Id}@example.com`, Name: `account-${Id}`, Status: 'ACTIVE', JoinedMethod: 'CREATED', JoinedTimestamp: 1.7e9 })), ...(n + 1 < ids.length ? { NextToken: `page-${n + 1}` } : {}) });
      }
      case 'ListPoliciesForTarget': {
        // The AWS managed FullAWSAccess on every target, the customer SCP p-mock1 on the root (as ListPolicies).
        const target = String(body['TargetId']);
        const ids = target === ORG_ROOT ? ['p-mock0', 'p-mock1'] : ['p-mock0'];
        return jsonRes(200, { Policies: ids.map((Id) => ({ Id, Name: Id, Type: 'SERVICE_CONTROL_POLICY', AwsManaged: Id === 'p-mock0' })) });
      }
      case 'ListPolicies': {
        const n = opts.scpCount ?? 2;
        const page = pageOf(body['NextToken'] as string | undefined);
        const ids = Array.from({ length: n }, (_, i) => `p-mock${i}`);
        const slice = ids.slice(page, page + 1);
        return jsonRes(200, { Policies: slice.map((Id, i) => ({ Id, Name: `scp-${i}`, Type: 'SERVICE_CONTROL_POLICY', AwsManaged: Id === 'p-mock0' })), ...(page + 1 < n ? { NextToken: `page-${page + 1}` } : {}) });
      }
      case 'DescribeTrails':
        return jsonRes(200, { trailList: (opts.trails ?? [{ Name: 'org-trail', TrailARN: `arn:aws:cloudtrail:us-east-1:${ACCOUNT}:trail/org-trail`, HomeRegion: 'us-east-1', IsMultiRegionTrail: true, logging: true }]).map(({ logging: _l, ...t }) => ({ ...t, IsOrganizationTrail: true, LogFileValidationEnabled: true, S3BucketName: 'mock-bucket' })) });
      case 'GetTrailStatus': {
        const t = (opts.trails ?? [{ TrailARN: `arn:aws:cloudtrail:us-east-1:${ACCOUNT}:trail/org-trail`, logging: true }]).find((x) => x.TrailARN === body['Name']);
        return jsonRes(200, { IsLogging: t?.logging === true, StartLoggingTime: 1.762269256642E9, TimeLoggingStarted: '2025-11-04T15:14:16Z' });
      }
      case 'DescribeConfigurationRecorderStatus':
        return jsonRes(200, { ConfigurationRecordersStatus: opts.recorders?.[region] ?? [] });
      case 'ListServiceQuotas': {
        const code = body['ServiceCode'] as string;
        return jsonRes(200, { Quotas: [{ QuotaCode: `L-${code.toUpperCase()}1`, QuotaName: `${code} mock quota`, ServiceCode: code, Value: 100.0 }, { QuotaCode: `L-${code.toUpperCase()}2`, QuotaName: `${code} unlimited`, ServiceCode: code, Value: -1 }] });
      }
      case 'LookupEvents': {
        const pages = opts.events ?? [[{ name: 'DescribeInstances', readOnly: true }, { name: 'ConsoleLogin', readOnly: false }], [{ name: 'CreateBucket', readOnly: false }]];
        const n = pageOf(body['NextToken'] as string | undefined);
        const list = pages[n] ?? [];
        return jsonRes(200, { Events: list.map((e, i) => ({ EventId: `e-${n}-${i}`, EventName: e.name, ReadOnly: e.readOnly ? 'true' : 'false', Username: 'mock.user@example.com', CloudTrailEvent: '{"sourceIPAddress":"192.0.2.1"}' })), ...(n + 1 < pages.length ? { NextToken: `page-${n + 1}` } : {}) });
      }
      case 'ListClusters': {
        const pages = opts.eksClusters ?? [['mock-cluster']];
        const n = pageOf(u.searchParams.get('nextToken') ?? undefined);
        return res(200, JSON.stringify({ clusters: pages[n] ?? [], nextToken: n + 1 < pages.length ? `page-${n + 1}` : null }), 'application/json');
      }
      case 'DescribeCluster': {
        const name = decodeURIComponent(u.pathname.slice('/clusters/'.length));
        return res(200, JSON.stringify({ cluster: { name, status: 'ACTIVE', version: '1.31' } }), 'application/json');
      }
      case 'DescribeDBInstances': {
        const pages = opts.rdsPages ?? [[{ id: 'db-1', engine: 'postgres', status: 'available', version: '16.4' }]];
        const n = pageOf(u.searchParams.get('Marker') ?? undefined);
        const list = pages[n] ?? [];
        const marker = n + 1 < pages.length ? `<Marker>page-${n + 1}</Marker>` : '';
        return xmlRes(200, `<DescribeDBInstancesResponse xmlns="http://rds.amazonaws.com/doc/2014-10-31/"><DescribeDBInstancesResult>${marker}<DBInstances>${list.map((d) => `<DBInstance><DBInstanceIdentifier>${d.id}</DBInstanceIdentifier><Engine>${d.engine}</Engine><DBInstanceStatus>${d.status}</DBInstanceStatus>${d.version ? `<EngineVersion>${d.version}</EngineVersion>` : ''}</DBInstance>`).join('')}</DBInstances></DescribeDBInstancesResult></DescribeDBInstancesResponse>`);
      }
      default:
        return queryError(404, 'UnknownOperation');
    }
  };
  return { fetch, calls };
}
