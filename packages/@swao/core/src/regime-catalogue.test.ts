// #3150: every bundled community framework catalogue must load against the
// regime catalogue schema (EC_CSF and SECNUMCLOUD previously failed on the
// `signal:` evidence key, so Pass 11 reported "no catalog found").
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegimeCatalogue } from './compliance-registry.js';
import { RegimeControlSchema, controlIdAliases, resolveControlIdKey } from './regime-catalogue.js';

const here = dirname(fileURLToPath(import.meta.url));
const FRAMEWORKS = join(here, '..', '..', 'community-frameworks', 'frameworks');

const folders = existsSync(FRAMEWORKS)
  ? readdirSync(FRAMEWORKS, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(FRAMEWORKS, d.name, 'controls.yaml'))).map((d) => d.name)
  : [];

describe('bundled community framework catalogues (#3150)', () => {
  it('finds the bundled frameworks', () => {
    expect(folders.length).toBeGreaterThanOrEqual(24);
  });

  it.each(folders)('%s loads against the regime catalogue schema', (folder) => {
    expect(() => loadRegimeCatalogue(join(FRAMEWORKS, folder, 'controls.yaml'))).not.toThrow();
  });
});

// #3425: control-level assessment_type_scope was stripped by the schema, so
// Pass 11 could not honour it; the KRITIS sector controls carry applies_when.
describe('KRITIS_DE sector controls (#3425)', () => {
  it('keeps assessment_type_scope and applies_when.kritis_sector after parsing', () => {
    const cat = loadRegimeCatalogue(join(FRAMEWORKS, 'kritis-de', 'controls.yaml'));
    const byId = new Map(cat.controls.map((c) => [c.id, c]));
    const sectors: Record<string, string> = {
      KRITIS_DE_SEC_ENE: 'energy|water', KRITIS_DE_SEC_HLT: 'health', KRITIS_DE_SEC_FIN: 'finance',
      KRITIS_DE_SEC_TRN: 'transport', KRITIS_DE_SEC_ICT: 'ict',
    };
    for (const [id, sector] of Object.entries(sectors)) {
      expect(byId.get(id)?.applies_when).toEqual({ kritis_sector: sector });
      expect(byId.get(id)?.assessment_type_scope).toEqual(['aud']);
    }
    expect(byId.get('KRITIS_DE_SEC_DACHG')?.applies_when).toBeUndefined();
  });
});

// #3962: corrected control ids keep the old id resolvable (control-level replaces).
describe('control-level replaces (#3962)', () => {
  it('keeps replaces after parsing a control', () => {
    const c = RegimeControlSchema.parse({ id: 'X_Art_17_1', title: 'Incident process', description: 'An incident management process.', replaces: ['X_Art_15'] });
    expect(c.replaces).toEqual(['X_Art_15']);
  });

  it('maps an old id to the current id, case-insensitively', () => {
    const aliases = controlIdAliases([{ id: 'X_Art_17_1', replaces: ['X_Art_15'] }, { id: 'X_Art_19_1', replaces: ['X_Art_17'] }]);
    expect(resolveControlIdKey('X_Art_15', aliases)).toBe('x_art_17_1');
    expect(resolveControlIdKey('x_art_17', aliases)).toBe('x_art_19_1');
    expect(resolveControlIdKey('X_Art_19_1', aliases)).toBe('x_art_19_1');
  });

  it('never re-points a current id and keeps the first claim of an old id', () => {
    const aliases = controlIdAliases([
      { id: 'A', replaces: ['B', 'OLD'] },
      { id: 'B' },
      { id: 'C', replaces: ['OLD', 42] },
    ]);
    expect(aliases.has('b')).toBe(false);
    expect(aliases.get('old')).toBe('a');
    expect(aliases.size).toBe(1);
  });
});
