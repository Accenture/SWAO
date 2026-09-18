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

/**
 * Journey J4 -- Prism Pass Profiles
 *
 * Exercises the three-field Prism model (HOW / WHAT / WHICH) by spawning
 * the binary with different pass_profile configurations in .swao.yml and
 * asserting on the resulting wsp/run-manifest.json output.
 *
 * Aligned to J4 from docs/design/user-journey/J4-prism-pass-profiles.md.
 * Test IDs JP-01..JP-05 map 1:1 to the scenarios in issue #0526.
 *
 * pass_profile filtering is enforced as of #0878. Profile-specific assertions
 * are now active. passes_executed uses the full pass name (e.g. 'inventory',
 * not 'inv'), matching assess.ts:passStats.push({pass: passDef.name, ...}).
 */
import { test, expect } from '@playwright/test';
import { existsSync, rmSync, cpSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { hasBinary, run, WORKSPACE, attachOutput } from './helpers.js';

test.skip(!hasBinary, 'swao binary not found -- run scripts/build-binary.sh first');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PassStatEntry {
  pass: string;
  num: string;
  wall_clock_ms: number;
  signals_emitted: number;
}

interface RunManifest {
  schema_version: string;
  run_id: string;
  app: string;
  iter: number;
  assessed_at: string;
  passes_executed: string[];
  pass_stats: PassStatEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GOLDEN_APP      = join(WORKSPACE, 'apps', 'sovereign-health');
const PORTFOLIO_CONFIG = join(WORKSPACE, '.swao.yml');
// Path within the copied app dir where the binary writes its latest run manifest
const MANIFEST_REL    = join('apps', 'sovereign-health', 'wsp', 'run-manifest.json');

/**
 * Creates an isolated temp workspace containing:
 *   - A recursive copy of the sovereign-health golden fixture (apps/sovereign-health/)
 *   - A portfolio-level .swao.yml (base: golden portfolio config + optional assessment block)
 *
 * Stale binary outputs (wsp/run-manifest.json) are deleted from the copy so that
 * post-run assertions hit freshly written files and not stale fixtures.
 *
 * Caller MUST invoke cleanup() in a finally block.
 */
function makeProfileWorkspace(
  profile: string[] | null,
): { dir: string; cleanup: () => void } {
  const dir = join(tmpdir(), `swao-e2e-prism-${Date.now()}`);
  mkdirSync(join(dir, 'apps'), { recursive: true });
  cpSync(GOLDEN_APP, join(dir, 'apps', 'sovereign-health'), { recursive: true });

  // Remove stale run-manifest so readRunManifest() always returns a fresh file
  const staleManifest = join(dir, MANIFEST_REL);
  if (existsSync(staleManifest)) {
    rmSync(staleManifest, { force: true });
  }

  // Base: real portfolio .swao.yml (carries providers, LLM fallback, regime_catalogs)
  const portfolioYaml = readFileSync(PORTFOLIO_CONFIG, 'utf-8');

  // Append assessment block when a profile is given
  const assessmentBlock =
    profile !== null
      ? `\nassessment:\n  pass_profile: [${profile.map((p) => `"${p}"`).join(', ')}]\n`
      : '';

  writeFileSync(join(dir, '.swao.yml'), portfolioYaml + assessmentBlock, 'utf-8');

  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Reads wsp/run-manifest.json written by the binary after assessment.
 * Returns null if the file was not produced (assess did not write output).
 */
function readRunManifest(workspaceDir: string): RunManifest | null {
  const p = join(workspaceDir, MANIFEST_REL);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8')) as RunManifest;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Journey J4 -- Prism Pass Profiles', () => {

  // ── JP-01: cloud-migration ────────────────────────────────────────────────

  test('JP-01: cloud-migration profile -- assess exits 0 and emits run manifest', async ({}, testInfo) => {
    test.setTimeout(120_000);
    const { dir, cleanup } = makeProfileWorkspace(['cloud-migration']);
    try {
      const r = run(['assess', '--app', 'sovereign-health', '--no-crawl'], { cwd: dir });
      attachOutput(testInfo, 'JP-01 cloud-migration', r);
      expect(r.status).toBe(0);

      const manifest = readRunManifest(dir);
      expect(manifest).not.toBeNull();
      expect(manifest!.passes_executed.length).toBeGreaterThan(0);

      // Each executed pass must have a corresponding pass_stats entry
      expect(manifest!.pass_stats.length).toBeGreaterThanOrEqual(
        manifest!.passes_executed.length,
      );

      // cloud-migration lens (lenses.ts BUILT_IN_LENSES): INV STATE DATA CTX SBOM TF
      // EGR CRYPTO SYNTH LZR COMP SCOPE -- i.e. all standard passes EXCEPT BLOCKS.
      // Only deterministic (llmPassName:null) passes are asserted present since LLM
      // passes require a key or cassette hit that may not be available in all CI envs.
      expect(manifest!.passes_executed).toContain('inventory');        // INV
      expect(manifest!.passes_executed).toContain('state_analysis');   // STATE
      expect(manifest!.passes_executed).toContain('sbom_cve');         // SBOM
      expect(manifest!.passes_executed).toContain('egress');           // EGR
      expect(manifest!.passes_executed).toContain('crypto_posture');   // CRYPTO
      // BLOCKS (block_assessments) is absent from the cloud-migration lens
      expect(manifest!.passes_executed).not.toContain('block_assessments');
    } finally {
      cleanup();
    }
  });

  // ── JP-02: security-focus ─────────────────────────────────────────────────

  test('JP-02: security-focus profile -- assess exits 0 and emits run manifest', async ({}, testInfo) => {
    test.setTimeout(120_000);
    const { dir, cleanup } = makeProfileWorkspace(['security-focus']);
    try {
      const r = run(['assess', '--app', 'sovereign-health', '--no-crawl'], { cwd: dir });
      attachOutput(testInfo, 'JP-02 security-focus', r);
      expect(r.status).toBe(0);

      const manifest = readRunManifest(dir);
      expect(manifest).not.toBeNull();
      expect(manifest!.passes_executed.length).toBeGreaterThan(0);

      // security-focus lens (lenses.ts BUILT_IN_LENSES): SBOM CRYPTO EGR only.
      // Passes outside the lens (INV, STATE, ...) must NOT appear.
      expect(manifest!.passes_executed).toContain('sbom_cve');             // SBOM
      expect(manifest!.passes_executed).toContain('crypto_posture');       // CRYPTO
      expect(manifest!.passes_executed).toContain('egress');               // EGR
      expect(manifest!.passes_executed).not.toContain('inventory');        // INV excluded
      expect(manifest!.passes_executed).not.toContain('state_analysis');   // STATE excluded
    } finally {
      cleanup();
    }
  });

  // ── JP-03: additive union ─────────────────────────────────────────────────

  test('JP-03: additive union -- cloud-migration + security-focus, no duplicates', async ({}, testInfo) => {
    test.setTimeout(120_000);
    const { dir, cleanup } = makeProfileWorkspace(['cloud-migration', 'security-focus']);
    try {
      const r = run(['assess', '--app', 'sovereign-health', '--no-crawl'], { cwd: dir });
      attachOutput(testInfo, 'JP-03 union', r);
      expect(r.status).toBe(0);

      const manifest = readRunManifest(dir);
      expect(manifest).not.toBeNull();

      // No duplicate entries regardless of how the binary handles additive profiles
      const uniqueCount = new Set(manifest!.passes_executed).size;
      expect(uniqueCount).toBe(manifest!.passes_executed.length);

      // security-focus subset of cloud-migration: union == cloud-migration.
      // Assert the same deterministic set as JP-01 is present, and no BLOCKS.
      const jp01Passes = ['inventory', 'state_analysis', 'sbom_cve', 'egress', 'crypto_posture'];
      for (const p of jp01Passes) {
        expect(manifest!.passes_executed).toContain(p);
      }
      expect(manifest!.passes_executed).not.toContain('block_assessments');
    } finally {
      cleanup();
    }
  });

  // ── JP-04: default (no pass_profile) ──────────────────────────────────────

  test('JP-04: no pass_profile field -- default passes execute without error', async ({}, testInfo) => {
    test.setTimeout(120_000);
    const { dir, cleanup } = makeProfileWorkspace(null);
    try {
      const r = run(['assess', '--app', 'sovereign-health', '--no-crawl'], { cwd: dir });
      attachOutput(testInfo, 'JP-04 default (no profile)', r);
      expect(r.status).toBe(0);

      const manifest = readRunManifest(dir);
      expect(manifest).not.toBeNull();
      // At least one pass ran and was recorded
      expect(manifest!.passes_executed.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  // ── JP-05: unknown profile name ────────────────────────────────────────────

  test('JP-05: unknown profile name -- binary exits gracefully without crash', async ({}, testInfo) => {
    test.setTimeout(120_000);
    const { dir, cleanup } = makeProfileWorkspace(['nonexistent-profile']);
    try {
      const r = run(['assess', '--app', 'sovereign-health', '--no-crawl'], { cwd: dir });
      attachOutput(testInfo, 'JP-05 unknown-profile', r);

      // Unknown profile now exits non-zero with a descriptive message (#0878).
      expect(r.status).not.toBe(0);
      expect(r.combined).toMatch(/Unknown pass profile/i);
    } finally {
      cleanup();
    }
  });

});
