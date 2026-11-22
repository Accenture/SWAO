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

// #4459 (Design 120 section 6.2): refresh the short-term keys of an AWS
// session-keys scope through AWS IAM Identity Center (SSO), without the AWS CLI
// and without a repository script. The operator signs in in the browser with
// the device authorisation flow; SWAO shows only the verification URL and the
// user code, then stores the role credentials and their expiry in the vault:
//   lz:<lz-id>:<scope-id>:access-key-id | secret-access-key | session-token | expires-at
//
// The calls are sign-in calls (register a public OIDC client, start the device
// authorisation, poll for the token, read the role credentials). They change
// nothing in the tenant, so SWAO stays read-only towards the cloud. They do not
// go through the driver's read-only guard (http.ts): they are not tenant API
// calls, and the transport is injected (tests use a mock server).
//
// Secrets stay in memory: the OIDC client secret, the device code, the SSO
// access token and the role keys are never logged, printed or written
// anywhere but the vault. The AWS SSO token cache (~/.aws/sso/cache) is never
// read or written. The AWS config file is read for the profile only
// (sso_start_url, sso_region, sso_account_id, sso_role_name, sso_session).
//
// UNVERIFIED LIVE (written without access to the AWS documentation; the
// owner's live SSO login is the acceptance test):
//   POST https://oidc.<sso_region>.amazonaws.com/client/register
//        body { clientName, clientType: "public" } -> { clientId, clientSecret }
//   POST https://oidc.<sso_region>.amazonaws.com/device_authorization
//        body { clientId, clientSecret, startUrl }
//        -> { deviceCode, userCode, verificationUri, verificationUriComplete, expiresIn, interval }
//   POST https://oidc.<sso_region>.amazonaws.com/token
//        body { clientId, clientSecret, grantType: "urn:ietf:params:oauth:grant-type:device_code", deviceCode }
//        -> 200 { accessToken, expiresIn } | 400 { error: authorization_pending | slow_down | expired_token | access_denied }
//        (the error code may also come as __type or the x-amzn-ErrorType header)
//   GET  https://portal.sso.<sso_region>.amazonaws.com/federation/credentials?role_name=<r>&account_id=<a>
//        header x-amz-sso_bearer_token: <accessToken>
//        -> { roleCredentials: { accessKeyId, secretAccessKey, sessionToken, expiration (epoch ms) } }

import type { FetchLike } from '../types.js';

/** The grant type of the device code token request (RFC 8628). */
export const AWS_SSO_DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
/** The OIDC client name SWAO registers (a public client, one per refresh). */
export const AWS_SSO_CLIENT_NAME = 'swao-lz-live';
/** Default poll interval when the device authorisation names none (RFC 8628 section 3.2). */
export const AWS_SSO_DEFAULT_INTERVAL_S = 5;
/** Added to the interval on each slow_down answer (RFC 8628 section 3.5). */
export const AWS_SSO_SLOW_DOWN_STEP_S = 5;
/** Upper bound of the wait when the device authorisation names no expiry. */
export const AWS_SSO_DEFAULT_EXPIRES_S = 600;

export type AwsSsoErrorCode =
  | 'profile'          // the AWS config has no usable SSO profile
  | 'expired'          // the device code expired before the sign-in
  | 'denied'           // the operator refused the sign-in
  | 'unauthorized'     // 401 / 403 from OIDC or the portal
  | 'server'           // 5xx or an unreadable answer
  | 'protocol';        // an answer without the fields SWAO needs

export class AwsSsoRefreshError extends Error {
  constructor(readonly code: AwsSsoErrorCode, message: string, readonly httpStatus?: number) {
    super(message);
    this.name = 'AwsSsoRefreshError';
  }
}

// ---------------------------------------------------------------------------
// AWS config file (profiles)
// ---------------------------------------------------------------------------

export interface AwsSsoProfile {
  /** Profile name (`[profile <name>]`, or `default`). */
  name: string;
  startUrl: string;
  /** The SSO region (of the sso-session when the profile names one), not the profile's `region`. */
  ssoRegion: string;
  accountId: string;
  roleName: string;
  /** The `sso_session` the profile points to, when it uses that form. */
  session?: string;
}

