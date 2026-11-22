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

// #3574: transport of the `aws` live driver. Protocols, target prefixes, API
// versions and endpoint prefixes are taken from the published AWS API models
// (botocore `data/<service>/<version>/service-2.json` metadata, aws-cli
// 2.35.13), partitions and DNS suffixes from botocore `data/partitions.json`
// (Q-31: not hard-coded per region, derived from the partition table).
//
// Read-only (Design 120 section 6.3): the HTTP allow-list (http.ts) admits GET
// and the POST `/` of the AWS JSON protocol, but a POST `/` (and an AWS Query
// GET) can carry any action. Every request of this driver is therefore built
// by `awsCall`, which refuses an operation that is not a read verb before the
// request exists, and `awsActionGuard` wraps `ctx.http.fetch` so that a
// request built any other way is checked again from its `Action` parameter or
// `X-Amz-Target` header. Credentials never appear in an error message.

import type { FetchLike, LiveResponse, ScopeCtx } from '../types.js';
import { ReadOnlyViolationError } from '../http.js';
import { LiveAuthError } from '../errors.js';
import { isLoopbackHost } from '../endpoints.js';
// A loop, not /\/+$/ (CodeQL js/polynomial-redos on #1802).
import { trimTrailingSlashes } from '../otc/otc-client.js';
import { signAwsV4 } from './aws-sign.js';
import { parseXml, xmlErrorCode } from './aws-xml.js';
import type { XmlNode } from './aws-xml.js';

export const AWS_PROVIDER = 'aws';

type Protocol = 'query' | 'ec2' | 'json' | 'rest-json' | 'rest-xml';

interface AwsServiceDef {
  /** botocore endpointPrefix: host label and default base URL. */
  endpointPrefix: string;
  /** SigV4 service name (botocore signingName, else endpointPrefix). */
  signingName: string;
  protocol: Protocol;
  apiVersion: string;
  targetPrefix?: string;
  /** botocore `jsonVersion` of a JSON-protocol API (content type `application/x-amz-json-<v>`); 1.1 when absent. */
  jsonVersion?: '1.0' | '1.1';
  /** Global service: one endpoint in the `aws` partition, signed for us-east-1. */
  global?: { host: string; signingRegion: string };
}

/** botocore service-2.json metadata (aws-cli 2.35.13). */
export const AWS_SERVICES = {
  sts: { endpointPrefix: 'sts', signingName: 'sts', protocol: 'query', apiVersion: '2011-06-15' },
  iam: { endpointPrefix: 'iam', signingName: 'iam', protocol: 'query', apiVersion: '2010-05-08', global: { host: 'iam.amazonaws.com', signingRegion: 'us-east-1' } },
  ec2: { endpointPrefix: 'ec2', signingName: 'ec2', protocol: 'ec2', apiVersion: '2016-11-15' },
  rds: { endpointPrefix: 'rds', signingName: 'rds', protocol: 'query', apiVersion: '2014-10-31' },
  eks: { endpointPrefix: 'eks', signingName: 'eks', protocol: 'rest-json', apiVersion: '2017-11-01' },
  organizations: { endpointPrefix: 'organizations', signingName: 'organizations', protocol: 'json', apiVersion: '2016-11-28', targetPrefix: 'AWSOrganizationsV20161128', global: { host: 'organizations.us-east-1.amazonaws.com', signingRegion: 'us-east-1' } },
  tagging: { endpointPrefix: 'tagging', signingName: 'tagging', protocol: 'json', apiVersion: '2017-01-26', targetPrefix: 'ResourceGroupsTaggingAPI_20170126' },
  cloudtrail: { endpointPrefix: 'cloudtrail', signingName: 'cloudtrail', protocol: 'json', apiVersion: '2013-11-01', targetPrefix: 'com.amazonaws.cloudtrail.v20131101.CloudTrail_20131101' },
  config: { endpointPrefix: 'config', signingName: 'config', protocol: 'json', apiVersion: '2014-11-12', targetPrefix: 'StarlingDoveService' },
  servicequotas: { endpointPrefix: 'servicequotas', signingName: 'servicequotas', protocol: 'json', apiVersion: '2019-06-24', targetPrefix: 'ServiceQuotasV20190624' },
  // #3866 (Design 123 section 5.4, posture collectors): metadata checked against botocore service-2.json (develop, 2026-11-06).
  kms: { endpointPrefix: 'kms', signingName: 'kms', protocol: 'json', apiVersion: '2014-11-01', targetPrefix: 'TrentService' },
  logs: { endpointPrefix: 'logs', signingName: 'logs', protocol: 'json', apiVersion: '2014-03-28', targetPrefix: 'Logs_20140328' },
  elasticloadbalancing: { endpointPrefix: 'elasticloadbalancing', signingName: 'elasticloadbalancing', protocol: 'query', apiVersion: '2015-12-01' },
  backup: { endpointPrefix: 'backup', signingName: 'backup', protocol: 'rest-json', apiVersion: '2018-11-15' },
  // #3936: AWS Budgets, global (botocore endpoint rule set: budgets.<dnsSuffix>, signed for the global region of the partition).
  budgets: { endpointPrefix: 'budgets', signingName: 'budgets', protocol: 'json', apiVersion: '2016-10-20', targetPrefix: 'AWSBudgetServiceGateway', global: { host: 'budgets.amazonaws.com', signingRegion: 'us-east-1' } },
  // #3935: S3 and S3 Control (REST-XML, botocore s3 2006-03-01 and s3control 2018-08-20; both sign as `s3`).
  // S3 Control is addressed per account (`<account>.s3-control.<region>.<dnsSuffix>`, awsEndpoint).
  s3: { endpointPrefix: 's3', signingName: 's3', protocol: 'rest-xml', apiVersion: '2006-03-01' },
  s3control: { endpointPrefix: 's3-control', signingName: 's3', protocol: 'rest-xml', apiVersion: '2018-08-20' },
  // #3952: DynamoDB (botocore dynamodb 2012-08-10 metadata: protocol json, jsonVersion 1.0, targetPrefix DynamoDB_20120810).
  dynamodb: { endpointPrefix: 'dynamodb', signingName: 'dynamodb', protocol: 'json', apiVersion: '2012-08-10', targetPrefix: 'DynamoDB_20120810', jsonVersion: '1.0' },
} as const satisfies Record<string, AwsServiceDef>;
export type AwsApi = keyof typeof AWS_SERVICES;

