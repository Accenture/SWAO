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

// #3581: the live LZ catalogue artefact (Design 120 section 10.1). One
// `lz-live-catalogue.json` per live run: the observed Offering of one landing
// zone in the LZ catalogue schema 0.2, so Update LZ Catalogue (#3582) can use
// it as a source. The live assessment never writes a catalogue file and never
// places this artefact in a catalogue lookup path (Q-03).
//
// Rules:
// - `meta.source.mode: live-api`, `meta.source.tool: <lz-id>/<scope-ids>`,
//   `confidence: medium` for every scope kind (a tenant view is a subset of
//   the offering, 056 section 3).
// - A region lists the services observed `enabled`, `available_not_enabled`
//   or `restricted` there (offered by the CSP; `restricted` is tenant policy,
//   not absence). `not_offered` and `unknown` are left out: a catalogue entry
//   is a claim of availability, and `unknown` is no observation.
// - Sovereignty facts come from the sovereignty pins first, then the resolved
//   static catalogue, never from the crawl (Q-25). A region with neither gets
//   the UNKNOWN placeholder, which the quality rules flag (facts-unsourced)
//   for operator declaration.
// - No prices (094 D-094-04).
// - IaC block per service: the scan's own block, else a provider-schema block
//   for one of the service's capability tags (deriveIacBlocks, #3580), else
//   the static catalogue's block for the same code.

import type { LzLiveScan, LzLiveStatus, LzRegion, LzService, LzServiceCatalogue, LzServiceIac, LzSovereigntyFacts } from '@swao/core';
import type { LzSovereigntyPin } from '../catalogue/sovereignty-pins.js';
import { LZ_UNKNOWN_RESIDENCY } from '../catalogue/quality.js';

/** File name of the artefact inside the run folder (Design 120 section 7.4). */
export const LZ_LIVE_CATALOGUE_FILE = 'lz-live-catalogue.json';

/** Live statuses that make a service a catalogue entry for the region. */
export const LZ_LIVE_CATALOGUE_STATUSES: readonly LzLiveStatus[] = ['enabled', 'available_not_enabled', 'restricted'];

export interface BuildLzLiveCatalogueOptions {
  /** Scans of one landing zone (one per scope); all name the same lz_id and provider. */
  scans: readonly LzLiveScan[];
  /** Resolved static catalogue of the provider, when one exists. */
  staticCatalogue?: LzServiceCatalogue | null;
  /** Sovereignty pins of the provider, keyed by region id (LZ_SOVEREIGNTY_PINS[provider]). */
  pins?: Readonly<Record<string, LzSovereigntyPin>>;
  /** Provider-schema IaC blocks keyed by capability tag (deriveIacBlocks result). */
  iacByTag?: Readonly<Record<string, LzServiceIac>>;
}

const UNKNOWN_FACTS: LzSovereigntyFacts = {
  residency_country: LZ_UNKNOWN_RESIDENCY,
  operator_jurisdiction: LZ_UNKNOWN_RESIDENCY,
  extraterritorial_exposure: [],
  certifications: [],
};

function factsOf(pin: LzSovereigntyPin): LzSovereigntyFacts {
  return {
    residency_country: pin.residency_country,
    operator_jurisdiction: pin.operator_jurisdiction,
    extraterritorial_exposure: [...pin.extraterritorial_exposure],
    certifications: [...pin.certifications],
  };
}

function hasAllFacts(s: LzSovereigntyFacts | undefined): s is LzSovereigntyFacts {
  return !!s && s.residency_country !== undefined && s.operator_jurisdiction !== undefined;
}

/**
 * Build the live LZ catalogue of one landing zone from its scope scans.
 * Throws when no scan is given or the scans disagree on lz_id or provider.
 */
