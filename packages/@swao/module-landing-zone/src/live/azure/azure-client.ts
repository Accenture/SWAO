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

// #3575: Azure token and ARM helpers of the `azure` driver (Design 120
// sections 7.1, 7.5; Design 121 section 7). There is no Azure access (Q-21),
// so every wire format comes from the published azure-rest-api-specs (the
// operations and api-versions the mock pack serves,
// swao/ops/mock-csp/providers/azure/spec.ts) and, for the Entra ID token
// endpoint that repository does not hold, from RFC 6749 / RFC 7523:
// - `POST {login}/{tenant}/oauth2/v2.0/token`, form body,
//   `grant_type=client_credentials`, `scope=https://management.azure.com/.default`,
//   client authentication by `client_id` + `client_secret` (RFC 6749
//   section 2.3.1) or by an RS256 `client_assertion` with `iss` = `sub` =
//   client id, `aud` = the token endpoint URL, `jti`, `nbf`, `exp`
//   (RFC 7523 section 3). When the vault field `client-certificate` also
//   holds the CERTIFICATE block, the JWS header carries `x5t` and `x5t#S256`
//   (RFC 7515 sections 4.1.7 and 4.1.8); whether Entra ID needs either is
//   open (Q-3600-2).
// - ARM `GET` with `Authorization: Bearer`, `api-version` per operation,
//   pageable lists followed over `nextLink` (refused when the link leaves
//   the ARM origin, so the token never goes elsewhere); Resource Graph
//   `POST /providers/Microsoft.ResourceGraph/resources` paged with
//   `options.$skipToken`.
// - 401 on ARM is a LiveAuthError: the run fails fast (Design 120 section
//   6.2). A 429 is retried by the shared transport rule (retry.ts, #3751;
//   the driver context of session.ts applies it to every driver), so a 429
//   that reaches this client has exhausted the retries; it and every other
//   error is an AzureHttpError for the caller to record as a source.
// The login host default is the authorization URL host of the ARM specs'
// `securityDefinitions` (`https://login.microsoftonline.com/common/oauth2/authorize`);
// the ARM host is the specs' `host`.

import { X509Certificate, createHash, createPrivateKey, createSign, randomUUID } from 'node:crypto';
import type { ScopeCtx } from '../types.js';
import { LiveAuthError } from '../errors.js';

export const AZURE_PROVIDER = 'azure';
export const AZURE_DEFAULT_LOGIN = 'https://login.microsoftonline.com';
export const AZURE_DEFAULT_ARM = 'https://management.azure.com';
export const AZURE_ARM_SCOPE = 'https://management.azure.com/.default';
export const AZURE_CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

/** api-version per served operation (the `info.version` of its spec file at the mock pack's pinned commit). */
export const AZURE_API_VERSIONS = {
  subscriptions: '2022-12-01',
  providers: '2025-04-01',
  resourceGraph: '2024-04-01',
  policy: '2025-03-01',
  authorization: '2022-04-01',
  // #3940: the only api-versions of SubscriptionDiagnosticSettings_List at the pinned commit are previews.
  diagnosticSettings: '2021-05-01-preview',
  budgets: '2026-06-01',
} as const;

const MAX_PAGES = 100;

export class AzureHttpError extends Error {
  constructor(readonly status: number, readonly route: string) {
    super(`[lz live] azure: HTTP ${status} on ${route}`);
    this.name = 'AzureHttpError';
  }
}

/** Drop trailing slashes in linear time. */
function trimSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) end--;
  return url.slice(0, end);
}

export function azureBase(ctx: ScopeCtx, api: 'login' | 'arm'): string {
  return trimSlashes(ctx.http.baseUrls[api] ?? (api === 'login' ? AZURE_DEFAULT_LOGIN : AZURE_DEFAULT_ARM));
}

const b64u = (b: string | Buffer): string => Buffer.from(b).toString('base64url');

/** PEM blocks of a vault value: the private key and, optionally, the certificate. */
export function splitPem(pem: string): { key?: string; cert?: string } {
  const block = (label: RegExp): string | undefined => {
    const m = new RegExp(`-----BEGIN (${label.source})-----[\\s\\S]*?-----END \\1-----`).exec(pem);
    return m?.[0];
  };
  const key = block(/(?:RSA |ENCRYPTED )?PRIVATE KEY/);
  const cert = block(/CERTIFICATE/);
  return { ...(key ? { key } : {}), ...(cert ? { cert } : {}) };
}

