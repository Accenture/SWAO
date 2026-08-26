// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import {
  RegimeIndexSchema,
  RegimeCatalogueSchema,
  REGIME_ID_REGEX,
  type RegimeIndex,
  type RegimeIndexEntry,
  type Scope,
} from './regime-catalogue.js';

const LEGACY_ALIASES: Record<string, string> = {
  DiGA: 'DiGA',
};

export interface ResolvedRegime {
  scope: Scope;
  entry: RegimeIndexEntry;
  catalogueFile: string;
}

export interface RegimeRegistry {
  byId: Map<string, ResolvedRegime>;
  collisions: string[];
}

function loadIndex(catalogsDir: string, scope: Scope): { dir: string; index: RegimeIndex } | null {
  const dir = join(catalogsDir, scope);
  const indexPath = join(dir, 'index.yaml');
  if (!existsSync(indexPath)) return null;
  const raw = load(readFileSync(indexPath, 'utf-8'));
  const parsed = RegimeIndexSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `[regime-registry] ${indexPath} failed schema validation:\n` +
        JSON.stringify(parsed.error.issues, null, 2),
    );
  }
  if (parsed.data.scope !== scope) {
    throw new Error(
      `[regime-registry] ${indexPath} declares scope="${parsed.data.scope}" but lives under ${scope}/`,
    );
  }
  return { dir, index: parsed.data };
}

// Community scope (design 029 §11) discovery. Two shapes coexist:
//
//   1. Legacy single-file shape: `<community>/<id>-controls.yaml` listed in
//      `<community>/index.yaml`. Inherited from the sprint-034 overlay
//      design; still supported for synthetic test fixtures and engagement-
//      authored single-file overlays.
//   2. Folder-per-framework shape (canonical per design 029 §11):
//      `<community>/<id>/{framework-meta.yaml, controls.yaml, evidence/}`.
//      Used by bundled community frameworks (swao init mirror) and by any
//      engagement-authored catalogue that carries its own evidence files.
//
// The loader merges both: every entry from `index.yaml` (if present) plus
// every subfolder that contains a `controls.yaml`. De-dup by id; an
// `index.yaml` entry whose `file:` happens to point at `<id>/controls.yaml`
// is the same regime as the folder-enumeration entry for `<id>/`.
function loadCommunityIndex(catalogsDir: string): { dir: string; index: RegimeIndex } | null {
  const dir = join(catalogsDir, 'community');
  if (!existsSync(dir)) return null;
  const seen = new Set<string>();
  const regimes: RegimeIndexEntry[] = [];

  const fromIndex = loadIndex(catalogsDir, 'community');
  if (fromIndex) {
    for (const entry of fromIndex.index.regimes) {
      seen.add(entry.id);
      regimes.push(entry);
    }
  }

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const controlsPath = join(dir, entry.name, 'controls.yaml');
    if (!existsSync(controlsPath)) continue;
    type CommunityCatalogue = {
      regime_meta?: { id?: string; name?: string; version?: string; applicability_hints?: string[] };
      controls?: unknown[];
    };
    let raw: CommunityCatalogue | null = null;
    try {
      raw = load(readFileSync(controlsPath, 'utf-8')) as CommunityCatalogue | null;
    } catch { /* skip unparseable */ }
    const meta = raw?.regime_meta;
    if (!meta?.id || !meta?.name || !meta?.version) continue;
    if (seen.has(meta.id)) continue;
    seen.add(meta.id);
    const controlsCount = Array.isArray(raw?.controls) ? Math.max(raw.controls.length, 1) : 1;
    regimes.push({
      id: meta.id,
      name: meta.name,
      version: meta.version,
      file: `${entry.name}/controls.yaml`,
      controls_count: controlsCount,
      applicability_hints: meta.applicability_hints ?? [],
    });
  }

  return { dir, index: { schema_version: '1', scope: 'community', regimes } };
}

// Read the `replaces:` declarations from a community catalogue. Accepts both
// the bare string form (`replaces: [GDPR]`) and the rich object form
// (`replaces: [{regime_id: GDPR, location: ..., note: ...}]`) per design 029
// §11. Reads from two possible locations:
//   1. <folder>/framework-meta.yaml under `framework.replaces:` (canonical
//      per design 029 §11; the operator authors this).
//   2. controls.yaml under `regime_meta.replaces:` (legacy / synthetic
//      test-fixture location).
// Returns the union of standard regime IDs the catalogue supersedes.
function readReplaces(catalogueFile: string): Set<string> {
  const out = new Set<string>();
  const collectFrom = (replaces: unknown) => {
    if (!Array.isArray(replaces)) return;
    for (const r of replaces) {
      if (typeof r === 'string') out.add(r);
      else if (r && typeof r === 'object' && typeof (r as { regime_id?: unknown }).regime_id === 'string') {
        out.add((r as { regime_id: string }).regime_id);
      }
    }
  };

  // controls.yaml legacy / synthetic-fixture path
  if (existsSync(catalogueFile)) {
    try {
      const raw = load(readFileSync(catalogueFile, 'utf-8')) as {
        regime_meta?: { replaces?: unknown };
      } | null;
      collectFrom(raw?.regime_meta?.replaces);
    } catch { /* fall through */ }
  }

  // framework-meta.yaml canonical path (design 029 §11)
  const frameworkMetaFile = catalogueFile.replace(/controls\.ya?ml$/, 'framework-meta.yaml');
  if (frameworkMetaFile !== catalogueFile && existsSync(frameworkMetaFile)) {
    try {
      const raw = load(readFileSync(frameworkMetaFile, 'utf-8')) as {
        framework?: { replaces?: unknown };
      } | null;
      collectFrom(raw?.framework?.replaces);
    } catch { /* fall through */ }
  }

  return out;
}

