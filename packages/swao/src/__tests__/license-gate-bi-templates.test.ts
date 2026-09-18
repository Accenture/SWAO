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

import { describe, it, expect } from 'vitest';
import { LicenseGuard, LicenseTierError } from '../license/license-guard.js';

// BI export is an Enterprise-only feature per the DOCX golden standard.
// requireFeature('bi-export') delegates to requireTier('enterprise').

describe('requireFeature(bi-export) -- Enterprise gate (#0183 updated)', () => {
  it('passes for Enterprise tier', () => {
    const fakeGuard = Object.create(LicenseGuard.prototype) as LicenseGuard;
    Object.defineProperty(fakeGuard, 'state', { value: { tier: 'enterprise' }, writable: false });
    expect(() => fakeGuard.requireFeature('bi-export')).not.toThrow();
  });

  it('throws LicenseTierError for Consultant tier', () => {
    const fakeGuard = Object.create(LicenseGuard.prototype) as LicenseGuard;
    Object.defineProperty(fakeGuard, 'state', { value: { tier: 'consultant' }, writable: false });
    expect(() => fakeGuard.requireFeature('bi-export')).toThrow(LicenseTierError);
  });

  it('throws LicenseTierError for Community tier', () => {
    const fakeGuard = Object.create(LicenseGuard.prototype) as LicenseGuard;
    Object.defineProperty(fakeGuard, 'state', { value: { tier: 'community' }, writable: false });
    expect(() => fakeGuard.requireFeature('bi-export')).toThrow(LicenseTierError);
  });
});
