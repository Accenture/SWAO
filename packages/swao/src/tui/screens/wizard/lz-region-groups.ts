// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, LZ regions grouped by country
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4494 (owner decision 2026-11-16, Design 123 and Design 126 section 4.2):
// the region pickers list each region of a provider catalogue once, under
// the heading of its residency country; a wider area of the shared geography
// model (Europe, North America, Asia-Pacific, ...) is a heading over its
// countries. There are no separate geography rows any more ("germany,
// default region eu-de" next to "eu-de (DE)"). A heading ticks or unticks
// all its regions; the stored targets are region ids only. A stored
// geography target (otc:germany) is read as the region a run resolves it to
// (resolveLzGeography, the default-region rule), so the picker shows exactly
// what the runs assess; it is rewritten as that region when the step is
// confirmed. Same rule for every catalogue (the provider plays no part).

import {
  LZ_GEOGRAPHIES,
  LZ_GEOGRAPHY_PREFERRED_COUNTRY,
  lzRegionResidency,
  resolveLzGeography,
  type LzGeographyRegion,
} from '@swao/module-landing-zone';

/** Country names of the residency codes of the geography model; an unknown code shows as itself. */
const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  AT: 'Austria', BE: 'Belgium', BG: 'Bulgaria', CY: 'Cyprus', CZ: 'Czechia', DE: 'Germany', DK: 'Denmark', EE: 'Estonia',
  ES: 'Spain', FI: 'Finland', FR: 'France', GR: 'Greece', HR: 'Croatia', HU: 'Hungary', IE: 'Ireland', IT: 'Italy',
  LT: 'Lithuania', LU: 'Luxembourg', LV: 'Latvia', MT: 'Malta', NL: 'Netherlands', PL: 'Poland', PT: 'Portugal', RO: 'Romania',
  SE: 'Sweden', SI: 'Slovenia', SK: 'Slovakia', EU: 'EU-wide', CH: 'Switzerland', GB: 'United Kingdom', NO: 'Norway',
  IS: 'Iceland', LI: 'Liechtenstein', US: 'United States', CA: 'Canada', MX: 'Mexico', BR: 'Brazil', CL: 'Chile',
  AR: 'Argentina', CO: 'Colombia', PE: 'Peru', UY: 'Uruguay', AU: 'Australia', NZ: 'New Zealand', JP: 'Japan',
  KR: 'South Korea', CN: 'China', HK: 'Hong Kong', TW: 'Taiwan', SG: 'Singapore', MY: 'Malaysia', ID: 'Indonesia',
  IN: 'India', TH: 'Thailand', PH: 'Philippines', VN: 'Vietnam', AE: 'United Arab Emirates', BH: 'Bahrain', IL: 'Israel',
  QA: 'Qatar', SA: 'Saudi Arabia', KW: 'Kuwait', OM: 'Oman', JO: 'Jordan', ZA: 'South Africa', EG: 'Egypt', KE: 'Kenya',
  NG: 'Nigeria', MA: 'Morocco',
};

/** Headings of the areas (geographies with more than one country). */
const AREA_NAMES: Readonly<Record<string, string>> = {
  europe: 'Europe', 'north-america': 'North America', 'south-america': 'South America',
  'asia-pacific': 'Asia-Pacific', 'middle-east': 'Middle East', africa: 'Africa',
};

/** The heading of regions without a residency country. */
export const NO_COUNTRY_HEADING = 'Other regions';

export type LzRegionRow =
  | { kind: 'area'; key: string; label: string; regions: readonly string[] }
  | { kind: 'country'; key: string; label: string; regions: readonly string[]; depth: 0 | 1 }
  | { kind: 'region'; key: string; label: string; region: string; depth: 1 | 2 };

export function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

/**
 * The rows of a grouped region picker: area headings (Europe), country
 * headings (Germany, DE) and the regions (sorted by id). Europe first with
 * Germany first in it (the preferred country of the default-region rule),
 * the other countries by name; then the countries that are their own
 * geography, then the other areas in the order of the geography model.
 */
