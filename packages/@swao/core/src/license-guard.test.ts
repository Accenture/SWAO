// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Unit tests for normalizeTier (ADR-0049 -- tier vocabulary unification).
//
// normalizeTier is a pure string mapping applied AFTER signature
// verification; it never touches crypto, so these tests need no keypair
// setup (unlike the licence-issuing tests in @swao/swao).

import { describe, it, expect } from 'vitest';
import { normalizeTier } from './license-guard.js';

describe('normalizeTier (ADR-0049)', () => {
  it('maps the legacy `standard` to `consultant`', () => {
    expect(normalizeTier('standard')).toBe('consultant');
  });

  it('maps the legacy `premium` to `enterprise`', () => {
    expect(normalizeTier('premium')).toBe('enterprise');
  });

  it('passes `community` through unchanged', () => {
    expect(normalizeTier('community')).toBe('community');
  });

  it('passes the canonical `consultant` through unchanged', () => {
    expect(normalizeTier('consultant')).toBe('consultant');
  });

  it('passes the canonical `enterprise` through unchanged', () => {
    expect(normalizeTier('enterprise')).toBe('enterprise');
  });

  it('defaults any unknown value to `community` (defensive: never grant more than free)', () => {
    expect(normalizeTier('platinum')).toBe('community');
    expect(normalizeTier('')).toBe('community');
    expect(normalizeTier('STANDARD')).toBe('community'); // case-sensitive by design
  });
});