/** The text without trailing characters of `chars` (a loop, no backtracking regex; CodeQL js/polynomial-redos). */
function stripTrailing(text: string, chars: string): string {
  let end = text.length;
  while (end > 0 && chars.includes(text[end - 1]!)) end -= 1;
  return text.slice(0, end);
}

/** Path of the AWS config file: AWS_CONFIG_FILE, else <home>/.aws/config. */
export function awsConfigPath(env: Record<string, string | undefined>, home: string): string {
  const fromEnv = env['AWS_CONFIG_FILE']?.trim();
  if (fromEnv) return fromEnv;
  return `${stripTrailing(home, '/' + String.fromCharCode(92))}/.aws/config`;
}

/** INI sections of the AWS config: `[profile x]`, `[default]`, `[sso-session y]`. Comments (`#`, `;`) are ignored. */
function parseIni(text: string): Map<string, Record<string, string>> {
  const sections = new Map<string, Record<string, string>>();
  let current: Record<string, string> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      const name = line.slice(1, -1).trim().replace(/\s+/g, ' ');
      current = sections.get(name) ?? {};
      sections.set(name, current);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0 || current === null) continue;
    current[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
  }
  return sections;
}

/**
 * The SSO profiles of an AWS config file: the legacy form (sso_start_url and
 * sso_region in the profile) and the sso-session form (`sso_session = x`
 * pointing to `[sso-session x]`). A profile without account id or role name
 * is not a role profile and is left out.
 */
export function readAwsSsoProfiles(configText: string): AwsSsoProfile[] {
  const sections = parseIni(configText);
  const out: AwsSsoProfile[] = [];
  for (const [section, values] of sections) {
    const name = section === 'default' ? 'default' : section.startsWith('profile ') ? section.slice('profile '.length).trim() : null;
    if (!name) continue;
    const sessionName = values['sso_session'];
    const session = sessionName ? sections.get(`sso-session ${sessionName}`) : undefined;
    const startUrl = session?.['sso_start_url'] ?? values['sso_start_url'];
    const ssoRegion = session?.['sso_region'] ?? values['sso_region'];
    const accountId = values['sso_account_id'];
    const roleName = values['sso_role_name'];
    if (!startUrl || !ssoRegion || !accountId || !roleName) continue;
    out.push({ name, startUrl, ssoRegion, accountId, roleName, ...(sessionName ? { session: sessionName } : {}) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The profile of a refresh: the named one; without a name the only profile
 * whose account id is the scope's `target.account`, else the only profile.
 * A named profile for another account than the scope's is refused, so keys
 * of one account never land in the scope of another.
 */
export function pickAwsSsoProfile(profiles: readonly AwsSsoProfile[], opts: { name?: string; scopeAccount?: string }): AwsSsoProfile {
  const names = profiles.map((p) => p.name).join(', ') || 'none';
  if (opts.name !== undefined) {
    const p = profiles.find((x) => x.name === opts.name);
    if (!p) throw new AwsSsoRefreshError('profile', `the AWS config has no SSO profile ${opts.name} (SSO profiles: ${names})`);
    if (opts.scopeAccount && p.accountId !== opts.scopeAccount) {
      throw new AwsSsoRefreshError('profile', `the AWS profile ${p.name} signs in to another account than the scope's target account; choose the profile of that account`);
    }
    return p;
  }
  const candidates = opts.scopeAccount ? profiles.filter((p) => p.accountId === opts.scopeAccount) : [...profiles];
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) {
    throw new AwsSsoRefreshError('profile', opts.scopeAccount
      ? `no SSO profile of the AWS config signs in to the scope's target account (SSO profiles: ${names}); add one with aws configure sso`
      : 'the AWS config has no SSO profile; add one with aws configure sso');
  }
  throw new AwsSsoRefreshError('profile', `more than one SSO profile fits (${candidates.map((p) => p.name).join(', ')}); name one with --profile`);
}

// ---------------------------------------------------------------------------
// Device authorisation flow and role credentials
// ---------------------------------------------------------------------------

/** What the operator sees: the URL to open and the code to enter. Nothing else of the flow is shown. */
export interface AwsSsoPrompt {
  verificationUri: string;
  /** The URL with the code already in it, when the service returns one. */
  verificationUriComplete?: string;
  userCode: string;
  /** Seconds until the code expires. */
  expiresInS: number;
}

export interface AwsSsoRoleCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  /** ISO 8601 (UTC), the form `expires-at` of the vault needs. */
  expiresAt: string;
}

export interface AwsSsoFlowOptions {
  profile: AwsSsoProfile;
  transport: FetchLike;
  onPrompt: (p: AwsSsoPrompt) => void;
  /** Called on each poll answer that is still pending (for a waiting line); never with a secret. */
  onWaiting?: (state: 'pending' | 'slow_down', nextPollS: number) => void;
  /** Base URL overrides (tests, a mock server). Default the regional AWS endpoints. */
  oidcBaseUrl?: string;
  portalBaseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  clientName?: string;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function awsSsoOidcBaseUrl(region: string): string {
  return `https://oidc.${region}.amazonaws.com`;
}

export function awsSsoPortalBaseUrl(region: string): string {
  return `https://portal.sso.${region}.amazonaws.com`;
}

type Answer = { status: number; body: Record<string, unknown>; errorCode: string | undefined };

/** Error code of an OIDC / portal answer: JSON `error`, `__type` (after a `#`), or the x-amzn-ErrorType header. */
function errorCodeOf(body: Record<string, unknown>, header: string | null): string | undefined {
  const pick = (v: unknown): string | undefined => {
    if (typeof v !== 'string' || v === '') return undefined;
    const hash = v.lastIndexOf('#');
    const colon = v.indexOf(':');
    return (hash >= 0 ? v.slice(hash + 1) : colon >= 0 ? v.slice(0, colon) : v).trim();
  };
  return pick(body['error']) ?? pick(body['__type']) ?? pick(header ?? undefined);
}

/** Maps both spellings (`authorization_pending`, `AuthorizationPendingException`) to one word. */
function normaliseCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const c = code.replace(/Exception$/, '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  return c;
}

async function send(transport: FetchLike, url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }): Promise<Answer> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await transport(url, init);
  } catch (e) {
    throw new AwsSsoRefreshError('server', `the AWS sign-in service could not be reached (${(e as Error).name})`);
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    const parsed = text.trim() === '' ? {} : JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body, errorCode: normaliseCode(errorCodeOf(body, res.headers.get('x-amzn-errortype'))) };
}

