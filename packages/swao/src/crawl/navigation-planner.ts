// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

export interface NavigationAction {
  type: 'navigate';
  url: string;
}

// Static asset extensions that are never HTML pages -- filter from crawl queue.
// Crawling these wastes turns and produces screenshots of raw text or binary content.
// Exported so playwright-driver.ts can reuse it for sitemap URL filtering.
export const STATIC_ASSET_EXT = /\.(css|js|mjs|cjs|map|json|ico|png|jpg|jpeg|gif|svg|webp|avif|woff|woff2|ttf|eot|otf|pdf|zip|txt|xml|csv)$/i;

export function extractSameOriginLinks(
  html: string,
  baseUrl: string,
  excludePatterns: string[],
): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  const hrefRegex = /href=["']([^"']+)["']/gi;
  const links: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    if (!href || href.startsWith('#')) {
      continue;
    }

    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      continue;
    }

    // CodeQL #6: explicit protocol allowlist on the PARSED URL (not a
    // startsWith on the raw href). Case-insensitive per RFC 3986 because
    // URL.protocol is always lowercased. Rejects javascript:, mailto:,
    // data:, vbscript:, ftp:, ... -- anything outside http(s)/file.
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'file:') {
      continue;
    }

    // Strip hash and query for dedup purposes
    url.hash = '';

    // Same origin only (file: protocol: same base dir)
    if (base.protocol === 'file:') {
      if (url.protocol !== 'file:') continue;
    } else {
      if (url.origin !== base.origin) continue;
    }

    // Skip static assets -- not HTML pages, produce useless screenshots (#0892).
    if (STATIC_ASSET_EXT.test(url.pathname)) continue;

    const raw = url.href;
    if (excludePatterns.some((p) => new RegExp(p).test(raw))) continue;

    links.push(raw);
  }

  return [...new Set(links)];
}

export function isDuplicateByDomSize(domA: string, domB: string, threshold = 0.05): boolean {
  const sizeA = domA.length;
  const sizeB = domB.length;
  if (sizeA === 0 || sizeB === 0) return false;
  const ratio = Math.abs(sizeA - sizeB) / Math.max(sizeA, sizeB);
  return ratio < threshold;
}

export function planNextActions(
  currentUrl: string,
  domSnapshot: string,
  visited: Set<string>,
  excludePatterns: string[],
): NavigationAction[] {
  const links = extractSameOriginLinks(domSnapshot, currentUrl, excludePatterns);
  return links
    .filter((url) => !visited.has(url))
    .map((url) => ({ type: 'navigate' as const, url }));
}
