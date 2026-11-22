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

// #3583: merge the scopes of one landing zone (Design 120 section 11.1).
//   1. Inputs: the latest LzLiveScan per scope; a scope whose latest scan is
//      older than the staleness window (Q-11, default 7 days) is listed as
//      stale and not merged; a registered scope without a scan is listed as
//      missing.
//   2. Regions and services: union; per service and region the status with
//      the highest LZ_LIVE_SCOPE_MERGE_PRECEDENCE wins, so `unknown` never
//      overrides an observed status. Ties go to the newer observation.
//   3. Guardrails: the platform scope's, marked `platform`; an application
//      scope adds its own as `local` policy.
//   4. Resources: deduplicated by provider resource id, `seen_by` lists every
//      merged scope that saw the resource.
//   5. #3596: a scope's `meta.simulated` is copied to its scopes[] entry, so a
//      simulated scope carried from an earlier run stays marked.
//   6. #3864: `estate.posture` of the merged scopes (`mergeLzLivePosture`,
//      posture.ts); absent when no merged scope carries posture.
//   7. #3880: `estate.hierarchy`, nodes of every merged scope unioned by id
//      (`mergeLzLiveHierarchy`, hierarchy.ts); absent when no scope has one.

import { LZ_LIVE_SCOPE_MERGE_PRECEDENCE, LZ_LIVE_STALENESS_DAYS, LzLiveMergedSchema } from '@swao/core';
import type { LzLiveMerged, LzLiveMergedScope, LzLiveMergedService, LzLiveScan, LzLiveStatus } from '@swao/core';
import { mergeLzLivePosture } from './posture.js';
import { mergeLzLiveHierarchy } from './hierarchy.js';

/** File name of the merged artefact inside the run folder (Design 120 section 7.4). */
export const LZ_LIVE_MERGED_FILE = 'lz-live-merged.yaml';

export interface RegisteredLzScope {
  id: string;
  kind: 'platform' | 'application';
}

export interface MergeLzLiveScopesOptions {
  lzId: string;
  provider: string;
  /** Scans of this landing zone, any number per scope (older runs included). */
  scans: readonly LzLiveScan[];
  /** Scopes registered in .swao.yml; a registered scope without a scan is listed as missing. */
  registeredScopes?: readonly RegisteredLzScope[];
  /** Staleness window in days (default LZ_LIVE_STALENESS_DAYS). */
  windowDays?: number;
  now?: Date;
}

const rank = (s: LzLiveStatus): number => LZ_LIVE_SCOPE_MERGE_PRECEDENCE.indexOf(s);

function ageDays(observedAt: string, now: Date): number | undefined {
  const t = Date.parse(observedAt);
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, Math.floor(((now.getTime() - t) / 86_400_000) * 100) / 100);
}

