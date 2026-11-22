// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health Check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3589 (Design 120 sections 6.3, 14.2): health-check probe [26] "LZ
// connections". For every landing zone scope registered in .swao.yml it
// reports the offline state (live driver in this build, credential fields
// stored, token expired) and the live connection facts.
//
// #4233: the health check makes no network call. The read-only state and the
// coverage come from the last probe `runLzProbe` stored for the scope
// (`landing-zones/<lz-id>/wsp/last-probe.json`: `swao lz probe`, the Setup
// Probe step, `swao lz connect`, an LZ Live run), with its time and a stale mark after
// LZ_PROBE_STALE_DAYS; the services and resources read come from the last LZ
// Live run. The probe never fails the health check: a write-capable operator
// login is the expected setup of a test tenant (Design 126 Q-13, owner
// decision D-4), so it is a warning with the Probe step's words. Credential
// presence is shown by field name only; values and identities are never read
// into the result.

import { existsSync } from 'fs';
import { join } from 'path';
import { CredentialStore } from '@swao/core';
import {
  describeLandingZones,
  readLzLastRunFacts,
  readLzProbeRecords,
  registerBuiltInLiveLzDrivers,
} from '@swao/module-landing-zone';
import type { LzLastRunFacts } from '@swao/module-landing-zone';
import { WRITE_CAPABLE_ACCEPTED } from '@swao/tui-kit';

export type LzConnectionScopeState =
  | 'verified' | 'refused' | 'unverifiable' | 'login-failed' | 'not-probed'
  | 'credentials-missing' | 'token-expired' | 'no-driver' | 'unknown-auth';

export interface LzConnectionScopeResult {
  lz_id: string;
  scope_id: string;
  provider: string;
  state: LzConnectionScopeState;
  /** Coverage of the last probe: services the granted roles can and cannot read. */
  readable?: number;
  unreadable?: number;
  /** Short reason for a non-verified state; never a credential value. */
  reason?: string;
  /** #4233: time of the last stored probe (ISO). */
  probed_at?: string;
  /** #4233: the last probe is older than LZ_PROBE_STALE_DAYS. */
  stale?: boolean;
  /** #4233: credential field names stored in the vault (never values). */
  credentials_stored?: string[];
  /** #4233: what the last LZ Live run read for this scope. */
  last_run?: Pick<LzLastRunFacts, 'observed_at' | 'services' | 'resources'>;
}

export interface LzConnectionsProbeResult {
  status: 'ok' | 'warn' | 'info';
  message: string;
  scopes: LzConnectionScopeResult[];
}

export interface LzConnectionsProbeOptions {
  store?: CredentialStore;
  /** Clock for the stale mark and the token expiry (tests). */
  now?: Date;
}

/**
 * #4233: a stored probe older than this is marked stale. Seven days: roles
 * and logins of a tenant change between working weeks, and the Setup Probe
 * step or `swao lz probe` refreshes the record in seconds.
 */
export const LZ_PROBE_STALE_DAYS = 7;
const DAY_MS = 86_400_000;

/** How to refresh the stored probe (the Setup step in the TUI, `swao lz probe` in the CLI). */
export const LZ_PROBE_AGAIN = 'probe again: Setup, Landing Zone Live Assessment, Probe (or swao lz probe <lz-id>)';

export async function buildLzConnectionsProbe(workspacePath: string, opts: LzConnectionsProbeOptions = {}): Promise<LzConnectionsProbeResult> {
  if (!existsSync(join(workspacePath, '.swao.yml'))) {
    return { status: 'info', message: 'no workspace .swao.yml; no live landing zone registered', scopes: [] };
  }
  registerBuiltInLiveLzDrivers();
  const store = opts.store ?? new CredentialStore();
  const now = opts.now ?? new Date();
  let lzs;
  try {
    lzs = await describeLandingZones(workspacePath, store, now);
  } catch (e) {
    return { status: 'warn', message: `LZ connections cannot be read: ${(e as Error).message.replace(/^\[[^\]]+\] /, '')}`, scopes: [] };
  }
  if (lzs.length === 0) {
    return { status: 'info', message: 'no live landing zone registered (Landing Zone Live setup, or swao lz connect)', scopes: [] };
  }
  const scopes: LzConnectionScopeResult[] = [];
  for (const lz of lzs) {
    const probes = readLzProbeRecords(workspacePath, lz.id);
    const runs = readLzLastRunFacts(workspacePath, lz.id);
    for (const sc of lz.scopes) {
      const run = runs.get(sc.id);
      const base: LzConnectionScopeResult = {
        lz_id: lz.id,
        scope_id: sc.id,
        provider: lz.provider,
        state: 'not-probed',
        credentials_stored: [...sc.storedFields],
        ...(run ? { last_run: { observed_at: run.observed_at, services: run.services, resources: run.resources } } : {}),
      };
      switch (sc.credentials) {
        case 'no-driver': scopes.push({ ...base, state: 'no-driver', reason: `no live driver for ${lz.provider} in this build` }); continue;
        case 'unknown-auth': scopes.push({ ...base, state: 'unknown-auth', reason: `the driver has no auth method ${sc.auth}` }); continue;
        case 'missing': scopes.push({ ...base, state: 'credentials-missing', reason: `missing ${sc.missingFields.join(', ')}` }); continue;
        case 'expired': scopes.push({ ...base, state: 'token-expired', reason: 'refresh the token before a run' }); continue;
        case 'ok': break;
        default: {
          const never: never = sc.credentials;
          return never;
        }
      }
      const rec = probes.get(sc.id);
      if (!rec) {
        scopes.push({ ...base, state: 'not-probed' });
        continue;
      }
      const stale = now.getTime() - Date.parse(rec.probed_at) > LZ_PROBE_STALE_DAYS * DAY_MS;
      scopes.push({
        ...base,
        state: rec.read_only,
        // A refused login read nothing: no coverage.
        ...(rec.read_only !== 'login-failed' ? { readable: rec.readable, unreadable: rec.unreadable } : {}),
        probed_at: rec.probed_at,
        ...(stale ? { stale: true } : {}),
        ...(rec.reason ? { reason: rec.reason } : {}),
      });
    }
  }
  const count = (st: LzConnectionScopeState): number => scopes.filter((s) => s.state === st).length;
  const verified = count('verified');
  const stale = scopes.filter((s) => s.stale).length;
  const status = verified === scopes.length && stale === 0 ? 'ok' : 'warn';
  return { status, message: lzConnectionsMessage(lzs.length, scopes.length, verified, count, stale), scopes };
}