export function buildLzLiveCatalogue(opts: BuildLzLiveCatalogueOptions): LzServiceCatalogue {
  const { scans } = opts;
  const first = scans[0];
  if (!first) throw new Error('[lz live] no scan to build the live LZ catalogue from');
  const { lz_id: lzId, provider } = first.meta;
  for (const s of scans) {
    if (s.meta.lz_id !== lzId || s.meta.provider !== provider) {
      throw new Error(`[lz live] scans of different landing zones cannot form one live catalogue (${lzId}/${provider} and ${s.meta.lz_id}/${s.meta.provider})`);
    }
  }
  const scopeIds = [...new Set(scans.map((s) => s.meta.scope_id))].sort();
  const lastObserved = scans.map((s) => s.meta.observed_at).sort().at(-1) ?? first.meta.observed_at;
  const date = lastObserved.slice(0, 10);

  const staticRegions = new Map<string, LzRegion>((opts.staticCatalogue?.regions ?? []).map((r) => [r.id, r]));
  const staticIac = new Map<string, LzServiceIac>();
  for (const r of opts.staticCatalogue?.regions ?? []) {
    for (const s of r.services) if (s.iac && !staticIac.has(s.code)) staticIac.set(s.code, s.iac);
  }

  // Region list: every region any scope observed, in first-seen order.
  const regionIds: string[] = [];
  const countryOf = new Map<string, string>();
  for (const scan of scans) {
    for (const r of scan.offering.regions) {
      if (!regionIds.includes(r.id)) regionIds.push(r.id);
      if (r.country && !countryOf.has(r.id)) countryOf.set(r.id, r.country);
    }
    for (const svc of scan.offering.services) {
      for (const id of Object.keys(svc.regions)) if (!regionIds.includes(id)) regionIds.push(id);
    }
  }

  const iacFor = (code: string, tags: readonly string[], own: LzServiceIac | undefined): LzServiceIac | undefined => {
    if (own) return own;
    for (const t of tags) {
      const b = opts.iacByTag?.[t];
      if (b) return b;
    }
    return staticIac.get(code);
  };

  const regions: LzRegion[] = regionIds.map((id) => {
    const byCode = new Map<string, LzService>();
    for (const scan of scans) {
      for (const svc of scan.offering.services) {
        const st = svc.regions[id];
        if (!st || !LZ_LIVE_CATALOGUE_STATUSES.includes(st.status)) continue;
        const code = svc.catalogue_code ?? svc.code;
        const prev = byCode.get(code);
        if (prev) {
          prev.fulfills = [...new Set([...prev.fulfills, ...svc.capability_tags])];
          if (!prev.iac) {
            const iac = iacFor(code, svc.capability_tags, svc.iac);
            if (iac) prev.iac = iac;
          }
          continue;
        }
        const iac = iacFor(code, svc.capability_tags, svc.iac);
        byCode.set(code, {
          code,
          ...(svc.catalogue_code && svc.catalogue_code !== svc.code ? { canonical_code: svc.code } : {}),
          name: svc.name,
          status: 'ga',
          capabilities: [],
          fulfills: [...svc.capability_tags],
          key_custody: [],
          last_verified: st.observed_at.slice(0, 10),
          source: 'api',
          ...(iac ? { iac } : {}),
        });
      }
    }
    const pin = opts.pins?.[id];
    const staticRegion = staticRegions.get(id);
    const sovereignty = pin ? factsOf(pin)
      : hasAllFacts(staticRegion?.sovereignty) ? {
        ...staticRegion.sovereignty,
        extraterritorial_exposure: [...staticRegion.sovereignty.extraterritorial_exposure],
        certifications: [...staticRegion.sovereignty.certifications],
      }
        : { ...UNKNOWN_FACTS };
    const country = countryOf.get(id) ?? staticRegion?.country;
    return {
      id,
      ...(staticRegion?.display ? { display: staticRegion.display } : {}),
      ...(country ? { country } : {}),
      sovereignty,
      services: [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code)),
    };
  });

  const driver = `${provider} driver ${first.meta.driver_version}`;
  const factSource = opts.pins ? 'the sovereignty pins and the resolved static catalogue'
    : opts.staticCatalogue ? 'the resolved static catalogue' : 'no source (UNKNOWN placeholder; declare the facts)';
  return {
    meta: {
      schema_version: '0.2',
      name: `${provider} live LZ catalogue for ${lzId}`,
      provider,
      last_updated: date,
      source: {
        mode: 'live-api',
        tool: `${lzId}/${scopeIds.join(',')}`,
        operator: 'SWAO live LZ assessment',
        source_note: `Observed by the ${driver} on ${lastObserved} (scopes ${scopeIds.join(', ')}). Services listed per region are those observed enabled, available_not_enabled or restricted; not_offered and unknown are left out. Sovereignty facts are copied from ${factSource}, never derived from the crawl (Design 120 section 10.1). No prices (094 D-094-04).`,
      },
      confidence: 'medium',
      regions_count: regions.length,
    },
    regions,
  };
}
