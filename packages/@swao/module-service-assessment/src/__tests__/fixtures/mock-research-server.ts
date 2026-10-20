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
 * Local mock of the Pass 24 research APIs (NVD, endoflife.date, CISA KEV, BSI
 * RSS, OSV.dev, VirusTotal). Response shapes are trimmed from live responses
 * captured on 2026-10-10. Every request is recorded so tests can assert what
 * would leave the client network.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FetchLike } from '../../research/http.js';

export interface RecordedRequest { method: string; url: string; headers: Record<string, string | string[] | undefined>; body: string }

export const SHA_FIXTURE = 'a'.repeat(64);

const nvdCve = (id: string, severity: string, score: number, tags: string[] = []) => ({
  cve: {
    id,
    published: '2024-01-01T00:00:00.000',
    metrics: { cvssMetricV31: [{ source: 'nvd@nist.gov', type: 'Primary', cvssData: { version: '3.1', baseScore: score, baseSeverity: severity } }] },
    references: [{ url: `https://example.org/${id}`, tags }],
  },
});

export const NVD_FUJIFILM = {
  resultsPerPage: 4, startIndex: 0, totalResults: 4, format: 'NVD_CVE', version: '2.0',
  vulnerabilities: [
    nvdCve('CVE-2024-0001', 'CRITICAL', 9.8),
    nvdCve('CVE-2024-0002', 'HIGH', 7.5, ['Vendor Advisory']),
    nvdCve('CVE-2023-0003', 'MEDIUM', 5.3),
    nvdCve('CVE-2022-0004', 'LOW', 2.1, ['Patch']),
  ],
};

/** Five CVEs for the paging tests (#3154); served in `resultsPerPage` slices from `startIndex`. */
export const NVD_PAGED = Array.from({ length: 5 }, (_, i) => nvdCve(`CVE-2025-100${i}`, i === 0 ? 'CRITICAL' : 'MEDIUM', i === 0 ? 9.1 : 5.0));

export const EOL_WINDOWS_SERVER = [
  { cycle: '2025', releaseDate: '2024-11-01', eol: '2034-11-14', support: '2029-11-13', extendedSupport: false, lts: true },
  { cycle: '2022', releaseDate: '2021-08-18', eol: '2031-10-14', support: '2026-10-13', extendedSupport: false, lts: true },
  { cycle: '2019', releaseDate: '2018-11-13', eol: '2029-01-09', support: '2024-01-09', extendedSupport: false, lts: true },
  { cycle: '2016', releaseDate: '2016-10-15', eol: '2027-01-12', support: '2022-01-11', extendedSupport: false, lts: true },
  { cycle: '2012-r2', releaseDate: '2013-11-25', eol: '2023-10-10', support: '2018-10-09', extendedSupport: '2026-10-13', lts: true },
  { cycle: '2012', releaseDate: '2012-10-30', eol: '2023-10-10', support: '2018-10-09', extendedSupport: '2026-10-13', lts: true },
  { cycle: '2008-r2-sp1', releaseDate: '2011-02-22', eol: '2020-01-14', support: '2015-01-13', extendedSupport: '2023-01-10', lts: true },
];

export const KEV_FEED = {
  title: 'CISA Catalog of Known Exploited Vulnerabilities', catalogVersion: '2026.10.08', count: 2,
  vulnerabilities: [
    { cveID: 'CVE-2024-0001', vendorProject: 'Example', product: 'Imaging', requiredAction: 'Apply vendor updates.', dueDate: '2026-11-01' },
    { cveID: 'CVE-2015-5477', vendorProject: 'ISC', product: 'BIND', requiredAction: 'Apply mitigations.', dueDate: '2026-10-29' },
  ],
};

