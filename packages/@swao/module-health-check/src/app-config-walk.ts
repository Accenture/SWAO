// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health-check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * #4461: one shared walk of `apps/<id>/.swao.yml` per health check. Before,
 * the community frameworks, prerequisites, LZ catalogue and service probes
 * each listed `apps/` and read and parsed every app config again (234 service
 * apps: well over 1,000 reads and parses per health check). Inside
 * withSharedAppConfigWalk (gatherProbes) the first caller reads each file once
 * and the others reuse it; outside it every call reads afresh, so a probe
 * called on its own behaves as before.
 */

import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
// A static import: a dynamic import() of a Node built-in fails in the packaged binary
// ("A dynamic import callback was not specified", health-check.prefetch.failed on dev12).
import * as fsp from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { load } from 'js-yaml';
import { meterFileRead, meterStep } from './probe-meter.js';

export interface AppConfigEntry {
  /** The folder name under apps/. */
  readonly id: string;
  readonly dir: string;
  readonly configPath: string;
  /** The file text. */
  readonly text: string;
  /** The parsed document; undefined when it does not parse (parseError). Shared: never mutate. */
  readonly doc: unknown;
  readonly parseError: boolean;
}

let depth = 0;
const cache = new Map<string, readonly AppConfigEntry[]>();

/** Runs `fn` with one shared app config walk; nested calls share the outer walk. */
export async function withSharedAppConfigWalk<T>(fn: () => Promise<T>): Promise<T> {
  depth += 1;
  try {
    return await fn();
  } finally {
    depth -= 1;
    if (depth === 0) { cache.clear(); files.clear(); }
  }
}

function isDir(appsDir: string, e: Dirent): boolean {
  if (e.isDirectory()) return true;
  if (!e.isSymbolicLink()) return false;
  try { return statSync(join(appsDir, e.name)).isDirectory(); } catch { return false; }
}

function entry(id: string, dir: string, configPath: string, text: string): AppConfigEntry {
  let parsed: { doc: unknown; error: boolean } | undefined;
  const parse = (): { doc: unknown; error: boolean } => {
    if (!parsed) {
      try { parsed = { doc: load(text), error: false }; } catch { parsed = { doc: undefined, error: true }; }
    }
    return parsed;
  };
  return {
    id,
    dir,
    configPath,
    text,
    get doc() { return parse().doc; },
    get parseError() { return parse().error; },
  };
}

function walk(workspacePath: string): AppConfigEntry[] {
  const appsDir = join(workspacePath, 'apps');
  if (!existsSync(appsDir)) return [];
  let dirents: Dirent[];
  try { dirents = readdirSync(appsDir, { withFileTypes: true }); } catch { return []; }
  const out: AppConfigEntry[] = [];
  for (const e of dirents) {
    if (!isDir(appsDir, e)) continue;
    const dir = join(appsDir, e.name);
    const configPath = join(dir, '.swao.yml');
    let text: string;
    try { text = readFileSync(configPath, 'utf-8'); } catch { continue; }
    meterFileRead(Buffer.byteLength(text));
    out.push(entry(e.name, dir, configPath, text));
  }
  return out;
}

/**
 * The app folders under `apps/` that hold a readable `.swao.yml`, in directory
 * order (callers sort as they did before). The parse is lazy and cached.
 */
export function listAppConfigs(workspacePath: string): readonly AppConfigEntry[] {
  if (depth === 0) return walk(workspacePath);
  const key = resolve(workspacePath);
  const hit = cache.get(key);
  if (hit) return hit;
  const entries = meterStep('app config walk', () => walk(workspacePath));
  cache.set(key, entries);
  return entries;
}

/** True while a shared walk is active (tests). */
export function sharedAppConfigWalkActive(): boolean {
  return depth > 0;
}

// ---------------------------------------------------------------- #4461 prefetch

/**
 * #4461 (owner dev10 2026-11-15: research_cache 74 s and the app config walk
 * 35 s, almost all waiting, about 150 ms per small file in the owner
 * workspace): the app configs and the research stubs the probes read are read
 * once, concurrently with a bounded pool (as the run preparation of #4404),
 * while the first probes run. The probes then take the text from memory: the
 * per-file wait overlaps instead of adding up. Files read at a time: the
 * libuv thread pool (4 threads unless UV_THREADPOOL_SIZE is set at start)
 * runs every async file read, so more than 3 reads plus 1 stat in flight only
 * queue, and they would hold back the async work of the probes running
 * meanwhile (the mcp probe's local HTTP check needs a pool thread for the
 * name lookup; measured: 16 in flight made it 4 to 13 times slower).
 */
export const APP_PREFETCH_CONCURRENCY = 3;

