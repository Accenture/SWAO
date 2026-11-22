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

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  regionFulfills,
  regionHasService,
  safeParseLzCatalogue,
  LzServiceIacSchema,
  LzServiceIacBaseSchema,
  LZ_CATALOGUE_SOURCE_MODES,
  LZ_CATALOGUE_CONFIDENCES,
  LZ_SERVICE_STATUSES,
  LZ_IAC_LEVELS,
  type LzRegion,
} from './lz-service-catalogue.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRegion(services: LzRegion['services']): LzRegion {
  return { id: 'test-region', services };
}

const pgService: LzRegion['services'][number] = {
  code: 'postgresql-flex',
  status: 'ga',
  fulfills: ['postgresql'],
  capabilities: ['pgaudit_supported'],
  key_custody: [],
  max_version: 17,
};

const pgNoVersionService: LzRegion['services'][number] = {
  code: 'postgresql-basic',
  status: 'ga',
  fulfills: ['postgresql'],
  capabilities: [],
  key_custody: [],
};

const k8sService: LzRegion['services'][number] = {
  code: 'kubernetes-engine',
  status: 'ga',
  fulfills: ['kubernetes'],
  capabilities: [],
  key_custody: [],
};

const retiredService: LzRegion['services'][number] = {
  code: 'old-pg',
  status: 'retired',
  fulfills: ['postgresql'],
  capabilities: ['pgaudit_supported'],
  key_custody: [],
  max_version: 14,
};

// ---------------------------------------------------------------------------
// Base (unqualified) matching -- identical behaviour to before #1323
// ---------------------------------------------------------------------------

