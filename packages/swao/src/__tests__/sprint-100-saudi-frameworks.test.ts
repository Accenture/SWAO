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

// Sprint-100 #1133-#1143: Schema validation for Saudi Arabia community frameworks.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import { describe, it, expect } from 'vitest';
import { RegimeCatalogueSchema } from '@swao/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORKS_DIR = join(
  __dirname,
  '../../../../packages/@swao/community-frameworks/frameworks',
);

const SAUDI_FRAMEWORKS = [
  { id: 'NCA_ECC', folder: 'nca-ecc-2-2024', minControls: 28, maxControls: 28 },
  { id: 'NCA_ECC_DEMO', folder: 'nca-ecc-demo', minControls: 18, maxControls: 22 },
  { id: 'NCA_CCC_CST', folder: 'nca-ccc-2-2024-cst', minControls: 15, maxControls: 22 },
  { id: 'NCA_CCC_CSP', folder: 'nca-ccc-2-2024-csp', minControls: 30, maxControls: 40 },
  { id: 'SAMA_CSF', folder: 'sama-csf-v1', minControls: 28, maxControls: 32 },
];

describe('Saudi Arabia community frameworks -- Sprint-100 (#1133-#1143)', () => {
  for (const fw of SAUDI_FRAMEWORKS) {
    it(`${fw.id} controls.yaml parses through RegimeCatalogueSchema with no errors`, () => {
      const path = join(FRAMEWORKS_DIR, fw.folder, 'controls.yaml');
      const raw = load(readFileSync(path, 'utf-8'));
      const result = RegimeCatalogueSchema.safeParse(raw);
      if (!result.success) {
        console.error(`${fw.id} errors:`, JSON.stringify(result.error.issues, null, 2));
      }
      expect(result.success).toBe(true);
    });

    it(`${fw.id} has the expected number of controls (${fw.minControls}-${fw.maxControls})`, () => {
      const path = join(FRAMEWORKS_DIR, fw.folder, 'controls.yaml');
      const raw = load(readFileSync(path, 'utf-8')) as { controls: unknown[] };
      const count = Array.isArray(raw.controls) ? raw.controls.length : 0;
      expect(count).toBeGreaterThanOrEqual(fw.minControls);
      expect(count).toBeLessThanOrEqual(fw.maxControls);
    });

    it(`${fw.id} regime_meta.id matches the expected framework ID`, () => {
      const path = join(FRAMEWORKS_DIR, fw.folder, 'controls.yaml');
      const raw = load(readFileSync(path, 'utf-8')) as { regime_meta: { id: string } };
      expect(raw.regime_meta?.id).toBe(fw.id);
    });
  }

  it('all Saudi framework signal_prefix values are distinct and follow NCA_*/SAMA_* pattern', () => {
    const prefixes: string[] = [];
    for (const fw of SAUDI_FRAMEWORKS) {
      const path = join(FRAMEWORKS_DIR, fw.folder, 'controls.yaml');
      const raw = load(readFileSync(path, 'utf-8')) as { regime_meta: { signal_prefix?: string } };
      const prefix = raw.regime_meta?.signal_prefix;
      if (prefix) prefixes.push(prefix);
    }
    const uniquePrefixes = new Set(prefixes);
    expect(uniquePrefixes.size).toBe(prefixes.length);
    for (const p of prefixes) {
      expect(p).toMatch(/^(NCA_|SAMA_)/);
    }
  });

  it('no controls.yaml file contains em-dashes (U+2014) or en-dashes (U+2013)', () => {
    for (const fw of SAUDI_FRAMEWORKS) {
      const path = join(FRAMEWORKS_DIR, fw.folder, 'controls.yaml');
      const bytes = readFileSync(path);
      const emDash = Buffer.from([0xe2, 0x80, 0x94]); // U+2014 UTF-8
      const enDash = Buffer.from([0xe2, 0x80, 0x93]); // U+2013 UTF-8
      const hasEm = bytes.indexOf(emDash) >= 0;
      const hasEn = bytes.indexOf(enDash) >= 0;
      expect(hasEm, `${fw.id} has em-dash`).toBe(false);
      expect(hasEn, `${fw.id} has en-dash`).toBe(false);
    }
  });
});