export function loadRegimeRegistry(catalogsDir: string): RegimeRegistry {
  const byId = new Map<string, ResolvedRegime>();
  const collisions: string[] = [];

  // Sprint-039 #0358 Phase 3 -- standard scope retired. Every flagship
  // regime ships as a community framework now (5 thin migrations landed
  // Phase 1; GDPR + HIPAA were community-shape earlier). The loader walks
  // community/ only.
  //
  // Cross-id `replaces:` aliasing (Phase 2): after the canonical entry is
  // registered under its own id, every id in its `replaces:` set is ALSO
  // registered as an alias pointing at the same catalogue. This lets a
  // `.swao.yml` reference to a legacy id (e.g. HIPAA) resolve to the
  // canonical community framework (e.g. NIST_SP_800_66R2 which
  // `replaces: [HIPAA]`). Last community framework wins on alias
  // collisions; canonical-id collisions are a hard error.
  const community = loadCommunityIndex(catalogsDir);
  if (community) {
    for (const entry of community.index.regimes) {
      const catalogueFile = join(community.dir, entry.file);
      const replaces = readReplaces(catalogueFile);
      if (byId.has(entry.id)) {
        throw new Error(
          `[regime-registry] duplicate canonical regime id "${entry.id}" -- ` +
            `two community frameworks claim the same id. Rename one or use ` +
            `replaces: to declare the supersession explicitly.`,
        );
      }
      byId.set(entry.id, { scope: 'community', entry, catalogueFile });
      // Cross-id alias registration. Same-id replaces (legacy GDPR
      // standard-stub supersession pattern) is a no-op now -- the standard
      // stubs are gone -- but we keep the skip to avoid a spurious info log
      // when an operator-overlay community framework still carries
      // `replaces: [<its-own-id>]`.
      for (const replacedId of replaces) {
        if (replacedId === entry.id) continue;
        if (byId.has(replacedId)) {
          // Another community framework already claimed the alias. Log so
          // the operator can audit; last-one-wins keeps the loader
          // deterministic.
          console.info(
            `[regime-registry] community/${entry.id} aliases ${replacedId} via replaces: (shadows existing entry)`,
          );
          collisions.push(replacedId);
        }
        byId.set(replacedId, { scope: 'community', entry, catalogueFile });
      }
    }
  }

  return { byId, collisions };
}

// Bundled-framework discovery (Design 080 §4.1, #1175). Equivalent to
// loadCommunityIndex + loadRegimeRegistry but scans the given root directory
// directly -- bundled frameworks live at the root, not under a `community/`
// sub-folder. Returns a RegimeRegistry with the same aliasing semantics as
// loadRegimeRegistry so callers can iterate `byId` and skip alias entries by
// checking `resolved.entry.id === id`.
export function loadBundledRegimeRegistry(bundledDir: string): RegimeRegistry {
  const byId = new Map<string, ResolvedRegime>();
  const collisions: string[] = [];

  if (!existsSync(bundledDir)) return { byId, collisions };

  const seen = new Set<string>();
  for (const dirent of readdirSync(bundledDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const controlsPath = join(bundledDir, dirent.name, 'controls.yaml');
    if (!existsSync(controlsPath)) continue;
    type PartialCatalogue = {
      regime_meta?: { id?: string; name?: string; version?: string; applicability_hints?: string[] };
      controls?: unknown[];
    };
    let raw: PartialCatalogue | null = null;
    try {
      raw = load(readFileSync(controlsPath, 'utf-8')) as PartialCatalogue | null;
    } catch { continue; }
    const meta = raw?.regime_meta;
    if (!meta?.id || !meta?.name || !meta?.version) continue;
    if (seen.has(meta.id)) continue;
    seen.add(meta.id);
    const controlsCount = Array.isArray(raw?.controls) ? Math.max(raw.controls.length, 1) : 1;
    const indexEntry: RegimeIndexEntry = {
      id: meta.id,
      name: meta.name,
      version: meta.version,
      file: `${dirent.name}/controls.yaml`,
      controls_count: controlsCount,
      applicability_hints: meta.applicability_hints ?? [],
    };
    const replaces = readReplaces(controlsPath);
    byId.set(meta.id, { scope: 'community', entry: indexEntry, catalogueFile: controlsPath });
    for (const replacedId of replaces) {
      if (replacedId === meta.id) continue;
      if (byId.has(replacedId)) collisions.push(replacedId);
      byId.set(replacedId, { scope: 'community', entry: indexEntry, catalogueFile: controlsPath });
    }
  }

  return { byId, collisions };
}

export function validateRegimeIdAgainstRegistry(
  id: string,
  registry: RegimeRegistry,
): { valid: true } | { valid: false; reason: string } {
  if (LEGACY_ALIASES[id]) {
    return { valid: true };
  }
  if (!REGIME_ID_REGEX.test(id)) {
    return {
      valid: false,
      reason: `regime id "${id}" does not match ${REGIME_ID_REGEX}`,
    };
  }
  if (!registry.byId.has(id)) {
    const known = Array.from(registry.byId.keys()).sort().join(', ') || '(empty registry)';
    return {
      valid: false,
      reason: `regime id "${id}" is not registered. Known: ${known}`,
    };
  }
  return { valid: true };
}

export function regimeFiles(catalogsDir: string, scope: Scope): string[] {
  const dir = join(catalogsDir, scope);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('-controls.yaml'));
}

export function loadRegimeCatalogue(filePath: string) {
  const raw = load(readFileSync(filePath, 'utf-8'));
  return RegimeCatalogueSchema.parse(raw);
}