describe('regionFulfills -- base (unqualified)', () => {
  it('returns true when a GA service fulfils the capability', () => {
    expect(regionFulfills(makeRegion([pgService]), 'postgresql')).toBe(true);
  });

  it('returns true when a preview service fulfils the capability', () => {
    const preview = { ...pgService, status: 'preview' as const };
    expect(regionFulfills(makeRegion([preview]), 'postgresql')).toBe(true);
  });

  it('returns false when no service fulfils the capability', () => {
    expect(regionFulfills(makeRegion([k8sService]), 'postgresql')).toBe(false);
  });

  it('returns false when the only matching service is retired', () => {
    expect(regionFulfills(makeRegion([retiredService]), 'postgresql')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// @<major> version qualifier (#1323)
// ---------------------------------------------------------------------------

describe('regionFulfills -- @<major> version qualifier', () => {
  it('returns true when service max_version >= requested major', () => {
    // max_version=17, requested=15
    expect(regionFulfills(makeRegion([pgService]), 'postgresql@15')).toBe(true);
  });

  it('returns true when service max_version equals requested major exactly', () => {
    expect(regionFulfills(makeRegion([pgService]), 'postgresql@17')).toBe(true);
  });

  it('returns false when service max_version < requested major', () => {
    // max_version=17, requested=18
    expect(regionFulfills(makeRegion([pgService]), 'postgresql@18')).toBe(false);
  });

  it('returns false when the matching service has no max_version set', () => {
    // pgNoVersionService has no max_version -- cannot satisfy any version constraint
    expect(regionFulfills(makeRegion([pgNoVersionService]), 'postgresql@15')).toBe(false);
  });

  it('returns false when the region does not offer the base capability at all', () => {
    expect(regionFulfills(makeRegion([k8sService]), 'postgresql@15')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// +<cap> capability qualifier (#1323)
// ---------------------------------------------------------------------------

describe('regionFulfills -- +<cap> capability qualifier', () => {
  it('returns true when service carries the exact cap tag', () => {
    const withLiteralCap = { ...pgService, capabilities: ['pgaudit'] };
    expect(regionFulfills(makeRegion([withLiteralCap]), 'postgresql+pgaudit')).toBe(true);
  });

  it('returns true when service carries the cap_supported convention', () => {
    // pgService has capabilities: ['pgaudit_supported']
    expect(regionFulfills(makeRegion([pgService]), 'postgresql+pgaudit')).toBe(true);
  });

  it('returns false when service does not carry the capability', () => {
    // pgNoVersionService has capabilities: []
    expect(regionFulfills(makeRegion([pgNoVersionService]), 'postgresql+pgaudit')).toBe(false);
  });

  it('returns false when the region does not offer the base capability', () => {
    expect(regionFulfills(makeRegion([k8sService]), 'postgresql+pgaudit')).toBe(false);
  });

  it('returns false when the only matching service is retired', () => {
    expect(regionFulfills(makeRegion([retiredService]), 'postgresql+pgaudit')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LzServiceSchema accepts max_version field
// ---------------------------------------------------------------------------

import { LzServiceSchema, LzRegionSchema } from './lz-service-catalogue.js';

// ---------------------------------------------------------------------------
// LzRegionSchema accepts optional area field (#2850)
// ---------------------------------------------------------------------------

describe('LzRegionSchema', () => {
  it('accepts a region with the area field (#2850 -- GCP regions carry area: "Middle East")', () => {
    const result = LzRegionSchema.safeParse({
      id: 'me-central1',
      display: 'Doha, Qatar',
      country: 'QA',
      area: 'Middle East',
      services: [],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.area).toBe('Middle East');
  });

  it('accepts a region without the area field', () => {
    const result = LzRegionSchema.safeParse({ id: 'eu-central-1', services: [] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.area).toBeUndefined();
  });
});

describe('LzServiceSchema', () => {
  it('accepts a service with max_version', () => {
    const result = LzServiceSchema.safeParse({
      code: 'postgresql-flex',
      status: 'ga',
      capabilities: ['pgaudit_supported'],
      fulfills: ['postgresql'],
      key_custody: [],
      max_version: 17,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.max_version).toBe(17);
  });

  it('accepts a service without max_version', () => {
    const result = LzServiceSchema.safeParse({
      code: 'kubernetes-engine',
      status: 'ga',
      capabilities: [],
      fulfills: ['kubernetes'],
      key_custody: [],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.max_version).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Schema 0.2 (#3566; Design 120 §9, §10.1; 073 G-04, G-05; 077)
// ---------------------------------------------------------------------------

function liveCatalogue(over: { mode?: string; confidence?: string; service?: Record<string, unknown> } = {}): unknown {
  return {
    meta: {
      schema_version: '0.2',
      name: 'otc-prod live landing zone catalogue',
      provider: 'otc',
      last_updated: '2026-11-02',
      source: { mode: over.mode ?? 'live-api', tool: 'otc-prod/platform' },
      confidence: over.confidence ?? 'medium',
      regions_count: 1,
    },
    regions: [{
      id: 'eu-de',
      services: [{
        code: 'ecs',
        canonical_code: 'otc.ecs',
        status: 'ga',
        fulfills: ['vm_compute'],
        iac: {
          tool: ['terraform', 'opentofu'],
          provider: 'opentelekomcloud',
          provider_version: '1.37.11',
          level: 'full',
          resources: ['opentelekomcloud_compute_instance_v2'],
          data_sources: ['opentelekomcloud_compute_instance_v2'],
          source: 'provider-schema',
          last_verified: '2026-11-02',
        },
        ...over.service,
      }],
    }],
  };
}

describe('LZ catalogue schema 0.2 (#3566)', () => {
  it('parses a live catalogue with source.mode live-api, canonical_code and an iac block', () => {
    const r = safeParseLzCatalogue(liveCatalogue());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const svc = r.catalogue.regions[0]!.services[0]!;
    expect(r.catalogue.meta.source.mode).toBe('live-api');
    expect(svc.canonical_code).toBe('otc.ecs');
    expect(svc.iac?.level).toBe('full');
    expect(svc.iac?.resources).toEqual(['opentelekomcloud_compute_instance_v2']);
  });

  it('rejects an unknown source.mode (the enum stays closed, 073 G-05)', () => {
    const r = safeParseLzCatalogue(liveCatalogue({ mode: 'live-crawl' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join(' ')).toContain('meta.source.mode');
  });

  it('accepts the 077 values: mode manual, confidence operator-declared, status check-availability', () => {
    const r = safeParseLzCatalogue(liveCatalogue({ mode: 'manual', confidence: 'operator-declared', service: { status: 'check-availability', iac: undefined } }));
    expect(r.ok).toBe(true);
  });

  it('the exported vocabularies are the enums the schema enforces', () => {
    expect(LZ_CATALOGUE_SOURCE_MODES).toEqual(['api', 'scrape', 'curated', 'botocore-endpoints', 'pim-api-stackit', 'live-api', 'manual']);
    expect(LZ_CATALOGUE_CONFIDENCES).toEqual(['high', 'medium', 'low', 'operator-declared']);
    expect(LZ_SERVICE_STATUSES).toEqual(['ga', 'preview', 'announced', 'retired', 'check-availability']);
    expect(LZ_IAC_LEVELS).toEqual(['full', 'read', 'none', 'n/a']);
    for (const confidence of LZ_CATALOGUE_CONFIDENCES) expect(safeParseLzCatalogue(liveCatalogue({ confidence })).ok, confidence).toBe(true);
    for (const mode of LZ_CATALOGUE_SOURCE_MODES) expect(safeParseLzCatalogue(liveCatalogue({ mode })).ok, mode).toBe(true);
  });

  it('a check-availability service is never counted as available', () => {
    const region = makeRegion([{ ...k8sService, status: 'check-availability' }]);
    expect(regionFulfills(region, 'kubernetes')).toBe(false);
    expect(regionHasService(region, 'kubernetes-engine')).toBe(false);
  });
});

describe('LzServiceIacSchema (#3566, Design 120 §9)', () => {
  const base = { tool: ['opentofu'], provider: 'azurerm', level: 'full', resources: ['azurerm_kubernetes_cluster'], source: 'curated' };
  const paths = (v: unknown): string[] => {
    const r = LzServiceIacSchema.safeParse(v);
    return r.success ? [] : r.error.issues.map((i) => i.path.join('.')).sort();
  };

  it('accepts level n/a and level none without provider or tool', () => {
    expect(LzServiceIacSchema.safeParse({ level: 'n/a', source: 'curated' }).success).toBe(true);
    expect(LzServiceIacSchema.safeParse({ level: 'none', source: 'curated' }).success).toBe(true);
  });

  it('requires provider and a tool for levels full and read', () => {
    expect(paths({ level: 'full', resources: ['x_cluster'], source: 'curated' })).toEqual(['provider', 'tool']);
    expect(paths({ level: 'read', data_sources: ['x_cluster'], source: 'curated' })).toEqual(['provider', 'tool']);
  });

  it('level full needs a managed resource, level read a data source', () => {
    expect(paths({ ...base, resources: [] })).toEqual(['resources']);
    expect(paths({ ...base, level: 'read', resources: [], data_sources: [] })).toEqual(['data_sources']);
    expect(LzServiceIacSchema.safeParse({ ...base, level: 'read', resources: [], data_sources: ['azurerm_kubernetes_cluster'] }).success).toBe(true);
  });

  it('rejects contradictory blocks: read with resources, none and n/a with resources or data sources', () => {
    expect(paths({ ...base, level: 'read', data_sources: ['azurerm_kubernetes_cluster'] })).toEqual(['resources']);
    expect(paths({ level: 'none', source: 'curated', resources: ['x_cluster'] })).toEqual(['resources']);
    expect(paths({ level: 'none', source: 'curated', data_sources: ['x_cluster'] })).toEqual(['data_sources']);
    expect(paths({ level: 'n/a', source: 'curated', resources: ['x_cluster'] })).toEqual(['resources']);
    expect(paths({ level: 'n/a', source: 'curated', data_sources: ['x_cluster'] })).toEqual(['data_sources']);
  });

  it('source provider-schema requires provider_version', () => {
    expect(paths({ ...base, source: 'provider-schema' })).toEqual(['provider_version']);
    expect(LzServiceIacSchema.safeParse({ ...base, source: 'provider-schema', provider_version: '4.10.0' }).success).toBe(true);
  });

  it('last_verified must be YYYY-MM-DD', () => {
    expect(paths({ ...base, last_verified: '02.11.2026' })).toEqual(['last_verified']);
    expect(paths({ ...base, last_verified: '2026-11' })).toEqual(['last_verified']);
    expect(LzServiceIacSchema.safeParse({ ...base, last_verified: '2026-11-02' }).success).toBe(true);
  });

  it('last_verified must be a real calendar date', () => {
    expect(paths({ ...base, last_verified: '2026-13-45' })).toEqual(['last_verified']);
    expect(paths({ ...base, last_verified: '2026-02-30' })).toEqual(['last_verified']);
    expect(paths({ ...base, last_verified: '2026-00-10' })).toEqual(['last_verified']);
    expect(LzServiceIacSchema.safeParse({ ...base, last_verified: '2028-02-29' }).success).toBe(true);
  });

  it('rejects unknown levels, unknown tools and unknown keys', () => {
    expect(LzServiceIacSchema.safeParse({ ...base, level: 'partial' }).success).toBe(false);
    expect(LzServiceIacSchema.safeParse({ ...base, tool: ['pulumi'] }).success).toBe(false);
    expect(LzServiceIacSchema.safeParse({ ...base, price: 1 }).success).toBe(false);
  });

  it('exports the unrefined base object for composition; data is validated with the refined schema', () => {
    const withNote = LzServiceIacBaseSchema.extend({ note: z.string() });
    expect(withNote.safeParse({ ...base, note: 'x' }).success).toBe(true);
    expect(Object.keys(LzServiceIacBaseSchema.shape).sort()).toEqual(['data_sources', 'last_verified', 'level', 'provider', 'provider_version', 'resources', 'source', 'tool']);
  });
});
