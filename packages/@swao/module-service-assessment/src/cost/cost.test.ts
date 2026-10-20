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

// Phase 6 suite (#3108-#3110): hardware parsing and the cloud cost model.
import { describe, it, expect } from 'vitest';
import { loadInfraCatalogue } from '../catalog/infra-cat.js';
import { parseCapacity } from '../intake/cell.js';
import { parseIntakeSheets, type SheetLike } from '../intake/parser.js';
import { planScaffold } from '../scaffold/plan.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VM_PRICE_TARGETS, type VmPriceTable } from '@swao/core';
import { CostOptionsError, estimateCost, isWindowsServer, resolveCostOptions, NO_PRICE_TABLE_NOTE, PROVIDER_PARITY_NOTE, WINDOWS_LINUX_PRICED_NOTE } from './cost-model.js';
import { loadPriceTable, PriceTableError, resolveBundledPriceTablePath, workspacePriceTablePath } from './price-table.js';
import { VM_SKUS } from './vm-sku-table.js';

const hw = (cpu_cores: number, memory_mb: number, operational_status = 'active') => ({ cpu_cores, memory_mb, operational_status });

describe('cost model (#3109, #3110)', () => {
  it('maps 4 vCPU + 8192 MB to Azure D4s_v3 and AWS m5.xlarge, priced in EUR by default', () => {
    const { cost, eurMonthly } = estimateCost(hw(4, 8192));
    expect(cost).toMatchObject({ currency: 'EUR', azure: { sku: 'D4s_v3', vcpu: 4, memory_gb: 16 }, aws: { sku: 'm5.xlarge' } });
    // 0.23 USD/h * 730 h / 1.1206 USD per EUR
    expect(cost.azure!.monthly).toBe(149.83);
    expect(cost.monthly_estimate).toBe(149.83);
    expect(eurMonthly).toBe(149.83);
    expect(cost.note).toMatch(/^Estimate only - excludes storage, licensing, and network/);
    expect(cost.exchange_rate).toEqual({ base: 'EUR', currency: 'EUR', rate: 1, source: 'ECB euro reference rate 2026-10-09' });
  });

  it('reports USD when configured, within the plausible 100-300 USD range', () => {
    const { cost, eurMonthly } = estimateCost(hw(4, 8192), resolveCostOptions({ currency: 'USD' }));
    expect(cost.currency).toBe('USD');
    expect(cost.azure!.monthly).toBe(167.9);
    expect(cost.azure!.monthly).toBeGreaterThanOrEqual(100);
    expect(cost.azure!.monthly).toBeLessThanOrEqual(300);
    expect(eurMonthly).toBe(149.83);
  });

  it('supports another currency with a workspace exchange rate, and rejects a currency without one', () => {
    const { cost } = estimateCost(hw(4, 8192), resolveCostOptions({ currency: 'CHF', exchange_rates: { CHF: 0.94 } }));
    expect(cost).toMatchObject({ currency: 'CHF', exchange_rate: { rate: 0.94, source: 'workspace .swao.yml service_portfolio.cost.exchange_rates' } });
    expect(cost.azure!.monthly).toBe(140.84);
    expect(() => resolveCostOptions({ currency: 'GBP' })).toThrow(CostOptionsError);
    expect(() => resolveCostOptions({ currency: 'euro' })).toThrow(CostOptionsError);
  });

  it('picks the smallest size for 1 vCPU + 512 MB (no oversize)', () => {
    const { cost } = estimateCost(hw(1, 512));
    expect(cost.azure).toMatchObject({ sku: 'B1s', custom_size_needed: false });
    expect(cost.aws).toMatchObject({ sku: 't3.micro', custom_size_needed: false });
  });

  it('caps at the largest size with a custom-sizing note for 64 vCPU + 512 GB', () => {
    const { cost } = estimateCost(hw(64, 512 * 1024));
    expect(cost.azure).toMatchObject({ sku: 'E64s_v3', custom_size_needed: true });
    expect(cost.aws).toMatchObject({ sku: 'r5.16xlarge', custom_size_needed: false });
    expect(cost.note).toMatch(/custom sizing needed/);
  });

  it('uses general-purpose sizes, not burstable ones, for multi-vCPU servers', () => {
    expect(estimateCost(hw(2, 4096)).cost.azure!.sku).toBe('D2s_v3');
  });

  it('skips inactive servers and unknown hardware', () => {
    expect(estimateCost(hw(4, 8192, 'inactive')).cost).toMatchObject({ skipped_reason: 'server_inactive', monthly_estimate: null });
    expect(estimateCost({ cpu_cores: null, memory_mb: 8192 }).cost.skipped_reason).toBe('hardware_unknown');
  });
});

