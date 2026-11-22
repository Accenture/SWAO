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

// #3576: STACKIT Key Flow token and JSON GET helpers (Design 120 section 7.5
// `key-flow`, 056 section 3: Token Flow removed 2025-12-17). Wire format from
// docs.stackit.cloud "Acquire short lived access tokens": a JWT signed RS512
// with the service account private key, header `kid`, claims `iss`, `sub`,
// `aud` (all from the portal's key JSON `credentials`), `jti` (UUIDv4,
// mandatory for STACKIT), `iat`, `exp` = iat + 600; POSTed as form
// `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>` to
// `https://accounts.stackit.cloud/oauth/v2/token`. Verified live 2026-11-03:
// HTTP 200, `token_type` Bearer, `expires_in` 899, and an access token whose
// payload carries the claim `stackit/project/project.id`.
//
// The token endpoint is the driver default `token` (overridable for loopback
// mocks only, endpoints.ts); the key's own `tokenEndpoint` field is never
// used as a request target, so a key file cannot redirect the secret.

import { createSign, randomUUID } from 'node:crypto';
import type { ScopeCtx } from '../types.js';
import { LiveAuthError } from '../errors.js';

export const STACKIT_PROVIDER = 'stackit';
export const STACKIT_DEFAULT_TOKEN = 'https://accounts.stackit.cloud';
export const STACKIT_TOKEN_PATH = '/oauth/v2/token';
export const STACKIT_PROJECT_CLAIM = 'stackit/project/project.id';

export interface StackitKeyCredentials {
  kid: string;
  iss: string;
  sub: string;
  aud: string;
  privateKey: string;
}

export interface StackitToken {
  value: string;
  /** Service account e-mail (`iss` of the key); used for the own-permission query, never logged. */
  email: string;
  /** Project the token is bound to (`stackit/project/project.id`), when present. */
  projectId?: string;
}

export class StackitHttpError extends Error {
  /**
   * #3955: the error text of the body (`message`, `msg` or `error`, at most
   * 200 characters), so a caller can tell a documented answer such as
   * "Service not enabled" from a refusal. Not part of the error message.
   */
  detail?: string;
  constructor(readonly status: number, readonly route: string) {
    super(`[lz live] stackit: HTTP ${status} on ${route}`);
    this.name = 'StackitHttpError';
  }
}

/** Drop trailing slashes in linear time (a `/\/+$/` replace is polynomial on long runs of '/'). */
export function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) end--;
  return url.slice(0, end);
}

export function stackitBase(ctx: ScopeCtx, api: string, fallback: string): string {
  return trimTrailingSlashes(ctx.http.baseUrls[api] ?? fallback);
}

const KEY_FIELDS = ['kid', 'iss', 'sub', 'aud', 'privateKey'] as const;

/** Parse the vault field `service-account-key` (the portal's key JSON); errors name fields, never values. */
export function parseStackitKey(raw: string | undefined): StackitKeyCredentials {
  if (raw === undefined || raw === '') {
    throw new LiveAuthError(STACKIT_PROVIDER, 401, 'the key-flow method needs the vault field service-account-key (the service account key JSON)');
  }
  let doc: { credentials?: Record<string, unknown> };
  try {
    doc = JSON.parse(raw) as typeof doc;
  } catch {
    throw new LiveAuthError(STACKIT_PROVIDER, 401, 'the vault field service-account-key is not valid JSON');
  }
  const c = doc.credentials ?? {};
  const missing = KEY_FIELDS.filter((f) => typeof c[f] !== 'string' || c[f] === '');
  if (missing.length > 0) {
    throw new LiveAuthError(STACKIT_PROVIDER, 401, `the service account key lacks credentials.${missing.join(', credentials.')}`);
  }
  return { kid: c['kid'] as string, iss: c['iss'] as string, sub: c['sub'] as string, aud: c['aud'] as string, privateKey: c['privateKey'] as string };
}

const b64u = (s: string | Buffer): string => Buffer.from(s).toString('base64url');

/** RS512 JWT assertion of the Key Flow (exported for the contract tests). */
export function buildAssertion(key: StackitKeyCredentials, nowSec: number = Math.floor(Date.now() / 1000), jti: string = randomUUID()): string {
  const header = b64u(JSON.stringify({ alg: 'RS512', typ: 'JWT', kid: key.kid }));
  const claims = b64u(JSON.stringify({ iss: key.iss, sub: key.sub, aud: key.aud, jti, iat: nowSec, exp: nowSec + 600 }));
  let sig: string;
  try {
    sig = createSign('RSA-SHA512').update(`${header}.${claims}`).sign(key.privateKey).toString('base64url');
  } catch {
    throw new LiveAuthError(STACKIT_PROVIDER, 401, 'the service account private key cannot sign the Key Flow assertion (not an RSA private key)');
  }
  return `${header}.${claims}.${sig}`;
}

