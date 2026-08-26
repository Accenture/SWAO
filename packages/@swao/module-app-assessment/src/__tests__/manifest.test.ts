// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { manifest, passContributions } from '../index.js';

describe('module-app-assessment manifest', () => {
  it('has the correct module id', () => {
    expect(manifest.id).toBe('@swao/module-app-assessment');
  });

  it('defaults to community tier', () => {
    expect(manifest.tier).toBe('community');
  });

  it('registers all 14 application-assessment passes', () => {
    // 'comp' (Pass 11 / COMP) moved to @swao/module-framework (#0570).
    // 'malware' (Pass 14) is opt-in (not in passKeys() default profile) but
    // registered in passContributions for module discovery. (#0681 Phase 1)
    expect(manifest.contributions.passes).toHaveLength(14);
    expect(passContributions).toHaveLength(14);
  });

  it('exposes the expected pass ids in order', () => {
    // 'comp' is absent here; the host dispatches it from @swao/module-framework.
    // 'malware' is last: opt-in pass registered for discovery but not in default profile.
    expect(passContributions.map((p) => p.id)).toEqual([
      'inv', 'state', 'data', 'ctx', 'sbom', 'tf', 'egr', 'crypto',
      'synth', 'dynamic', 'blocks', 'scope', 'lzr', 'malware',
    ]);
  });

  it('gives every pass a runner, name and signal prefix', () => {
    for (const p of passContributions) {
      expect(typeof p.run).toBe('function');
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.signal_prefix.length).toBeGreaterThan(0);
    }
  });
});
