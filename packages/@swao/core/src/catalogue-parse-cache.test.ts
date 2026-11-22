// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4410: the community frameworks probe parsed each controls.yaml three times.
// Inside withCatalogueParseCache a file is parsed once; outside nothing is cached.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadYamlFile, withCatalogueParseCache } from './compliance-registry.js';

describe('#4410 withCatalogueParseCache', () => {
  it('parses a file once inside the scope and fresh outside it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-4410-'));
    try {
      const f = join(dir, 'controls.yaml');
      writeFileSync(f, 'regime_meta:\n  id: X\n');
      const [a, b] = withCatalogueParseCache(() => [loadYamlFile(f), loadYamlFile(f)]);
      expect(a).toBe(b);
      // Nested scopes share the outer cache.
      const nested = withCatalogueParseCache(() => withCatalogueParseCache(() => loadYamlFile(f)) === loadYamlFile(f));
      expect(nested).toBe(true);
      // Outside the scope a changed file is read again.
      writeFileSync(f, 'regime_meta:\n  id: Y\n');
      expect(loadYamlFile(f)).toEqual({ regime_meta: { id: 'Y' } });
      expect(loadYamlFile(f)).not.toBe(loadYamlFile(f));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
