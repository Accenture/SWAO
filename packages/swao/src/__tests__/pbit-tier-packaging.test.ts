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
 * #3338 / #3339: Power BI .pbit templates (F-088, Consultant+), premium
 * framework content and pdfkit data are packaged per tier.
 * Consultant and Enterprise stage dist/templates/powerbi; the Community build
 * packages with a pkg config whose asset list excludes it, so a copy staged by
 * a parallel Consultant / Enterprise build on the shared dist/ never ships in
 * the Community binary. The binary contents are checked by
 * tests/audit-gates/community-binary-shape.gate.mjs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const PKG_DIR   = resolve(__dirname, '../..');
const BUILD_LIB = join(PKG_DIR, 'scripts', 'build-lib.mjs');

interface BuildLib {
  PBIT_TIERS: string[];
  PBIT_ASSET_GLOB: string;
  CONSULTANT_EXCLUDED_DIST: string[];
  COMMUNITY_EXCLUDED_DIST: Array<{ dir: string; glob: string }>;
  writeTierPkgConfig: (tier: string, opts?: { pkgJsonPath?: string; outPath?: string }) => string;
}

// #3339: every Consultant / Enterprise-only dist/ folder the Community binary
// must not package, with the package.json glob that packages it.
const COMMUNITY_EXCLUDED = [
  { dir: 'dist/templates/powerbi', glob: 'dist/templates/powerbi/**' },
  { dir: 'dist/_premium-frameworks', glob: 'dist/_premium-frameworks/**' },
  { dir: 'dist/data', glob: 'dist/data/*' },
];

let lib: BuildLib;
let tmp: string;

beforeAll(async () => {
  lib = await import(pathToFileURL(BUILD_LIB).href) as BuildLib;
  tmp = mkdtempSync(join(tmpdir(), 'swao-pbit-pkg-'));
});
afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

function configFor(tier: string): { assets: string[]; rest: Record<string, unknown> } {
  const out = lib.writeTierPkgConfig(tier, { pkgJsonPath: join(PKG_DIR, 'package.json'), outPath: join(tmp, `pkg-${tier}.config.json`) });
  const cfg = JSON.parse(readFileSync(out, 'utf-8')) as { pkg: { assets: string[] } } & Record<string, unknown>;
  return { assets: cfg.pkg.assets, rest: cfg };
}

