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

// #4232 (owner decision 2026-11-09): reuse of stored landing zone credentials.
// The vault is per user (`~/.config/swao`, shared by every workspace) and keyed
// by landing zone and scope (`lz:<lz-id>:<scope-id>:<field>`), so a new
// landing zone of the same provider finds nothing under its own keys. These
// helpers list the stored credential sets that fit a provider and auth method
// (names only: landing zone, scope, auth method; never a value) and copy one
// set to the keys of a new scope.
//
// Vault keys carry no provider. A set's provider and auth method come from the
// registration in this workspace when the landing zone and scope are
// registered here, else from its field names when they fit exactly one
// (provider, auth method) pair of the drivers of this build; an ambiguous set
// (for example access key fields, used by aws and otc) is not offered, so a set
// is never offered across providers.

import { lzCredentialKey, parseLzCredentialKey, type CredentialStore, type LzCredentialField } from '@swao/core';

export interface ReuseAuthMethod {
  id: string;
  required: readonly LzCredentialField[];
  optional: readonly LzCredentialField[];
}

export interface ReuseDriverInfo {
  provider: string;
  authMethods: readonly ReuseAuthMethod[];
}

export interface ReuseRegistration {
  id: string;
  provider: string;
  scopes: readonly { id: string; auth: string }[];
}

/** One stored credential set (names only). */
export interface StoredCredentialSet {
  lzId: string;
  scopeId: string;
  provider: string;
  auth: string;
  fields: LzCredentialField[];
  /** Where provider and auth method come from. */
  basis: 'registration' | 'fields';
}

/** Stored credential sets grouped from vault key names (no value is read). */
export function storedCredentialSets(keyNames: readonly string[], drivers: readonly ReuseDriverInfo[], registrations: readonly ReuseRegistration[]): StoredCredentialSet[] {
  const groups = new Map<string, { lzId: string; scopeId: string; fields: Set<LzCredentialField> }>();
  for (const name of keyNames) {
    const k = parseLzCredentialKey(name);
    if (!k) continue;
    const id = `${k.lzId}:${k.scopeId}`;
    const g = groups.get(id) ?? { lzId: k.lzId, scopeId: k.scopeId, fields: new Set<LzCredentialField>() };
    g.fields.add(k.field);
    groups.set(id, g);
  }
  const out: StoredCredentialSet[] = [];
  for (const g of groups.values()) {
    const fields = [...g.fields].sort();
    const reg = registrations.find((r) => r.id === g.lzId);
    const scope = reg?.scopes.find((s) => s.id === g.scopeId);
    if (reg && scope) {
      out.push({ lzId: g.lzId, scopeId: g.scopeId, provider: reg.provider, auth: scope.auth, fields, basis: 'registration' });
      continue;
    }
    const fits = drivers.flatMap((d) => d.authMethods
      .filter((m) => m.required.every((f) => g.fields.has(f)) && fields.every((f) => m.required.includes(f) || m.optional.includes(f)))
      .map((m) => ({ provider: d.provider, auth: m.id })));
    if (fits.length === 1) out.push({ lzId: g.lzId, scopeId: g.scopeId, ...fits[0]!, fields, basis: 'fields' });
  }
  return out.sort((a, b) => `${a.lzId}:${a.scopeId}`.localeCompare(`${b.lzId}:${b.scopeId}`));
}

/**
 * The stored sets a new scope of `provider` with auth method `auth` can reuse:
 * same provider and auth method, every required field present, and not the
 * scope itself.
 */
export function reusableCredentialSets(
  keyNames: readonly string[],
  want: { provider: string; auth: ReuseAuthMethod; lzId?: string; scopeId?: string },
  drivers: readonly ReuseDriverInfo[],
  registrations: readonly ReuseRegistration[],
): StoredCredentialSet[] {
  return storedCredentialSets(keyNames, drivers, registrations).filter((s) =>
    s.provider === want.provider
    && s.auth === want.auth.id
    && want.auth.required.every((f) => s.fields.includes(f))
    && !(s.lzId === want.lzId && s.scopeId === want.scopeId));
}

/** Parses `<lz-id>:<scope-id>` (the --credentials-from value); null when malformed. */
export function parseCredentialsFrom(value: string): { lzId: string; scopeId: string } | null {
  const m = /^([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(value.trim());
  return m ? { lzId: m[1]!, scopeId: m[2]! } : null;
}

/**
 * Copies the credential fields of `from` that `auth` uses to the keys of `to`
 * (the source keys stay). Every required field must be stored under `from`.
 * Returns the copied field names; never a value.
 */
export async function copyLzCredentialSet(
  store: CredentialStore,
  from: { lzId: string; scopeId: string },
  to: { lzId: string; scopeId: string },
  auth: ReuseAuthMethod,
): Promise<LzCredentialField[]> {
  if (from.lzId === to.lzId && from.scopeId === to.scopeId) throw new Error(`the credentials of ${from.lzId}:${from.scopeId} cannot be copied onto themselves`);
  const values = new Map<LzCredentialField, string>();
  for (const f of [...auth.required, ...auth.optional]) {
    const v = await store.get(lzCredentialKey(from.lzId, from.scopeId, f));
    if (v !== null && v !== undefined && v !== '') values.set(f, v);
  }
  const missing = auth.required.filter((f) => !values.has(f));
  if (missing.length > 0) {
    throw new Error(`no stored credentials for ${from.lzId}:${from.scopeId} with auth method ${auth.id} (missing: ${missing.join(', ')})`);
  }
  for (const [f, v] of values) await store.set(lzCredentialKey(to.lzId, to.scopeId, f), v);
  return [...values.keys()];
}
