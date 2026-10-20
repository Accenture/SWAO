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

/**
 * VM price fetchers for the service cost model (#3288, Design 110 D-23).
 *
 * Both sources are public and need no credentials; SWAO only sends GET
 * requests:
 *
 * - Azure Retail Prices API (https://prices.azure.com/api/retail/prices),
 *   filtered server-side to the cost model's sizes in one region. Windows
 *   meters carry the product name suffix " Windows"; Spot and Low Priority
 *   meters are dropped.
 * - AWS Price List bulk API, AmazonEC2 offer file for one region in CSV form
 *   (https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/<region>/index.csv).
 *   The file is large (about 280 MB for eu-central-1), so it is streamed line
 *   by line and only on-demand, shared-tenancy rows of the cost model's
 *   sizes are parsed. Linux is operation `RunInstances`; Windows with the
 *   licence included is operation `RunInstances:0002` (the BYOL row
 *   `RunInstances:0800` and the `:0002:box` row carry Linux-equal prices and
 *   are ignored on purpose).
 *
 * `swao lz catalogue update` runs both fetchers in the same run as the
 * service catalogues and writes `prices/vm-prices.json` next to them.
 */

import {
  VM_PRICE_OS,
  VM_PRICE_TARGETS,
  type VmPriceOs,
  type VmPriceProvider,
  type VmPriceRow,
  type VmPriceSource,
  type VmPriceTable,
} from '@swao/core';

export const AZURE_RETAIL_PRICES_API = 'https://prices.azure.com';
export const AWS_PRICE_LIST_BULK_API = 'https://pricing.us-east-1.amazonaws.com';

/** Default request timeout; the AWS offer file needs about 20 to 60 s on a normal line. */
export const VM_PRICE_FETCH_TIMEOUT_MS = 300_000;

const AZURE_MAX_PAGES = 20;
const USER_AGENT = 'swao-lz-catalogue-refresh/0.1';

export interface VmPriceFetchOptions {
  /** Base URL override (mirror, proxy, or a mock server in tests). */
  baseUrl?: string;
  region?: string;
  skus?: readonly string[];
  timeoutMs?: number;
  /** Retrieval date (YYYY-MM-DD); defaults to today (UTC). */
  today?: string;
}

export interface VmPriceFetchResult {
  source: VmPriceSource;
  rows: VmPriceRow[];
  /** `<sku>/<os>` pairs the API returned no price for. */
  missing: string[];
}

export class VmPriceFetchError extends Error {
  constructor(readonly provider: VmPriceProvider, readonly url: string, detail: string) {
    super(`${provider} price fetch failed: ${detail} (${url})`);
    this.name = 'VmPriceFetchError';
  }
}

const todayUtc = (): string => new Date().toISOString().slice(0, 10);

/**
 * Base URL without trailing slashes. A character loop instead of `/\/+$/`,
 * which backtracks polynomially on long slash runs (CodeQL js/polynomial-redos).
 * Exported for tests.
 */
export function trimBase(u: string): string {
  let end = u.length;
  while (end > 0 && u.charCodeAt(end - 1) === 0x2f) end--;
  return u.slice(0, end);
}

function missingPairs(skus: readonly string[], rows: readonly VmPriceRow[]): string[] {
  const out: string[] = [];
  for (const sku of skus) for (const os of VM_PRICE_OS) {
    if (!rows.some((r) => r.sku === sku && r.os === os)) out.push(`${sku}/${os}`);
  }
  return out;
}

async function get(provider: VmPriceProvider, url: string, timeoutMs: number): Promise<Response> {
  let resp: Response;
  try {
    resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const err = e as Error;
    const detail = err.name === 'TimeoutError' || err.name === 'AbortError' ? `no response within ${timeoutMs} ms` : err.message;
    throw new VmPriceFetchError(provider, url, detail);
  }
  if (!resp.ok) {
    throw new VmPriceFetchError(provider, url, `HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''}${resp.status === 429 ? ' (rate-limited; retry later)' : ''}`);
  }
  return resp;
}

