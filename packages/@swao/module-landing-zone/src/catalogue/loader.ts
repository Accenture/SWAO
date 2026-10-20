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

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { basename, join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { LzCatalogueMetaSchema, parseLzCatalogue, safeParseLzCatalogue, safeParseVmPriceTable, type LzServiceCatalogue } from '@swao/core';
import {
  checkLzCatalogueDir,
  isLzProviderCatalogueFile,
  scanLzCatalogueFiles,
  type LzCatalogueFileRef,
  type LzCatalogueQualityOptions,
  type LzCatalogueQualityReport,
} from './quality.js';
import { LZ_SOVEREIGNTY_PINS } from './sovereignty-pins.js';
import { LZ_GEOGRAPHY_COUNTRIES } from './geographies.js';

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
 * The first candidate holding at least one provider catalogue file wins
 * (#3298, Design 110 E-24: the marker is the catalogues themselves, not an
 * index.json; a top-level index.json left in an older workspace is ignored).
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

/**
 * #3298: a directory is an LZ catalogue directory when it holds at least one
 * provider catalogue: a `<provider>.json` file (support files such as
 * `_lz-catalogue-template.json`, `aws-service-meta.json` and a legacy
 * `index.json` do not count) or a `<provider>/index.json` per-provider copy
 * (`swao lz catalogue copy/new`). Name-based; the files are not parsed here.
 */
export function isLzCataloguesDir(dir: string): boolean {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && isLzProviderCatalogueFile(entry.name)) return true;
      if (entry.isDirectory() && existsSync(join(dir, entry.name, 'index.json'))) return true;
    }
  } catch { /* missing or unreadable */ }
  return false;
}

export function resolveLzCataloguesDir(override?: string, workspaceRoot?: string): string | null {
  for (const dir of candidateDirs(override, workspaceRoot)) {
    if (isLzCataloguesDir(dir)) return dir;
  }
  return null;
}

/**
 * Resolve the bundled LZ catalogues directory without considering workspace
 * overrides. Used by #1669 to merge new providers from a binary update into
 * the runtime provider list, and by every caller that means "the shipped
 * catalogues" (copy, refresh, TUI provider lists, coming-soon list).
 */
export function resolveBundledLzCataloguesDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '_lz-catalogues'),              // pkg binary: dist/_lz-catalogues/
    resolve(here, '../../../../../lz-catalogues'), // dev source tree
    resolve(process.cwd(), 'swao/lz-catalogues'),  // repo root cwd (dev)
  ];
  for (const dir of candidates) {
    if (isLzCataloguesDir(dir)) return dir;
  }
  return null;
}

// ---------------------------------------------------------------------------
// #3298 (Design 110 E-24): the catalogue list is built from the catalogue
// files themselves. Every listed field comes from the file's own `meta` block,
// read with the core `LzCatalogueMetaSchema`. There is no index.json; a
// top-level index.json left in an older workspace is never read.
// ---------------------------------------------------------------------------

/**
 * The one home of the providers announced but not yet catalogued
 * (`swao lz catalogue list` prints them as "coming soon"; the support bundle
 * records them). `_`-prefixed, so it is never read as a provider catalogue.
 */
export const LZ_COMING_SOON_FILE = '_coming-soon.json';

// The discovery itself lives in quality.ts (import-free, so the audit gate runs it too).
export { scanLzCatalogueFiles };
export type { LzCatalogueFileRef };

/** A catalogue as listed: every field is read from the file's `meta` block. */
export interface LzCatalogueEntry extends LzCatalogueFileRef {
  name: string;
  /** Display label: `meta.name` without the trailing "service catalogue". */
  short_description: string;
  last_updated: string;
  /** The catalogue's `meta.source.mode`. */
  source: string;
  confidence: string;
  /** `meta.regions_count`, or the number of regions when the file omits it. */
  regions_count: number;
}

/** A catalogue file whose JSON or `meta` block could not be read; reported, never hidden. */
export interface LzCatalogueEntryError extends LzCatalogueFileRef {
  error: string;
}

export function isLzCatalogueEntryError(e: LzCatalogueEntry | LzCatalogueEntryError): e is LzCatalogueEntryError {
  return 'error' in e;
}

const CATALOGUE_SUFFIX = 'service catalogue';

