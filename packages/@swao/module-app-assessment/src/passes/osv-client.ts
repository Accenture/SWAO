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

// #3420: OSV lookups for Pass 05 SBOM (Design 037, Pass-05 SBOM).
//
// Online:  POST {base}/v1/querybatch in chunks of OSV_BATCH_SIZE (the OSV API
//          maximum), at most OSV_QUERY_CAP queries per pass run. querybatch
//          answers with vulnerability ids only, so the full records (severity)
//          are fetched from {base}/v1/vulns/{id} for at most OSV_DETAIL_CAP
//          distinct ids; ids beyond the cap keep severity 'unknown'.
//          {base} = SWAO_OSV_BASE_URL (read per call) or https://api.osv.dev.
// Offline: a local OSV database is matched without any network call. Source:
//          SWAO_OSV_DB_PATH (file or folder) or <workspace>/wsp/inputs/osv/.
//          Accepted files: OSV JSON records (one record, an array, or
//          { vulns: [...] }) and osv-scanner / osv.dev ecosystem exports
//          (<Ecosystem>/all.zip). Affected ranges (ECOSYSTEM, SEMVER) and
//          explicit version lists are evaluated locally.
//          SWAO_OSV_OFFLINE=true without a database skips the lookup.

import { existsSync, readFileSync, statSync } from 'fs';
import { basename, join } from 'path';
import AdmZip from 'adm-zip';
import { z } from 'zod';
import { listInputFiles } from '@swao/core';
import { createProxyAwareFetch } from '@swao/module-llm-providers';

export type OsvEcosystem = 'npm' | 'Maven';

export interface OsvQuery {
  ecosystem: OsvEcosystem;
  /** npm package name, or `groupId:artifactId` for Maven. */
  name: string;
  /** Concrete version (never a range: an unversioned OSV query returns every advisory). */
  version: string;
}

const OsvSeveritySchema = z.object({ type: z.string().optional(), score: z.string().optional() });
const OsvEventSchema = z.object({
  introduced: z.string().optional(),
  fixed: z.string().optional(),
  last_affected: z.string().optional(),
  limit: z.string().optional(),
});
const OsvAffectedSchema = z.object({
  package: z.object({ ecosystem: z.string().optional(), name: z.string().optional() }).optional(),
  ranges: z.array(z.object({ type: z.string().optional(), events: z.array(OsvEventSchema).optional() })).optional(),
  versions: z.array(z.string()).optional(),
});
export const OsvVulnSchema = z.object({
  id: z.string(),
  summary: z.string().optional(),
  severity: z.array(OsvSeveritySchema).optional(),
  database_specific: z.object({ severity: z.string().optional() }).optional(),
  affected: z.array(OsvAffectedSchema).optional(),
});
export type OsvVulnRecord = z.infer<typeof OsvVulnSchema>;

const OsvBatchResponseSchema = z.object({
  results: z.array(z.object({ vulns: z.array(z.object({ id: z.string() })).optional() })),
});

/** OSV API maximum queries per /v1/querybatch request. */
export const OSV_BATCH_SIZE = 1000;
/** Queries per pass run; the rest is reported as truncated. */
export const OSV_QUERY_CAP = 2000;
/** Distinct vulnerability records fetched for severity per pass run. */
export const OSV_DETAIL_CAP = 200;
const BATCH_TIMEOUT_MS = 10_000;
const DETAIL_TIMEOUT_MS = 5_000;
const DETAIL_CONCURRENCY = 8;

export function osvBaseUrl(): string {
  return (process.env['SWAO_OSV_BASE_URL'] ?? 'https://api.osv.dev').replace(/\/+$/, '');
}

export type OsvMode = 'online' | 'offline_db' | 'skipped';

