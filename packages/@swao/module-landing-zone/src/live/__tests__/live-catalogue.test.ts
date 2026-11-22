// #3581: live LZ catalogue artefact (Design 120 section 10.1). Synthetic
// LzLiveScan fixtures only; no recording or tenant identifier.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveLzScanBaseFields, parseLzCatalogue, parseLzLiveScan } from '@swao/core';
import type { LzLiveScan, LzServiceCatalogue, LzServiceIac } from '@swao/core';
import { buildLzLiveCatalogue, LZ_LIVE_CATALOGUE_STATUSES } from '../live-catalogue.js';
import { checkLzCatalogueQuality, loadLzCatalogue, resolveBundledLzCataloguesDir, isLzCatalogueLookupDir } from '../../catalogue/loader.js';
import { LZ_SOVEREIGNTY_PINS } from '../../catalogue/sovereignty-pins.js';
import { LZ_CATALOGUE_TEMPLATE_FILE } from '../../catalogue/quality.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-live-cat-'));
  tmp.push(d);
  return d;
}

type Status = LzLiveScan['offering']['services'][number]['regions'][string]['status'];
interface SvcIn { code: string; catalogue_code?: string; tags?: string[]; regions: Record<string, Status>; iac?: LzServiceIac }

function scan(o: { lzId?: string; provider?: string; scopeId?: string; observedAt?: string; regions: { id: string; country?: string }[]; services: SvcIn[] }): LzLiveScan {
  const observed = o.observedAt ?? '2026-11-03T08:00:00Z';
  const meta = {
    lz_id: o.lzId ?? 'otc-test',
    provider: o.provider ?? 'otc',
    scope_id: o.scopeId ?? 'platform',
    scope_kind: 'platform' as const,
    observed_at: observed,
    driver_version: '0.1.0',
    read_only: 'verified' as const,
    read_only_overrides: [],
    coverage: { readable: [], unreadable: [] },
    frameworks: [],
    sources: [],
  };
  const offering = {
    regions: o.regions.map((r) => ({ id: r.id, ...(r.country ? { country: r.country } : {}), azs: [], status: 'enabled' as const })),
    services: o.services.map((s) => ({
      code: s.code,
      name: `${s.code} name`,
      capability_tags: s.tags ?? [],
      ...(s.catalogue_code ? { catalogue_code: s.catalogue_code } : {}),
      regions: Object.fromEntries(Object.entries(s.regions).map(([id, status]) => [id, {
        status,
        evidence: status === 'restricted' ? [{ source: 'policy' as const, ref: 'scp' }] : [{ source: 'api' as const, ref: 'catalogue' }],
        observed_at: observed,
      }])),
      ...(s.iac ? { iac: s.iac } : {}),
      frameworks: {},
      prices: [{ region: o.regions[0]!.id, unit: 'h', amount: 0.1, currency: 'EUR' }],
    })),
  };
  const estate = { resources: [], workloads: [], guardrails: [], quotas: [], checks: [] };
  return parseLzLiveScan({ ...deriveLzScanBaseFields({ meta, offering, estate }), collection_mode: 'live', confidence: 'observed', meta, offering, estate });
}

function bundledOtc(): LzServiceCatalogue {
  const dir = resolveBundledLzCataloguesDir();
  if (!dir) throw new Error('bundled catalogues not found');
  return loadLzCatalogue(dir, 'otc');
}

function quality(cat: LzServiceCatalogue): ReturnType<typeof checkLzCatalogueQuality> {
  const dir = tempDir();
  writeFileSync(join(dir, `${cat.meta.provider}.json`), JSON.stringify(cat, null, 2));
  return checkLzCatalogueQuality(dir, { overlay: true, templateFile: join(resolveBundledLzCataloguesDir()!, LZ_CATALOGUE_TEMPLATE_FILE), now: new Date('2026-11-03T00:00:00Z') });
}

const IAC_FULL: LzServiceIac = { tool: ['terraform', 'opentofu'], provider: 'opentelekomcloud', provider_version: '1.36.0', level: 'full', resources: ['opentelekomcloud_ecs_instance_v1'], data_sources: [], source: 'provider-schema', last_verified: '2026-11-03' };

