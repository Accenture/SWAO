// #3150: every bundled community framework catalogue must load against the
// regime catalogue schema (EC_CSF and SECNUMCLOUD previously failed on the
// `signal:` evidence key, so Pass 11 reported "no catalog found").
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegimeCatalogue } from './compliance-registry.js';

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
