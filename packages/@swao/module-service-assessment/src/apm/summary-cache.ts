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
 * #4271: the per-app row cache of the portfolio summary rebuild.
 *
 * The post-run step `portfolio_summary` rebuilt the summary of every app in
 * the workspace after every single app run: in a 235-app service workspace it
 * opened and parsed every app's `.swao.yml`, research stubs, binary analysis
 * and latest run on each rebuild (157 s per run with the developer binary).
 * #4412 (owner decision 2026-11-16): the cache keeps each service app's
 * gathered evidence (the parsed `.swao.yml`, the research stub fields, the
 * signals of the latest run, the run provenance and the plan-derived fields),
 * keyed per app by its inputs fingerprint (the stat signatures of every input
 * file). Every rebuild re-scores every app from the evidence (cheap, in memory)
 * with the current framework and date; a warm rebuild stats the inputs of
 * every app and re-reads only the apps whose fingerprint changed (typically
 * the one app that was just assessed). The fingerprint is stat-only on
 * purpose: a content hash would open every input file on every rebuild, the
 * per-file cost the cache exists to avoid.
 *
 * Application apps are not cached (their inputs span landing zone runs and the
 * landing zone portfolio merge); they are few in a service portfolio.
 *
 * The file is keyed on the cache version only: the framework and the date are
 * applied by the re-score, so neither a new day nor a framework change makes
 * a rebuild cold (#4412; until then the key held the framework hash and the
 * day, and the first rebuild of every day recomputed every row). Bump the
 * version when the cached evidence shape or the fingerprint inputs change.
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PortfolioApp } from '@swao/core';
import type { ApmEvidence } from './rules.js';

/** Bump when the cached evidence shape or the fingerprint inputs change. 3: evidence instead of scored rows (#4412). */
export const PORTFOLIO_ROW_CACHE_VERSION = 3;

/** Workspace-relative location of the cache file. */
export const PORTFOLIO_ROW_CACHE_FILE = join('wsp', 'cache', 'portfolio-summary-rows.json');

/** What kind of app a folder under `apps/` holds, from its `.swao.yml`. */
export type CachedAppKind = 'service' | 'application' | 'other';

/** The `.swao.yml` fields the cross-app steps (graph, waves, vendors) read. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CrossAppFields = Record<string, any>;

/**
 * #4412: everything the score of one service app reads from its files, so a
 * re-score needs no file access. `evidence` is the rules' evidence without
 * `now` (the date of the rebuild is applied by the re-score).
 */
export interface ServiceAppInputs {
  evidence: Omit<ApmEvidence, 'now'>;
  run: string | null;
  synthesisSevenR: string | null;
  provenance: Pick<PortfolioApp, 'last_assessed_at' | 'swao_version' | 'llm_model'>;
  plan: Pick<PortfolioApp, 'compliance' | 'risk_counts'>;
}

export interface CachedServiceRow {
  /** Stat fingerprint of the app's inputs when the evidence was gathered (the inputs key). */
  fp: string;
  inputs: ServiceAppInputs;
}

export interface CachedAppKindEntry {
  /** Stat signature of the app's `.swao.yml` when the kind was read. */
  sig: string;
  kind: CachedAppKind;
  name: string | null;
}

export interface PortfolioRowCache {
  version: number;
  key: string;
  kinds: Record<string, CachedAppKindEntry>;
  rows: Record<string, CachedServiceRow>;
}

/** Pick the cross-app fields from an app `.swao.yml` document. */
export function crossAppFields(app: Record<string, unknown>): CrossAppFields {
  const out: CrossAppFields = {};
  for (const k of ['integrations', 'cluster_members', 'cluster', 'data', 'vendor']) {
    if (app[k] !== undefined) out[k] = app[k];
  }
  return out;
}

/**
 * The cache key: the cache version only (#4412). The framework and the date
 * are applied when the cached evidence is re-scored, so they are not part of
 * the key: no daily cold start, and no cold start after a framework change or
 * a binary built from another folder.
 */
export function portfolioCacheKey(): string {
  return `v${PORTFOLIO_ROW_CACHE_VERSION}`;
}

/** `mtimeMs:size` of a path, or `-` when absent. Stat only, never opens the file. */
export function statSig(path: string): string {
  try {
    const s = statSync(path, { throwIfNoEntry: false });
    return s ? `${Math.round(s.mtimeMs)}:${s.size}` : '-';
  } catch {
    return '-';
  }
}

/** Research stubs the service evidence reads (gatherEvidence). */
const SERVICE_INPUT_FILES = [
  '.swao.yml',
  join('wsp', 'latest-service.txt'),
  join('wsp', 'inputs', 'research', 'cve-summary.md'),
  join('wsp', 'inputs', 'research', 'eol-status.md'),
  join('wsp', 'inputs', 'research', 'virustotal.md'),
  join('wsp', 'signals', 'binary-signals.json'),
  join('wsp', 'inputs', 'binary', 'binary-analysis.json'),
];

/** Files of the latest run that feed the row (provenance, plan-derived fields). */
const SERVICE_RUN_FILES = ['run-manifest.json', 'wsp-plan.yaml'];

/**
 * Stat fingerprint of one service app's inputs. `run` is the wsp-relative run
 * path the row was computed from (`runs/<id>`); the latest-service pointer is
 * part of the fingerprint, so a new run changes it before `run` is consulted.
 */
