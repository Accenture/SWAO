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

// Sprint-037 #0340 end-to-end smoke: after `swao init` mirrors the bundled
// community frameworks into the workspace, the registry walker resolves
// GDPR and the doctor probe reports 1 community framework.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { scaffoldCatalogs } from '../commands/init.js';
// compliance-catalogues probe relocated to @swao/module-doctor (#0573).
import { buildCommunityFrameworksProbe } from '@swao/module-health-check';
import { loadRegimeRegistry } from '../compliance/registry.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-gdpr-e2e-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('sprint-037 #0340 GDPR end-to-end', () => {
  it('scaffoldCatalogs installs 4 default frameworks (#0775); GDPR_DEMO files are present', () => {
    const result = scaffoldCatalogs(tmp);
    // Demo variants scaffold by default since commit 16e129ed.
    expect(existsSync(join(result.communityDir, 'gdpr-demo', 'framework-meta.yaml'))).toBe(true);
    expect(existsSync(join(result.communityDir, 'gdpr-demo', 'controls.yaml'))).toBe(true);
    expect(result.copiedFiles).toContain('community/gdpr-demo/');
    // sprint-116 also scaffolds lz-catalogues/ entries; filter to community-only.
    expect(result.copiedFiles.filter((f) => f.startsWith('community/'))).toHaveLength(4);
  });

  it('loadRegimeRegistry discovers GDPR_DEMO via folder enumeration', () => {
    scaffoldCatalogs(tmp);
    const registry = loadRegimeRegistry(join(tmp, 'wsp', 'inputs', 'catalogs'));
    const gdpr = registry.byId.get('GDPR_DEMO');
    expect(gdpr).toBeDefined();
    expect(gdpr?.scope).toBe('community');
    expect(registry.collisions).not.toContain('GDPR_DEMO');
  });

  it('doctor compliance-catalogues probe reports community_count after mirror', () => {
    scaffoldCatalogs(tmp);
    const probe = buildCommunityFrameworksProbe(tmp);
    // Only GDPR is pre-installed (#0626); probe must find at least 1.
    expect(probe.community_count).toBeGreaterThanOrEqual(1);
    expect(['ok', 'warn']).toContain(probe.status);
  });
});
