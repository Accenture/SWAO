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
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  parseLzCatalogue,
  safeParseLzCatalogue,
  regionHasService,
  findRegion,
  type LzServiceCatalogue,
} from '../lz-service-catalogue.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// core/src/__tests__ -> up 5 to swao/, then lz-catalogues/
const CATALOGUES_DIR = join(__dirname, '../../../../../lz-catalogues');

const VALID: LzServiceCatalogue = {
  meta: {
    schema_version: '0.1',
    name: 'Test',
    provider: 'aws',
    last_updated: '2026-06-24',
    source: { mode: 'curated' },
    confidence: 'high',
  },
  regions: [
    {
      id: 'eu-central-1',
      country: 'DE',
      sovereignty: { residency_country: 'DE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act'], certifications: ['C5'] },
      services: [{ code: 's3', status: 'ga', capabilities: ['cmek'], key_custody: ['byok'] }],
    },
  ],
};

describe('LzServiceCatalogue schema (#0565)', () => {
  it('parses a valid catalogue + applies array defaults', () => {
    const c = parseLzCatalogue(VALID);
    expect(c.meta.provider).toBe('aws');
    expect(c.regions[0]!.services[0]!.capabilities).toEqual(['cmek']);
  });

  it('rejects unknown top-level/region fields (strict; catches hand-edit typos)', () => {
    const bad = { ...VALID, regions: [{ ...VALID.regions[0], regio: 'typo' }] };
    const r = safeParseLzCatalogue(bad);
    expect(r.ok).toBe(false);
  });

  it('regionHasService matches GA/preview only', () => {
    const region = VALID.regions[0]!;
    expect(regionHasService(region, 's3')).toBe(true);
    expect(regionHasService(region, 'nonexistent')).toBe(false);
  });

  it('findRegion resolves by id', () => {
    expect(findRegion(VALID, 'eu-central-1')?.country).toBe('DE');
    expect(findRegion(VALID, 'nope')).toBeUndefined();
  });

  it('sovereignty stores facts only (no tier/score field)', () => {
    const c = parseLzCatalogue(VALID);
    const sov = c.regions[0]!.sovereignty!;
    expect(sov).not.toHaveProperty('tier');
    expect(sov).not.toHaveProperty('score');
    expect(sov.extraterritorial_exposure).toContain('us_cloud_act');
  });
});

describe('seeded LZ catalogue snapshots validate (#0565)', () => {
  it('every swao/lz-catalogues/*.json (except index) parses against the schema', () => {
    expect(existsSync(CATALOGUES_DIR)).toBe(true);
    // aws-service-meta.json is botocore display metadata, not a service catalogue (#0781)
    const NON_CATALOGUE = new Set(['index.json', 'aws-service-meta.json']);
    // `_`-prefixed files are authoring templates (with `_comment*` keys), never loaded at
    // runtime; the loaders and health-check probes skip them. Validated separately below.
    const files = readdirSync(CATALOGUES_DIR).filter(
      (f) => f.endsWith('.json') && !NON_CATALOGUE.has(f) && !f.startsWith('_'),
    );
    expect(files.length).toBeGreaterThanOrEqual(4); // aws, aws-esc, azure, stackit
    for (const f of files) {
      const raw = JSON.parse(readFileSync(join(CATALOGUES_DIR, f), 'utf-8'));
      const r = safeParseLzCatalogue(raw);
      if (!r.ok) throw new Error(`${f} failed schema validation:\n  ${r.issues.join('\n  ')}`);
      expect(r.ok).toBe(true);
    }
  });

  it('_lz-catalogue-template.json validates once its _comment keys are stripped (#3143)', () => {
    const stripComments = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(stripComments);
      if (v !== null && typeof v === 'object') {
        return Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .filter(([k]) => !k.startsWith('_comment'))
            .map(([k, val]) => [k, stripComments(val)]),
        );
      }
      return v;
    };
    const raw = JSON.parse(readFileSync(join(CATALOGUES_DIR, '_lz-catalogue-template.json'), 'utf-8'));
    const r = safeParseLzCatalogue(stripComments(raw));
    if (!r.ok) throw new Error(`template failed schema validation:\n  ${r.issues.join('\n  ')}`);
    expect(r.ok).toBe(true);
  });
});
