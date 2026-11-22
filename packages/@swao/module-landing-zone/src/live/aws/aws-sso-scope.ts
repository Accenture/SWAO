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

// #4459 (Design 120 section 6.2): `swao lz credentials refresh <lz-id> <scope-id>`
// and the TUI action "Refresh the AWS SSO session". Resolves the AWS profile
// of a registered AWS session-keys scope, runs the SSO device sign-in
// (aws-sso-refresh.ts) and stores the four fields of the scope in one vault
// write. The profile is named with --profile, else by the optional
// `aws_profile` of the scope in .swao.yml (#4459, a name only), else found in
// the AWS config by the scope's target account; nothing is written to
// .swao.yml or the AWS files.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { CredentialStore, logPortfolio, lzCredentialKey } from '@swao/core';
import type { LzCredentialField } from '@swao/core';
import type { FetchLike } from '../types.js';
import { LzLiveError, readLandingZones, writeLandingZones } from '../session.js';
import {
  AwsSsoRefreshError,
  awsConfigPath,
  pickAwsSsoProfile,
  readAwsSsoProfiles,
  runAwsSsoDeviceFlow,
  type AwsSsoProfile,
  type AwsSsoPrompt,
} from './aws-sso-refresh.js';

/** The auth method whose keys the refresh replaces. */
export const AWS_SSO_REFRESH_AUTH = 'session-keys';

/** The four fields the refresh stores (the session-keys method of the AWS driver). */
export const AWS_SSO_REFRESH_FIELDS: readonly LzCredentialField[] = ['access-key-id', 'secret-access-key', 'session-token', 'expires-at'];

