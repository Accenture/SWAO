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

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// Tier-bundle exclusion gate (#0583, Sprint 064, ADR-0049 layer 2).
//
// ADR-0049's second layer requires that the higher-tier module CODE is ABSENT
// from the Community binary, not merely runtime-gated. We cannot run `pkg` in CI
// / the sandbox (spawn UNKNOWN), but esbuild IS runnable, and the exe is built
// FROM the esbuild bundle, so asserting at the bundle.cjs level is the faithful
// in-sandbox gate: if a marker is absent from the bundle, it is absent from the
// exe.
//
// We esbuild the Community + Enterprise entries (dist/tiers/community.js and
// dist/index.js) into temp bundles, then assert:
//   - Community bundle does NOT contain any higher-tier module marker.
//   - Enterprise bundle DOES contain them (proves the markers are real and the
//     exclusion is meaningful, not a vacuous pass from a renamed/empty symbol).
//   - Community bundle DOES contain a Community-only positive control (proves the
//     Community esbuild produced a real, non-empty bundle).
//
// Markers were chosen to be unique to each module's IMPLEMENTATION (not the
// injected dep NAME, which the host bundles in every tier, and not strings
// shared with a Community leaf such as @swao/publication-render). Each marker was
// validated against freshly-built bundles before being pinned here.
//
// PREREQUISITE: the host dist must be built (`pnpm --filter swao build`) so the
// tier entries exist under dist/. The test skips (does not fail) when dist is
// absent so a source-only checkout does not red the suite; CI builds dist first.
// esbuild itself is fast (~1-2s per bundle); the two bundles keep this well under
// the default test budget.

import { buildBundle } from '../../scripts/build-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..', '..');
const COMMUNITY_ENTRY = join(PKG_ROOT, 'dist', 'tiers', 'community.js');
const ENTERPRISE_ENTRY = join(PKG_ROOT, 'dist', 'index.js');

// Higher-tier module markers (implementation-unique strings). Keyed by the
// tier + module they prove, with a note on where the string comes from.
const TIER_MARKERS: Array<{ marker: string; module: string }> = [
  // Enterprise: @swao/module-challenge persona prompt (application-architect.ts).
  { marker: 'migrated three large-scale Java monoliths', module: '@swao/module-challenge (Enterprise)' },
  // Consultant: @swao/module-pdf-report unique render function.
  // Note: 'Helvetica-Bold' was retired as marker in v0.7.4 because pdf-parse (a
  // community dep in @swao/module-app-assessment Pass 00 extraction) also embeds it.
  { marker: 'renderTextReportToPdf', module: '@swao/module-pdf-report (Consultant)' },
  // Enterprise: @swao/module-html-portal internal app-id allowlist helper.
  // publish --site (HTML Portal) is Enterprise-only (#1562); module absent from
  // Community and Consultant bundles after sprint-117 fix.
  { marker: 'isSafeAppId', module: '@swao/module-html-portal (Enterprise)' },
  // Consultant: @swao/module-terraform command registrar.
  { marker: 'registerGenerateTf', module: '@swao/module-terraform (Consultant)' },
  // Enterprise: @swao/module-portfolio production spawn-runner builder.
  { marker: 'buildSpawnRunForApp', module: '@swao/module-portfolio (Enterprise)' },
  // Enterprise: @swao/module-portfolio orchestrator runtime message.
  { marker: 'No apps discovered under apps', module: '@swao/module-portfolio (Enterprise)' },
];

// Community-only positive control: the product banner is registered by the
// shared bootstrap, so it appears in every tier. Its presence in the Community
// bundle proves the Community esbuild emitted a real bundle (absence-only
// assertions would pass vacuously on an empty/broken bundle).
const POSITIVE_CONTROL = 'Sovereign Workload Assessment';

const distBuilt = existsSync(COMMUNITY_ENTRY) && existsSync(ENTERPRISE_ENTRY);

describe.skipIf(!distBuilt)('tier-bundle exclusion (#0583)', () => {
  let communityBundle = '';
  let enterpriseBundle = '';
  let tmp = '';
  const prevCwd = process.cwd();

  beforeAll(async () => {
    // build-lib's esbuild config resolves node_modules / workspace deps relative
    // to the package root, so run from there.
    process.chdir(PKG_ROOT);
    tmp = mkdtempSync(join(tmpdir(), 'swao-tier-bundle-'));
    const communityOut = join(tmp, 'community.cjs');
    const enterpriseOut = join(tmp, 'enterprise.cjs');
    const silent = () => {};
    await buildBundle({ entry: COMMUNITY_ENTRY, outfile: communityOut, log: silent });
    await buildBundle({ entry: ENTERPRISE_ENTRY, outfile: enterpriseOut, log: silent });
    communityBundle = readFileSync(communityOut, 'utf-8');
    enterpriseBundle = readFileSync(enterpriseOut, 'utf-8');
    process.chdir(prevCwd);
  }, 120_000);

  it('Community bundle is real and non-empty (positive control present)', () => {
    expect(communityBundle.length).toBeGreaterThan(100_000);
    expect(communityBundle).toContain(POSITIVE_CONTROL);
  });

  for (const { marker, module } of TIER_MARKERS) {
    it(`Community bundle EXCLUDES ${module} (marker: "${marker}")`, () => {
      expect(communityBundle).not.toContain(marker);
    });

    it(`Enterprise bundle INCLUDES ${module} (marker: "${marker}")`, () => {
      expect(enterpriseBundle).toContain(marker);
    });
  }

  it('cleanup temp bundles', () => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });
});
