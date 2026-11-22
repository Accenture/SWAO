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

// #3571: `swao lz connect` and `swao lz probe` (Design 120 section 13.2).
//   connect = register the scope in `.swao.yml` landing_zones[], store its
//             credentials in the vault, move legacy Pass 23 keys (#3570), probe
//   probe   = identity, read-only result, coverage per scope
// The read-only gate (Design 120 section 6.3): `refused` stops unless the
// per-run flag --accept-write-capable-credentials is passed, `unverifiable`
// stops unless --accept-unverified-read-only is passed. Both flags exist only
// as CLI options; `.swao.yml` cannot carry them (strict schema). The gate
// result is the run-manifest stamp (flag, probe result, reason).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import {
  CredentialStore,
  LZ_CREDENTIAL_FIELDS,
  SwaoYmlLandingZonesSchema,
  findLegacyLzCredentialKeys,
  lzCredentialKey,
  moveLegacyLzCredentials,
  resolveLzCredentials,
  logPortfolio,
  maskNativeIds,
  LzCredentialExpiredError,
  LzCredentialMissingError,
} from '@swao/core';
import { LzLiveReadOnlyOverrideSchema, lzSessionExpiry, patchSwaoYmlText, LZ_ACCEPT_WRITE_CAPABLE_PHRASE, LZ_ACCEPT_UNVERIFIED_PHRASE } from '@swao/core';
import type { LzCredentialField, LzLiveSource, LzScopePurpose } from '@swao/core';
import type { z } from 'zod';
import { getLiveLzDriver, registeredLiveLzProviders } from './registry.js';
import { AuthFailureLatch, createReadOnlyFetch } from './http.js';
import { resolveEndpoints } from './endpoints.js';
import type { EndpointOverride } from './endpoints.js';
import { RECORD_ENV, createRecordingFetch, routeOf } from './record.js';
import type { Recorder } from './record.js';
import { SimulationEvidence, createSimulationEvidenceFetch } from './simulation.js';
import { createThrottleRetryFetch } from './retry.js';
import { ReadOnlyProbeSchema } from './types.js';
import type { FetchLike, LiveLzDriver, LogArchiveOutcome, LogArchiveRef, LogArchiveUnavailable, ReadOnlyProbe, ScopeCtx } from './types.js';
import { LiveAuthError } from './errors.js';
import { copyLzCredentialSet } from './credential-reuse.js';
import { recordLzProbe } from './probe-record.js';

type LzLiveReadOnlyOverride = z.infer<typeof LzLiveReadOnlyOverrideSchema>;
type LzRegistration = ReturnType<typeof SwaoYmlLandingZonesSchema.parse>[number];
type LzScope = LzRegistration['scopes'][number];

export class LzLiveError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(`[lz live] ${message}`);
    this.name = 'LzLiveError';
  }
}

// ---------------------------------------------------------------------------
// Read-only gate
// ---------------------------------------------------------------------------

export interface ReadOnlyFlags {
  acceptUnverifiedReadOnly?: boolean;
  acceptWriteCapableCredentials?: boolean;
}

export const WRITE_CAPABLE_ACCEPTED_REASON = 'write-capable credential accepted by operator';
export const UNVERIFIED_ACCEPTED_REASON = 'unverifiable read-only result accepted by operator';

export interface ReadOnlyGate {
  proceed: boolean;
  exitCode: 0 | 1;
  /** Run-manifest stamp (Design 120 section 6.3, LzLiveMeta read_only fields). */
  manifest: {
    read_only: ReadOnlyProbe['read_only'];
    read_only_overrides: LzLiveReadOnlyOverride[];
    read_only_reason?: string;
    probe_reason?: string;
  };
  message: string;
}

/** The display level of a probed scope, shared by the screens and the `lz.live.probe` log event. */
export type ProbeDisplayLevel = 'ok' | 'warn' | 'fail';

/**
 * #4298: one rule for the level of a probe result. A login that reads nothing
 * (0 readable routes) is `fail`; a verified read-only login is `ok`; a
 * write-capable (`refused`) or unverifiable login is `warn`, because a run
 * accepts it with a confirmation and SWAO only reads. A probe that cannot
 * sign in returns no result at all and is `fail` on the screen.
 */
export function probeDisplayLevel(readOnly: ReadOnlyProbe['read_only'], readable: number | undefined): ProbeDisplayLevel {
  if (readable === 0) return 'fail';
  switch (readOnly) {
    case 'verified': return 'ok';
    case 'refused':
    case 'unverifiable':
      return 'warn';
    default: {
      const never: never = readOnly;
      return never;
    }
  }
}

