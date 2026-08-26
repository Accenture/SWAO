// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Mock-server tests for fetchAzureCatalogue (CLAUDE.md §5.9 requirement).
// These tests verify the live HTTP transport before any real API invocation.
// Design 056 §4.2, #0688.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseLzCatalogue } from '@swao/core';
import { fetchAzureCatalogue, AZURE_RETAIL_PRICES_URL } from '../fetch-azure.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Shared fake response fixtures
// ---------------------------------------------------------------------------

const FAKE_PAGE_1 = {
  Items: [
    { serviceName: 'Virtual Machines', armRegionName: 'germanywestcentral', retailPrice: 0.096 },
    { serviceName: 'Storage', armRegionName: 'germanywestcentral', retailPrice: 0.018 },
    { serviceName: 'Azure Kubernetes Service', armRegionName: 'westeurope', retailPrice: 0.0 },
  ],
  NextPageLink: 'https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview&$skip=1000',
  Count: 3,
};

const FAKE_PAGE_2 = {
  Items: [
    { serviceName: 'Azure Key Vault', armRegionName: 'germanywestcentral', retailPrice: 0.03 },
    // duplicate -- should be deduped
    { serviceName: 'Virtual Machines', armRegionName: 'germanywestcentral', retailPrice: 0.09 },
  ],
  NextPageLink: null,
  Count: 2,
};

// ---------------------------------------------------------------------------
// Happy path -- single page
// ---------------------------------------------------------------------------

describe('fetchAzureCatalogue -- single-page HTTP mock (#0688)', () => {
  it('calls AZURE_RETAIL_PRICES_URL and returns a valid LzCatalogueSchema', async () => {
    const page = {
      Items: [
        { serviceName: 'Virtual Machines', armRegionName: 'westeurope' },
        { serviceName: 'Storage', armRegionName: 'westeurope' },
      ],
      NextPageLink: null,
    };

    const mockFetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => page });
    vi.stubGlobal('fetch', mockFetch);

    const cat = await fetchAzureCatalogue({ lastUpdated: '2026-07-08', operator: 'test' });

    // Validates against Zod LzCatalogueSchema -- throws on failure
    expect(() => parseLzCatalogue(cat)).not.toThrow();

    // Provider + meta correctness
    expect(cat.meta.provider).toBe('azure');
    expect(cat.meta.last_updated).toBe('2026-07-08');
    expect(cat.meta.confidence).toBe('high');
    expect(cat.meta.source.mode).toBe('api');

    // Region + services extracted
    expect(cat.regions).toHaveLength(1);
    const we = cat.regions[0]!;
    expect(we.id).toBe('westeurope');
    const codes = we.services.map((s) => s.code);
    expect(codes).toContain('Virtual Machines');
    expect(codes).toContain('Storage');

    // fulfills starts empty -- caller enriches
    expect(we.services[0]!.fulfills).toEqual([]);

    // fetch called with the Azure Retail Prices URL
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('prices.azure.com'),
      expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': expect.stringContaining('swao') }) }),
    );
    expect(mockFetch).toHaveBeenCalledWith(AZURE_RETAIL_PRICES_URL, expect.any(Object));
  });

  it('applies overlay sovereignty + display data to matched regions', async () => {
    const page = {
      Items: [{ serviceName: 'Virtual Machines', armRegionName: 'germanywestcentral' }],
      NextPageLink: null,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => page }));

    const cat = await fetchAzureCatalogue({
      lastUpdated: '2026-07-08',
      overlay: {
        germanywestcentral: {
          display: 'Germany West Central',
          country: 'DE',
          sovereignty: {
            residency_country: 'DE',
            operator_jurisdiction: 'US-entity',
            extraterritorial_exposure: ['us_cloud_act', 'fisa_702'],
            certifications: ['C5', 'ISO_27001'],
          },
        },
      },
    });

    const gwc = cat.regions.find((r) => r.id === 'germanywestcentral')!;
    expect(gwc.country).toBe('DE');
    expect(gwc.sovereignty?.certifications).toContain('C5');
    expect(gwc.sovereignty?.operator_jurisdiction).toBe('US-entity');
  });

  it('empty Items array returns empty catalogue (valid)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Items: [], NextPageLink: null }),
    }));

    const cat = await fetchAzureCatalogue({ lastUpdated: '2026-07-08' });
    expect(() => parseLzCatalogue(cat)).not.toThrow();
    expect(cat.regions).toHaveLength(0);
    expect(cat.meta.regions_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pagination -- follows NextPageLink until null
// ---------------------------------------------------------------------------

describe('fetchAzureCatalogue -- pagination (#0688)', () => {
  it('follows NextPageLink across 2 pages and deduplicates services', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => FAKE_PAGE_1 })
      .mockResolvedValueOnce({ ok: true, json: async () => FAKE_PAGE_2 });
    vi.stubGlobal('fetch', mockFetch);

    const cat = await fetchAzureCatalogue({ lastUpdated: '2026-07-08' });

    expect(() => parseLzCatalogue(cat)).not.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Page 2's NextPageLink was called
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      FAKE_PAGE_1.NextPageLink,
      expect.any(Object),
    );

    // germanywestcentral gets: Virtual Machines, Storage (page 1) + Azure Key Vault (page 2)
    // Virtual Machines duplicate from page 2 should be deduped
    const gwc = cat.regions.find((r) => r.id === 'germanywestcentral')!;
    expect(gwc).toBeDefined();
    const gwcCodes = gwc.services.map((s) => s.code);
    expect(gwcCodes).toContain('Virtual Machines');
    expect(gwcCodes).toContain('Storage');
    expect(gwcCodes).toContain('Azure Key Vault');
    // No duplicates
    expect(gwcCodes.filter((c) => c === 'Virtual Machines')).toHaveLength(1);

    // westeurope gets: Azure Kubernetes Service (page 1 only)
    const we = cat.regions.find((r) => r.id === 'westeurope')!;
    expect(we).toBeDefined();
    expect(we.services.map((s) => s.code)).toContain('Azure Kubernetes Service');
  });
});

