// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing-zone module -- shared catalogue label helpers
//  (#3380 decision 1b: one consistent naming convention for every
//   provider and region label shown in the TUI pickers and the CLI)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// A single source for the way a provider or a region reads in every picker
// (#3399) and in `swao lz-target-config` (#3380). Do not inline provider or
// region label strings anywhere else; call these so naming stays consistent.

/** Minimal region shape a label needs (catalogue regions satisfy it). */
export interface LzLabelRegion {
  id: string;
  display?: string;
  country?: string;
  area?: string;
}

/**
 * The human provider name without the boilerplate " service catalogue"
 * suffix that every `meta.name` carries, so a picker row stays short.
 * "Open Telekom Cloud / T Cloud Public service catalogue" -> "Open Telekom Cloud / T Cloud Public";
 * "AWS ISOE Europe service catalogue (classified)" -> "AWS ISOE Europe (classified)";
 * "GCP service catalogue" -> "GCP". Falls back to the raw name when it has no suffix.
 */
export function lzProviderDisplayName(metaName: string): string {
  // #3394-follow-up (CodeQL js/polynomial-redos): strip the suffix with indexOf,
  // not a `\s*`-prefixed regex over the uncontrolled meta name. The whitespace
  // around the cut is normalised by the single linear collapse below.
  const SUFFIX = 'service catalogue';
  const at = metaName.toLowerCase().indexOf(SUFFIX);
  const stripped = at >= 0
    ? metaName.slice(0, at) + metaName.slice(at + SUFFIX.length)
    : metaName;
  return stripped.replace(/\s+/g, ' ').trim();
}

/**
 * The consistent provider picker label: `<id> - <display name>`
 * (e.g. `otc - Open Telekom Cloud / T Cloud Public`). When the cleaned name
 * is empty or equals the id it degrades to the bare id.
 */
export function lzProviderLabel(providerId: string, metaName: string): string {
  const name = lzProviderDisplayName(metaName);
  return name && name.toLowerCase() !== providerId.toLowerCase() ? `${providerId} - ${name}` : providerId;
}

/**
 * The consistent region picker label: `<region-id> - <display>, <country>, <area>`
 * (decision 1b), dropping any part that is absent or just repeats the id.
 * `eu-de - EU Germany, Frankfurt`; a region with no metadata stays `eu-de`.
 */
export function lzRegionDisplayLabel(region: LzLabelRegion): string {
  const detail = [
    region.display && region.display !== region.id ? region.display : null,
    region.country || null,
    region.area || null,
  ].filter((p): p is string => typeof p === 'string' && p.trim() !== '');
  return detail.length > 0 ? `${region.id} - ${detail.join(', ')}` : region.id;
}