export function evaluateReadOnlyGate(probe: ReadOnlyProbe, flags: ReadOnlyFlags): ReadOnlyGate {
  const base = { read_only: probe.read_only, probe_reason: probe.reason };
  switch (probe.read_only) {
    case 'verified':
      return { proceed: true, exitCode: 0, manifest: { ...base, read_only_overrides: [] }, message: 'read-only verified' };
    case 'refused':
      if (flags.acceptWriteCapableCredentials === true) {
        return {
          proceed: true,
          exitCode: 0,
          manifest: { ...base, read_only_overrides: ['accept-write-capable-credentials'], read_only_reason: WRITE_CAPABLE_ACCEPTED_REASON },
          message: `credential is write-capable (${probe.reason ?? 'no reason given'}); proceeding because --accept-write-capable-credentials was passed. SWAO still sends read requests only.`,
        };
      }
      return {
        proceed: false,
        exitCode: 1,
        manifest: { ...base, read_only_overrides: [] },
        message: `credential is write-capable (${probe.reason ?? 'no reason given'}${probe.write_actions_allowed.length > 0 ? `; allows ${probe.write_actions_allowed.join(', ')}` : ''}). Use a read-only role (see the driver ROLES.md), ${LZ_ACCEPT_WRITE_CAPABLE_PHRASE}`,
      };
    case 'unverifiable':
      if (flags.acceptUnverifiedReadOnly === true) {
        return {
          proceed: true,
          exitCode: 0,
          manifest: { ...base, read_only_overrides: ['accept-unverified-read-only'], read_only_reason: UNVERIFIED_ACCEPTED_REASON },
          message: `read-only could not be verified (${probe.reason ?? 'no reason given'}); proceeding because --accept-unverified-read-only was passed.`,
        };
      }
      return {
        proceed: false,
        exitCode: 1,
        manifest: { ...base, read_only_overrides: [] },
        message: `read-only could not be verified (${probe.reason ?? 'no reason given'}). ${LZ_ACCEPT_UNVERIFIED_PHRASE}`,
      };
  }
}

// ---------------------------------------------------------------------------
// Workspace registration (.swao.yml landing_zones[])
// ---------------------------------------------------------------------------

const SWAO_YML = '.swao.yml';

