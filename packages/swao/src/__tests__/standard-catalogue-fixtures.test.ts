// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { load } from 'js-yaml';
import { describe, it, expect } from 'vitest';
import {
  RegimeCatalogueSchema,
  RegimeIndexSchema,
} from '../schema/regime-catalogue.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STANDARD_DIR = join(__dirname, '../../../../controls/standard');

// #0320 pattern: skipIf the controls/standard directory hasn't been populated yet.
// These tests exercise the standard catalogue fixtures when present; they auto-enable
// once the directory is created without any test-file edits required.
const standardDirExists = existsSync(STANDARD_DIR);

function loadYaml(filePath: string): unknown {
  return load(readFileSync(filePath, 'utf-8'));
}

describe('Standard regime catalogue fixtures (#0162)', () => {
  it.skipIf(!standardDirExists)('index.yaml parses against RegimeIndexSchema', () => {
    const raw = loadYaml(join(STANDARD_DIR, 'index.yaml'));
    const result = RegimeIndexSchema.safeParse(raw);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it.skipIf(!standardDirExists)('index.yaml lists all seven flagship regimes', () => {
    const idx = RegimeIndexSchema.parse(loadYaml(join(STANDARD_DIR, 'index.yaml')));
    const ids = idx.regimes.map((r) => r.id);
    expect(ids).toEqual([
      'GDPR',
      'HIPAA',
      'PCI_DSS',
      'ISO_27001',
      'SOC_2',
      'BSI_C5',
      'DORA',
    ]);
  });

  it.skipIf(!standardDirExists)('every catalogue file referenced by index.yaml exists and parses', () => {
    const idx = RegimeIndexSchema.parse(loadYaml(join(STANDARD_DIR, 'index.yaml')));
    for (const entry of idx.regimes) {
      const catalogue = loadYaml(join(STANDARD_DIR, entry.file));
      const result = RegimeCatalogueSchema.safeParse(catalogue);
      if (!result.success) {
        console.error(`[${entry.id}] ${entry.file}:`, JSON.stringify(result.error.issues, null, 2));
      }
      expect(result.success).toBe(true);
    }
  });

  it.skipIf(!standardDirExists)('regime_meta.id matches index entry for every catalogue', () => {
    const idx = RegimeIndexSchema.parse(loadYaml(join(STANDARD_DIR, 'index.yaml')));
    for (const entry of idx.regimes) {
      const cat = RegimeCatalogueSchema.parse(loadYaml(join(STANDARD_DIR, entry.file)));
      expect(cat.regime_meta.id).toBe(entry.id);
      expect(cat.regime_meta.scope).toBe('standard');
      expect(cat.regime_meta.version).toBe(entry.version);
    }
  });

  it.skipIf(!standardDirExists)('controls.length matches controls_count in index for every regime', () => {
    const idx = RegimeIndexSchema.parse(loadYaml(join(STANDARD_DIR, 'index.yaml')));
    for (const entry of idx.regimes) {
      const cat = RegimeCatalogueSchema.parse(loadYaml(join(STANDARD_DIR, entry.file)));
      expect(cat.controls.length).toBe(entry.controls_count);
    }
  });

  it.skipIf(!standardDirExists)('every control has at least one evidence_basis entry', () => {
    const files = readdirSync(STANDARD_DIR).filter((f) => f.endsWith('-controls.yaml'));
    for (const file of files) {
      const cat = RegimeCatalogueSchema.parse(loadYaml(join(STANDARD_DIR, file)));
      for (const ctrl of cat.controls) {
        expect(
          ctrl.evidence_basis.length,
          `${cat.regime_meta.id} / ${ctrl.id} has no evidence_basis`,
        ).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it.skipIf(!standardDirExists)('every control id is unique within its regime', () => {
    const files = readdirSync(STANDARD_DIR).filter((f) => f.endsWith('-controls.yaml'));
    for (const file of files) {
      const cat = RegimeCatalogueSchema.parse(loadYaml(join(STANDARD_DIR, file)));
      const ids = cat.controls.map((c) => c.id);
      const unique = new Set(ids);
      expect(unique.size, `${cat.regime_meta.id} has duplicate control IDs`).toBe(ids.length);
    }
  });

  it.skipIf(!standardDirExists)('no flagship ID collides across regimes', () => {
    const files = readdirSync(STANDARD_DIR).filter((f) => f.endsWith('-controls.yaml'));
    const seen = new Map<string, string>();
    for (const file of files) {
      const cat = RegimeCatalogueSchema.parse(loadYaml(join(STANDARD_DIR, file)));
      for (const ctrl of cat.controls) {
        if (seen.has(ctrl.id)) {
          throw new Error(
            `Control id ${ctrl.id} appears in both ${seen.get(ctrl.id)} and ${cat.regime_meta.id}`,
          );
        }
        seen.set(ctrl.id, cat.regime_meta.id);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });
});
