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

// #3415: secret-value masking. All values are synthetic and shorter than the
// secret-scan.sh generic-credential threshold (16 characters).

import { describe, it, expect } from 'vitest';
import {
  maskSecretValue,
  maskKnownSecret,
  maskCredentials,
  extractCredentialValues,
  maskSecretShapes,
  guardSecretText,
  guardSecretsDeep,
} from './secret-mask.js';

const PLANTED = 'Zx9-fake-Pw42'; // gitleaks:allow (synthetic #3415 fixture)

describe('maskSecretValue (#3415)', () => {
  it('keeps the first two characters and the length for values of 8+ characters', () => {
    expect(maskSecretValue(PLANTED)).toBe('Zx***(13)');
  });
  it('keeps only the length for short values', () => {
    expect(maskSecretValue('abc12')).toBe('***(5)');
  });
  it('never contains the value tail', () => {
    expect(maskSecretValue(PLANTED)).not.toContain('42');
  });
});

describe('maskKnownSecret (#3415)', () => {
  it('replaces every literal occurrence', () => {
    const out = maskKnownSecret(`a ${PLANTED} b ${PLANTED}`, PLANTED);
    expect(out).toBe('a Zx***(13) b Zx***(13)');
  });
  it('ignores values shorter than 3 characters', () => {
    expect(maskKnownSecret('a b c', 'b')).toBe('a b c');
  });
});

