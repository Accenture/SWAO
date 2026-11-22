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

// #4194 SET-05 (Design 125 section 5.4): the read side of the Landing Zone
// Catalog branch. Pure functions over the workspace, shared by the step
// components and the non-interactive `check` of each step (section 8: the
// TUI and the CLI call the same functions). Nothing here writes.
//
// Sources: the layered catalogue list `listLzCatalogues`
// (@swao/module-landing-zone catalogue/loader.ts), the quality rules
// `checkLzCatalogueQuality` (#3282, #4113 names the findings), the targets
// reader `readLzCatalogDefaults` (setup/defaults.ts, Design 125 section 5.7)
// and the freshness threshold LZ_CATALOGUE_MAX_AGE_DAYS (quality.ts).

import { join } from 'node:path';
import {
  checkLzCatalogueQuality,
  checkLzConfiguredTargets,
  isLzCatalogueEntryError,
  isLzCataloguesDir,
  listLzCatalogues,
  LZ_CATALOGUE_MAX_AGE_DAYS,
  parseLzDate,
  resolveBundledLzCataloguesDir,
  resolveLzGeography,
  resolveProviderCatalogue,
  scanLzCatalogueFiles,
  type LzCatalogueListing,
  type LzCatalogueQualityFinding,
  type LzGeographyRegion,
} from '@swao/module-landing-zone';
import { readLzCatalogDefaults } from '../defaults.js';
import type { SetupCheckItem } from '../types.js';

/** Where a catalogue comes from (Design 125 section 5.4). */
export type LzCatalogueOrigin = 'bundled' | 'workspace copy' | 'user-defined';

/** One catalogue row of the Catalogues step. */
export interface LzCatalogueRow {
  provider: string;
  origin: LzCatalogueOrigin;
  /** Display name from the catalogue meta block; absent when the meta block is unreadable. */
  name?: string;
  lastUpdated?: string;
  /** Days since last_updated; undefined when the date is missing or not YYYY-MM-DD. */
  ageDays?: number;
  /** Older than the freshness threshold, or no readable date. */
  stale: boolean;
  /** Why the catalogue meta block could not be read (the catalogue cannot be used). */
  error?: string;
  /** Quality findings of this catalogue file (#3282 rules, named per #4113). */
  qualityErrors: number;
  qualityWarnings: number;
  /** Rule ids of the findings, errors first, unique. */
  qualityRules: string[];
  /** #4296: catalogue `meta.confidence` and region count, for the guidance box. */
  confidence?: string;
  regionsCount?: number;
}

/** Injectable sources, so tests run on fixture folders without the bundled catalogues. */
export interface LzCatalogSources {
  now?: Date;
  maxAgeDays?: number;
  /** The layered catalogue list (default: listLzCatalogues). */
  list?: (workspaceRoot: string) => LzCatalogueListing[];
  /** Providers of the bundled catalogues (default: the bundled directory scan). */
  bundledProviders?: () => string[];
  /** Quality findings keyed `<bundled|workspace>:<provider>` (default: checkLzCatalogueQuality per directory). */
  quality?: (workspaceRoot: string, now: Date, maxAgeDays: number) => Map<string, LzCatalogueQualityFinding[]>;
}

const DAY_MS = 86_400_000;

function defaultBundledProviders(): string[] {
  const dir = resolveBundledLzCataloguesDir();
  return dir ? scanLzCatalogueFiles(dir).map((r) => r.provider) : [];
}

function providerOfFinding(f: LzCatalogueQualityFinding): string {
  if (f.provider) return f.provider;
  const base = f.file.replace(/\\/g, '/');
  return base.replace(/\/index\.json$/, '').replace(/\.json$/, '');
}

/** The quality rules over the bundled directory and the workspace overlay folders, as the coverage probe runs them. */
export function lzCatalogueQualityByProvider(workspaceRoot: string, now: Date, maxAgeDays: number): Map<string, LzCatalogueQualityFinding[]> {
  const out = new Map<string, LzCatalogueQualityFinding[]>();
  const add = (layer: 'bundled' | 'workspace', f: LzCatalogueQualityFinding): void => {
    const key = `${layer}:${providerOfFinding(f)}`;
    out.set(key, [...(out.get(key) ?? []), f]);
  };
  const bundled = resolveBundledLzCataloguesDir();
  if (bundled) {
    try {
      for (const f of checkLzCatalogueQuality(bundled, { now, maxAgeDays }).findings) add('bundled', f);
    } catch { /* an unreadable bundle is reported by the health check */ }
  }
  const workspaceDirs = [join(workspaceRoot, 'wsp', 'inputs', 'catalogs', 'lz-catalogues'), join(workspaceRoot, 'lz-catalogues')];
  for (const dir of workspaceDirs) {
    if (!isLzCataloguesDir(dir)) continue;
    try {
      const report = checkLzCatalogueQuality(dir, {
        now,
        maxAgeDays,
        overlay: true,
        ...(bundled ? { templateFile: join(bundled, '_lz-catalogue-template.json') } : {}),
      });
      for (const f of report.findings) add('workspace', f);
    } catch { /* reported by the health check */ }
  }
  return out;
}

