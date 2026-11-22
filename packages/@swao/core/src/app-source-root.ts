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

// #4243: the source root of an app, scoped to `source.vcs.subdir`.
//
// `swao assess` roots every pass at `<source.path>/<vcs.subdir>` (assess.ts
// resolveSourcePath, #1499 / #3404). Code that prepares or hashes the source
// outside the passes (the LLM Assessment leg copy and its source_hash, the
// inventory walk of #4266) must use the same root, or a monorepo clone is
// copied or hashed in full although only one subdirectory is assessed (the
// 24 minute silent preparation of #4243). This module is the one place that
// derives that root from the app `.swao.yml`.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { load } from 'js-yaml';

export interface AppSourceRoot {
  /** Clone or source folder (`source.path`, default `source`), absolute. */
  base: string;
  /** Folder the passes read: `<base>/<vcs.subdir>` when a subdir is set, else `base`. */
  root: string;
  /** `source.vcs.subdir` with forward slashes and no leading or trailing slash; null when unset. */
  subdir: string | null;
  /**
   * `base` relative to the app directory (forward slashes) when it lies inside
   * it, '' when `base` is the app directory itself, null when it lies outside
   * (an absolute `source.path` to a local working tree).
   */
  baseRelToApp: string | null;
}

/** Strips leading and trailing slashes without a regular expression (CodeQL js/polynomial-redos). */
function trimSlashes(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && s[a] === '/') a++;
  while (b > a && s[b - 1] === '/') b--;
  return s.slice(a, b);
}

function cleanSubdir(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = trimSlashes(raw.replace(/\\/g, '/')).trim();
  return s.length > 0 ? s : null;
}

/**
 * Source root of the app in `appDir` from its parsed `.swao.yml`. Mirrors
 * resolveSourcePath in `swao assess` without the `--source-path` override.
 */
export function appSourceRoot(appDir: string, appYml: Record<string, unknown> | null | undefined): AppSourceRoot {
  const src = (appYml?.['source'] ?? undefined) as Record<string, unknown> | undefined;
  const srcPath = src?.['path'];
  const base = typeof srcPath === 'string' && srcPath.length > 0
    ? resolve(appDir, srcPath)
    : resolve(appDir, 'source');
  const subdir = cleanSubdir((src?.['vcs'] as Record<string, unknown> | undefined)?.['subdir']);
  const root = subdir ? join(base, ...subdir.split('/')) : base;
  const rel = relative(resolve(appDir), base);
  const inside = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  return {
    base,
    root,
    subdir,
    baseRelToApp: inside ? rel.split(sep).join('/') : null,
  };
}

/** appSourceRoot for `apps/<id>` read from its `.swao.yml` (defaults when absent or unreadable). */
export function readAppSourceRoot(appDir: string): AppSourceRoot {
  let yml: Record<string, unknown> | null = null;
  const p = join(appDir, '.swao.yml');
  if (existsSync(p)) {
    try {
      const parsed = load(readFileSync(p, 'utf-8'));
      if (parsed && typeof parsed === 'object') yml = parsed as Record<string, unknown>;
    } catch { /* malformed: defaults */ }
  }
  return appSourceRoot(appDir, yml);
}
