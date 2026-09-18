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

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseLzCatalogue, safeParseLzCatalogue, type LzServiceCatalogue } from '@swao/core';

/**
 * Resolve + load the bundled/refreshed LZ catalogues (Design 056 Layer A).
 * Multi-candidate resolution (robust to dev, bundled binary, and a workspace
 * that refreshed its own catalogues -- the #0592 path-fragility lesson):
 *   1. explicit override
 *   2. <workspaceRoot>/lz-catalogues   (consultant/enterprise workspace override)
 *   3. <bundle dir>/_lz-catalogues     (pkg binary: build-lib.mjs copies here)
 *   4. <package>/../../../../../lz-catalogues  (repo dev path)
 *   5. <cwd>/lz-catalogues             (workspace-local refresh)
 *   6. <cwd>/swao/lz-catalogues        (repo root cwd)
 * The first candidate containing an index.json wins.
 * Community tier callers omit workspaceRoot so the bundled catalogue is used.
 */
function candidateDirs(override?: string, workspaceRoot?: string): string[] {
  const here = dirname(fileURLToPath(import.meta.url)); // bundle.cjs dir in binary; src|dist/catalogue in dev
  return [
    override,
    // wsp/inputs/catalogs/lz-catalogues/ -- preferred path (alongside community frameworks)
    workspaceRoot ? join(workspaceRoot, 'wsp', 'inputs', 'catalogs', 'lz-catalogues') : undefined,
    // lz-catalogues/ -- old path, kept for backward compat with workspaces refreshed before #0905
    workspaceRoot ? join(workspaceRoot, 'lz-catalogues') : undefined,
    resolve(here, '_lz-catalogues'),              // pkg binary: dist/_lz-catalogues/
    resolve(here, '../../../../../lz-catalogues'), // dev source tree
    resolve(process.cwd(), 'wsp', 'inputs', 'catalogs', 'lz-catalogues'),
    resolve(process.cwd(), 'lz-catalogues'),
    resolve(process.cwd(), 'swao/lz-catalogues'),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
}

export function resolveLzCataloguesDir(override?: string, workspaceRoot?: string): string | null {
  for (const dir of candidateDirs(override, workspaceRoot)) {
    if (existsSync(join(dir, 'index.json'))) return dir;
  }
  return null;
}

/**
 * Resolve the bundled LZ catalogues directory without considering workspace
 * overrides. Used by #1669 to merge new providers from a binary update into
 * the runtime provider list even when the workspace index.json predates the update.
 */
export function resolveBundledLzCataloguesDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '_lz-catalogues'),              // pkg binary: dist/_lz-catalogues/
    resolve(here, '../../../../../lz-catalogues'), // dev source tree
    resolve(process.cwd(), 'swao/lz-catalogues'),  // repo root cwd (dev)
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.json'))) return dir;
  }
  return null;
}

export interface LzCatalogueIndexEntry {
  provider: string;
  file: string;
  name: string;
  short_description?: string;
  last_updated: string;
  source: string;
  confidence: string;
}

export function loadLzCatalogueIndex(dir: string): { catalogues: LzCatalogueIndexEntry[]; coming_soon: string[] } {
  const raw = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf-8')) as Record<string, unknown>;
  return {
    catalogues: (raw['catalogues'] as LzCatalogueIndexEntry[]) ?? [],
    coming_soon: (raw['coming_soon'] as string[]) ?? [],
  };
}

/** Load + validate a provider catalogue from a resolved dir. Throws on invalid. */
export function loadLzCatalogue(dir: string, provider: string): LzServiceCatalogue {
  const direct = join(dir, `${provider}.json`);
  const file = existsSync(direct)
    ? direct
    : join(dir, readdirSync(dir).find((f) => f === `${provider}.json`) ?? `${provider}.json`);
  return parseLzCatalogue(JSON.parse(readFileSync(file, 'utf-8')));
}

// ---------------------------------------------------------------------------
// Per-ID layer merge (#1437): resolve a single provider from the highest
// available layer (workspace canonical > workspace legacy > bundled).
// Each provider resolves independently so a workspace override for "aws"
// does not shadow "azure" or any other provider.
// ---------------------------------------------------------------------------

/** Provenance tier for a resolved LZ catalogue entry. */
export type LzCatalogueProvenance = 'workspace' | 'installed' | 'bundled';

