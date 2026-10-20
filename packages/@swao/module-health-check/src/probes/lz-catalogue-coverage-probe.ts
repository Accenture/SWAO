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

// #1698 / #2222: LZ catalogue structural validity probe.
// #3155: checks every provider catalogue the fit can resolve (bundled catalogues plus
// workspace copies in every layout, including the per-provider
// `<provider>/index.json` written by `swao lz catalogue copy/new`) through the
// same layered resolver the fit and the run manifest use. A workspace file that
// fails schema validation or carries duplicate region ids is a warning.
// Service coverage gaps are NOT checked -- those vary by deployment target and
// are not a health concern.
//
// #3282: the probe also runs the LZ catalogue quality rules (module-landing-zone
// catalogue/quality.ts, shared with tests/audit-gates/lz-catalogue-quality.gate.mjs)
// over the bundled catalogues and any workspace catalogue directory holding
// catalogue files (#3298: found by the shared discovery, no index.json), and
// checks the LZ targets configured in .swao.yml. A bundled catalogue that fails to load is a warning naming file and reason (it used to
// be skipped silently). Any finding makes the probe WARN; the probe never FAILs.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { load } from 'js-yaml';
import {
  isLzCataloguesDir,
  listLzCatalogueProviders,
  resolveProviderCatalogue,
  resolveBundledLzCataloguesDir,
  checkLzCatalogueQuality,
  checkLzConfiguredTargets,
  readLzConfiguredTargets,
  resolveLzGeography,
  formatLzQualityFindings,
  LzCatalogueSchemaError,
  LzCatalogueDuplicateIdError,
} from '@swao/module-landing-zone';
import type { LzCatalogueQualityFinding, LzConfiguredTarget, LzGeographyRegion } from '@swao/module-landing-zone';

export type LzCatalogueCoverageStatus = 'ok' | 'warn' | 'info' | 'fail';

/** #3282: LZ catalogue quality results carried in `health-check --json`. */
export interface LzCatalogueQualityProbeDetail {
  /** Catalogue directories the rules ran over (bundled first). */
  dirs_checked: string[];
  catalogues_checked: number;
  rules_checked: number;
  max_age_days: number;
  /** Configured .swao.yml targets checked against the catalogue region ids. */
  targets_checked: number;
  errors: number;
  warnings: number;
  findings: LzCatalogueQualityFinding[];
}

export interface LzCatalogueCoverageProbeResult {
  status: LzCatalogueCoverageStatus;
  message: string;
  detail: string;
  gaps_count: number;
  /** #3282: one line per structural issue or grouped quality finding (text output). */
  detail_lines?: string[];
  /** #3282: catalogue quality rule results (absent only in hand-built fixtures). */
  quality?: LzCatalogueQualityProbeDetail;
}

export interface LzCatalogueCoverageProbeOptions {
  /** Clock for the age rule (tests). */
  now?: Date;
  /** Override the bundled catalogue directory (tests); null skips the bundled quality run. */
  bundledDir?: string | null;
  /** Age threshold in days (default LZ_CATALOGUE_MAX_AGE_DAYS). */
  maxAgeDays?: number;
}

/** Workspace and app .swao.yml files, workspace first. */
function swaoYmlFiles(workspacePath: string): string[] {
  const files = [join(workspacePath, '.swao.yml')];
  const appsDir = join(workspacePath, 'apps');
  if (existsSync(appsDir)) {
    try {
      for (const name of readdirSync(appsDir).sort()) {
        const p = join(appsDir, name, '.swao.yml');
        try { if (statSync(join(appsDir, name)).isDirectory() && existsSync(p)) files.push(p); } catch { /* skip */ }
      }
    } catch { /* unreadable apps dir */ }
  }
  return files.filter((f) => existsSync(f));
}

/** Every configured LZ target (read-only; an unparsable .swao.yml is left to other probes). */
export function readWorkspaceLzTargets(workspacePath: string): LzConfiguredTarget[] {
  const targets: LzConfiguredTarget[] = [];
  for (const file of swaoYmlFiles(workspacePath)) {
    let parsed: unknown;
    try { parsed = load(readFileSync(file, 'utf-8')); } catch { continue; }
    targets.push(...readLzConfiguredTargets(parsed, relative(workspacePath, file).replace(/\\/g, '/')));
  }
  return targets;
}

