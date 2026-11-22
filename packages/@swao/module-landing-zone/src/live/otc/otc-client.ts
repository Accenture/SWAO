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

// #3572: OTC IAM token and JSON GET helpers. Wire formats are taken from the
// published OTC IAM API reference (opentelekomcloud-docs/identity-access-
// management, api-ref/source/apis/token_management/obtaining_a_user_token_
// through_password_authentication.rst) and from the partner hackathon
// recording (Design 120 section 3): `POST /v3/auth/tokens` with the password
// method and a project scope named after the region returns 201, the token in
// `X-Subject-Token` and `token.{catalog, project, user, roles}` in the body.
// Endpoints come from `token.catalog`, never from a hard-coded table; only the
// IAM endpoint is a driver default (and the only one the endpoint seam can
// override, endpoints.ts).

import type { ScopeCtx } from '../types.js';
import { LiveAuthError } from '../errors.js';
import { signOtcRequest } from './otc-sign.js';

export const OTC_PROVIDER = 'otc';
export const OTC_DEFAULT_IAM = 'https://iam.eu-de.otc.t-systems.com/v3';

export interface OtcCatalogEndpoint {
  url: string;
  region_id?: string;
  region?: string;
  interface?: string;
}

export interface OtcCatalogEntry {
  type: string;
  name?: string;
  endpoints: OtcCatalogEndpoint[];
}

/**
 * #3685: how the requests of a scope authenticate. `token`: the IAM token in
 * X-Auth-Token. `aksk`: every request is signed (otc-sign.ts) with the vault
 * AK/SK; X-Project-Id names the project of a project session, X-Domain-Id the
 * account on IAM; a temporary AK/SK adds X-Security-Token.
 */
export type OtcAuth =
  | { kind: 'token' }
  | { kind: 'aksk'; accessKey: string; secretKey: string; securityToken?: string };

export interface OtcToken {
  /** The IAM token (`token` auth); empty for `aksk`. Never logged. */
  value: string;
  /** #3685: absent means `token` (the token sessions of #3572). */
  auth?: OtcAuth;
  projectId: string;
  projectName: string;
  userId: string;
  domainId: string;
  /** Role names the token carries (display only, never a secret). */
  roles: string[];
  catalog: OtcCatalogEntry[];
}

export class OtcHttpError extends Error {
  constructor(readonly status: number, readonly route: string) {
    super(`[lz live] otc: HTTP ${status} on ${route}`);
    this.name = 'OtcHttpError';
  }
}

const tokens = new WeakMap<ScopeCtx, Map<string, Promise<OtcToken>>>();

/** Drop trailing slashes in linear time (a `/\/+$/` replace is polynomial on long runs of '/'). */
export function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) end--;
  return url.slice(0, end);
}

export function iamBase(ctx: ScopeCtx): string {
  return trimTrailingSlashes(ctx.http.baseUrls['iam'] ?? OTC_DEFAULT_IAM);
}

function errorMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: unknown }; error_msg?: unknown };
    const m = j.error?.message ?? j.error_msg;
    if (typeof m === 'string' && m !== '') return m.slice(0, 200);
  } catch {
    // not JSON
  }
  return 'no error message';
}

/** Token scope: a project (named after the region) or the whole domain. */
export type OtcTokenScope = { project: string } | { domain: true };

