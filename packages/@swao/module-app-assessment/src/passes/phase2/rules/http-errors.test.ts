// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  DYN-04 HTTP error responses rule tests (#1266)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { detectHttpErrors } from './http-errors.js';

const err = (url: string, status: number, screen = '001-dashboard') => ({
  url,
  status,
  method: 'GET',
  screen_slug: screen,
});

describe('detectHttpErrors (#1266)', () => {
  it('returns null when no error responses', () => {
    expect(detectHttpErrors({ httpErrors: [] })).toBeNull();
  });

  it('returns HIGH for 5xx response', () => {
    const signal = detectHttpErrors({ httpErrors: [err('https://app.test/api/data', 503)] });
    expect(signal!.id).toBe('DYN-04');
    expect(signal!.severity).toBe('high');
  });

  it('returns MEDIUM for 404 response', () => {
    const signal = detectHttpErrors({ httpErrors: [err('https://app.test/missing.js', 404)] });
    expect(signal!.severity).toBe('medium');
  });

  it('returns LOW for other 4xx (e.g. 401)', () => {
    const signal = detectHttpErrors({ httpErrors: [err('https://app.test/protected', 401)] });
    expect(signal!.severity).toBe('low');
  });

  it('returns HIGH for mixed 404 + 503 (highest wins)', () => {
    const signal = detectHttpErrors({
      httpErrors: [
        err('https://app.test/missing.js', 404),
        err('https://app.test/api/fail', 503),
      ],
    });
    expect(signal!.severity).toBe('high');
  });

  it('deduplicates evidence by URL', () => {
    const signal = detectHttpErrors({
      httpErrors: [
        err('https://app.test/api/data', 503, '001-dashboard'),
        err('https://app.test/api/data', 503, '002-profile'),
      ],
    });
    // Same URL should produce a single evidence entry
    expect(signal!.evidence).toHaveLength(1);
    expect(signal!.evidence[0]).toContain('001-dashboard');
    expect(signal!.evidence[0]).toContain('002-profile');
  });
});
