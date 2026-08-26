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

// Unit tests for the PII redaction helpers used by `swao log export` (#0327 Part D).

import { describe, it, expect } from 'vitest';
import { redactPiiString, redactPiiValue, emptyCounts } from './redact-pii.js';

describe('redactPiiString (#0327 Part D)', () => {
  it('redacts email addresses + increments email counter', () => {
    const counts = emptyCounts();
    expect(redactPiiString('contact user@example.com for details', counts)).toBe(
      'contact [REDACTED-EMAIL] for details',
    );
    expect(counts.email).toBe(1);
  });

  it('redacts multiple emails in one string', () => {
    const counts = emptyCounts();
    const out = redactPiiString('a@x.com talked to b@y.com about c@z.com', counts);
    expect(out).toBe('[REDACTED-EMAIL] talked to [REDACTED-EMAIL] about [REDACTED-EMAIL]');
    expect(counts.email).toBe(3);
  });

  it('redacts IPv4 addresses except loopback / unspecified', () => {
    const counts = emptyCounts();
    expect(redactPiiString('server 192.168.1.100 timed out', counts)).toBe(
      'server [REDACTED-IPV4] timed out',
    );
    expect(counts.ipv4).toBe(1);

    // Loopback + unspecified preserved
    const c2 = emptyCounts();
    expect(redactPiiString('binding to 127.0.0.1 and 0.0.0.0', c2)).toBe('binding to 127.0.0.1 and 0.0.0.0');
    expect(c2.ipv4).toBe(0);
  });

  it('redacts IPv6 addresses except ::1 and ::', () => {
    const counts = emptyCounts();
    expect(redactPiiString('forwarding via 2001:db8::1:1 today', counts)).toMatch(/\[REDACTED-IPV6\]/);
    expect(counts.ipv6).toBeGreaterThanOrEqual(1);

    const c2 = emptyCounts();
    expect(redactPiiString('binding to ::1', c2)).toBe('binding to ::1');
    expect(c2.ipv6).toBe(0);
  });

  it('redacts URL userinfo (https://user:pass@host)', () => {
    const counts = emptyCounts();
    // Use a token shape that won't ALSO match the secret-shape regex --
    // we are testing the URL-userinfo path here in isolation.
    expect(redactPiiString('clone https://x-access-token:supersecret@github.com/foo/bar.git', counts)).toBe(
      'clone https://[REDACTED-USERINFO]@github.com/foo/bar.git',
    );
    expect(counts.url_userinfo).toBe(1);
  });

  it('redacts URL userinfo BEFORE email -- token@host does not look like an email after redaction', () => {
    const counts = emptyCounts();
    // The combined string has both an URL-userinfo pattern AND would,
    // without ordering care, look like an email "token@host.com" to the
    // email regex. Order: URL-userinfo first.
    const out = redactPiiString('clone https://x:ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA@github.com/foo.git', counts);
    expect(out).toMatch(/\[REDACTED-USERINFO\]/);
    // The host portion remains visible (github.com); not gobbled by email regex
    expect(out).toMatch(/@github\.com/);
    expect(counts.url_userinfo).toBe(1);
    // email count should be 0 -- the @ in the URL was userinfo, not an email
    expect(counts.email).toBe(0);
  });

  it('redacts GitHub PAT shapes (ghp_, gho_, ghs_, ghu_, ghr_)', () => {
    const counts = emptyCounts();
    const text = 'tokens: ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA, gho_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const out = redactPiiString(text, counts);
    expect(out).not.toMatch(/ghp_/);
    expect(out).not.toMatch(/gho_/);
    expect(counts.secret_shape).toBeGreaterThanOrEqual(2);
  });

  it('redacts OpenAI sk- token shapes', () => {
    const counts = emptyCounts();
    const out = redactPiiString('using key sk-abc123def456ghi789jkl012mno345pqr', counts);
    expect(out).toMatch(/\[REDACTED-SECRET\]/);
    expect(out).not.toMatch(/sk-abc/);
    expect(counts.secret_shape).toBe(1);
  });

  it('redacts AWS access key IDs (AKIA prefix)', () => {
    const counts = emptyCounts();
    // Use a pattern-matching but clearly synthetic key (not a real AWS key)
    // Actual key format: AKIA + 16 uppercase alphanumerics
    // Synthetic 20-char key (AKIA + 16 uppercase alphanum) -- clearly not real
    // Synthetic 20-char key: AKIA + exactly 16 uppercase alphanum chars
    const out = redactPiiString('aws access key AKIAT3STFAKEKEY0ID12 found in env', counts);
    expect(out).toMatch(/\[REDACTED-SECRET\]/);
    expect(counts.secret_shape).toBe(1);
  });

  it('redacts Bearer tokens', () => {
    const counts = emptyCounts();
    // Sprint-040 #0368: fixture rewritten to a clearly-fake non-JWT
    // string after GitHub secret-scanning fired AGAIN on the prior
    // split-across-concat approach (sprint-037 #0347 Part A) -- the
    // scanner resolves simple string concatenations and matched the
    // joined `Authorization: Bearer eyJ...` form anyway.
    //
    // The fixture below satisfies the redactor's regex
    // `/\b(Bearer|Token|Authorization:\s*Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi`
    // without starting with `eyJ` (the JWT marker that triggers GitHub's
    // "HTTP bearer authentication header" detector). It is obviously a
    // test fixture from reading it; no scanner should mistake it for a
    // real credential.
    const fakeBearer = 'FIXTURE.BEARER.NOT-A-REAL-TOKEN-FOR-REDACTOR-REGRESSION-TEST';
    const out = redactPiiString('Authorization: Bearer ' + fakeBearer, counts);
    expect(out).toMatch(/\[REDACTED-TOKEN\]/);
    expect(counts.bearer_token).toBe(1);
  });

  it('redacts Bearer tokens regardless of whether the literal is split across concatenation', () => {
    // Regression cover for runtime-joined tokens: the redactor must
    // catch tokens built from concatenated parts at runtime (e.g. a
    // helper that joins a prefix + a suffix before sending). Sprint-040
    // #0368 reframed this test away from its original "evade GH scanner"
    // purpose -- that approach failed -- to its still-valid purpose:
    // runtime-joined-token coverage.
    const counts = emptyCounts();
    const tokenA = 'FIXTURE.';
    const tokenB = 'CONCATENATED-BEARER-PROOF-NOT-A-REAL-TOKEN';
    const out = redactPiiString(`Authorization: Bearer ${tokenA}${tokenB}`, counts);
    expect(out).toMatch(/\[REDACTED-TOKEN\]/);
    expect(counts.bearer_token).toBe(1);
  });

  it('redacts Windows user paths', () => {
    const counts = emptyCounts();
    const out = redactPiiString('reading C:\\Users\\helmut.schindlwick\\AppData\\Local\\swao', counts);
    expect(out).toBe('reading C:\\Users\\[REDACTED-USER]\\AppData\\Local\\swao');
    expect(counts.user_path).toBe(1);
  });

  it('redacts POSIX home paths (Linux + macOS)', () => {
    const counts = emptyCounts();
    expect(redactPiiString('reading /home/alice/swao/log', counts)).toBe('reading /home/[REDACTED-USER]/swao/log');
    expect(redactPiiString('reading /Users/bob/Documents', counts)).toBe('reading /Users/[REDACTED-USER]/Documents');
    expect(counts.user_path).toBe(2);
  });

  it('returns the input unchanged when there is no PII to redact', () => {
    const counts = emptyCounts();
    expect(redactPiiString('plain log line about pass 01', counts)).toBe('plain log line about pass 01');
    expect(Object.values(counts).every((v) => v === 0)).toBe(true);
  });

  it('handles empty / null-ish inputs gracefully', () => {
    const counts = emptyCounts();
    expect(redactPiiString('', counts)).toBe('');
    expect(Object.values(counts).every((v) => v === 0)).toBe(true);
  });
});

