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

import { existsSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import {
  CatalogueDetectionSchema,
  MatchDefaultsSchema,
  type CatalogueDetection,
  type MatchDefaults,
} from './catalogue-matcher.js';

// #3410: the shared catalogue matcher lives in catalogue-matcher.ts; every
// pass that scans catalogue tokens imports it from there or from here.
export * from './catalogue-matcher.js';

const _dir = dirname(fileURLToPath(import.meta.url));

export interface PassCatalogEntry {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface PassCatalog {
  pass_number: number;
  pass_name: string;
  entries: PassCatalogEntry[];
  /**
   * #3410: catalogue-level default match mode / case rule for token lists.
   * The workspace file's block wins when it declares one.
   */
  match_defaults?: MatchDefaults;
}

/**
 * #3410: Zod-validated `detection` block of a token catalogue entry. Returns
 * the parsed block, or `{ error }` naming the entry so the pass can report a
 * malformed workspace override instead of silently matching nothing.
 */
export function parseCatalogueDetection(
  entry: PassCatalogEntry,
): { detection: CatalogueDetection } | { error: string } {
  const r = CatalogueDetectionSchema.safeParse(entry.detection ?? {});
  if (r.success) return { detection: r.data };
  const issue = r.error.issues[0];
  return { error: `${String(entry.id)}: detection.${(issue?.path ?? []).join('.')} ${issue?.message ?? 'invalid'}` };
}

function readMatchDefaults(raw: unknown): MatchDefaults | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = MatchDefaultsSchema.safeParse((raw as Record<string, unknown>).match_defaults);
  return r.success ? r.data : undefined;
}

// ADR-0063 §3: probe candidate paths for the bundled pass-catalogs directory.
// Mirrors resolveBundledPassCatalogsDir() in init.ts but relative to this module's dist/.
function resolveBundledPassCatalogsDir(): string | null {
  const candidates = [
    // pkg binary / CJS bundle: the loader is inlined into dist/bundle*.cjs, so
    // import.meta.url points at dist/ itself and the catalogues sit in
    // dist/_pass-catalogs (build-lib.mjs). Missing before v1.4.0 smoke on the
    // CI binaries: Pass 03/05/08/21 reported "catalogue not found".
    resolve(_dir, '_pass-catalogs'),
    // pkg binary: dist/_pass-catalogs/ (module at dist/passes/ level -- up two to dist, then _pass-catalogs)
    resolve(_dir, '../../_pass-catalogs'),
    // pkg binary alternative: dist/_pass-catalogs/ directly above passes/
    resolve(_dir, '../_pass-catalogs'),
    // dev source tree: dist/passes/ → up 5 → swao/ → pass-catalogs/
    resolve(_dir, '../../../../../pass-catalogs'),
    // repo-root cwd fallback (dev)
    resolve(process.cwd(), 'swao/pass-catalogs'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

/**
 * Loads a pass-support catalogue file by filename (e.g. 'pass-08-crypto-algorithms.yaml').
 *
 * Merge strategy (ADR-0063 §3.2):
 * 1. Load product defaults from bundled pass-catalogs/
 * 2. Load workspace overrides from wsp/inputs/pass-catalogs/
 * 3. Workspace entry wins on matching id
 *
 * Returns null when neither source is available (never throws).
 */
export function loadPassCatalog(workspacePath: string, filename: string): PassCatalog | null {
  const wsPath = join(workspacePath, 'wsp', 'inputs', 'pass-catalogs', filename);
  const bundledDir = resolveBundledPassCatalogsDir();
  const bundledPath = bundledDir ? join(bundledDir, filename) : null;

  let baseEntries: PassCatalogEntry[] = [];
  let meta: { pass_number: number; pass_name: string } | null = null;
  let matchDefaults: MatchDefaults | undefined;

  if (bundledPath && existsSync(bundledPath)) {
    try {
      const raw = load(readFileSync(bundledPath, 'utf-8')) as PassCatalog;
      if (raw && typeof raw === 'object') {
        meta = { pass_number: Number(raw.pass_number), pass_name: String(raw.pass_name) };
        matchDefaults = readMatchDefaults(raw);
        baseEntries = Array.isArray(raw.entries) ? (raw.entries as PassCatalogEntry[]) : [];
      }
    } catch { /* skip malformed bundled file */ }
  }

  if (existsSync(wsPath)) {
    try {
      const raw = load(readFileSync(wsPath, 'utf-8')) as PassCatalog;
      if (raw && typeof raw === 'object') {
        if (!meta) meta = { pass_number: Number(raw.pass_number), pass_name: String(raw.pass_name) };
        matchDefaults = readMatchDefaults(raw) ?? matchDefaults;
        const overrides = Array.isArray(raw.entries) ? (raw.entries as PassCatalogEntry[]) : [];
        const overrideIds = new Set(overrides.map((e) => String(e.id)));
        baseEntries = [...baseEntries.filter((e) => !overrideIds.has(String(e.id))), ...overrides];
      }
    } catch { /* skip malformed workspace file */ }
  }

  if (!meta) return null;
  return { ...meta, entries: baseEntries, ...(matchDefaults ? { match_defaults: matchDefaults } : {}) };
}