export const BSI_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>BSI WID</title>
<item><title>[NEU] [hoch] FUJIFILM Synapse: Schwachstelle ermoeglicht Codeausfuehrung</title>
<link>https://wid.cert-bund.de/portal/wid/securityadvisory?name=WID-SEC-2026-0001</link>
<description>Fixture advisory.</description><category>hoch</category><pubDate>Fri, 09 Oct 2026 12:14:57 GMT</pubDate></item>
<item><title>[NEU] [mittel] Keycloak: Mehrere Schwachstellen</title>
<link>https://wid.cert-bund.de/portal/wid/securityadvisory?name=WID-SEC-2026-0002</link>
<description>Fixture advisory.</description><category>mittel</category><pubDate>Fri, 09 Oct 2026 12:14:37 GMT</pubDate></item>
<item><title>[NEU] [kritisch] Carestream Vue: Schwachstelle ermoeglicht Umgehen von Sicherheitsvorkehrungen</title>
<link>https://wid.cert-bund.de/portal/wid/securityadvisory?name=WID-SEC-2026-0003</link>
<description>Fixture advisory (product-name match, no vendor).</description><category>kritisch</category><pubDate>Fri, 09 Oct 2026 11:02:11 GMT</pubDate></item>
</channel></rss>`;

export const OSV_RESPONSE = { vulns: [{ id: 'OSV-2024-0001' }, { id: 'OSV-2024-0002' }] };

export const VT_RESPONSE = {
  data: { attributes: { last_analysis_date: 1760000000, last_analysis_stats: { malicious: 2, suspicious: 1, undetected: 66, harmless: 0, timeout: 3 } } },
};

export interface MockServerOptions {
  /** HTTP status to return for NVD requests, in order (then 200). */
  nvdStatuses?: number[];
  vtStatus?: number;
}

export interface MockResearchServer {
  baseUrls: { nvd: string; eol: string; kev: string; bsi: string; osv: string; vt: string };
  requests: RecordedRequest[];
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += String(c); });
    req.on('end', () => resolve(data));
  });
}

export async function startMockResearchServer(opts: MockServerOptions = {}): Promise<MockResearchServer> {
  const requests: RecordedRequest[] = [];
  const nvdStatuses = [...(opts.nvdStatuses ?? [])];
  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req);
    const url = req.url ?? '';
    requests.push({ method: req.method ?? 'GET', url, headers: req.headers, body });
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (url.startsWith('/nvd')) {
      const status = nvdStatuses.shift() ?? 200;
      if (status !== 200) return json(status, { error: 'mock' });
      const params = new URL(url, 'http://x').searchParams;
      const kw = params.get('keywordSearch') ?? '';
      if (kw.toLowerCase().includes('pagedvendor')) {
        const start = Number(params.get('startIndex') ?? 0);
        const size = Number(params.get('resultsPerPage') ?? 2000);
        const page = NVD_PAGED.slice(start, start + size);
        return json(200, { resultsPerPage: page.length, startIndex: start, totalResults: NVD_PAGED.length, vulnerabilities: page });
      }
      return json(200, kw.toLowerCase().includes('fujifilm') ? NVD_FUJIFILM : { totalResults: 0, vulnerabilities: [] });
    }
    if (url === '/eol/windows-server.json') return json(200, EOL_WINDOWS_SERVER);
    if (url.startsWith('/eol/')) return json(404, { error: 'not found' });
    if (url === '/kev.json') return json(200, KEV_FEED);
    if (url === '/bsi.rss') {
      res.writeHead(200, { 'content-type': 'application/rss+xml' });
      return res.end(BSI_RSS);
    }
    if (url === '/osv/v1/query') return json(200, OSV_RESPONSE);
    if (url.startsWith('/vt/files/')) return opts.vtStatus && opts.vtStatus !== 200 ? json(opts.vtStatus, {}) : json(200, VT_RESPONSE);
    return json(404, { error: 'unknown route' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  return {
    baseUrls: { nvd: `${base}/nvd`, eol: `${base}/eol`, kev: `${base}/kev.json`, bsi: `${base}/bsi.rss`, osv: `${base}/osv`, vt: `${base}/vt` },
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/** fetch that refuses any non-localhost URL, so a missing base-URL override can never reach a real API. */
export const localOnlyFetch: FetchLike = (url, init) => {
  if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) return Promise.reject(new Error(`blocked non-local request in test: ${url}`));
  return globalThis.fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>;
};

/** Clock that never really sleeps; records requested sleeps. */
export function fakeClock(start = Date.parse('2026-10-10T08:00:00Z')) {
  let t = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number) => { sleeps.push(ms); t += ms; },
  };
}
