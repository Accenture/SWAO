// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * SWAO-INFRA-CAT loader and classifier (Design 103 §17.2, §17.3, §17.6, #3079).
 *
 * Tier 1: built-in catalogue under `swao/controls/infra-catalogue/`. Every
 * `*.yaml` there (files starting with `_` or `.` skipped) declares its own
 * metadata (`id`, `name`, `load_order`, #3299); files load in ascending
 * `load_order` (ties by file name) and a later file wins on a duplicate service
 * id. A file with missing or invalid metadata is skipped with a warning. Tier 2: every `*.yaml` under the workspace folder
 * `wsp/inputs/catalogs/infra-cat/`, loaded after Tier 1; a Tier 2 service with
 * the same `id` replaces the Tier 1 entry. Tier 2 files may also declare a
 * `sites:` prefix-to-site map (guardrail G-01: site mapping is configuration).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { z } from 'zod';
import { InfraCategorySchema, SOVEREIGN_RATINGS, SovereignAlternativeSchema } from '../schema/service-app.schema.js';

export const InfraCatServiceSchema = z.object({
  id: z.string().regex(/^INFRA_[A-Z0-9_]+$/),
  name: z.string(),
  short: z.string().optional(),
  sovereign_rating: z.enum(SOVEREIGN_RATINGS).optional(),
  data_health_implied: z.boolean().optional(),
  regulatory: z.array(z.string()).optional(),
  id_prefix_hints: z.array(z.string().min(1)).optional(),
  vendor_patterns: z.array(z.string().min(1)).optional(),
  /** Normalised vendor for consolidation grouping (Design 103 §21.5); defaults to the matched pattern. */
  vendor_canonical_name: z.string().min(1).optional(),
  product_name_patterns: z.array(z.string().min(1)).optional(),
  os_string_patterns: z.array(z.string().min(1)).optional(),
  cluster_hint: z.boolean().optional(),
  cluster_by: z.enum(['id_prefix']).optional(),
  eol_product_ids: z.array(z.string().min(1)).optional(),
  /** Open-source package for OSV.dev lookups (Design 103 §6.2.2 B-4). */
  osv_package: z.object({ name: z.string().min(1), ecosystem: z.string().min(1) }).optional(),
  sovereign_alternatives: z.array(SovereignAlternativeSchema).optional(),
}).passthrough();

export const InfraCatSiteSchema = z.object({
  prefix: z.string().min(1),
  site: z.string().min(1),
}).strict();

export const InfraCatFileSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  services: z.array(InfraCatServiceSchema).default([]),
  sites: z.array(InfraCatSiteSchema).optional(),
}).passthrough();

/**
 * Metadata every Tier 1 built-in catalogue file declares at its top level
 * (#3299, Design 110 E-38). Replaces the retired `_registry.yaml`. Tier 2
 * workspace files do not need it (they load in file-name order).
 */
export const InfraCatBuiltinMetaSchema = z.object({
  id: z.string().regex(/^INFRA_[A-Z0-9_]+$/),
  name: z.string().min(1),
  /** Ascending load order; a later file wins on a duplicate service id. */
  load_order: z.number().int().nonnegative(),
}).passthrough();

export type InfraCatService = z.infer<typeof InfraCatServiceSchema>;
export type InfraCatSite = z.infer<typeof InfraCatSiteSchema>;

export interface InfraCatalogue {
  services: InfraCatService[];
  sites: InfraCatSite[];
  /** Files loaded, for diagnostics (paths only). */
  sources: string[];
  /** Service id -> path of the file whose entry won (diagnostics, #3299). */
  origins?: Record<string, string>;
}

export class InfraCatError extends Error {
  constructor(readonly file: string, detail: string) {
    super(`Invalid INFRA-CAT file ${file}: ${detail}`);
    this.name = 'InfraCatError';
  }
}

/**
 * Tier 1 catalogue directory: `SWAO_INFRA_CATALOGUE_DIR` when set, else walk up
 * from this module to `controls/infra-catalogue/` (repo and pkg snapshot) or
 * `_controls/infra-catalogue/` (build-lib staging next to the bundle).
 */
