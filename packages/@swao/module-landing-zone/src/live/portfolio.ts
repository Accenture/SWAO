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

// #3584: portfolio merge across landing zones (Design 120 section 11.2).
//   1. Inputs: `lz-live-merged.yaml` of the latest run of every landing zone
//      registered in `.swao.yml` (`latest-lz-live.txt`, else the newest run
//      folder with a merged view), plus the scope scans the merged view names
//      (found by scope id and observation time across the LZ's run folders,
//      because a carried scope has no scan in the latest run folder). Only
//      these files are read; never `.raw/`, recordings or the network.
//   2. Simulated scopes (Design 121 section 10, item 5) join only with
//      `--include-simulated` and then mark the LZ `[SIM]`. Without the flag a
//      landing zone with a simulated merged scope is merged again from its
//      other scopes (mergeLzLiveScopes, same window and time), because a
//      region status in the merged view is a precedence winner that cannot be
//      subtracted; the excluded scopes are listed. A landing zone whose every
//      merged scope is simulated is listed as skipped.
//   3. Governance matrix per LZ: framework light counts, baseline checks,
//      IaC coverage, quotas, drift; cross-CSP capability rows by capability
//      tag with region, country, geographies (catalogue/geographies.ts,
//      ADR-0068) and operator jurisdiction (the run's live LZ catalogue).
//   4. Output: `wsp/lz-live-portfolio/runs/<ts>/lz-live-portfolio.yaml` and
//      `wsp/lz-live-portfolio/latest.txt`; the aggregator turns it into the
//      `landing_zones[]` block of `portfolio-summary.json` (section 11.3).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dump as yamlDump, load as yamlLoad } from 'js-yaml';
import {
  LZ_LIVE_PORTFOLIO_DIR,
  LZ_LIVE_PORTFOLIO_FILE,
  LZ_LIVE_PORTFOLIO_LATEST,
  LzLiveMergedSchema,
  LzLivePortfolioSchema,
  LzLiveScanSchema,
  LzRegionSchema,
  countLzFitBlockers,
  type LzRequirementProvenance,
} from '@swao/core';
import type { LzLiveCheckStatus, LzLivePortfolioAppFit, LzRegion } from '@swao/core';
import { computeLzFitFromLiveScan } from '../fit/lz-fit.js';
import type { LzFitReport, LzRequiredService, SovereigntyRequirements } from '../fit/lz-fit.js';
import type { LzLiveMerged, LzLivePortfolio, LzLivePortfolioCapability, LzLivePortfolioLz, LzLiveScan } from '@swao/core';
import { readLandingZones } from './session.js';
import { mergeLzLiveScopes, LZ_LIVE_MERGED_FILE } from './merge.js';
import { LZ_LIVE_CATALOGUE_FILE } from './live-catalogue.js';
import { lzRegionGeographies } from '../catalogue/geographies.js';
import { buildBaselineComparison, formatBaselineComparison, type BaselineComparisonLzInput } from './baseline-comparison.js';
import { LzBaselineResultSchema, LZ_BASELINE_RESULT_SUFFIX, lzProviderBrand, readLzOrganisationalResult, type LzBaselineResult, type LzOrganisationalResult } from '@swao/core';

const RUN_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;
const LIGHT_RANK: Record<string, number> = { red: 0, amber: 1, grey: 2, green: 3 };
// #3864: `unverified` ranks below the observed problems and above pass and na,
// so missing evidence never hides a fail and is never hidden by a pass.
export const LZ_LIVE_CHECK_RANK: Readonly<Record<LzLiveCheckStatus, number>> = { fail: 0, warn: 1, unverified: 2, pass: 3, na: 4 };

/** One landing zone's latest live run, as read from its WSP. */
export interface LzLiveRunInput {
  lzId: string;
  provider: string;
  runId: string;
  merged: LzLiveMerged;
  /** Scans the merged view names, by scope id (latest matching observation). */
  scans: Map<string, LzLiveScan>;
  /** Operator jurisdiction per region from the run's lz-live-catalogue.json. */
  operatorByRegion: Map<string, string>;
  residencyByRegion: Map<string, string>;
  /** #3822: regions of the run's lz-live-catalogue.json (sovereignty facts) for the observed app fit. */
  catalogueRegions?: Map<string, LzRegion>;
  /** #3872: lz-baseline-result/1 per scope, from the run folder its scan was read from. */
  baselines?: Map<string, LzBaselineResult>;
  /** #4050: the run's organisational result (lz-organisational.json); landing zone level, so only the merged run's own. */
  organisational?: LzOrganisationalResult;
}