async function requestToken(ctx: ScopeCtx, scope: OtcTokenScope): Promise<OtcToken> {
  if (ctx.auth === 'aksk') return akskSession(ctx, scope);
  const projectName = 'project' in scope ? scope.project : '';
  const { username, password, domain } = ctx.credentials;
  if (!username || !password || !domain) {
    throw new LiveAuthError(OTC_PROVIDER, 401, 'the iam-password-token method needs the vault fields username, password and domain');
  }
  const body = JSON.stringify({
    auth: {
      identity: { methods: ['password'], password: { user: { name: username, password, domain: { name: domain } } } },
      scope: 'project' in scope ? { project: { name: projectName } } : { domain: { name: domain } },
    },
  });
  const res = await ctx.http.fetch(`${iamBase(ctx)}/auth/tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json;charset=utf8' },
    body,
  });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    // #3572 open question: whether the operator login needs a virtual MFA
    // passcode (methods password + totp) is verified on the first live login.
    throw new LiveAuthError(OTC_PROVIDER, res.status, `${errorMessage(text)} (${'project' in scope ? `project ${projectName}` : 'domain scope'}; if virtual MFA login protection is on for this user, the password method alone is refused)`);
  }
  if (!res.ok) throw new OtcHttpError(res.status, '/v3/auth/tokens');
  const value = res.headers.get('x-subject-token');
  if (value === null || value === '') throw new LiveAuthError(OTC_PROVIDER, res.status, 'the token response carries no X-Subject-Token header');
  let t: { token?: { project?: { id?: string; name?: string }; user?: { id?: string; domain?: { id?: string } }; roles?: { name?: string }[]; catalog?: OtcCatalogEntry[] } };
  try {
    t = JSON.parse(text) as typeof t;
  } catch {
    throw new OtcHttpError(res.status, '/v3/auth/tokens (body is not JSON)');
  }
  const tok = t.token ?? {};
  return {
    value,
    projectId: tok.project?.id ?? '',
    projectName: tok.project?.name ?? projectName,
    userId: tok.user?.id ?? '',
    domainId: tok.user?.domain?.id ?? '',
    roles: (tok.roles ?? []).map((r) => r.name ?? '').filter((n) => n !== ''),
    catalog: Array.isArray(tok.catalog) ? tok.catalog : [],
  };
}

function cachedToken(ctx: ScopeCtx, key: string, scope: OtcTokenScope): Promise<OtcToken> {
  let m = tokens.get(ctx);
  if (!m) {
    m = new Map();
    tokens.set(ctx, m);
  }
  let p = m.get(key);
  if (!p) {
    p = requestToken(ctx, scope);
    m.set(key, p);
    p.catch(() => m?.delete(key));
  }
  return p;
}

/** One token per project, cached for the scope run (one request per project). */
export function otcToken(ctx: ScopeCtx, projectName: string): Promise<OtcToken> {
  return cachedToken(ctx, `project:${projectName}`, { project: projectName });
}

/**
 * Domain-scoped token for the IAM permission queries of the probe. Live
 * finding 2026-11-03 (#3572): with a project-scoped token the role query is
 * refused (`Policy doesn't allow iam:permissions:listRolesForGroupOnDomain`,
 * 403) even for a domain administrator; IAM permissions are evaluated at
 * domain level. A domain token carries an empty service catalogue, so it is
 * used for IAM only.
 */
export function otcDomainToken(ctx: ScopeCtx): Promise<OtcToken> {
  return cachedToken(ctx, 'domain', { domain: true });
}

/** Public endpoint of the first catalogue type that serves `region` (or every region). */
export function otcEndpoint(token: OtcToken, types: readonly string[], region: string): string | undefined {
  for (const type of types) {
    const entry = token.catalog.find((c) => c.type === type);
    const ep = entry?.endpoints.find((x) => (x.interface ?? 'public') === 'public' && [region, '*'].includes(x.region_id ?? x.region ?? ''));
    if (ep) return trimTrailingSlashes(ep.url);
  }
  return undefined;
}

/**
 * Headers of a GET for this session: the token, or the AK/SK signature
 * (#3685). A domain session (the IAM reads of the probe) carries
 * X-Domain-Id, a project session X-Project-Id (live 2026-11-04: ECS refuses a
 * signed request without it, 401; the IAM catalogue needs it, 403 with
 * X-Domain-Id); both and X-Security-Token are added after signing, as the OTC
 * Go SDK does (provider_client.go).
 */
function requestHeaders(ctx: ScopeCtx, token: OtcToken, url: string): Record<string, string> {
  const auth: OtcAuth = token.auth ?? { kind: 'token' };
  switch (auth.kind) {
    case 'token':
      return { 'x-auth-token': token.value, accept: 'application/json' };
    case 'aksk': {
      const signed = signOtcRequest({ method: 'GET', url, headers: { accept: 'application/json', 'content-type': 'application/json' }, accessKey: auth.accessKey, secretKey: auth.secretKey });
      return {
        ...signed.headers,
        // The first read (`/v3/auth/domains`) knows no account yet and goes without either header.
        ...(token.projectId !== '' ? { 'x-project-id': token.projectId } : token.domainId !== '' ? { 'x-domain-id': token.domainId } : {}),
        ...(auth.securityToken ? { 'x-security-token': auth.securityToken } : {}),
      };
    }
    default: {
      const never: never = auth;
      return never;
    }
  }
}

/** GET a JSON document with the session (token or AK/SK); non-2xx throws OtcHttpError. */
export async function otcGet<T>(ctx: ScopeCtx, token: OtcToken, url: string, route: string): Promise<T> {
  const res = await ctx.http.fetch(url, { method: 'GET', headers: requestHeaders(ctx, token, url) });
  const text = await res.text();
  if (!res.ok) throw new OtcHttpError(res.status, route);
  try {
    return JSON.parse(text === '' ? '{}' : text) as T;
  } catch {
    throw new OtcHttpError(res.status, `${route} (body is not JSON)`);
  }
}

// ---------------------------------------------------------------------------
// #3685: AK/SK sessions
// ---------------------------------------------------------------------------

/**
 * #3685: status of a refused session read, or undefined. The read-only HTTP
 * layer turns a 401 on a GET into a LiveTokenRejectedError (#3750, "token
 * refused mid-run"); for the first reads of an AK/SK session that wording is
 * wrong, so both that error and a plain 401 / 403 map to `akskRefused`.
 */
function akskRefusal(err: unknown): number | undefined {
  if (err instanceof OtcHttpError && (err.status === 401 || err.status === 403)) return err.status;
  if (err instanceof LiveAuthError && (err.httpStatus === 401 || err.httpStatus === 403)) return err.httpStatus;
  return undefined;
}

/** The AK/SK, its signature or its security token was refused at the start of the scope run. */
export function akskRefused(status: number, route: string, temporary: boolean): LiveAuthError {
  return new LiveAuthError(OTC_PROVIDER, status, `the access key or its signature was refused on ${route}: check the access-key-id and secret-access-key in the vault and that the key is active${temporary ? ', and that the temporary key and its session-token have not expired' : ''}`);
}

/** Origin of the IAM API (the `.../v3` base without the version). */
function iamOrigin(ctx: ScopeCtx): string {
  return new URL(iamBase(ctx)).origin;
}

/**
 * Build the session of an AK/SK scope from signed IAM reads, the facts the
 * token would carry (live 2026-11-04, temporary AK/SK of the test tenant):
 * - `GET /v3/auth/domains` -> the account (domain) id;
 * - `GET /v3/auth/projects` -> the project id of the region project;
 * - `GET /v3/auth/catalog` with X-Project-Id -> the service catalogue of the
 *   project (with X-Domain-Id the call is refused, 403);
 * - `GET /v3.0/OS-CREDENTIAL/credentials/{access_key}` -> the user of a
 *   permanent AK (a temporary AK is not found, 404: the user stays unknown
 *   and the probe reports `unverifiable`).
 * A 401 or 403 on the account, project or catalogue read is the AK/SK
 * refused: LiveAuthError, as for a refused password.
 */
async function akskSession(ctx: ScopeCtx, scope: OtcTokenScope): Promise<OtcToken> {
  const accessKey = ctx.credentials['access-key-id'];
  const secretKey = ctx.credentials['secret-access-key'];
  if (!accessKey || !secretKey) throw new LiveAuthError(OTC_PROVIDER, 401, 'the aksk method needs the vault fields access-key-id and secret-access-key');
  const sessionToken = ctx.credentials['session-token'];
  const auth: OtcAuth = { kind: 'aksk', accessKey, secretKey, ...(sessionToken ? { securityToken: sessionToken } : {}) };
  const base: OtcToken = { value: '', auth, projectId: '', projectName: '', userId: '', domainId: '', roles: [], catalog: [] };
  const origin = iamOrigin(ctx);
  const read = async <T>(t: OtcToken, path: string, route: string): Promise<T> => {
    try {
      return await otcGet<T>(ctx, t, `${origin}${path}`, route);
    } catch (err) {
      const status = akskRefusal(err);
      if (status !== undefined) throw akskRefused(status, route, sessionToken !== undefined && sessionToken !== '');
      throw err;
    }
  };
  if ('project' in scope) {
    // The account and user come from the (cached) domain session: one lookup per scope run.
    const domainSession = await otcDomainToken(ctx);
    return akskProjectSession(ctx, domainSession, scope.project, read, origin);
  }
  const domains = await read<{ domains?: { id?: string }[] }>(base, '/v3/auth/domains', '/v3/auth/domains');
  const domainId = domains.domains?.[0]?.id ?? '';
  if (domainId === '') throw new LiveAuthError(OTC_PROVIDER, 401, 'IAM returned no account for the AK/SK (/v3/auth/domains)');
  let userId = '';
  try {
    const c = await otcGet<{ credential?: { user_id?: string } }>(ctx, { ...base, domainId }, `${origin}/v3.0/OS-CREDENTIAL/credentials/${encodeURIComponent(accessKey)}`, '/v3.0/OS-CREDENTIAL/credentials/{access_key}');
    userId = c.credential?.user_id ?? '';
  } catch (err) {
    // 404 for a temporary key (live 2026-11-04); the probe then reports unverifiable.
    if (!(err instanceof OtcHttpError)) throw err;
  }
  return { ...base, domainId, userId };
}

async function akskProjectSession(
  ctx: ScopeCtx,
  domainSession: OtcToken,
  projectName: string,
  read: <T>(t: OtcToken, path: string, route: string) => Promise<T>,
  origin: string,
): Promise<OtcToken> {
  const projects = await read<{ projects?: { id?: string; name?: string }[] }>(domainSession, '/v3/auth/projects', '/v3/auth/projects');
  const project = (projects.projects ?? []).find((p) => p.name === projectName);
  if (project?.id === undefined || project.id === '') throw new LiveAuthError(OTC_PROVIDER, 401, `the AK/SK has no access to project ${projectName} (/v3/auth/projects)`);
  const projectSession: OtcToken = { ...domainSession, projectId: project.id, projectName };
  // The catalogue is a project read: X-Project-Id, not X-Domain-Id (live 2026-11-04).
  let catalog: OtcCatalogEntry[];
  try {
    const cat = await otcGet<{ catalog?: OtcCatalogEntry[] }>(ctx, projectSession, `${origin}/v3/auth/catalog`, '/v3/auth/catalog');
    catalog = Array.isArray(cat.catalog) ? cat.catalog : [];
  } catch (err) {
    const status = akskRefusal(err);
    if (status !== undefined) throw akskRefused(status, `/v3/auth/catalog for project ${projectName}`, false);
    throw err;
  }
  return { ...projectSession, catalog };
}
