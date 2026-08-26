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

// Sprint-037 #0343: full test-suite integration of the community GDPR
// framework. Codifies the operator's sprint-close gate ("ensure this new
// default 'community framework' is also embedded into our full test
// suite") as automated coverage.
//
// Five parts, one test each:
//   Part A -- pass-11 catalog-load wires through the registry walker
//   Part B -- GDPR controls.yaml parses via RegimeCatalogueSchema
//   Part C -- doctor probe per-framework summary (cross-ref #0342)
//   Part D -- coexistence + scope-rename regression
//   Part E -- regression-pin snapshot
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { load } from 'js-yaml';
import { scaffoldCatalogs } from '../commands/init.js';
// compliance-catalogues probe relocated to @swao/module-doctor (#0573).
import { buildCommunityFrameworksProbe } from '@swao/module-health-check';
import { loadRegimeRegistry, loadRegimeCatalogue } from '../compliance/registry.js';
import { RegimeCatalogueSchema } from '../schema/regime-catalogue.js';
import { communityFrameworksDir } from '@swao/community-frameworks';

const BUNDLED_GDPR_CONTROLS = join(communityFrameworksDir, 'gdpr', 'controls.yaml');

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-gdpr-suite-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('sprint-037 #0343 GDPR community-framework full test-suite integration', () => {
  // ── Part A -- pass-11 catalog-load path ─────────────────────────────────

  it('Part A: registry-resolved GDPR_DEMO catalogue loads via loadRegimeCatalogue (11 controls)', () => {
    // Demo variants scaffold by default since commit 16e129ed.
    // Full GDPR (53 controls) is still in the package and tested in Part B.
    scaffoldCatalogs(tmp);
    const registry = loadRegimeRegistry(join(tmp, 'wsp', 'inputs', 'catalogs'));
    const gdpr = registry.byId.get('GDPR_DEMO');
    expect(gdpr).toBeDefined();
    expect(gdpr?.scope).toBe('community');
    const catalogue = loadRegimeCatalogue(gdpr!.catalogueFile);
    expect(catalogue.regime_meta.id).toBe('GDPR_DEMO');
    expect(catalogue.controls.length).toBe(11);
  });

  // ── Part B -- RegimeCatalogueSchema parse ────────────────────────────────

  it('Part B: bundled GDPR controls.yaml parses through RegimeCatalogueSchema (53 controls, 0 errors)', () => {
    expect(existsSync(BUNDLED_GDPR_CONTROLS)).toBe(true);
    const raw = load(readFileSync(BUNDLED_GDPR_CONTROLS, 'utf-8'));
    const parsed = RegimeCatalogueSchema.safeParse(raw);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3), null, 2)).toBe(true);
    if (parsed.success) {
      expect(parsed.data.controls.length).toBe(53);
      expect(parsed.data.regime_meta.id).toBe('GDPR');
      expect(parsed.data.regime_meta.signal_prefix).toBe('GDPR');
    }
  });

  // ── Part C -- doctor probe per-framework summary ─────────────────────────

  it('Part C: doctor probe emits the GDPR_DEMO per-framework summary line', () => {
    scaffoldCatalogs(tmp);
    const probe = buildCommunityFrameworksProbe(tmp);
    const gdprSummary = probe.frameworks.find((f) => f.id === 'GDPR_DEMO');
    expect(gdprSummary).toBeDefined();
    expect(gdprSummary?.scope).toBe('community');
    expect(gdprSummary?.contributor).toContain('Helmut');
    expect(gdprSummary?.controls_count).toBe(11);
  });

  // ── Part D -- coexistence + scope-rename regression ──────────────────────

  it('Part D: a leftover catalogs/overlay/ folder is ignored (the loader never reads it)', () => {
    // Simulate a pre-#0341 workspace that still has a `catalogs/overlay/`
    // directory side-by-side with the new `catalogs/community/`. The walker
    // must enumerate community/ and silently skip overlay/ -- no crash, no
    // false-positive registry entry.
    scaffoldCatalogs(tmp);
    const overlayDir = join(tmp, 'wsp', 'inputs', 'catalogs', 'overlay', 'leftover-from-2026-05');
    mkdirSync(overlayDir, { recursive: true });
    writeFileSync(join(overlayDir, 'index.yaml'), `schema_version: "1"
scope: overlay
regimes: []
`);
    writeFileSync(join(overlayDir, 'controls.yaml'), `regime_meta:
  id: LEFTOVER
  name: "Leftover catalogue"
  version: "1.0"
  authority: "old"
  catalogue_version: "1.0.0"
controls:
  - id: LEFTOVER_C1
    title: "test"
    description: "Should not be loaded by the registry walker."
    evidence_basis:
      - signal_prefix: TF
`);
    const registry = loadRegimeRegistry(join(tmp, 'wsp', 'inputs', 'catalogs'));
    expect(registry.byId.has('LEFTOVER')).toBe(false);
    // GDPR_DEMO + the other demo frameworks still load normally (scaffold default since 16e129ed).
    expect(registry.byId.has('GDPR_DEMO')).toBe(true);
  });

  // ── Part E -- regression-pin snapshot ────────────────────────────────────

  it('Part E: scaffolded-workspace probe shape (regression-pin snapshot)', () => {
    scaffoldCatalogs(tmp);
    const probe = buildCommunityFrameworksProbe(tmp);
    // Sanitise: drop the absolute catalogs_dir path (machine-dependent) and
    // sort frameworks by id (insertion order is also stable but sorting is
    // more durable across registry implementation tweaks). Capture the
    // shape that downstream consumers (doctor JSON, MCP) rely on.
    const pin = {
      status: probe.status,
      standard_count: probe.standard_count,
      community_count: probe.community_count,
      collisions: [...probe.collisions].sort(),
      frameworks: [...probe.frameworks]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((f) => ({
          id: f.id,
          scope: f.scope,
          contributor_present: f.contributor !== null,
          controls_count: f.controls_count,
        })),
      error_count: probe.errors.length,
      warning_contains_gdpr_supersedes: probe.warnings.some((w) => /GDPR.*supersedes/i.test(w)),
    };
    expect(pin).toMatchInlineSnapshot(`
      {
        "collisions": [],
        "community_count": 4,
        "error_count": 0,
        "frameworks": [
          {
            "contributor_present": true,
            "controls_count": 11,
            "id": "AI_10_PILLARS_DEMO",
            "scope": "community",
          },
          {
            "contributor_present": true,
            "controls_count": 11,
            "id": "BSI_GRUNDSCHUTZ_2023_DEMO",
            "scope": "community",
          },
          {
            "contributor_present": true,
            "controls_count": 11,
            "id": "GDPR_DEMO",
            "scope": "community",
          },
          {
            "contributor_present": true,
            "controls_count": 12,
            "id": "NIST_SP_800_66R2_DEMO",
            "scope": "community",
          },
        ],
        "standard_count": 0,
        "status": "ok",
        "warning_contains_gdpr_supersedes": false,
      }
    `);
  });
});
