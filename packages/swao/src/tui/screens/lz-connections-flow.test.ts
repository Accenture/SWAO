// #3589: pure logic of the Landing Zone Connections screen.
import { describe, it, expect } from 'vitest';
import { WRITE_CAPABLE_ACCEPTED } from '@swao/tui-kit';
import {
  proposeScopeId,
  toScopeId,
  probeRow,
  readableCount,
  resultGuidance,
  availableKinds,
  buildConnectArgs,
  buildConnectionProbeArgs,
  buildCredentialsStdin,
  buildRemoveArgs,
  credentialLine,
  migrationTargets,
  parseConnectionProbe,
  parseRegions,
  parseTargets,
  suggestScopeId,
  validateRegistrationId,
  lzConnectionsPhaseGuidance,
  lzAuthMethodGuidance,
  lzScopeKindGuidance,
  lzAppLinkGuidance,
  visibleActions,
  buildRefreshArgs,
  awsSessionKeyScopes,
  expiredSessionAt,
  lzAppLinkRows,
} from './lz-connections-flow.js';

describe('lz-connections-flow (#3589)', () => {
  it('connect argv carries no credential value and no accept flag, and always --no-probe', () => {
    const args = buildConnectArgs({ lzId: 'otc-prod', provider: 'otc', scopeId: 'platform', kind: 'platform', auth: 'iam-password-token', regions: ['eu-de'], target: { project: 'eu-de_x' }, app: 'payments', display: 'Prod', credentialsOnStdin: true });
    expect(args).toEqual(['lz', 'connect', 'otc-prod', '--provider', 'otc', '--scope', 'platform', '--kind', 'platform', '--auth', 'iam-password-token', '--region', 'eu-de', '--target', 'project=eu-de_x', '--app', 'payments', '--display', 'Prod', '--credentials-stdin', '--no-probe']);
    expect(args.some((a) => a.startsWith('--accept'))).toBe(false);
    expect(buildConnectArgs({ lzId: 'a', provider: 'aws', scopeId: 's', kind: 'application', auth: 'x', credentialsOnStdin: false, moveLegacyCredentials: true })).toEqual(['lz', 'connect', 'a', '--provider', 'aws', '--scope', 's', '--kind', 'application', '--auth', 'x', '--move-legacy-credentials', '--no-probe']);
  });

  it('probe and remove argv', () => {
    expect(buildConnectionProbeArgs('a')).toEqual(['lz', 'probe', 'a']);
    expect(buildConnectionProbeArgs('a', 's')).toEqual(['lz', 'probe', 'a', '--scope', 's']);
    expect(buildRemoveArgs('a')).toEqual(['lz', 'remove', 'a']);
    expect(buildRemoveArgs('a', 's')).toEqual(['lz', 'remove', 'a', '--scope', 's']);
  });

  it('stdin text: blank values left out, JSON compacted to one line, other line breaks refused', () => {
    expect(buildCredentialsStdin({ username: 'u', password: ' ', domain: 'd' })).toEqual({ text: 'username=u\ndomain=d\n', fields: ['username', 'domain'] });
    expect(buildCredentialsStdin({})).toEqual({ text: '', fields: [] });
    expect(credentialLine('service-account-key', '{\n  "kid": "k"\n}')).toEqual({ line: 'service-account-key={"kid":"k"}' });
    expect(credentialLine('password', 'a\nb')).toEqual({ error: 'password: the value has a line break; paste it as one line' });
  });

  it('regions and targets', () => {
    expect(parseRegions('eu-de, eu-nl  eu01')).toEqual({ regions: ['eu-de', 'eu-nl', 'eu01'] });
    expect(parseRegions('')).toEqual({ regions: [] });
    expect('error' in parseRegions('EU_DE')).toBe(true);
    expect(parseTargets('project=p1, account=123')).toEqual({ target: { project: 'p1', account: '123' } });
    expect(parseTargets('')).toEqual({ target: {} });
    expect('error' in parseTargets('password=x')).toBe(true);
    expect('error' in parseTargets('project=')).toBe(true);
  });

  it('ids, kinds and scope suggestions', () => {
    expect(validateRegistrationId('otc-prod', 'id')).toBeNull();
    expect(validateRegistrationId('Otc Prod', 'id')).toMatch(/lower case letters, digits and single hyphens only/);
    expect(validateRegistrationId('Otc Prod', 'id')).not.toMatch(/kebab/i);
    expect(suggestScopeId([])).toBe('platform');
    // #4229 / #4230: the scope id and kind sub-steps explain where the id appears and PLZ and ALZ.
    expect(lzConnectionsPhaseGuidance('scope-id')!.sections![1]!.text).toContain('run file names');
    expect(lzConnectionsPhaseGuidance('kind')!.what).toMatch(/PLZ.*ALZ/);
    // #4230 run 8: the auth methods are explained per highlighted method, the kinds per kind.
    expect(lzConnectionsPhaseGuidance('auth')!.what).toMatch(/provider driver/);
    expect(lzAuthMethodGuidance({ id: 'iam-password-token', required: ['username', 'password', 'domain'], optional: [] }).what).toMatch(/password/);
    expect(lzAuthMethodGuidance({ id: 'aksk', required: ['access-key-id', 'secret-access-key'], optional: ['session-token'] }).what).toMatch(/access key and secret key/);
    expect(lzAuthMethodGuidance({ id: 'new-method', required: ['token'], optional: [] }).what).toContain('token');
    expect(lzScopeKindGuidance('platform').title).toContain('PLZ');
    expect(lzScopeKindGuidance('application').title).toContain('ALZ');
    expect(lzAppLinkGuidance('payments').what).toContain('payments');
    expect(lzConnectionsPhaseGuidance('target')!.what).toContain('project=eu-de_payments');
    expect(lzConnectionsPhaseGuidance('list')).toBeUndefined();
    expect(suggestScopeId([{ id: 'platform', kind: 'platform' }, { id: 'app-1', kind: 'application' }])).toBe('app-2');
    expect(availableKinds([])).toEqual(['platform', 'application']);
    expect(availableKinds([{ kind: 'platform' }])).toEqual(['application']);
  });

  it('migrate shows only with legacy keys; targets are scopes of aws / azure landing zones', () => {
    expect(visibleActions({ aws: 0, azure: 0 }).map((a) => a.id)).toEqual(['add-lz', 'add-scope', 'probe', 'remove']);
    expect(visibleActions({ aws: 1, azure: 0 }).map((a) => a.id)).toContain('migrate');
    const lzs = [{ id: 'aws-demo', provider: 'aws', scopes: [{ id: 'platform' }] }, { id: 'otc-prod', provider: 'otc', scopes: [{ id: 'platform' }] }];
    expect(migrationTargets({ aws: 2, azure: 1 }, lzs)).toEqual([{ lzId: 'aws-demo', provider: 'aws', scopeId: 'platform' }]);
    expect(migrationTargets({ aws: 0, azure: 0 }, lzs)).toEqual([]);
  });

  it('#4459: the SSO refresh shows only with an AWS session-keys scope; argv and scope list (expired first)', () => {
    expect(visibleActions({ aws: 0, azure: 0 }, 1).map((a) => a.id)).toContain('refresh-sso');
    expect(buildRefreshArgs('aws-prod', 'platform', 'ro')).toEqual(['lz', 'credentials', 'refresh', 'aws-prod', 'platform', '--profile', 'ro']);
    expect(buildRefreshArgs('aws-prod', 'platform')).toEqual(['lz', 'credentials', 'refresh', 'aws-prod', 'platform']);
    const lzs = [
      { id: 'aws-test', provider: 'aws', scopes: [{ id: 'platform', auth: 'session-keys', credentials: 'ok' }] },
      { id: 'aws-prod', provider: 'aws', scopes: [{ id: 'platform', auth: 'session-keys', credentials: 'expired' }, { id: 'other', auth: 'sso-profile', credentials: 'ok' }] },
      { id: 'otc-prod', provider: 'otc', scopes: [{ id: 'platform', auth: 'iam-password-token', credentials: 'expired' }] },
    ];
    expect(awsSessionKeyScopes(lzs)).toEqual([
      { lzId: 'aws-prod', scopeId: 'platform', expired: true },
      { lzId: 'aws-test', scopeId: 'platform', expired: false },
    ]);
    expect(expiredSessionAt(['x', 'warning: registered, but the session token expired at 2020-01-01T00:00:00Z; refresh it before a run'])).toBe('2020-01-01T00:00:00Z');
    expect(expiredSessionAt(['x'])).toBeNull();
  });

  it('#4458: app link rows: id label, name and type detail aligned, long names cut, unnamed apps show the type', () => {
    const rows = lzAppLinkRows([
      { id: 'portal', name: 'Demo Portal', kind: 'application' },
      { id: 'app0001', kind: 'service' },
      { id: 'app0002', name: 'A'.repeat(60), kind: 'service' },
    ]);
    expect(rows[0]).toEqual({ label: 'portal', detail: `${'Demo Portal'.padEnd(36)}  application` });
    expect(rows[1]!.detail).toBe(`${''.padEnd(36)}  service`);
    expect(rows[2]!.detail.startsWith(`${'A'.repeat(33)}...`)).toBe(true);
    expect(lzAppLinkRows([{ id: 'x', kind: 'service' }])).toEqual([{ label: 'x', detail: 'service' }]);
  });

  it('parses the lz probe output with identity and detail lines', () => {
    expect(parseConnectionProbe('scope platform: identity te_admin, read-only refused\n  coverage: 3 readable\nnoise')).toEqual([
      { scopeId: 'platform', identity: 'te_admin', readOnly: 'refused', detail: ['coverage: 3 readable'] },
    ]);
  });
});