export function readLandingZones(workspaceRoot: string): LzRegistration[] {
  const file = join(workspaceRoot, SWAO_YML);
  if (!existsSync(file)) throw new LzLiveError(`no ${SWAO_YML} in ${workspaceRoot}; run swao init first`);
  const doc = (yamlLoad(readFileSync(file, 'utf-8')) ?? {}) as Record<string, unknown>;
  const r = SwaoYmlLandingZonesSchema.safeParse(doc['landing_zones'] ?? []);
  if (!r.success) {
    throw new LzLiveError(`${SWAO_YML} landing_zones is invalid: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return r.data;
}

/**
 * Replace (or append) the top-level `landing_zones:` block of `.swao.yml` with
 * `lzs`. Only that block is rewritten; comments and keys elsewhere in the
 * file are kept byte for byte.
 */
export function writeLandingZones(workspaceRoot: string, lzs: LzRegistration[]): void {
  const parsed = SwaoYmlLandingZonesSchema.safeParse(lzs);
  if (!parsed.success) throw new LzLiveError(`refusing to write an invalid landing_zones block: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  const file = join(workspaceRoot, SWAO_YML);
  const text = readFileSync(file, 'utf-8');
  // #4283 (b): the central minimal-patch writer of @swao/core; an empty list removes
  // the key (#3589). The line rewrite below stays only as the fallback when the
  // helper refuses the file.
  const patched = patchSwaoYmlText(text, [{ path: ['landing_zones'], value: parsed.data.length === 0 ? undefined : parsed.data }]);
  if (patched.ok) {
    if (patched.changed) writeFileSync(file, patched.text);
    return;
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  // #3589: an empty list drops the key (the last landing zone was removed), so
  // the file never holds `landing_zones: []`; a hand-written flow-style
  // `landing_zones: []` line is found and replaced instead of duplicated.
  const block = parsed.data.length === 0 ? '' : yamlDump({ landing_zones: parsed.data }, { lineWidth: 120, noRefs: true }).trimEnd().split('\n').join(eol) + eol;
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^landing_zones:\s*(\[\s*\])?\s*(#.*)?$/.test(l));
  let out: string;
  if (start === -1) {
    if (block === '') return;
    out = text.replace(/(\r?\n)*$/, '') + eol + eol + block;
  } else {
    const flow = /\[\s*\]/.test(lines[start] as string);
    let end = start + 1;
    while (!flow && end < lines.length && (lines[end] === '' || /^[\s#-]/.test(lines[end] as string))) end++;
    // keep trailing blank lines / comments that belong to the next key
    while (end > start + 1 && /^\s*(#.*)?$/.test(lines[end - 1] as string)) end--;
    const before = lines.slice(0, start).join(eol);
    const after = lines.slice(end).join(eol);
    out = (before === '' ? '' : before + eol) + block + after;
  }
  writeFileSync(file, out);
}

export type UpsertOutcome = 'landing-zone-added' | 'scope-added' | 'scope-updated' | 'unchanged';

/**
 * Add or replace one scope. `display` (#3589, Design 120 section 14.2 "Add
 * landing zone (provider, display name)") sets the display name of the
 * landing zone when given; omitted, an existing display name is kept.
 */
export function upsertScope(lzs: LzRegistration[], lzId: string, provider: string, scope: LzScope, display?: string): { lzs: LzRegistration[]; outcome: UpsertOutcome } {
  const next = lzs.map((l) => ({ ...l, scopes: [...l.scopes] }));
  const lz = next.find((l) => l.id === lzId);
  if (!lz) {
    next.push({ id: lzId, provider, ...(display ? { display } : {}), scopes: [scope] });
    return { lzs: next, outcome: 'landing-zone-added' };
  }
  if (lz.provider !== provider) throw new LzLiveError(`landing zone ${lzId} is registered with provider ${lz.provider}, not ${provider}`);
  const displayChanged = display !== undefined && display !== '' && lz.display !== display;
  if (displayChanged) lz.display = display;
  const i = lz.scopes.findIndex((s) => s.id === scope.id);
  if (i === -1) {
    lz.scopes.push(scope);
    return { lzs: next, outcome: 'scope-added' };
  }
  const same = JSON.stringify(lz.scopes[i]) === JSON.stringify(scope);
  lz.scopes[i] = scope;
  return { lzs: next, outcome: same && !displayChanged ? 'unchanged' : 'scope-updated' };
}

export type RemoveOutcome = 'scope-removed' | 'landing-zone-removed';

/**
 * #3589: remove one scope, or the whole landing zone when `scopeId` is
 * omitted. Removing the last scope removes the landing zone, because a
 * registration needs at least one scope (SwaoYmlLzRegistrationSchema).
 */
export function removeRegistration(lzs: LzRegistration[], lzId: string, scopeId?: string): { lzs: LzRegistration[]; outcome: RemoveOutcome; removedScopes: string[] } {
  const lz = lzs.find((l) => l.id === lzId);
  if (!lz) throw new LzLiveError(`landing zone ${lzId} is not registered in .swao.yml`);
  if (scopeId !== undefined) {
    if (!lz.scopes.some((s) => s.id === scopeId)) throw new LzLiveError(`landing zone ${lzId} has no scope ${scopeId}`);
    if (lz.scopes.length > 1) {
      return {
        lzs: lzs.map((l) => (l.id === lzId ? { ...l, scopes: l.scopes.filter((s) => s.id !== scopeId) } : l)),
        outcome: 'scope-removed',
        removedScopes: [scopeId],
      };
    }
  }
  return { lzs: lzs.filter((l) => l.id !== lzId), outcome: 'landing-zone-removed', removedScopes: lz.scopes.map((s) => s.id) };
}

// ---------------------------------------------------------------------------
// Scope context
// ---------------------------------------------------------------------------

export interface ScopeCtxOptions {
  store: CredentialStore;
  env?: NodeJS.ProcessEnv;
  /** Injected transport (tests, mock CSP); defaults to the global fetch. */
  fetchImpl?: FetchLike;
  /** Recording label, never a user name (Design 121 section 13.2). */
  identityLabel?: string;
}

export interface BuiltScopeCtx {
  ctx: ScopeCtx;
  endpointOverrides: EndpointOverride[];
  recorder: Recorder | null;
  /** #3596: simulation evidence of this scope run (Design 121 section 10). */
  simulation: SimulationEvidence;
  /** #3750 / #3803: the first refused token of this scope run (http.ts); checked between driver methods. */
  authFailures: AuthFailureLatch;
}

function driverFor(provider: string): LiveLzDriver {
  const d = getLiveLzDriver(provider);
  if (!d) {
    const known = registeredLiveLzProviders();
    throw new LzLiveError(`no live driver for provider ${provider} (available: ${known.length > 0 ? known.join(', ') : 'none yet'})`);
  }
  return d;
}

const globalFetch: FetchLike = (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;

/**
 * Build the driver context. Order matters: endpoint overrides are checked
 * first (a non-loopback override fails before credentials are read), then the
 * credentials (an expired token fails before any request), then the
 * transport is wrapped: allow-list outermost, then the simulation evidence
 * observer (#3596), the 429 retry (#3751), recorder inside it, so a refused
 * request is neither sent, observed nor recorded, and every retried attempt
 * is recorded. An endpoint override marks the run simulated.
 */
export async function buildScopeCtx(lz: LzRegistration, scope: LzScope, opts: ScopeCtxOptions): Promise<BuiltScopeCtx> {
  const env = opts.env ?? process.env;
  const driver = driverFor(lz.provider);
  const method = driver.authMethods.find((m) => m.id === scope.auth);
  if (!method) {
    throw new LzLiveError(`the ${lz.provider} driver has no auth method ${scope.auth} (methods: ${driver.authMethods.map((m) => m.id).join(', ')})`);
  }
  const endpoints = resolveEndpoints(lz.provider, driver.defaultBaseUrls, env);
  const credentials = await resolveLzCredentials(opts.store, lz.id, scope.id, method.required, method.optional);
  let transport = opts.fetchImpl ?? globalFetch;
  let recorder: Recorder | null = null;
  const recordRoot = env[RECORD_ENV];
  if (recordRoot !== undefined && recordRoot !== '') {
    recorder = createRecordingFetch(transport, {
      root: recordRoot,
      provider: lz.provider,
      scopeId: scope.id,
      identity: opts.identityLabel ?? 'operator',
      driverVersion: driver.driverVersion,
      routeTemplates: driver.routeTemplates,
      ...(driver.routeHostPrefixes ? { routeHostPrefixes: driver.routeHostPrefixes } : {}), // #3995
      ...(driver.regionOf ? { regionOf: (u: URL, init?: { headers?: Record<string, string> }) => driver.regionOf?.(u.toString(), init) ?? null } : {}),
    });
    transport = recorder.fetch;
  }
  // #3751 / #3804: a 429 is retried after its Retry-After, bounded (retry.ts),
  // for every driver; outside the recorder, so each attempt is recorded.
  transport = createThrottleRetryFetch(transport, {
    onRetry: ({ attempt, waitS, method, status }) => logPortfolio('info', 'lz.live.throttled', 'Landing zone API asked to retry later; retrying after Retry-After', { context: { lz_id: lz.id, scope_id: scope.id, status, attempt, wait_s: waitS, method } }),
  });
  const simulation = new SimulationEvidence();
  if (endpoints.overrides.length > 0) simulation.markEndpointOverride();
  transport = createSimulationEvidenceFetch(transport, simulation);
  const authFailures = new AuthFailureLatch();
  const ctx: ScopeCtx = {
    lzId: lz.id,
    provider: lz.provider,
    scopeId: scope.id,
    scopeKind: scope.kind,
    ...(scope.purpose === 'log-archive' ? { isLogArchive: true as const } : {}),
    auth: scope.auth,
    regions: scope.regions ?? [],
    target: Object.fromEntries(Object.entries(scope.target ?? {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
    credentials: credentials as ScopeCtx['credentials'],
    http: { fetch: createReadOnlyFetch(transport, lz.provider, driver.readAllowList, { latch: authFailures, routeOf: (p) => routeOf(p, driver.routeTemplates) }), baseUrls: endpoints.baseUrls },
    sources: [],
  };
  return { ctx, endpointOverrides: endpoints.overrides, recorder, simulation, authFailures };
}

/**
 * #3975 (Design 123 section 5.4): the log archive scope of `lz` as seen from
 * `scope`, or undefined when the landing zone registers none (or `scope` is
 * the log archive itself). `open()` runs once: it builds the archive's
 * context (allow-list, recorder, latch), probes it and applies the same
 * read-only gate and run flags as any scope (Design 120 section 6.3), so a
 * write-capable archive login is never used without
 * --accept-write-capable-credentials. Every failure is an `unavailable`
 * reason, never an exception: the scope that reads through the archive still
 * completes. `onBuilt` receives the built context (the caller finishes its
 * recorder).
 */
export function logArchiveRef(lz: LzRegistration, scope: LzScope, opts: ScopeCtxOptions & ReadOnlyFlags, onBuilt: (built: BuiltScopeCtx) => void): LogArchiveRef | undefined {
  const archive = lz.scopes.find((s) => s.purpose === 'log-archive');
  if (!archive || archive.id === scope.id) return undefined;
  let opened: Promise<{ ctx: ScopeCtx } | { unavailable: LogArchiveUnavailable }> | undefined;
  // #4091: the gate result, kept for the reading scope's run record.
  let outcome: LogArchiveOutcome | undefined;
  const unavailable = (why: LogArchiveUnavailable, read_only?: ReadOnlyProbe['read_only']): { unavailable: LogArchiveUnavailable } => {
    outcome = { opened: false, unavailable: why, ...(read_only ? { read_only } : {}) };
    return { unavailable: why };
  };
  const open = async (): Promise<{ ctx: ScopeCtx } | { unavailable: LogArchiveUnavailable }> => {
    let built: BuiltScopeCtx;
    try {
      built = await buildScopeCtx(lz, archive, opts);
    } catch (err) {
      if (err instanceof LzCredentialExpiredError) return unavailable('login_expired');
      if (err instanceof LzCredentialMissingError) return unavailable('login_missing');
      return unavailable('not_opened');
    }
    onBuilt(built);
    try {
      const probe = ReadOnlyProbeSchema.parse(await driverFor(lz.provider).probeReadOnly(built.ctx));
      built.authFailures.throwIfFailed();
      const gate = evaluateReadOnlyGate(probe, opts);
      if (!gate.proceed) return unavailable(probe.read_only === 'unverifiable' ? 'read_only_unverifiable' : 'read_only_refused', probe.read_only);
      logPortfolio('info', 'lz.live.log_archive.opened', 'Log archive scope opened for audit log store reads', { context: { lz_id: lz.id, scope_id: scope.id, log_archive_scope: archive.id, read_only: probe.read_only } });
      outcome = { opened: true, read_only: gate.manifest.read_only, read_only_overrides: [...gate.manifest.read_only_overrides], ...(gate.manifest.read_only_reason ? { read_only_reason: gate.manifest.read_only_reason } : {}) };
      return { ctx: built.ctx };
    } catch (err) {
      return unavailable(err instanceof LiveAuthError ? 'login_rejected' : 'not_opened');
    }
  };
  return { scopeId: archive.id, open: () => (opened ??= open()), outcome: () => outcome };
}

/**
 * #4091 (Design 120 section 6.3): the log archive's gate as a source of the
 * reading scope (`meta.sources`, name `log-archive:<scope id>`), so a run
 * that read through a write-capable archive login records the flag, the
 * probe result and the reason even when the archive scope is not run itself.
 * Undefined when the archive was never opened.
 */
export function logArchiveSource(ref: LogArchiveRef | undefined): LzLiveSource | undefined {
  const o = ref?.outcome();
  if (!ref || !o) return undefined;
  const name = `log-archive:${ref.scopeId}`;
  if (!o.opened) return { name, status: 'not_collected', reason: o.read_only ? `${o.unavailable} (read_only ${o.read_only})` : o.unavailable };
  const overrides = o.read_only_overrides.length > 0 ? o.read_only_overrides.join(', ') : 'none';
  // #4059: this reason format is parsed by publication-render
  // (lz-live-extractor.ts `parseLogArchiveSource`) for the footer; keep both in step.
  return { name, status: 'ok', reason: `read_only ${o.read_only}; overrides ${overrides}${o.read_only_reason ? `; ${o.read_only_reason}` : ''}` };
}

/** #4059: the log archive's gate as recorded in the run manifest (`scopes[].log_archive`). */
export type LogArchiveManifestEntry =
  | { scope_id: string; opened: true; read_only: ReadOnlyProbe['read_only']; read_only_overrides: string[]; read_only_reason?: string }
  | { scope_id: string; opened: false; unavailable: LogArchiveUnavailable; read_only?: ReadOnlyProbe['read_only'] };

/**
 * #4059 (Design 120 section 6.3): the log archive's gate for the reading
 * scope's run manifest entry. Fields are named explicitly: the probe's own
 * reason (it can name roles or actions) and native ids never enter it.
 * Undefined when the archive was never opened.
 */
export function logArchiveManifest(ref: LogArchiveRef | undefined): LogArchiveManifestEntry | undefined {
  const o = ref?.outcome();
  if (!ref || !o) return undefined;
  if (!o.opened) return { scope_id: ref.scopeId, opened: false, unavailable: o.unavailable, ...(o.read_only ? { read_only: o.read_only } : {}) };
  return { scope_id: ref.scopeId, opened: true, read_only: o.read_only, read_only_overrides: [...o.read_only_overrides], ...(o.read_only_reason ? { read_only_reason: o.read_only_reason } : {}) };
}

// ---------------------------------------------------------------------------
// probe
// ---------------------------------------------------------------------------

export interface ScopeProbeResult {
  scopeId: string;
  probe: ReadOnlyProbe;
  gate: ReadOnlyGate;
  endpointOverrides: EndpointOverride[];
  recordingDir: string | null;
}

export interface ProbeOptions extends ScopeCtxOptions, ReadOnlyFlags {
  workspaceRoot: string;
  lzId: string;
  scopeId?: string;
  /**
   * #4265: who asked for the probe (`lz.probe`, `lz.connect`,
   * `health-check.lz_connections`, `wizard.lz-live.probe`), logged on
   * `lz.live.probe` so repeated probes in one session are told apart.
   */
  caller?: string;
}

/** #4265: the operator's options when the read-only gate stops a scope; undefined when it proceeds. */
export function probeOverrideHint(probe: ReadOnlyProbe, gate: ReadOnlyGate): string | undefined {
  if (gate.proceed) return undefined;
  switch (probe.read_only) {
    case 'refused':
      return 'use a read-only role (see the driver ROLES.md), or confirm the write-capable login for this run: --accept-write-capable-credentials, or the write-capable confirmation in the LZ Live Assessment screen';
    case 'unverifiable':
      return 'pass --accept-unverified-read-only for this run, or confirm the unverified login in the LZ Live Assessment screen';
    case 'verified':
      return undefined;
  }
}

/** Longest reason and permission text on the probe event (characters). */
const PROBE_LOG_TEXT_MAX = 300;
/** Most detected write permissions listed on the probe event. */
const PROBE_LOG_PERMISSIONS_MAX = 10;

/**
 * #4265 (Design 120 section 6.4): context of the `lz.live.probe` event. The
 * driver reason and the detected write permissions are masked with
 * maskNativeIds, so no account id, project id or ARN reaches the log; the
 * line names the operator-chosen landing zone and scope ids only.
 */
export function probeLogContext(args: {
  lzId: string;
  scopeId: string;
  probe: ReadOnlyProbe;
  gate: ReadOnlyGate;
  caller: string;
  durationMs: number;
}): Record<string, unknown> {
  const { probe, gate } = args;
  const clip = (s: string): string => (s.length > PROBE_LOG_TEXT_MAX ? `${s.slice(0, PROBE_LOG_TEXT_MAX - 3)}...` : s);
  const hint = probeOverrideHint(probe, gate);
  const permissions = probe.write_actions_allowed.slice(0, PROBE_LOG_PERMISSIONS_MAX).map((a) => clip(maskNativeIds(a)));
  return {
    lz_id: args.lzId,
    scope_id: args.scopeId,
    caller: args.caller,
    read_only: probe.read_only,
    // #4298: the level the screens show for this result, so the log and the screen agree.
    display_level: probeDisplayLevel(probe.read_only, probe.coverage.readable.length),
    ...(probe.reason ? { reason: clip(maskNativeIds(probe.reason)) } : {}),
    ...(permissions.length > 0 ? { detected_permissions: permissions } : {}),
    ...(probe.write_actions_allowed.length > PROBE_LOG_PERMISSIONS_MAX ? { detected_permissions_total: probe.write_actions_allowed.length } : {}),
    overrides: gate.manifest.read_only_overrides,
    proceed: gate.proceed,
    // #4460: a write-capable or unverifiable login the operator accepted for this run.
    ...(probe.read_only !== 'verified' && gate.proceed ? { accepted: true } : {}),
    ...(hint ? { override_hint: hint } : {}),
    duration_ms: args.durationMs,
  };
}

/**
 * #4460: message of the `lz.live.probe` event. An accepted override reads as
 * the CLI line does ("write-capable, accepted for this run"), not as the raw
 * state "refused"; a run that stops keeps "refused, stopped".
 * `kind` 'probe' (runLzProbe: the Setup probe, the probe step of the LZ Live
 * Assessment before the user decides, Landing Zone Connections, the CLI
 * `swao lz probe`): nothing stops there, so a write-capable or unverifiable
 * login reads "write-capable, needs a confirmation per run" ("not
 * verifiable, needs a confirmation per run"), never "stopped".
 */
export function probeLogMessage(lzId: string, scopeId: string, probe: ReadOnlyProbe, gate: ReadOnlyGate, kind: 'probe' | 'run' = 'run'): string {
  const prefix = `Landing zone read-only probe: ${lzId}/${scopeId}`;
  if (!gate.proceed && kind === 'probe' && probe.read_only === 'refused') return `${prefix} write-capable, needs a confirmation per run`;
  if (!gate.proceed && kind === 'probe' && probe.read_only === 'unverifiable') return `${prefix} not verifiable, needs a confirmation per run`;
  if (!gate.proceed) return `${prefix} ${probe.read_only}, stopped`;
  switch (probe.read_only) {
    case 'verified':
      return `${prefix} verified`;
    case 'refused':
      return `${prefix} write-capable, accepted for this run`;
    case 'unverifiable':
      return `${prefix} not verifiable, accepted for this run`;
    default: {
      const never: never = probe.read_only;
      return never;
    }
  }
}

/**
 * #4496: context of the `lz.live.probe` event of a scope that could not be
 * probed: `read_only` `login-failed` for a refused sign-in (with its HTTP
 * status), else `not-probed`; `reason` is the error message masked with
 * maskNativeIds and clipped, `display_level` fail (the probe screens show it so).
 */
export function probeFailureLogContext(args: { lzId: string; scopeId: string; err: unknown; caller: string; durationMs: number }): Record<string, unknown> {
  const raw = args.err instanceof Error ? args.err.message : String(args.err);
  const nl = raw.indexOf(String.fromCharCode(10));
  const first = (nl >= 0 ? raw.slice(0, nl) : raw).trim();
  const masked = maskNativeIds(first);
  const reason = masked.length > PROBE_LOG_TEXT_MAX ? `${masked.slice(0, PROBE_LOG_TEXT_MAX - 3)}...` : masked;
  return {
    lz_id: args.lzId,
    scope_id: args.scopeId,
    caller: args.caller,
    read_only: args.err instanceof LiveAuthError ? 'login-failed' : 'not-probed',
    display_level: 'fail',
    ...(args.err instanceof LiveAuthError ? { http_status: args.err.httpStatus } : {}),
    reason,
    proceed: false,
    duration_ms: args.durationMs,
  };
}

export interface ProbeOutcome {
  results: ScopeProbeResult[];
  exitCode: number;
}

export async function runLzProbe(opts: ProbeOptions): Promise<ProbeOutcome> {
  const lz = readLandingZones(opts.workspaceRoot).find((l) => l.id === opts.lzId);
  if (!lz) throw new LzLiveError(`landing zone ${opts.lzId} is not registered in .swao.yml; run swao lz connect first`);
  const scopes = opts.scopeId === undefined ? lz.scopes : lz.scopes.filter((s) => s.id === opts.scopeId);
  if (scopes.length === 0) throw new LzLiveError(`landing zone ${lz.id} has no scope ${opts.scopeId ?? ''}`.trimEnd());
  const results: ScopeProbeResult[] = [];
  for (const scope of scopes) {
    const startedAt = Date.now();
    // #4496: a scope that cannot be probed (no login, expired token, refused sign-in) logs lz.live.probe with the reason.
    const logNotProbed = (err: unknown): void => {
      logPortfolio('warn', 'lz.live.probe', `Landing zone read-only probe: ${lz.id}/${scope.id} not probed`, {
        context: probeFailureLogContext({ lzId: lz.id, scopeId: scope.id, err, caller: opts.caller ?? 'lz.probe', durationMs: Date.now() - startedAt }),
      });
    };
    let built: Awaited<ReturnType<typeof buildScopeCtx>>;
    try { built = await buildScopeCtx(lz, scope, opts); } catch (err) { logNotProbed(err); throw err; }
    let probe: ReadOnlyProbe;
    try {
      const raw = await driverFor(lz.provider).probeReadOnly(built.ctx);
      // #3750: a token refused during the probe stops the run, even when the driver reported `unverifiable`.
      built.authFailures.throwIfFailed();
      const parsed = ReadOnlyProbeSchema.safeParse(raw);
      if (!parsed.success) throw new LzLiveError(`the ${lz.provider} driver returned an invalid probe result: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      probe = parsed.data;
    } catch (err) {
      // #4233: a refused login is the scope's last probe as well (HTTP status only, no detail).
      if (err instanceof LiveAuthError) recordLzProbe({ workspaceRoot: opts.workspaceRoot, lzId: lz.id, scopeId: scope.id, probe: { loginFailed: { httpStatus: err.httpStatus } }, caller: opts.caller ?? 'lz.probe' });
      logNotProbed(err);
      throw err;
    } finally {
      built.recorder?.finish();
    }
    const gate = evaluateReadOnlyGate(probe, opts);
    // #4233: the last probe per scope, for the health check (no network call there). Never throws.
    recordLzProbe({ workspaceRoot: opts.workspaceRoot, lzId: lz.id, scopeId: scope.id, probe, caller: opts.caller ?? 'lz.probe' });
    // #4265: one line per scope and probe call, with reason, detected permissions, override hint, caller and duration.
    // #4460: a probe stops nothing; a write-capable login needs a confirmation per run.
    logPortfolio(gate.proceed ? 'info' : 'warn', 'lz.live.probe', probeLogMessage(lz.id, scope.id, probe, gate, 'probe'), {
      context: probeLogContext({ lzId: lz.id, scopeId: scope.id, probe, gate, caller: opts.caller ?? 'lz.probe', durationMs: Date.now() - startedAt }),
    });
    results.push({ scopeId: scope.id, probe, gate, endpointOverrides: built.endpointOverrides, recordingDir: built.recorder?.runDir ?? null });
  }
  return { results, exitCode: results.some((r) => !r.gate.proceed) ? 1 : 0 };
}

// ---------------------------------------------------------------------------
// connect
// ---------------------------------------------------------------------------

/** Parse a `<field>=<value>` credentials file (one per line, # comments). */
export function parseCredentialsFile(text: string): Partial<Record<LzCredentialField, string>> {
  const out: Partial<Record<LzCredentialField, string>> = {};
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    if (eq <= 0) throw new LzLiveError(`credentials file line ${i + 1}: expected <field>=<value>`);
    const field = line.slice(0, eq).trim();
    if (!(LZ_CREDENTIAL_FIELDS as readonly string[]).includes(field)) {
      throw new LzLiveError(`credentials file line ${i + 1}: unknown field ${field} (fields: ${LZ_CREDENTIAL_FIELDS.join(', ')})`);
    }
    out[field as LzCredentialField] = line.slice(eq + 1);
  });
  return out;
}

export interface ConnectOptions extends ScopeCtxOptions, ReadOnlyFlags {
  workspaceRoot: string;
  lzId: string;
  provider: string;
  scopeId: string;
  kind: 'platform' | 'application';
  auth: string;
  regions?: string[];
  target?: Record<string, string>;
  app?: string;
  /** #3975: `log-archive` marks the landing zone's log archive scope (Design 120 section 6.1). */
  purpose?: LzScopePurpose;
  /**
   * #4459: the SSO profile name of the AWS config file the refresh signs in
   * with (`aws_profile` of the scope; a name, never a credential). Omitted:
   * an existing `aws_profile` of the scope is kept; `''` removes it.
   */
  awsProfile?: string;
  credentialsFile?: string;
  /** #3589: `<field>=<value>` lines read from stdin (TUI), never from argv or a file. */
  credentialsText?: string;
  /** #3589: display name of the landing zone (kept when omitted). */
  display?: string;
  /** #4232: copy the stored credentials of another landing zone and scope (`--credentials-from <lz-id>:<scope-id>`). */
  credentialsFrom?: { lzId: string; scopeId: string };
  moveLegacyCredentials?: boolean;
  probe?: boolean;
}

export interface ConnectOutcome {
  registration: UpsertOutcome;
  storedFields: LzCredentialField[];
  movedLegacyKeys: string[];
  /** Legacy keys found but not moved (no --move-legacy-credentials). */
  legacyKeysFound: number;
  probe: ProbeOutcome | null;
  /** #4459: the stored `expires-at` of the scope when it is in the past; the probe is then skipped. */
  expiredSessionAt?: string;
  exitCode: number;
}

export async function runLzConnect(opts: ConnectOptions): Promise<ConnectOutcome> {
  const driver = driverFor(opts.provider);
  if (!driver.authMethods.some((m) => m.id === opts.auth)) {
    throw new LzLiveError(`the ${opts.provider} driver has no auth method ${opts.auth} (methods: ${driver.authMethods.map((m) => m.id).join(', ')})`);
  }
  const registered = readLandingZones(opts.workspaceRoot);
  // #4459: a re-connect (new keys from the TUI) keeps the scope's aws_profile unless it names another.
  const keptProfile = registered.find((l) => l.id === opts.lzId)?.scopes.find((s) => s.id === opts.scopeId)?.aws_profile;
  const awsProfile = opts.awsProfile !== undefined ? (opts.awsProfile === '' ? undefined : opts.awsProfile) : keptProfile;
  const scope: LzScope = {
    id: opts.scopeId,
    kind: opts.kind,
    auth: opts.auth,
    ...(opts.regions && opts.regions.length > 0 ? { regions: opts.regions } : {}),
    ...(opts.target && Object.keys(opts.target).length > 0 ? { target: opts.target } : {}),
    ...(opts.app ? { app: opts.app } : {}),
    ...(opts.purpose ? { purpose: opts.purpose } : {}),
    ...(awsProfile !== undefined ? { aws_profile: awsProfile } : {}),
  } as LzScope;
  // Validate the whole block before anything is stored.
  if (opts.credentialsFile !== undefined && opts.credentialsText !== undefined) {
    throw new LzLiveError('pass the credentials either in a file (--credentials-file) or on stdin (--credentials-stdin), not both');
  }
  if (opts.credentialsFrom !== undefined && (opts.credentialsFile !== undefined || opts.credentialsText !== undefined)) {
    throw new LzLiveError('pass the credentials one way only: --credentials-from, --credentials-file or --credentials-stdin');
  }
  const authMethod = driver.authMethods.find((m) => m.id === opts.auth)!;
  const { lzs, outcome } = upsertScope(registered, opts.lzId, opts.provider, scope, opts.display);
  const check = SwaoYmlLandingZonesSchema.safeParse(lzs);
  if (!check.success) throw new LzLiveError(`registration refused: ${check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);

  const fields = opts.credentialsFile !== undefined ? parseCredentialsFile(readFileSync(opts.credentialsFile, 'utf-8'))
    : opts.credentialsText !== undefined ? parseCredentialsFile(opts.credentialsText) : {};
  for (const [field, value] of Object.entries(fields)) {
    await opts.store.set(lzCredentialKey(opts.lzId, opts.scopeId, field as LzCredentialField), value as string);
  }
  // #4459: new keys without a session token or expiry drop the stale ones of an earlier session,
  // so an old expires-at never blocks fresh keys (the AWS SSO helper did the same).
  if (Object.keys(fields).length > 0) {
    for (const stale of ['session-token', 'expires-at'] as const) {
      if (!(stale in fields)) await opts.store.delete(lzCredentialKey(opts.lzId, opts.scopeId, stale));
    }
  }
  // #4232: copy (never move) the stored set of another landing zone and scope.
  let copied: LzCredentialField[] = [];
  if (opts.credentialsFrom !== undefined) {
    try {
      copied = await copyLzCredentialSet(opts.store, opts.credentialsFrom, { lzId: opts.lzId, scopeId: opts.scopeId }, authMethod);
    } catch (e) {
      throw new LzLiveError((e as Error).message);
    }
  }

  let moved: string[] = [];
  let legacyFound = 0;
  if (opts.provider === 'aws' || opts.provider === 'azure') {
    if (opts.moveLegacyCredentials === true) {
      moved = (await moveLegacyLzCredentials(opts.store, opts.provider, opts.lzId, opts.scopeId)).map((m) => m.from);
    } else {
      legacyFound = findLegacyLzCredentialKeys(opts.store, opts.provider).length;
    }
  }

  writeLandingZones(opts.workspaceRoot, check.data);

  // #4459: an expired session token is reported with the registration; a probe would only refuse it.
  const expiry = await lzSessionExpiry(opts.store, opts.lzId, opts.scopeId);
  const expired = expiry?.expired === true ? expiry.expiresAt : undefined;
  const probe = opts.probe === false || expired !== undefined ? null : await runLzProbe({ ...opts, scopeId: opts.scopeId, caller: 'lz.connect' });
  return {
    ...(expired !== undefined ? { expiredSessionAt: expired } : {}),
    registration: outcome,
    storedFields: [...(Object.keys(fields) as LzCredentialField[]), ...copied],
    movedLegacyKeys: moved,
    legacyKeysFound: legacyFound,
    probe,
    exitCode: probe?.exitCode ?? 0,
  };
}
