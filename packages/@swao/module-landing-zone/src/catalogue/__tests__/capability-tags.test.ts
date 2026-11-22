// #3577: capability tags in use = union of `fulfills` over the resolved provider
// catalogues (denominator of the service-mapping coverage, Design 120 §8.2).

import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectLzCapabilityTags, resolveProviderCatalogue, listLzCatalogueProviders } from '../loader.js';

function catalogue(provider: string, fulfills: string[][]): string {
  return JSON.stringify({
    meta: { schema_version: '0.1', name: `Test ${provider}`, provider, last_updated: '2026-11-02', source: { mode: 'curated' }, confidence: 'medium' },
    regions: [{ id: 'r1', services: fulfills.map((f, i) => ({ code: `svc-${i}`, fulfills: f })) }],
  });
}

describe('collectLzCapabilityTags (#3577)', () => {
  it('returns the sorted union of fulfills tags over every bundled provider catalogue', () => {
    const { tags, providers, skipped } = collectLzCapabilityTags();
    expect(skipped).toEqual([]);
    expect(providers).toEqual(listLzCatalogueProviders());
    const expected = new Set<string>();
    for (const p of providers) {
      for (const r of resolveProviderCatalogue(p).catalogue.regions) for (const s of r.services) for (const t of s.fulfills) expected.add(t);
    }
    expect(tags).toEqual([...expected].sort());
    expect(tags).toContain('key_vault');
    expect(tags.every((t) => /^[a-z][a-z0-9_]*$/.test(t))).toBe(true);
  });

  it('uses the workspace catalogue of a provider instead of the bundled one and skips a broken one', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-tags-'));
    try {
      const dir = join(tmp, 'wsp', 'inputs', 'catalogs', 'lz-catalogues');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'aws.json'), catalogue('aws', [['onprem_only_tag'], ['vm_compute', 'onprem_only_tag']]));
      writeFileSync(join(dir, 'azure.json'), '{ not json');

      const bundledAws = new Set(resolveProviderCatalogue('aws').catalogue.regions.flatMap((r) => r.services.flatMap((s) => s.fulfills)));
      const { tags, providers, skipped } = collectLzCapabilityTags(tmp);
      expect(tags).toContain('onprem_only_tag');
      expect(skipped).toEqual(['azure']);
      expect(providers).toContain('aws');
      expect(providers).not.toContain('azure');
      // A tag only the bundled AWS catalogue carries, and no other bundled provider, disappears.
      const others = new Set(providers.filter((p) => p !== 'aws').flatMap((p) => resolveProviderCatalogue(p, tmp).catalogue.regions.flatMap((r) => r.services.flatMap((s) => s.fulfills))));
      const awsOnly = [...bundledAws].filter((t) => !others.has(t) && t !== 'vm_compute');
      expect(awsOnly.length).toBeGreaterThan(0);
      for (const t of awsOnly) expect(tags).not.toContain(t);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