// ---------------------------------------------------------------------------
// Azure Retail Prices API
// ---------------------------------------------------------------------------

interface AzurePriceItem {
  currencyCode?: string;
  retailPrice?: number;
  armRegionName?: string;
  armSkuName?: string;
  meterName?: string;
  skuName?: string;
  productName?: string;
  serviceName?: string;
  unitOfMeasure?: string;
  type?: string;
  effectiveStartDate?: string;
}

/** The Retail Prices API filter for the given sizes in one region (pay-as-you-go only). */
export function azureVmPriceFilter(region: string, skus: readonly string[]): string {
  const skuClause = skus.map((s) => `armSkuName eq 'Standard_${s}'`).join(' or ');
  return `serviceName eq 'Virtual Machines' and armRegionName eq '${region}' and priceType eq 'Consumption' and (${skuClause})`;
}

/** Linux or Windows for a Retail Prices item; null for Spot, Low Priority and non-hourly meters. */
export function azureItemOs(item: AzurePriceItem): VmPriceOs | null {
  if (item.type !== 'Consumption' || item.serviceName !== 'Virtual Machines' || item.unitOfMeasure !== '1 Hour') return null;
  if (/\b(spot|low priority)\b/i.test(`${item.meterName ?? ''} ${item.skuName ?? ''}`)) return null;
  return /\bWindows$/.test(item.productName ?? '') ? 'windows' : 'linux';
}

export async function fetchAzureVmPrices(opts: VmPriceFetchOptions = {}): Promise<VmPriceFetchResult> {
  const region = opts.region ?? VM_PRICE_TARGETS.azure.region;
  const skus = opts.skus ?? VM_PRICE_TARGETS.azure.skus;
  const timeoutMs = opts.timeoutMs ?? VM_PRICE_FETCH_TIMEOUT_MS;
  const base = trimBase(opts.baseUrl ?? AZURE_RETAIL_PRICES_API);
  const firstUrl = `${base}/api/retail/prices?api-version=2023-01-01-preview&$filter=${encodeURIComponent(azureVmPriceFilter(region, skus))}`;

  // sku/os -> newest item
  const best = new Map<string, { price: number; currency: string; effective: string }>();
  let currency = 'USD';
  let url: string | null = firstUrl;
  let pages = 0;
  while (url && pages < AZURE_MAX_PAGES) {
    pages++;
    const resp = await get('azure', url, timeoutMs);
    let page: { Items?: AzurePriceItem[]; NextPageLink?: string | null; BillingCurrency?: string };
    try { page = (await resp.json()) as typeof page; } catch (e) {
      throw new VmPriceFetchError('azure', url, `response is not JSON: ${(e as Error).message}`);
    }
    if (!Array.isArray(page.Items)) throw new VmPriceFetchError('azure', url, 'response has no Items array');
    for (const item of page.Items) {
      const os = azureItemOs(item);
      const sku = (item.armSkuName ?? '').replace(/^Standard_/, '');
      if (!os || item.armRegionName !== region || !skus.includes(sku)) continue;
      if (typeof item.retailPrice !== 'number' || !(item.retailPrice > 0)) continue;
      const key = `${sku}/${os}`;
      const effective = item.effectiveStartDate ?? '';
      const prev = best.get(key);
      if (!prev || effective > prev.effective) best.set(key, { price: item.retailPrice, currency: item.currencyCode ?? 'USD', effective });
      currency = item.currencyCode ?? currency;
    }
    url = page.NextPageLink ?? null;
  }
  if (url) throw new VmPriceFetchError('azure', url, `more than ${AZURE_MAX_PAGES} result pages; the filter is too broad`);

  const rows: VmPriceRow[] = [];
  for (const sku of skus) for (const os of VM_PRICE_OS) {
    const b = best.get(`${sku}/${os}`);
    if (b) rows.push({ provider: 'azure', sku, os, region, currency: b.currency, price_per_hour: b.price });
  }
  return {
    source: { provider: 'azure', api: 'Azure Retail Prices API', url: firstUrl, region, currency, retrieved: opts.today ?? todayUtc(), published: null },
    rows,
    missing: missingPairs(skus, rows),
  };
}

