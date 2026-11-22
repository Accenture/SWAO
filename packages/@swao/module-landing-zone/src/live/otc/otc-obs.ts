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

// #3951 (Design 123 section 5.4, OTC table): OBS bucket reads for the posture.
// OBS accepts AK/SK signatures only, no IAM token (OBS API reference, "User
// Signature Authentication": "A user can obtain the AK and SK from IAM").
// Sources, opentelekomcloud-docs/object-storage-service api-ref:
// - calling_apis/authentication/authentication_of_signature_in_a_header.rst:
//   StringToSign = verb, Content-MD5, Content-Type, Date, the `x-obs-*`
//   headers (lower-cased, sorted, `name:value\n`) and the canonical resource
//   (`/bucket/` plus the sub-resource, `?acl`); Date is empty when
//   `x-obs-date` is sent; signature = Base64(HMAC-SHA1(SK, StringToSign));
//   `Authorization: OBS <AK>:<signature>`; a temporary AK/SK sends its
//   security token as `x-obs-security-token`, which is signed;
// - calling_apis/constructing_a_request.rst: the bucket is in the host
//   (`https://bucket.obs.<region>...`); against a loopback mock endpoint the
//   bucket is the first path segment (path style), signed the same way;
// - apis/advanced_bucket_settings: `GET /?encryption` (404
//   NoSuchEncryptionConfiguration when none), `GET /?acl` (Grantee `Canned`
//   Everyone grants all users), `GET /?policy` (404 NoSuchBucketPolicy when
//   none; principal `{"ID": ["*"]}`), `GET /?lifecycle` (404
//   NoSuchLifecycleConfiguration when none).
// The AK/SK: the vault key of an `aksk` scope, else a temporary AK/SK issued
// from the login's token (IAM API reference, "Obtaining a Temporary AK/SK",
// `POST /v3.0/OS-CREDENTIAL/securitytokens`, token method, 900 s, held in
// memory only; record.ts redacts it). The AK, SK, security token and
// signature are never logged or recorded.

import { createHmac } from 'node:crypto';
import type { ScopeCtx } from '../types.js';
import { LiveAuthError } from '../errors.js';
import { OTC_PROVIDER, OtcHttpError, iamBase, otcDomainToken, otcEndpoint } from './otc-client.js';
import type { OtcToken } from './otc-client.js';
import { isLoopbackHost } from '../endpoints.js';

export const OBS_ROUTE = '/{bucket}';
export const OTC_SECURITY_TOKENS_ROUTE = '/v3.0/OS-CREDENTIAL/securitytokens';
/** Lifetime of the temporary AK/SK in seconds (the IAM minimum). */
export const OBS_TEMPORARY_KEY_SECONDS = 900;

export interface ObsCredential {
  accessKey: string;
  secretKey: string;
  securityToken?: string;
}

/** Sub-resources the posture reads (documented OBS sub-resources). */
export type ObsSubresource = 'acl' | 'encryption' | 'lifecycle' | 'policy';

export interface ObsSignInput {
  method: string;
  bucket: string;
  subresource: ObsSubresource;
  /** `x-obs-*` headers to send (signed). */
  obsHeaders: Record<string, string>;
  accessKey: string;
  secretKey: string;
}

/** The OBS header signature (`Authorization: OBS AK:Base64(HMAC-SHA1)`) and its string to sign (tests only). */
export function signObsRequest(i: ObsSignInput): { authorization: string; stringToSign: string } {
  const names = Object.keys(i.obsHeaders).map((n) => n.toLowerCase()).filter((n) => n.startsWith('x-obs-')).sort();
  const value = (n: string): string => {
    const k = Object.keys(i.obsHeaders).find((h) => h.toLowerCase() === n) as string;
    return String(i.obsHeaders[k]).trim().replace(/\s+/g, ' ');
  };
  const canonicalHeaders = names.map((n) => `${n}:${value(n)}\n`).join('');
  const resource = `/${i.bucket}/?${i.subresource}`;
  const stringToSign = `${i.method.toUpperCase()}\n\n\n\n${canonicalHeaders}${resource}`;
  const signature = createHmac('sha1', i.secretKey).update(stringToSign, 'utf-8').digest('base64');
  return { authorization: `OBS ${i.accessKey}:${signature}`, stringToSign };
}

/** URL of a bucket sub-resource: virtual-hosted on a real endpoint, path style on a loopback mock. */
export function obsUrl(endpoint: string, bucket: string, subresource: ObsSubresource): string {
  const u = new URL(endpoint);
  if (isLoopbackHost(u.hostname)) return `${u.origin}/${encodeURIComponent(bucket)}?${subresource}`;
  return `${u.protocol}//${bucket}.${u.host}/?${subresource}`;
}

