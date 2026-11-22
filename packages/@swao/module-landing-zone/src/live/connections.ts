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

// #3589: Landing Zone Connections (Design 120 section 14.2, the Landing Zone Live setup and
// the Workspace Setup optional step). The functions here are shared by the
// CLI (`swao lz list`, `swao lz remove`), the TUI screen and the health-check
// probe, so every surface reports and changes the same state:
//   describeLandingZones = registered landing zones and scopes with the
//                          offline connection state (driver in this build,
//                          auth method known, credential fields stored or
//                          missing, token expired); field NAMES only, values
//                          are never returned
//   runLzRemove          = remove a scope or a landing zone from .swao.yml and
//                          delete its scoped vault keys lz:<lz>:<scope>:*
//   legacyCredentialCounts = Pass 23 keys still in the vault, per provider

import {
  CredentialStore,
  LzCredentialExpiredError,
  LzCredentialMissingError,
  findLegacyLzCredentialKeys,
  parseLzCredentialKey,
  resolveLzCredentials,
  logPortfolio,
} from '@swao/core';
import type { LzCredentialField } from '@swao/core';
import { getLiveLzDriver } from './registry.js';
import type { LiveLzDriver } from './types.js';
import { readLandingZones, removeRegistration, writeLandingZones } from './session.js';
import type { RemoveOutcome } from './session.js';

/** Offline state of one scope's credentials. */
export type LzScopeCredentialState = 'ok' | 'missing' | 'expired' | 'unknown-auth' | 'no-driver';

export interface LzScopeConnection {
  id: string;
  kind: 'platform' | 'application';
  auth: string;
  regions: string[];
  /** Scope locator (project, subscription, account, resource_group, folder). */
  target?: Partial<Record<'project' | 'subscription' | 'account' | 'resource_group' | 'folder', string>>;
  app?: string;
  /** Field names stored in the vault for this scope (never values). */
  storedFields: LzCredentialField[];
  /** Required field names of the auth method that are not stored. */
  missingFields: LzCredentialField[];
  credentials: LzScopeCredentialState;
}

export interface LzConnection {
  id: string;
  provider: string;
  display?: string;
  /** The provider's live driver is registered in this build (Q-21 gate). */
  driverAvailable: boolean;
  scopes: LzScopeConnection[];
}

/**
 * Registered landing zones with the offline connection state of each scope.
 * Reads `.swao.yml` (throws LzLiveError when invalid) and the vault key names;
 * the only value read is through resolveLzCredentials, which checks
 * `expires-at` and the required fields and is discarded at once.
 */
export async function describeLandingZones(
  workspaceRoot: string,
  store: CredentialStore,
  now: Date = new Date(),
  /** Driver lookup; default the live driver registry. The TUI passes the list it offers. */
  driverOf: (provider: string) => Pick<LiveLzDriver, 'authMethods'> | undefined = getLiveLzDriver,
): Promise<LzConnection[]> {
  // Registrations first: without a landing zone the vault is never opened.
  const registered = readLandingZones(workspaceRoot);
  if (registered.length === 0) return [];
  const names = await store.list();
  const stored = new Map<string, LzCredentialField[]>();
  for (const n of names) {
    const k = parseLzCredentialKey(n);
    if (!k) continue;
    const id = `${k.lzId}:${k.scopeId}`;
    stored.set(id, [...(stored.get(id) ?? []), k.field]);
  }
  const out: LzConnection[] = [];
  for (const lz of registered) {
    const driver = driverOf(lz.provider);
    const scopes: LzScopeConnection[] = [];
    for (const sc of lz.scopes) {
      const storedFields = [...(stored.get(`${lz.id}:${sc.id}`) ?? [])].sort();
      const method = driver?.authMethods.find((m) => m.id === sc.auth);
      let credentials: LzScopeCredentialState;
      let missingFields: LzCredentialField[] = [];
      if (!driver) credentials = 'no-driver';
      else if (!method) credentials = 'unknown-auth';
      else {
        try {
          await resolveLzCredentials(store, lz.id, sc.id, method.required, method.optional, now);
          credentials = 'ok';
        } catch (err) {
          if (err instanceof LzCredentialExpiredError) credentials = 'expired';
          else if (err instanceof LzCredentialMissingError) {
            credentials = 'missing';
            missingFields = err.keys.map((key) => parseLzCredentialKey(key)?.field).filter((f): f is LzCredentialField => f !== undefined);
          } else throw err;
        }
      }
      scopes.push({
        id: sc.id,
        kind: sc.kind,
        auth: sc.auth,
        regions: sc.regions ?? [],
        ...(sc.target && Object.keys(sc.target).length > 0 ? { target: { ...sc.target } } : {}),
        ...(sc.app ? { app: sc.app } : {}),
        storedFields,
        missingFields,
        credentials,
      });
    }
    out.push({ id: lz.id, provider: lz.provider, ...(lz.display ? { display: lz.display } : {}), driverAvailable: driver !== undefined, scopes });
  }
  return out;
}