function runsDirOf(workspaceRoot: string, lzId: string): string {
  return join(workspaceRoot, 'landing-zones', lzId, 'wsp', 'runs');
}

function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { return undefined; }
}

/**
 * Read the latest live run of a landing zone: `latest-lz-live.txt`, else the
 * newest run folder holding `lz-live-merged.yaml`. Returns a reason string
 * when there is nothing to merge.
 */
export function readLzLiveRunForPortfolio(workspaceRoot: string, lzId: string, provider: string): LzLiveRunInput | string {
  const runsDir = runsDirOf(workspaceRoot, lzId);
  if (!existsSync(runsDir)) return 'no live run';
  const runs = readdirSync(runsDir).filter((r) => RUN_SEGMENT_RE.test(r)).sort().reverse();
  const ptr = join(workspaceRoot, 'landing-zones', lzId, 'wsp', 'latest-lz-live.txt');
  const pointed = existsSync(ptr) ? readFileSync(ptr, 'utf-8').trim() : '';
  const runId = RUN_SEGMENT_RE.test(pointed) && existsSync(join(runsDir, pointed, LZ_LIVE_MERGED_FILE))
    ? pointed
    : runs.find((r) => existsSync(join(runsDir, r, LZ_LIVE_MERGED_FILE)));
  if (!runId) return 'no live run with a merged view (lz-live-merged.yaml)';
  let merged: LzLiveMerged;
  try {
    const r = LzLiveMergedSchema.safeParse(yamlLoad(readFileSync(join(runsDir, runId, LZ_LIVE_MERGED_FILE), 'utf-8')));
    if (!r.success) return `run ${runId}: lz-live-merged.yaml does not match the schema`;
    merged = r.data;
  } catch {
    return `run ${runId}: lz-live-merged.yaml is not readable`;
  }
  if (merged.lz_id !== lzId || merged.provider !== provider) return `run ${runId}: merged view is for ${merged.lz_id}/${merged.provider}`;

  // Scans: current run first, then older runs (carried scopes).
  const scans = new Map<string, LzLiveScan>();
  const baselines = new Map<string, LzBaselineResult>();
  const wanted = new Map(merged.scopes.filter((s) => s.observed_at !== undefined).map((s) => [s.scope_id, s.observed_at as string] as const));
  const order = [runId, ...runs.filter((r) => r !== runId && r < runId)];
  for (const run of order) {
    if (scans.size === wanted.size) break;
    for (const [scopeId, observedAt] of wanted) {
      if (scans.has(scopeId)) continue;
      const file = join(runsDir, run, `${lzId}.${scopeId}.lz-live-scan.json`);
      if (!existsSync(file)) continue;
      const r = LzLiveScanSchema.safeParse(readJson(file));
      if (r.success && r.data.meta.observed_at === observedAt && r.data.meta.lz_id === lzId) {
        scans.set(scopeId, r.data);
        // #3872: the scope's baseline result sits next to its scan (same run folder, same hash as meta.baseline).
        const b = LzBaselineResultSchema.safeParse(readJson(join(runsDir, run, `${lzId}.${scopeId}${LZ_BASELINE_RESULT_SUFFIX}`)));
        if (b.success && r.data.meta.baseline?.sha256 === b.data.sha256) baselines.set(scopeId, b.data);
      }
    }
  }

  const operatorByRegion = new Map<string, string>();
  const residencyByRegion = new Map<string, string>();
  const cat = readJson(join(runsDir, runId, LZ_LIVE_CATALOGUE_FILE)) as { regions?: Array<{ id?: unknown; sovereignty?: { operator_jurisdiction?: unknown; residency_country?: unknown } }> } | undefined;
  const catalogueRegions = new Map<string, LzRegion>();
  for (const r of Array.isArray(cat?.regions) ? cat.regions : []) {
    if (typeof r.id !== 'string') continue;
    const parsed = LzRegionSchema.safeParse(r);
    if (parsed.success) catalogueRegions.set(r.id, parsed.data);
    if (typeof r.sovereignty?.operator_jurisdiction === 'string') operatorByRegion.set(r.id, r.sovereignty.operator_jurisdiction);
    if (typeof r.sovereignty?.residency_country === 'string') residencyByRegion.set(r.id, r.sovereignty.residency_country);
  }
  const organisational = readLzOrganisationalResult(join(runsDir, runId));
  return { lzId, provider, runId, merged, scans, operatorByRegion, residencyByRegion, catalogueRegions, baselines, ...(organisational && organisational.lz_id === lzId ? { organisational } : {}) };
}