/** Payload claims of a JWT access token (unverified; used for the project id only). */
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

function errorMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { error_description?: unknown; message?: unknown; error?: unknown };
    const m = j.error_description ?? j.message ?? j.error;
    if (typeof m === 'string' && m !== '') return m.slice(0, 200);
  } catch {
    // not JSON
  }
  return 'no error message';
}

/**
 * #3955: the error text of a service answer (`message`, iaas `msg`, `error`),
 * else undefined. #3970: the object storage v2 `ErrorMessage` is
 * `{detail: [{key, msg}]}`; its first `key` (for example `project.not_found`)
 * is the detail.
 */
export function bodyDetail(body: string): string | undefined {
  try {
    const j = JSON.parse(body) as { message?: unknown; msg?: unknown; error?: unknown; detail?: unknown };
    const first = Array.isArray(j.detail) ? (j.detail[0] as { key?: unknown } | undefined) : undefined;
    const m = j.message ?? j.msg ?? j.error ?? (first !== null && typeof first === 'object' ? first.key : undefined);
    return typeof m === 'string' && m !== '' ? m.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

const tokens = new WeakMap<ScopeCtx, Promise<StackitToken>>();

async function requestToken(ctx: ScopeCtx): Promise<StackitToken> {
  const key = parseStackitKey(ctx.credentials['service-account-key']);
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: buildAssertion(key) }).toString();
  const res = await ctx.http.fetch(`${stackitBase(ctx, 'token', STACKIT_DEFAULT_TOKEN)}${STACKIT_TOKEN_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  const text = await res.text();
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new LiveAuthError(STACKIT_PROVIDER, res.status, `${errorMessage(text)} (Key Flow; check that the key is active and not expired)`);
  }
  if (!res.ok) throw new StackitHttpError(res.status, STACKIT_TOKEN_PATH);
  let j: { access_token?: unknown };
  try {
    j = JSON.parse(text) as typeof j;
  } catch {
    throw new StackitHttpError(res.status, `${STACKIT_TOKEN_PATH} (body is not JSON)`);
  }
  if (typeof j.access_token !== 'string' || j.access_token === '') {
    throw new LiveAuthError(STACKIT_PROVIDER, res.status, 'the token response carries no access_token');
  }
  const projectClaim = jwtClaims(j.access_token)[STACKIT_PROJECT_CLAIM];
  return {
    value: j.access_token,
    email: key.iss,
    ...(typeof projectClaim === 'string' && projectClaim !== '' ? { projectId: projectClaim } : {}),
  };
}

/** One token per scope run (it lasts about 15 minutes, live 2026-11-03). */
export function stackitToken(ctx: ScopeCtx): Promise<StackitToken> {
  let p = tokens.get(ctx);
  if (!p) {
    p = requestToken(ctx);
    tokens.set(ctx, p);
    p.catch(() => tokens.delete(ctx));
  }
  return p;
}

/** Project of the scope: the `.swao.yml` target, else the project the token is bound to. */
export async function stackitProject(ctx: ScopeCtx): Promise<string> {
  const target = ctx.target['project'];
  if (target !== undefined && target !== '') return target;
  const t = await stackitToken(ctx);
  if (t.projectId) return t.projectId;
  throw new LiveAuthError(STACKIT_PROVIDER, 401, 'no project: set scopes[].target.project in .swao.yml (the token is not bound to a project)');
}

/** GET a JSON document with the bearer token; non-2xx throws StackitHttpError. */
export async function stackitGet<T>(ctx: ScopeCtx, url: string, route: string): Promise<T> {
  const t = await stackitToken(ctx);
  const res = await ctx.http.fetch(url, { method: 'GET', headers: { authorization: `Bearer ${t.value}`, accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) {
    const err = new StackitHttpError(res.status, route);
    const detail = bodyDetail(text);
    if (detail !== undefined) err.detail = detail;
    throw err;
  }
  try {
    return JSON.parse(text === '' ? '{}' : text) as T;
  } catch {
    throw new StackitHttpError(res.status, `${route} (body is not JSON)`);
  }
}
