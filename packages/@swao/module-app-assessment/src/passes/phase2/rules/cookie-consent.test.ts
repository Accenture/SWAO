// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  DYN-08 cookie consent absence rule tests (#1271)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { detectCookieConsentAbsence } from './cookie-consent.js';

describe('detectCookieConsentAbsence (#1271)', () => {
  it('returns null when screensProcessed is 0', () => {
    expect(detectCookieConsentAbsence({ cookieConsentPresent: false }, 0)).toBeNull();
  });

  it('returns null when consent element was found', () => {
    expect(detectCookieConsentAbsence({ cookieConsentPresent: true }, 3)).toBeNull();
  });

  it('returns MEDIUM signal when consent absent across all screens', () => {
    const signal = detectCookieConsentAbsence({ cookieConsentPresent: false }, 5);
    expect(signal).not.toBeNull();
    expect(signal!.id).toBe('DYN-08');
    expect(signal!.severity).toBe('medium');
  });

  it('derivation mentions screen count', () => {
    const signal = detectCookieConsentAbsence({ cookieConsentPresent: false }, 7);
    expect(signal!.derivation).toContain('7');
  });

  it('evidence lists what was checked', () => {
    const signal = detectCookieConsentAbsence({ cookieConsentPresent: false }, 2);
    expect(signal!.evidence[0]).toContain('OneTrust');
  });
});