// ---------------------------------------------------------------------------
// Error handling -- HTTP 500
// ---------------------------------------------------------------------------

describe('fetchAzureCatalogue -- error handling (#0688)', () => {
  it('throws a descriptive error on HTTP 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    }));

    await expect(fetchAzureCatalogue({ lastUpdated: '2026-07-08' })).rejects.toThrow(
      /fetchAzureCatalogue.*HTTP 500.*Internal Server Error/,
    );
  });

  it('throws a descriptive error on HTTP 429 (rate limit) after exhausting retries', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: { get: (_: string) => null },
      }));
      const assertion = expect(fetchAzureCatalogue()).rejects.toThrow(/continued to rate-limit after 5 retries/);
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('respects Retry-After header (30 s) on 429 response (#1275)', async () => {
    vi.useFakeTimers();
    const timerSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      let callCount = 0;
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 5) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            headers: { get: (h: string) => (h === 'Retry-After' ? '30' : null) },
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ Items: [], NextPageLink: null }),
        });
      }));
      const p = fetchAzureCatalogue({ lastUpdated: '2026-07-30' });
      await vi.runAllTimersAsync();
      await p;
      const retryDelays = timerSpy.mock.calls.map(c => c[1] as number);
      expect(retryDelays.some(d => d === 30_000)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('respects x-ms-retry-after-ms header (5000 ms) on 429 response (#1275)', async () => {
    vi.useFakeTimers();
    const timerSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      let callCount = 0;
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 5) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            headers: { get: (h: string) => (h === 'x-ms-retry-after-ms' ? '5000' : null) },
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ Items: [], NextPageLink: null }),
        });
      }));
      const p = fetchAzureCatalogue({ lastUpdated: '2026-07-30' });
      await vi.runAllTimersAsync();
      await p;
      const retryDelays = timerSpy.mock.calls.map(c => c[1] as number);
      expect(retryDelays.some(d => d === 5_000)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// pricesPathOverride -- local file path (CI / air-gapped)
// ---------------------------------------------------------------------------

describe('fetchAzureCatalogue -- pricesPathOverride (#0688)', () => {
  let tmp: string;

  it('reads from local file without calling the network', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-azure-test-'));
    const localFile = join(tmp, 'azure-prices.json');
    writeFileSync(localFile, JSON.stringify({
      Items: [
        { serviceName: 'Azure Blob Storage', armRegionName: 'northeurope' },
      ],
      NextPageLink: null,
    }), 'utf-8');

    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const cat = await fetchAzureCatalogue({ pricesPathOverride: localFile, lastUpdated: '2026-07-08' });

    // No network call was made
    expect(mockFetch).not.toHaveBeenCalled();

    expect(() => parseLzCatalogue(cat)).not.toThrow();
    const ne = cat.regions.find((r) => r.id === 'northeurope')!;
    expect(ne).toBeDefined();
    expect(ne.services.some((s) => s.code === 'Azure Blob Storage')).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
  });

  it('throws when pricesPathOverride file does not exist', async () => {
    await expect(
      fetchAzureCatalogue({ pricesPathOverride: '/nonexistent/path/azure.json' }),
    ).rejects.toThrow(/azure prices file not found/);
  });
});