export function serviceAppFingerprint(workspacePath: string, appId: string, run: string | null): string {
  const appDir = join(workspacePath, 'apps', appId);
  const parts = SERVICE_INPUT_FILES.map((f) => statSig(join(appDir, f)));
  if (run) {
    const runDir = join(appDir, 'wsp', run);
    for (const f of SERVICE_RUN_FILES) parts.push(statSig(join(runDir, f)));
    const passesDir = join(runDir, 'passes');
    let names: string[] = [];
    try { names = readdirSync(passesDir).filter((n) => n.endsWith('.yaml')).sort(); } catch { /* no passes */ }
    for (const n of names) parts.push(`${n}=${statSig(join(passesDir, n))}`);
  }
  return parts.join('|');
}

/**
 * #4412: why the cached evidence was not used: no cache file, an unreadable
 * file, or another cache version (also the cache of a binary before this
 * change, keyed on framework and day). Null when the evidence applies. A
 * changed framework or a new day no longer makes the cache cold.
 */
export type PortfolioCacheMissReason = 'absent' | 'unreadable' | 'version';

/** Null when the stored key is the current key, else `version` (the key is the cache version only). */
export function cacheKeyDifference(stored: unknown, key: string): PortfolioCacheMissReason | null {
  return stored === key ? null : 'version';
}

/**
 * #4412: the first input whose stat signature differs between two service app
 * fingerprints (`.swao.yml`, `latest-service.txt`, a research stub, a run file
 * or `passes`), or null when they are equal. Names why a row was recomputed.
 */
export function fingerprintDifference(stored: string, current: string): string | null {
  if (stored === current) return null;
  const a = stored.split('|');
  const b = current.split('|');
  const names = [...SERVICE_INPUT_FILES.map((f) => f.split(/[\\/]/).pop()!), ...SERVICE_RUN_FILES];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return i < names.length ? names[i]! : 'passes';
  }
  return 'passes';
}

/**
 * #4412: JSON with Date values kept as Date. js-yaml loads an unquoted date
 * (`eol_date: 2027-01-31`) as a Date; the rules treat a Date differently from
 * a string, so cached evidence must give the same score as a fresh read.
 */
const DATE_TAG = '$swao_date';
function dateReplacer(this: unknown, key: string, value: unknown): unknown {
  const raw = (this as Record<string, unknown>)[key];
  if (raw instanceof Date) return { [DATE_TAG]: Number.isNaN(raw.getTime()) ? null : raw.toISOString() };
  return value;
}
function dateReviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === DATE_TAG) return new Date(typeof o[DATE_TAG] === 'string' ? (o[DATE_TAG] as string) : Number.NaN);
  }
  return value;
}

/** Read the cache; an absent, unreadable or foreign-key cache yields an empty one. */
export function readPortfolioRowCache(workspacePath: string, key: string): PortfolioRowCache {
  return readPortfolioRowCacheDetailed(workspacePath, key).cache;
}

/** #4412: the cache plus the reason its rows were not used (null when they apply). */
export function readPortfolioRowCacheDetailed(workspacePath: string, key: string): { cache: PortfolioRowCache; miss: PortfolioCacheMissReason | null; bytes?: number } {
  const empty: PortfolioRowCache = { version: PORTFOLIO_ROW_CACHE_VERSION, key, kinds: {}, rows: {} };
  let text: string;
  try {
    text = readFileSync(join(workspacePath, PORTFOLIO_ROW_CACHE_FILE), 'utf-8');
  } catch {
    return { cache: empty, miss: 'absent' };
  }
  const bytes = Buffer.byteLength(text, 'utf-8');
  try {
    const raw = JSON.parse(text, dateReviver) as Partial<PortfolioRowCache>;
    if (raw.version !== PORTFOLIO_ROW_CACHE_VERSION || typeof raw.kinds !== 'object' || raw.kinds === null) return { cache: empty, miss: 'version', bytes };
    // The kind of an app depends only on its .swao.yml, so kinds survive a version change; the evidence does not.
    const usable = raw.key === key && typeof raw.rows === 'object' && raw.rows !== null;
    return {
      cache: { version: PORTFOLIO_ROW_CACHE_VERSION, key, kinds: raw.kinds, rows: usable ? raw.rows! : {} },
      miss: usable ? null : cacheKeyDifference(raw.key, key) ?? 'unreadable',
      bytes,
    };
  } catch {
    return { cache: empty, miss: 'unreadable', bytes };
  }
}

/** Write the cache (best effort: a failed write only costs the next rebuild its warm start). #4412: returns the bytes written, null on a failed write. */
export function writePortfolioRowCache(workspacePath: string, cache: PortfolioRowCache): number | null {
  try {
    mkdirSync(join(workspacePath, 'wsp', 'cache'), { recursive: true });
    const text = JSON.stringify(cache, dateReplacer);
    writeFileSync(join(workspacePath, PORTFOLIO_ROW_CACHE_FILE), text, 'utf-8');
    return Buffer.byteLength(text, 'utf-8');
  } catch {
    return null;
  }
}

/** Number of app folders under `apps/` (the `apps_total` of the rebuild start event). */
export function countPortfolioApps(workspacePath: string): number {
  try {
    return readdirSync(join(workspacePath, 'apps'), { withFileTypes: true }).filter((d) => d.isDirectory()).length;
  } catch {
    return 0;
  }
}