function worst<T extends string>(a: T | undefined, b: T, rank: Record<string, number>): T {
  return a === undefined || (rank[b] ?? 9) < (rank[a] ?? 9) ? b : a;
}

function lzEntry(input: LzLiveRunInput, includeSimulated: boolean): { entry?: LzLivePortfolioLz; capabilities: LzLivePortfolioCapability[]; skipped?: string; baseline?: BaselineComparisonLzInput } {
  const all = input.merged;
  const simulatedScopes = all.scopes.filter((s) => s.simulated !== undefined);
  const excludeSim = !includeSimulated && simulatedScopes.length > 0;
  let merged = all;
  let basis: LzLivePortfolioLz['merge_basis'] = 'merged';
  if (excludeSim) {
    const kept = all.scopes.filter((s) => s.simulated === undefined);
    const keptScans = kept.map((s) => input.scans.get(s.scope_id)).filter((s): s is LzLiveScan => s !== undefined);
    if (!all.scopes.some((s) => s.status === 'merged' && s.simulated === undefined)) {
      return { capabilities: [], skipped: `every merged scope is simulated (${simulatedScopes.map((s) => s.scope_id).join(', ')}); pass --include-simulated to merge it` };
    }
    // A kept scope whose scan cannot be found is listed as missing, never filled from the simulated merge.
    merged = mergeLzLiveScopes({
      lzId: input.lzId,
      provider: input.provider,
      scans: keptScans,
      registeredScopes: kept.map((s) => ({ id: s.scope_id, kind: s.scope_kind ?? 'platform' })),
      windowDays: all.window_days,
      now: new Date(all.merged_at),
    });
    merged = { ...merged, merged_at: all.merged_at };
    basis = 're-merged';
  }

  const mergedScopes = merged.scopes.filter((s) => s.status === 'merged');
  const usedScans = mergedScopes.map((s) => input.scans.get(s.scope_id)).filter((s): s is LzLiveScan => s !== undefined);
  const simulatedIds = new Set(mergedScopes.filter((s) => s.simulated !== undefined).map((s) => s.scope_id));

  const enabledServices = merged.offering.services.filter((s) => Object.values(s.regions).some((r) => r.status === 'enabled'));
  const iac = { full: 0, read: 0, none: 0, unknown: 0 };
  for (const s of enabledServices) {
    const level = s.iac?.level;
    if (level === 'full' || level === 'read' || level === 'none') iac[level] += 1;
    else iac.unknown += 1;
  }

  // Lights per service and framework: worst over the merged scopes.
  const lightsByCode = new Map<string, Record<string, 'red' | 'amber' | 'green' | 'grey' | 'n/a'>>();
  for (const scan of usedScans) {
    for (const svc of scan.offering.services) {
      const acc = lightsByCode.get(svc.code) ?? {};
      for (const [fw, res] of Object.entries(svc.frameworks)) {
        if (res.light === 'n/a') { acc[fw] ??= 'n/a'; continue; }
        const prev = acc[fw];
        acc[fw] = prev === undefined || prev === 'n/a' ? res.light : worst(prev, res.light, LIGHT_RANK);
      }
      lightsByCode.set(svc.code, acc);
    }
  }
  const framework_lights: LzLivePortfolioLz['framework_lights'] = {};
  for (const svc of merged.offering.services) {
    for (const [fw, light] of Object.entries(lightsByCode.get(svc.code) ?? {})) {
      if (light === 'n/a') continue;
      const c = (framework_lights[fw] ??= { green: 0, amber: 0, red: 0, grey: 0 });
      c[light] += 1;
    }
  }

  const checks: LzLivePortfolioLz['checks'] = {};
  for (const scan of usedScans) for (const c of scan.estate.checks) checks[c.id] = worst(checks[c.id], c.status, LZ_LIVE_CHECK_RANK);

  const quotas: LzLivePortfolioLz['quotas'] = usedScans.flatMap((scan) => scan.estate.quotas.map((q) => ({ scope_id: scan.meta.scope_id, ...q })));
  const drift = usedScans.reduce((d, s) => ({ new: d.new + s.diff.new.length, removed: d.removed + s.diff.removed.length, status_changes: d.status_changes + s.diff.status_changes.length }), { new: 0, removed: 0, status_changes: 0 });

  const scopes: LzLivePortfolioLz['scopes'] = merged.scopes.map((s) => {
    const scan = input.scans.get(s.scope_id);
    return {
      scope_id: s.scope_id,
      ...(s.scope_kind ? { scope_kind: s.scope_kind } : {}),
      status: s.status,
      ...(s.observed_at ? { observed_at: s.observed_at } : {}),
      ...(s.age_days !== undefined ? { age_days: s.age_days } : {}),
      ...(scan ? { read_only: scan.meta.read_only } : {}),
      ...(s.simulated ? { simulated: s.simulated } : {}),
    };
  });

  const entry: LzLivePortfolioLz = {
    lz_id: input.lzId,
    provider: input.provider,
    run_id: input.runId,
    merged_at: merged.merged_at,
    window_days: merged.window_days,
    simulated: simulatedIds.size > 0,
    merge_basis: basis,
    scopes,
    excluded_simulated_scopes: excludeSim
      ? simulatedScopes.map((s) => ({ scope_id: s.scope_id, ...(s.simulated?.scenario ? { scenario: s.simulated.scenario } : {}), ...(s.simulated?.fidelity ? { fidelity: s.simulated.fidelity } : {}) }))
      : [],
    regions_enabled: merged.offering.regions.filter((r) => r.status === 'enabled').length,
    services_enabled: enabledServices.length,
    iac,
    framework_lights,
    checks,
    quotas,
    drift,
    ...(merged.estate.hierarchy ? { hierarchy: merged.estate.hierarchy } : {}),
    ...(input.organisational ? { organisational: { documents: input.organisational.documents.total, frameworks: Object.fromEntries(input.organisational.frameworks.map((f) => [f.id, f.counts] as const)) } } : {}),
  };

  // Capability rows: one per (service, region, capability tag).
  const regionCountry = new Map(merged.offering.regions.map((r) => [r.id, r.country] as const));
  const capabilities: LzLivePortfolioCapability[] = [];
  for (const svc of merged.offering.services) {
    for (const [region, st] of Object.entries(svc.regions)) {
      const country = regionCountry.get(region);
      const residency = input.residencyByRegion.get(region);
      const geographies = lzRegionGeographies({ id: region, ...(country ? { country } : {}), ...(residency ? { sovereignty: { residency_country: residency } } : {}) });
      const operator = input.operatorByRegion.get(region);
      for (const tag of svc.capability_tags) {
        capabilities.push({
          tag,
          lz_id: input.lzId,
          provider: input.provider,
          region,
          ...(country ? { country } : {}),
          geographies,
          ...(operator ? { operator_jurisdiction: operator } : {}),
          service: svc.code,
          status: st.status,
          ...(svc.iac?.level ? { iac_level: svc.iac.level } : {}),
          lights: lightsByCode.get(svc.code) ?? {},
          simulated: st.scope_id !== undefined && simulatedIds.has(st.scope_id),
        });
      }
    }
  }
  // #3872: baseline results of the merged scopes only (simulated scopes follow the merge, Design 121 section 10).
  const baselineScopes = mergedScopes.flatMap((s) => {
    const result = input.baselines?.get(s.scope_id);
    return result ? [{ scope_id: s.scope_id, scope_kind: s.scope_kind, result }] : [];
  });
  return {
    entry,
    capabilities,
    ...(baselineScopes.length > 0 ? { baseline: { lz_id: input.lzId, provider: input.provider, simulated: simulatedIds.size > 0, scopes: baselineScopes } } : {}),
  };
}