// ---------------------------------------------------------------------------
// AWS Price List bulk API (AmazonEC2 offer file, CSV, streamed)
// ---------------------------------------------------------------------------

/** Split one CSV line into fields (RFC 4180 quoting; the offer file has no embedded line breaks). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = line.length;
  while (i <= n) {
    if (line[i] === '"') {
      let v = '';
      i++;
      while (i < n) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') { v += '"'; i += 2; continue; }
          i++;
          break;
        }
        v += line[i++];
      }
      out.push(v);
      i++; // skip the comma
    } else {
      const end = line.indexOf(',', i);
      if (end === -1) { out.push(line.slice(i)); break; }
      out.push(line.slice(i, end));
      i = end + 1;
      if (i === n) { out.push(''); break; }
    }
  }
  return out;
}

const AWS_COLUMNS = ['TermType', 'Instance Type', 'Tenancy', 'Operating System', 'CapacityStatus', 'Pre Installed S/W', 'operation', 'PricePerUnit', 'Currency', 'Unit'] as const;

/** Linux or Windows (licence included) for an on-demand offer row; null for every other row. */
export function awsRowOs(f: Readonly<Record<(typeof AWS_COLUMNS)[number], string>>): VmPriceOs | null {
  if (f['TermType'] !== 'OnDemand' || f['Tenancy'] !== 'Shared' || f['CapacityStatus'] !== 'Used' || f['Pre Installed S/W'] !== 'NA' || f['Unit'] !== 'Hrs') return null;
  if (f['Operating System'] === 'Linux' && f['operation'] === 'RunInstances') return 'linux';
  if (f['Operating System'] === 'Windows' && f['operation'] === 'RunInstances:0002') return 'windows';
  return null;
}

async function* streamLines(resp: Response): AsyncGenerator<string> {
  if (!resp.body) {
    const text = await resp.text();
    for (const l of text.split(/\r?\n/)) yield l;
    return;
  }
  const decoder = new TextDecoder();
  let rest = '';
  const reader = resp.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
    let nl = rest.indexOf('\n');
    let start = 0;
    while (nl !== -1) {
      yield rest.slice(start, nl).replace(/\r$/, '');
      start = nl + 1;
      nl = rest.indexOf('\n', start);
    }
    rest = rest.slice(start);
  }
  rest += decoder.decode();
  if (rest.length > 0) yield rest.replace(/\r$/, '');
}