/** Fails on 401 / 403 and 5xx with a message that names the step and the status only (never a body value). */
function check(step: string, a: Answer): void {
  if (a.status >= 200 && a.status < 300) return;
  if (a.status === 401 || a.status === 403) throw new AwsSsoRefreshError('unauthorized', `the AWS sign-in refused the ${step} (HTTP ${a.status}${a.errorCode ? `, ${a.errorCode}` : ''})`, a.status);
  if (a.status >= 500) throw new AwsSsoRefreshError('server', `the AWS sign-in service failed on the ${step} (HTTP ${a.status}); try again later`, a.status);
  throw new AwsSsoRefreshError('protocol', `the AWS sign-in answered the ${step} with HTTP ${a.status}${a.errorCode ? ` (${a.errorCode})` : ''}`, a.status);
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** The portal's `expiration` (epoch milliseconds; seconds or an ISO string are accepted too) as an ISO 8601 UTC string. */
export function awsSsoExpiration(v: unknown): string | undefined {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v))) return new Date(Date.parse(v)).toISOString();
  const n = num(v);
  if (n === undefined || n <= 0) return undefined;
  const ms = n < 1e12 ? n * 1000 : n;
  return new Date(ms).toISOString();
}

/**
 * Runs the device authorisation flow for one profile and returns the role
 * credentials. Polls the token endpoint every `interval` seconds (plus 5 s
 * per slow_down) until the sign-in, a refusal or the expiry of the code.
 */
