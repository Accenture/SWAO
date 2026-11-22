// #3567: workspace `landing_zones[]` block (Design 120 section 6.1).

import { describe, expect, it } from 'vitest';
import { load } from 'js-yaml';
import { SwaoYmlSchema, SwaoYmlLandingZonesSchema } from '../swao-yml.js';

const VALID_YAML = `
landing_zones:
  - id: otc-prod
    provider: otc
    display: "T Cloud Public production"
    scopes:
      - id: platform
        kind: platform
        auth: iam-password-token
        regions: [eu-de, eu-nl]
      - id: app-payments
        kind: application
        auth: iam-password-token
        target: { project: eu-de_payments }
        app: payments
`;

function lzWith(scope: Record<string, unknown>, extra: Record<string, unknown> = {}): unknown {
  return [{ id: 'otc-prod', provider: 'otc', scopes: [{ id: 'platform', kind: 'platform', auth: 'iam-password-token', ...scope }], ...extra }];
}

describe('SwaoYmlSchema landing_zones (#3567)', () => {
  it('parses the Design 120 section 6.1 example with a platform and an application scope', () => {
    const parsed = SwaoYmlSchema.safeParse(load(VALID_YAML));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const lz = parsed.data.landing_zones?.[0];
    expect(lz?.id).toBe('otc-prod');
    expect(lz?.scopes.map((s) => s.kind)).toEqual(['platform', 'application']);
    expect(lz?.scopes[1]?.target?.project).toBe('eu-de_payments');
    expect(lz?.scopes[1]?.app).toBe('payments');
  });

  it('leaves workspace files without the block unchanged', () => {
    const raw = { assessment: { type: 'application' }, workspace: { run_retention: { keep_latest: 3 } } };
    const parsed = SwaoYmlSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.landing_zones).toBeUndefined();
  });

  it('accepts an application scope without a platform scope', () => {
    const raw = [{ id: 'aws-demo', provider: 'aws', scopes: [{ id: 'app-shop', kind: 'application', auth: 'sso-profile', target: { account: 'shop-dev' } }] }];
    expect(SwaoYmlLandingZonesSchema.safeParse(raw).success).toBe(true);
  });

  // #3975: the log archive scope (Design 120 section 6.1).
  it('accepts one application scope with purpose log-archive', () => {
    const raw = [{ id: 'aws-org', provider: 'aws', scopes: [{ id: 'platform', kind: 'platform', auth: 'session-keys' }, { id: 'log-archive', kind: 'application', auth: 'session-keys', purpose: 'log-archive' }] }];
    const parsed = SwaoYmlLandingZonesSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data[0]?.scopes[1]?.purpose).toBe('log-archive');
  });

  it.each([
    ['a platform log archive', [{ id: 'aws-org', provider: 'aws', scopes: [{ id: 'platform', kind: 'platform', auth: 'session-keys', purpose: 'log-archive' }] }], 'must be kind application'],
    ['two log archives', [{ id: 'aws-org', provider: 'aws', scopes: [{ id: 'la-1', kind: 'application', auth: 'session-keys', purpose: 'log-archive' }, { id: 'la-2', kind: 'application', auth: 'session-keys', purpose: 'log-archive' }] }], 'at most one log-archive scope'],
    ['an unknown purpose', [{ id: 'aws-org', provider: 'aws', scopes: [{ id: 'audit', kind: 'application', auth: 'session-keys', purpose: 'audit' }] }], 'purpose'],
  ])('rejects %s', (_label, raw, message) => {
    const parsed = SwaoYmlLandingZonesSchema.safeParse(raw);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')).toContain(message);
  });

  it.each([
    ['upper-case lz id', [{ id: 'OTC-Prod', provider: 'otc', scopes: [{ id: 'platform', kind: 'platform', auth: 'iam-password-token' }] }]],
    ['lz id with underscore', [{ id: 'otc_prod', provider: 'otc', scopes: [{ id: 'platform', kind: 'platform', auth: 'iam-password-token' }] }]],
    ['scope id with a trailing hyphen', lzWith({ id: 'platform-' })],
    ['unknown scope kind', lzWith({ kind: 'tenant' })],
    ['missing auth', [{ id: 'otc-prod', provider: 'otc', scopes: [{ id: 'platform', kind: 'platform' }] }]],
    ['empty scope list', [{ id: 'otc-prod', provider: 'otc', scopes: [] }]],
    ['provider with upper case', [{ id: 'otc-prod', provider: 'OTC', scopes: [{ id: 'platform', kind: 'platform', auth: 'iam-password-token' }] }]],
  ])('rejects %s', (_label, raw) => {
    expect(SwaoYmlLandingZonesSchema.safeParse(raw).success).toBe(false);
  });

  it.each([
    ['password key on a scope', lzWith({ password: 'x' })],
    ['username key on a scope', lzWith({ username: 'reader' })],
    ['tenant_id key on a landing zone', lzWith({}, { tenant_id: 'abc' })],
    ['user key inside target', lzWith({ target: { project: 'p', user: 'reader' } })],
  ])('rejects identity or credential keys: %s', (_label, raw) => {
    expect(SwaoYmlLandingZonesSchema.safeParse(raw).success).toBe(false);
  });

  // Key-shaped fixtures are assembled at run time so no literal secret shape is
  // committed (secret-detection gate); each is a public documentation example
  // or a made-up value of the right shape.
  const SECRET_SHAPED: Array<[string, string]> = [
    ['an AWS access key id (AKIA)', 'AK' + 'IA' + 'IOSFODNN7EXAMPLE'],
    ['an AWS temporary access key id (ASIA)', 'AS' + 'IA' + 'Q3EGRWTK5LZEXAMP'],
    ['an AWS secret access key with / and +', 'wJalrXUtnFEMI' + '/K7MDENG/bPxRfiCY+EXAMPLEKEY'],
    ['an OTC access key (20 upper-case alphanumerics)', 'HWMX' + 'RQ7ZP2KD8VNC4TY1'],
    ['an OTC secret key (40 characters)', 'Zx8Pq2LmVn5Rt7Wy' + '3Ka9Hd4Jf6Gs1Bc0Ne8Qu2Io'],
    ['an Azure client secret with ~ and .', 'Xk7Q~vB2nM.9pLr' + 'Ts4Wq_8Yz3Hd6Fg1Jc5Ae0Rb'],
    ['a PEM private key header', '-----BEGIN ' + 'PRIVATE KEY-----MIIEvQIBADANBg'],
    ['a JWT', 'ey' + 'JhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyZWFkZXIifQ.c2lnbmF0dXJlLXZhbHVlLWhlcmU'],
    ['a long high-entropy token', 'q8Zr2LkX9vB4nW7tY1mP5sD3fH6jK0aQ'],
  ];

  it.each(SECRET_SHAPED)('refuses %s as a string value with a vault hint', (_label, value) => {
    const res = SwaoYmlLandingZonesSchema.safeParse(lzWith({ target: { project: value } }));
    expect(res.success).toBe(false);
    if (!res.success) {
      const issue = res.error.issues.find((i) => i.message.includes('secret-shaped'));
      expect(issue?.message).toContain('credential vault');
      expect(issue?.path).toEqual([0, 'scopes', 0, 'target', 'project']);
    }
  });

  it.each([
    ['a 32-character lowercase hex OTC project id', 'a1b2c3d4e5f60718293a4b5c6d7e8f90'],
    ['a kebab and snake case project name with a year', 'eu-de_payments-platform-shared-services-2024'],
    ['a long project name without digits', 'eu-de_payments-platform-shared-services'],
    ['an Azure subscription GUID', '3fa85f64-5717-4562-b3fc-2c963f66afa6'],
    ['a 12-digit AWS account id', '123456789012'],
  ])('accepts %s as a locator', (_label, value) => {
    expect(SwaoYmlLandingZonesSchema.safeParse(lzWith({ target: { project: value } })).success).toBe(true);
  });

  it('does not flag ordinary ids, names and regions as secrets', () => {
    const raw = lzWith({ regions: ['eu-de', 'eu-nl', 'germanywestcentral', 'eu-central-1'], target: { project: 'eu-de_payments-platform-shared-services' } }, { display: 'T Cloud Public production landing zone' });
    expect(SwaoYmlLandingZonesSchema.safeParse(raw).success).toBe(true);
  });

  it.each([
    ['an upper-case region', lzWith({ regions: ['EU-DE'] })],
    ['a region with a space', lzWith({ regions: ['eu de'] })],
    ['an app link that is not kebab-case', lzWith({ app: 'Payments_App' })],
  ])('rejects %s', (_label, raw) => {
    expect(SwaoYmlLandingZonesSchema.safeParse(raw).success).toBe(false);
  });

  // #4459 (owner decision 2026-11-16): optional aws_profile, a name only.
  it('accepts an aws_profile name on an AWS scope and refuses it elsewhere or when it is not a name', () => {
    const aws = (aws_profile: string): unknown => [{ id: 'aws-prod', provider: 'aws', scopes: [{ id: 'platform', kind: 'platform', auth: 'session-keys', aws_profile }] }];
    const ok = SwaoYmlLandingZonesSchema.safeParse(aws('prod-readonly'));
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data[0]?.scopes[0]?.aws_profile).toBe('prod-readonly');
    expect(SwaoYmlLandingZonesSchema.safeParse(aws('Org.Admin@prod_1')).success).toBe(true);
    // The names aws configure sso suggests (<RoleName>-<account id>) are locators, not secrets.
    expect(SwaoYmlLandingZonesSchema.safeParse(aws('AdministratorAccess-123456789012')).success).toBe(true);
    expect(SwaoYmlLandingZonesSchema.safeParse(aws('PlatformReadOnlyAuditor-123456789012')).success).toBe(true);
    // A long random token is still refused (the entropy check is exempted for the role-account form only).
    const randomish = ['Zx9Qw3', 'Lm7Rt2', 'Vb5Nk8', 'Hy4Pd6', 'Gs1Jf0', 'Ka2Ue7', 'Wc3'].join('');
    expect(SwaoYmlLandingZonesSchema.safeParse(aws(randomish)).success).toBe(false);
    // A random token with an account id appended is refused too: the role name part keeps the entropy check.
    expect(SwaoYmlLandingZonesSchema.safeParse(aws(randomish + '-123456789012')).success).toBe(false);
    expect(SwaoYmlLandingZonesSchema.safeParse(aws('')).success).toBe(false);
    expect(SwaoYmlLandingZonesSchema.safeParse(aws('two words')).success).toBe(false);
    expect(SwaoYmlLandingZonesSchema.safeParse(lzWith({ aws_profile: 'prod-readonly' })).success).toBe(false);
    // The secret-shape pre-check still applies: an access key id in the field is refused by path.
    const keyShaped = ['AS', 'IA', 'ABCDEFGHIJKLMNOP'].join('');
    const r = SwaoYmlLandingZonesSchema.safeParse(aws(keyShaped));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join('.') === '0.scopes.0.aws_profile' && /secret-shaped/.test(i.message))).toBe(true);
      expect(JSON.stringify(r.error.issues)).not.toContain(keyShaped);
    }
  });

  it('rejects duplicate landing zone ids, duplicate scope ids and two platform scopes', () => {
    const scope = { id: 'platform', kind: 'platform', auth: 'iam-password-token' };
    expect(SwaoYmlLandingZonesSchema.safeParse([
      { id: 'otc-prod', provider: 'otc', scopes: [scope] },
      { id: 'otc-prod', provider: 'otc', scopes: [scope] },
    ]).success).toBe(false);
    expect(SwaoYmlLandingZonesSchema.safeParse([{ id: 'otc-prod', provider: 'otc', scopes: [scope, scope] }]).success).toBe(false);
    expect(SwaoYmlLandingZonesSchema.safeParse([{ id: 'otc-prod', provider: 'otc', scopes: [scope, { ...scope, id: 'platform-2' }] }]).success).toBe(false);
  });
});
