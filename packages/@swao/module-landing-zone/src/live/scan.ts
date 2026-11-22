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

// #3572: one live scope run -> `LzLiveScan` (Design 120 section 7.3). Probe
// and read-only gate first (section 6.3); a scope the gate stops is not
// crawled. Every list method that cannot be served is recorded as a
// `not_collected` source instead of an empty success (section 7.1); the
// result passes `LzLiveScanSchema` before it is returned (Zod at the
// boundary, CLAUDE.md section 5.5). The run manifest writer of section 7.4 is
// not part of this run: the gate stamp is carried in `meta`.

import { LzLiveScanSchema, deriveLzScanBaseFields, logPortfolio } from '@swao/core';
import type { LzLiveScan, LzLiveService, LzLiveSimulated } from '@swao/core';
import { getLiveLzDriver } from './registry.js';
import { LiveSourceUnavailableError } from './errors.js';
import { LzLiveError, buildScopeCtx, evaluateReadOnlyGate, logArchiveManifest, logArchiveRef, logArchiveSource, probeLogContext, probeLogMessage, readLandingZones } from './session.js';
import type { BuiltScopeCtx, LogArchiveManifestEntry } from './session.js';
import type { AuthFailureLatch } from './http.js';
import type { ProbeOptions, ReadOnlyGate } from './session.js';
import type { EndpointOverride } from './endpoints.js';
import { recordLzProbe } from './probe-record.js';
import { ReadOnlyProbeSchema } from './types.js';
import type { ReadOnlyProbe, ScopeCtx } from './types.js';
import { filterResourceAttributes, lzPseudonymSalt, pseudonymiseResources, scrubResourceTypes } from './privacy.js';
import { scrubPostureAttributes } from './posture.js';
import { prepareHierarchy } from './hierarchy.js';

/** CTS keeps 7 days of traces (handover 03); other drivers may read longer. */
export const DEFAULT_ACTIVITY_DAYS = 7;

export interface LiveScanOptions extends ProbeOptions {
  activityDays?: number;
}

export interface ScopeScanResult {
  scopeId: string;
  probe: ReadOnlyProbe;
  gate: ReadOnlyGate;
  /** Absent when the gate stopped the scope. */
  scan?: LzLiveScan;
  endpointOverrides: EndpointOverride[];
  recordingDir: string | null;
  /** #3596: simulation evidence seen up to the gate (refused scopes) or the end of the crawl. */
  simulated?: LzLiveSimulated;
  /** #4059: the log archive's gate, when a collector of this scope opened it (run manifest `scopes[].log_archive`). */
  logArchive?: LogArchiveManifestEntry;
}

export interface LiveScanOutcome {
  results: ScopeScanResult[];
  exitCode: number;
}

type Estate = LzLiveScan['estate'];

// #3750 / #3803: `latch` holds a token refused by the HTTP layer (http.ts).
// It is checked after every driver method, so a driver that recorded the 401
// as a missing source still stops the run (fail fast, Design 120 section 6.2).
async function collect<T>(ctx: ScopeCtx, latch: AuthFailureLatch, name: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    const v = await fn();
    latch.throwIfFailed();
    if (!ctx.sources.some((s) => s.name === name)) ctx.sources.push({ name, status: 'ok' });
    return v;
  } catch (err) {
    latch.throwIfFailed();
    if (!(err instanceof LiveSourceUnavailableError)) throw err;
    ctx.sources.push(err.httpStatus !== undefined
      ? { name: err.source, status: 'not_collected', http_status: err.httpStatus }
      : { name: err.source, status: 'not_collected', reason: err.why ?? 'not collected' });
    return fallback;
  }
}

/** Merge per-region service lists into one entry per native code. */
export function mergeServices(perRegion: readonly LzLiveService[][]): LzLiveService[] {
  const byCode = new Map<string, LzLiveService>();
  for (const list of perRegion) {
    for (const s of list) {
      const prev = byCode.get(s.code);
      if (!prev) byCode.set(s.code, { ...s, regions: { ...s.regions } });
      else prev.regions = { ...prev.regions, ...s.regions };
    }
  }
  return [...byCode.values()];
}