describe('hardware field parsing (#3108)', () => {
  it('converts unit suffixes to the storage unit', () => {
    expect(parseCapacity('16 GB', 'mb')).toBe(16384);
    expect(parseCapacity('512 MiB', 'mb')).toBe(512);
    expect(parseCapacity('1,5 TB', 'gb')).toBe(1536);
    expect(parseCapacity('2048', 'mb')).toBeUndefined();
    expect(parseCapacity('lots GB', 'gb')).toBeUndefined();
  });

  const sheet = (rows: Array<Array<string | number | null>>): SheetLike => {
    const grid: unknown[][] = [['App ID', 'OS', 'CPU Cores', 'Memory (MB)', 'Total Disk (GB)'], ...rows];
    return { name: 'Sheet1', rowCount: grid.length, cell: (r, c) => grid[r - 1]?.[c - 1] ?? null };
  };

  it('reads suffixed memory and disk values from the intake and costs the server', () => {
    const rows = parseIntakeSheets([sheet([['HOSAPP001', 'Windows Server 2019', 4, '8 GB', '1,5 TB']])]).rows;
    expect(rows[0]!.values).toMatchObject({ cpu_cores: 4, memory_mb: 8192, total_disk_gb: 1536 });
    const plan = planScaffold(rows, loadInfraCatalogue());
    const cfg = plan.apps[0]!.config as Record<string, any>;
    // #3288: a Windows server is priced with the Windows (licence included) price: 0.414 USD/h.
    expect(cfg['hardware']).toMatchObject({ memory_mb: 8192, est_cloud_cost_eur_mo: 269.69 });
    expect(cfg['cost']).toMatchObject({ currency: 'EUR', monthly_estimate: 269.69, azure: { sku: 'D4s_v3' }, price_os: 'windows' });
  });

  it('treats zero memory as inactive and skips the cost estimate (G-04)', () => {
    const rows = parseIntakeSheets([sheet([['HOSAPP002', 'Windows Server 2019', 4, 0, 100]])]).rows;
    const cfg = planScaffold(rows, loadInfraCatalogue()).apps[0]!.config as Record<string, any>;
    expect(cfg['disposition']['operational_status']).toBe('inactive');
    expect(cfg['cost']).toMatchObject({ skipped_reason: 'server_inactive' });
    expect(cfg['hardware']['est_cloud_cost_eur_mo']).toBeNull();
  });

  it('warns about non-numeric hardware values without blocking the scaffold', () => {
    const res = parseIntakeSheets([sheet([['HOSAPP003', 'x', 'four', 'lots', 10]])]);
    expect(res.rows).toHaveLength(1);
    expect(res.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^field cpu_cores: 1 of 1 value\(s\) not numeric/), expect.stringMatching(/^field memory_mb: 1 of 1/)]));
  });
});

// #3288 (Design 110 D-23): a small injected table for the branch tests.
const SRC = (provider: 'azure' | 'aws', region: string) => ({ provider, api: `${provider} price API`, url: `https://example.test/${provider}`, region, currency: 'USD', retrieved: '2026-10-17', published: null });
const row = (provider: 'azure' | 'aws', sku: string, os: 'linux' | 'windows', price_per_hour: number) => ({ provider, sku, os, region: provider === 'azure' ? 'germanywestcentral' : 'eu-central-1', currency: 'USD', price_per_hour });
const table = (prices: ReturnType<typeof row>[]): VmPriceTable => ({
  meta: { schema_version: '1.0', name: 'test', generated_at: '2026-10-17', hours_per_month: 730, price_type: 'on-demand', sources: [SRC('azure', 'germanywestcentral'), SRC('aws', 'eu-central-1')] },
  prices,
});
const withTable = (prices: ReturnType<typeof row>[]) => resolveCostOptions(undefined, { prices: { table: table(prices), origin: 'bundled', path: 'test' } });