/** #3822: an application scope linked to an app (`landing_zones[].scopes[].app`). */
export interface LzLiveAppScope {
  lzId: string;
  scopeId: string;
  appId: string;
  /** Regions registered for the scope; empty = every region the scan observed enabled. */
  regions?: readonly string[];
}

export interface BuildLzLivePortfolioOptions {
  inputs: readonly (LzLiveRunInput | { lzId: string; reason: string })[];
  includeSimulated?: boolean;
  now?: Date;
  /** #3822: application scopes linked to apps. */
  appScopes?: readonly LzLiveAppScope[];
  /** #3822: the app's required services (its latest assessment); empty or undefined = no observed fit. */
  requiredServicesFor?: (appId: string) => LzRequiredService[] | undefined;
}

/**
 * #3822 (Design 120 section 11.2, item 4): the observed fit of every app named
 * by an application scope of this landing zone, per region, against the
 * scope's merged scan. Only merged scopes count (stale and missing have no
 * merged scan); a simulated scope counts only with --include-simulated and is
 * then marked. Regions: the scope's registered regions, else the regions the
 * scan observed enabled; a region needs its sovereignty facts in the run's
 * lz-live-catalogue.json, as every catalogue fit does.
 */
function appFitsFor(input: LzLiveRunInput, includeSimulated: boolean, opts: BuildLzLivePortfolioOptions, generatedAt: string): LzLivePortfolioAppFit[] {
  const out: LzLivePortfolioAppFit[] = [];
  for (const link of (opts.appScopes ?? []).filter((a) => a.lzId === input.lzId)) {
    const scope = input.merged.scopes.find((sc) => sc.scope_id === link.scopeId);
    if (!scope || scope.status !== 'merged') continue;
    const scan = input.scans.get(link.scopeId);
    if (!scan) continue;
    const simulated = scan.meta.simulated !== undefined || scope.simulated !== undefined;
    if (simulated && !includeSimulated) continue;
    const required = opts.requiredServicesFor?.(link.appId) ?? [];
    if (required.length === 0) continue;
    for (const { region: regionId, report } of lzLiveAppFitReports({ scan, scopeRegions: link.regions, catalogueRegions: input.catalogueRegions, required, generatedAt })) {
      out.push({
        app_id: link.appId,
        lz_id: input.lzId,
        scope_id: link.scopeId,
        provider: input.provider,
        region: regionId,
        verdict: report.overall,
        blockers: countLzFitBlockers(report.items),
        simulated,
      });
    }
  }
  return out;
}