/** The research stubs of a service app the probes read (research_cache). */
export const PREFETCH_RESEARCH_FILES = ['cve-summary.md', 'eol-status.md'] as const;
/** Research files whose existence only is checked (stat, not read): the text of a hit is ''. */
export const PREFETCH_RESEARCH_MARKERS = ['confidence.json'] as const;

export interface AppPrefetchStats {
  apps: number;
  service_apps: number;
  files_read: number;
  bytes_read: number;
  /** Files that did not exist (counted, not read). */
  files_absent: number;
  /** Marker files checked with a stat only. */
  files_stat: number;
  duration_ms: number;
  concurrency: number;
}

/** path -> text (null: absent or unreadable), filled by prefetchAppInputs inside a shared walk. */
const files = new Map<string, string | null>();

/**
 * The text of a file read by the prefetch: `{ hit: true, text }` (text null
 * when it does not exist), or `{ hit: false }` when the prefetch did not read
 * it (outside a shared walk, or not one of its files); the caller then reads
 * it itself.
 */
export function prefetchedText(path: string): { hit: true; text: string | null } | { hit: false } {
  if (depth === 0) return { hit: false };
  const key = resolve(path);
  return files.has(key) ? { hit: true, text: files.get(key)! } : { hit: false };
}

/** Runs `fn` over `items` with at most `limit` calls in flight. */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()));
  return out;
}

/**
 * #4461: reads every `apps/<id>/.swao.yml` and the research files of the
 * service apps concurrently and keeps them for the probes of this shared walk
 * (listAppConfigs, prefetchedText); `researchStubs: false` reads the configs
 * only (a scoped health check without research_cache). Outside a shared walk it does nothing.
 * Never throws: an unreadable file is a miss, and the probe that needs it
 * reads it as before.
 */
export async function prefetchAppInputs(workspacePath: string, opts: { concurrency?: number; clock?: () => number; researchStubs?: boolean } = {}): Promise<AppPrefetchStats> {
  const clock = opts.clock ?? Date.now;
  const t0 = clock();
  const concurrency = Math.max(1, opts.concurrency ?? APP_PREFETCH_CONCURRENCY);
  const stats: AppPrefetchStats = { apps: 0, service_apps: 0, files_read: 0, bytes_read: 0, files_absent: 0, files_stat: 0, duration_ms: 0, concurrency };
  if (depth === 0) return stats;
  const { readFile, readdir, stat } = fsp;
  const appsDir = join(workspacePath, 'apps');
  let dirents: Dirent[] = [];
  try { dirents = await readdir(appsDir, { withFileTypes: true }); } catch { dirents = []; }
  const dirs: string[] = [];
  for (const e of dirents) {
    if (e.isDirectory()) { dirs.push(e.name); continue; }
    if (e.isSymbolicLink()) { try { if ((await stat(join(appsDir, e.name))).isDirectory()) dirs.push(e.name); } catch { /* broken link */ } }
  }
  const read = async (path: string): Promise<string | null> => {
    try {
      const text = await readFile(path, 'utf-8');
      stats.files_read += 1;
      stats.bytes_read += Buffer.byteLength(text);
      files.set(resolve(path), text);
      return text;
    } catch {
      stats.files_absent += 1;
      files.set(resolve(path), null);
      return null;
    }
  };
  // Directory order, as walk() keeps it (callers sort).
  const texts = await mapPool(dirs, concurrency, (id) => read(join(appsDir, id, '.swao.yml')));
  const entries: AppConfigEntry[] = [];
  dirs.forEach((id, i) => {
    const text = texts[i];
    if (text === null || text === undefined) return;
    const dir = join(appsDir, id);
    entries.push(entry(id, dir, join(dir, '.swao.yml'), text));
  });
  cache.set(resolve(workspacePath), entries);
  stats.apps = entries.length;
  const service = entries.filter((a) => !a.parseError && (a.doc as { assessment?: { type?: unknown } } | null | undefined)?.assessment?.type === 'service');
  stats.service_apps = service.length;
  // A scoped run without research_cache (an Application or LZ branch) reads the configs only.
  if (opts.researchStubs === false) { stats.duration_ms = clock() - t0; return stats; }
  const research = service.flatMap((a) => PREFETCH_RESEARCH_FILES.map((f) => join(a.dir, 'wsp', 'inputs', 'research', f)));
  const exists = async (path: string): Promise<void> => {
    stats.files_stat += 1;
    try { files.set(resolve(path), (await stat(path)).isFile() ? '' : null); } catch { files.set(resolve(path), null); }
  };
  const markers = service.flatMap((a) => PREFETCH_RESEARCH_MARKERS.map((f) => join(a.dir, 'wsp', 'inputs', 'research', f)));
  await Promise.all([mapPool(research, concurrency, read), mapPool(markers, 1, exists)]);
  stats.duration_ms = clock() - t0;
  return stats;
}