describe('cost estimate honesty (#3242, #3288)', () => {
  it('prices a Windows server with the Windows (licence included) price from the table', () => {
    const { cost, eurMonthly } = estimateCost({ ...hw(4, 8192), os_class: 'INFRA_PLATFORM_OS_WINDOWS_SERVER' });
    expect(cost).toMatchObject({ price_os: 'windows', azure: { sku: 'D4s_v3', price_os: 'windows', monthly: 269.69 }, aws: { sku: 'm5.xlarge', price_os: 'windows', monthly: 269.69 } });
    expect(cost.windows_priced_as_linux).toBeUndefined();
    expect(cost.basis).toMatch(/^Windows \(licence included\) pay-as-you-go list prices, Azure germanywestcentral \(Azure Retail Prices API, retrieved \d{4}-\d{2}-\d{2}\) \/ AWS eu-central-1 \(AWS Price List bulk API/);
    expect(cost.note).not.toContain(WINDOWS_LINUX_PRICED_NOTE);
    expect(eurMonthly).toBe(269.69);
    // The intake OS text alone is enough when INFRA-CAT did not classify the OS.
    expect(estimateCost({ ...hw(4, 8192), os: 'Windows Server 2016 (64-bit)' }).cost.price_os).toBe('windows');
  });

  it('sets windows_priced_as_linux only when the table has no Windows price for the size', () => {
    const opts = withTable([row('azure', 'D4s_v3', 'linux', 0.23), row('aws', 'm5.xlarge', 'linux', 0.23), row('aws', 'm5.xlarge', 'windows', 0.414)]);
    const { cost } = estimateCost({ ...hw(4, 8192), os: 'Windows Server 2019' }, opts);
    expect(cost).toMatchObject({ price_os: 'linux', windows_priced_as_linux: true, azure: { price_os: 'linux', monthly: 149.83 }, aws: { price_os: 'windows', monthly: 269.69 } });
    expect(cost.note).toContain(WINDOWS_LINUX_PRICED_NOTE);
    expect(cost.provider_parity_assumed).toBeUndefined();
  });

  it('a Linux server carries no Windows caveat', () => {
    const { cost } = estimateCost({ ...hw(4, 8192), os: 'Ubuntu 22.04' });
    expect(cost.windows_priced_as_linux).toBeUndefined();
    expect(cost.price_os).toBe('linux');
    expect(cost.note).not.toContain('Windows');
    expect(isWindowsServer('INFRA_PLATFORM_OS_LINUX_DEBIAN', 'Debian 12')).toBe(false);
  });

  it('equal sourced prices are not an assumption: no parity flag when both providers have a price', () => {
    const equal = estimateCost(hw(4, 8192)).cost;
    expect(equal.azure!.monthly).toBe(equal.aws!.monthly);
    expect(equal.provider_parity_assumed).toBeUndefined();
    expect(equal.note).not.toContain(PROVIDER_PARITY_NOTE);
    const differ = estimateCost(hw(64, 512 * 1024)).cost;
    expect(differ.azure!.monthly).not.toBe(differ.aws!.monthly);
    expect(differ.provider_parity_assumed).toBeUndefined();
  });

  it('sets provider_parity_assumed only when one provider has no price; the other provider price stands in', () => {
    const { cost } = estimateCost(hw(4, 8192), withTable([row('aws', 'm5.xlarge', 'linux', 0.23)]));
    expect(cost).toMatchObject({ provider_parity_assumed: true, azure: { sku: 'D4s_v3', monthly: 149.83, price_from_provider: 'aws' }, aws: { sku: 'm5.xlarge', monthly: 149.83 } });
    expect(cost.aws!.price_from_provider).toBeUndefined();
    expect(cost.note).toContain(PROVIDER_PARITY_NOTE);
  });

  it('size selection follows the OS price: the cheaper Windows size wins', () => {
    // 4 vCPU / 16 GB fits D4s_v3 and E4s_v3; make E4s_v3 cheaper for Windows only.
    const opts = withTable([
      row('azure', 'D4s_v3', 'linux', 0.23), row('azure', 'D4s_v3', 'windows', 0.6),
      row('azure', 'E4s_v3', 'linux', 0.304), row('azure', 'E4s_v3', 'windows', 0.5),
      row('aws', 'm5.xlarge', 'linux', 0.23), row('aws', 'm5.xlarge', 'windows', 0.414),
    ]);
    expect(estimateCost(hw(4, 16384), opts).cost.azure!.sku).toBe('D4s_v3');
    expect(estimateCost({ ...hw(4, 16384), os: 'Windows Server 2022' }, opts).cost.azure).toMatchObject({ sku: 'E4s_v3', monthly: 325.72 });
  });

  it('no price for either provider, or no table at all: no estimate, prices_unavailable', () => {
    const none = estimateCost(hw(4, 8192), resolveCostOptions(undefined, { prices: null })).cost;
    expect(none).toMatchObject({ skipped_reason: 'prices_unavailable', monthly_estimate: null, azure: null, aws: null });
    expect(none.note).toContain(NO_PRICE_TABLE_NOTE);
    expect(estimateCost(hw(4, 8192), withTable([row('azure', 'B1s', 'linux', 0.012)])).cost.skipped_reason).toBe('prices_unavailable');
  });

  it('the scaffold passes the OS through, so a Windows intake row is priced as Windows', () => {
    const rows = parseIntakeSheets([{ name: 'Sheet1', rowCount: 2, cell: (r, c) => ([['App ID', 'OS', 'CPU Cores', 'Memory (MB)'], ['HOSAPP010', 'Windows Server 2019', 2, 8192]] as unknown[][])[r - 1]?.[c - 1] ?? null }]).rows;
    const cfg = planScaffold(rows, loadInfraCatalogue()).apps[0]!.config as Record<string, any>;
    expect(cfg['cost']).toMatchObject({ price_os: 'windows', monthly_estimate: 134.85, azure: { sku: 'D2s_v3' } });
    expect(cfg['cost']['windows_priced_as_linux']).toBeUndefined();
  });
});

describe('VM price table resolution (#3288)', () => {
  it('the bundled table is found and prices every size of the cost model for Linux and Windows', () => {
    expect(resolveBundledPriceTablePath()).not.toBeNull();
    const loaded = loadPriceTable()!;
    expect(loaded.origin).toBe('bundled');
    for (const s of VM_SKUS) {
      for (const os of ['linux', 'windows'] as const) {
        expect(loaded.table.prices.some((p) => p.provider === s.provider && p.sku === s.sku && p.os === os), `${s.provider} ${s.sku} ${os}`).toBe(true);
      }
    }
    expect(loaded.table.meta.sources.map((x) => x.provider).sort()).toEqual(['aws', 'azure']);
  });

  it('the cost model sizes equal the sizes the price fetchers request (VM_PRICE_TARGETS)', () => {
    for (const p of ['azure', 'aws'] as const) {
      expect(VM_SKUS.filter((s) => s.provider === p).map((s) => s.sku).sort()).toEqual([...VM_PRICE_TARGETS[p].skus].sort());
    }
  });

  it('prefers the workspace table written by swao lz catalogue update over the bundled one', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-prices-'));
    try {
      const path = workspacePriceTablePath(ws);
      expect(path.replace(/\\/g, '/')).toMatch(/wsp\/inputs\/catalogs\/lz-catalogues\/prices\/vm-prices\.json$/);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, JSON.stringify(table([row('azure', 'D4s_v3', 'linux', 0.5), row('aws', 'm5.xlarge', 'linux', 0.5)])), 'utf-8');
      const opts = resolveCostOptions(undefined, { workspacePath: ws });
      expect(opts.prices).toMatchObject({ origin: 'workspace' });
      const { cost } = estimateCost(hw(4, 8192), opts);
      expect(cost.azure!.monthly).toBe(325.72);
      expect(cost.basis).toMatch(/workspace price table$/);
      // A broken workspace table is an error, not a silent fallback to the bundled one.
      writeFileSync(path, '{ not json', 'utf-8');
      expect(() => resolveCostOptions(undefined, { workspacePath: ws })).toThrow(PriceTableError);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('a table in a currency without an exchange rate is rejected', () => {
    const t = table([row('azure', 'D4s_v3', 'linux', 0.5)]);
    t.prices[0]!.currency = 'GBP';
    expect(() => resolveCostOptions(undefined, { prices: { table: t, origin: 'bundled', path: 'x' } })).toThrow(/exchange_rates\.GBP/);
  });
});
