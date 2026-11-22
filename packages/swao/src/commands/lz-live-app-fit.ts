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

// #3822 (Design 120 section 11.2, item 4): the required services of an app for
// its observed fit against a live application scope. Same derivation as the LZ
// catalogue fit of `swao assess --type landing-zone-catalog` (commands/assess.ts:
// loadPriorSignals -> deriveConstraints -> toLzRequiredServices), so both fits
// judge the same requirements. Host-side, because the signals belong to the
// app-assessment module and module-landing-zone must not import it.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { deriveConstraints, LZ_LIVE_STALENESS_DAYS, type LzLiveScan, type LzRequirementProvenance } from '@swao/core';
import { loadPriorSignals } from '@swao/module-app-assessment';
import { lzLiveAppFitReports, readLzLiveRunForPortfolio, toLzRequiredServices } from '@swao/module-landing-zone';
import type { LzFitReport, LzRequiredService, SovereigntyRequirements } from '@swao/module-landing-zone';

/** Required services of `apps/<appId>`, or undefined when the app has no assessed signals. */
export function lzLiveAppRequiredServices(workspaceRoot: string, appId: string): LzRequiredService[] | undefined {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId)) return undefined;
  const appDir = join(workspaceRoot, 'apps', appId);
  if (!existsSync(appDir)) return undefined;
  try {
    const required = toLzRequiredServices(deriveConstraints(loadPriorSignals(appDir)).requiredServices);
    return required.length > 0 ? required : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// #3887 (Design 123 section 8.4, D-08): the inline LZ fit of an Application
// Assessment on the live source. Reuses the #3822 pieces: the run reader of the
// portfolio (readLzLiveRunForPortfolio), the region rule (lzLiveAppFitReports)
// and the required-services derivation above. Simulated scopes are left out
// unless --include-simulated (Design 121 section 10). Never falls back to the
// catalogue: no usable live scan is an error the host reports.
// ---------------------------------------------------------------------------

// #4244 (owner decision 2026-11-09): the live LZ source of an app assessment
// is retired (live landing-zone data is used only by the LZ Live Assessment), so
// its tier refusal and the #3980 link fallback decision are gone; resolveLzSource
// (@swao/core) refuses --lz-source live on every tier and the host warns on a link.

export interface LiveInlineFitInput {
  workspaceRoot: string;
  lzId: string;
  provider: string;
  /** Scopes to use; empty = every scope of the run. */
  scopeIds: readonly string[];
  /** Registered regions per scope (landing_zones[].scopes[].regions). */
  scopeRegions: ReadonlyMap<string, readonly string[]>;
  required: LzRequiredService[];
  sovereigntyRequirements?: SovereigntyRequirements;
  /** #3888 (D-12): capability -> baseline service_deny policy id; forwarded to the region fit. */
  baselineDenies?: ReadonlyMap<string, string>;
  /** #3920 (Design 123 section 9.3): value-level requirement provenance (baseline selected only); forwarded to the region fit. */
  requirementProvenance?: readonly LzRequirementProvenance[];
  includeSimulated?: boolean;
  now: Date;
  generatedAt: string;
}

export interface LiveInlineFit {
  scope_id: string;
  region: string;
  report: LzFitReport;
}

export interface LiveInlineFitResult {
  run_id: string;
  scopes: string[];
  /** The newest scan used is older than the staleness window (7 days, LZ_LIVE_STALENESS_DAYS). */
  stale: boolean;
  age_days: number;
  fits: LiveInlineFit[];
  warnings: string[];
}

/** Validate the live source before any pass runs: a run exists with at least one usable scope scan. */
export function liveInlineFit(i: LiveInlineFitInput): { ok: true; value: LiveInlineFitResult } | { ok: false; error: string } {
  const run = readLzLiveRunForPortfolio(i.workspaceRoot, i.lzId, i.provider);
  if (typeof run === 'string') {
    return { ok: false, error: `--lz-source live: landing zone ${i.lzId} has no usable live run (${run}); run swao assess --type landing-zone-live --lz ${i.lzId} first` };
  }
  const wanted = i.scopeIds.length > 0 ? [...i.scopeIds] : [...run.scans.keys()].sort();
  const warnings: string[] = [];
  const used: { scopeId: string; scan: LzLiveScan }[] = [];
  for (const scopeId of wanted) {
    const scan = run.scans.get(scopeId);
    if (!scan) { warnings.push(`scope ${scopeId} has no scan in run ${run.runId}`); continue; }
    if (scan.meta.simulated !== undefined && i.includeSimulated !== true) { warnings.push(`scope ${scopeId} of run ${run.runId} is simulated and is left out (pass --include-simulated to use it)`); continue; }
    used.push({ scopeId, scan });
  }
  if (used.length === 0) {
    return { ok: false, error: `--lz-source live: run ${run.runId} of ${i.lzId} has no usable scope scan for ${wanted.join(', ') || 'any scope'} (${warnings.join('; ') || 'no scans'})` };
  }
  const newest = Math.max(...used.map((u) => Date.parse(u.scan.meta.observed_at)));
  const ageDays = Number.isFinite(newest) ? Math.floor((i.now.getTime() - newest) / 86_400_000) : Number.POSITIVE_INFINITY;
  const stale = ageDays > LZ_LIVE_STALENESS_DAYS;
  if (stale) warnings.push(`live run ${run.runId} of ${i.lzId} is ${Number.isFinite(ageDays) ? `${ageDays} days` : 'of unknown age and'} older than the ${LZ_LIVE_STALENESS_DAYS}-day window; the fit uses it, re-run swao assess --type landing-zone-live --lz ${i.lzId} for current results`);
  const fits: LiveInlineFit[] = [];
  for (const { scopeId, scan } of used) {
    const regions = i.scopeRegions.get(scopeId);
    for (const f of lzLiveAppFitReports({
      scan, ...(regions ? { scopeRegions: regions } : {}), catalogueRegions: run.catalogueRegions, required: i.required, generatedAt: i.generatedAt,
      ...(i.sovereigntyRequirements ? { sovereigntyRequirements: i.sovereigntyRequirements } : {}),
      ...(i.baselineDenies ? { baselineDenies: i.baselineDenies } : {}),
      ...(i.requirementProvenance ? { requirementProvenance: i.requirementProvenance } : {}),
    })) {
      fits.push({ scope_id: scopeId, region: f.region, report: f.report });
    }
  }
  return { ok: true, value: { run_id: run.runId, scopes: used.map((u) => u.scopeId), stale, age_days: Number.isFinite(ageDays) ? ageDays : -1, fits, warnings } };
}

/** File name of one live fit at the run root; the existing catalogue fit names, so every reader keeps working (lz-fit-files.ts). */
export function liveInlineFitFileName(fit: LiveInlineFit, provider: string, total: number, scopeCount: number): string {
  if (total === 1) return 'lz-catalogue-fit.yaml';
  const scope = scopeCount > 1 ? `-${fit.scope_id}` : '';
  return `lz-catalogue-fit-${provider}-${fit.region.replace(/[^a-zA-Z0-9-]/g, '-')}${scope}.yaml`;
}

/** The fit report as written: the computeLzFit report plus where it came from (confidence observed, Design 123 section 8.4). */
export function liveInlineFitDocument(fit: LiveInlineFit, r: LiveInlineFitResult, lzId: string): Record<string, unknown> {
  return {
    ...(fit.report as unknown as Record<string, unknown>),
    lz_source: 'live',
    confidence: 'observed',
    lz_id: lzId,
    scope_id: fit.scope_id,
    lz_live_run: r.run_id,
    ...(r.stale ? { stale: true } : {}),
  };
}
