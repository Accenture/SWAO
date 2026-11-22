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

/**
 * #4006: the catalogue targets of an app run: the configured ones (flag or
 * `assessment.landing_zone.targets`), else the targets seeded from the linked
 * landing zone (#3980 fallback). One rule for the inline fit and Pass 11, so
 * the seeded targets reach the baseline decisions like configured ones.
 */
export function effectiveCatalogueTargets(configured: readonly LzTargetSpec[], seeded: readonly LzTargetSpec[]): LzTargetSpec[] {
  return configured.length === 0 && seeded.length > 0 ? [...seeded] : [...configured];
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

const silent = (): void => { /* no output: a second, attribution-only resolution */ };

/**
 * #4285 (Design 125 sections 5.7 and 8): the set-up targets of an app, the way
 * `swao assess` resolves them without flags (app `assessment.landing_zone.targets`,
 * then the workspace), geography values mapped to their default region. Feeds
 * the target pickers of the Application and LZ Catalog Assessment screens, so
 * TUI and CLI preselect the same targets. Silent: no log line, no console line.
 */
export function setupLzTargetsForPicker(workspaceRoot: string, appId: string): { targets: string[]; resolved: LzResolvedTarget[]; source: LzTargetSource } {
  const appYml = join(workspaceRoot, 'apps', appId, '.swao.yml');
  let appAssessment: Record<string, unknown> | undefined;
  try {
    const a = existsSync(appYml) ? ((load(readFileSync(appYml, 'utf-8')) ?? {}) as Record<string, unknown>)['assessment'] : undefined;
    appAssessment = a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : undefined;
  } catch { appAssessment = undefined; }
  const wsCat = join(workspaceRoot, 'wsp', 'inputs', 'catalogs', 'lz-catalogues');
  const r = resolveRunLzTargets({
    app: appId, workspaceRoot, cataloguesDir: existsSync(wsCat) ? wsCat : undefined,
    appAssessment, workspaceAssessment: readWorkspaceAssessment(workspaceRoot),
    logApp: silent as unknown as typeof coreLogApp, logPortfolio: silent as unknown as typeof coreLogPortfolio, info: silent,
  });
  return { targets: r.targets.map(lzTargetLabel), resolved: r.resolved, source: r.source };
}

/**
 * #4285: where the targets of a run came from, recorded in run-context.yaml
 * (`lz_targets_source`) and run-status.json (`resolved_targets`). Targets
 * passed on the command line (the TUI passes its picks this way) that equal
 * the set-up targets after geography resolution are attributed to the set-up
 * key, with its geography resolution; other passed targets keep their CLI
 * source. `configured` is the resolution without any flag.
 */
export function attributeLzTargets(run: RunLzTargets, configured: RunLzTargets): { source: string; resolved: LzResolvedTarget[] } {
  const labels = (t: readonly LzTargetSpec[]): Set<string> => new Set(t.map(lzTargetLabel));
  const a = labels(run.targets);
  const b = labels(configured.targets);
  const same = a.size > 0 && a.size === b.size && [...a].every((x) => b.has(x));
  if (run.source.startsWith('cli:') && configured.source !== 'none' && same) return { source: configured.source, resolved: configured.resolved };
  return { source: run.source, resolved: run.resolved };
}

/** The flag-free resolution of an app's targets, silent (for attributeLzTargets). */
export function configuredRunLzTargets(opts: Omit<ResolveRunLzTargetsOptions, 'cliTargets' | 'cliProvider' | 'cliRegion' | 'logApp' | 'logPortfolio' | 'info'>): RunLzTargets {
  return resolveRunLzTargets({ ...opts, logApp: silent as unknown as typeof coreLogApp, logPortfolio: silent as unknown as typeof coreLogPortfolio, info: silent });
}