describe('buildLzLiveCatalogue (#3581, Design 120 section 10.1)', () => {
  it('carries live-api provenance, medium confidence, schema 0.2 and the scope ids', () => {
    const cat = buildLzLiveCatalogue({
      scans: [
        scan({ scopeId: 'platform', regions: [{ id: 'eu-de' }], services: [{ code: 'ecs', tags: ['vm_compute'], regions: { 'eu-de': 'enabled' } }] }),
        scan({ scopeId: 'app-a', observedAt: '2026-11-04T09:00:00Z', regions: [{ id: 'eu-de' }], services: [] }),
      ],
      staticCatalogue: bundledOtc(),
    });
    expect(cat.meta).toMatchObject({
      schema_version: '0.2', provider: 'otc', last_updated: '2026-11-04', confidence: 'medium', regions_count: 1,
      source: { mode: 'live-api', tool: 'otc-test/app-a,platform' },
    });
    expect(() => parseLzCatalogue(cat)).not.toThrow();
  });

  it('lists enabled, available_not_enabled and restricted services; leaves out not_offered and unknown', () => {
    expect(LZ_LIVE_CATALOGUE_STATUSES).toEqual(['enabled', 'available_not_enabled', 'restricted']);
    const cat = buildLzLiveCatalogue({
      scans: [scan({
        regions: [{ id: 'eu-de' }, { id: 'eu-nl' }],
        services: [
          { code: 'ecs', regions: { 'eu-de': 'enabled', 'eu-nl': 'not_offered' } },
          { code: 'rds', regions: { 'eu-de': 'available_not_enabled', 'eu-nl': 'unknown' } },
          { code: 'dms', regions: { 'eu-de': 'restricted' } },
        ],
      })],
    });
    const codes = (id: string): string[] => cat.regions.find((r) => r.id === id)!.services.map((s) => s.code);
    expect(codes('eu-de')).toEqual(['dms', 'ecs', 'rds']);
    expect(codes('eu-nl')).toEqual([]);
    expect(cat.regions[0]!.services[0]).toMatchObject({ status: 'ga', source: 'api', last_verified: '2026-11-03' });
  });

  it('writes no prices, even when the scan carries them (094 D-094-04)', () => {
    const cat = buildLzLiveCatalogue({ scans: [scan({ regions: [{ id: 'eu-de' }], services: [{ code: 'ecs', regions: { 'eu-de': 'enabled' } }] })] });
    const text = JSON.stringify(cat);
    expect(text).not.toMatch(/"prices"|"amount"|"currency"/);
  });

  it('copies sovereignty facts from the static catalogue, never from the crawl (Q-25)', () => {
    const cat = buildLzLiveCatalogue({
      scans: [scan({ regions: [{ id: 'eu-de', country: 'XX' }, { id: 'eu-zz', country: 'NL' }], services: [{ code: 'ecs', regions: { 'eu-de': 'enabled', 'eu-zz': 'enabled' } }] })],
      staticCatalogue: bundledOtc(),
    });
    const staticDe = bundledOtc().regions.find((r) => r.id === 'eu-de')!;
    expect(cat.regions.find((r) => r.id === 'eu-de')!.sovereignty).toEqual(staticDe.sovereignty);
    // A region in neither the pins nor the static catalogue gets the UNKNOWN
    // placeholder, not the country the crawl reported.
    expect(cat.regions.find((r) => r.id === 'eu-zz')!.sovereignty).toEqual({ residency_country: 'UNKNOWN', operator_jurisdiction: 'UNKNOWN', extraterritorial_exposure: [], certifications: [] });
  });

  it('prefers the sovereignty pin over the static catalogue', () => {
    const pins = LZ_SOVEREIGNTY_PINS['aws']!;
    const pin = pins['eu-central-1']!;
    const stale: LzServiceCatalogue = parseLzCatalogue({
      meta: { schema_version: '0.1', name: 'x', provider: 'aws', last_updated: '2026-01-01', source: { mode: 'curated' } },
      regions: [{ id: 'eu-central-1', sovereignty: { residency_country: 'DE', operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [], certifications: [] }, services: [] }],
    });
    const cat = buildLzLiveCatalogue({
      scans: [scan({ lzId: 'aws-demo', provider: 'aws', regions: [{ id: 'eu-central-1' }], services: [{ code: 'ec2', regions: { 'eu-central-1': 'enabled' } }] })],
      staticCatalogue: stale,
      pins,
    });
    expect(cat.regions[0]!.sovereignty).toEqual(pin);
  });

  it('merges the scopes of one landing zone: one entry per code, capability tags joined, native code kept as canonical_code', () => {
    const cat = buildLzLiveCatalogue({
      scans: [
        scan({ scopeId: 'platform', regions: [{ id: 'eu-de' }], services: [{ code: 'ecs', catalogue_code: 'Elastic Cloud Server', tags: ['vm_compute'], regions: { 'eu-de': 'enabled' } }] }),
        scan({ scopeId: 'app-a', regions: [{ id: 'eu-de' }], services: [{ code: 'ecs', catalogue_code: 'Elastic Cloud Server', tags: ['gpu_compute'], regions: { 'eu-de': 'enabled' } }] }),
      ],
    });
    expect(cat.regions[0]!.services).toHaveLength(1);
    expect(cat.regions[0]!.services[0]).toMatchObject({ code: 'Elastic Cloud Server', canonical_code: 'ecs', fulfills: ['vm_compute', 'gpu_compute'] });
  });

  it('takes the IaC block from the scan, else a provider-schema block by tag, else the static catalogue', () => {
    const staticIac: LzServiceIac = { ...IAC_FULL, source: 'curated', provider_version: undefined, resources: ['opentelekomcloud_rds_instance_v3'] };
    const byTag: LzServiceIac = { ...IAC_FULL, resources: ['opentelekomcloud_cce_cluster_v3'] };
    const staticCatalogue = parseLzCatalogue({
      meta: { schema_version: '0.2', name: 'x', provider: 'otc', last_updated: '2026-11-01', source: { mode: 'curated' } },
      regions: [{ id: 'eu-de', services: [{ code: 'rds', iac: staticIac }] }],
    });
    const cat = buildLzLiveCatalogue({
      scans: [scan({
        regions: [{ id: 'eu-de' }],
        services: [
          { code: 'ecs', tags: ['vm_compute'], regions: { 'eu-de': 'enabled' }, iac: IAC_FULL },
          { code: 'cce', tags: ['kubernetes'], regions: { 'eu-de': 'enabled' } },
          { code: 'rds', tags: ['postgresql'], regions: { 'eu-de': 'enabled' } },
          { code: 'obs', tags: ['object_storage'], regions: { 'eu-de': 'enabled' } },
        ],
      })],
      staticCatalogue,
      iacByTag: { kubernetes: byTag },
    });
    const iac = (code: string): LzServiceIac | undefined => cat.regions[0]!.services.find((s) => s.code === code)?.iac;
    expect(iac('ecs')).toEqual(IAC_FULL);
    expect(iac('cce')).toEqual(byTag);
    expect(iac('rds')?.resources).toEqual(['opentelekomcloud_rds_instance_v3']);
    expect(iac('obs')).toBeUndefined();
  });

  it('refuses no scans and scans of different landing zones', () => {
    expect(() => buildLzLiveCatalogue({ scans: [] })).toThrow(/no scan/);
    expect(() => buildLzLiveCatalogue({
      scans: [scan({ regions: [{ id: 'eu-de' }], services: [] }), scan({ lzId: 'otc-other', regions: [{ id: 'eu-de' }], services: [] })],
    })).toThrow(/different landing zones/);
  });

  it('the emitted catalogue parses and passes the catalogue quality rules with no error', () => {
    const cat = buildLzLiveCatalogue({
      scans: [scan({ regions: [{ id: 'eu-de' }, { id: 'eu-nl' }], services: [{ code: 'ecs', catalogue_code: 'Elastic Cloud Server', tags: ['vm_compute'], regions: { 'eu-de': 'enabled', 'eu-nl': 'enabled' } }] })],
      staticCatalogue: bundledOtc(),
    });
    expect(() => parseLzCatalogue(JSON.parse(JSON.stringify(cat)))).not.toThrow();
    const report = quality(cat);
    expect(report.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(report.errors).toBe(0);
  });

  it('a region without facts stays valid and is flagged facts-unsourced for operator declaration', () => {
    const cat = buildLzLiveCatalogue({ scans: [scan({ regions: [{ id: 'eu-de' }, { id: 'eu-zz' }], services: [{ code: 'ecs', regions: { 'eu-de': 'enabled', 'eu-zz': 'enabled' } }] })], staticCatalogue: bundledOtc() });
    const report = quality(cat);
    expect(report.errors).toBe(0);
    expect(report.findings).toContainEqual(expect.objectContaining({ rule: 'facts-unsourced', region: 'eu-zz' }));
  });
});

describe('isLzCatalogueLookupDir (#3581, Q-03)', () => {
  it('names every workspace catalogue folder and any folder that holds catalogues', () => {
    const ws = tempDir();
    expect(isLzCatalogueLookupDir(join(ws, 'wsp', 'inputs', 'catalogs', 'lz-catalogues'), ws)).toBe(true);
    expect(isLzCatalogueLookupDir(join(ws, 'lz-catalogues'), ws)).toBe(true);
    expect(isLzCatalogueLookupDir(resolveBundledLzCataloguesDir()!, ws)).toBe(true);
    const other = join(ws, 'landing-zones', 'otc-test', 'wsp', 'runs', 't1');
    expect(isLzCatalogueLookupDir(other, ws)).toBe(false);
    const holder = tempDir();
    writeFileSync(join(holder, 'otc.json'), '{}');
    expect(isLzCatalogueLookupDir(holder, ws)).toBe(true);
  });

  it('a run folder holding only the live run artefacts is not a catalogue folder, so a rerun is allowed (#3583)', () => {
    const ws = tempDir();
    const run = tempDir();
    writeFileSync(join(run, 'lz-live-catalogue.json'), '{}');
    writeFileSync(join(run, 'otc-test.platform.lz-live-scan.json'), '{}');
    writeFileSync(join(run, 'lz-live-merged.yaml'), '');
    expect(isLzCatalogueLookupDir(run, ws)).toBe(false);
    writeFileSync(join(run, 'aws.json'), '{}');
    expect(isLzCatalogueLookupDir(run, ws)).toBe(true);
  });
});
