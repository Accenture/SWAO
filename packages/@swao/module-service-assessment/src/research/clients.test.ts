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

// Pass 24 RESEARCH clients against a local mock server (#3087-#3091; CLAUDE.md §5.9 mock-server rule).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  BSI_RSS, EOL_WINDOWS_SERVER, KEV_FEED, SHA_FIXTURE, fakeClock, localOnlyFetch, startMockResearchServer, type MockResearchServer,
} from '../__tests__/fixtures/mock-research-server.js';
import { minConfidence, topicConfidence, distribution, formatDistribution } from './confidence.js';
import { matchCycle, productForOs, queryEol } from './eol-client.js';
import { matchBsi, matchKev, parseBsiRss, queryOsv } from './feeds.js';
import { RateLimiter, RunCache, type HttpContext } from './http.js';
import { nvdLimiter, queryNvd } from './nvd-client.js';
import { queryVirusTotal, vtLimiter } from './vt-client.js';

const NOW = new Date('2026-10-10T08:00:00Z');
let mock: MockResearchServer;
let clock: ReturnType<typeof fakeClock>;
let ctx: HttpContext;

beforeEach(async () => {
  mock = await startMockResearchServer();
  clock = fakeClock();
  ctx = { fetch: localOnlyFetch, clock, userAgent: 'swao-test' };
});
afterEach(() => mock.close());

describe('RateLimiter', () => {
  it('allows max calls per window and waits for the window to slide', async () => {
    const lim = new RateLimiter(2, 30_000, clock);
    await lim.acquire(); await lim.acquire(); await lim.acquire();
    expect(clock.sleeps).toEqual([30_001]);
  });

  it('uses 5/30s without an NVD key and 10/30s with one; VT 4/60s', () => {
    expect([nvdLimiter(false).max, nvdLimiter(true).max, vtLimiter().max]).toEqual([5, 10, 4]);
    expect(nvdLimiter(true, undefined, { max: 50, windowMs: 30_000 }).max).toBe(50);
  });
});

describe('NVD client (#3087)', () => {
  const input = { vendor: 'FUJIFILM', product: 'PACS Storage', version: null };

  it('counts CVEs by severity and sends the key only in the apiKey header', async () => {
    const block = await queryNvd(ctx, input, { limiter: nvdLimiter(true, clock), apiKey: 'nvd-secret', baseUrl: mock.baseUrls.nvd, now: NOW });
    expect(block).toMatchObject({ source: 'nvd', count: 4, critical_count: 1, high_count: 1, medium_count: 1, low_count: 1, confidence: 'medium', patch_available: 'partial' });
    expect(block.top[0]).toEqual({ id: 'CVE-2024-0001', severity: 'CRITICAL', score: 9.8, url: 'https://nvd.nist.gov/vuln/detail/CVE-2024-0001' });
    const req = mock.requests[0]!;
    expect(req.headers['apikey']).toBe('nvd-secret');
    expect(req.url).not.toContain('nvd-secret');
    expect(new URL(req.url, 'http://x').searchParams.get('keywordSearch')).toBe('FUJIFILM PACS Storage');
  });

  it('retries a 429 with exponential backoff, then succeeds', async () => {
    await mock.close();
    mock = await startMockResearchServer({ nvdStatuses: [429, 429] });
    const block = await queryNvd(ctx, input, { limiter: nvdLimiter(false, clock), baseUrl: mock.baseUrls.nvd, now: NOW });
    expect(block.count).toBe(4);
    expect(clock.sleeps).toEqual([2000, 4000]);
  });

  it('degrades a 5xx to confidence low with the error and no retry', async () => {
    await mock.close();
    mock = await startMockResearchServer({ nvdStatuses: [503] });
    const block = await queryNvd(ctx, input, { limiter: nvdLimiter(false, clock), baseUrl: mock.baseUrls.nvd, now: NOW });
    expect(block).toMatchObject({ confidence: 'low', error: 'HTTP 503', count: null });
    expect(mock.requests).toHaveLength(1);
  });

  it('sends no request without a real vendor name (redacted or blank)', async () => {
    for (const vendor of [null, '[contact-name-redacted]']) {
      const block = await queryNvd(ctx, { vendor, product: 'Print Server', version: null }, { limiter: nvdLimiter(false, clock), baseUrl: mock.baseUrls.nvd, now: NOW });
      expect(block).toMatchObject({ confidence: 'low', note: 'no_vendor_name' });
    }
    expect(mock.requests).toHaveLength(0);
  });

  it('pages through startIndex until totalResults, every page through the rate limiter (#3154)', async () => {
    const lim = nvdLimiter(false, clock, { max: 2, windowMs: 30_000 });
    const block = await queryNvd(ctx, { vendor: 'PagedVendor', product: null, version: null }, { limiter: lim, baseUrl: mock.baseUrls.nvd, now: NOW, pageSize: 2 });
    expect(block).toMatchObject({ count: 5, critical_count: 1, medium_count: 4 });
    expect(block.cve_ids).toHaveLength(5);
    expect(block.truncated).toBeUndefined();
    const starts = mock.requests.map((r) => new URL(r.url, 'http://x').searchParams.get('startIndex'));
    expect(starts).toEqual(['0', '2', '4']);
    // 3 requests at 2 per 30 s: the third waits for the window to slide.
    expect(clock.sleeps).toEqual([30_001]);
  });

  it('stops at the page cap and flags the block truncated (#3154)', async () => {
    const block = await queryNvd(ctx, { vendor: 'PagedVendor', product: null, version: null }, { limiter: nvdLimiter(true, clock), baseUrl: mock.baseUrls.nvd, now: NOW, pageSize: 2, maxPages: 2 });
    expect(block).toMatchObject({ count: 5, truncated: true });
    expect(block.cve_ids).toHaveLength(4);
    expect(mock.requests).toHaveLength(2);
  });

  it('keeps the pages already read when a later page fails (#3154)', async () => {
    await mock.close();
    mock = await startMockResearchServer({ nvdStatuses: [200, 503] });
    const block = await queryNvd(ctx, { vendor: 'PagedVendor', product: null, version: null }, { limiter: nvdLimiter(true, clock), baseUrl: mock.baseUrls.nvd, now: NOW, pageSize: 2 });
    expect(block.error).toBeUndefined();
    expect(block).toMatchObject({ count: 5, truncated: true });
    expect(block.cve_ids).toHaveLength(2);
  });

  it('labels a versioned match high', async () => {
    const block = await queryNvd(ctx, { ...input, version: '7.2' }, { limiter: nvdLimiter(false, clock), baseUrl: mock.baseUrls.nvd, now: NOW });
    expect(block.confidence).toBe('high');
  });
});