export function groupLzRegions(regions: readonly LzGeographyRegion[]): LzRegionRow[] {
  const byCountry = new Map<string, string[]>();
  for (const r of [...regions].sort((a, b) => a.id.localeCompare(b.id))) {
    const c = lzRegionResidency(r) ?? '';
    const list = byCountry.get(c) ?? [];
    list.push(r.id);
    byCountry.set(c, list);
  }
  const rows: LzRegionRow[] = [];
  const placed = new Set<string>();
  const countryRows = (codes: string[], depth: 0 | 1): LzRegionRow[] => codes
    .sort((a, b) => Number(b === LZ_GEOGRAPHY_PREFERRED_COUNTRY) - Number(a === LZ_GEOGRAPHY_PREFERRED_COUNTRY) || countryName(a).localeCompare(countryName(b)))
    .flatMap((code): LzRegionRow[] => {
      placed.add(code);
      const ids = byCountry.get(code) ?? [];
      return [
        { kind: 'country', key: `country:${code}`, label: code === 'EU' ? countryName(code) : `${countryName(code)} (${code})`, regions: ids, depth },
        ...ids.map((id): LzRegionRow => ({ kind: 'region', key: `region:${id}`, label: id, region: id, depth: depth === 0 ? 1 : 2 })),
      ];
    });
  // Europe first (Germany inside it), then the countries that are their own geography (Switzerland, United Kingdom, ...), then the other areas.
  const rank = (id: string): number => (id === 'europe' ? 0 : AREA_NAMES[id] ? 2 : 1);
  for (const g of [...LZ_GEOGRAPHIES].sort((a, b) => rank(a.id) - rank(b.id))) {
    const codes = g.countries.filter((c) => byCountry.has(c) && !placed.has(c));
    if (codes.length === 0) continue;
    const area = AREA_NAMES[g.id];
    if (area) {
      const regionIds = codes.flatMap((c) => byCountry.get(c) ?? []);
      rows.push({ kind: 'area', key: `area:${g.id}`, label: area, regions: regionIds });
      rows.push(...countryRows(codes, 1));
    } else {
      rows.push(...countryRows(codes, 0));
    }
  }
  const rest = [...byCountry.keys()].filter((c) => c !== '' && !placed.has(c));
  rows.push(...countryRows(rest, 0));
  const none = byCountry.get('') ?? [];
  if (none.length > 0) {
    rows.push({ kind: 'country', key: 'country:none', label: NO_COUNTRY_HEADING, regions: none, depth: 0 });
    rows.push(...none.map((id): LzRegionRow => ({ kind: 'region', key: `region:${id}`, label: id, region: id, depth: 1 })));
  }
  return rows;
}

/** The region ids of a row (a heading: all its regions). */
export function rowRegions(row: LzRegionRow): readonly string[] {
  return row.kind === 'region' ? [row.region] : row.regions;
}

/** The tick mark of a row: `x` all ticked, `-` some, ` ` none. */
export function rowMark(row: LzRegionRow, ticked: ReadonlySet<string>): 'x' | '-' | ' ' {
  const ids = rowRegions(row);
  const n = ids.filter((id) => ticked.has(id)).length;
  return n === 0 ? ' ' : n === ids.length ? 'x' : '-';
}

/** Space on a row: a region toggles; a heading ticks all its regions, or unticks them when all are ticked. */
export function toggleRow(row: LzRegionRow, ticked: ReadonlySet<string>): Set<string> {
  const next = new Set(ticked);
  const ids = rowRegions(row);
  const all = ids.length > 0 && ids.every((id) => next.has(id));
  for (const id of ids) { if (all) next.delete(id); else next.add(id); }
  return next;
}

/** The text of a row in the picker: indent by depth, mark, label. */
export function regionRowText(row: LzRegionRow, ticked: ReadonlySet<string>): string {
  const depth = row.kind === 'area' ? 0 : row.depth;
  return `${'  '.repeat(depth)}[${rowMark(row, ticked)}] ${row.label}`;
}

/**
 * The region ids that stored values name: a region id as itself, a geography
 * (otc:germany) as the region a run resolves it to; an unknown value names
 * none. Order of the catalogue, no duplicates.
 */
export function regionsForConfigured(configured: readonly string[], regions: readonly LzGeographyRegion[]): string[] {
  const want = new Set<string>();
  for (const value of configured) {
    const r = resolveLzGeography(value, regions);
    if (r.kind !== 'unknown' && regions.some((x) => x.id === r.region)) want.add(r.region);
  }
  return regions.map((r) => r.id).filter((id) => want.has(id));
}