/** Merge the scopes of one landing zone. The result is validated against LzLiveMergedSchema. */
export function mergeLzLiveScopes(opts: MergeLzLiveScopesOptions): LzLiveMerged {
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? LZ_LIVE_STALENESS_DAYS;
  if (!Number.isInteger(windowDays) || windowDays < 1) throw new Error(`[lz live] staleness window must be a positive whole number of days, not ${windowDays}`);

  // Latest scan per scope of this landing zone.
  const latest = new Map<string, LzLiveScan>();
  for (const s of opts.scans) {
    if (s.meta.lz_id !== opts.lzId || s.meta.provider !== opts.provider) {
      throw new Error(`[lz live] scan of ${s.meta.lz_id}/${s.meta.provider} cannot be merged into ${opts.lzId}/${opts.provider}`);
    }
    const prev = latest.get(s.meta.scope_id);
    if (!prev || s.meta.observed_at > prev.meta.observed_at) latest.set(s.meta.scope_id, s);
  }

  const scopeIds = [...new Set([...(opts.registeredScopes ?? []).map((r) => r.id), ...latest.keys()])];
  const kindOf = new Map((opts.registeredScopes ?? []).map((r) => [r.id, r.kind] as const));
  const scopes: LzLiveMergedScope[] = [];
  const merged: LzLiveScan[] = [];
  for (const id of scopeIds) {
    const scan = latest.get(id);
    const kind = scan?.meta.scope_kind ?? kindOf.get(id);
    if (!scan) {
      scopes.push({ scope_id: id, ...(kind ? { scope_kind: kind } : {}), status: 'missing' });
      continue;
    }
    const age = ageDays(scan.meta.observed_at, now);
    const stale = age === undefined || age > windowDays;
    scopes.push({ scope_id: id, ...(kind ? { scope_kind: kind } : {}), status: stale ? 'stale' : 'merged', observed_at: scan.meta.observed_at, ...(age !== undefined ? { age_days: age } : {}), ...(scan.meta.simulated ? { simulated: scan.meta.simulated } : {}) });
    if (!stale) merged.push(scan);
  }
  // Platform first, then application scopes by id, so ties and ordering are stable.
  merged.sort((a, b) => (a.meta.scope_kind === b.meta.scope_kind ? a.meta.scope_id.localeCompare(b.meta.scope_id) : a.meta.scope_kind === 'platform' ? -1 : 1));

  // Regions: union; a region is enabled when any merged scope saw it enabled.
  const regions = new Map<string, LzLiveScan['offering']['regions'][number]>();
  for (const scan of merged) {
    for (const r of scan.offering.regions) {
      const prev = regions.get(r.id);
      if (!prev) {
        regions.set(r.id, { ...r, azs: [...r.azs] });
        continue;
      }
      if (prev.status !== 'enabled' && r.status === 'enabled') prev.status = 'enabled';
      if (!prev.country && r.country) prev.country = r.country;
      for (const az of r.azs) if (!prev.azs.some((a) => a.name === az.name)) prev.azs.push({ ...az });
    }
  }

  // Services: union by native code; precedence per region.
  const services = new Map<string, LzLiveMergedService>();
  for (const scan of merged) {
    for (const svc of scan.offering.services) {
      let out = services.get(svc.code);
      if (!out) {
        out = {
          code: svc.code,
          name: svc.name,
          capability_tags: [...svc.capability_tags],
          ...(svc.catalogue_code ? { catalogue_code: svc.catalogue_code } : {}),
          regions: {},
          ...(svc.iac ? { iac: svc.iac } : {}),
        };
        services.set(svc.code, out);
      } else {
        out.capability_tags = [...new Set([...out.capability_tags, ...svc.capability_tags])];
        if (!out.iac && svc.iac) out.iac = svc.iac;
      }
      for (const [regionId, st] of Object.entries(svc.regions)) {
        const prev = out.regions[regionId];
        const better = !prev
          || rank(st.status) < rank(prev.status)
          || (rank(st.status) === rank(prev.status) && st.observed_at > prev.observed_at);
        if (better) out.regions[regionId] = { status: st.status, scope_id: scan.meta.scope_id, evidence: [...st.evidence], observed_at: st.observed_at };
      }
    }
  }

  // Guardrails: platform scope plus local policy of application scopes.
  const guardrails: LzLiveMerged['estate']['guardrails'] = [];
  for (const scan of merged) {
    const origin = scan.meta.scope_kind === 'platform' ? 'platform' : 'local';
    for (const g of scan.estate.guardrails) guardrails.push({ ...g, scope_id: scan.meta.scope_id, origin });
  }

  // Resources: dedup by provider resource id.
  const resources = new Map<string, LzLiveMerged['estate']['resources'][number]>();
  for (const scan of merged) {
    for (const r of scan.estate.resources) {
      const prev = resources.get(r.id);
      if (prev) {
        if (!prev.seen_by.includes(scan.meta.scope_id)) prev.seen_by.push(scan.meta.scope_id);
        continue;
      }
      resources.set(r.id, { ...r, seen_by: [scan.meta.scope_id] });
    }
  }

  const posture = mergeLzLivePosture(merged);
  const hierarchy = mergeLzLiveHierarchy(merged);

  return LzLiveMergedSchema.parse({
    lz_id: opts.lzId,
    provider: opts.provider,
    merged_at: now.toISOString(),
    window_days: windowDays,
    scopes,
    offering: {
      regions: [...regions.values()],
      services: [...services.values()].sort((a, b) => a.code.localeCompare(b.code)),
    },
    estate: {
      resources: [...resources.values()],
      guardrails,
      ...(posture ? { posture } : {}),
      ...(hierarchy ? { hierarchy } : {}),
    },
  });
}