export interface LzLiveAppFitReportsInput {
  scan: LzLiveScan;
  /** Regions registered for the scope; empty or absent = every region the scan observed enabled. */
  scopeRegions?: readonly string[];
  /** Region facts of the run's lz-live-catalogue.json; a region without facts is skipped. */
  catalogueRegions?: ReadonlyMap<string, LzRegion>;
  required: LzRequiredService[];
  generatedAt: string;
  sovereigntyRequirements?: SovereigntyRequirements;
  baselineDenies?: ReadonlyMap<string, string>;
  /** #3920: forwarded to the region fit (LzFitInput.requirementProvenance). */
  requirementProvenance?: readonly LzRequirementProvenance[];
}

/**
 * #3822 region rule, shared by the portfolio app fits and the live source of an
 * Application Assessment (#3887, Design 123 section 8.4): one observed fit per
 * region of the scope (registered regions, else the regions the scan observed
 * enabled) that has catalogue facts, through computeLzFitFromLiveScan.
 */
export function lzLiveAppFitReports(i: LzLiveAppFitReportsInput): { region: string; report: LzFitReport }[] {
  const regions = i.scopeRegions && i.scopeRegions.length > 0
    ? [...i.scopeRegions]
    : i.scan.offering.regions.filter((r) => r.status === 'enabled').map((r) => r.id);
  const out: { region: string; report: LzFitReport }[] = [];
  for (const regionId of regions) {
    const region = i.catalogueRegions?.get(regionId);
    if (!region) continue;
    const report = computeLzFitFromLiveScan({
      requiredServices: i.required, region, liveScan: i.scan, generatedAt: i.generatedAt,
      ...(i.sovereigntyRequirements ? { sovereigntyRequirements: i.sovereigntyRequirements } : {}),
      ...(i.baselineDenies ? { baselineDenies: i.baselineDenies } : {}),
      ...(i.requirementProvenance ? { requirementProvenance: i.requirementProvenance } : {}),
    });
    out.push({ region: regionId, report });
  }
  return out;
}

