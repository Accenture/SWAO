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
 * Lift-and-shift cloud cost estimate (Design 103 §4.3, #3109).
 *
 * Reporting currency is EUR by default. A workspace may choose another
 * currency in its `.swao.yml`:
 *
 *   service_portfolio:
 *     cost:
 *       currency: CHF            # ISO 4217 code, default EUR
 *       exchange_rates:          # units of the currency per 1 EUR
 *         CHF: 0.94
 *         USD: 1.12              # overrides the bundled ECB reference rate
 *
 * Size selection: the cheapest general-purpose size (Azure D/E v3, AWS m5/r5)
 * with at least the requested vCPU and memory, at the price for the server's
 * OS; burstable sizes (Azure B, AWS t3) only for single-vCPU servers. When
 * nothing is large enough, the largest size is returned with a custom-size
 * note.
 *
 * Prices (#3288, Design 110 D-23) come from the VM price table (price-table.ts):
 * on-demand list prices per hour from the Azure Retail Prices API and the AWS
 * Price List API, one Linux and one Windows (licence included) price per size.
 * - `windows_priced_as_linux` is set only when a Windows server's size has no
 *   Windows price in the table and the Linux price stands in.
 * - `provider_parity_assumed` is set only when one provider has no price for
 *   its size; that provider's estimate then takes the other provider's price.
 * Equal sourced prices are not an assumption: Azure D/E v3 and AWS m5/r5 list
 * prices are in fact equal in the bundled regions (retrieved 2026-10-17).
 */

import { z } from 'zod';
import { findVmPrice, type VmPriceOs, type VmPriceTable } from '@swao/core';
import { ECB_REFERENCE, PRICE_BASIS, VM_SKUS, type VmSku } from './vm-sku-table.js';
import { loadPriceTable, type LoadedPriceTable } from './price-table.js';

export const COST_NOTE = 'Estimate only - excludes storage, licensing, and network';

/** #3242/#3288: a Windows server's size has no Windows price in the table, so the Linux price stands in. */
export const WINDOWS_LINUX_PRICED_NOTE =
  'Windows Server priced at Linux rates because the price table has no Windows price for this size: the Windows Server licence (licence-included compute or BYOL) is not included, so this estimate is low for a Windows server';

/** #3288: one provider has no price for its size, so the other provider's price stands in. */
export const PROVIDER_PARITY_NOTE =
  "One provider has no price for this size in the price table, so its estimate takes the other provider's price; provider parity is an assumption for this server";

/** #3288: no price table was found (neither workspace nor bundled), or it has no price for either size. */
export const NO_PRICE_TABLE_NOTE =
  'No VM price available; run `swao lz catalogue update` to fetch prices from the provider price APIs';

const WINDOWS_OS = /\bwindows\b/i;

/** True when the server runs Windows (INFRA-CAT os_class or the intake OS text). */
export function isWindowsServer(osClass: string | null | undefined, os: string | null | undefined): boolean {
  return osClass === 'INFRA_PLATFORM_OS_WINDOWS_SERVER' || WINDOWS_OS.test(os ?? '');
}

export const CostOptionsSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/).default('EUR'),
  exchange_rates: z.record(z.string().regex(/^[A-Z]{3}$/), z.number().positive()).default({}),
}).strict();
export type CostOptionsInput = z.input<typeof CostOptionsSchema>;

export interface CostOptions {
  currency: string;
  /** Units of each currency per 1 EUR; always includes EUR and USD. */
  ratesPerEur: Record<string, number>;
  rateSource: string;
  /** #3288: VM price table (workspace copy preferred over the bundled one); null when none was found. */
  prices: LoadedPriceTable | null;
}

export class CostOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CostOptionsError';
  }
}

/**
 * Resolve the reporting currency and the VM price table. `workspacePath`
 * selects the workspace price table when it exists; `prices` injects a table
 * (tests) and wins over both.
 */
