// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * i18n label file validation (#0435).
 *
 * The i18n YAML assets (en.yaml / de.yaml) relocated to the
 * @swao/publication-render leaf alongside the rendering engine (#0582), so these
 * tests moved here with them; they read I18N_DIR from this file's own __dirname.
 */

import { describe, it, expect } from 'vitest';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { load as loadYaml } from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('i18n label files', () => {
  const I18N_DIR = join(__dirname, 'i18n');

  it('en.yaml is valid YAML and has severity keys', () => {
    const raw = readFileSync(join(I18N_DIR, 'en.yaml'), 'utf-8');
    const data = loadYaml(raw) as Record<string, unknown>;
    expect(data).toBeDefined();
    expect(data.severity).toBeDefined();
    const sev = data.severity as Record<string, string>;
    expect(sev.critical).toBe('Critical');
    expect(sev.high).toBe('High');
  });

  it('de.yaml is valid YAML and has severity keys', () => {
    const raw = readFileSync(join(I18N_DIR, 'de.yaml'), 'utf-8');
    const data = loadYaml(raw) as Record<string, unknown>;
    expect(data).toBeDefined();
    expect(data.severity).toBeDefined();
    const sev = data.severity as Record<string, string>;
    expect(typeof sev.critical).toBe('string');
    expect(typeof sev.high).toBe('string');
  });

  it('de.yaml has same top-level keys as en.yaml', () => {
    const en = loadYaml(readFileSync(join(I18N_DIR, 'en.yaml'), 'utf-8')) as Record<string, unknown>;
    const de = loadYaml(readFileSync(join(I18N_DIR, 'de.yaml'), 'utf-8')) as Record<string, unknown>;
    const enKeys = Object.keys(en).sort();
    const deKeys = Object.keys(de).sort();
    expect(deKeys).toEqual(enKeys);
  });

  it('en.yaml has classification.band key', () => {
    const data = loadYaml(readFileSync(join(I18N_DIR, 'en.yaml'), 'utf-8')) as Record<string, unknown>;
    const classification = data.classification as Record<string, string>;
    expect(classification?.band).toBeDefined();
  });
});