describe('Power BI .pbit packaging per tier (#3338)', () => {
  it('Consultant and Enterprise are the .pbit tiers (F-088 Consultant+)', () => {
    expect(lib.PBIT_TIERS).toEqual(['consultant', 'enterprise']);
    expect(lib.PBIT_ASSET_GLOB).toBe('dist/templates/powerbi/**');
  });

  it('the Community exclusion list names the .pbit, premium framework and pdfkit folders (#3339)', () => {
    expect(lib.COMMUNITY_EXCLUDED_DIST).toEqual(COMMUNITY_EXCLUDED);
    const pkgJson = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf-8')) as { pkg: { assets: string[] } };
    // Each glob is the one package.json packages the folder with, so dropping it is effective.
    for (const { glob } of COMMUNITY_EXCLUDED) expect(pkgJson.pkg.assets).toContain(glob);
  });

  it('Community pkg config excludes every Consultant / Enterprise-only folder and keeps every other asset', () => {
    const pkgJson = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf-8')) as { name: string; pkg: { assets: string[] } };
    const { assets, rest } = configFor('community');
    for (const { dir, glob } of COMMUNITY_EXCLUDED) {
      expect(assets).not.toContain(glob);
      expect(assets).toContain(`!${dir}/**`);
    }
    const excludedGlobs = COMMUNITY_EXCLUDED.map(e => e.glob);
    expect(assets).toEqual(expect.arrayContaining(pkgJson.pkg.assets.filter(a => !excludedGlobs.includes(a))));
    expect(rest['name']).toBe(pkgJson.name);
  });

  it.each(['consultant', 'enterprise'])('%s pkg config packages the .pbit templates, premium frameworks and pdfkit data', (tier) => {
    const { assets } = configFor(tier);
    for (const { dir, glob } of COMMUNITY_EXCLUDED) {
      expect(assets).toContain(glob);
      expect(assets).not.toContain(`!${dir}/**`);
    }
  });

  it('a stale negation or glob in the source config is normalised', () => {
    const src = join(tmp, 'package.json');
    writeFileSync(src, JSON.stringify({ name: 'x', pkg: { assets: [
      'a/**', '!dist/templates/powerbi/**', 'dist/templates/powerbi/**', 'dist/_premium-frameworks/**', '!dist/data/**', 'dist/data/*',
    ] } }));
    const out = lib.writeTierPkgConfig('community', { pkgJsonPath: src, outPath: join(tmp, 'c.json') });
    expect((JSON.parse(readFileSync(out, 'utf-8')) as { pkg: { assets: string[] } }).pkg.assets).toEqual([
      'a/**', '!dist/templates/powerbi/**', '!dist/_premium-frameworks/**', '!dist/data/**',
    ]);
    const outE = lib.writeTierPkgConfig('enterprise', { pkgJsonPath: src, outPath: join(tmp, 'e.json') });
    expect((JSON.parse(readFileSync(outE, 'utf-8')) as { pkg: { assets: string[] } }).pkg.assets).toEqual([
      'a/**', 'dist/_premium-frameworks/**', 'dist/data/*', 'dist/templates/powerbi/**',
    ]);
    // #3340: a stale enterprise/ negation is dropped for Enterprise and re-added last for Consultant.
    writeFileSync(src, JSON.stringify({ name: 'x', pkg: { assets: [
      '!dist/_premium-frameworks/enterprise/**', 'dist/_premium-frameworks/**', 'dist/templates/powerbi/**',
    ] } }));
    const outE2 = lib.writeTierPkgConfig('enterprise', { pkgJsonPath: src, outPath: join(tmp, 'e2.json') });
    expect((JSON.parse(readFileSync(outE2, 'utf-8')) as { pkg: { assets: string[] } }).pkg.assets).toEqual([
      'dist/_premium-frameworks/**', 'dist/templates/powerbi/**',
    ]);
    const outC = lib.writeTierPkgConfig('consultant', { pkgJsonPath: src, outPath: join(tmp, 'c2.json') });
    expect((JSON.parse(readFileSync(outC, 'utf-8')) as { pkg: { assets: string[] } }).pkg.assets).toEqual([
      'dist/_premium-frameworks/**', 'dist/templates/powerbi/**', '!dist/_premium-frameworks/enterprise/**',
    ]);
  });

  it('build-lib: the Community build purges the excluded folders outside parallel builds; demo folders no build stages are purged (#3339)', () => {
    const src = readFileSync(BUILD_LIB, 'utf-8');
    expect(src).toMatch(/if \(premiumTier === 'none' && !includePdfkit\) \{[\s\S]*?SWAO_PARALLEL_BUILD'\] !== '1'\) \{\s*for \(const \{ dir \} of COMMUNITY_EXCLUDED_DIST\) rmSync/);
    expect(src).toMatch(/if \(!DEMO_FW_FOLDERS\.includes\(name\)\) rmSync/);
    const pkgJson = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf-8')) as { pkg: { assets: string[] } };
    expect(pkgJson.pkg.assets).toContain('!dist/_demo-frameworks/cobit-5-demo/**');
  });

  it('build scripts: Community packages with the generated config; the parallel builder protects the shared dist/', () => {
    const community = readFileSync(join(PKG_DIR, 'scripts', 'build-community.mjs'), 'utf-8');
    expect(community).toContain("writeTierPkgConfig('community')");
    expect(community).toMatch(/'--config', communityPkgConfig/);
    expect(readFileSync(join(PKG_DIR, 'scripts', 'build-all-parallel.mjs'), 'utf-8')).toContain("SWAO_PARALLEL_BUILD: '1'");
    const consultant = readFileSync(join(PKG_DIR, 'scripts', 'build-consultant.mjs'), 'utf-8');
    expect(consultant).toContain("premiumTier: 'consultant'");
    // #3340: Consultant packages with its generated config, not plain package.json.
    expect(consultant).toContain("writeTierPkgConfig('consultant')");
    expect(consultant).toMatch(/'--config', consultantPkgConfig/);
    expect(consultant).not.toMatch(/'--config', 'package\.json'/);
  });
});

describe('Consultant packaging excludes Enterprise premium frameworks (#3340)', () => {
  it('the Consultant exclusion list names dist/_premium-frameworks/enterprise', () => {
    expect(lib.CONSULTANT_EXCLUDED_DIST).toEqual(['dist/_premium-frameworks/enterprise']);
  });

  it('Consultant pkg config keeps every package.json asset and negates enterprise/ after the premium glob', () => {
    const pkgJson = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf-8')) as { pkg: { assets: string[] } };
    const { assets } = configFor('consultant');
    expect(assets).toEqual(expect.arrayContaining(pkgJson.pkg.assets));
    const neg = assets.indexOf('!dist/_premium-frameworks/enterprise/**');
    expect(neg).toBeGreaterThan(assets.indexOf('dist/_premium-frameworks/**'));
    expect(assets).toContain('dist/templates/powerbi/**');
    expect(assets).not.toContain('!dist/templates/powerbi/**');
  });

  it('Enterprise pkg config does not negate its own premium frameworks', () => {
    expect(configFor('enterprise').assets).not.toContain('!dist/_premium-frameworks/enterprise/**');
  });

  it('build-lib: the Consultant build purges enterprise/ outside parallel builds', () => {
    const src = readFileSync(BUILD_LIB, 'utf-8');
    expect(src).toMatch(/if \(premiumTier === 'consultant'\) \{[\s\S]*?SWAO_PARALLEL_BUILD'\] !== '1'\) \{\s*for \(const dir of CONSULTANT_EXCLUDED_DIST\) rmSync/);
  });
});
