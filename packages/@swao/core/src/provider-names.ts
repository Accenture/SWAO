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

/**
 * #4296: the one provider name map of the SWAO ecosystem. Every human label
 * of a cloud provider (TUI, CLI, MCP lines, publications through
 * lzProviderBrand) comes from here, so a provider reads the same everywhere:
 * the abbreviation plus the full name ("OTC, T Cloud Public"). The id stays
 * the machine key in every machine-readable field (`.swao.yml` targets such
 * as `otc:germany`, WSP, JSON); only the label is human text.
 *
 * `otc` is T Cloud Public, the name Deutsche Telekom has used since early 2026
 * for the former Open Telekom Cloud (Design 120 section 1.1). Do not write a
 * full provider name literal anywhere else in TUI or CLI source; the gate
 * `swao/packages/swao/src/__tests__/provider-name-literals.gate.test.ts`
 * fails on one.
 */
export interface ProviderName {
  /** Short form for tight columns, for example "OTC". */
  abbr: string;
  /** Full name, for example "T Cloud Public". */
  full: string;
  /**
   * #4454: description for the second column of the two-column lists
   * (providerColumns). Set only where the full name equals the abbreviation
   * (STACKIT, OVHcloud), so every row of a provider list has a second column;
   * the pair form of publications ("STACKIT") does not use it.
   */
  description?: string;
}

export const PROVIDER_NAMES: Readonly<Record<string, ProviderName>> = Object.freeze({
  'aws':         { abbr: 'AWS',         full: 'Amazon Web Services' },
  'aws-esc':     { abbr: 'AWS ESC',     full: 'AWS European Sovereign Cloud' },
  'aws-iso-e':   { abbr: 'AWS ISO-E',   full: 'AWS ISO-E Europe (classified)' },
  'azure':       { abbr: 'Azure',       full: 'Microsoft Azure' },
  'azure-local': { abbr: 'Azure Local', full: 'Microsoft Azure Local' },
  'delos':       { abbr: 'Delos',       full: 'Delos Cloud' },
  'gcp':         { abbr: 'GCP',         full: 'Google Cloud Platform' },
  'oci':         { abbr: 'OCI',         full: 'Oracle Cloud Infrastructure' },
  'otc':         { abbr: 'OTC',         full: 'T Cloud Public' },
  'stackit':     { abbr: 'STACKIT',     full: 'STACKIT', description: 'STACKIT Cloud, Schwarz Digits' },
  'ionos':       { abbr: 'IONOS',       full: 'IONOS Cloud' },
  'ovhcloud':    { abbr: 'OVHcloud',    full: 'OVHcloud', description: 'OVHcloud Public Cloud' },
});

/**
 * - `pair`: abbreviation plus full name, "OTC, T Cloud Public" (one word when
 *   both are the same, "STACKIT"); the default for every human label.
 * - `abbr`: the abbreviation only, for tight columns.
 * - `full`: the full name only.
 */
export type ProviderLabelForm = 'pair' | 'abbr' | 'full';

/** The map entry of a provider id (case-insensitive), or undefined for an id SWAO does not know. */
export function providerName(id: string): ProviderName | undefined {
  if (!id) return undefined;
  const key = id.toLowerCase();
  return Object.prototype.hasOwnProperty.call(PROVIDER_NAMES, key) ? PROVIDER_NAMES[key] : undefined;
}

/**
 * Human label of a provider id in the given form. An id that is not in the
 * map (a user-defined catalogue, a custom landing zone) keeps the upper-cased
 * id as abbreviation; `fallbackFull` (for example the cleaned catalogue
 * `meta.name`) is its full name when given.
 */
export function providerLabel(id: string, form: ProviderLabelForm = 'pair', fallbackFull?: string): string {
  if (!id) return '';
  const known = providerName(id);
  const abbr = known?.abbr ?? id.toUpperCase();
  const fallback = fallbackFull?.trim();
  const full = known?.full ?? (fallback ? fallback : abbr);
  switch (form) {
    case 'abbr': return abbr;
    case 'full': return full;
    case 'pair': return full.toLowerCase() === abbr.toLowerCase() ? abbr : `${abbr}, ${full}`;
    default: {
      const never: never = form;
      return never;
    }
  }
}

/** Width of the widest abbreviation in the map, for aligned two-column rows. */
export const PROVIDER_ABBR_WIDTH = Math.max(...Object.values(PROVIDER_NAMES).map((n) => n.abbr.length));

/**
 * Description of a provider for the second column of a two-column list
 * (#4454): the `description` of the map entry, else the full name. An id that
 * is not in the map uses `fallbackFull`, else its abbreviation.
 */
export function providerDescription(id: string, fallbackFull?: string): string {
  const known = providerName(id);
  if (known?.description) return known.description;
  return providerLabel(id, 'full', fallbackFull);
}

/**
 * Two-column row text `OTC          T Cloud Public` (abbreviation padded,
 * then the description, see providerDescription). The second column is
 * dropped only for an id outside the map whose description equals its
 * abbreviation. Used by TUI lists that show many providers.
 */
export function providerColumns(id: string, fallbackFull?: string): string {
  const abbr = providerLabel(id, 'abbr');
  const full = providerDescription(id, fallbackFull);
  if (full.toLowerCase() === abbr.toLowerCase()) return abbr;
  return `${abbr.padEnd(Math.max(PROVIDER_ABBR_WIDTH, abbr.length))}  ${full}`;
}

const isWordChar = (c: string | undefined): boolean =>
  c !== undefined && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '_' || c === '-');

// Built once: the map is frozen, and esc() runs per cell.
const BRAND_FULLS: readonly ProviderName[] = Object.values(PROVIDER_NAMES)
  .filter((n) => n.full !== n.abbr)
  .sort((a, b) => b.full.length - a.full.length);
const BRAND_UPPERS: ReadonlyArray<{ upper: string; abbr: string }> = Object.entries(PROVIDER_NAMES)
  .map(([id, n]) => ({ upper: id.toUpperCase(), abbr: n.abbr }))
  .filter((u) => u.upper !== u.abbr)
  .sort((a, b) => b.upper.length - a.upper.length);

/**
 * #4391 (Design 127 section 9): provider names in running text through the
 * brand label. A full name that is not already written as the pair
 * "<abbr>, <full>" gets its abbreviation in front ("Microsoft Azure" becomes
 * "Azure, Microsoft Azure"); an upper-cased id that is not the abbreviation
 * ("AZURE") becomes the abbreviation when it stands as a word. The longest
 * full name wins at a position ("Microsoft Azure Local" is not read as
 * "Microsoft Azure"). Idempotent; lower-case ids (`data-provider="azure"`)
 * stay as they are. Plain string scans, no regular expressions.
 */
export function brandProviderNames(text: string): string {
  if (!text) return text;
  const fulls = BRAND_FULLS;
  const uppers = BRAND_UPPERS;
  if (!fulls.some((n) => text.includes(n.full)) && !uppers.some((u) => text.includes(u.upper))) return text;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const full = fulls.find((n) => text.startsWith(n.full, i));
    if (full) {
      const prefix = `${full.abbr}, `;
      const paired = out.endsWith(prefix);
      out += (paired ? '' : prefix) + full.full;
      i += full.full.length;
      continue;
    }
    const up = uppers.find((u) => text.startsWith(u.upper, i) && !isWordChar(text[i - 1]) && !isWordChar(text[i + u.upper.length]));
    if (up) {
      out += up.abbr;
      i += up.upper.length;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}
