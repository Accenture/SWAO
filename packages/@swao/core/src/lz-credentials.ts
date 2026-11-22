// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3570: scoped vault keys for live landing-zone credentials (Design 120
// section 6.2). One key per landing zone, scope and field:
//   lz:<lz-id>:<scope-id>:<field>   e.g. lz:otc-prod:platform:password
// The fixed Pass 23 keys (aws-access-key-id, ..., azure-client-secret) are
// migrated once by moveLegacyLzCredentials(); there is no dual-read fallback.
// Short-lived tokens carry `expires-at`; an expired or unreadable expiry fails
// before any API call (LzCredentialExpiredError). Values are never logged.

import type { CredentialStore } from './credential-store.js';
import { LZ_REGISTRATION_ID_PATTERN } from './swao-yml.js';

export const LZ_CREDENTIAL_FIELDS = [
  'username',
  'password',
  'domain',
  'access-key-id',
  'secret-access-key',
  'session-token',
  'expires-at',
  'tenant-id',
  'client-id',
  'client-secret',
  // #3575: PEM private key (optionally with its certificate) of the azure
  // service-principal-certificate method.
  'client-certificate',
  'service-account-key',
  'token',
] as const;
export type LzCredentialField = (typeof LZ_CREDENTIAL_FIELDS)[number];

const LZ_KEY_RE = /^lz:([^:]+):([^:]+):([^:]+)$/;

export function lzCredentialKey(lzId: string, scopeId: string, field: LzCredentialField): string {
  if (!LZ_REGISTRATION_ID_PATTERN.test(lzId)) {
    throw new Error(`[credential] landing zone id "${lzId}" must be kebab-case, for example otc-prod`);
  }
  if (!LZ_REGISTRATION_ID_PATTERN.test(scopeId)) {
    throw new Error(`[credential] scope id "${scopeId}" must be kebab-case, for example platform`);
  }
  if (!(LZ_CREDENTIAL_FIELDS as readonly string[]).includes(field)) {
    throw new Error(`[credential] unknown landing zone credential field "${field}"`);
  }
  return `lz:${lzId}:${scopeId}:${field}`;
}

export interface ParsedLzCredentialKey {
  lzId: string;
  scopeId: string;
  field: LzCredentialField;
}

export function parseLzCredentialKey(name: string): ParsedLzCredentialKey | null {
  const m = LZ_KEY_RE.exec(name);
  if (!m) return null;
  const [, lzId, scopeId, field] = m as unknown as [string, string, string, string];
  if (!LZ_REGISTRATION_ID_PATTERN.test(lzId) || !LZ_REGISTRATION_ID_PATTERN.test(scopeId)) return null;
  if (!(LZ_CREDENTIAL_FIELDS as readonly string[]).includes(field)) return null;
  return { lzId, scopeId, field: field as LzCredentialField };
}

// Pass 23 keys (aws-adapter.ts resolveAwsCredentials, azure-adapter.ts
// resolveAzureCredentials before #3570) and the scoped field they move to.
export const LEGACY_LZ_CREDENTIAL_KEYS: Readonly<Record<string, { provider: 'aws' | 'azure'; field: LzCredentialField }>> = {
  'aws-access-key-id': { provider: 'aws', field: 'access-key-id' },
  'aws-secret-access-key': { provider: 'aws', field: 'secret-access-key' },
  'aws-session-token': { provider: 'aws', field: 'session-token' },
  'azure-tenant-id': { provider: 'azure', field: 'tenant-id' },
  'azure-client-id': { provider: 'azure', field: 'client-id' },
  'azure-client-secret': { provider: 'azure', field: 'client-secret' },
};

/** Legacy Pass 23 key names present in the vault file (env overrides cannot be moved). */
export function findLegacyLzCredentialKeys(store: CredentialStore, provider?: 'aws' | 'azure'): string[] {
  const data = store.loadSync();
  return Object.keys(LEGACY_LZ_CREDENTIAL_KEYS)
    .filter((k) => k in data)
    .filter((k) => provider === undefined || LEGACY_LZ_CREDENTIAL_KEYS[k]?.provider === provider)
    .sort();
}

/**
 * Move the legacy keys of one provider to `lz:<lzId>:<scopeId>:<field>` in a
 * single vault write; the legacy keys are removed. Refuses (vault unchanged)
 * when a target key already exists. Returns the moves performed.
 */
export async function moveLegacyLzCredentials(
  store: CredentialStore,
  provider: 'aws' | 'azure',
  lzId: string,
  scopeId: string,
): Promise<Array<{ from: string; to: string }>> {
  const moves = findLegacyLzCredentialKeys(store, provider).map((from) => ({
    from,
    to: lzCredentialKey(lzId, scopeId, (LEGACY_LZ_CREDENTIAL_KEYS[from] as { field: LzCredentialField }).field),
  }));
  if (moves.length > 0) await store.moveKeys(moves);
  return moves;
}