const plural = (k: number, one: string, many = `${one}s`): string => `${k} ${k === 1 ? one : many}`;

/** #4233: the probe line message names why it warns (one clause per cause). */
function lzConnectionsMessage(
  lzCount: number,
  scopeCount: number,
  verified: number,
  count: (st: LzConnectionScopeState) => number,
  stale: number,
): string {
  const why: string[] = [];
  const add = (k: number, text: string): void => { if (k > 0) why.push(`${plural(k, 'scope')} ${text}`); };
  add(count('refused'), 'with a write-capable login (a run asks for confirmation)');
  add(count('unverifiable'), 'not verifiable as read-only (a run asks to accept the login)');
  add(count('login-failed'), 'whose login the provider refused at the last probe');
  add(count('not-probed'), 'not probed yet');
  add(count('credentials-missing'), 'with credentials missing');
  add(count('token-expired'), 'with an expired token');
  add(count('no-driver') + count('unknown-auth'), 'without a usable live driver');
  if (stale > 0) why.push(`${plural(stale, 'probe')} older than ${LZ_PROBE_STALE_DAYS} days`);
  const head = `${plural(lzCount, 'landing zone')}, ${plural(scopeCount, 'scope')}: ${verified} read-only verified`;
  return why.length > 0 ? `${head}; ${why.join('; ')}` : head;
}

/** `2026-11-10 08:05 UTC` from an ISO time (the input as is when it does not parse). */
function shortTime(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC` : iso;
}

/** #4233: the state in the Setup Probe step's words (lz-live-steps.tsx probeRow; D-4 for write-capable). */
export function lzScopeStateWords(s: Pick<LzConnectionScopeResult, 'state' | 'reason'>): string {
  switch (s.state) {
    case 'verified': return 'read-only verified';
    case 'refused': return WRITE_CAPABLE_ACCEPTED.text;
    case 'unverifiable': return 'read-only unverifiable; a run asks you to accept the login';
    case 'login-failed': return `login failed${s.reason ? ` (${s.reason})` : ''}; check the stored login`;
    case 'not-probed': return 'not probed yet';
    case 'credentials-missing': return `credentials incomplete (${s.reason ?? 'fields missing'})`;
    case 'token-expired': return 'token expired; refresh it before a run';
    case 'no-driver': return s.reason ?? 'no live driver in this build';
    case 'unknown-auth': return s.reason ?? 'unknown auth method';
  }
}

/**
 * #4233: the continuation lines of one scope (no identity, no values): the
 * state in words, then the facts (coverage, last probe with its stale mark,
 * credential field names, last run).
 */
export function formatLzConnectionScopeLines(s: LzConnectionScopeResult): string[] {
  const name = `${s.lz_id}/${s.scope_id}`;
  const facts: string[] = [];
  if (s.readable !== undefined) facts.push(`coverage ${s.readable} readable${s.unreadable ? ` / ${s.unreadable} not readable` : ''}`);
  if (s.probed_at) facts.push(`probed ${shortTime(s.probed_at)}${s.stale ? ` (stale: older than ${LZ_PROBE_STALE_DAYS} days; ${LZ_PROBE_AGAIN})` : ''}`);
  else if (s.state === 'not-probed') facts.push(LZ_PROBE_AGAIN);
  if (s.credentials_stored) facts.push(s.credentials_stored.length > 0 ? `credentials stored: ${s.credentials_stored.join(', ')}` : 'no credentials stored');
  if (s.last_run) facts.push(`last run ${shortTime(s.last_run.observed_at)}: ${plural(s.last_run.services, 'service')}, ${plural(s.last_run.resources, 'resource')} read`);
  const reason = (s.state === 'refused' || s.state === 'unverifiable') && s.reason ? `; ${s.reason}` : '';
  const first = `${name} (${s.provider}): ${lzScopeStateWords(s)}${reason}`;
  return facts.length > 0 ? [first, `${name}: ${facts.join('; ')}`] : [first];
}
