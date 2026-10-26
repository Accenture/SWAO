// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3431: which sovereign providers in the landing-zone catalogues
// (swao/lz-catalogues/*.json, Design 056 Layer A) offer a capability. Input of
// the service-availability component of the deterministic portability score.
//
// A region is sovereign when its sovereignty facts carry none of the forbidden
// exposures and its operator jurisdiction is accepted (both lists come from
// migration-scores-catalogue.yaml, never provider names in code). Capability
// matching is core regionFulfills, the same as the landing-zone fit, so
// `@version` and `+capability` qualifiers behave identically.
//
// Resolution mirrors module-landing-zone/src/catalogue/loader.ts per provider:
// workspace wsp/inputs/catalogs/lz-catalogues (or the legacy lz-catalogues/)
// wins over the bundled catalogue of the same provider. The listings here are
// catalogue folders, not the assessed source tree (this file is outside
// src/passes/, see the source-scope-single-walker gate).

import { existsSync, readFileSync, readdirSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { safeParseLzCatalogue, regionFulfills, type LzRegion } from '@swao/core';

export interface SovereignRegionRule {
  forbid_exposure: string[];
  require_operator_jurisdiction: string[];
}

export interface SovereignAvailability {
  /** Where the catalogues came from: bundled, workspace, or both (per-provider override). */
  source: 'bundled' | 'workspace' | 'mixed';
  /** Every provider catalogue that was read, sorted. */
  providers_checked: string[];
  /** Providers with at least one sovereign region, sorted. */
  sovereign_providers: string[];
  /** Catalogue files that could not be read (provider: reason). */
  errors: string[];
  /** Sovereign regions per provider (not serialised). */
  regions: Map<string, LzRegion[]>;
}

const SUPPORT_FILES = new Set(['aws-service-meta.json', 'index.json']);

function isProviderFile(name: string): boolean {
  return name.endsWith('.json') && !name.startsWith('_') && !SUPPORT_FILES.has(name);
}

/** Provider id -> catalogue file in one directory (`<p>.json` or `<p>/index.json`). */
function listProviderFiles(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  let entries: Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isFile() && isProviderFile(e.name)) out.set(e.name.slice(0, -'.json'.length), join(dir, e.name));
    else if (e.isDirectory() && existsSync(join(dir, e.name, 'index.json'))) out.set(e.name, join(dir, e.name, 'index.json'));
  }
  return out;
}

/** The bundled catalogue directory (binary dist/_lz-catalogues, or the repo swao/lz-catalogues). */
export function resolveBundledLzDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '_lz-catalogues'),
    resolve(here, '../../../../../lz-catalogues'),
    resolve(here, '../../../../lz-catalogues'),
    resolve(here, '../../../lz-catalogues'),
  ];
  return candidates.find((c) => listProviderFiles(c).size > 0) ?? null;
}

/**
 * Workspace catalogue directories for an app directory (`<root>/apps/<id>`)
 * or a workspace root. Canonical before legacy.
 */
export function workspaceLzDirs(workspaceAppDir: string): string[] {
  const parent = dirname(workspaceAppDir);
  const roots = basename(parent) === 'apps' ? [workspaceAppDir, dirname(parent)] : [workspaceAppDir];
  const dirs: string[] = [];
  for (const root of roots) {
    dirs.push(join(root, 'wsp', 'inputs', 'catalogs', 'lz-catalogues'), join(root, 'lz-catalogues'));
  }
  return dirs;
}

export function isSovereignRegion(region: LzRegion, rule: SovereignRegionRule): boolean {
  const facts = region.sovereignty;
  if (!facts) return false;
  if ((facts.extraterritorial_exposure ?? []).some((x) => rule.forbid_exposure.includes(x))) return false;
  return facts.operator_jurisdiction !== undefined && rule.require_operator_jurisdiction.includes(facts.operator_jurisdiction);
}

export interface LoadSovereignAvailabilityOptions {
  workspaceAppDir?: string;
  /** Test hook: use exactly these directories (first wins per provider). */
  dirs?: string[];
}

export function loadSovereignAvailability(
  rule: SovereignRegionRule,
  opts: LoadSovereignAvailabilityOptions = {},
): SovereignAvailability | null {
  const bundled = opts.dirs ? null : resolveBundledLzDir();
  const layers: Array<{ dir: string; kind: 'workspace' | 'bundled' }> = opts.dirs
    ? opts.dirs.map((dir) => ({ dir, kind: 'bundled' as const }))
    : [
        ...(opts.workspaceAppDir ? workspaceLzDirs(opts.workspaceAppDir).map((dir) => ({ dir, kind: 'workspace' as const })) : []),
        ...(bundled ? [{ dir: bundled, kind: 'bundled' as const }] : []),
      ];
  const chosen = new Map<string, { file: string; kind: 'workspace' | 'bundled' }>();
  for (const layer of layers) {
    for (const [provider, file] of listProviderFiles(layer.dir)) {
      if (!chosen.has(provider)) chosen.set(provider, { file, kind: layer.kind });
    }
  }
  if (chosen.size === 0) return null;

  const providers = [...chosen.keys()].sort();
  const regions = new Map<string, LzRegion[]>();
  const errors: string[] = [];
  const kinds = new Set<string>();
  for (const provider of providers) {
    const { file, kind } = chosen.get(provider)!;
    kinds.add(kind);
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(file, 'utf-8')); } catch (err) {
      errors.push(`${provider}: unreadable (${(err as Error).message.split('\n')[0]})`);
      continue;
    }
    const parsed = safeParseLzCatalogue(raw);
    if (!parsed.ok) { errors.push(`${provider}: invalid (${parsed.issues[0] ?? 'schema mismatch'})`); continue; }
    const sovereign = parsed.catalogue.regions.filter((r) => isSovereignRegion(r, rule));
    if (sovereign.length > 0) regions.set(provider, sovereign);
  }
  return {
    source: kinds.size > 1 ? 'mixed' : kinds.has('workspace') ? 'workspace' : 'bundled',
    providers_checked: providers,
    sovereign_providers: [...regions.keys()].sort(),
    errors,
    regions,
  };
}

/** Sovereign providers (sorted) with a region that fulfils the capability. */
export function sovereignProvidersFor(availability: Pick<SovereignAvailability, 'regions'>, capability: string): string[] {
  const out: string[] = [];
  for (const [provider, regions] of availability.regions) {
    if (regions.some((r) => regionFulfills(r, capability))) out.push(provider);
  }
  return out.sort();
}
