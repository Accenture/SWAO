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

// #0395 (sprint-040): defence-in-depth tests for appSwaoYmlTemplate's
// vcsSubdir sanitiser. Sprint-040 binary-test feedback surfaced that an
// operator pasted a full GitHub tree URL into the subdir prompt; the
// raw value landed in source.path, which Windows then refused to create
// (colon-in-folder). The sanitiser strips the URL prefix when present
// and drops any leftover URL-shaped value so the resulting source.path
// is always a Windows-legal relative folder.

import { describe, it, expect } from 'vitest';
import { appSwaoYmlTemplate } from '../commands/init.js';

function extractSourcePath(yaml: string): string {
  const match = yaml.match(/^\s*path:\s*(\S+)/m);
  if (!match) throw new Error(`source.path line not found in:\n${yaml}`);
  return match[1] ?? '';
}

function extractVcsSubdir(yaml: string): string {
  const match = yaml.match(/^\s*subdir:\s*(\S+)/m);
  return match?.[1] ?? '';
}

describe('appSwaoYmlTemplate -- vcsSubdir sanitiser (#0395)', () => {
  // #1046: source.path is always wsp/inputs/source/; subdir is emitted as vcs.subdir.
  it('passes a clean monorepo subdir through unchanged', () => {
    const yaml = appSwaoYmlTemplate({
      appId: 'demo',
      vcsUrl: 'https://github.com/org/repo',
      vcsRef: 'main',
      vcsSubdir: 'apps/health/sovereign-health',
    });
    expect(extractSourcePath(yaml)).toBe('wsp/inputs/source/');
    expect(extractVcsSubdir(yaml)).toBe('apps/health/sovereign-health');
  });

  it('strips a leading GitHub tree URL prefix down to the path-after-tree', () => {
    const yaml = appSwaoYmlTemplate({
      appId: 'demo',
      vcsUrl: 'https://github.com/sovereignbrick/brickos',
      vcsRef: 'main',
      vcsSubdir: 'https://github.com/sovereignbrick/brickos/tree/main/apps/health/sovereign-health',
    });
    expect(extractSourcePath(yaml)).toBe('wsp/inputs/source/');
    expect(extractVcsSubdir(yaml)).toBe('apps/health/sovereign-health');
    // The broken Windows-illegal `/tree/` path must NOT land in vcs.subdir.
    expect(extractVcsSubdir(yaml)).not.toContain('/tree/');
    expect(extractVcsSubdir(yaml)).not.toContain(':');
  });

  it('drops the subdir entirely when it still looks URL-shaped after extraction', () => {
    // Pathological: protocol-like prefix without a /tree/ path. Better to
    // emit a blank subdir than a Windows-illegal one. .swao.yml stays
    // editable.
    const yaml = appSwaoYmlTemplate({
      appId: 'demo',
      vcsUrl: 'https://github.com/org/repo',
      vcsRef: 'main',
      vcsSubdir: 'gopher://weird/path',
    });
    expect(extractSourcePath(yaml)).toBe('wsp/inputs/source/');
    expect(yaml).not.toContain('gopher://');
  });

  it('drops a subdir containing a colon (Windows-illegal folder char)', () => {
    const yaml = appSwaoYmlTemplate({
      appId: 'demo',
      vcsUrl: 'https://github.com/org/repo',
      vcsRef: 'main',
      vcsSubdir: 'apps:health',
    });
    expect(extractSourcePath(yaml)).toBe('wsp/inputs/source/');
  });

  it('strips leading and trailing slashes', () => {
    const yaml = appSwaoYmlTemplate({
      appId: 'demo',
      vcsUrl: 'https://github.com/org/repo',
      vcsRef: 'main',
      vcsSubdir: '/apps/health/',
    });
    expect(extractSourcePath(yaml)).toBe('wsp/inputs/source/');
    expect(extractVcsSubdir(yaml)).toBe('apps/health');
  });

  it('emits a bare wsp/inputs/source/ when no subdir is supplied', () => {
    const yaml = appSwaoYmlTemplate({
      appId: 'demo',
      vcsUrl: 'https://github.com/org/repo',
      vcsRef: 'main',
    });
    expect(extractSourcePath(yaml)).toBe('wsp/inputs/source/');
  });

  it('uses sourcePathOverride verbatim when supplied (local-path mode #0386)', () => {
    // local-folder mode: the operator's absolute path is written as-is;
    // no source.vcs: block is emitted. The sanitiser must not interfere.
    const yaml = appSwaoYmlTemplate({
      appId: 'demo',
      sourcePathOverride: 'C:\\Projects\\my-app',
    });
    expect(extractSourcePath(yaml)).toBe('C:\\Projects\\my-app');
    expect(yaml).not.toContain('  vcs:');
  });
});