export async function fetchAwsVmPrices(opts: VmPriceFetchOptions = {}): Promise<VmPriceFetchResult> {
  const region = opts.region ?? VM_PRICE_TARGETS.aws.region;
  const skus = opts.skus ?? VM_PRICE_TARGETS.aws.skus;
  const timeoutMs = opts.timeoutMs ?? VM_PRICE_FETCH_TIMEOUT_MS;
  const url = `${trimBase(opts.baseUrl ?? AWS_PRICE_LIST_BULK_API)}/offers/v1.0/aws/AmazonEC2/current/${region}/index.csv`;
  const resp = await get('aws', url, timeoutMs);

  const skuTokens = skus.map((s) => `"${s}"`);
  let published: string | null = null;
  let col: Record<string, number> | null = null;
  const found = new Map<string, { price: number; currency: string }>();
  let currency = 'USD';
  try {
    for await (const line of streamLines(resp)) {
      if (!col) {
        if (line.startsWith('"Publication Date"')) {
          const m = /(\d{4}-\d{2}-\d{2})/.exec(line);
          published = m ? m[1]! : null;
        } else if (line.startsWith('"SKU",')) {
          const header = parseCsvLine(line);
          col = Object.fromEntries(header.map((h, i) => [h, i]));
          const absent = AWS_COLUMNS.filter((c) => col![c] === undefined);
          if (absent.length > 0) throw new VmPriceFetchError('aws', url, `offer file header lacks ${absent.join(', ')}`);
        }
        continue;
      }
      // Cheap pre-filter before CSV parsing: on-demand rows of a requested size.
      if (!line.includes('"OnDemand"') || !line.includes('"Shared"') || !skuTokens.some((t) => line.includes(t))) continue;
      const cells = parseCsvLine(line);
      const f = Object.fromEntries(AWS_COLUMNS.map((c) => [c, cells[col![c]!] ?? ''])) as Record<(typeof AWS_COLUMNS)[number], string>;
      const os = awsRowOs(f);
      const sku = f['Instance Type'];
      if (!os || !skus.includes(sku)) continue;
      const price = Number(f['PricePerUnit']);
      if (!(price > 0)) continue;
      found.set(`${sku}/${os}`, { price, currency: f['Currency'] || 'USD' });
      currency = f['Currency'] || currency;
    }
  } catch (e) {
    if (e instanceof VmPriceFetchError) throw e;
    const err = e as Error;
    const detail = err.name === 'TimeoutError' || err.name === 'AbortError' ? `download not finished within ${timeoutMs} ms` : err.message;
    throw new VmPriceFetchError('aws', url, detail);
  }
  if (!col) throw new VmPriceFetchError('aws', url, 'not an AWS offer file (no "SKU" header row)');

  const rows: VmPriceRow[] = [];
  for (const sku of skus) for (const os of VM_PRICE_OS) {
    const v = found.get(`${sku}/${os}`);
    if (v) rows.push({ provider: 'aws', sku, os, region, currency: v.currency, price_per_hour: Math.round(v.price * 1e6) / 1e6 });
  }
  return {
    source: { provider: 'aws', api: 'AWS Price List bulk API (AmazonEC2 offer file)', url, region, currency, retrieved: opts.today ?? todayUtc(), published },
    rows,
    missing: missingPairs(skus, rows),
  };
}

// ---------------------------------------------------------------------------
// Table assembly
// ---------------------------------------------------------------------------

export const VM_PRICE_TABLE_NAME = 'VM price table for the service cost model';
export const VM_PRICE_TYPE = 'on-demand pay-as-you-go list price per hour; Windows with the licence included';

/**
 * Build the price table from fresh fetch results. Providers not refreshed in
 * this run keep their rows and source from `previous` (for example when only
 * `--provider azure` ran, or when the AWS fetch failed).
 */
export function buildVmPriceTable(
  fresh: readonly VmPriceFetchResult[],
  opts: { today: string; previous?: VmPriceTable | null; hoursPerMonth?: number },
): VmPriceTable {
  const refreshed = new Set(fresh.map((f) => f.source.provider));
  const keep = opts.previous
    ? { sources: opts.previous.meta.sources.filter((s) => !refreshed.has(s.provider)), rows: opts.previous.prices.filter((p) => !refreshed.has(p.provider)) }
    : { sources: [], rows: [] };
  const order = (p: VmPriceProvider) => (p === 'azure' ? 0 : 1);
  const sources = [...keep.sources, ...fresh.map((f) => f.source)].sort((a, b) => order(a.provider) - order(b.provider));
  const prices = [...keep.rows, ...fresh.flatMap((f) => f.rows)].sort((a, b) => {
    if (a.provider !== b.provider) return order(a.provider) - order(b.provider);
    const skus = VM_PRICE_TARGETS[a.provider].skus;
    const ia = skus.indexOf(a.sku); const ib = skus.indexOf(b.sku);
    if (ia !== ib) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib) || a.sku.localeCompare(b.sku);
    return a.os.localeCompare(b.os);
  });
  return {
    meta: {
      schema_version: '1.0',
      name: VM_PRICE_TABLE_NAME,
      generated_at: opts.today,
      hours_per_month: opts.hoursPerMonth ?? opts.previous?.meta.hours_per_month ?? 730,
      price_type: VM_PRICE_TYPE,
      sources,
    },
    prices,
  };
}
