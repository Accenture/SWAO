// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- shared geography model
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Shared LZ geography model (#3281, owner decision Design 110 D-16).
//
// A configured target such as `azure:Europe` names a geography, not a region
// id of the provider catalogue. One model applies identically to EVERY LZ
// catalogue (aws, aws-esc, aws-iso-e, azure, azure-local, gcp, stackit,
// delos, otc, oci and any workspace catalogue):
//
// 1. Vocabulary: the geographies below, each with its accepted spellings
//    (matching ignores case and non-alphanumeric characters).
// 2. Tagging: a region belongs to a geography when its
//    `sovereignty.residency_country` (fallback: the region `country`) is in
//    the geography's country list. Nothing is hand-picked per provider. A
//    region with an UNKNOWN, OPERATOR_SITE (the operator-site regions of
//    azure-local, #3287) or omitted residency country belongs to no geography.
// 3. Resolution: a region id of the catalogue always wins (`delos:de` stays
//    the Delos region `de`); a geography is tried only when the value is not
//    a region id.
// 4. Default region, the same rule for every provider: among the provider's
//    regions in the geography, prefer residency country DE (SWAO's German
//    sovereign context), then the region with the most catalogue services,
//    then the lowest region id.
// 5. A value that is neither a region id nor a geography with a tagged region
//    stays a skipped target with the valid-region hint (#3223).
//
// The quality rule `geography-coverage` (quality.ts) checks every catalogue
// against this model: a residency country outside the country table is an
// error, so the table is extended rather than a provider being special-cased.
//
// This file has no imports so the audit gate can load it by type stripping.

export interface LzGeography {
  id: string;
  /** Accepted spellings, normalised (lower case, alphanumerics only). */
  aliases: readonly string[];
  /** ISO 3166-1 alpha-2 residency countries (plus `EU` for EU-wide residency). */
  countries: readonly string[];
}

const EU27 = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU',
  'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
] as const;

/** The shared geography vocabulary. Order matters only for documentation.
 *  ADR-0068 (#3379): `europe` means the 27 EU member states (the EU-wide `EU`
 *  residency marker is kept so EU-scoped regions stay covered). The separate
 *  `eu` geography is removed; `eu` is a deprecated alias of `europe` (same set).
 *  Switzerland, the United Kingdom, Norway, Iceland and Liechtenstein are their
 *  own countries, not part of `europe`. */
export const LZ_GEOGRAPHIES: readonly LzGeography[] = [
  { id: 'germany', aliases: ['germany', 'de', 'deutschland'], countries: ['DE'] },
  { id: 'europe', aliases: ['europe', 'eu', 'europeanunion'], countries: [...EU27, 'EU'] },
  { id: 'switzerland', aliases: ['switzerland', 'ch', 'schweiz', 'suisse'], countries: ['CH'] },
  { id: 'united-kingdom', aliases: ['unitedkingdom', 'uk', 'gb', 'greatbritain'], countries: ['GB'] },
  { id: 'norway', aliases: ['norway', 'no', 'norge'], countries: ['NO'] },
  { id: 'iceland', aliases: ['iceland', 'is'], countries: ['IS'] },
  { id: 'liechtenstein', aliases: ['liechtenstein', 'li'], countries: ['LI'] },
  { id: 'north-america', aliases: ['northamerica'], countries: ['US', 'CA', 'MX'] },
  { id: 'south-america', aliases: ['southamerica', 'latam', 'latinamerica'], countries: ['BR', 'CL', 'AR', 'CO', 'PE', 'UY'] },
  { id: 'asia-pacific', aliases: ['asiapacific', 'apac'], countries: ['AU', 'NZ', 'JP', 'KR', 'CN', 'HK', 'TW', 'SG', 'MY', 'ID', 'IN', 'TH', 'PH', 'VN'] },
  { id: 'middle-east', aliases: ['middleeast'], countries: ['AE', 'BH', 'IL', 'QA', 'SA', 'KW', 'OM', 'JO'] },
  { id: 'africa', aliases: ['africa'], countries: ['ZA', 'EG', 'KE', 'NG', 'MA'] },
];