export async function runLzLiveScan(opts: LiveScanOptions): Promise<LiveScanOutcome> {
  const lz = readLandingZones(opts.workspaceRoot).find((l) => l.id === opts.lzId);
  if (!lz) throw new LzLiveError(`landing zone ${opts.lzId} is not registered in .swao.yml; run swao lz connect first`);
  const driver = getLiveLzDriver(lz.provider);
  if (!driver) throw new LzLiveError(`no live driver for provider ${lz.provider}`);
  const scopes = opts.scopeId === undefined ? lz.scopes : lz.scopes.filter((s) => s.id === opts.scopeId);
  if (scopes.length === 0) throw new LzLiveError(`landing zone ${lz.id} has no scope ${opts.scopeId ?? ''}`.trimEnd());
  const days = opts.activityDays ?? DEFAULT_ACTIVITY_DAYS;
  const results: ScopeScanResult[] = [];
  for (const scope of scopes) {
    const scopeStartedAt = Date.now();
    const built = await buildScopeCtx(lz, scope, opts);
    const { ctx } = built;
    // #3975: the log archive scope, opened by the driver only when it needs it.
    const peers: BuiltScopeCtx[] = [];
    const archive = logArchiveRef(lz, scope, opts, (b) => peers.push(b));
    if (archive) ctx.logArchive = archive;
    try {
      const raw = await driver.probeReadOnly(ctx);
      built.authFailures.throwIfFailed();
      const parsed = ReadOnlyProbeSchema.safeParse(raw);
      if (!parsed.success) throw new LzLiveError(`the ${lz.provider} driver returned an invalid probe result: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      const probe = parsed.data;
      const gate = evaluateReadOnlyGate(probe, opts);
      // #4233: the run's probe is the scope's last probe too (health check, no network call). Never throws.
      recordLzProbe({ workspaceRoot: opts.workspaceRoot, lzId: lz.id, scopeId: scope.id, probe, caller: opts.caller ?? 'lz.scan' });
      // #4411: the run's probe line, the same context as runLzProbe (#4265): overrides, proceed, duration.
      logPortfolio(gate.proceed ? 'info' : 'warn', 'lz.live.probe', probeLogMessage(lz.id, scope.id, probe, gate), {
        context: probeLogContext({ lzId: lz.id, scopeId: scope.id, probe, gate, caller: opts.caller ?? 'lz.scan', durationMs: Date.now() - scopeStartedAt }),
      });
      const probeSimulated = built.simulation.result();
      const base = { scopeId: scope.id, probe, gate, endpointOverrides: built.endpointOverrides, recordingDir: built.recorder?.runDir ?? null, ...(probeSimulated ? { simulated: probeSimulated } : {}) };
      if (!gate.proceed) {
        results.push(base);
        continue;
      }
      const observed_at = new Date().toISOString();
      const regions = await collect(ctx, built.authFailures, 'regions', [], () => driver.listRegions(ctx));
      const perRegion: LzLiveService[][] = [];
      for (const r of regions) perRegion.push(await collect(ctx, built.authFailures, `services:${r.id}`, [], () => driver.listServices(ctx, r.id)));
      const guardrails = await collect<Estate['guardrails']>(ctx, built.authFailures, 'guardrails', [], () => driver.listGuardrails(ctx));
      // #3587 (section 6.4): people in resource tags are pseudonymised for every driver.
      // #3801 (section 6.4): a resource type never repeats a name of its id, whatever the driver returns.
      const listed = await collect<Estate['resources']>(ctx, built.authFailures, 'inventory:resources', [], () => driver.listResources(ctx));
      // #3970: optional inventory of managed services the main inventory does not list.
      if (driver.listServiceResources) listed.push(...await collect<Estate['resources']>(ctx, built.authFailures, 'inventory:service-resources', [], () => driver.listServiceResources!(ctx)));
      const scrubbed = scrubResourceTypes(listed);
      if (scrubbed.replaced > 0) ctx.sources.push({ name: 'inventory:resource-types', status: 'not_collected', reason: `${scrubbed.replaced} resource type(s) repeated a resource name and were replaced` });
      const salt = await lzPseudonymSalt(opts.store, lz.id);
      // #3687: the login name also appears in tag values (OTC created-by).
      const people = Object.entries(ctx.credentials ?? {}).filter(([f]) => /user|login|name/i.test(f)).map(([, v]) => String(v));
      // #3886 (Design 123 section 5.7): every attributes map passes the one privacy filter before storage.
      const resources = filterResourceAttributes(pseudonymiseResources(scrubbed.resources, salt, people), salt, people).resources;
      const quotas: Estate['quotas'] = [];
      for (const r of regions) quotas.push(...await collect<Estate['quotas']>(ctx, built.authFailures, `quotas:${r.id}`, [], () => driver.listQuotas(ctx, r.id)));
      const activity = await collect<Estate['activity_summary']>(ctx, built.authFailures, 'activity', undefined, () => driver.listActivity(ctx, { days }));
      // #3864 (Design 123 section 9.1): optional posture collector; absent when the driver has none.
      // #3886: its attributes maps pass the same privacy filter as the resources (salt and login names above).
      const posture = driver.listPosture ? await collect<Estate['posture']>(ctx, built.authFailures, 'posture', undefined, async () => scrubPostureAttributes(await driver.listPosture!(ctx), salt, people)) : undefined;
      // #3880 (Design 123 section 5.6): optional tenant structure; names become pseudonym
      // labels and node attributes pass the same privacy filter (salt and login names above).
      const hierarchy = driver.listHierarchy ? await collect<Estate['hierarchy']>(ctx, built.authFailures, 'hierarchy', undefined, async () => prepareHierarchy(await driver.listHierarchy!(ctx), salt, people)) : undefined;

      // #4091 (Design 120 section 6.3): the log archive's read-only gate, when a collector opened it.
      const archiveSource = logArchiveSource(archive);
      if (archiveSource) ctx.sources.push(archiveSource);
      const simulated = built.simulation.result();
      const meta = {
        lz_id: lz.id,
        provider: lz.provider,
        scope_id: scope.id,
        scope_kind: scope.kind,
        observed_at,
        driver_version: driver.driverVersion,
        read_only: gate.manifest.read_only,
        read_only_overrides: gate.manifest.read_only_overrides,
        coverage: probe.coverage,
        frameworks: [],
        sources: ctx.sources,
        // #3596: evidence collected by the HTTP layer during probe and crawl.
        ...(simulated ? { simulated } : {}),
      };
      const offering = { regions, services: mergeServices(perRegion) };
      const estate = {
        resources,
        workloads: [],
        guardrails,
        quotas,
        ...(activity ? { activity_summary: activity } : {}),
        checks: [],
        ...(posture ? { posture } : {}),
        ...(hierarchy ? { hierarchy } : {}),
      };
      const candidate = {
        ...deriveLzScanBaseFields({ meta, offering, estate }),
        collection_mode: 'live',
        confidence: 'observed',
        meta,
        offering,
        estate,
        diff: { new: [], removed: [], status_changes: [] },
      };
      const checked = LzLiveScanSchema.safeParse(candidate);
      if (!checked.success) {
        throw new LzLiveError(`the ${lz.provider} driver produced an invalid LzLiveScan: ${checked.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      }
      const archiveManifest = logArchiveManifest(archive);
      results.push({ ...base, ...(simulated ? { simulated } : {}), ...(archiveManifest ? { logArchive: archiveManifest } : {}), scan: checked.data });
    } finally {
      built.recorder?.finish();
      for (const p of peers) p.recorder?.finish();
    }
  }
  return { results, exitCode: results.some((r) => !r.gate.proceed) ? 1 : 0 };
}
