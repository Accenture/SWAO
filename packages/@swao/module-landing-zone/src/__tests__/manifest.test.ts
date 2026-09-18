// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { manifest, assessmentTypes } from '../index.js';

describe('module-landing-zone manifest (#0564/#0567)', () => {
  it('has the correct module id + community tier', () => {
    expect(manifest.id).toBe('@swao/module-landing-zone');
    expect(manifest.tier).toBe('community');
  });

  it('registers type: landing-zone-catalog as runnable (renamed from landing-zone; #0781)', () => {
    expect(assessmentTypes).toHaveLength(1);
    const lz = assessmentTypes[0]!;
    expect(lz.type).toBe('landing-zone-catalog');
    expect(lz.comingSoon).toBeFalsy();
    expect(manifest.contributions.assessmentTypes).toContain(lz);
  });

  it('contribution.run points at the CLI dispatch (the inline entry point)', async () => {
    await expect(assessmentTypes[0]!.run({} as never)).rejects.toThrow(/swao assess --type landing-zone/);
  });
});