describe('endoflife.date client (#3088)', () => {
  it('matches Windows Server 2016 to cycle 2016 with its end-of-life date', async () => {
    const block = await queryEol(ctx, { os: 'Microsoft Windows Server 2016 (64-bit)', productIds: ['windows-server'] }, { baseUrl: mock.baseUrls.eol, now: NOW, cache: new RunCache() });
    expect(block).toMatchObject({ product: 'windows-server', cycle: '2016', date: '2027-01-12', is_eol: false, confidence: 'high', support_until: '2022-01-11' });
    expect(block.months_until_eol).toBeCloseTo(3.1, 0);
    expect(mock.requests.map((r) => r.url)).toEqual(['/eol/windows-server.json']);
  });

  it('distinguishes 2012 R2 from 2012 and reads extended support dates', () => {
    expect(matchCycle('Windows Server 2012 R2 Standard', EOL_WINDOWS_SERVER)?.cycle).toBe('2012-r2');
    expect(matchCycle('Windows Server 2012 Datacenter', EOL_WINDOWS_SERVER)?.cycle).toBe('2012');
    expect(matchCycle('Windows Server 2008 R2', EOL_WINDOWS_SERVER)?.cycle).toBe('2008-r2-sp1');
  });

  it('matches numeric Linux cycles, preferring the most specific service pack', () => {
    const sles = [{ cycle: '12.5', eol: '2024-10-31' }, { cycle: '12.4', eol: '2020-06-30' }, { cycle: '15.6', eol: '2031-07-31' }];
    expect(matchCycle('SUSE Linux Enterprise 12 SP4', sles)?.cycle).toBe('12.4');
    expect(matchCycle('SUSE Linux Enterprise 12', sles)?.cycle).toBe('12.5');
    expect(matchCycle('Debian GNU/Linux 10 (64-bit)', [{ cycle: '12', eol: '2028-06-30' }, { cycle: '10', eol: '2024-06-30' }])?.cycle).toBe('10');
    expect(productForOs('Red Hat Enterprise Linux 8', ['rhel', 'centos'])).toBe('rhel');
    expect(productForOs('CentOS 7', ['rhel', 'centos'])).toBe('centos');
  });

  it('returns low confidence when the category has no product slug', async () => {
    const block = await queryEol(ctx, { os: 'Custom OS 1', productIds: [] }, { baseUrl: mock.baseUrls.eol, now: NOW, cache: new RunCache() });
    expect(block).toMatchObject({ confidence: 'low', note: 'no_slug_for_category' });
    expect(mock.requests).toHaveLength(0);
  });
});