/**
 * #4459: how to refresh an expired session token of one scope, in steps a
 * binary user can follow (no repository script). The four vault fields are
 * the ones of the AWS session-keys auth method.
 */
export function lzTokenRefreshHint(lzId: string, scopeId: string): string {
  const prefix = `lz:${lzId}:${scopeId}`;
  return `for AWS SSO: swao lz credentials refresh ${lzId} ${scopeId} (sign-in in the browser), or the TUI action Refresh the AWS SSO session; without it: aws sso login --profile <profile> and aws configure export-credentials --profile <profile>, then store the new keys with swao lz connect ${lzId} (same scope, new keys) or with swao credential set ${prefix}:<field> - for each of access-key-id, secret-access-key, session-token and expires-at`;
}

export class LzCredentialExpiredError extends Error {
  readonly exitCode = 2;
  constructor(readonly key: string, readonly reason: 'expired' | 'unreadable') {
    const parsed = parseLzCredentialKey(key);
    super(
      reason === 'expired'
        ? `[credential] the token for ${key.replace(/:expires-at$/, '')} has expired; refresh it before running again (${parsed ? lzTokenRefreshHint(parsed.lzId, parsed.scopeId) : 'store new keys with swao lz connect'})`
        : `[credential] ${key} is not an ISO 8601 date-time; store it again (for example 2026-11-02T19:59:25+00:00)`,
    );
    this.name = 'LzCredentialExpiredError';
  }
}

/**
 * #4459: the stored `expires-at` of one scope and whether it is in the past
 * (an unparseable value counts as expired); null when the scope stores none.
 */
export async function lzSessionExpiry(store: CredentialStore, lzId: string, scopeId: string, now: Date = new Date()): Promise<{ expiresAt: string; expired: boolean } | null> {
  const expiresAt = await store.get(lzCredentialKey(lzId, scopeId, 'expires-at'));
  if (expiresAt === null || expiresAt === '') return null;
  const t = Date.parse(expiresAt);
  return { expiresAt, expired: !/^\d{4}-\d{2}-\d{2}T/.test(expiresAt) || Number.isNaN(t) || t <= now.getTime() };
}

/** #4459: the start of the warning line `swao lz connect` prints for an expired session token (the TUI reads it back). */
export const LZ_EXPIRED_SESSION_LINE_PREFIX = 'warning: registered, but the session token';

/** #4459: `warning: registered, but the session token expired at <time>; refresh it before a run`. */
export function lzExpiredSessionLine(expiresAt: string): string {
  return `${LZ_EXPIRED_SESSION_LINE_PREFIX} expired at ${expiresAt}; refresh it before a run`;
}

export class LzCredentialMissingError extends Error {
  constructor(readonly keys: string[]) {
    super(`[credential] missing landing zone credentials: ${keys.join(', ')}. Run: swao lz connect, or swao credential set <name> -`);
    this.name = 'LzCredentialMissingError';
  }
}

/**
 * Read the fields of one landing-zone scope. `expires-at`, when stored, is
 * checked first: a past or unparseable value throws LzCredentialExpiredError,
 * so callers fail before any request. Missing required fields throw
 * LzCredentialMissingError listing the key names (never values).
 */
export async function resolveLzCredentials<R extends LzCredentialField, O extends LzCredentialField = never>(
  store: CredentialStore,
  lzId: string,
  scopeId: string,
  required: readonly R[],
  optional: readonly O[] = [],
  now: Date = new Date(),
): Promise<Record<R, string> & Partial<Record<O, string>>> {
  const expiresKey = lzCredentialKey(lzId, scopeId, 'expires-at');
  const expiresAt = await store.get(expiresKey);
  if (expiresAt !== null) {
    const t = Date.parse(expiresAt);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(expiresAt) || Number.isNaN(t)) throw new LzCredentialExpiredError(expiresKey, 'unreadable');
    if (t <= now.getTime()) throw new LzCredentialExpiredError(expiresKey, 'expired');
  }
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const field of required) {
    const key = lzCredentialKey(lzId, scopeId, field);
    const v = await store.get(key);
    if (v === null || v === '') missing.push(key);
    else out[field] = v;
  }
  if (missing.length > 0) throw new LzCredentialMissingError(missing);
  for (const field of optional) {
    const v = await store.get(lzCredentialKey(lzId, scopeId, field));
    if (v !== null && v !== '') out[field] = v;
  }
  return out as Record<R, string> & Partial<Record<O, string>>;
}
