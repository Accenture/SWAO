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
 * NVD CVE 2.0 client (Design 103 §6.2.2 B-2, #3087).
 *
 * One keyword query per distinct vendor + product. A query is only sent when a
 * real vendor name is known: an internal server label alone ("Print Server")
 * matches unrelated CVEs. Only vendor, product, and version leave the client
 * network; the API key travels in the `apiKey` header.
 */

import { HttpError, RateLimiter, requestJson, type Clock, type HttpContext } from './http.js';
import type { CveBlock, ResearchConfidence } from './schema.js';

export const NVD_BASE_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';

/** Conservative defaults per Design 103 §6.2.2; NVD may allow more with a key, so these are configurable. */
export function nvdLimiter(hasKey: boolean, clock?: Clock, override?: { max: number; windowMs: number }): RateLimiter {
  const cfg = override ?? (hasKey ? { max: 10, windowMs: 30_000 } : { max: 5, windowMs: 30_000 });
  return new RateLimiter(cfg.max, cfg.windowMs, clock);
}

interface NvdMetric { cvssData?: { baseSeverity?: string; baseScore?: number }; baseSeverity?: string }
interface NvdCve {
  id: string;
  metrics?: Record<string, NvdMetric[] | undefined>;
  references?: Array<{ url?: string; tags?: string[] }>;
}
interface NvdResponse { totalResults?: number; vulnerabilities?: Array<{ cve?: NvdCve }> }

const METRIC_ORDER = ['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30', 'cvssMetricV2'];

function severityOf(cve: NvdCve): { severity: string | null; score: number | null } {
  for (const key of METRIC_ORDER) {
    const m = cve.metrics?.[key]?.[0];
    if (!m) continue;
    const severity = (m.cvssData?.baseSeverity ?? m.baseSeverity ?? null)?.toUpperCase() ?? null;
    return { severity, score: m.cvssData?.baseScore ?? null };
  }
  return { severity: null, score: null };
}

export const REDACTED_VENDOR_MARKER = '[contact-name-redacted]';

export interface NvdQueryInput {
  vendor: string | null;
  product: string | null;
  version: string | null;
}

export function emptyCveBlock(): CveBlock {
  return {
    source: 'nvd', fetched_at: null, confidence: null, query: null, count: null, critical_count: null,
    high_count: null, medium_count: null, low_count: null, patch_available: null, kev_match: false,
    cve_ids: [], top: [], evidence_url: null,
  };
}

/** Keyword for NVD, or a reason why no query should be sent. */
export function nvdKeyword(input: NvdQueryInput): { keyword: string } | { skip: string } {
  const vendor = input.vendor?.trim() ?? '';
  if (!vendor || vendor === REDACTED_VENDOR_MARKER) return { skip: 'no_vendor_name' };
  const product = input.product?.trim() ?? '';
  return { keyword: product && !product.toLowerCase().includes(vendor.toLowerCase()) ? `${vendor} ${product}` : product || vendor };
}

export function confidenceFor(input: NvdQueryInput): ResearchConfidence {
  if (input.vendor && input.product && input.version) return 'high';
  if (input.vendor && input.product) return 'medium';
  return 'low';
}

/** NVD caps `resultsPerPage` at 2000; pages beyond `NVD_MAX_PAGES` are not fetched (the block is marked `truncated`). */
export const NVD_PAGE_SIZE = 2000;
export const NVD_MAX_PAGES = 5;

export async function queryNvd(
  ctx: HttpContext,
  input: NvdQueryInput,
  opts: { limiter: RateLimiter; apiKey?: string | null; baseUrl?: string; now: Date; pageSize?: number; maxPages?: number },
): Promise<CveBlock> {
  const block = emptyCveBlock();
  const kw = nvdKeyword(input);
  if ('skip' in kw) {
    return { ...block, confidence: 'low', note: kw.skip, fetched_at: opts.now.toISOString() };
  }
  block.query = kw.keyword;
  const base = opts.baseUrl ?? NVD_BASE_URL;
  const pageSize = opts.pageSize ?? NVD_PAGE_SIZE;
  const maxPages = opts.maxPages ?? NVD_MAX_PAGES;
  try {
    // #3154: page through startIndex; every page goes through the shared NVD rate limiter.
    const cves: NvdCve[] = [];
    let total: number | null = null;
    let truncated = false;
    for (let page = 0; ; page++) {
      const url = `${base}?keywordSearch=${encodeURIComponent(kw.keyword)}&resultsPerPage=${pageSize}&startIndex=${page * pageSize}`;
      let data: NvdResponse;
      try {
        data = await requestJson<NvdResponse>(ctx, url, {
          limiter: opts.limiter,
          ...(opts.apiKey ? { headers: { apiKey: opts.apiKey } } : {}),
        });
      } catch (e) {
        if (page === 0) throw e;
        truncated = true; // later page failed: keep what was read, flag the gap
        break;
      }
      const batch = (data.vulnerabilities ?? []).map((v) => v.cve).filter((c): c is NvdCve => Boolean(c?.id));
      cves.push(...batch);
      total = data.totalResults ?? total ?? cves.length;
      if (batch.length === 0 || cves.length >= total) break;
      if (page + 1 >= maxPages) { truncated = true; break; }
    }
    const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    const scored = cves.map((c) => ({ c, ...severityOf(c) }));
    for (const s of scored) if (s.severity && s.severity in counts) counts[s.severity as keyof typeof counts]++;
    const severe = scored.filter((s) => s.severity === 'CRITICAL' || s.severity === 'HIGH');
    const tagged = (c: NvdCve, tag: string) => (c.references ?? []).some((r) => (r.tags ?? []).includes(tag));
    const patch = severe.length === 0 ? null
      : severe.every((s) => tagged(s.c, 'Patch')) ? true
      : severe.some((s) => tagged(s.c, 'Patch') || tagged(s.c, 'Vendor Advisory')) ? 'partial'
      : false;
    const top = [...scored]
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 10)
      .map((s) => ({ id: s.c.id, severity: s.severity, score: s.score, url: `https://nvd.nist.gov/vuln/detail/${s.c.id}` }));
    return {
      ...block,
      fetched_at: opts.now.toISOString(),
      confidence: confidenceFor(input),
      count: total ?? cves.length,
      ...(truncated ? { truncated: true } : {}),
      critical_count: counts.CRITICAL,
      high_count: counts.HIGH,
      medium_count: counts.MEDIUM,
      low_count: counts.LOW,
      patch_available: patch,
      cve_ids: cves.map((c) => c.id),
      top,
      evidence_url: `https://nvd.nist.gov/vuln/search/results?query=${encodeURIComponent(kw.keyword)}`,
    };
  } catch (e) {
    return { ...block, fetched_at: opts.now.toISOString(), confidence: 'low', error: e instanceof HttpError ? e.message : 'request failed' };
  }
}