/** Driver default base URLs: one per API id, so a mock can override each (Design 121 section 6). */
export const AWS_DEFAULT_BASE_URLS: Record<AwsApi, string> = Object.fromEntries(
  Object.entries(AWS_SERVICES).map(([api, d]) => [api, `https://${'global' in d ? d.global.host : `${d.endpointPrefix}.amazonaws.com`}`]),
) as Record<AwsApi, string>;

/** botocore partitions.json (id, regionRegex, dnsSuffix). */
const AWS_PARTITIONS: readonly { id: string; re: RegExp; dnsSuffix: string }[] = [
  { id: 'aws', re: /^(us|eu|ap|sa|ca|me|af|il|mx)-\w+-\d+$/, dnsSuffix: 'amazonaws.com' },
  { id: 'aws-cn', re: /^cn-\w+-\d+$/, dnsSuffix: 'amazonaws.com.cn' },
  { id: 'aws-eusc', re: /^eusc-(de)-\w+-\d+$/, dnsSuffix: 'amazonaws.eu' },
  { id: 'aws-iso', re: /^us-iso-\w+-\d+$/, dnsSuffix: 'c2s.ic.gov' },
  { id: 'aws-iso-b', re: /^us-isob-\w+-\d+$/, dnsSuffix: 'sc2s.sgov.gov' },
  { id: 'aws-iso-e', re: /^eu-isoe-\w+-\d+$/, dnsSuffix: 'cloud.adc-e.uk' },
  { id: 'aws-iso-f', re: /^us-isof-\w+-\d+$/, dnsSuffix: 'csp.hci.ic.gov' },
  { id: 'aws-us-gov', re: /^us-gov-\w+-\d+$/, dnsSuffix: 'amazonaws.com' },
];

export function awsPartition(region: string): { id: string; dnsSuffix: string } {
  // us-gov, us-iso and us-isob must win over the generic `us-` rule.
  const ordered = [...AWS_PARTITIONS].sort((a, b) => (a.id === 'aws' ? 1 : 0) - (b.id === 'aws' ? 1 : 0));
  const p = ordered.find((x) => x.re.test(region));
  if (!p) throw new Error(`[lz live] aws: region ${region} matches no AWS partition`);
  return { id: p.id, dnsSuffix: p.dnsSuffix };
}

/**
 * Request URL and signing region of one API in one region. `account` names the
 * account of an S3 Control request (its host is `<account>.s3-control.<region>.<dnsSuffix>`).
 */