describe('maskCredentials: credential class (#3415)', () => {
  const positives: Array<[string, string]> = [
    [`password = "${PLANTED}"`, 'password = "Zx***(13)"'],
    [`passwort=${PLANTED}`, 'passwort=Zx***(13)'],
    [`pwd: ${PLANTED}`, 'pwd: Zx***(13)'],
    [`Hard-coded password '${PLANTED}' in TestHelper.java`, "Hard-coded password 'Zx***(13)' in TestHelper.java"],
    [`"dbPassword": "${PLANTED}"`, '"dbPassword": "Zx***(13)"'],
    [`DB_PASSWORD=${PLANTED}`, 'DB_PASSWORD=Zx***(13)'],
    [`apiKey: '${PLANTED}'`, "apiKey: 'Zx***(13)'"],
    [`client_secret => "${PLANTED}"`, 'client_secret => "Zx***(13)"'],
    [`secretKey := "${PLANTED}"`, 'secretKey := "Zx***(13)"'],
    [`Das Passwort ist "${PLANTED}"`, 'Das Passwort ist "Zx***(13)"'],
    ['pwd: "x"', 'pwd: "***(1)"'],
    [`"secret_value": "${PLANTED}"`, '"secret_value": "Zx***(13)"'],
  ];
  for (const [input, expected] of positives) {
    it(`masks: ${expected}`, () => {
      const r = maskCredentials(input);
      expect(r.text).toBe(expected);
      expect(r.count).toBe(1);
      expect(r.text).not.toContain(PLANTED);
    });
  }

  const negatives = [
    'The password policy requires 12 characters.',
    'token: string;',
    'password: z.string().min(8)',
    'token: process.env.API_TOKEN',
    'password: "${DB_PASSWORD}"',
    'max_tokens: 4096',
    'tokens_in: 1200',
    'secrets_in_env: true',
    'passwordHash: bcrypt',
    'password: "<your-password>"',
    'password: "****"',
    "password: ''",
    'apiKey: apiKey,',
    'token_budget: 8000',
    'secret: true',
  ];
  for (const input of negatives) {
    it(`leaves unchanged: ${input}`, () => {
      const r = maskCredentials(input);
      expect(r.text).toBe(input);
      expect(r.count).toBe(0);
    });
  }

  it('is idempotent', () => {
    const once = maskCredentials(`password = "${PLANTED}" and pwd=${PLANTED}`).text;
    const twice = maskCredentials(once);
    expect(twice.text).toBe(once);
    expect(twice.count).toBe(0);
  });

  it('stays linear on a long adversarial input (ReDoS guard)', () => {
    const evil = 'password:'.repeat(20000) + ' '.repeat(20000); // secret-scan-exempt: ReDoS probe, no value
    const t0 = Date.now();
    maskCredentials(evil);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('maskCredentials: JSON-escaped quotes (#3456)', () => {
  const positives: Array<[string, string]> = [
    [`password = \\"${PLANTED}\\"`, 'password = \\"Zx***(13)\\"'],
    [`{\\"password\\": \\"${PLANTED}\\"}`, '{\\"password\\": \\"Zx***(13)\\"}'],
    [`apiKey: \\'${PLANTED}\\'`, "apiKey: \\'Zx***(13)\\'"],
    [`Hard-coded password \\"${PLANTED}\\" found`, 'Hard-coded password \\"Zx***(13)\\" found'],
    // Double serialisation (a JSON string inside a JSON string).
    [`password = \\\\\\"${PLANTED}\\\\\\"`, 'password = \\\\\\"Zx***(13)\\\\\\"'],
    // A value that itself contains an escape sequence keeps it in the match.
    ['password = \\"Zx9\\\\fake1\\"', 'password = \\"Zx***(10)\\"'], // gitleaks:allow (synthetic #3456 fixture)
    ['pwd: \\"Zx\\tfake9\\"', 'pwd: \\"Zx***(9)\\"'], // gitleaks:allow (synthetic #3456 fixture)
  ];
  for (const [input, expected] of positives) {
    it(`masks: ${expected}`, () => {
      const r = maskCredentials(input);
      expect(r.text).toBe(expected);
      expect(r.count).toBe(1);
      expect(r.text).not.toContain(PLANTED);
    });
  }

  it('masks a credential inside a serialised JSON body and keeps the JSON valid', () => {
    const body = JSON.stringify({ derivation: `config sets password = "${PLANTED}"`, inner: JSON.stringify({ password: PLANTED }) });
    const r = maskCredentials(body);
    expect(r.text).not.toContain(PLANTED);
    expect(r.count).toBe(2);
    const parsed = JSON.parse(r.text) as { derivation: string; inner: string };
    expect(parsed.derivation).toBe('config sets password = "Zx***(13)"');
    expect(JSON.parse(parsed.inner)).toEqual({ password: 'Zx***(13)' });
  });

  const negatives = [
    'password: \\"${DB_PASSWORD}\\"',
    'password: \\"<your-password>\\"',
    'password: \\"****\\"',
    'password: \\"\\"',
    "the token\\'s scope is wide",
    'token: process.env.API_TOKEN',
  ];
  for (const input of negatives) {
    it(`leaves unchanged: ${input}`, () => {
      const r = maskCredentials(input);
      expect(r.text).toBe(input);
      expect(r.count).toBe(0);
    });
  }

  it('is idempotent', () => {
    const once = maskCredentials(`{\\"password\\": \\"${PLANTED}\\", \\"pwd\\": \\'${PLANTED}\\'}`).text;
    expect(once).not.toContain(PLANTED);
    const twice = maskCredentials(once);
    expect(twice.text).toBe(once);
    expect(twice.count).toBe(0);
  });

  it('extractCredentialValues returns the unescaped value', () => {
    expect(extractCredentialValues(`{\\"password\\": \\"${PLANTED}\\"}`)).toEqual([PLANTED]);
  });

  it('stays linear on a long adversarial escaped input (ReDoS guard)', () => {
    const evilA = 'password: \\"'.repeat(20000) + '\\'.repeat(20000); // secret-scan-exempt: ReDoS probe, no value
    const evilB = ('password = \\\\\\"' + 'x'.repeat(250)).repeat(800); // secret-scan-exempt: ReDoS probe, no value
    const evilC = ('pwd: \\"' + '\\x'.repeat(130)).repeat(800); // secret-scan-exempt: ReDoS probe, no value
    const t0 = Date.now();
    maskCredentials(evilA);
    maskCredentials(evilB);
    maskCredentials(evilC);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('extractCredentialValues (#3415)', () => {
  it('returns the quoted and bare credential values, longest first, skipping placeholders and short values', () => {
    const src = [
      `const pwd = "${PLANTED}";`,
      'DB_PASSWORD=abc9-xyz',
      'token: process.env.API_TOKEN',
      'password: "${DB_PASSWORD}"',
      "apiKey: 'ab1'",
    ].join('\n');
    expect(extractCredentialValues(src)).toEqual([PLANTED, 'abc9-xyz']);
  });
});

describe('maskSecretShapes (#3415)', () => {
  it('masks a Bearer token and keeps the scheme', () => {
    const tok = 'abcDEF0123456789xyz';
    const r = maskSecretShapes(`Authorization: Bearer ${tok}`);
    expect(r.text).toBe(`Authorization: Bearer ${maskSecretValue(tok)}`);
    expect(r.text).not.toContain(tok);
  });
  it('masks the password part of URL userinfo', () => {
    const r = maskSecretShapes(`jdbc://svc:${PLANTED}@db.example.test/app`);
    expect(r.text).toBe('jdbc://svc:Zx***(13)@db.example.test/app');
  });
  it('masks a PEM private-key body', () => {
    const begin = '-----BEGIN RSA PRIVATE ' + 'KEY-----';
    const end = '-----END RSA PRIVATE ' + 'KEY-----';
    const r = maskSecretShapes(`${begin}\nQUJDREVGR0hJSktMTU5PUA==\n${end}`);
    expect(r.text).toBe(`${begin}***${end}`);
  });
  it('is idempotent', () => {
    const once = maskSecretShapes(`Bearer abcDEF0123456789xyz`).text;
    expect(maskSecretShapes(once).text).toBe(once);
  });
});

describe('guardSecretText / guardSecretsDeep (#3415)', () => {
  it('leaves EVD- evidence IDs untouched', () => {
    const input = `EVD-SRC-PASSWORD-CONFIG cites password: "${PLANTED}"`;
    const r = guardSecretText(input);
    expect(r.text).toBe('EVD-SRC-PASSWORD-CONFIG cites password: "Zx***(13)"');
  });
  it('masks a JSON-escaped credential and leaves EVD- ids verbatim (#3456)', () => {
    const input = `{"evidence":"EVD-SRC-PASSWORD-CONFIG","body":"password = \\"${PLANTED}\\""}`;
    const r = guardSecretText(input);
    expect(r.text).toBe('{"evidence":"EVD-SRC-PASSWORD-CONFIG","body":"password = \\"Zx***(13)\\""}');
    expect(r.count).toBe(1);
  });
  it('masks nested strings, leaves keys, returns the original reference when clean', () => {
    const model = { signals: [{ id: 'DATA-02', derivation: `password '${PLANTED}'` }], risks: [{ trigger: 'none' }] };
    const r = guardSecretsDeep(model);
    expect(r.count).toBe(1);
    expect(JSON.stringify(r.value)).not.toContain(PLANTED);
    expect(r.value.risks).toBe(model.risks);
    const clean = { a: ['x', { b: 'y' }] };
    expect(guardSecretsDeep(clean).value).toBe(clean);
  });
});