/** Thrown when a workspace-local catalogue file exists but fails JSON parsing
 *  or strict schema validation. No silent fallback to bundled. */
export class LzCatalogueSchemaError extends Error {
  constructor(provider: string, filePath: string, cause: string) {
    super(`LZ catalogue for "${provider}" at "${filePath}" failed validation: ${cause}`);
    this.name = 'LzCatalogueSchemaError';
  }
}

/** Thrown when a loaded catalogue contains two regions with the same id. */
export class LzCatalogueDuplicateIdError extends Error {
  constructor(provider: string, regionId: string) {
    super(`LZ catalogue for "${provider}" has duplicate region ID: "${regionId}"`);
    this.name = 'LzCatalogueDuplicateIdError';
  }
}

function assertNoDuplicateRegionIds(provider: string, catalogue: LzServiceCatalogue): void {
  const seen = new Set<string>();
  for (const region of catalogue.regions) {
    if (seen.has(region.id)) throw new LzCatalogueDuplicateIdError(provider, region.id);
    seen.add(region.id);
  }
}

/**
 * Resolve and load one provider's catalogue from the highest available layer.
 *
 * Resolution order (first match wins):
 *   1. `<override>/<provider>/index.json` -- override per-provider subdir
 *   2. `<override>/<provider>.json` -- override flat file
 *   3. `<workspaceRoot>/wsp/inputs/catalogs/lz-catalogues/<provider>/index.json` -- workspace canonical
 *   4. `<workspaceRoot>/wsp/inputs/catalogs/lz-catalogues/<provider>.json` -- workspace legacy flat
 *   5. `<workspaceRoot>/lz-catalogues/<provider>.json` -- workspace old path
 *   6. Bundled catalogue paths (pkg binary + dev tree)
 *
 * Workspace files (1-5): if the file exists but fails validation, throws
 * `LzCatalogueSchemaError`. No silent fallback.
 * Bundled files (6): loaded with `parseLzCatalogue`; throws on invalid.
 * Any catalogue with duplicate region IDs throws `LzCatalogueDuplicateIdError`.
 */
export function resolveProviderCatalogue(
  provider: string,
  workspaceRoot?: string,
  override?: string,
): { catalogue: LzServiceCatalogue; provenance: LzCatalogueProvenance; filePath: string } {
  const here = dirname(fileURLToPath(import.meta.url));

  const workspacePaths: string[] = [];
  if (override) {
    workspacePaths.push(
      join(override, provider, 'index.json'),
      join(override, `${provider}.json`),
    );
  }
  if (workspaceRoot) {
    workspacePaths.push(
      join(workspaceRoot, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', provider, 'index.json'),
      join(workspaceRoot, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', `${provider}.json`),
      join(workspaceRoot, 'lz-catalogues', `${provider}.json`),
    );
  }

  for (const filePath of workspacePaths) {
    if (!existsSync(filePath)) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch (e) {
      throw new LzCatalogueSchemaError(provider, filePath, e instanceof Error ? e.message : String(e));
    }
    const result = safeParseLzCatalogue(raw);
    if (!result.ok) {
      throw new LzCatalogueSchemaError(provider, filePath, result.issues.join('; '));
    }
    assertNoDuplicateRegionIds(provider, result.catalogue);
    return { catalogue: result.catalogue, provenance: 'workspace', filePath };
  }

  // No workspace file found -- fall through to bundled.
  const bundledPaths = [
    resolve(here, '_lz-catalogues', `${provider}.json`),
    resolve(here, '../../../../../lz-catalogues', `${provider}.json`),
    resolve(process.cwd(), 'wsp', 'inputs', 'catalogs', 'lz-catalogues', `${provider}.json`),
    resolve(process.cwd(), 'lz-catalogues', `${provider}.json`),
    resolve(process.cwd(), 'swao', 'lz-catalogues', `${provider}.json`),
  ];

  for (const filePath of bundledPaths) {
    if (!existsSync(filePath)) continue;
    const catalogue = parseLzCatalogue(JSON.parse(readFileSync(filePath, 'utf-8')));
    assertNoDuplicateRegionIds(provider, catalogue);
    return { catalogue, provenance: 'bundled', filePath };
  }

  throw new Error(
    `No catalogue found for provider "${provider}". ` +
    `Run \`swao lz catalogue list\` to see available providers.`,
  );
}