export function awsEndpoint(ctx: ScopeCtx, api: AwsApi, region: string, account?: string): { base: string; signingRegion: string } {
  const def: AwsServiceDef = AWS_SERVICES[api];
  const base = trimTrailingSlashes(ctx.http.baseUrls[api] ?? AWS_DEFAULT_BASE_URLS[api]);
  const overridden = isLoopbackHost(new URL(base).hostname);
  if (def.global) {
    const part = awsPartition(region);
    if (!overridden && part.id !== 'aws') throw new Error(`[lz live] aws: global API ${api} outside the aws partition (${part.id}) is not supported yet (Q-31)`);
    return { base, signingRegion: def.global.signingRegion };
  }
  if (overridden) return { base, signingRegion: region };
  if (api === 's3control') {
    if (!account || !/^\d{12}$/.test(account)) throw new Error('[lz live] aws: an S3 Control request needs the 12-digit account id');
    return { base: `https://${account}.${def.endpointPrefix}.${region}.${awsPartition(region).dnsSuffix}`, signingRegion: region };
  }
  return { base: `https://${def.endpointPrefix}.${region}.${awsPartition(region).dnsSuffix}`, signingRegion: region };
}

const SIGV4_SCOPE = /Credential=[^/,\s]+\/\d{8}\/([a-z0-9-]+)\/[a-z0-9-]+\/aws4_request/;
const REGIONAL_HOST = /^[a-z0-9-]+\.([a-z]{2}(?:-[a-z]+)+-\d+)\./;

/**
 * #3716: signing region of one AWS request for the recorder, from the SigV4
 * credential scope of the `authorization` header (exact, also for loopback
 * mock endpoints and global APIs, which sign for us-east-1), else from a
 * regional host name; null otherwise. Only the region is returned, never the
 * header or the key id in it.
 */