/** Pure merge of the landing zones' latest runs into the portfolio view (validated). */
export function buildLzLivePortfolio(opts: BuildLzLivePortfolioOptions): LzLivePortfolio {
  const includeSimulated = opts.includeSimulated === true;
  const landing_zones: LzLivePortfolioLz[] = [];
  const skipped: LzLivePortfolio['skipped'] = [];
  const capabilities: LzLivePortfolioCapability[] = [];
  const app_fits: LzLivePortfolioAppFit[] = [];
  const baselineInputs: BaselineComparisonLzInput[] = [];
  const generatedAt = (opts.now ?? new Date()).toISOString().slice(0, 10);
  for (const input of opts.inputs) {
    if ('reason' in input) {
      skipped.push({ lz_id: input.lzId, reason: input.reason });
      continue;
    }
    const r = lzEntry(input, includeSimulated);
    if (r.entry) {
      landing_zones.push(r.entry);
      capabilities.push(...r.capabilities);
      app_fits.push(...appFitsFor(input, includeSimulated, opts, generatedAt));
      if (r.baseline) baselineInputs.push(r.baseline);
    } else {
      skipped.push({ lz_id: input.lzId, reason: r.skipped ?? 'not merged' });
    }
  }
  return LzLivePortfolioSchema.parse({
    schema: 'lz-live-portfolio/1',
    generated_at: (opts.now ?? new Date()).toISOString(),
    include_simulated: includeSimulated,
    landing_zones,
    skipped,
    capabilities,
    app_fits,
    ...(() => { const c = buildBaselineComparison(baselineInputs); return c ? { baseline_comparison: c } : {}; })(),
  });
}

export interface CapabilityQuery {
  tag: string;
  geography?: string;
  status?: LzLivePortfolioCapability['status'];
  iacLevel?: string;
  /** Framework id and the light the service must have for it. */
  framework?: string;
  light?: 'green' | 'amber' | 'red' | 'grey';
  operatorJurisdiction?: string;
  includeSimulated?: boolean;
}

/**
 * Section 11.2 item 2: "where is `kubernetes` enabled in a `europe` region
 * with an EU-entity operator, IaC `full`, green for BSI C5?" Status defaults
 * to `enabled`; simulated rows are left out unless asked for.
 */
export function findLzLiveCapabilities(p: LzLivePortfolio, q: CapabilityQuery): LzLivePortfolioCapability[] {
  const status = q.status ?? 'enabled';
  return p.capabilities.filter((c) => c.tag === q.tag
    && c.status === status
    && (q.geography === undefined || c.geographies.includes(q.geography))
    && (q.iacLevel === undefined || c.iac_level === q.iacLevel)
    && (q.framework === undefined || c.lights[q.framework] === (q.light ?? 'green'))
    && (q.operatorJurisdiction === undefined || c.operator_jurisdiction === q.operatorJurisdiction)
    && (q.includeSimulated === true || !c.simulated));
}

/** Run folder name of the portfolio merge (same rule as the live runs). */
function portfolioRunId(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '-');
}

export interface LzLivePortfolioRunOptions {
  workspaceRoot: string;
  includeSimulated?: boolean;
  now?: () => Date;
  /** #3822: required services of an app (host-injected: the app's latest assessment signals). */
  requiredServicesFor?: (appId: string) => LzRequiredService[] | undefined;
}

export interface LzLivePortfolioRunOutcome {
  portfolio: LzLivePortfolio;
  file: string;
  runId: string;
}

/**
 * Merge every registered landing zone and write the portfolio artefact. The
 * caller rebuilds `portfolio-summary.json` (the single aggregator, 114 section
 * 5.3) afterwards.
 */