describe('CISA KEV, BSI, OSV (#3089)', () => {
  it('flags NVD CVE IDs present in the KEV catalogue', () => {
    const block = matchKev(JSON.stringify(KEV_FEED), ['CVE-2024-0001', 'CVE-2024-0002'], NOW);
    expect(block).toMatchObject({ catalog_version: '2026.10.08', confidence: 'high', matches: [{ cve: 'CVE-2024-0001', required_action: 'Apply vendor updates.', due_date: '2026-11-01' }] });
  });

  it('parses the BSI RSS feed and matches the vendor against the advisory subject', () => {
    const items = parseBsiRss(BSI_RSS);
    expect(items).toHaveLength(3);
    const block = matchBsi(items, ['FUJIFILM'], NOW);
    expect(block).toMatchObject({ alert_count: 1, highest_severity: 'hoch', alerts: [{ id: 'WID-SEC-2026-0001', severity: 'hoch' }] });
    expect(matchBsi(items, ['Veeam'], NOW).alert_count).toBe(0);
  });

  it('matches BSI advisories on the product name as well as the vendor (#3154)', () => {
    const items = parseBsiRss(BSI_RSS);
    expect(matchBsi(items, [null, 'Carestream Vue'], NOW)).toMatchObject({ alert_count: 1, highest_severity: 'kritisch' });
    expect(matchBsi(items, ['FUJIFILM', 'Carestream Vue'], NOW).alert_count).toBe(2);
  });

  it('queries OSV only for catalogue entries with an open-source package', async () => {
    const skipped = await queryOsv(ctx, { pkg: null, version: null }, { baseUrl: mock.baseUrls.osv, now: NOW, cache: new RunCache() });
    expect(skipped.skipped_reason).toBe('no_oss_package');
    const hit = await queryOsv(ctx, { pkg: { name: 'openssl', ecosystem: 'Debian:12' }, version: '3.0.11' }, { baseUrl: mock.baseUrls.osv, now: NOW, cache: new RunCache() });
    expect(hit).toMatchObject({ vuln_count: 2, vuln_ids: ['OSV-2024-0001', 'OSV-2024-0002'], confidence: 'high' });
    expect(JSON.parse(mock.requests[0]!.body)).toEqual({ package: { name: 'openssl', ecosystem: 'Debian:12' }, version: '3.0.11' });
  });
});

describe('VirusTotal client (#3090)', () => {
  it('skips entirely without VT_API_KEY', async () => {
    const block = await queryVirusTotal(ctx, { apiKey: null, sha256: SHA_FIXTURE }, { limiter: vtLimiter(clock), baseUrl: mock.baseUrls.vt, now: NOW });
    expect(block.skipped_reason).toBe('no_api_key');
    expect(mock.requests).toHaveLength(0);
  });

  it('looks up the hash with the key in the x-apikey header', async () => {
    const block = await queryVirusTotal(ctx, { apiKey: 'vt-secret', sha256: SHA_FIXTURE }, { limiter: vtLimiter(clock), baseUrl: mock.baseUrls.vt, now: NOW });
    expect(block).toMatchObject({ detection_ratio: '3/72', malicious: 3, confidence: 'high', permalink: `https://www.virustotal.com/gui/file/${SHA_FIXTURE}` });
    expect(block.last_analysis_date).toMatch(/^2025-/);
    expect(mock.requests[0]!.headers['x-apikey']).toBe('vt-secret');
    expect(mock.requests[0]!.url).toBe(`/vt/files/${SHA_FIXTURE}`);
  });

  it('notes a hash unknown to VirusTotal (404) without an error', async () => {
    await mock.close();
    mock = await startMockResearchServer({ vtStatus: 404 });
    const block = await queryVirusTotal(ctx, { apiKey: 'k', sha256: SHA_FIXTURE }, { limiter: vtLimiter(clock), baseUrl: mock.baseUrls.vt, now: NOW });
    expect(block).toMatchObject({ note: 'hash_not_known_to_virustotal', confidence: 'medium' });
  });
});

describe('confidence model (#3091)', () => {
  it('composite is the minimum; skipped blocks are excluded', () => {
    expect(minConfidence(['high', 'high'])).toBe('high');
    expect(minConfidence(['high', 'medium', null])).toBe('medium');
    expect(minConfidence(['low', 'low'])).toBe('low');
    expect(minConfidence([null])).toBeNull();
    expect(topicConfidence([{ confidence: 'high' }, { confidence: null, skipped_reason: 'no_oss_package' }])).toBe('high');
  });

  it('formats the distribution for the TUI', () => {
    expect(formatDistribution(distribution(['high', 'medium', 'medium', 'low', null]))).toBe('high: 1, medium: 2, low: 1, nothing to look up: 1');
  });
});
