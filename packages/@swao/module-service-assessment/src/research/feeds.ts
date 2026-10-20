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
 * Supplementary vulnerability sources (Design 103 §6.2.2 B-3..B-5, #3089):
 * CISA KEV (daily feed), BSI WID / CERT-Bund (RSS), and OSV.dev.
 *
 * KEV and BSI are whole feeds, downloaded at most once per day into
 * `wsp/cache/research/` and matched locally: no app data is sent. OSV is
 * queried only for catalogue entries that declare an open-source package.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError, requestJson, requestText, type HttpContext, type RunCache } from './http.js';
import { BSI_SEVERITIES, type BsiBlock, type KevBlock, type OsvBlock } from './schema.js';

export const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
/** Verified 2026-10-10; the portal URL in Design 103 §6.2.2 B-5 returns HTML. */
export const BSI_RSS_URL = 'https://wid.cert-bund.de/content/public/securityAdvisory/rss';
export const OSV_BASE_URL = 'https://api.osv.dev';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fetch a whole feed, reusing `wsp/cache/research/<name>` when younger than one day. */
export async function cachedFeed(
  ctx: HttpContext,
  opts: { workspacePath: string; name: string; url: string; now: Date; cache: RunCache; refresh?: boolean },
): Promise<string> {
  return opts.cache.get(`feed:${opts.url}`, async () => {
    const dir = join(opts.workspacePath, 'wsp', 'cache', 'research');
    const file = join(dir, opts.name);
    if (!opts.refresh && existsSync(file) && opts.now.getTime() - statSync(file).mtimeMs < DAY_MS) {
      return readFileSync(file, 'utf-8');
    }
    const text = await requestText(ctx, opts.url, { timeoutMs: 60_000 });
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, text, 'utf-8');
    return text;
  });
}

// ---------------------------------------------------------------- CISA KEV

interface KevFeed {
  catalogVersion?: string;
  vulnerabilities?: Array<{ cveID?: string; requiredAction?: string; dueDate?: string }>;
}

export function emptyKevBlock(): KevBlock {
  return { source: 'cisa-kev', fetched_at: null, confidence: null, catalog_version: null, matches: [] };
}

export function matchKev(feedText: string, cveIds: readonly string[], now: Date): KevBlock {
  const feed = JSON.parse(feedText) as KevFeed;
  const wanted = new Set(cveIds.map((c) => c.toUpperCase()));
  const matches = (feed.vulnerabilities ?? [])
    .filter((v) => v.cveID && wanted.has(v.cveID.toUpperCase()))
    .map((v) => ({ cve: v.cveID as string, required_action: v.requiredAction ?? null, due_date: v.dueDate ?? null }));
  return { ...emptyKevBlock(), fetched_at: now.toISOString(), confidence: 'high', catalog_version: feed.catalogVersion ?? null, matches };
}

// ---------------------------------------------------------------- BSI WID / CERT-Bund

export interface BsiItem { title: string; link: string; severity: string | null; published: string | null }

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  if (!m) return null;
  return decodeXmlEntities((m[1] as string).replace(/^<!\[CDATA\[|\]\]>$/g, '')).trim();
}

const XML_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"' };

/**
 * Decode the four XML entities in one pass, so an escaped entity stays
 * literal: `&amp;lt;` becomes `&lt;`, not `<` (CodeQL js/double-escaping).
 */
export function decodeXmlEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot);/g, (_m, name: string) => XML_ENTITIES[name] ?? _m);
}

export function parseBsiRss(xml: string): BsiItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const item = m[1] as string;
    const title = tag(item, 'title') ?? '';
    const cat = tag(item, 'category')?.toLowerCase() ?? null;
    const fromTitle = /\[(niedrig|mittel|hoch|kritisch)\]/i.exec(title)?.[1]?.toLowerCase() ?? null;
    return { title, link: tag(item, 'link') ?? '', severity: cat && (BSI_SEVERITIES as readonly string[]).includes(cat) ? cat : fromTitle, published: tag(item, 'pubDate') };
  });
}

export function emptyBsiBlock(): BsiBlock {
  return { source: 'bsi-cert-bund', fetched_at: null, confidence: null, alert_count: null, highest_severity: null, alerts: [] };
}

/** Advisory title "[NEU] [hoch] Product: text": match vendor or product (4+ chars) against the product part. */
export function matchBsi(items: readonly BsiItem[], terms: ReadonlyArray<string | null>, now: Date): BsiBlock {
  const needles = terms.map((t) => t?.trim().toLowerCase() ?? '').filter((t) => t.length >= 4);
  if (needles.length === 0) return { ...emptyBsiBlock(), fetched_at: now.toISOString(), confidence: 'low', note: 'no_vendor_or_product_name' };
  const hits = items.filter((i) => {
    const subject = (i.title.replace(/^(\[[^\]]*\]\s*)+/, '').split(':')[0] ?? '').toLowerCase();
    return needles.some((n) => subject.includes(n));
  });
  const rank = (s: string | null) => (s ? (BSI_SEVERITIES as readonly string[]).indexOf(s) : -1);
  const highest = hits.reduce<string | null>((acc, h) => (rank(h.severity) > rank(acc) ? h.severity : acc), null);
  return {
    ...emptyBsiBlock(),
    fetched_at: now.toISOString(),
    confidence: 'medium',
    note: 'feed covers recent advisories only',
    alert_count: hits.length,
    highest_severity: highest as BsiBlock['highest_severity'],
    alerts: hits.slice(0, 10).map((h) => ({ id: /name=([^&]+)/.exec(h.link)?.[1] ?? h.link, title: h.title, url: h.link, severity: h.severity, published: h.published })),
  };
}

// ---------------------------------------------------------------- OSV.dev

export function emptyOsvBlock(): OsvBlock {
  return { source: 'osv', fetched_at: null, confidence: null, package: null, ecosystem: null, vuln_count: null, vuln_ids: [] };
}

export async function queryOsv(
  ctx: HttpContext,
  input: { pkg: { name: string; ecosystem: string } | null; version: string | null },
  opts: { baseUrl?: string; now: Date; cache: RunCache },
): Promise<OsvBlock> {
  const fetchedAt = opts.now.toISOString();
  if (!input.pkg) return { ...emptyOsvBlock(), skipped_reason: 'no_oss_package' };
  const base = { ...emptyOsvBlock(), package: input.pkg.name, ecosystem: input.pkg.ecosystem };
  const body = JSON.stringify({ package: { name: input.pkg.name, ecosystem: input.pkg.ecosystem }, ...(input.version ? { version: input.version } : {}) });
  try {
    const res = await opts.cache.get(`osv:${body}`, () =>
      requestJson<{ vulns?: Array<{ id?: string }> }>(ctx, `${opts.baseUrl ?? OSV_BASE_URL}/v1/query`, {
        method: 'POST', body, headers: { 'content-type': 'application/json' },
      }));
    const ids = (res.vulns ?? []).map((v) => v.id).filter((id): id is string => Boolean(id));
    return { ...base, fetched_at: fetchedAt, confidence: input.version ? 'high' : 'medium', vuln_count: ids.length, vuln_ids: ids.slice(0, 50) };
  } catch (e) {
    return { ...base, fetched_at: fetchedAt, confidence: 'low', error: e instanceof HttpError ? e.message : 'request failed' };
  }
}