export function awsRegionOf(url: string, init?: { headers?: Record<string, string> }): string | null {
  const auth = Object.entries(init?.headers ?? {}).find(([k]) => k.toLowerCase() === 'authorization')?.[1];
  const scoped = auth !== undefined ? SIGV4_SCOPE.exec(auth) : null;
  if (scoped) return scoped[1] as string;
  try {
    return REGIONAL_HOST.exec(new URL(url).hostname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Operation names this driver may call: read verbs plus the two read-only probes. */
export const AWS_READ_OPERATION = /^(Describe|List|Get|Lookup)[A-Z]\w*$|^SimulatePrincipalPolicy$/;

export class AwsApiError extends Error {
  constructor(readonly api: string, readonly operation: string, readonly status: number, readonly code: string | undefined) {
    super(`[lz live] aws ${api} ${operation}: HTTP ${status}${code ? ` (${code})` : ''}`);
    this.name = 'AwsApiError';
  }
}

/** Operation of a request: `Action` query or form parameter, `X-Amz-Target` suffix, or null (REST GET). */
export function awsOperationOf(url: string, init?: { headers?: Record<string, string>; body?: string }): string | null {
  const target = Object.entries(init?.headers ?? {}).find(([k]) => k.toLowerCase() === 'x-amz-target')?.[1];
  if (target !== undefined) return target.slice(target.lastIndexOf('.') + 1);
  const q = new URL(url).searchParams.get('Action');
  if (q !== null) return q;
  if (init?.body && /(^|&)Action=/.test(init.body)) return new URLSearchParams(init.body).get('Action');
  return null;
}

/**
 * Second read-only layer for AWS (see header). REST GETs carry no operation
 * name and are left to the HTTP allow-list; any request that names an
 * operation must name a read operation.
 */
export function awsActionGuard(inner: FetchLike): FetchLike {
  return async (url, init) => {
    const op = awsOperationOf(url, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && op === null) {
      throw new ReadOnlyViolationError(AWS_PROVIDER, method, new URL(url).pathname, 'an AWS request without an operation name is not a read');
    }
    if (op !== null && !AWS_READ_OPERATION.test(op)) {
      throw new ReadOnlyViolationError(AWS_PROVIDER, method, new URL(url).pathname, `AWS operation ${op} is not a read operation`);
    }
    return inner(url, init);
  };
}

const guarded = new WeakMap<ScopeCtx, FetchLike>();
function fetchOf(ctx: ScopeCtx): FetchLike {
  let f = guarded.get(ctx);
  if (!f) {
    f = awsActionGuard(ctx.http.fetch);
    guarded.set(ctx, f);
  }
  return f;
}

function creds(ctx: ScopeCtx): { accessKeyId: string; secretAccessKey: string; sessionToken?: string } {
  const accessKeyId = ctx.credentials['access-key-id'];
  const secretAccessKey = ctx.credentials['secret-access-key'];
  if (!accessKeyId || !secretAccessKey) throw new LiveAuthError(AWS_PROVIDER, 401, 'no access-key-id / secret-access-key in the vault for this scope');
  const sessionToken = ctx.credentials['session-token'];
  return { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) };
}

// #3935: S3 answers an unknown or expired key with InvalidAccessKeyId / ExpiredToken (403).
const AUTH_CODES = new Set(['InvalidAccessKeyId', 'ExpiredToken', 'ExpiredTokenException', 'InvalidClientTokenId', 'UnrecognizedClientException', 'SignatureDoesNotMatch', 'InvalidSignatureException', 'AuthFailure', 'IncompleteSignature']);

function jsonErrorCode(text: string, res: LiveResponse): string | undefined {
  const h = res.headers.get('x-amzn-errortype');
  if (h) return h.split(':')[0];
  try {
    const j = JSON.parse(text) as { __type?: string; code?: string };
    const t = j.__type ?? j.code;
    return t ? t.slice(t.lastIndexOf('#') + 1) : undefined;
  } catch {
    return undefined;
  }
}

/** Throttling codes of the AWS APIs (CloudTrail LookupEvents allows about 2 calls a second). */
export const AWS_THROTTLE_CODES = new Set(['ThrottlingException', 'Throttling', 'RequestLimitExceeded', 'TooManyRequestsException', 'RequestThrottled', 'RequestThrottledException', 'SlowDown']);
export const AWS_MAX_RETRIES = 5;

let retryDelayMs = (attempt: number): number => 400 * 2 ** attempt;
/** Test seam: replace the backoff (milliseconds per retry attempt). */
export function setAwsRetryDelayForTests(fn: ((attempt: number) => number) | undefined): void {
  retryDelayMs = fn ?? ((attempt: number) => 400 * 2 ** attempt);
}

export function awsErrorCode(text: string, res: LiveResponse): string | undefined {
  const xml = /<Code>([^<]+)<\/Code>/.exec(text);
  return xml ? (xml[1] as string).trim() : jsonErrorCode(text, res);
}

async function send(ctx: ScopeCtx, api: AwsApi, operation: string, region: string, method: 'GET' | 'POST', url: URL, headers: Record<string, string>, body: string | undefined, account?: string): Promise<{ text: string; res: LiveResponse }> {
  if (!AWS_READ_OPERATION.test(operation)) throw new ReadOnlyViolationError(AWS_PROVIDER, method, url.pathname, `AWS operation ${operation} is not a read operation`);
  const { signingRegion } = awsEndpoint(ctx, api, region, account);
  for (let attempt = 0; ; attempt++) {
    // Signed per attempt: X-Amz-Date is part of the signature.
    const signed = signAwsV4({ method, url, region: signingRegion, service: AWS_SERVICES[api].signingName, ...creds(ctx), headers, ...(body !== undefined ? { body } : {}) });
    delete signed.host;
    const res = await fetchOf(ctx)(url.toString(), { method, headers: signed, ...(body !== undefined ? { body } : {}) });
    const text = await res.text();
    const throttled = !res.ok && (res.status === 429 || AWS_THROTTLE_CODES.has(awsErrorCode(text, res) ?? ''));
    if (!throttled || attempt >= AWS_MAX_RETRIES) return { text, res };
    await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
  }
}

function fail(api: AwsApi, operation: string, status: number, code: string | undefined): never {
  if (status === 401 || (code !== undefined && AUTH_CODES.has(code))) {
    throw new LiveAuthError(AWS_PROVIDER, status, `${code ?? 'unauthorised'} on ${api} ${operation}; refresh the login (AWS SSO: swao lz credentials refresh <lz-id> <scope-id>, or aws sso login and store the new keys with swao lz connect or swao credential set)`);
  }
  throw new AwsApiError(api, operation, status, code);
}

/** AWS Query / EC2 protocol, sent as a signed GET (all parameters in the query string). */
export async function awsQuery(ctx: ScopeCtx, api: AwsApi, operation: string, region: string, params: Record<string, string> = {}): Promise<XmlNode> {
  const def = AWS_SERVICES[api];
  if (def.protocol !== 'query' && def.protocol !== 'ec2') throw new Error(`[lz live] aws ${api} is not a Query API`);
  const url = new URL(`${awsEndpoint(ctx, api, region).base}/`);
  url.searchParams.set('Action', operation);
  url.searchParams.set('Version', def.apiVersion);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const { text, res } = await send(ctx, api, operation, region, 'GET', url, {}, undefined);
  let doc: XmlNode | undefined;
  try { doc = parseXml(text); } catch { doc = undefined; }
  if (!res.ok) fail(api, operation, res.status, doc ? xmlErrorCode(doc) : undefined);
  if (!doc) throw new AwsApiError(api, operation, res.status, 'BodyIsNotXml');
  return doc;
}

/** AWS JSON protocol: POST `/` with `X-Amz-Target`. */
export async function awsJson<T>(ctx: ScopeCtx, api: AwsApi, operation: string, region: string, input: Record<string, unknown> = {}): Promise<T> {
  const def: AwsServiceDef = AWS_SERVICES[api];
  if (def.protocol !== 'json' || !def.targetPrefix) throw new Error(`[lz live] aws ${api} is not a JSON-protocol API`);
  const url = new URL(`${awsEndpoint(ctx, api, region).base}/`);
  const body = JSON.stringify(input);
  const { text, res } = await send(ctx, api, operation, region, 'POST', url, { 'content-type': `application/x-amz-json-${def.jsonVersion ?? '1.1'}`, 'x-amz-target': `${def.targetPrefix}.${operation}` }, body);
  if (!res.ok) fail(api, operation, res.status, jsonErrorCode(text, res));
  try {
    return (text === '' ? {} : JSON.parse(text)) as T;
  } catch {
    throw new AwsApiError(api, operation, res.status, 'BodyIsNotJson');
  }
}

/** AWS REST-JSON protocol, GET only (EKS, Backup). */
export async function awsRestGet<T>(ctx: ScopeCtx, api: AwsApi, operation: string, region: string, path: string, query: Record<string, string> = {}): Promise<T> {
  const def: AwsServiceDef = AWS_SERVICES[api];
  if (def.protocol !== 'rest-json') throw new Error(`[lz live] aws ${api} is not a REST-JSON API`);
  const url = new URL(`${awsEndpoint(ctx, api, region).base}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const { text, res } = await send(ctx, api, operation, region, 'GET', url, {}, undefined);
  if (!res.ok) fail(api, operation, res.status, jsonErrorCode(text, res));
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AwsApiError(api, operation, res.status, 'BodyIsNotJson');
  }
}

/** SHA-256 of the empty payload: S3 SigV4 requires `x-amz-content-sha256` on every request (S3 API Reference, "Authenticating Requests"). */
export const S3_EMPTY_PAYLOAD_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** Answer of an S3 read: the XML document, or the S3 error code of a 404 that means "not configured". */
export type AwsRestXmlAnswer = { doc: XmlNode; absent?: undefined } | { doc?: undefined; absent: string };

/**
 * #3935: AWS REST-XML protocol (S3, S3 Control), GET only. `path` is the
 * path-style resource (`/<bucket>`), `query` the subresource (`{ encryption: '' }`).
 * Read operations only (the operation name is checked like every other call;
 * the HTTP allow-list admits GET only for it). A 404 whose code is listed in
 * `absentCodes` (for example NoSuchLifecycleConfiguration) is an answer: the
 * configuration does not exist. Every other non-2xx answer throws.
 */
export async function awsRestXmlGet(ctx: ScopeCtx, api: 's3' | 's3control', operation: string, region: string, path: string, query: Record<string, string> = {}, opts: { absentCodes?: readonly string[]; headers?: Record<string, string>; account?: string } = {}): Promise<AwsRestXmlAnswer> {
  const def: AwsServiceDef = AWS_SERVICES[api];
  if (def.protocol !== 'rest-xml') throw new Error(`[lz live] aws ${api} is not a REST-XML API`);
  const url = new URL(`${awsEndpoint(ctx, api, region, opts.account).base}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const { text, res } = await send(ctx, api, operation, region, 'GET', url, { 'x-amz-content-sha256': S3_EMPTY_PAYLOAD_SHA256, ...(opts.headers ?? {}) }, undefined, opts.account);
  let doc: XmlNode | undefined;
  try { doc = text.trim() === '' ? undefined : parseXml(text); } catch { doc = undefined; }
  if (!res.ok) {
    const code = doc ? xmlErrorCode(doc) : undefined;
    if (res.status === 404 && code !== undefined && (opts.absentCodes ?? []).includes(code)) return { absent: code };
    fail(api, operation, res.status, code);
  }
  if (!doc) throw new AwsApiError(api, operation, res.status, 'BodyIsNotXml');
  return { doc };
}