export function resolveBuiltinCatalogueDir(): string | null {
  const override = process.env['SWAO_INFRA_CATALOGUE_DIR'];
  if (override && hasBuiltinCatalogueFiles(override)) return override;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    for (const name of ['controls', '_controls']) {
      const candidate = join(dir, name, 'infra-catalogue');
      if (hasBuiltinCatalogueFiles(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export interface BuiltinCatalogueFile {
  /** File name inside the built-in directory. */
  file: string;
  path: string;
  id: string;
  name: string;
  load_order: number;
}

/**
 * Discover the Tier 1 catalogue files in `dir` from their own metadata (#3299).
 * Scans `*.yaml` / `*.yml` (names starting with `_` or `.` skipped), validates
 * each file's metadata against InfraCatBuiltinMetaSchema and returns them in
 * ascending `load_order`, ties by file name. Never throws: unreadable YAML,
 * missing or invalid metadata, or a catalogue id already declared by an
 * earlier file is skipped with a warning.
 */
export function discoverBuiltinCatalogueFiles(
  dir: string,
  opts: { warn?: (message: string) => void } = {},
): BuiltinCatalogueFile[] {
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && /\.ya?ml$/i.test(d.name) && !d.name.startsWith('_') && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
  const found: BuiltinCatalogueFile[] = [];
  for (const file of names) {
    const path = join(dir, file);
    let raw: unknown;
    try {
      raw = yamlLoad(readFileSync(path, 'utf-8'));
    } catch (e) {
      warn(`[infra-cat] skipped ${file}: not valid YAML (${(e as Error).message.split('\n')[0]})`);
      continue;
    }
    const parsed = InfraCatBuiltinMetaSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      warn(`[infra-cat] skipped ${file}: catalogue metadata missing or invalid (${issues})`);
      continue;
    }
    found.push({ file, path, id: parsed.data.id, name: parsed.data.name, load_order: parsed.data.load_order });
  }
  found.sort((a, b) => a.load_order - b.load_order || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const seen = new Map<string, string>();
  return found.filter((f) => {
    const prior = seen.get(f.id);
    if (prior) {
      warn(`[infra-cat] skipped ${f.file}: catalogue id ${f.id} is already declared by ${prior}`);
      return false;
    }
    seen.set(f.id, f.file);
    return true;
  });
}

/** True when `dir` holds at least one Tier 1 catalogue file with valid metadata (directory probe, #3299). */
export function hasBuiltinCatalogueFiles(dir: string): boolean {
  return existsSync(dir) && discoverBuiltinCatalogueFiles(dir, { warn: () => undefined }).length > 0;
}

export function tier2Dir(workspacePath: string): string {
  return join(workspacePath, 'wsp', 'inputs', 'catalogs', 'infra-cat');
}

function readCatalogueFile(path: string): z.infer<typeof InfraCatFileSchema> {
  let raw: unknown;
  try {
    raw = yamlLoad(readFileSync(path, 'utf-8'));
  } catch (e) {
    throw new InfraCatError(path, `YAML parse error: ${(e as Error).message}`);
  }
  const parsed = InfraCatFileSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new InfraCatError(path, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  for (const svc of parsed.data.services) {
    for (const p of svc.product_name_patterns ?? []) {
      try { new RegExp(p, 'i'); } catch { throw new InfraCatError(path, `${svc.id}: invalid product_name_patterns regex "${p}"`); }
    }
  }
  return parsed.data;
}

/** Load Tier 1 (built-in) then Tier 2 (workspace); Tier 2 replaces Tier 1 on service id collision. */
export function loadInfraCatalogue(
  opts: { workspacePath?: string; builtinDir?: string | null; warn?: (message: string) => void } = {},
): InfraCatalogue {
  const order: string[] = [];
  const byId = new Map<string, InfraCatService>();
  const sites: InfraCatSite[] = [];
  const sources: string[] = [];
  const origins: Record<string, string> = {};

  const addFile = (path: string): void => {
    const file = readCatalogueFile(path);
    sources.push(path);
    for (const svc of file.services) {
      if (!byId.has(svc.id)) order.push(svc.id);
      byId.set(svc.id, svc);
      origins[svc.id] = path;
    }
    for (const s of file.sites ?? []) sites.push(s);
  };

  const builtin = opts.builtinDir === undefined ? resolveBuiltinCatalogueDir() : opts.builtinDir;
  if (builtin === null && opts.builtinDir === undefined) {
    // Without Tier 1 every app would silently classify as UNKNOWN.
    throw new InfraCatError('controls/infra-catalogue', 'built-in SWAO-INFRA-CAT catalogue not found; set SWAO_INFRA_CATALOGUE_DIR to its directory');
  }
  if (builtin) {
    for (const f of discoverBuiltinCatalogueFiles(builtin, opts.warn ? { warn: opts.warn } : {})) addFile(f.path);
  }

  if (opts.workspacePath) {
    const t2 = tier2Dir(opts.workspacePath);
    if (existsSync(t2)) {
      for (const f of readdirSync(t2).filter((n) => /\.ya?ml$/i.test(n)).sort()) addFile(join(t2, f));
    }
  }

  return { services: order.map((id) => byId.get(id) as InfraCatService), sites, sources, origins };
}

/** Leading letters of an app id, trailing hyphens dropped: `hosapp133` -> `hosapp`, `crm_core01` -> `crm_core`. */
export function idPrefix(appId: string): string {
  // Loops instead of `/^[a-z_-]+/` plus `/-+$/`: the trailing-hyphen regex
  // backtracks polynomially on long hyphen runs (CodeQL js/polynomial-redos).
  const lower = appId.toLowerCase();
  let end = 0;
  while (end < lower.length && isPrefixChar(lower.charCodeAt(end))) end++;
  while (end > 0 && lower.charCodeAt(end - 1) === 0x2d) end--;
  return lower.slice(0, end);
}

/** `[a-z_-]` */
function isPrefixChar(code: number): boolean {
  return (code >= 0x61 && code <= 0x7a) || code === 0x5f || code === 0x2d;
}

function prefixHintMatches(prefix: string, hint: string): boolean {
  const h = hint.toLowerCase();
  return prefix.startsWith(h) || (h.length >= 3 && prefix.endsWith(h));
}

export type MatchStrategy = 'id_prefix_hints' | 'vendor_patterns' | 'product_name_patterns';

export interface Classification {
  infra_category: z.infer<typeof InfraCategorySchema>;
  matched_by?: MatchStrategy;
  service?: InfraCatService;
  os_class: string | null;
  site: string | null;
}

/**
 * Classify one row. Priority: id_prefix_hints > vendor_patterns > product_name_patterns
 * (#3079). The first catalogue entry (load order) matching the winning strategy wins.
 */
export function classify(
  cat: InfraCatalogue,
  input: { appId: string; vendorName?: string | null; appName?: string | null; os?: string | null },
): Classification {
  const prefix = idPrefix(input.appId);
  const vendor = (input.vendorName ?? '').toLowerCase();
  const name = input.appName ?? '';

  let match: { service: InfraCatService; by: MatchStrategy } | undefined;
  if (prefix) {
    const s = cat.services.find((svc) => (svc.id_prefix_hints ?? []).some((h) => prefixHintMatches(prefix, h)));
    if (s) match = { service: s, by: 'id_prefix_hints' };
  }
  if (!match && vendor) {
    const s = cat.services.find((svc) => (svc.vendor_patterns ?? []).some((p) => vendor.includes(p.toLowerCase())));
    if (s) match = { service: s, by: 'vendor_patterns' };
  }
  if (!match && name) {
    const s = cat.services.find((svc) => (svc.product_name_patterns ?? []).some((p) => new RegExp(p, 'i').test(name)));
    if (s) match = { service: s, by: 'product_name_patterns' };
  }

  const os = (input.os ?? '').toLowerCase();
  const osService = os
    ? cat.services.find((svc) => (svc.os_string_patterns ?? []).some((p) => os.includes(p.toLowerCase())))
    : undefined;

  const site = [...cat.sites]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((s) => input.appId.toLowerCase().startsWith(s.prefix.toLowerCase()))?.site ?? null;

  return match
    ? { infra_category: match.service.id, matched_by: match.by, service: match.service, os_class: osService?.id ?? null, site }
    : { infra_category: 'UNKNOWN', os_class: osService?.id ?? null, site };
}