/** Residency country preferred by the default-region rule. */
export const LZ_GEOGRAPHY_PREFERRED_COUNTRY = 'DE';

/** geography id -> countries (the shape quality.ts takes for `geography-coverage`). */
export const LZ_GEOGRAPHY_COUNTRIES: Readonly<Record<string, readonly string[]>> =
  Object.fromEntries(LZ_GEOGRAPHIES.map((g) => [g.id, g.countries]));

/** The minimal region shape the model reads (catalogue regions satisfy it). */
export interface LzGeographyRegion {
  id: string;
  country?: string;
  sovereignty?: { residency_country?: string };
  services?: readonly unknown[];
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Residency values that name no country (#3287 adds the operator-site sentinel). */
const NO_COUNTRY_RESIDENCY = new Set(['UNKNOWN', 'OPERATOR_SITE']);

/** Residency country of a region (UNKNOWN / OPERATOR_SITE / omitted -> undefined). */
export function lzRegionResidency(region: LzGeographyRegion): string | undefined {
  const c = region.sovereignty?.residency_country ?? region.country;
  return typeof c === 'string' && c.trim() !== '' && !NO_COUNTRY_RESIDENCY.has(c.toUpperCase()) ? c.toUpperCase() : undefined;
}

/** Geography ids a region belongs to. */
export function lzRegionGeographies(region: LzGeographyRegion): string[] {
  const c = lzRegionResidency(region);
  return c ? LZ_GEOGRAPHIES.filter((g) => g.countries.includes(c)).map((g) => g.id) : [];
}

/** Geography id for a configured value (`Europe` -> `europe`), or undefined. */
export function lzGeographyKey(value: string): string | undefined {
  const n = norm(value);
  if (!n) return undefined;
  return LZ_GEOGRAPHIES.find((g) => g.aliases.includes(n))?.id;
}

/** ADR-0068 (#3379): deprecated geography spellings mapped to their replacement. */
export const LZ_DEPRECATED_GEOGRAPHY_ALIASES: Readonly<Record<string, string>> = { eu: 'europe', europeanunion: 'europe' };

/** When `value` is a deprecated geography alias, the alias and its replacement id; else null. */
export function lzDeprecatedGeographyAlias(value: string): { alias: string; replacement: string } | null {
  const n = norm(value);
  const replacement = LZ_DEPRECATED_GEOGRAPHY_ALIASES[n];
  return replacement ? { alias: n, replacement } : null;
}

/** Default region of a geography among `regions` (rule 4), or undefined when none is tagged. */
export function lzGeographyDefaultRegion(geography: string, regions: readonly LzGeographyRegion[]): string | undefined {
  const candidates = regions.filter((r) => lzRegionGeographies(r).includes(geography));
  candidates.sort((a, b) =>
    Number(lzRegionResidency(b) === LZ_GEOGRAPHY_PREFERRED_COUNTRY) - Number(lzRegionResidency(a) === LZ_GEOGRAPHY_PREFERRED_COUNTRY)
    || (b.services?.length ?? 0) - (a.services?.length ?? 0)
    || a.id.localeCompare(b.id));
  return candidates[0]?.id;
}

export type LzGeographyResolution =
  | { kind: 'region'; region: string }
  | { kind: 'geography'; region: string; geography: string; requested: string }
  | { kind: 'unknown'; region: string };

/**
 * Resolve a configured region value against one provider catalogue's regions.
 * Identical for every provider (the provider id plays no part).
 * - `region`: the value is a region id (or no regions are known).
 * - `geography`: the value is a geography with at least one tagged region;
 *   `region` is its default region (rule 4).
 * - `unknown`: neither; the fit skips the target with the valid-region hint.
 */
export function resolveLzGeography(value: string, regions: readonly LzGeographyRegion[]): LzGeographyResolution {
  if (regions.length === 0 || regions.some((r) => r.id === value)) return { kind: 'region', region: value };
  const geography = lzGeographyKey(value);
  const region = geography ? lzGeographyDefaultRegion(geography, regions) : undefined;
  if (geography && region) return { kind: 'geography', region, geography, requested: value };
  return { kind: 'unknown', region: value };
}
