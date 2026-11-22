// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4430: `swao --version` and the host branding name the build. A source run
// (`node dist/index.js`) has no stamp and says "source"; a bundle stamped by
// scripts/build-lib.mjs replaces @swao/core BUILD_INFO (scripts/build-info.test.mjs
// proves the stamp reaches versionWithBuild / buildProvenance, which these
// strings are built from).

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_INFO, buildProvenance, versionWithBuild } from '@swao/core';
import { SWAO_BUILD, SWAO_BUILD_TAG, SWAO_VERSION, SWAO_VERSION_LABEL } from '../branding.js';

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(PKG_DIR, 'dist', 'index.js');

describe('#4430 build info in the host branding', () => {
  it('the label, tag and provenance come from the @swao/core build info', () => {
    expect(SWAO_VERSION_LABEL).toBe(versionWithBuild(SWAO_VERSION, BUILD_INFO));
    expect(SWAO_VERSION_LABEL).toBe(SWAO_BUILD_TAG ? `${SWAO_VERSION} (${SWAO_BUILD_TAG})` : SWAO_VERSION);
    expect(SWAO_BUILD).toEqual(buildProvenance(BUILD_INFO));
  });

  it('SWAO_VERSION stays the plain semver (manifests, comparability key)', () => {
    expect(SWAO_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('the bootstrap --version string carries the build suffix after the semver (empty in a non-dev build)', () => {
    const src = readFileSync(join(PKG_DIR, 'src', 'bootstrap.ts'), 'utf-8');
    expect(src).toMatch(/v\$\{pkg\.version\}\$\{SWAO_BUILD_SUFFIX\} \(/);
  });

  it.skipIf(!existsSync(CLI))('node dist/index.js --version prints "v<semver> (source)"', () => {
    const r = spawnSync(process.execPath, [CLI, '--version'], { encoding: 'utf-8', timeout: 60_000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`v${SWAO_VERSION} (source)`);
  });
});