export function resolveCostOptions(
  raw?: unknown,
  ctx: { workspacePath?: string; prices?: LoadedPriceTable | null } = {},
): CostOptions {
  const parsed = CostOptionsSchema.safeParse(raw ?? {});
  if (!parsed.success) throw new CostOptionsError(`invalid service_portfolio.cost: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const ratesPerEur: Record<string, number> = { EUR: 1, USD: ECB_REFERENCE.usd_per_eur, ...parsed.data.exchange_rates };
  const custom = Object.keys(parsed.data.exchange_rates).length > 0;
  if (!(parsed.data.currency in ratesPerEur)) {
    throw new CostOptionsError(`service_portfolio.cost.currency ${parsed.data.currency} has no exchange rate; add exchange_rates.${parsed.data.currency} (units per 1 EUR)`);
  }
  const prices = ctx.prices !== undefined ? ctx.prices : loadPriceTable(ctx.workspacePath ? { workspacePath: ctx.workspacePath } : {});
  for (const c of new Set(prices?.table.prices.map((p) => p.currency) ?? [])) {
    if (!(c in ratesPerEur)) throw new CostOptionsError(`the VM price table lists prices in ${c}; add service_portfolio.cost.exchange_rates.${c} (units per 1 EUR)`);
  }
  return {
    currency: parsed.data.currency,
    ratesPerEur,
    rateSource: custom ? 'workspace .swao.yml service_portfolio.cost.exchange_rates' : `ECB euro reference rate ${ECB_REFERENCE.date}`,
    prices,
  };
}

export interface SizedSku {
  sku: string;
  vcpu: number;
  memory_gb: number;
  monthly: number;
  custom_size_needed: boolean;
  /** #3288: OS of the price used for this provider. */
  price_os: VmPriceOs;
  /** #3288: set when this provider had no price for the size and took the other provider's price. */
  price_from_provider?: VmSku['provider'];
}

export interface CostBlock {
  currency: string;
  azure: SizedSku | null;
  aws: SizedSku | null;
  /** Lower of the two provider estimates, in `currency`. */
  monthly_estimate: number | null;
  basis: string;
  exchange_rate: { base: 'EUR'; currency: string; rate: number; source: string };
  note: string;
  skipped_reason?: 'server_inactive' | 'hardware_unknown' | 'prices_unavailable';
  /** OS the prices are for: `windows` only when both providers were priced with a Windows price. */
  price_os: VmPriceOs;
  /** #3288: true only when a Windows server's size had no Windows price and the Linux price stood in. */
  windows_priced_as_linux?: boolean;
  /** #3288: true only when one provider had no price for its size and took the other provider's price. */
  provider_parity_assumed?: boolean;
}

const BURSTABLE = /^(B\d|t3\.)/;
const round2 = (n: number) => Math.round(n * 100) / 100;

interface Priced { price: number; currency: string; os: VmPriceOs }

/** Price for one size: the OS price, else (Windows only) the Linux price; undefined when the table has neither. */
function priceOf(table: VmPriceTable | null, provider: VmSku['provider'], sku: string, os: VmPriceOs): Priced | undefined {
  if (!table) return undefined;
  const row = findVmPrice(table, provider, sku, os) ?? (os === 'windows' ? findVmPrice(table, provider, sku, 'linux') : undefined);
  return row ? { price: row.price_per_hour, currency: row.currency, os: row.os } : undefined;
}

/**
 * Cheapest size with at least `vcpu` and `memoryGb`, at the price for `os`.
 * Sizes without a price sort after priced ones (smallest first). Without a
 * price table the smallest fitting size is returned.
 */
export function selectSku(
  provider: VmSku['provider'],
  vcpu: number,
  memoryGb: number,
  opts: { table?: VmPriceTable | null; os?: VmPriceOs } = {},
): { sku: VmSku; custom: boolean } {
  const os = opts.os ?? 'linux';
  const pool = VM_SKUS.filter((s) => s.provider === provider && (vcpu <= 1 || !BURSTABLE.test(s.sku)));
  const cost = (s: VmSku) => priceOf(opts.table ?? null, provider, s.sku, os)?.price ?? Number.POSITIVE_INFINITY;
  const fits = pool.filter((s) => s.vcpu >= vcpu && s.memory_gb >= memoryGb)
    .sort((a, b) => (cost(a) === cost(b) ? 0 : cost(a) < cost(b) ? -1 : 1) || a.vcpu - b.vcpu || a.memory_gb - b.memory_gb);
  if (fits[0]) return { sku: fits[0], custom: false };
  const largest = [...pool].sort((a, b) => b.vcpu - a.vcpu || b.memory_gb - a.memory_gb)[0] as VmSku;
  return { sku: largest, custom: true };
}

/** Hourly price in `currency` -> monthly amount in the target currency. */
function monthly(pricePerHour: number, currency: string, hours: number, opts: CostOptions, target = opts.currency): number {
  const eur = (pricePerHour * hours) / (opts.ratesPerEur[currency] as number);
  return round2(eur * (opts.ratesPerEur[target] as number));
}

function basisText(opts: CostOptions, windows: boolean): string {
  const loaded = opts.prices;
  if (!loaded) return `No VM price table, ${PRICE_BASIS.hours_per_month} h/month`;
  const src = (p: VmSku['provider'], label: string) => {
    const s = loaded.table.meta.sources.find((x) => x.provider === p);
    return s ? `${label} ${s.region} (${s.api}, retrieved ${s.retrieved})` : `${label} (no price source)`;
  };
  return `${windows ? 'Windows (licence included)' : 'Linux'} pay-as-you-go list prices, ${src('azure', 'Azure')} / ${src('aws', 'AWS')}, ${loaded.table.meta.hours_per_month} h/month, ${loaded.origin} price table`;
}

export function estimateCost(
  input: { cpu_cores: number | null | undefined; memory_mb: number | null | undefined; operational_status?: string | null; os_class?: string | null; os?: string | null },
  opts: CostOptions = resolveCostOptions(),
): { cost: CostBlock; eurMonthly: number | null } {
  const windows = isWindowsServer(input.os_class, input.os);
  const os: VmPriceOs = windows ? 'windows' : 'linux';
  const table = opts.prices?.table ?? null;
  const hours = table?.meta.hours_per_month ?? PRICE_BASIS.hours_per_month;
  const base = {
    currency: opts.currency,
    basis: basisText(opts, windows),
    exchange_rate: { base: 'EUR' as const, currency: opts.currency, rate: opts.ratesPerEur[opts.currency] as number, source: opts.rateSource },
    note: COST_NOTE,
    price_os: os,
  };
  if (['decommissioned', 'unused', 'inactive'].includes(input.operational_status ?? '')) {
    return { cost: { ...base, azure: null, aws: null, monthly_estimate: null, skipped_reason: 'server_inactive' }, eurMonthly: null };
  }
  const vcpu = input.cpu_cores ?? 0;
  const memGb = (input.memory_mb ?? 0) / 1024;
  if (!(vcpu > 0) || !(memGb > 0)) {
    return { cost: { ...base, azure: null, aws: null, monthly_estimate: null, skipped_reason: 'hardware_unknown' }, eurMonthly: null };
  }

  const pick = (p: VmSku['provider']) => {
    const { sku, custom } = selectSku(p, vcpu, memGb, { table, os });
    return { sku, custom, priced: priceOf(table, p, sku.sku, os) };
  };
  const az = pick('azure');
  const aw = pick('aws');
  const azPrice = az.priced ?? aw.priced;
  const awPrice = aw.priced ?? az.priced;
  if (!azPrice || !awPrice) {
    return {
      cost: { ...base, note: [COST_NOTE, NO_PRICE_TABLE_NOTE].join('; '), azure: null, aws: null, monthly_estimate: null, skipped_reason: 'prices_unavailable' },
      eurMonthly: null,
    };
  }
  // #3288: a provider without a price for its size takes the other provider's price.
  const sized = (s: typeof az, price: Priced, other: VmSku['provider']): SizedSku => ({
    sku: s.sku.sku, vcpu: s.sku.vcpu, memory_gb: s.sku.memory_gb,
    monthly: monthly(price.price, price.currency, hours, opts),
    custom_size_needed: s.custom,
    price_os: price.os,
    ...(s.priced ? {} : { price_from_provider: other }),
  });
  const azure = sized(az, azPrice, 'aws');
  const aws = sized(aw, awPrice, 'azure');
  const cheapest = Math.min(azure.monthly, aws.monthly);
  const eurMonthly = Math.min(monthly(azPrice.price, azPrice.currency, hours, opts, 'EUR'), monthly(awPrice.price, awPrice.currency, hours, opts, 'EUR'));
  const windowsAsLinux = windows && (azPrice.os === 'linux' || awPrice.os === 'linux');
  const parity = !az.priced || !aw.priced;
  const notes = [
    COST_NOTE,
    ...(azure.custom_size_needed || aws.custom_size_needed ? ['requested size exceeds the table; largest listed size shown, custom sizing needed'] : []),
    ...(windowsAsLinux ? [WINDOWS_LINUX_PRICED_NOTE] : []),
    ...(parity ? [PROVIDER_PARITY_NOTE] : []),
  ];
  return {
    cost: {
      ...base,
      price_os: windows && !windowsAsLinux ? 'windows' : 'linux',
      note: notes.join('; '),
      azure,
      aws,
      monthly_estimate: cheapest,
      ...(windowsAsLinux ? { windows_priced_as_linux: true } : {}),
      ...(parity ? { provider_parity_assumed: true } : {}),
    },
    eurMonthly,
  };
}
