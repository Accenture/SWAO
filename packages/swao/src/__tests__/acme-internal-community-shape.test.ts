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

// Shape contract for the acme-internal community fixture.
//
// Sprint-036 Phase E migrated `examples/portfolio-workspace/portfolio/catalogs/
// acme-internal/{catalog.yaml + controls/*.yaml}` to the design-029 shape at
// `catalogs/overlay/acme-internal/{framework-meta.yaml, input.csv,
// controls.yaml}`. Sprint-037 #0341 further moved this to `catalogs/community/
// acme-internal/` per design 029 §11 (unified community-frameworks scope; the
// overlay/community dichotomy is replaced by a single community scope; the
// `classification:` field that this test originally also pinned was removed
// in sprint-038 #0349). This test pins the current layout so future edits cannot silently
// reintroduce either the legacy or the overlay-named layout.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname = swao/packages/swao/src/__tests__
// fixture lives at examples/portfolio-workspace/portfolio in the private repo root (NOT under
// packages/swao/examples -- the examples dir is a sibling of packages/)
const FIXTURE_ROOT = resolve(__dirname, '..', '..', '..', '..', '..', 'examples', 'portfolio-workspace', 'portfolio');
const CURRENT_LAYOUT_DIR = join(FIXTURE_ROOT, 'catalogs', 'community', 'acme-internal');
const OVERLAY_LAYOUT_DIR = join(FIXTURE_ROOT, 'catalogs', 'overlay', 'acme-internal');
const LEGACY_LAYOUT_DIR = join(FIXTURE_ROOT, 'catalogs', 'acme-internal');

describe('acme-internal community fixture (sprint-037 #0341 -- design-029 §11 shape)', () => {
  it('community layout directory exists at catalogs/community/acme-internal/', () => {
    expect(existsSync(CURRENT_LAYOUT_DIR)).toBe(true);
  });

  it('framework-meta.yaml + input.csv + controls.yaml all present at the community path', () => {
    expect(existsSync(join(CURRENT_LAYOUT_DIR, 'framework-meta.yaml'))).toBe(true);
    expect(existsSync(join(CURRENT_LAYOUT_DIR, 'input.csv'))).toBe(true);
    expect(existsSync(join(CURRENT_LAYOUT_DIR, 'controls.yaml'))).toBe(true);
  });

  it('overlay layout directory does NOT exist (sprint-037 #0341 moved the fixture)', () => {
    expect(existsSync(OVERLAY_LAYOUT_DIR)).toBe(false);
  });

  it('legacy layout directory does NOT exist (catalog.yaml + controls/ removed)', () => {
    expect(existsSync(LEGACY_LAYOUT_DIR)).toBe(false);
    expect(existsSync(join(LEGACY_LAYOUT_DIR, 'catalog.yaml'))).toBe(false);
    expect(existsSync(join(LEGACY_LAYOUT_DIR, 'controls'))).toBe(false);
  });

  it('framework-meta.yaml declares the ACME_INTERNAL framework id', () => {
    const yml = load(readFileSync(join(CURRENT_LAYOUT_DIR, 'framework-meta.yaml'), 'utf-8')) as { framework: { id: string } };
    expect(yml.framework.id).toBe('ACME_INTERNAL');
  });

  it('input.csv has header + at least one control row', () => {
    const csv = readFileSync(join(CURRENT_LAYOUT_DIR, 'input.csv'), 'utf-8');
    const lines = csv.split('\n').filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);  // header + 1+ rows
    expect(lines[0]).toMatch(/control_id/);
    expect(lines[0]).toMatch(/evidence_kind/);
  });

  it('input.csv carries ACME-SEC-001 (the legacy control migrated verbatim)', () => {
    const csv = readFileSync(join(CURRENT_LAYOUT_DIR, 'input.csv'), 'utf-8');
    expect(csv).toContain('ACME-SEC-001');
    expect(csv).toMatch(/BYOK/i);
  });

  it('controls.yaml has the RegimeCatalogueSchema shape (regime_id + controls list)', () => {
    const yml = load(readFileSync(join(CURRENT_LAYOUT_DIR, 'controls.yaml'), 'utf-8')) as { regime_id: string; controls: Array<{ id: string }> };
    expect(yml.regime_id).toBe('ACME_INTERNAL');
    expect(Array.isArray(yml.controls)).toBe(true);
    expect(yml.controls.length).toBeGreaterThanOrEqual(1);
    expect(yml.controls.some((c) => c.id === 'ACME-SEC-001')).toBe(true);
  });

  it('preserves the maps_to / overrides relationship with GDPR_Art_32 + ISO_A.8.24 from the legacy fixture', () => {
    const yml = load(readFileSync(join(CURRENT_LAYOUT_DIR, 'controls.yaml'), 'utf-8')) as {
      controls: Array<{ id: string; maps_to?: string[]; overrides?: string[] }>;
    };
    const c = yml.controls.find((x) => x.id === 'ACME-SEC-001');
    expect(c).toBeDefined();
    expect(c!.maps_to).toContain('GDPR_Art_32');
    expect(c!.maps_to).toContain('ISO_A.8.24');
  });
});