describe('#4298 probe rows and result guidance', () => {
  it('a write-capable login is warn with the Setup Probe step words; reading nothing is fail', () => {
    expect(probeRow('refused', '56 readable')).toEqual({ level: 'warn', summary: WRITE_CAPABLE_ACCEPTED.text, detail: 'coverage 56 readable' });
    expect(probeRow('verified', '5 readable').level).toBe('ok');
    expect(probeRow('unverifiable', '5 readable').level).toBe('warn');
    expect(probeRow('refused', '0 readable').level).toBe('fail');
    expect(readableCount('56 readable, not readable: kms')).toBe(56);
  });

  it('the result guidance holds the role list and ROLES.md, never the CLI flag', () => {
    const probe = parseConnectionProbe([
      'scope platform: identity operator, read-only refused',
      '  coverage: 56 readable',
      '  credential is write-capable (the assigned roles allow 4 non-read action(s); allows *:*:*, identity::*). Use a read-only role (see the driver ROLES.md), or pass --accept-write-capable-credentials for this run.',
    ].join('\n'));
    const g = resultGuidance(probe, ['stored lz:otc-prod:platform:username']);
    const text = JSON.stringify(g);
    expect(text).toContain('allows *:*:*, identity::*');
    expect(text).toContain('ROLES.md');
    expect(text).toContain('lz:otc-prod:platform:username');
    expect(text).not.toContain('--accept-write-capable-credentials');
  });
});

