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

// Sprint-037 #0344: pin the pkg.assets glob list in swao/packages/swao/
// package.json so a regression cannot silently drop the community-frameworks
// glob (the v0.1.3 bug: framework list returned "folder not found" because
// the glob was missing).
//
// This is a non-binary precondition test -- it runs on every CI invocation,
// not just after `bash scripts/build-binary.sh`. The binary-e2e companion
// test in binary-e2e.test.ts exercises the actual built binary.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { communityFrameworksDir } from '@swao/community-frameworks';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON = resolve(__dirname, '..', '..', 'package.json');

describe('pkg.assets glob (sprint-037 #0344)', () => {
  it('package.json declares the standard + community + powerbi + lz-stubs globs', () => {
    expect(existsSync(PACKAGE_JSON)).toBe(true);
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8')) as { pkg?: { assets?: string[] } };
    const assets = pkg.pkg?.assets ?? [];
    expect(assets).toContain('../../controls/**');
    expect(assets.some((a) => a.includes('community-frameworks'))).toBe(true);
    expect(assets.some((a) => a.includes('docs/templates/powerbi'))).toBe(true);
    expect(assets.some((a) => a.includes('terraform/lz-'))).toBe(true);
  });

  it('every bundled community-framework folder is a valid asset target', () => {
    const communityRoot = communityFrameworksDir;
    expect(existsSync(communityRoot)).toBe(true);
    expect(existsSync(join(communityRoot, '_registry.yaml'))).toBe(true);
    for (const folder of ['gdpr', 'ai-10-pillars', 'nist-sp-800-66r2-hipaa']) {
      expect(existsSync(join(communityRoot, folder, 'framework-meta.yaml')), `${folder}: framework-meta.yaml`).toBe(true);
      expect(existsSync(join(communityRoot, folder, 'controls.yaml')), `${folder}: controls.yaml`).toBe(true);
    }
  });
});
