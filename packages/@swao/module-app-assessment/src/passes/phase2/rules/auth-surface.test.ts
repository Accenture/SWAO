// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  DYN-07 auth surface mapping rule tests (#1267)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { mapAuthSurface } from './auth-surface.js';

describe('mapAuthSurface (#1267)', () => {
  it('returns null when screensProcessed is 0', () => {
    expect(mapAuthSurface({ authEndpoints: [] }, 0)).toBeNull();
  });

  it('returns LOW when no auth endpoints observed', () => {
    const signal = mapAuthSurface({ authEndpoints: [] }, 5);
    expect(signal).not.toBeNull();
    expect(signal!.id).toBe('DYN-07');
    expect(signal!.severity).toBe('low');
  });

  it('returns informational when auth endpoint appears on all screens', () => {
    const signal = mapAuthSurface({
      authEndpoints: [{ path: '/auth/me', screens: ['001', '002', '003'] }],
    }, 3);
    expect(signal!.severity).toBe('informational');
  });

  it('returns MEDIUM when auth endpoint on subset of screens', () => {
    const signal = mapAuthSurface({
      authEndpoints: [{ path: '/auth/me', screens: ['001', '002'] }],
    }, 5);
    expect(signal!.severity).toBe('medium');
    expect(signal!.derivation).toContain('2 of 5');
  });

  it('evidence lists each auth endpoint with its screens', () => {
    const signal = mapAuthSurface({
      authEndpoints: [
        { path: '/api/user/me', screens: ['001-dashboard', '002-profile', '003-settings'] },
      ],
    }, 3);
    expect(signal!.evidence[0]).toContain('/api/user/me');
    expect(signal!.evidence[0]).toContain('001-dashboard');
  });

  it('coverage percentage appears in derivation', () => {
    const signal = mapAuthSurface({
      authEndpoints: [{ path: '/session', screens: ['001', '003'] }],
    }, 4);
    expect(signal!.derivation).toContain('%');
  });
});
