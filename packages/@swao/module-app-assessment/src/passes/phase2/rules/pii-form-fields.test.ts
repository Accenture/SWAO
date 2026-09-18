// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  DYN-05 PII form field security rule tests (#1269)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { detectPiiFormFields } from './pii-form-fields.js';

describe('detectPiiFormFields (#1269)', () => {
  it('returns null when no PII form fields detected', () => {
    expect(detectPiiFormFields({ piiForms: [] })).toBeNull();
  });

  it('returns MEDIUM signal for password field missing autocomplete', () => {
    const signal = detectPiiFormFields({
      piiForms: [{ screen_slug: '001-login', element: '<input type="password" name="password">', issue: 'password field missing autocomplete' }],
    });
    expect(signal).not.toBeNull();
    expect(signal!.id).toBe('DYN-05');
    expect(signal!.severity).toBe('medium');
  });

  it('returns MEDIUM signal for email field missing autocomplete', () => {
    const signal = detectPiiFormFields({
      piiForms: [{ screen_slug: '001-login', element: '<input type="email" name="email">', issue: 'email field missing autocomplete="email"' }],
    });
    expect(signal!.severity).toBe('medium');
  });

  it('includes screen slug in evidence', () => {
    const signal = detectPiiFormFields({
      piiForms: [{ screen_slug: '002-signup', element: '<input type="text" name="ssn">', issue: 'PII-named field missing autocomplete' }],
    });
    expect(signal!.evidence[0]).toContain('002-signup');
  });

  it('aggregates multiple fields into one signal', () => {
    const signal = detectPiiFormFields({
      piiForms: [
        { screen_slug: '001-login', element: '<input type="password" name="password">', issue: 'password field missing autocomplete' },
        { screen_slug: '001-login', element: '<input type="email" name="email">', issue: 'email field missing autocomplete="email"' },
        { screen_slug: '002-signup', element: '<input type="text" name="dob">', issue: 'PII-named field missing autocomplete' },
      ],
    });
    expect(signal!.evidence).toHaveLength(3);
    expect(signal!.derivation).toContain('3 form field(s)');
    expect(signal!.derivation).toContain('2 screen(s)');
  });
});