/**
 * The catalogues per provider: origin (bundled, workspace copy of a bundled
 * provider, or user-defined: a provider SWAO does not ship, or a catalogue
 * declared `operator-declared`, #1012), last_updated, age and quality findings.
 */
export function listLzCatalogueRows(workspaceRoot: string, src: LzCatalogSources = {}): LzCatalogueRow[] {
  const now = src.now ?? new Date();
  const maxAgeDays = src.maxAgeDays ?? LZ_CATALOGUE_MAX_AGE_DAYS;
  let listing: LzCatalogueListing[] = [];
  try { listing = (src.list ?? ((ws) => listLzCatalogues(ws)))(workspaceRoot); } catch { listing = []; }
  let bundledList: string[] = [];
  try { bundledList = (src.bundledProviders ?? defaultBundledProviders)(); } catch { bundledList = []; }
  const bundledSet = new Set(bundledList);
  let quality = new Map<string, LzCatalogueQualityFinding[]>();
  try { quality = (src.quality ?? lzCatalogueQualityByProvider)(workspaceRoot, now, maxAgeDays); } catch { /* none */ }

  return listing.map((row): LzCatalogueRow => {
    const layer = row.provenance === 'bundled' ? 'bundled' : 'workspace';
    const findings = (quality.get(`${layer}:${row.provider}`) ?? []).filter((f) => f.severity !== 'info');
    const rules = [...new Set([...findings.filter((f) => f.severity === 'error'), ...findings.filter((f) => f.severity === 'warn')].map((f) => f.rule))];
    const base = {
      provider: row.provider,
      qualityErrors: findings.filter((f) => f.severity === 'error').length,
      qualityWarnings: findings.filter((f) => f.severity === 'warn').length,
      qualityRules: rules,
    };
    if (isLzCatalogueEntryError(row)) {
      const origin: LzCatalogueOrigin = layer === 'bundled' ? 'bundled' : bundledSet.has(row.provider) ? 'workspace copy' : 'user-defined';
      return { ...base, origin, stale: true, error: row.error };
    }
    const origin: LzCatalogueOrigin = layer === 'bundled'
      ? 'bundled'
      : !bundledSet.has(row.provider) || row.confidence === 'operator-declared' ? 'user-defined' : 'workspace copy';
    const date = parseLzDate(row.last_updated);
    const ageDays = date ? Math.floor((now.getTime() - date.getTime()) / DAY_MS) : undefined;
    return {
      ...base,
      origin,
      name: row.short_description,
      lastUpdated: row.last_updated,
      ...(row.confidence ? { confidence: row.confidence } : {}),
      ...(typeof row.regions_count === 'number' ? { regionsCount: row.regions_count } : {}),
      ...(ageDays !== undefined ? { ageDays } : {}),
      stale: ageDays === undefined || ageDays > maxAgeDays,
    };
  });
}

/** One configured target and whether it names a known provider and region. */
export interface LzTargetStatus {
  label: string;
  valid: boolean;
  /** Short reason for an invalid target (no CLI syntax). */
  problem?: string;
}

/** Region loader per provider (default: the layered resolver). */
export type LzRegionLoader = (provider: string, workspaceRoot: string) => LzGeographyRegion[];

export const defaultLzRegionLoader: LzRegionLoader = (provider, workspaceRoot) =>
  resolveProviderCatalogue(provider, workspaceRoot).catalogue.regions;

/**
 * The targets of `assessment.landing_zone.targets` checked against the
 * catalogue regions. A known geography (`azure:Europe`) is valid: it
 * resolves to its default region at run time (#3281).
 */
