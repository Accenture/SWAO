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

// Framework discovery from each framework's own framework-meta.yaml (#3297,
// Design 110 E-24 option A). Replaces the hand-maintained _registry.yaml: a
// framework is any subfolder of the given root that carries a framework-meta.yaml
// valid against FrameworkMetaSchema. The id and display fields come from the
// meta; the folder name is descriptive only.
//
// Never throws: a folder without a meta is ignored silently (not a framework),
// an unreadable or invalid meta or a duplicate id is skipped with a warning.

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { FrameworkMetaSchema, type FrameworkMeta } from './regime-catalogue.js';

export interface DiscoveredFramework {
  /** `framework.id` from framework-meta.yaml. */
  id: string;
  /** Folder name under the scanned root. */
  folder: string;
  /** Absolute path of the framework folder. */
  dir: string;
  /** Parsed and validated framework block. */
  meta: FrameworkMeta['framework'];
}

export interface DiscoverFrameworksOptions {
  /** Include metas with `listed: false` (default false). */
  includeUnlisted?: boolean;
  /** Warning sink for skipped folders; defaults to console.warn. */
  warn?: (message: string) => void;
}

/** Display string for the meta `contributor` (string or { name }). */
export function frameworkContributorName(meta: FrameworkMeta['framework']): string | undefined {
  const c = meta.contributor;
  if (c === undefined) return undefined;
  return typeof c === 'string' ? c : c.name;
}

/**
 * Scan `root` for framework folders. Returns frameworks sorted by id. Entries
 * starting with `_` or `.` are ignored. On a duplicate id the first folder in
 * name order wins and the later one is skipped with a warning.
 */
export function discoverFrameworks(root: string, opts: DiscoverFrameworksOptions = {}): DiscoveredFramework[] {
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  if (!existsSync(root)) return [];
  let names: string[];
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }

  const byId = new Map<string, DiscoveredFramework>();
  for (const folder of names) {
    const dir = join(root, folder);
    const metaPath = join(dir, 'framework-meta.yaml');
    if (!existsSync(metaPath)) continue;
    let raw: unknown;
    try {
      raw = load(readFileSync(metaPath, 'utf-8'));
    } catch (e) {
      warn(`[framework-discovery] skipped ${folder}: framework-meta.yaml is not valid YAML (${(e as Error).message.split('\n')[0]})`);
      continue;
    }
    const parsed = FrameworkMetaSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      warn(`[framework-discovery] skipped ${folder}: framework-meta.yaml failed validation (${issues})`);
      continue;
    }
    const meta = parsed.data.framework;
    if (!meta.listed && !opts.includeUnlisted) continue;
    const prior = byId.get(meta.id);
    if (prior) {
      warn(`[framework-discovery] skipped ${folder}: id ${meta.id} is already declared by ${prior.folder}`);
      continue;
    }
    byId.set(meta.id, { id: meta.id, folder, dir, meta });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Find a discovered framework by id (case-insensitive) or folder name. */
export function findFramework(frameworks: readonly DiscoveredFramework[], idOrFolder: string): DiscoveredFramework | undefined {
  const upper = idOrFolder.toUpperCase();
  return frameworks.find((f) => f.id.toUpperCase() === upper || f.folder === idOrFolder);
}
