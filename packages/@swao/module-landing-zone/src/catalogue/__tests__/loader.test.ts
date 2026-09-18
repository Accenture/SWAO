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
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  resolveLzCataloguesDir,
  loadLzCatalogueIndex,
  loadLzCatalogue,
  resolveProviderCatalogue,
  LzCatalogueSchemaError,
  LzCatalogueDuplicateIdError,
} from '../loader.js';

describe('LZ catalogue loader (#0567)', () => {
  it('resolves the bundled lz-catalogues dir + loads the index', () => {
    const dir = resolveLzCataloguesDir();
    expect(dir).not.toBeNull();
    const index = loadLzCatalogueIndex(dir!);
    const providers = index.catalogues.map((c) => c.provider);
    expect(providers).toContain('aws');
    expect(providers).toContain('azure');
    expect(providers).toContain('stackit');
    expect(providers).toContain('gcp');
  });

  it('loads + validates each indexed provider catalogue', () => {
    const dir = resolveLzCataloguesDir()!;
    for (const entry of loadLzCatalogueIndex(dir).catalogues) {
      const cat = loadLzCatalogue(dir, entry.provider);
      expect(cat.meta.provider).toBe(entry.provider);
      // every service declares its fulfilled capabilities (the bridge)
      for (const region of cat.regions) {
        for (const svc of region.services) expect(Array.isArray(svc.fulfills)).toBe(true);
      }
    }
  });

  it('nonexistent override falls back to bundled (never returns null)', () => {
    const dir = resolveLzCataloguesDir('/nonexistent/path/xyz');
    expect(dir).not.toBeNull();
    // Confirm it resolved to a real catalogue (not the nonexistent override).
    expect(loadLzCatalogueIndex(dir!).catalogues.length).toBeGreaterThan(0);
  });

  it('workspace override wins over bundled when lz-catalogues/index.json present', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-test-'));
    try {
      const catalogDir = join(tmp, 'lz-catalogues');
      mkdirSync(catalogDir);
      writeFileSync(join(catalogDir, 'index.json'), JSON.stringify({ catalogues: [], coming_soon: [] }));
      const resolved = resolveLzCataloguesDir(undefined, tmp);
      expect(resolved).toBe(catalogDir);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('workspace override falls back to bundled when no lz-catalogues/index.json in workspace', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-test-'));
    try {
      // workspace root exists but has no lz-catalogues/ subdirectory
      const dir = resolveLzCataloguesDir(undefined, tmp);
      expect(dir).not.toBeNull();
      expect(loadLzCatalogueIndex(dir!).catalogues.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('workspace new-path (wsp/inputs/catalogs/lz-catalogues/) wins when present (#1262)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-test-'));
    try {
      const catalogDir = join(tmp, 'wsp', 'inputs', 'catalogs', 'lz-catalogues');
      mkdirSync(catalogDir, { recursive: true });
      writeFileSync(join(catalogDir, 'index.json'), JSON.stringify({ catalogues: [], coming_soon: [] }));
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