/** One line per landing zone and scope, the text of `swao lz list` (no values). */
export function formatLandingZones(lzs: readonly LzConnection[]): string[] {
  if (lzs.length === 0) return ['no landing zones registered; add one with swao lz connect <lz-id> --provider <p> --scope <id> --kind platform|application --auth <method>'];
  const lines: string[] = [];
  for (const lz of lzs) {
    lines.push(`landing zone ${lz.id} (${lz.provider}${lz.display ? `, ${lz.display}` : ''})${lz.driverAvailable ? '' : ': no live driver for this provider in this build'}`);
    for (const sc of lz.scopes) {
      const creds = sc.credentials === 'ok' ? `credentials stored (${sc.storedFields.length} field(s))`
        : sc.credentials === 'missing' ? `credentials missing: ${sc.missingFields.join(', ')}`
        : sc.credentials === 'expired' ? 'token expired, refresh it before a run'
        : sc.credentials === 'unknown-auth' ? `the driver has no auth method ${sc.auth}`
        : 'not checked (no driver)';
      lines.push(`  scope ${sc.id}: ${sc.kind}, auth ${sc.auth}${sc.regions.length > 0 ? `, regions ${sc.regions.join(', ')}` : ''}${sc.app ? `, app ${sc.app}` : ''}; ${creds}`);
    }
  }
  return lines;
}

/** Legacy Pass 23 keys per provider (counts only; names stay in the vault). */
export function legacyCredentialCounts(store: CredentialStore): { aws: number; azure: number } {
  return { aws: findLegacyLzCredentialKeys(store, 'aws').length, azure: findLegacyLzCredentialKeys(store, 'azure').length };
}

export interface RemoveOptions {
  workspaceRoot: string;
  store: CredentialStore;
  lzId: string;
  scopeId?: string;
}

export interface RemoveResult {
  outcome: RemoveOutcome;
  removedScopes: string[];
  /** Number of scoped vault keys deleted (names logged, never values). */
  deletedKeys: number;
}

/**
 * Remove a scope (or the landing zone) from `.swao.yml`, then delete its
 * scoped vault keys `lz:<lz-id>:<scope-id>:<field>`. The landing zone's
 * pseudonym salt (`lz:<lz-id>:pseudonym-salt`) and the run data under
 * `landing-zones/<lz-id>/` are kept, so earlier runs stay readable and a
 * re-registered landing zone keeps its pseudonyms (Design 120 section 6.4).
 */
export async function runLzRemove(opts: RemoveOptions): Promise<RemoveResult> {
  const { lzs, outcome, removedScopes } = removeRegistration(readLandingZones(opts.workspaceRoot), opts.lzId, opts.scopeId);
  writeLandingZones(opts.workspaceRoot, lzs);
  const removed = new Set(removedScopes);
  let deletedKeys = 0;
  for (const name of Object.keys(opts.store.loadSync())) {
    const k = parseLzCredentialKey(name);
    if (!k || k.lzId !== opts.lzId || !removed.has(k.scopeId)) continue;
    if (await opts.store.delete(name)) deletedKeys++;
  }
  logPortfolio('info', 'lz.live.remove', 'Landing zone registration removed', {
    context: { lz_id: opts.lzId, outcome, scopes: removedScopes, deleted_keys: deletedKeys },
  });
  return { outcome, removedScopes, deletedKeys };
}
