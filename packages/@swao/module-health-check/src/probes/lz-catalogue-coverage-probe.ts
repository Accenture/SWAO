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

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { load } from 'js-yaml';
import { listAppConfigs } from '../app-config-walk.js';
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
  /**
   * #4228: workspace catalogue files identical to the bundled file of the same
   * name (workspace-relative); their findings repeat the bundled ones and are
   * reported once, under the bundled catalogue.
   */
  identical_copies?: string[];
}

/** #4228: catalogue file names in `dir` whose content equals the bundled file of the same name. */
export function identicalCatalogueFiles(dir: string, bundledDir: string): Set<string> {
  const same = new Set<string>();
  const norm = (path: string): string | null => {
    try {
      const raw = readFileSync(path, 'utf-8');
      try { return JSON.stringify(JSON.parse(raw)); } catch { return raw; }
    } catch { return null; }
  };
  let names: string[] = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return same; }
  for (const name of names) {
    const other = join(bundledDir, name);
    if (!existsSync(other)) continue;
    const a = norm(join(dir, name));
    if (a !== null && a === norm(other)) same.add(name);
  }
  return same;
}

/**
 * #4113: one named quality finding group (catalogue, rule, short text) carried in
 * the probe result, the NDJSON log and the TUI detail. Findings of one rule in one
 * catalogue file are grouped; `regions` names the affected regions (capped).
 */
export interface LzCatalogueQualityFindingSummary {
  catalogue: string;
  rule: string;
  severity: 'error' | 'warn' | 'info';
  /** Number of findings in the group (one per region, or 1 for a file-level finding). */
  count: number;
  /** Affected region ids, first LZ_QUALITY_SUMMARY_REGIONS_MAX only. */
  regions: string[];
  text: string;
}

/** #4113: groups carried in `quality_findings`; the rest are counted in `quality_findings_more`. */
export const LZ_QUALITY_SUMMARY_MAX = 20;
const LZ_QUALITY_SUMMARY_REGIONS_MAX = 12;

/**
 * #4113: group the quality findings per severity, rule and catalogue file, errors
 * first, then warnings, then info; capped at `max` groups with a count of the rest.
 */
export function summariseLzQualityFindings(
  findings: readonly LzCatalogueQualityFinding[],
  max = LZ_QUALITY_SUMMARY_MAX,
): { findings: LzCatalogueQualityFindingSummary[]; more: number } {
  const groups = new Map<string, LzCatalogueQualityFindingSummary>();
  for (const f of findings) {
    const key = `${f.severity}|${f.rule}|${f.file}`;
    let g = groups.get(key);
    if (!g) {
      g = { catalogue: f.file, rule: f.rule, severity: f.severity, count: 0, regions: [], text: f.message };
      groups.set(key, g);
    }
    g.count += 1;
    if (f.region && g.regions.length < LZ_QUALITY_SUMMARY_REGIONS_MAX) g.regions.push(f.region);
  }
  const order = { error: 0, warn: 1, info: 2 } as const;
  const all = [...groups.values()].sort((a, b) => order[a.severity] - order[b.severity]);
  return { findings: all.slice(0, max), more: Math.max(0, all.length - max) };
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
  /** #4113: the quality findings by name (grouped, capped), for the log and the TUI. */
  quality_findings?: LzCatalogueQualityFindingSummary[];
  /** #4113: finding groups beyond the cap (the full list is in `quality.findings`). */
  quality_findings_more?: number;
}

export interface LzCatalogueCoverageProbeOptions {
  /** Clock for the age rule (tests). */
  now?: Date;
  /** Override the bundled catalogue directory (tests); null skips the bundled quality run. */
  bundledDir?: string | null;
  /** Age threshold in days (default LZ_CATALOGUE_MAX_AGE_DAYS). */
  maxAgeDays?: number;
}

/**
 * Every configured LZ target (read-only; an unparsable .swao.yml is left to other probes).
 * The workspace .swao.yml first, then the app configs in name order; #4461: the
 * app configs come from the shared walk (one read per health check).
 */
export function readWorkspaceLzTargets(workspacePath: string): LzConfiguredTarget[] {
  const targets: LzConfiguredTarget[] = [];
  const wsFile = join(workspacePath, '.swao.yml');
  if (existsSync(wsFile)) {
    let parsed: unknown;
    let parsedOk = true;
    try { parsed = load(readFileSync(wsFile, 'utf-8')); } catch { parsedOk = false; /* unparsable: left to other probes */ }
    if (parsedOk) targets.push(...readLzConfiguredTargets(parsed, relative(workspacePath, wsFile).split(sep).join('/')));
  }
  const apps = [...listAppConfigs(workspacePath)].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const cfg of apps) {
    if (cfg.parseError) continue;
    targets.push(...readLzConfiguredTargets(cfg.doc, relative(workspacePath, cfg.configPath).split(sep).join('/')));
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
  // #4228: a workspace copy identical to the bundled catalogue repeats its
  // findings; each is reported once (under the bundled catalogue).
  const bundledFindingKeys = new Set<string>();
  const findingKey = (f: LzCatalogueQualityFinding): string => `${f.file}|${f.rule}|${f.severity}|${f.region ?? ''}|${f.message}`;
  const identicalCopies: string[] = [];
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
    const identical = dir !== bundled && bundled ? identicalCatalogueFiles(dir, bundled) : new Set<string>();
    for (const name of identical) identicalCopies.push(`${scope}/${name}`);
    for (const f of report.findings) {
      if (dir === bundled) bundledFindingKeys.add(findingKey(f));
      else if (identical.has(f.file) && bundledFindingKeys.has(findingKey(f))) continue;
      findings.push({ ...f, file: `${scope}/${f.file}` });
    }
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
    ...(identicalCopies.length > 0 ? { identical_copies: identicalCopies } : {}),
  };
  const summary = summariseLzQualityFindings(findings);
  const named = {
    quality_findings: summary.findings,
    ...(summary.more > 0 ? { quality_findings_more: summary.more } : {}),
  };

  if (providers.length === 0) {
    return {
      status: 'info',
      message: 'No LZ catalogues found -- run Update LZ Catalogue (Tools menu)',
      detail: '',
      gaps_count: 0,
      quality,
      ...named,
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
      ...named,
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
    ...named,
  };
}