export function runLzLivePortfolio(opts: LzLivePortfolioRunOptions): LzLivePortfolioRunOutcome {
  const now = (opts.now ?? (() => new Date()))();
  const registered = readLandingZones(opts.workspaceRoot);
  const inputs = registered.map((lz) => {
    const r = readLzLiveRunForPortfolio(opts.workspaceRoot, lz.id, lz.provider);
    return typeof r === 'string' ? { lzId: lz.id, reason: r } : r;
  });
  // #3822: application scopes linked to an app.
  const appScopes: LzLiveAppScope[] = registered.flatMap((lz) => lz.scopes
    .filter((sc) => sc.kind === 'application' && typeof sc.app === 'string')
    .map((sc) => ({ lzId: lz.id, scopeId: sc.id, appId: sc.app as string, ...(sc.regions ? { regions: sc.regions } : {}) })));
  const portfolio = buildLzLivePortfolio({
    inputs,
    ...(opts.includeSimulated !== undefined ? { includeSimulated: opts.includeSimulated } : {}),
    now,
    appScopes,
    ...(opts.requiredServicesFor ? { requiredServicesFor: opts.requiredServicesFor } : {}),
  });
  const runId = portfolioRunId(now);
  const dir = join(opts.workspaceRoot, LZ_LIVE_PORTFOLIO_DIR);
  const runDir = join(dir, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const file = join(runDir, LZ_LIVE_PORTFOLIO_FILE);
  writeFileSync(file, yamlDump(portfolio, { noRefs: true, lineWidth: 120 }));
  if (portfolio.landing_zones.length > 0) writeFileSync(join(dir, LZ_LIVE_PORTFOLIO_LATEST), `${runId}\n`);
  return { portfolio, file, runId };
}

/** #3864: `, N unverified` only when a check is unverified, so existing output is unchanged. */
function unverifiedPart(checks: readonly LzLiveCheckStatus[]): string {
  const n = checks.filter((c) => c === 'unverified').length;
  return n > 0 ? `, ${n} unverified` : '';
}

/** Governance matrix lines for the CLI: LZ x framework shares, checks, IaC, stale scopes, `[SIM]`. */
export function formatLzLivePortfolio(p: LzLivePortfolio): string[] {
  const lines: string[] = [];
  const frameworks = [...new Set(p.landing_zones.flatMap((lz) => Object.keys(lz.framework_lights)))].sort();
  for (const lz of p.landing_zones) {
    const checks = Object.values(lz.checks);
    const fw = frameworks.map((f) => {
      const c = lz.framework_lights[f];
      return c ? `${f} ${c.green}g/${c.amber}a/${c.red}r/${c.grey}grey` : `${f} -`;
    }).join('; ');
    const stale = lz.scopes.filter((s) => s.status === 'stale').map((s) => s.scope_id);
    const missing = lz.scopes.filter((s) => s.status === 'missing').map((s) => s.scope_id);
    lines.push(`${lz.lz_id} (${lzProviderBrand(lz.provider)})${lz.simulated ? ' [SIM]' : ''}: run ${lz.run_id}, ${lz.scopes.filter((s) => s.status === 'merged').length} scope(s) merged, ${lz.regions_enabled} region(s), ${lz.services_enabled} service(s) enabled, IaC full ${lz.iac.full}/${lz.services_enabled}, checks ${checks.filter((c) => c === 'pass').length} pass, ${checks.filter((c) => c === 'fail').length} fail, ${checks.filter((c) => c === 'warn').length} warn${unverifiedPart(checks)}${fw ? `; ${fw}` : ''}`);
    if (stale.length > 0) lines.push(`  stale scope(s), not merged: ${stale.join(', ')}`);
    if (missing.length > 0) lines.push(`  missing scope(s), no scan: ${missing.join(', ')}`);
    // #4050: organisational controls decided from the landing zone ingestion folder.
    for (const [f, c] of Object.entries(lz.organisational?.frameworks ?? {})) lines.push(`  organisational ${f}: ${c.satisfied} documented, ${c.partial} partly, ${c.unknown} not evaluated, ${c.n_a} n/a (${lz.organisational?.documents ?? 0} document(s))`);
    // #3822: observed app fits of this landing zone.
    for (const f of p.app_fits.filter((x) => x.lz_id === lz.lz_id)) lines.push(`  app ${f.app_id} (scope ${f.scope_id}) in ${f.region}: ${f.verdict}, ${f.blockers} blocker(s), confidence observed${f.simulated ? ' [SIM]' : ''}`);
    if (lz.excluded_simulated_scopes.length > 0) lines.push(`  simulated scope(s) left out (pass --include-simulated): ${lz.excluded_simulated_scopes.map((s) => s.scope_id).join(', ')}`);
  }
  for (const s of p.skipped) lines.push(`${s.lz_id}: not merged (${s.reason})`);
  if (p.baseline_comparison) lines.push(...formatBaselineComparison(p.baseline_comparison));
  return lines;
}
