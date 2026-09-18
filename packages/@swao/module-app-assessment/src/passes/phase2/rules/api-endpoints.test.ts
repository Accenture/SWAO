// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  DYN-03 API endpoint inventory rule tests (#1265)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { inventoryApiEndpoints } from './api-endpoints.js';

describe('inventoryApiEndpoints (#1265)', () => {
  it('returns null when no fetch endpoints', () => {
    expect(inventoryApiEndpoints({ apiEndpoints: [] })).toBeNull();
  });

  it('returns informational signal when endpoints present', () => {
    const signal = inventoryApiEndpoints({ apiEndpoints: ['/api/users/{id}/profile', '/api/auth/me'] });
    expect(signal).not.toBeNull();
    expect(signal!.id).toBe('DYN-03');
    expect(signal!.severity).toBe('informational');
    expect(signal!.confidence).toBe('high');
  });

  it('evidence lists all distinct endpoint patterns', () => {
    const endpoints = ['/api/users/{id}/profile', '/api/chat/{id}/messages'];
    const signal = inventoryApiEndpoints({ apiEndpoints: endpoints });
    expect(signal!.evidence).toEqual(endpoints);
  });

  it('derivation mentions endpoint count', () => {
    const signal = inventoryApiEndpoints({ apiEndpoints: ['/api/a', '/api/b', '/api/c'] });
    expect(signal!.derivation).toContain('3 distinct');
  });
});