const credentials = new WeakMap<ScopeCtx, Promise<ObsCredential>>();

async function issueTemporaryKey(ctx: ScopeCtx): Promise<ObsCredential> {
  const token = await otcDomainToken(ctx);
  const res = await ctx.http.fetch(`${new URL(iamBase(ctx)).origin}${OTC_SECURITY_TOKENS_ROUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json;charset=utf8', 'x-auth-token': token.value },
    body: JSON.stringify({ auth: { identity: { methods: ['token'], token: { duration_seconds: OBS_TEMPORARY_KEY_SECONDS } } } }),
  });
  const text = await res.text();
  if (!res.ok) throw new OtcHttpError(res.status, OTC_SECURITY_TOKENS_ROUTE);
  let c: { credential?: { access?: unknown; secret?: unknown; securitytoken?: unknown } };
  try {
    c = JSON.parse(text) as typeof c;
  } catch {
    throw new OtcHttpError(res.status, `${OTC_SECURITY_TOKENS_ROUTE} (body is not JSON)`);
  }
  const k = c.credential ?? {};
  if (typeof k.access !== 'string' || typeof k.secret !== 'string' || typeof k.securitytoken !== 'string' || k.access === '' || k.secret === '') {
    throw new OtcHttpError(res.status, `${OTC_SECURITY_TOKENS_ROUTE} (no temporary AK/SK in the answer)`);
  }
  return { accessKey: k.access, secretKey: k.secret, securityToken: k.securitytoken };
}

/**
 * The AK/SK that signs the OBS reads of a scope run: the vault key of an
 * `aksk` scope, else one temporary key issued from the login's domain token
 * (cached for the run, never stored).
 */
export function obsCredential(ctx: ScopeCtx): Promise<ObsCredential> {
  let p = credentials.get(ctx);
  if (!p) {
    p = (async (): Promise<ObsCredential> => {
      if (ctx.auth === 'aksk') {
        const accessKey = ctx.credentials['access-key-id'];
        const secretKey = ctx.credentials['secret-access-key'];
        if (!accessKey || !secretKey) throw new LiveAuthError(OTC_PROVIDER, 401, 'the aksk method needs the vault fields access-key-id and secret-access-key');
        const securityToken = ctx.credentials['session-token'];
        return { accessKey, secretKey, ...(securityToken ? { securityToken } : {}) };
      }
      return issueTemporaryKey(ctx);
    })();
    credentials.set(ctx, p);
    // A refused key stays refused for the scope run: the request is sent once, never per bucket.
    p.catch(() => undefined);
  }
  return p;
}

/** One OBS answer: the body of a 2xx, or the status and the OBS error `Code`. */
export type ObsAnswer = { ok: true; body: string } | { ok: false; status: number; code?: string };

const xmlCode = (body: string): string | undefined => /<Code>([^<]{1,100})<\/Code>/.exec(body)?.[1];

/** GET one sub-resource of a bucket in `region`, signed with the scope's AK/SK. */
export async function obsGet(ctx: ScopeCtx, token: OtcToken, region: string, bucket: string, subresource: ObsSubresource): Promise<ObsAnswer> {
  const endpoint = otcEndpoint(token, ['object'], region);
  if (endpoint === undefined) throw new OtcHttpError(404, `${OBS_ROUTE} (no object endpoint in the token catalogue of ${region})`);
  const cred = await obsCredential(ctx);
  const obsHeaders: Record<string, string> = {
    'x-obs-date': new Date().toUTCString(),
    ...(cred.securityToken ? { 'x-obs-security-token': cred.securityToken } : {}),
  };
  const { authorization } = signObsRequest({ method: 'GET', bucket, subresource, obsHeaders, accessKey: cred.accessKey, secretKey: cred.secretKey });
  const res = await ctx.http.fetch(obsUrl(endpoint, bucket, subresource), { method: 'GET', headers: { ...obsHeaders, authorization } });
  const body = await res.text();
  if (res.ok) return { ok: true, body };
  const code = xmlCode(body);
  return { ok: false, status: res.status, ...(code ? { code } : {}) };
}

/** OBS "not configured" answers: the read is answered and the setting is absent. */
export const OBS_NOT_CONFIGURED: Readonly<Record<ObsSubresource, string | undefined>> = {
  encryption: 'NoSuchEncryptionConfiguration',
  lifecycle: 'NoSuchLifecycleConfiguration',
  policy: 'NoSuchBucketPolicy',
  acl: undefined,
};

/** The answered document of a read (`null` = answered, not configured), or the error for a refused read. */
export function obsDocument(sub: ObsSubresource, a: ObsAnswer): string | null | OtcHttpError {
  if (a.ok) return a.body;
  if (a.status === 404 && a.code !== undefined && a.code === OBS_NOT_CONFIGURED[sub]) return null;
  return new OtcHttpError(a.status, `${OBS_ROUTE}?${sub}${a.code ? ` (${a.code})` : ''}`);
}

// ---------------------------------------------------------------------------
// Mappings (pure)
// ---------------------------------------------------------------------------

const tagValues = (xml: string, tag: string): string[] => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => (m[1] ?? '').trim());
const firstTag = (xml: string, tag: string): string | undefined => tagValues(xml, tag)[0];

/** Default bucket encryption: SSE-KMS with its key, or none (`null`, NoSuchEncryptionConfiguration). */
export function obsEncryptionOf(xml: string | null): { encrypted: boolean; algorithm?: string; keyId?: string } {
  if (xml === null) return { encrypted: false };
  const algorithm = firstTag(xml, 'SSEAlgorithm');
  const keyId = firstTag(xml, 'KMSMasterKeyID');
  return { encrypted: algorithm !== undefined && algorithm !== '', ...(algorithm ? { algorithm } : {}), ...(keyId ? { keyId } : {}) };
}

/** A bucket ACL grants all users access when a Grantee is `Canned` Everyone (OBS) or the AllUsers group URI (S3 compatible). */
export function obsAclPublic(xml: string): boolean {
  return tagValues(xml, 'Grantee').some((g) => /<Canned>\s*Everyone\s*<\/Canned>/.test(g) || /<URI>[^<]*\/AllUsers<\/URI>/.test(g));
}

const isWildcard = (v: unknown): boolean => v === '*' || (Array.isArray(v) && v.includes('*'));

/**
 * A bucket policy is public when an Allow statement without a Condition names
 * every principal: `"*"`, `{"ID": ["*"]}` (OBS) or `{"AWS": "*"}` (S3
 * compatible). A conditional wildcard (for example a Referer or source IP
 * condition) is not counted as public.
 */
export function obsPolicyPublic(json: string | null): boolean | undefined {
  if (json === null) return false;
  let doc: { Statement?: unknown };
  try {
    doc = JSON.parse(json) as typeof doc;
  } catch {
    return undefined;
  }
  const statements = Array.isArray(doc.Statement) ? doc.Statement : doc.Statement !== undefined ? [doc.Statement] : [];
  return statements.some((s) => {
    if (s === null || typeof s !== 'object') return false;
    const st = s as Record<string, unknown>;
    if (st['Effect'] !== 'Allow' || st['Condition'] !== undefined) return false;
    const p = st['Principal'];
    if (p === '*') return true;
    if (p === null || typeof p !== 'object') return false;
    const pr = p as Record<string, unknown>;
    return isWildcard(pr['ID']) || isWildcard(pr['AWS']);
  });
}

/**
 * Retention of the CTS trace files in their bucket from its lifecycle. CTS
 * writes `<file_prefix_name>/CloudTraces/...` (CTS API reference, tracker
 * `obs_info.file_prefix_name`). An enabled rule applies to every trace file
 * when its Prefix is a prefix of that key start; the shortest Expiration of
 * those rules deletes them. No applicable expiring rule (or no lifecycle at
 * all, `null`) keeps them without expiry.
 */
export function traceRetention(xml: string | null, filePrefix: string | undefined): { days?: number; neverExpires: boolean } {
  if (xml === null) return { neverExpires: true };
  const keyStart = `${filePrefix ? `${filePrefix}/` : ''}CloudTraces/`;
  let days: number | undefined;
  for (const rule of tagValues(xml, 'Rule')) {
    if (firstTag(rule, 'Status') !== 'Enabled') continue;
    const prefix = firstTag(rule, 'Prefix') ?? '';
    if (!keyStart.startsWith(prefix)) continue;
    const exp = firstTag(rule, 'Expiration');
    const d = exp === undefined ? undefined : Number(firstTag(exp, 'Days'));
    if (d !== undefined && Number.isInteger(d) && d >= 0) days = days === undefined ? d : Math.min(days, d);
  }
  return days === undefined ? { neverExpires: true } : { days, neverExpires: false };
}