describe('redactPiiValue (#0327 Part D -- recursive redaction)', () => {
  it('redacts strings inside objects', () => {
    const counts = emptyCounts();
    const out = redactPiiValue({ url: 'cloned https://x:supersecret@github.com/foo.git', user: 'alice@x.com' }, counts) as Record<string, string>;
    expect(out.url).toMatch(/\[REDACTED-USERINFO\]/);
    expect(out.url).toMatch(/@github\.com/);  // host not eaten
    expect(out.user).toBe('[REDACTED-EMAIL]');
    expect(counts.url_userinfo).toBe(1);
    expect(counts.email).toBe(1);
  });

  it('redacts strings inside arrays', () => {
    const counts = emptyCounts();
    const out = redactPiiValue(['a@x.com', 'b@y.com', 'plain'], counts) as string[];
    expect(out[0]).toBe('[REDACTED-EMAIL]');
    expect(out[1]).toBe('[REDACTED-EMAIL]');
    expect(out[2]).toBe('plain');
    expect(counts.email).toBe(2);
  });

  it('recurses into nested objects', () => {
    const counts = emptyCounts();
    const input = {
      level1: {
        level2: {
          email: 'deep@example.com',
          ip: '10.0.0.5',
        },
      },
    };
    const out = redactPiiValue(input, counts) as { level1: { level2: { email: string; ip: string } } };
    expect(out.level1.level2.email).toBe('[REDACTED-EMAIL]');
    expect(out.level1.level2.ip).toBe('[REDACTED-IPV4]');
    expect(counts.email).toBe(1);
    expect(counts.ipv4).toBe(1);
  });

  it('preserves null / undefined / numbers / booleans', () => {
    const counts = emptyCounts();
    const out = redactPiiValue({ a: null, b: undefined, c: 42, d: true }, counts) as Record<string, unknown>;
    expect(out.a).toBeNull();
    expect(out.b).toBeUndefined();
    expect(out.c).toBe(42);
    expect(out.d).toBe(true);
  });
});