/** RS256 client assertion of RFC 7523 section 3 (exported for the tests). */
export function buildClientAssertion(clientId: string, tokenUrl: string, pem: string, nowSec: number = Math.floor(Date.now() / 1000), jti: string = randomUUID()): string {
  const { key, cert } = splitPem(pem);
  if (key === undefined) throw new LiveAuthError(AZURE_PROVIDER, 401, 'the vault field client-certificate holds no PEM private key');
  const header: Record<string, string> = { alg: 'RS256', typ: 'JWT' };
  if (cert !== undefined) {
    const raw = new X509Certificate(cert).raw;
    header['x5t'] = b64u(createHash('sha1').update(raw).digest());
    header['x5t#S256'] = b64u(createHash('sha256').update(raw).digest());
  }
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify({ iss: clientId, sub: clientId, aud: tokenUrl, jti, nbf: nowSec, iat: nowSec, exp: nowSec + 600 }))}`;
  let sig: string;
  try {
    sig = createSign('RSA-SHA256').update(input).sign(createPrivateKey(key)).toString('base64url');
  } catch {
    throw new LiveAuthError(AZURE_PROVIDER, 401, 'the client-certificate private key cannot sign the client assertion (not an RSA private key)');
  }
  return `${input}.${sig}`;
}

/** Payload claims of a JWT (unverified; the driver reads `oid` for the probe only). */
export function jwtClaims(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (part === undefined) return {};
  try {
    const v = JSON.parse(Buffer.from(part, 'base64url').toString('utf-8')) as unknown;
    return v !== null && typeof v === 'object' ? v as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function oauthMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: unknown; error_description?: unknown };
    const parts = [j.error, j.error_description].filter((x): x is string => typeof x === 'string' && x !== '');
    if (parts.length > 0) return parts.join(': ').slice(0, 200);
  } catch {
    // not JSON
  }
  return 'no error message';
}

export interface AzureToken {
  value: string;
  /** Object id of the service principal (`oid` claim), for the role assignment filter. */
  objectId?: string;
}

const tokens = new WeakMap<ScopeCtx, Promise<AzureToken>>();

async function requestToken(ctx: ScopeCtx): Promise<AzureToken> {
  const tenant = ctx.credentials['tenant-id'];
  const clientId = ctx.credentials['client-id'];
  if (!tenant || !clientId) throw new LiveAuthError(AZURE_PROVIDER, 401, 'the service principal needs the vault fields tenant-id and client-id');
  const tokenUrl = `${azureBase(ctx, 'login')}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
  const form: Record<string, string> = { grant_type: 'client_credentials', client_id: clientId, scope: AZURE_ARM_SCOPE };
  if (ctx.auth === 'service-principal-certificate') {
    const pem = ctx.credentials['client-certificate'];
    if (!pem) throw new LiveAuthError(AZURE_PROVIDER, 401, 'the certificate method needs the vault field client-certificate (PEM private key)');
    form['client_assertion_type'] = AZURE_CLIENT_ASSERTION_TYPE;
    form['client_assertion'] = buildClientAssertion(clientId, tokenUrl, pem);
  } else {
    const secret = ctx.credentials['client-secret'];
    if (!secret) throw new LiveAuthError(AZURE_PROVIDER, 401, 'the secret method needs the vault field client-secret');
    form['client_secret'] = secret;
  }
  const res = await ctx.http.fetch(tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(form).toString() });
  const text = await res.text();
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new LiveAuthError(AZURE_PROVIDER, res.status, oauthMessage(text));
  if (!res.ok) throw new AzureHttpError(res.status, '/{tenant}/oauth2/v2.0/token');
  let j: { access_token?: unknown; token_type?: unknown };
  try {
    j = JSON.parse(text) as typeof j;
  } catch {
    throw new AzureHttpError(res.status, '/{tenant}/oauth2/v2.0/token (body is not JSON)');
  }
  if (typeof j.access_token !== 'string' || j.access_token === '') throw new LiveAuthError(AZURE_PROVIDER, res.status, 'the token response carries no access_token');
  const oid = jwtClaims(j.access_token)['oid'];
  return { value: j.access_token, ...(typeof oid === 'string' && oid !== '' ? { objectId: oid } : {}) };
}