const globalFetch: FetchLike = (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;

export interface AwsSsoScopeOptions {
  workspaceRoot: string;
  lzId: string;
  scopeId: string;
  store: CredentialStore;
  /** --profile; without it the profile is matched by the scope's target account. */
  profileName?: string;
  env?: Record<string, string | undefined>;
  /** Home directory for <home>/.aws/config (tests use a temporary one). */
  home?: string;
  transport?: FetchLike;
  onPrompt: (p: AwsSsoPrompt) => void;
  onWaiting?: (state: 'pending' | 'slow_down', nextPollS: number) => void;
  oidcBaseUrl?: string;
  portalBaseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface AwsSsoScopeOutcome {
  profile: string;
  expiresAt: string;
  storedKeys: string[];
}

/**
 * The registered AWS session-keys scope, or a clear refusal: its target
 * account and, when set, its `aws_profile` (#4459, a profile name only).
 */
export function sessionKeysScope(workspaceRoot: string, lzId: string, scopeId: string): { account?: string; awsProfile?: string } {
  const lz = readLandingZones(workspaceRoot).find((l) => l.id === lzId);
  if (!lz) throw new LzLiveError(`landing zone ${lzId} is not registered in .swao.yml; run swao lz connect first`);
  if (lz.provider !== 'aws') throw new LzLiveError(`landing zone ${lzId} is not an AWS landing zone (provider ${lz.provider}); the SSO refresh is for AWS session keys`);
  const scope = lz.scopes.find((s) => s.id === scopeId);
  if (!scope) throw new LzLiveError(`landing zone ${lzId} has no scope ${scopeId}`);
  if (scope.auth !== AWS_SSO_REFRESH_AUTH) throw new LzLiveError(`scope ${scopeId} of ${lzId} uses ${scope.auth}, not ${AWS_SSO_REFRESH_AUTH}; the SSO refresh replaces session keys only`);
  const account = (scope.target as Record<string, string> | undefined)?.['account'];
  return { ...(account ? { account } : {}), ...(scope.aws_profile ? { awsProfile: scope.aws_profile } : {}) };
}

/**
 * #4496: stores `profile` as `aws_profile` of the scope in .swao.yml (a
 * profile name only) through the landing zone writer (the minimal-patch
 * writer of @swao/core). Returns false when the scope already names it.
 */
export function storeScopeAwsProfile(workspaceRoot: string, lzId: string, scopeId: string, profile: string): boolean {
  sessionKeysScope(workspaceRoot, lzId, scopeId); // the same refusals as the refresh
  const lzs = readLandingZones(workspaceRoot);
  const lz = lzs.find((l) => l.id === lzId)!;
  const scope = lz.scopes.find((s) => s.id === scopeId)!;
  if (scope.aws_profile === profile) return false;
  scope.aws_profile = profile;
  writeLandingZones(workspaceRoot, lzs);
  return true;
}

/**
 * #4496: true for an AWS sign-in URL of the device flow (https on an AWS
 * host); only such a URL is opened in the browser.
 */
export function isAwsSignInUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return host.endsWith('.amazonaws.com') || host.endsWith('.awsapps.com') || host.endsWith('.aws.amazon.com') || host.endsWith('.amazonaws.cn');
}

/**
 * #4496: opens the AWS sign-in URL in the default browser (no shell; the
 * same launch as the console links of `swao lz evidence --open`). Returns
 * false when the URL is not an AWS sign-in URL or no browser could be started.
 */
export function openAwsSignInUrl(url: string, spawnImpl: typeof spawn = spawn): boolean {
  if (!isAwsSignInUrl(url)) return false;
  try {
    const [cmd, args] = process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]] as const
      : process.platform === 'darwin' ? ['open', [url]] as const : ['xdg-open', [url]] as const;
    const child = spawnImpl(cmd, [...args], { detached: true, stdio: 'ignore', shell: false });
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** The SSO profiles of the AWS config file (empty when there is none). */
export function listAwsSsoProfiles(opts: { env?: Record<string, string | undefined>; home?: string }): AwsSsoProfile[] {
  const file = awsConfigPath(opts.env ?? process.env, opts.home ?? homedir());
  if (!existsSync(file)) return [];
  try {
    return readAwsSsoProfiles(readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * The profiles the TUI offers for one scope: the scope's `aws_profile` when
 * it is set and found in the AWS config (#4459; the TUI then skips the
 * picker), else with a target account the profiles of that account only
 * (the CLI refuses any other), else every SSO profile.
 */
export function awsSsoProfilesForScope(opts: { workspaceRoot: string; lzId: string; scopeId: string; env?: Record<string, string | undefined>; home?: string }): AwsSsoProfile[] {
  const { account, awsProfile } = sessionKeysScope(opts.workspaceRoot, opts.lzId, opts.scopeId);
  const all = listAwsSsoProfiles(opts);
  const fits = account ? all.filter((p) => p.accountId === account) : all;
  if (awsProfile !== undefined) {
    const named = fits.filter((p) => p.name === awsProfile);
    if (named.length === 1) return named;
  }
  return fits;
}

/**
 * Refreshes the session keys of one scope. Writes only after the sign-in has
 * returned complete role credentials: a refused or expired sign-in leaves the
 * vault unchanged. Logs `lz.credentials.refresh` with the landing zone, the
 * scope, the profile name and the outcome; never a token, key or code.
 */
export async function refreshAwsSsoScope(opts: AwsSsoScopeOptions): Promise<AwsSsoScopeOutcome> {
  const started = Date.now();
  const { account, awsProfile } = sessionKeysScope(opts.workspaceRoot, opts.lzId, opts.scopeId);
  const profiles = listAwsSsoProfiles({ ...(opts.env ? { env: opts.env } : {}), ...(opts.home ? { home: opts.home } : {}) });
  // #4459: --profile wins; else the scope's aws_profile; else the match by the target account.
  const profileName = opts.profileName ?? awsProfile;
  const profileSource = opts.profileName !== undefined ? 'option' : awsProfile !== undefined ? 'swao_yml' : 'account_match';
  const context = (extra: Record<string, unknown>): Record<string, unknown> => ({ lz_id: opts.lzId, scope_id: opts.scopeId, profile_source: profileSource, duration_ms: Date.now() - started, ...extra });
  let profile: AwsSsoProfile | undefined;
  try {
    profile = pickAwsSsoProfile(profiles, { ...(profileName !== undefined ? { name: profileName } : {}), ...(account ? { scopeAccount: account } : {}) });
    const creds = await runAwsSsoDeviceFlow({
      profile,
      transport: opts.transport ?? globalFetch,
      onPrompt: opts.onPrompt,
      ...(opts.onWaiting ? { onWaiting: opts.onWaiting } : {}),
      ...(opts.oidcBaseUrl ? { oidcBaseUrl: opts.oidcBaseUrl } : {}),
      ...(opts.portalBaseUrl ? { portalBaseUrl: opts.portalBaseUrl } : {}),
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    });
    const key = (f: LzCredentialField): string => lzCredentialKey(opts.lzId, opts.scopeId, f);
    const values: Record<string, string> = {
      [key('access-key-id')]: creds.accessKeyId,
      [key('secret-access-key')]: creds.secretAccessKey,
      [key('session-token')]: creds.sessionToken,
      [key('expires-at')]: creds.expiresAt,
    };
    await opts.store.importAll(values, 'merge');
    logPortfolio('info', 'lz.credentials.refresh', `AWS SSO session refreshed for ${opts.lzId}/${opts.scopeId}`, { context: context({ profile: profile.name, outcome: 'stored', expires_at: creds.expiresAt, fields: AWS_SSO_REFRESH_FIELDS.length }) });
    return { profile: profile.name, expiresAt: creds.expiresAt, storedKeys: Object.keys(values) };
  } catch (err) {
    const code = err instanceof AwsSsoRefreshError ? err.code : 'error';
    logPortfolio('warn', 'lz.credentials.refresh', `AWS SSO session refresh of ${opts.lzId}/${opts.scopeId} stopped: ${code}`, { context: context({ ...(profile ? { profile: profile.name } : {}), outcome: code, ...(err instanceof AwsSsoRefreshError && err.httpStatus !== undefined ? { http_status: err.httpStatus } : {}) }) });
    if (err instanceof AwsSsoRefreshError) throw new LzLiveError(`AWS SSO refresh: ${err.message}`, 2);
    throw err;
  }
}