describe('#4229 proposed scope id', () => {
  it('platform for the PLZ; the app, else the locator, else app-n for an ALZ; a taken id gets a suffix', () => {
    expect(proposeScopeId('platform', {}, undefined, [])).toBe('platform');
    expect(proposeScopeId('application', {}, 'payments', [{ id: 'platform', kind: 'platform' }])).toBe('payments');
    expect(proposeScopeId('application', { project: 'eu-de_Payments' }, undefined, [])).toBe('eu-de-payments');
    expect(proposeScopeId('application', {}, undefined, [{ id: 'platform', kind: 'platform' }, { id: 'app-1', kind: 'application' }])).toBe('app-2');
    expect(proposeScopeId('application', {}, 'payments', [{ id: 'payments', kind: 'application' }])).toBe('payments-2');
    expect(toScopeId('--A__b--')).toBe('a-b');
  });
});

describe('#4399 parseConnectionProbe: verdict line and identity line', () => {
  it('reads the state from the verdict and the comma identity from its own line', () => {
    expect(parseConnectionProbe([
      'scope platform: read-only check: write-capable, accepted for this run; SWAO only reads',
      '  identity: groups: read-only admin, admin',
      '  coverage: 56 readable',
    ].join('\n'))).toEqual([{ scopeId: 'platform', identity: 'groups: read-only admin, admin', readOnly: 'refused', detail: ['coverage: 56 readable'] }]);
  });
});