/** One token per scope run. */
export function azureToken(ctx: ScopeCtx): Promise<AzureToken> {
  let p = tokens.get(ctx);
  if (!p) {
    p = requestToken(ctx);
    tokens.set(ctx, p);
    p.catch(() => tokens.delete(ctx));
  }
  return p;
}

/** Subscription of the scope (`.swao.yml` `scopes[].target.subscription`). */
export function azureSubscription(ctx: ScopeCtx): string {
  const s = ctx.target['subscription'];
  if (s === undefined || s === '') throw new LiveAuthError(AZURE_PROVIDER, 400, 'no subscription: set scopes[].target.subscription in .swao.yml');
  return s;
}


async function send(ctx: ScopeCtx, url: string, route: string, init: { method: string; body?: string }): Promise<unknown> {
  const t = await azureToken(ctx);
  const res = await ctx.http.fetch(url, {
    method: init.method,
    headers: { authorization: `Bearer ${t.value}`, accept: 'application/json', ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
  const text = await res.text();
  if (res.status === 401) throw new LiveAuthError(AZURE_PROVIDER, 401, `ARM refused the access token on ${route}`);
  if (!res.ok) throw new AzureHttpError(res.status, route);
  try {
    return JSON.parse(text === '' ? '{}' : text) as unknown;
  } catch {
    throw new AzureHttpError(res.status, `${route} (body is not JSON)`);
  }
}

function armUrl(ctx: ScopeCtx, path: string, apiVersion: string, query: Record<string, string> = {}): string {
  const q = new URLSearchParams({ 'api-version': apiVersion, ...query });
  return `${azureBase(ctx, 'arm')}${path}?${q.toString()}`;
}

/** GET one ARM document. */
export async function armGet<T>(ctx: ScopeCtx, path: string, route: string, apiVersion: string, query: Record<string, string> = {}): Promise<T> {
  return await send(ctx, armUrl(ctx, path, apiVersion, query), route, { method: 'GET' }) as T;
}

/** GET every page of an ARM `{ value, nextLink }` list; a nextLink off the ARM origin is refused. */
export async function armList<T>(ctx: ScopeCtx, path: string, route: string, apiVersion: string, query: Record<string, string> = {}): Promise<T[]> {
  const origin = new URL(azureBase(ctx, 'arm')).origin;
  const out: T[] = [];
  let url: string | undefined = armUrl(ctx, path, apiVersion, query);
  for (let page = 0; url !== undefined && page < MAX_PAGES; page++) {
    const doc = await send(ctx, url, route, { method: 'GET' }) as { value?: T[]; nextLink?: unknown };
    out.push(...(doc.value ?? []));
    if (typeof doc.nextLink !== 'string' || doc.nextLink === '') return out;
    if (new URL(doc.nextLink).origin !== origin) throw new AzureHttpError(0, `${route} (nextLink leaves the ARM origin; refused)`);
    url = doc.nextLink;
  }
  if (url !== undefined) throw new AzureHttpError(0, `${route} (stopped after ${MAX_PAGES} pages)`);
  return out;
}

export const RESOURCE_GRAPH_PATH = '/providers/Microsoft.ResourceGraph/resources';

/**
 * Resource Graph query (objectArray rows), every page over `$skipToken`.
 * `subscriptions` undefined is the tenant scope (#3884: the platform
 * hierarchy query, which also returns the management groups).
 */
export async function resourceGraph<T>(ctx: ScopeCtx, query: string, subscriptions: readonly string[] | undefined): Promise<T[]> {
  const url = armUrl(ctx, RESOURCE_GRAPH_PATH, AZURE_API_VERSIONS.resourceGraph);
  const out: T[] = [];
  let skip: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = { query, ...(subscriptions !== undefined ? { subscriptions: [...subscriptions] } : {}), options: { $top: 1000, resultFormat: 'objectArray', ...(skip ? { $skipToken: skip } : {}) } };
    const doc = await send(ctx, url, RESOURCE_GRAPH_PATH, { method: 'POST', body: JSON.stringify(body) }) as { data?: T[]; $skipToken?: unknown };
    out.push(...(doc.data ?? []));
    skip = typeof doc.$skipToken === 'string' && doc.$skipToken !== '' ? doc.$skipToken : undefined;
    if (skip === undefined) return out;
  }
  throw new AzureHttpError(0, `${RESOURCE_GRAPH_PATH} (stopped after ${MAX_PAGES} pages)`);
}