export function buildLzCatalogueCoverageProbe(
  workspacePath: string,
  opts: LzCatalogueCoverageProbeOptions = {},
): LzCatalogueCoverageProbeResult {
  // --- #3282: quality rules over the bundled + workspace catalogue directories.
  const findings: LzCatalogueQualityFinding[] = [];
  const dirsChecked: string[] = [];
  let cataloguesChecked = 0;
  let rulesChecked = 0;
  let maxAgeDays = opts.maxAgeDays ?? 0;
  const bundled = opts.bundledDir === undefined ? resolveBundledLzCataloguesDir() : opts.bundledDir;
  const workspaceDirs = [
    join(workspacePath, 'wsp', 'inputs', 'catalogs', 'lz-catalogues'),
    join(workspacePath, 'lz-catalogues'),
  ].filter((d) => isLzCataloguesDir(d)); // #3298: catalogue files are the marker, not index.json
  for (const dir of [bundled, ...workspaceDirs]) {
    if (!dir || dirsChecked.includes(dir)) continue;
    // Workspace folders are overlays (#1437): only the refreshed providers live
    // there, so they borrow the bundled template when they have none.
    const overlay = dir !== bundled;
    const report = checkLzCatalogueQuality(dir, {
      now: opts.now,
      maxAgeDays: opts.maxAgeDays,
      overlay,
      templateFile: overlay && bundled ? join(bundled, '_lz-catalogue-template.json') : undefined,
    });
    dirsChecked.push(dir);
    cataloguesChecked += report.catalogues_checked;
    rulesChecked = report.rules_checked;
    maxAgeDays = report.max_age_days;
    const scope = dir === bundled ? 'bundled' : relative(workspacePath, dir).replace(/\\/g, '/');
    for (const f of report.findings) findings.push({ ...f, file: `${scope}/${f.file}` });
  }

  // --- Structural validity through the layered resolver (#1698 / #3155).
  const providers = listLzCatalogueProviders(workspacePath);
  const invalid: string[] = [];
  const regionIdsByProvider: Record<string, string[]> = {};
  const regionsByProvider: Record<string, LzGeographyRegion[]> = {}; // #3281 geography resolution
  let valid = 0;
  let workspace = 0;
  for (const provider of providers) {
    try {
      const { catalogue, provenance } = resolveProviderCatalogue(provider, workspacePath);
      regionIdsByProvider[provider] = catalogue.regions.map((r) => r.id);
      regionsByProvider[provider] = catalogue.regions;
      valid++;
      if (provenance === 'workspace') workspace++;
    } catch (err) {
      regionIdsByProvider[provider] = []; // known provider, catalogue unusable: no region hint
      if (err instanceof LzCatalogueSchemaError || err instanceof LzCatalogueDuplicateIdError) {
        invalid.push(`${provider}: ${err.message}`);
      } else if (!(err instanceof Error && err.message.startsWith('No catalogue found'))) {
        // #3282: a bundled catalogue that fails to parse or validate is reported, never skipped.
        const reason = err instanceof Error ? err.message.replace(/\s+/g, ' ').slice(0, 300) : String(err);
        invalid.push(`${provider}: bundled catalogue ${provider}.json failed to load: ${reason}`);
      }
      // Not found in any layer: the provider list is built from the files, so this does not occur.
    }
  }

  // --- Configured targets (.swao.yml; the #3281 `targets` key is read when present).
  const targets = readWorkspaceLzTargets(workspacePath);
  // #3281: a known geography (azure:Europe) is info naming the resolved region, as in `swao assess`.
  if (providers.length > 0) {
    findings.push(...checkLzConfiguredTargets(targets, regionIdsByProvider,
      (provider, region) => resolveLzGeography(region, regionsByProvider[provider] ?? [])));
  }

  const quality: LzCatalogueQualityProbeDetail = {
    dirs_checked: dirsChecked,
    catalogues_checked: cataloguesChecked,
    rules_checked: rulesChecked,
    max_age_days: maxAgeDays,
    targets_checked: targets.length,
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warn').length,
    findings,
  };

  if (providers.length === 0) {
    return {
      status: 'info',
      message: 'No LZ catalogues found -- run Update LZ Catalogue (Tools menu)',
      detail: '',
      gaps_count: 0,
      quality,
    };
  }

  // #3281: info findings (a geography resolved to its default region) are
  // reported but never turn the probe to WARN.
  const defects = findings.filter((f) => f.severity !== 'info');
  const qualityText = defects.length > 0
    ? `; quality rules: ${quality.errors} error(s), ${quality.warnings} warning(s)`
    : '; quality rules passed';

  if (invalid.length === 0 && defects.length === 0) {
    const infoLines = formatLzQualityFindings(findings);
    return {
      status: 'ok',
      message: `${valid} LZ catalogue(s) present and structurally valid (${workspace} workspace, ${valid - workspace} bundled)${qualityText}`,
      detail: infoLines.join('; '),
      ...(infoLines.length > 0 ? { detail_lines: infoLines } : {}),
      gaps_count: 0,
      quality,
    };
  }

  return {
    status: 'warn',
    message: invalid.length > 0
      ? `${invalid.length} of ${valid + invalid.length} catalogue(s) have structural issues${qualityText}`
      : `${valid} LZ catalogue(s) present and structurally valid (${workspace} workspace, ${valid - workspace} bundled)${qualityText}`,
    detail: [...invalid, ...formatLzQualityFindings(findings)].join('; '),
    detail_lines: [...invalid.map((l) => `[WARN] ${l}`), ...formatLzQualityFindings(findings)],
    gaps_count: invalid.length,
    quality,
  };
}