export interface OsvLookupResult {
  mode: OsvMode;
  /** True when the API answered (online) or a database was loaded (offline). */
  available: boolean;
  /** Per input query (same order): affected records; online records beyond the detail cap carry the id only. */
  perQuery: OsvVulnRecord[][];
  queried: number;
  /** Queries dropped by OSV_QUERY_CAP. */
  truncated: number;
  detailsFetched: number;
  /** True when more distinct ids were found than OSV_DETAIL_CAP. */
  detailsCapped: boolean;
  /** Offline database files used (base names). */
  dbFiles: string[];
  /** Why the lookup was skipped or degraded. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Version comparison and affected-range evaluation
// ---------------------------------------------------------------------------

const QUALIFIER_RANK: Record<string, number> = {
  alpha: 1, a: 1, beta: 2, b: 2, milestone: 3, m: 3, rc: 4, cr: 4, snapshot: 5,
  '': 6, ga: 6, final: 6, release: 6, sp: 7,
};

function versionTokens(v: string): Array<number | string> {
  const out: Array<number | string> = [];
  for (const part of v.toLowerCase().split(/[.\-+_]/)) {
    if (!part) continue;
    for (const m of part.matchAll(/\d+|[a-z]+/g)) {
      const t = m[0];
      out.push(/^\d/.test(t) ? parseInt(t, 10) : t);
    }
  }
  return out;
}

function qualifierRank(t: string): number {
  return QUALIFIER_RANK[t] ?? 6;
}

/**
 * Ordering for Maven (ComparableVersion, simplified) and SemVer versions:
 * numeric tokens numerically, qualifiers alpha < beta < milestone < rc <
 * snapshot < release < sp, a missing token equals 0 / release.
 */
export function compareVersions(a: string, b: string): number {
  const ta = versionTokens(a);
  const tb = versionTokens(b);
  const n = Math.max(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    let x = ta[i];
    let y = tb[i];
    // A missing token equals 0 against a number and "release" against a qualifier.
    if (x === undefined) x = typeof y === 'number' ? 0 : '';
    if (y === undefined) y = typeof x === 'number' ? 0 : '';
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    if (typeof x === 'number') return 1; // 1.0.1 > 1.0-rc
    if (typeof y === 'number') return -1;
    const rx = qualifierRank(x);
    const ry = qualifierRank(y);
    if (rx !== ry) return rx < ry ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** True when `record` affects ecosystem/name@version per its explicit versions or ECOSYSTEM / SEMVER ranges. */
export function osvAffects(record: OsvVulnRecord, query: OsvQuery): boolean {
  for (const aff of record.affected ?? []) {
    if ((aff.package?.ecosystem ?? '').toLowerCase() !== query.ecosystem.toLowerCase()) continue;
    if ((aff.package?.name ?? '').toLowerCase() !== query.name.toLowerCase()) continue;
    if ((aff.versions ?? []).includes(query.version)) return true;
    for (const range of aff.ranges ?? []) {
      if (range.type !== 'ECOSYSTEM' && range.type !== 'SEMVER') continue;
      let affected = false;
      for (const ev of range.events ?? []) {
        if (ev.introduced !== undefined && (ev.introduced === '0' || compareVersions(query.version, ev.introduced) >= 0)) affected = true;
        if (ev.fixed !== undefined && compareVersions(query.version, ev.fixed) >= 0) affected = false;
        if (ev.last_affected !== undefined && compareVersions(query.version, ev.last_affected) > 0) affected = false;
        if (ev.limit !== undefined && compareVersions(query.version, ev.limit) >= 0) affected = false;
      }
      if (affected) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Offline database
// ---------------------------------------------------------------------------

/** Database location: SWAO_OSV_DB_PATH, else <workspace>/wsp/inputs/osv/ when it exists. */
export function resolveOsvDbPath(workspacePath: string): string | null {
  const env = process.env['SWAO_OSV_DB_PATH'];
  if (env && existsSync(env)) return env;
  const local = join(workspacePath, 'wsp', 'inputs', 'osv');
  return existsSync(local) ? local : null;
}

function recordsFromJson(raw: string): unknown[] {
  let doc: unknown;
  try { doc = JSON.parse(raw); } catch { return []; }
  if (Array.isArray(doc)) return doc;
  if (doc && typeof doc === 'object' && Array.isArray((doc as { vulns?: unknown }).vulns)) return (doc as { vulns: unknown[] }).vulns;
  return [doc];
}

/** Load the records relevant to `wanted` (ecosystem|name, lower-cased) from a database path. */
export function loadOsvDatabase(dbPath: string, wanted: ReadonlySet<string>): { records: OsvVulnRecord[]; files: string[] } {
  const records: OsvVulnRecord[] = [];
  const files: string[] = [];
  let paths: string[] = [];
  try {
    paths = statSync(dbPath).isDirectory()
      ? listInputFiles(dbPath).filter((f) => f.ext === '.json' || f.ext === '.zip').map((f) => f.abs)
      : [dbPath];
  } catch { return { records, files }; }
  const keep = (raw: unknown): void => {
    const parsed = OsvVulnSchema.safeParse(raw);
    if (!parsed.success) return;
    const rec = parsed.data;
    if ((rec.affected ?? []).some((a) => wanted.has(`${(a.package?.ecosystem ?? '').toLowerCase()}|${(a.package?.name ?? '').toLowerCase()}`))) {
      records.push(rec);
    }
  };
  for (const p of paths) {
    try {
      if (p.toLowerCase().endsWith('.zip')) {
        const zip = new AdmZip(p);
        for (const entry of zip.getEntries()) {
          if (entry.isDirectory || !entry.entryName.toLowerCase().endsWith('.json')) continue;
          for (const r of recordsFromJson(entry.getData().toString('utf-8'))) keep(r);
        }
      } else {
        for (const r of recordsFromJson(readFileSync(p, 'utf-8'))) keep(r);
      }
      files.push(basename(p));
    } catch { /* unreadable database file: skipped */ }
  }
  return { records, files };
}

// ---------------------------------------------------------------------------
// Online client
// ---------------------------------------------------------------------------

type OsvFetch = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; json?(): Promise<unknown>; text(): Promise<string> }>;

/**
 * #3420 / #3369: OSV requests must honour the corporate proxy. Node's global
 * fetch ignores HTTPS_PROXY on the pkg runtime, so when a proxy variable is
 * set the proxy-aware undici fetch (NO_PROXY and corporate TLS settings
 * included) is used; otherwise the global fetch, which tests stub.
 */
export function selectOsvFetch(env: NodeJS.ProcessEnv = process.env): { kind: 'proxy' | 'global'; fetch: OsvFetch } {
  const proxied = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].some(k => (env[k] ?? '').trim() !== '');
  if (proxied) return { kind: 'proxy', fetch: createProxyAwareFetch() };
  return { kind: 'global', fetch: (url, init) => fetch(url, init as RequestInit) };
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<{ ok: boolean; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { fetch: osvFetch } = selectOsvFetch();
    const res = await osvFetch(url, {
      method: init.method,
      headers: init.headers as Record<string, string> | undefined,
      body: typeof init.body === 'string' ? init.body : undefined,
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, body: null };
    // undici and WHATWG responses both expose json(); text() is the ProxyAwareResponse floor.
    return { ok: true, body: typeof res.json === 'function' ? await res.json() : JSON.parse(await res.text()) as unknown };
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Look up `queries` in the offline database (when `dbPath` is given) or the
 * OSV API. Never throws: an unreachable API yields available=false.
 */
export async function lookupOsv(queries: OsvQuery[], opts: { dbPath?: string | null } = {}): Promise<OsvLookupResult> {
  const capped = queries.slice(0, OSV_QUERY_CAP);
  const base: OsvLookupResult = {
    mode: 'skipped', available: false, perQuery: capped.map(() => []), queried: capped.length,
    truncated: queries.length - capped.length, detailsFetched: 0, detailsCapped: false, dbFiles: [],
  };
  if (capped.length === 0) return base;

  if (opts.dbPath) {
    const wanted = new Set(capped.map((q) => `${q.ecosystem.toLowerCase()}|${q.name.toLowerCase()}`));
    const db = loadOsvDatabase(opts.dbPath, wanted);
    if (db.files.length === 0) return { ...base, mode: 'offline_db', reason: `no readable OSV database file at ${opts.dbPath}` };
    return {
      ...base,
      mode: 'offline_db',
      available: true,
      dbFiles: db.files,
      perQuery: capped.map((q) => db.records.filter((r) => osvAffects(r, q))),
    };
  }

  if (process.env['SWAO_OSV_OFFLINE'] === 'true') {
    return { ...base, reason: 'offline mode (SWAO_OSV_OFFLINE=true) and no OSV database (SWAO_OSV_DB_PATH or wsp/inputs/osv/)' };
  }

  const url = osvBaseUrl();
  const ids: string[][] = [];
  for (let start = 0; start < capped.length; start += OSV_BATCH_SIZE) {
    const chunk = capped.slice(start, start + OSV_BATCH_SIZE);
    let parsed: z.infer<typeof OsvBatchResponseSchema> | null = null;
    try {
      const res = await fetchJson(`${url}/v1/querybatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: chunk.map((q) => ({ version: q.version, package: { name: q.name, ecosystem: q.ecosystem } })) }),
      }, BATCH_TIMEOUT_MS);
      if (res.ok) {
        const p = OsvBatchResponseSchema.safeParse(res.body);
        if (p.success && p.data.results.length === chunk.length) parsed = p.data;
      }
    } catch { parsed = null; }
    if (!parsed) {
      return { ...base, reason: `OSV API unreachable or invalid response at ${url}/v1/querybatch` };
    }
    for (const r of parsed.results) ids.push((r.vulns ?? []).map((v) => v.id));
  }

  const distinct = [...new Set(ids.flat())];
  // Round-robin across packages (first advisory of every package, then the
  // second, ...) so one package with many advisories cannot use up the cap.
  const order: string[] = [];
  const picked = new Set<string>();
  const depth = Math.max(0, ...ids.map((l) => l.length));
  for (let round = 0; round < depth && order.length < OSV_DETAIL_CAP; round++) {
    for (const list of ids) {
      const id = list[round];
      if (id === undefined || picked.has(id)) continue;
      picked.add(id);
      order.push(id);
      if (order.length >= OSV_DETAIL_CAP) break;
    }
  }
  const toFetch = order;
  const details = new Map<string, OsvVulnRecord>();
  await mapLimit(toFetch, DETAIL_CONCURRENCY, async (id) => {
    try {
      const res = await fetchJson(`${url}/v1/vulns/${encodeURIComponent(id)}`, { method: 'GET' }, DETAIL_TIMEOUT_MS);
      const p = res.ok ? OsvVulnSchema.safeParse(res.body) : null;
      if (p?.success) details.set(id, p.data);
    } catch { /* severity stays unknown for this id */ }
  });

  return {
    ...base,
    mode: 'online',
    available: true,
    perQuery: ids.map((list) => list.map((id) => details.get(id) ?? { id })),
    detailsFetched: details.size,
    detailsCapped: distinct.length > OSV_DETAIL_CAP,
  };
}