/** Display label for a catalogue name ("Delos Cloud service catalogue" -> "Delos Cloud"). */
export function lzCatalogueShortName(name: string): string {
  // Same result as `name.replace(/\s+service catalogue\s*$/i, '').trim()`,
  // written with trimEnd and a suffix compare because that regex backtracks
  // polynomially on long whitespace runs (CodeQL js/polynomial-redos). Only
  // the suffix slice is lower-cased, so string offsets stay valid.
  const trimmed = name.trimEnd();
  const at = trimmed.length - CATALOGUE_SUFFIX.length;
  const hasSuffix = at > 0
    && trimmed.slice(at).toLowerCase() === CATALOGUE_SUFFIX
    && /\s/.test(trimmed[at - 1] as string);
  const short = (hasSuffix ? trimmed.slice(0, at) : name).trim();
  return short.length > 0 ? short : name;
}

// The large provider catalogues are 1 to 2 MB and the TUI builds several lists
// at start-up, so the parsed meta is memoised per file (path, size, mtime).
const entryCache = new Map<string, { size: number; mtimeMs: number; entry: LzCatalogueEntry | LzCatalogueEntryError }>();

/** Read one catalogue file's `meta` block with the core schema. */
export function readLzCatalogueEntry(ref: LzCatalogueFileRef): LzCatalogueEntry | LzCatalogueEntryError {
  let stamp: { size: number; mtimeMs: number } | undefined;
  try { const st = statSync(ref.path); stamp = { size: st.size, mtimeMs: st.mtimeMs }; } catch { /* reported below */ }
  const cached = entryCache.get(ref.path);
  if (stamp && cached && cached.size === stamp.size && cached.mtimeMs === stamp.mtimeMs) return { ...cached.entry, ...ref };
  let entry: LzCatalogueEntry | LzCatalogueEntryError;
  try {
    const raw = JSON.parse(readFileSync(ref.path, 'utf-8')) as { meta?: unknown; regions?: unknown } | null;
    const parsed = LzCatalogueMetaSchema.safeParse(raw?.meta);
    if (!parsed.success) {
      entry = { ...ref, error: `meta block: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
    } else {
      const meta = parsed.data;
      entry = {
        ...ref,
        name: meta.name,
        short_description: lzCatalogueShortName(meta.name),
        last_updated: meta.last_updated,
        source: meta.source.mode,
        confidence: meta.confidence,
        regions_count: meta.regions_count ?? (Array.isArray(raw?.regions) ? raw.regions.length : 0),
      };
    }
  } catch (e) {
    entry = { ...ref, error: e instanceof Error ? e.message : String(e) };
  }
  if (stamp) entryCache.set(ref.path, { ...stamp, entry });
  return entry;
}

/**
 * #3298: the catalogues in one directory, built from each file's `meta`.
 * Files whose meta cannot be read are left out here (the quality rules and
 * the health-check probe report them); `scanLzCatalogueFiles` +
 * `readLzCatalogueEntry` show them.
 */
export function discoverLzCatalogues(dir: string): LzCatalogueEntry[] {
  return scanLzCatalogueFiles(dir)
    .map(readLzCatalogueEntry)
    .filter((e): e is LzCatalogueEntry => !isLzCatalogueEntryError(e));
}

/**
 * Providers announced as coming soon, from `_coming-soon.json` in the bundled
 * catalogue directory (or `dir`). A provider that has a catalogue file there
 * is no longer coming soon and is dropped. Missing or unreadable file: empty.
 */
export function loadLzComingSoon(dir: string | null = resolveBundledLzCataloguesDir()): string[] {
  if (!dir) return [];
  try {
    const raw = JSON.parse(readFileSync(join(dir, LZ_COMING_SOON_FILE), 'utf-8')) as { coming_soon?: unknown } | null;
    if (!raw || !Array.isArray(raw.coming_soon)) return [];
    const catalogued = new Set(scanLzCatalogueFiles(dir).map((r) => r.provider));
    return raw.coming_soon.filter((p): p is string => typeof p === 'string' && p.trim() !== '' && !catalogued.has(p));
  } catch { return []; }
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
 * #3282: run the LZ catalogue quality rules over a catalogue directory with
 * the real catalogue schema (`safeParseLzCatalogue`) and the refresh overlay
 * pins injected. Used by the health-check LZ catalogue probe; the audit gate
 * calls `checkLzCatalogueDir` from quality.ts directly.
 */
export function checkLzCatalogueQuality(
  dir: string,
  opts: Omit<LzCatalogueQualityOptions, 'validate' | 'pins'> = {},
): LzCatalogueQualityReport {
  return checkLzCatalogueDir(dir, {
    ...opts,
    validate: (raw) => { const r = safeParseLzCatalogue(raw); return r.ok ? [] : r.issues; },
    pins: LZ_SOVEREIGNTY_PINS,
    geographies: LZ_GEOGRAPHY_COUNTRIES, // #3281 shared geography model
    validatePriceTable: (raw) => { const r = safeParseVmPriceTable(raw); return r.ok ? [] : r.issues; }, // #3288
  });
}

/**
 * Every provider id `resolveProviderCatalogue` can resolve for a workspace
 * (#3155, #3298): the union of the shared discovery (`scanLzCatalogueFiles`)
 * over the bundled catalogues and every workspace layout the resolver reads
 * (`<dir>/<provider>/index.json`, `<dir>/<provider>.json`, legacy
 * `<ws>/lz-catalogues/<provider>.json`). File-name based, so a copy whose
 * content is invalid is still listed and reported by the resolver. Sorted;
 * unreadable directories are skipped.
 */
export function listLzCatalogueProviders(workspaceRoot?: string, override?: string): string[] {
  const providers = new Set<string>();
  const bundled = resolveBundledLzCataloguesDir();
  const layered = [
    bundled ?? undefined,
    override,
    workspaceRoot ? join(workspaceRoot, 'wsp', 'inputs', 'catalogs', 'lz-catalogues') : undefined,
  ].filter((d): d is string => !!d);
  for (const dir of layered) for (const ref of scanLzCatalogueFiles(dir)) providers.add(ref.provider);
  // The legacy folder is read flat only (resolver step 5).
  const legacy = workspaceRoot ? join(workspaceRoot, 'lz-catalogues') : undefined;
  if (legacy) for (const ref of scanLzCatalogueFiles(legacy, { flat: true })) providers.add(ref.provider);
  return [...providers].sort();
}

/**
 * Candidate files for one provider in resolution order, split into the
 * workspace layers (validated strictly, no fallback) and the bundled layers.
 * Shared by `resolveProviderCatalogue` and `listLzCatalogues` so the listed
 * meta always comes from the file the fit loads.
 */
function providerCandidatePaths(provider: string, workspaceRoot?: string, override?: string): { workspace: string[]; bundled: string[] } {
  const here = dirname(fileURLToPath(import.meta.url));
  const workspace: string[] = [];
  if (override) {
    workspace.push(
      join(override, provider, 'index.json'),
      join(override, `${provider}.json`),
    );
  }
  if (workspaceRoot) {
    workspace.push(
      join(workspaceRoot, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', provider, 'index.json'),
      join(workspaceRoot, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', `${provider}.json`),
      join(workspaceRoot, 'lz-catalogues', `${provider}.json`),
    );
  }
  const bundled = [
    resolve(here, '_lz-catalogues', `${provider}.json`),
    resolve(here, '../../../../../lz-catalogues', `${provider}.json`),
    resolve(process.cwd(), 'wsp', 'inputs', 'catalogs', 'lz-catalogues', `${provider}.json`),
    resolve(process.cwd(), 'lz-catalogues', `${provider}.json`),
    resolve(process.cwd(), 'swao', 'lz-catalogues', `${provider}.json`),
  ];
  return { workspace, bundled };
}

/** One row of the layered catalogue list (`listLzCatalogues`). */
export type LzCatalogueListing = (LzCatalogueEntry | LzCatalogueEntryError) & { provenance: LzCatalogueProvenance };

/**
 * #3298: the catalogue list for a workspace, one row per provider of
 * `listLzCatalogueProviders`, each built from the `meta` block of the file
 * `resolveProviderCatalogue` would load (workspace layers first, then the
 * bundle). A file whose meta cannot be read is a row with `error`. Used by
 * `swao lz catalogue list` and the TUI catalogue screens.
 */
export function listLzCatalogues(workspaceRoot?: string, override?: string): LzCatalogueListing[] {
  const rows: LzCatalogueListing[] = [];
  for (const provider of listLzCatalogueProviders(workspaceRoot, override)) {
    const { workspace, bundled } = providerCandidatePaths(provider, workspaceRoot, override);
    const ws = workspace.find((p) => existsSync(p));
    const path = ws ?? bundled.find((p) => existsSync(p));
    if (!path) continue;
    const file = basename(path) === 'index.json' ? `${provider}/index.json` : `${provider}.json`;
    rows.push({ ...readLzCatalogueEntry({ provider, file, path }), provenance: ws ? 'workspace' : 'bundled' });
  }
  return rows;
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
  const { workspace: workspacePaths, bundled: bundledPaths } = providerCandidatePaths(provider, workspaceRoot, override);

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
