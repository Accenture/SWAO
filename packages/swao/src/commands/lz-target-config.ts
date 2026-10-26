// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// LZ catalogue targets of a run (#3281).
//
// Combines the config resolver of @swao/core (CLI flags, then the app
// .swao.yml, then the workspace .swao.yml; see lz-targets.ts there) with the
// shared geography model of @swao/module-landing-zone (geographies.ts, the
// same rule for every catalogue): a target such as `azure:Europe` whose region
// is not a region id but a known geography resolves to the documented default
// region before the fit, logged as
// lz.assessment.target.resolved (info). Any other unknown value is passed
// through unchanged and becomes a skipped target with the valid-region hint in
// runLzProviderFits (#3223).

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import {
  logApp as coreLogApp,
  logPortfolio as coreLogPortfolio,
  resolveLzTargets,
  lzTargetLabel,
  SwaoYmlSchema,
  type LzTargetSpec,
  type LzTargetSource,
  type ResolveLzTargetsInput,
} from '@swao/core';
import { resolveProviderCatalogue, resolveLzGeography, lzDeprecatedGeographyAlias, type LzGeographyRegion } from '@swao/module-landing-zone';

/** A geography resolved to its default region (recorded in run-status.json). */
export interface LzResolvedTarget {
  requested: string;
  resolved: string;
  geography: string;
}

export interface RunLzTargets {
  targets: LzTargetSpec[];
  source: LzTargetSource;
  resolved: LzResolvedTarget[];
}

/** `assessment` block of the workspace .swao.yml, or undefined (missing or invalid file). */
export function readWorkspaceAssessment(workspaceRoot: string): Record<string, unknown> | undefined {
  const p = join(workspaceRoot, '.swao.yml');
  if (!existsSync(p)) return undefined;
  try {
    const parsed = SwaoYmlSchema.safeParse(load(readFileSync(p, 'utf-8')) ?? {});
    if (!parsed.success) return undefined;
    const a = (parsed.data as Record<string, unknown>)['assessment'];
    return a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export interface ResolveRunLzTargetsOptions extends ResolveLzTargetsInput {
  app: string;
  workspaceRoot: string;
  /** Workspace catalogue folder (wsp/inputs/catalogs/lz-catalogues) when present. */
  cataloguesDir?: string;
  /** Catalogue regions of a provider; defaults to the layered catalogue resolver. */
  regions?: (provider: string) => LzGeographyRegion[];
  logApp?: typeof coreLogApp;
  logPortfolio?: typeof coreLogPortfolio;
  /** Console sink for the info line (tests). */
  info?: (line: string) => void;
}

/** Resolve the targets of a run and apply the geography map. */
export function resolveRunLzTargets(opts: ResolveRunLzTargetsOptions): RunLzTargets {
  const { targets: configured, source } = resolveLzTargets(opts);
  const logApp = opts.logApp ?? coreLogApp;
  const logPortfolio = opts.logPortfolio ?? coreLogPortfolio;
  const info = opts.info ?? ((line: string) => console.log(line));
  const loadRegions = opts.regions ?? ((provider: string): LzGeographyRegion[] => {
    try {
      return resolveProviderCatalogue(provider, opts.workspaceRoot, opts.cataloguesDir).catalogue.regions;
    } catch {
      return []; // unknown provider or unreadable catalogue: the fit reports it
    }
  });
  const cache = new Map<string, LzGeographyRegion[]>();
  const regionsOf = (provider: string): LzGeographyRegion[] => {
    let regions = cache.get(provider);
    if (!regions) { regions = loadRegions(provider); cache.set(provider, regions); }
    return regions;
  };

  const resolved: LzResolvedTarget[] = [];
  const out: LzTargetSpec[] = [];
  const seen = new Set<string>();
  for (const t of configured) {
    // ADR-0068 (#3379): `eu` is a deprecated spelling of `europe` (same EU-27 set).
    const dep = lzDeprecatedGeographyAlias(t.region);
    if (dep) {
      info(`[info] LZ target ${t.provider}:${t.region} uses the deprecated geography '${dep.alias}'; it now means '${dep.replacement}' (the 27 EU member states). Use '${dep.replacement}' in assessment.landing_zone.targets.`);
    }
    const r = resolveLzGeography(t.region, regionsOf(t.provider));
    const target = r.kind === 'geography' ? { provider: t.provider, region: r.region } : t;
    if (r.kind === 'geography') {
      const entry = { requested: lzTargetLabel(t), resolved: lzTargetLabel(target), geography: r.geography };
      resolved.push(entry);
      const msg = `LZ target ${entry.requested} names a geography; using the default region ${entry.resolved}`;
      const ctx = { provider: t.provider, requested_region: t.region, resolved_region: r.region, geography: r.geography, source };
      try { logApp(opts.app, 'info', 'lz.assessment.target.resolved', msg, { context: { app_id: opts.app, ...ctx } }); } catch { /* best-effort */ }
      try { logPortfolio('info', 'lz.assessment.target.resolved', msg, { context: { app: opts.app, ...ctx } }); } catch { /* best-effort */ }
      info(`[info] ${msg} (set ${entry.resolved} in assessment.landing_zone.targets to make the choice explicit).`);
    }
    const key = lzTargetLabel(target);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return { targets: out, source, resolved };
}