export function checkLzTargets(
  workspaceRoot: string,
  providers: readonly string[],
  loadRegions: LzRegionLoader = defaultLzRegionLoader,
): LzTargetStatus[] {
  const labels = readLzCatalogDefaults(workspaceRoot).targets;
  if (labels.length === 0) return [];
  const regionIds: Record<string, string[]> = {};
  const regions: Record<string, LzGeographyRegion[]> = {};
  for (const p of providers) {
    try {
      const loaded = loadRegions(p, workspaceRoot);
      regions[p] = loaded;
      regionIds[p] = loaded.map((r) => r.id);
    } catch { regionIds[p] = []; }
  }
  const configured = labels.map((label, i) => {
    const colon = label.indexOf(':');
    return {
      provider: colon > 0 ? label.slice(0, colon) : label,
      region: colon > 0 ? label.slice(colon + 1) : '',
      origin: `targets[${i}]`,
      file: '.swao.yml',
    };
  });
  const findings = checkLzConfiguredTargets(configured, regionIds, (p, r) => resolveLzGeography(r, regions[p] ?? []));
  return configured.map((t, i) => {
    const f = findings.find((x) => x.severity !== 'info' && x.message.startsWith(`${t.origin}:`));
    if (!f) return { label: labels[i]!, valid: true };
    const problem = !(t.provider in regionIds) ? 'unknown provider' : t.region === '' ? 'no region' : 'unknown region';
    return { label: labels[i]!, valid: false, problem };
  });
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Check of the Catalogues step: one line per catalogue. */
export function checkLzCatalogues(workspaceRoot: string, src: LzCatalogSources = {}): SetupCheckItem[] {
  const rows = listLzCatalogueRows(workspaceRoot, src);
  if (rows.length === 0) return [{ label: 'LZ catalogues', state: 'missing', detail: 'no catalogue found; update the LZ catalogues from the Tools menu' }];
  return rows.map((r): SetupCheckItem => {
    if (r.error) return { label: `Catalogue ${r.provider}`, state: 'missing', detail: `${r.origin}, meta block unreadable` };
    const q = r.qualityErrors > 0 || r.qualityWarnings > 0
      ? `, ${plural(r.qualityErrors, 'error')}, ${plural(r.qualityWarnings, 'warning')}`
      : '';
    const state: SetupCheckItem['state'] = r.qualityErrors > 0 ? 'missing' : r.qualityWarnings > 0 ? 'warn' : 'ok';
    return { label: `Catalogue ${r.provider}`, state, detail: `${r.origin}, updated ${r.lastUpdated ?? 'unknown'}${q}` };
  });
}

/** Check of the Targets step. */
export function checkLzTargetItems(workspaceRoot: string, src: LzCatalogSources & { loadRegions?: LzRegionLoader } = {}): SetupCheckItem[] {
  const providers = listLzCatalogueRows(workspaceRoot, { ...src, quality: () => new Map() }).map((r) => r.provider);
  const targets = checkLzTargets(workspaceRoot, providers, src.loadRegions);
  if (targets.length === 0) return [{ label: 'LZ targets', state: 'missing', detail: 'no provider and region chosen' }];
  const invalid = targets.filter((t) => !t.valid);
  if (invalid.length > 0) {
    return [{ label: 'LZ targets', state: 'warn', detail: `${plural(invalid.length, 'target')} not found: ${invalid.map((t) => `${t.label} (${t.problem})`).join(', ')}` }];
  }
  return [{ label: 'LZ targets', state: 'ok', detail: targets.map((t) => t.label).join(', ') }];
}

/** Check of the Refresh step: catalogues older than the freshness threshold. */
export function checkLzFreshness(workspaceRoot: string, src: LzCatalogSources = {}): SetupCheckItem[] {
  const maxAgeDays = src.maxAgeDays ?? LZ_CATALOGUE_MAX_AGE_DAYS;
  const rows = listLzCatalogueRows(workspaceRoot, { ...src, quality: () => new Map() }).filter((r) => !r.error);
  if (rows.length === 0) return [];
  const stale = rows.filter((r) => r.stale);
  if (stale.length === 0) return [{ label: 'Catalogue age', state: 'ok', detail: `all within ${maxAgeDays} days` }];
  return [{
    label: 'Catalogue age',
    state: 'warn',
    detail: `older than ${maxAgeDays} days: ${stale.map((r) => (r.ageDays !== undefined ? `${r.provider} (${r.ageDays} days)` : `${r.provider} (no date)`)).join(', ')}`,
  }];
}
