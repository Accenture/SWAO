// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { z } from 'zod';

/**
 * VM price table for the service cost model (#3288, Design 110 D-23).
 *
 * One JSON file, `prices/vm-prices.json`, next to the LZ catalogues:
 *   - bundled:   swao/lz-catalogues/prices/vm-prices.json (copied into the
 *                binary bundle by build-lib as _lz-catalogues/prices/)
 *   - workspace: wsp/inputs/catalogs/lz-catalogues/prices/vm-prices.json,
 *                written by `swao lz catalogue update`; preferred over the
 *                bundled table by the cost model.
 *
 * Every price is an on-demand (pay-as-you-go) list price per hour for one
 * provider, VM size, operating system and region, from the provider's public
 * price API (Azure Retail Prices API, AWS Price List bulk API). The sources
 * block records the API, the URL, the retrieval date and (AWS) the
 * publication date of the offer file.
 *
 * The prices folder has no index.json on purpose: the LZ catalogue loader
 * treats a subfolder with an index.json as a provider catalogue.
 *
 * This file imports only zod and uses erasable syntax only: the LZ catalogue
 * quality gate loads it from source through Node's type stripping.
 */

/** Price table path relative to an LZ catalogue folder. */
export const VM_PRICE_TABLE_FILE = 'prices/vm-prices.json';

export const VM_PRICE_PROVIDERS = ['azure', 'aws'] as const;
export type VmPriceProvider = (typeof VM_PRICE_PROVIDERS)[number];

export const VM_PRICE_OS = ['linux', 'windows'] as const;
export type VmPriceOs = (typeof VM_PRICE_OS)[number];

/**
 * VM sizes and regions the service cost model prices (Design 103 §4.3).
 * The price fetchers request exactly these, so the table stays small.
 * Azure sizes are ARM SKU names without the `Standard_` prefix.
 */
export const VM_PRICE_TARGETS: Readonly<Record<VmPriceProvider, { region: string; skus: readonly string[] }>> = {
  azure: {
    region: 'germanywestcentral',
    skus: [
      'B1s', 'B1ms', 'B2s', 'B2ms', 'B4ms',
      'D2s_v3', 'D4s_v3', 'D8s_v3', 'D16s_v3', 'D32s_v3', 'D64s_v3',
      'E4s_v3', 'E8s_v3', 'E16s_v3', 'E32s_v3', 'E64s_v3',
    ],
  },
  aws: {
    region: 'eu-central-1',
    skus: [
      't3.micro', 't3.small', 't3.medium', 't3.large', 't3.xlarge', 't3.2xlarge',
      'm5.large', 'm5.xlarge', 'm5.2xlarge', 'm5.4xlarge', 'm5.8xlarge', 'm5.16xlarge',
      'r5.large', 'r5.xlarge', 'r5.2xlarge', 'r5.4xlarge', 'r5.8xlarge', 'r5.16xlarge',
    ],
  },
};

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const Currency = z.string().regex(/^[A-Z]{3}$/, 'expected an ISO 4217 code');

export const VmPriceSourceSchema = z.object({
  provider: z.enum(VM_PRICE_PROVIDERS),
  /** Human-readable API name, for example "Azure Retail Prices API". */
  api: z.string().min(1),
  /** URL the prices were read from (GET, no credentials). */
  url: z.string().url(),
  region: z.string().min(1),
  currency: Currency,
  /** Date SWAO read the prices. */
  retrieved: IsoDate,
  /** Publication date of the source, when the API states one (AWS offer file). */
  published: IsoDate.nullable(),
}).strict();
export type VmPriceSource = z.infer<typeof VmPriceSourceSchema>;

export const VmPriceRowSchema = z.object({
  provider: z.enum(VM_PRICE_PROVIDERS),
  sku: z.string().min(1),
  os: z.enum(VM_PRICE_OS),
  region: z.string().min(1),
  currency: Currency,
  /** On-demand list price per hour, licence included for Windows. */
  price_per_hour: z.number().positive(),
}).strict();
export type VmPriceRow = z.infer<typeof VmPriceRowSchema>;

export const VmPriceTableSchema = z.object({
  meta: z.object({
    schema_version: z.literal('1.0'),
    name: z.string().min(1),
    generated_at: IsoDate,
    hours_per_month: z.number().positive(),
    price_type: z.string().min(1),
    sources: z.array(VmPriceSourceSchema).min(1),
  }).strict(),
  prices: z.array(VmPriceRowSchema),
}).strict().superRefine((t, ctx) => {
  const seen = new Set<string>();
  t.prices.forEach((p, i) => {
    const key = `${p.provider}/${p.sku}/${p.os}/${p.region}`;
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['prices', i], message: `duplicate price row ${key}` });
    seen.add(key);
    const src = t.meta.sources.find((s) => s.provider === p.provider && s.region === p.region);
    if (!src) ctx.addIssue({ code: 'custom', path: ['prices', i], message: `no source for ${p.provider} region ${p.region}` });
    else if (src.currency !== p.currency) ctx.addIssue({ code: 'custom', path: ['prices', i], message: `currency ${p.currency} differs from the source currency ${src.currency}` });
  });
});
export type VmPriceTable = z.infer<typeof VmPriceTableSchema>;

export function safeParseVmPriceTable(
  raw: unknown,
): { ok: true; table: VmPriceTable } | { ok: false; issues: string[] } {
  const r = VmPriceTableSchema.safeParse(raw);
  if (r.success) return { ok: true, table: r.data };
  return { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

/** The price row for one provider, size and OS (any region in the table), or undefined. */
export function findVmPrice(table: VmPriceTable, provider: VmPriceProvider, sku: string, os: VmPriceOs): VmPriceRow | undefined {
  return table.prices.find((p) => p.provider === provider && p.sku === sku && p.os === os);
}
