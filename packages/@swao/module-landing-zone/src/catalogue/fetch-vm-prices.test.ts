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

// #3288 (Design 110 D-23, CLAUDE.md §5.9): mock-server tests for the VM price
// fetchers. A real node:http server on an ephemeral port stands in for the
// Azure Retail Prices API and the AWS Price List bulk API; the tests assert
// the request shape (method, path, filter) and the behaviour on the happy
// path, 4xx, 5xx and a timeout.

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { safeParseVmPriceTable } from '@swao/core';
import {
  azureItemOs,
  awsRowOs,
  buildVmPriceTable,
  fetchAwsVmPrices,
  fetchAzureVmPrices,
  parseCsvLine,
  trimBase,
  VmPriceFetchError,
} from './fetch-vm-prices.js';

// CodeQL js/polynomial-redos (PR #1621): `/\/+$/` became a character loop.
describe('trimBase', () => {
  it('drops trailing slashes only', () => {
    expect(trimBase('https://prices.azure.com/api/retail/prices/')).toBe('https://prices.azure.com/api/retail/prices');
    expect(trimBase('http://127.0.0.1:8080///')).toBe('http://127.0.0.1:8080');
    expect(trimBase('http://h/a//b')).toBe('http://h/a//b');
    expect(trimBase('')).toBe('');
    expect(trimBase('///')).toBe('');
    expect(trimBase('   ')).toBe('   ');
    expect(trimBase('https://h/äö/')).toBe('https://h/äö');
  });

  it('matches the former regex on random input (differential)', () => {
    const alphabet = ['/', 'a', ' ', ':', 'ü'];
    let seed = 3;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let k = 0; k < 2000; k++) {
      let s = '';
      const len = rnd(10);
      for (let i = 0; i < len; i++) s += alphabet[rnd(alphabet.length)];
      expect(trimBase(s), JSON.stringify(s)).toBe(s.replace(/\/+$/, ''));
    }
  });

  it('stays fast on 50 000 slashes followed by a character', () => {
    const raw = `${'/'.repeat(50_000)}x`;
    const t0 = performance.now();
    expect(trimBase(raw)).toBe(raw);
    expect(trimBase('/'.repeat(50_000))).toBe('');
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

type Handler = (req: IncomingMessage, res: ServerResponse, base: string) => void;
interface Mock { base: string; requests: Array<{ method: string; url: string }> }

let server: Server | null = null;

async function mockServer(handler: Handler): Promise<Mock> {
  const requests: Mock['requests'] = [];
  let base = '';
  server = createServer((req, res) => {
    requests.push({ method: req.method ?? '', url: req.url ?? '' });
    handler(req, res, base);
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, requests };
}

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  }
});

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

// --- Azure fixture --------------------------------------------------------

const azItem = (armSkuName: string, productName: string, meterName: string, retailPrice: number, extra: Record<string, unknown> = {}) => ({
  currencyCode: 'USD', retailPrice, unitPrice: retailPrice, armRegionName: 'germanywestcentral', armSkuName,
  meterName, skuName: meterName, productName, serviceName: 'Virtual Machines', unitOfMeasure: '1 Hour',
  type: 'Consumption', effectiveStartDate: '2019-09-01T00:00:00Z', ...extra,
});

const AZURE_PAGE_1 = {
  BillingCurrency: 'USD',
  Items: [
    azItem('Standard_D2s_v3', 'Virtual Machines DSv3 Series', 'D2s v3', 0.115),
    azItem('Standard_D2s_v3', 'Virtual Machines DSv3 Series', 'D2s v3 Spot', 0.021252),
    azItem('Standard_D2s_v3', 'Virtual Machines DSv3 Series', 'D2s v3 Low Priority', 0.023),
    azItem('Standard_D2s_v3', 'Virtual Machines DSv3 Series Windows', 'D2s v3', 0.207),
    azItem('Standard_D2s_v3', 'Virtual Machines DSv3 Series Windows', 'D2s v3 Spot', 0.038254),
  ],
  NextPageLink: '__BASE__/api/retail/prices?page=2',
};
const AZURE_PAGE_2 = {
  Items: [
    azItem('Standard_E4s_v3', 'Virtual Machines ESv3 Series', 'E4s v3', 0.304),
    // An older effective date must not replace the newer price.
    azItem('Standard_E4s_v3', 'Virtual Machines ESv3 Series', 'E4s v3', 0.25, { effectiveStartDate: '2017-01-01T00:00:00Z' }),
    azItem('Standard_E4s_v3', 'Virtual Machines ESv3 Series Windows', 'E4s v3', 0.488),
    // Other region and other size: ignored.
    azItem('Standard_E4s_v3', 'Virtual Machines ESv3 Series', 'E4s v3', 0.9, { armRegionName: 'westeurope' }),
    azItem('Standard_F2s_v2', 'Virtual Machines FSv2 Series', 'F2s v2', 0.1),
  ],
  NextPageLink: null,
};

describe('fetchAzureVmPrices (mock server)', () => {
  it('happy path: follows NextPageLink, sends the filter, keeps pay-as-you-go Linux and Windows meters only', async () => {
    const mock = await mockServer((req, res, base) => {
      const page = (req.url ?? '').includes('page=2') ? AZURE_PAGE_2 : { ...AZURE_PAGE_1, NextPageLink: AZURE_PAGE_1.NextPageLink.replace('__BASE__', base) };
      json(res, 200, page);
    });
    const r = await fetchAzureVmPrices({ baseUrl: mock.base, skus: ['D2s_v3', 'E4s_v3', 'B1s'], today: '2026-10-17', timeoutMs: 5_000 });

    expect(mock.requests).toHaveLength(2);
    expect(mock.requests.every((q) => q.method === 'GET')).toBe(true);
    const first = decodeURIComponent(mock.requests[0]!.url);
    expect(first).toContain('/api/retail/prices?api-version=2023-01-01-preview');
    expect(first).toContain("armRegionName eq 'germanywestcentral'");
    expect(first).toContain("priceType eq 'Consumption'");
    expect(first).toContain("armSkuName eq 'Standard_D2s_v3' or armSkuName eq 'Standard_E4s_v3' or armSkuName eq 'Standard_B1s'");

    expect(r.rows).toEqual([
      { provider: 'azure', sku: 'D2s_v3', os: 'linux', region: 'germanywestcentral', currency: 'USD', price_per_hour: 0.115 },
      { provider: 'azure', sku: 'D2s_v3', os: 'windows', region: 'germanywestcentral', currency: 'USD', price_per_hour: 0.207 },
      { provider: 'azure', sku: 'E4s_v3', os: 'linux', region: 'germanywestcentral', currency: 'USD', price_per_hour: 0.304 },
      { provider: 'azure', sku: 'E4s_v3', os: 'windows', region: 'germanywestcentral', currency: 'USD', price_per_hour: 0.488 },
    ]);
    expect(r.missing).toEqual(['B1s/linux', 'B1s/windows']);
    expect(r.source).toMatchObject({ provider: 'azure', api: 'Azure Retail Prices API', region: 'germanywestcentral', currency: 'USD', retrieved: '2026-10-17', published: null });
    expect(r.source.url.startsWith(mock.base)).toBe(true);
  });

  it.each([
    [403, 'HTTP 403'],
    [404, 'HTTP 404'],
    [429, 'rate-limited'],
    [500, 'HTTP 500'],
    [503, 'HTTP 503'],
  ])('HTTP %i is a VmPriceFetchError naming the status', async (status, text) => {
    const mock = await mockServer((_req, res) => json(res, status, { error: 'x' }));
    const err = await fetchAzureVmPrices({ baseUrl: mock.base, timeoutMs: 5_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VmPriceFetchError);
    expect((err as Error).message).toContain(text);
    expect((err as VmPriceFetchError).provider).toBe('azure');
  });

  it('timeout: a server that never answers fails within the timeout', async () => {
    const mock = await mockServer(() => { /* never respond */ });
    const started = Date.now();
    const err = await fetchAzureVmPrices({ baseUrl: mock.base, timeoutMs: 300 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VmPriceFetchError);
    expect((err as Error).message).toContain('no response within 300 ms');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('a response without an Items array is an error, not an empty table', async () => {
    const mock = await mockServer((_req, res) => json(res, 200, { message: 'maintenance' }));
    await expect(fetchAzureVmPrices({ baseUrl: mock.base, timeoutMs: 5_000 })).rejects.toThrow(/no Items array/);
  });

  it('azureItemOs drops Spot, Low Priority and non-hourly meters', () => {
    expect(azureItemOs(azItem('Standard_D2s_v3', 'Virtual Machines DSv3 Series', 'D2s v3', 1))).toBe('linux');
    expect(azureItemOs(azItem('Standard_D2s_v3', 'Virtual Machines DSv3 Series Windows', 'D2s v3', 1))).toBe('windows');
    expect(azureItemOs(azItem('Standard_D2s_v3', 'Virtual Machines DSv3 Series', 'D2s v3 Spot', 1))).toBeNull();
    expect(azureItemOs(azItem('Standard_D2s_v3', 'Virtual Machines DSv3 Series', 'D2s v3 Low Priority', 1))).toBeNull();
    expect(azureItemOs(azItem('Standard_D2s_v3', 'Virtual Machines DSv3 Series', 'D2s v3', 1, { unitOfMeasure: '1/Month' }))).toBeNull();
    expect(azureItemOs(azItem('Standard_D2s_v3', 'Virtual Machines DSv3 Series', 'D2s v3', 1, { type: 'Reservation' }))).toBeNull();
  });
});

// --- AWS fixture (offer file CSV, trimmed to the columns the parser reads) ---

const AWS_HEADER = ['SKU', 'TermType', 'PriceDescription', 'Unit', 'PricePerUnit', 'Currency', 'Instance Type', 'Tenancy', 'Operating System', 'License Model', 'operation', 'CapacityStatus', 'Pre Installed S/W'];
const awsRow = (o: Partial<Record<string, string>>) => {
  const d: Record<string, string> = {
    SKU: 'ABC', TermType: 'OnDemand', PriceDescription: 'USD 0.115 per On Demand Linux m5.large Instance Hour', Unit: 'Hrs',
    PricePerUnit: '0.1150000000', Currency: 'USD', 'Instance Type': 'm5.large', Tenancy: 'Shared', 'Operating System': 'Linux',
    'License Model': 'No License required', operation: 'RunInstances', CapacityStatus: 'Used', 'Pre Installed S/W': 'NA', ...o,
  };
  return AWS_HEADER.map((h) => `"${(d[h] ?? '').replace(/"/g, '""')}"`).join(',');
};
const AWS_CSV = [
  '"FormatVersion","v1.0"',
  '"Disclaimer","This pricing list is for informational purposes only."',
  '"Publication Date","2026-10-15T19:13:16Z"',
  '"Version","20261015191316"',
  '"OfferCode","AmazonEC2"',
  AWS_HEADER.map((h) => `"${h}"`).join(','),
  awsRow({}),
  // Windows: the licence-included row is operation RunInstances:0002 ...
  awsRow({ 'Operating System': 'Windows', operation: 'RunInstances:0002', PricePerUnit: '0.2070000000', PriceDescription: 'USD 0.207 per On Demand Windows m5.large Instance Hour, "quoted"' }),
  // ... the BYOL row and the :box row carry Linux-equal prices and must be ignored.
  awsRow({ 'Operating System': 'Windows', operation: 'RunInstances:0800', 'License Model': 'Bring your own license', PricePerUnit: '0.1150000000' }),
  awsRow({ 'Operating System': 'Windows', operation: 'RunInstances:0002:box', 'License Model': 'License Included - Infrastructure', PricePerUnit: '0.1150000000' }),
  // Reserved, dedicated, unused-reservation and SQL rows: ignored.
  awsRow({ TermType: 'Reserved', PricePerUnit: '0.0520000000' }),
  awsRow({ Tenancy: 'Dedicated', PricePerUnit: '0.1270000000' }),
  awsRow({ CapacityStatus: 'UnusedCapacityReservation', PricePerUnit: '0.1150000000' }),
  awsRow({ 'Pre Installed S/W': 'SQL Std', operation: 'RunInstances:0006', 'Operating System': 'Windows', PricePerUnit: '0.6870000000' }),
  awsRow({ 'Instance Type': 'r5.large', PricePerUnit: '0.1520000000' }),
  awsRow({ 'Instance Type': 'r5.large', 'Operating System': 'Windows', operation: 'RunInstances:0002', PricePerUnit: '0.2440000000' }),
  awsRow({ 'Instance Type': 'c5.large', PricePerUnit: '0.0970000000' }),
].join('\r\n') + '\r\n';

describe('fetchAwsVmPrices (mock server)', () => {
  it('happy path: streams the offer file and keeps on-demand Linux and licence-included Windows rows', async () => {
    const mock = await mockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      // Send in small chunks so lines are split across reads.
      const buf = Buffer.from(AWS_CSV, 'utf-8');
      for (let i = 0; i < buf.length; i += 37) res.write(buf.subarray(i, i + 37));
      res.end();
    });
    const r = await fetchAwsVmPrices({ baseUrl: mock.base, skus: ['m5.large', 'r5.large', 't3.micro'], today: '2026-10-17', timeoutMs: 5_000 });

    expect(mock.requests).toEqual([{ method: 'GET', url: '/offers/v1.0/aws/AmazonEC2/current/eu-central-1/index.csv' }]);
    expect(r.rows).toEqual([
      { provider: 'aws', sku: 'm5.large', os: 'linux', region: 'eu-central-1', currency: 'USD', price_per_hour: 0.115 },
      { provider: 'aws', sku: 'm5.large', os: 'windows', region: 'eu-central-1', currency: 'USD', price_per_hour: 0.207 },
      { provider: 'aws', sku: 'r5.large', os: 'linux', region: 'eu-central-1', currency: 'USD', price_per_hour: 0.152 },
      { provider: 'aws', sku: 'r5.large', os: 'windows', region: 'eu-central-1', currency: 'USD', price_per_hour: 0.244 },
    ]);
    expect(r.missing).toEqual(['t3.micro/linux', 't3.micro/windows']);
    expect(r.source).toMatchObject({ provider: 'aws', region: 'eu-central-1', currency: 'USD', retrieved: '2026-10-17', published: '2026-10-15' });
    expect(r.source.url).toBe(`${mock.base}/offers/v1.0/aws/AmazonEC2/current/eu-central-1/index.csv`);
  });

  it.each([
    [403, 'HTTP 403'],
    [404, 'HTTP 404'],
    [500, 'HTTP 500'],
    [502, 'HTTP 502'],
  ])('HTTP %i is a VmPriceFetchError naming the status', async (status, text) => {
    const mock = await mockServer((_req, res) => { res.writeHead(status); res.end('<Error/>'); });
    const err = await fetchAwsVmPrices({ baseUrl: mock.base, timeoutMs: 5_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VmPriceFetchError);
    expect((err as Error).message).toContain(text);
    expect((err as VmPriceFetchError).provider).toBe('aws');
  });

  it('timeout before the response headers', async () => {
    const mock = await mockServer(() => { /* never respond */ });
    const err = await fetchAwsVmPrices({ baseUrl: mock.base, timeoutMs: 300 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VmPriceFetchError);
    expect((err as Error).message).toContain('no response within 300 ms');
  });

  it('timeout while the body is still streaming', async () => {
    const mock = await mockServer((_req, res) => {
      res.writeHead(200);
      res.write(AWS_CSV.slice(0, 200)); // then stall
    });
    const err = await fetchAwsVmPrices({ baseUrl: mock.base, timeoutMs: 400 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VmPriceFetchError);
    expect((err as Error).message).toContain('download not finished within 400 ms');
  });

  it('a body that is not an offer file is an error', async () => {
    const mock = await mockServer((_req, res) => { res.writeHead(200); res.end('<html>captive portal</html>'); });
    await expect(fetchAwsVmPrices({ baseUrl: mock.base, timeoutMs: 5_000 })).rejects.toThrow(/no "SKU" header row/);
  });

  it('parseCsvLine handles quotes, escaped quotes and empty fields', () => {
    expect(parseCsvLine('"a","b ""c""",,"d",')).toEqual(['a', 'b "c"', '', 'd', '']);
    expect(parseCsvLine('x,,"y"')).toEqual(['x', '', 'y']);
  });

  it('awsRowOs selects RunInstances (Linux) and RunInstances:0002 (Windows, licence included) only', () => {
    const base = { TermType: 'OnDemand', 'Instance Type': 'm5.large', Tenancy: 'Shared', CapacityStatus: 'Used', 'Pre Installed S/W': 'NA', PricePerUnit: '1', Currency: 'USD', Unit: 'Hrs' };
    expect(awsRowOs({ ...base, 'Operating System': 'Linux', operation: 'RunInstances' })).toBe('linux');
    expect(awsRowOs({ ...base, 'Operating System': 'Windows', operation: 'RunInstances:0002' })).toBe('windows');
    expect(awsRowOs({ ...base, 'Operating System': 'Windows', operation: 'RunInstances:0800' })).toBeNull();
    expect(awsRowOs({ ...base, 'Operating System': 'Windows', operation: 'RunInstances:0002:box' })).toBeNull();
    expect(awsRowOs({ ...base, 'Operating System': 'RHEL', operation: 'RunInstances:0010' })).toBeNull();
  });
});

describe('buildVmPriceTable', () => {
  const az = {
    source: { provider: 'azure' as const, api: 'Azure Retail Prices API', url: 'https://prices.azure.com/api/retail/prices', region: 'germanywestcentral', currency: 'USD', retrieved: '2026-10-17', published: null },
    rows: [
      { provider: 'azure' as const, sku: 'D4s_v3', os: 'windows' as const, region: 'germanywestcentral', currency: 'USD', price_per_hour: 0.414 },
      { provider: 'azure' as const, sku: 'D2s_v3', os: 'linux' as const, region: 'germanywestcentral', currency: 'USD', price_per_hour: 0.115 },
    ],
    missing: [],
  };

  it('produces a schema-valid table in target order and keeps the providers not refreshed from the previous table', () => {
    const previous = buildVmPriceTable([{
      source: { provider: 'aws', api: 'AWS Price List bulk API (AmazonEC2 offer file)', url: 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/eu-central-1/index.csv', region: 'eu-central-1', currency: 'USD', retrieved: '2026-10-01', published: '2026-09-30' },
      rows: [{ provider: 'aws', sku: 'm5.large', os: 'linux', region: 'eu-central-1', currency: 'USD', price_per_hour: 0.115 }],
      missing: [],
    }, { ...az, source: { ...az.source, retrieved: '2026-10-01' }, rows: [{ ...az.rows[1]!, price_per_hour: 0.2 }] }], { today: '2026-10-01' });

    const t = buildVmPriceTable([az], { today: '2026-10-17', previous });
    expect(safeParseVmPriceTable(t).ok).toBe(true);
    expect(t.meta.generated_at).toBe('2026-10-17');
    expect(t.meta.sources.map((s) => `${s.provider}:${s.retrieved}`)).toEqual(['azure:2026-10-17', 'aws:2026-10-01']);
    expect(t.prices.map((p) => `${p.provider}/${p.sku}/${p.os}/${p.price_per_hour}`)).toEqual([
      'azure/D2s_v3/linux/0.115', 'azure/D4s_v3/windows/0.414', 'aws/m5.large/linux/0.115',
    ]);
  });
});