export async function runAwsSsoDeviceFlow(opts: AwsSsoFlowOptions): Promise<AwsSsoRoleCredentials> {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const oidc = stripTrailing(opts.oidcBaseUrl ?? awsSsoOidcBaseUrl(opts.profile.ssoRegion), '/');
  const portal = stripTrailing(opts.portalBaseUrl ?? awsSsoPortalBaseUrl(opts.profile.ssoRegion), '/');
  const json = { 'content-type': 'application/json', accept: 'application/json' };

  const reg = await send(opts.transport, `${oidc}/client/register`, { method: 'POST', headers: json, body: JSON.stringify({ clientName: opts.clientName ?? AWS_SSO_CLIENT_NAME, clientType: 'public' }) });
  check('client registration', reg);
  const clientId = str(reg.body['clientId']);
  const clientSecret = str(reg.body['clientSecret']);
  if (!clientId || !clientSecret) throw new AwsSsoRefreshError('protocol', 'the AWS sign-in returned no client id for the device sign-in');

  const auth = await send(opts.transport, `${oidc}/device_authorization`, { method: 'POST', headers: json, body: JSON.stringify({ clientId, clientSecret, startUrl: opts.profile.startUrl }) });
  check('device authorisation', auth);
  const deviceCode = str(auth.body['deviceCode']);
  const userCode = str(auth.body['userCode']);
  const verificationUri = str(auth.body['verificationUri']);
  const verificationUriComplete = str(auth.body['verificationUriComplete']);
  if (!deviceCode || !userCode || !verificationUri) throw new AwsSsoRefreshError('protocol', 'the AWS sign-in returned no user code or verification URL');
  const expiresInS = num(auth.body['expiresIn']) ?? AWS_SSO_DEFAULT_EXPIRES_S;
  let intervalS = Math.max(1, num(auth.body['interval']) ?? AWS_SSO_DEFAULT_INTERVAL_S);
  const deadline = now() + expiresInS * 1000;
  opts.onPrompt({ verificationUri, ...(verificationUriComplete ? { verificationUriComplete } : {}), userCode, expiresInS });

  let accessToken: string | undefined;
  for (;;) {
    await sleep(intervalS * 1000);
    if (now() > deadline) throw new AwsSsoRefreshError('expired', `the sign-in code expired after ${expiresInS} s without a sign-in; start the refresh again`);
    const tok = await send(opts.transport, `${oidc}/token`, { method: 'POST', headers: json, body: JSON.stringify({ clientId, clientSecret, grantType: AWS_SSO_DEVICE_GRANT, deviceCode }) });
    if (tok.status >= 200 && tok.status < 300) {
      accessToken = str(tok.body['accessToken']);
      if (!accessToken) throw new AwsSsoRefreshError('protocol', 'the AWS sign-in returned no access token');
      break;
    }
    switch (tok.errorCode) {
      case 'authorization_pending':
        opts.onWaiting?.('pending', intervalS);
        continue;
      case 'slow_down':
        intervalS += AWS_SSO_SLOW_DOWN_STEP_S;
        opts.onWaiting?.('slow_down', intervalS);
        continue;
      case 'expired_token':
        throw new AwsSsoRefreshError('expired', 'the sign-in code expired before the sign-in; start the refresh again', tok.status);
      case 'access_denied':
        throw new AwsSsoRefreshError('denied', 'the sign-in was refused in the browser; nothing was stored', tok.status);
      default:
        check('token request', tok);
        throw new AwsSsoRefreshError('protocol', `the AWS sign-in answered the token request with HTTP ${tok.status}`, tok.status);
    }
  }

  const q = new URLSearchParams({ role_name: opts.profile.roleName, account_id: opts.profile.accountId });
  const role = await send(opts.transport, `${portal}/federation/credentials?${q.toString()}`, { method: 'GET', headers: { accept: 'application/json', 'x-amz-sso_bearer_token': accessToken } });
  check('role credentials request', role);
  const rc = role.body['roleCredentials'];
  const r = rc && typeof rc === 'object' ? rc as Record<string, unknown> : {};
  const accessKeyId = str(r['accessKeyId']);
  const secretAccessKey = str(r['secretAccessKey']);
  const sessionToken = str(r['sessionToken']);
  const expiresAt = awsSsoExpiration(r['expiration']);
  if (!accessKeyId || !secretAccessKey || !sessionToken || !expiresAt) throw new AwsSsoRefreshError('protocol', 'the AWS sign-in returned incomplete role credentials; nothing was stored');
  return { accessKeyId, secretAccessKey, sessionToken, expiresAt };
}
