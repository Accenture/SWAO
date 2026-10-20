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

import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  resolveLzCataloguesDir,
  resolveBundledLzCataloguesDir,
  isLzCataloguesDir,
  scanLzCatalogueFiles,
  readLzCatalogueEntry,
  discoverLzCatalogues,
  listLzCatalogues,
  isLzCatalogueEntryError,
  lzCatalogueShortName,
  loadLzComingSoon,
  LZ_COMING_SOON_FILE,
  loadLzCatalogue,
  resolveProviderCatalogue,
  listLzCatalogueProviders,
  LzCatalogueSchemaError,
  LzCatalogueDuplicateIdError,
} from '../loader.js';

describe('LZ catalogue loader (#0567)', () => {
  it('resolves the bundled lz-catalogues dir + discovers the catalogues from their files (#3298)', () => {
    const dir = resolveLzCataloguesDir();
    expect(dir).not.toBeNull();
    const providers = discoverLzCatalogues(dir!).map((c) => c.provider);
    expect(providers).toContain('aws');
    expect(providers).toContain('azure');
    expect(providers).toContain('stackit');
    expect(providers).toContain('gcp');
  });

  it('loads + validates each discovered provider catalogue', () => {
    const dir = resolveLzCataloguesDir()!;
    for (const entry of discoverLzCatalogues(dir)) {
      const cat = loadLzCatalogue(dir, entry.provider);
      expect(cat.meta.provider).toBe(entry.provider);
      // every service declares its fulfilled capabilities (the bridge)
      for (const region of cat.regions) {
        for (const svc of region.services) expect(Array.isArray(svc.fulfills)).toBe(true);
      }
    }
  });

  it('#3298: the bundled folder has no index.json; every listed field is the file\'s own meta', () => {
    const dir = resolveBundledLzCataloguesDir()!;
    expect(dir).not.toBeNull();
    expect(existsSync(join(dir, 'index.json'))).toBe(false);
    const entries = discoverLzCatalogues(dir);
    expect(entries.map((e) => e.provider)).toEqual([
      'aws', 'aws-esc', 'aws-iso-e', 'azure', 'azure-local', 'delos', 'gcp', 'oci', 'otc', 'stackit',
    ]);
    for (const entry of entries) {
      const cat = loadLzCatalogue(dir, entry.provider);
      expect(entry).toMatchObject({
        file: `${entry.provider}.json`,
        name: cat.meta.name,
        last_updated: cat.meta.last_updated,
        source: cat.meta.source.mode,
        confidence: cat.meta.confidence,
        regions_count: cat.regions.length,
      });
    }
    // Support files are never catalogues.
    const files = scanLzCatalogueFiles(dir).map((r) => r.file);
    for (const f of ['_lz-catalogue-template.json', LZ_COMING_SOON_FILE, 'aws-service-meta.json']) expect(files).not.toContain(f);
    expect(files.some((f) => f.startsWith('prices'))).toBe(false);
  });

  it('#3298: coming soon lives only in _coming-soon.json, and never names a catalogued provider', () => {
    const dir = resolveBundledLzCataloguesDir()!;
    const soon = loadLzComingSoon(dir);
    expect(soon).toEqual(['ionos', 'ovhcloud']);
    const catalogued = new Set(discoverLzCatalogues(dir).map((e) => e.provider));
    for (const p of soon) expect(catalogued.has(p)).toBe(false);
    expect(loadLzComingSoon()).toEqual(soon); // default: the bundled folder

    const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-soon-'));
    try {
      writeFileSync(join(tmp, LZ_COMING_SOON_FILE), JSON.stringify({ coming_soon: ['acme', 'newcloud', 42] }));
      writeFileSync(join(tmp, 'acme.json'), JSON.stringify({ meta: { provider: 'acme' } }));
      // acme gained a catalogue file, so it is no longer coming soon; non-strings are ignored.
      expect(loadLzComingSoon(tmp)).toEqual(['newcloud']);
      expect(loadLzComingSoon(join(tmp, 'missing'))).toEqual([]);
      expect(loadLzComingSoon(null)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('#3298: the shared discovery reads flat and per-provider files, reports unreadable meta, and lists the short name', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-discover-'));
    try {
      writeFileSync(join(tmp, 'acme.json'), VALID_CATALOGUE.replace('"provider":"aws"', '"provider":"acme"').replace('Test AWS', 'Acme service catalogue'));
      mkdirSync(join(tmp, 'boxed'));
      writeFileSync(join(tmp, 'boxed', 'index.json'), VALID_CATALOGUE.replace('"provider":"aws"', '"provider":"boxed"'));
      mkdirSync(join(tmp, 'prices'));
      writeFileSync(join(tmp, 'prices', 'vm-prices.json'), '{}');
      writeFileSync(join(tmp, 'broken.json'), '{ not json');
      writeFileSync(join(tmp, 'nometa.json'), JSON.stringify({ regions: [] }));
      const refs = scanLzCatalogueFiles(tmp);
      expect(refs.map((r) => `${r.provider}:${r.file}`)).toEqual(['acme:acme.json', 'boxed:boxed/index.json', 'broken:broken.json', 'nometa:nometa.json']);
      const read = refs.map(readLzCatalogueEntry);
      expect(read.filter(isLzCatalogueEntryError).map((e) => e.provider)).toEqual(['broken', 'nometa']);
      const listed = discoverLzCatalogues(tmp);
      expect(listed.map((e) => e.provider)).toEqual(['acme', 'boxed']);
      expect(listed[0]).toMatchObject({ name: 'Acme service catalogue', short_description: 'Acme', source: 'curated', confidence: 'medium', regions_count: 1, last_updated: '2026-08-06' });
      expect(lzCatalogueShortName('Delos Cloud service catalogue')).toBe('Delos Cloud');
      expect(lzCatalogueShortName('Plain name')).toBe('Plain name');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // CodeQL js/polynomial-redos (PR #1621): the `\s+service catalogue\s*$`
  // regex became trimEnd plus a suffix compare. The former regex is the oracle.
  describe('lzCatalogueShortName', () => {
    const oracle = (name: string) => {
      const short = name.replace(/\s+service catalogue\s*$/i, '').trim();
      return short.length > 0 ? short : name;
    };

    it('handles case, whitespace, empty and unicode names', () => {
      expect(lzCatalogueShortName('STACKIT Service Catalogue  ')).toBe('STACKIT');
      expect(lzCatalogueShortName('  Ionos\tservice catalogue\n')).toBe('Ionos');
      expect(lzCatalogueShortName('service catalogue')).toBe('service catalogue');
      expect(lzCatalogueShortName(' service catalogue')).toBe(' service catalogue');
      expect(lzCatalogueShortName('Xservice catalogue')).toBe('Xservice catalogue');
      expect(lzCatalogueShortName('')).toBe('');
      expect(lzCatalogueShortName('   ')).toBe('   ');
      expect(lzCatalogueShortName('Grüne Cloud service catalogue')).toBe('Grüne Cloud');
    });

    it('matches the former regex on random input (differential)', () => {
      const alphabet = [' ', '\t', '\n', 'a', 'service catalogue', 'SERVICE CATALOGUE', 'Service', ' catalogue', '\u0130', '\u017f'];
      let seed = 5;
      const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
      for (let k = 0; k < 3000; k++) {
        let s = '';
        const len = rnd(7);
        for (let i = 0; i < len; i++) s += alphabet[rnd(alphabet.length)];
        expect(lzCatalogueShortName(s), JSON.stringify(s)).toBe(oracle(s));
      }
    });

    it('stays fast on 50 000 spaces before a non-matching tail', () => {
      const raw = `a${' '.repeat(50_000)}x`;
      const t0 = performance.now();
      expect(lzCatalogueShortName(raw)).toBe(raw);
      expect(lzCatalogueShortName(`a${' '.repeat(50_000)}service catalogue${' '.repeat(50_000)}`)).toBe('a');
      expect(performance.now() - t0).toBeLessThan(200);
    });
  });

  it('#3298: an older workspace whose folder still carries an index.json keeps working; the index is never read', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-oldws-'));
    try {
      const catalogDir = join(tmp, 'wsp', 'inputs', 'catalogs', 'lz-catalogues');
      mkdirSync(catalogDir, { recursive: true });
      // Index from before #3298: lists a provider without a file and a stale name.
      writeFileSync(join(catalogDir, 'index.json'), JSON.stringify({
        catalogues: [
          { provider: 'aws', file: 'aws.json', name: 'Stale index name', last_updated: '2020-01-01', source: 'botocore-endpoints', confidence: 'high' },
          { provider: 'ghost', file: 'ghost.json', name: 'Ghost', last_updated: '2020-01-01', source: 'curated', confidence: 'low' },
        ],
        coming_soon: ['ghost-soon'],
      }));
      writeFileSync(join(catalogDir, 'aws.json'), VALID_CATALOGUE);
      expect(resolveLzCataloguesDir(undefined, tmp)).toBe(catalogDir);
      const providers = listLzCatalogueProviders(tmp);
      expect(providers).toContain('aws');
      expect(providers).not.toContain('ghost');
      expect(providers).not.toContain('index');
      const rows = listLzCatalogues(tmp);
      const aws = rows.find((r) => r.provider === 'aws')!;
      expect(aws).toMatchObject({ provenance: 'workspace', name: 'Test AWS', last_updated: '2026-08-06', file: 'aws.json' });
      expect(rows.find((r) => r.provider === 'azure')).toMatchObject({ provenance: 'bundled' });
      expect(loadLzComingSoon()).not.toContain('ghost-soon');
      expect(resolveProviderCatalogue('aws', tmp).provenance).toBe('workspace');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('#3298: directory resolution needs a catalogue file, not an index.json', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-marker-'));
    try {
      const only = join(tmp, 'index-only');
      mkdirSync(only);
      writeFileSync(join(only, 'index.json'), JSON.stringify({ catalogues: [] }));
      writeFileSync(join(only, '_lz-catalogue-template.json'), '{}');
      expect(isLzCataloguesDir(only)).toBe(false);
      const perProvider = join(tmp, 'per-provider');
      mkdirSync(join(perProvider, 'acme'), { recursive: true });
      writeFileSync(join(perProvider, 'acme', 'index.json'), '{}');
      expect(isLzCataloguesDir(perProvider)).toBe(true);
      expect(isLzCataloguesDir(join(tmp, 'missing'))).toBe(false);
      expect(resolveLzCataloguesDir(only)).not.toBe(only); // falls through to the bundle
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('bundled catalogues offer only deployable regions (no Azure billing zones, #3155)', () => {
    const dir = resolveLzCataloguesDir()!;
    const azure = loadLzCatalogue(dir, 'azure');
    expect(azure.regions.length).toBeGreaterThan(0);
    for (const r of azure.regions) expect(r.id, `azure region "${r.id}"`).toMatch(/^[a-z][a-z0-9]*$/);
    if (azure.meta.regions_count !== undefined) expect(azure.meta.regions_count).toBe(azure.regions.length);
  });

  it('listLzCatalogueProviders includes bundled providers and every workspace copy layout (#3155)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-list-'));
    try {
      const canonical = join(tmp, 'wsp', 'inputs', 'catalogs', 'lz-catalogues');
      mkdirSync(join(canonical, 'my-sovereign-csp'), { recursive: true });
      writeFileSync(join(canonical, 'my-sovereign-csp', 'index.json'), '{}');
      writeFileSync(join(canonical, 'flat-csp.json'), '{}');
      writeFileSync(join(canonical, '_lz-catalogue-template.json'), '{}');
      writeFileSync(join(canonical, 'aws-service-meta.json'), '{}');
      mkdirSync(join(tmp, 'lz-catalogues'), { recursive: true });
      writeFileSync(join(tmp, 'lz-catalogues', 'legacy-csp.json'), '{}');
      const providers = listLzCatalogueProviders(tmp);
      expect(providers).toEqual(expect.arrayContaining(['aws', 'azure', 'stackit', 'my-sovereign-csp', 'flat-csp', 'legacy-csp']));
      expect(providers).not.toContain('_lz-catalogue-template');
      expect(providers).not.toContain('aws-service-meta');
      expect(listLzCatalogueProviders()).not.toContain('my-sovereign-csp');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('nonexistent override falls back to bundled (never returns null)', () => {
    const dir = resolveLzCataloguesDir('/nonexistent/path/xyz');
    expect(dir).not.toBeNull();
    // Confirm it resolved to a real catalogue (not the nonexistent override).
    expect(discoverLzCatalogues(dir!).length).toBeGreaterThan(0);
  });

  it('workspace override wins over bundled when lz-catalogues/ holds a catalogue file (#3298)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-test-'));
    try {
      const catalogDir = join(tmp, 'lz-catalogues');
      mkdirSync(catalogDir);
      writeFileSync(join(catalogDir, 'aws.json'), VALID_CATALOGUE);
      const resolved = resolveLzCataloguesDir(undefined, tmp);
      expect(resolved).toBe(catalogDir);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('workspace override falls back to bundled when the workspace has no catalogue folder', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-test-'));
    try {
      // workspace root exists but has no lz-catalogues/ subdirectory
      const dir = resolveLzCataloguesDir(undefined, tmp);
      expect(dir).not.toBeNull();
      expect(discoverLzCatalogues(dir!).length).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('workspace new-path (wsp/inputs/catalogs/lz-catalogues/) wins when present (#1262)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-test-'));
    try {
      const catalogDir = join(tmp, 'wsp', 'inputs', 'catalogs', 'lz-catalogues');
      mkdirSync(catalogDir, { recursive: true });
      writeFileSync(join(catalogDir, 'azure.json'), VALID_CATALOGUE);
      const resolved = resolveLzCataloguesDir(undefined, tmp);
      expect(resolved).toBe(catalogDir);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('bundled STACKIT catalog contains both eu01 (Germany) and eu02 (Austria) -- regression for #1240', () => {
    const dir = resolveLzCataloguesDir()!;
    const cat = loadLzCatalogue(dir, 'stackit');
    const regionIds = cat.regions.map((r) => r.id);
    expect(regionIds).toContain('eu01');
    expect(regionIds).toContain('eu02');
    // eu01 must hold BSI_C5 -- the only STACKIT region that satisfies the BSI_C5 framework
    const eu01 = cat.regions.find((r) => r.id === 'eu01')!;
    expect(eu01.sovereignty?.certifications).toContain('BSI_C5');
    // eu02 must NOT hold BSI_C5 -- will remain SOVEREIGNTY_BLOCKED under BSI_C5 frameworks
    const eu02 = cat.regions.find((r) => r.id === 'eu02')!;
    expect(eu02.sovereignty?.certifications ?? []).not.toContain('BSI_C5');
  });
});

// Minimal valid catalogue for use in workspace-override tests.
const VALID_CATALOGUE = JSON.stringify({
  meta: {
    schema_version: '0.1',
    name: 'Test AWS',
    provider: 'aws',
    last_updated: '2026-08-06',
    source: { mode: 'curated' },
    confidence: 'medium',
  },
  regions: [{ id: 'eu-west-1', services: [] }],
});

const VALID_AZURE_CATALOGUE = JSON.stringify({
  meta: {
    schema_version: '0.1',
    name: 'Test Azure',
    provider: 'azure',
    last_updated: '2026-08-06',
    source: { mode: 'curated' },
    confidence: 'medium',
  },
  regions: [{ id: 'westeurope', services: [] }],
});

describe('resolveProviderCatalogue -- per-ID layer merge (#1437)', () => {
  it('resolves bundled provider when no workspace override exists', () => {
    const { catalogue, provenance } = resolveProviderCatalogue('aws');
    expect(provenance).toBe('bundled');
    expect(catalogue.meta.provider).toBe('aws');
  });

  it('provenance is bundled for all bundled providers', () => {
    for (const provider of ['aws', 'azure', 'gcp', 'stackit']) {
      const { provenance } = resolveProviderCatalogue(provider);
      expect(provenance, `${provider} should be bundled`).toBe('bundled');
    }
  });

  it('workspace canonical path wins and provenance is workspace', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-merge-'));
    try {
      const providerDir = join(tmp, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', 'aws');
      mkdirSync(providerDir, { recursive: true });
      writeFileSync(join(providerDir, 'index.json'), VALID_CATALOGUE);
      const { catalogue, provenance } = resolveProviderCatalogue('aws', tmp);
      expect(provenance).toBe('workspace');
      expect(catalogue.meta.name).toBe('Test AWS');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('per-ID isolation: aws workspace override does not affect azure (#1437 core contract)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-merge-'));
    try {
      // Only AWS has a workspace override.
      const awsDir = join(tmp, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', 'aws');
      mkdirSync(awsDir, { recursive: true });
      writeFileSync(join(awsDir, 'index.json'), VALID_CATALOGUE);

      const aws = resolveProviderCatalogue('aws', tmp);
      expect(aws.provenance).toBe('workspace');
      expect(aws.catalogue.meta.name).toBe('Test AWS');

      // Azure must still come from bundled (not shadowed by the AWS override).
      const azure = resolveProviderCatalogue('azure', tmp);
      expect(azure.provenance).toBe('bundled');
      expect(azure.catalogue.meta.provider).toBe('azure');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('workspace legacy flat file (no per-provider subdir) also yields workspace provenance', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-merge-'));
    try {
      const catalogDir = join(tmp, 'wsp', 'inputs', 'catalogs', 'lz-catalogues');
      mkdirSync(catalogDir, { recursive: true });
      // Write azure as flat file (legacy path) alongside the directory that contains aws override.
      writeFileSync(join(catalogDir, 'azure.json'), VALID_AZURE_CATALOGUE);
      const { catalogue, provenance } = resolveProviderCatalogue('azure', tmp);
      expect(provenance).toBe('workspace');
      expect(catalogue.meta.provider).toBe('azure');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('LzCatalogueSchemaError thrown when workspace file has invalid JSON (#1436)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-merge-'));
    try {
      const providerDir = join(tmp, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', 'aws');
      mkdirSync(providerDir, { recursive: true });
      writeFileSync(join(providerDir, 'index.json'), 'NOT VALID JSON {{{');
      expect(() => resolveProviderCatalogue('aws', tmp)).toThrow(LzCatalogueSchemaError);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('LzCatalogueSchemaError thrown when workspace file fails schema (strict mode) (#1436)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-merge-'));
    try {
      const providerDir = join(tmp, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', 'aws');
      mkdirSync(providerDir, { recursive: true });
      // Catalogue with an unrecognised top-level key (schema is strict()).
      writeFileSync(join(providerDir, 'index.json'), JSON.stringify({
        meta: { schema_version: '0.1', name: 'AWS', provider: 'aws', last_updated: '2026-08-06', source: { mode: 'curated' }, confidence: 'high' },
        regions: [],
        _unrecognised_key: true,
      }));
      expect(() => resolveProviderCatalogue('aws', tmp)).toThrow(LzCatalogueSchemaError);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('LzCatalogueDuplicateIdError thrown when workspace catalogue has duplicate region IDs (#1436)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-merge-'));
    try {
      const providerDir = join(tmp, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', 'aws');
      mkdirSync(providerDir, { recursive: true });
      writeFileSync(join(providerDir, 'index.json'), JSON.stringify({
        meta: { schema_version: '0.1', name: 'AWS', provider: 'aws', last_updated: '2026-08-06', source: { mode: 'curated' }, confidence: 'high' },
        regions: [
          { id: 'eu-central-1', services: [] },
          { id: 'eu-central-1', services: [] },
        ],
      }));
      expect(() => resolveProviderCatalogue('aws', tmp)).toThrow(LzCatalogueDuplicateIdError);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('schema error does NOT fall back to bundled (no silent fallback) (#1436)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-merge-'));
    try {
      const providerDir = join(tmp, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', 'aws');
      mkdirSync(providerDir, { recursive: true });
      writeFileSync(join(providerDir, 'index.json'), '"not-an-object"');
      // Must throw, not silently return bundled.
      expect(() => resolveProviderCatalogue('aws', tmp)).toThrow(LzCatalogueSchemaError);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
