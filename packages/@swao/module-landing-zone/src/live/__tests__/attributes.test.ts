// #3886 (Design 123 sections 5.7 and 12): the `attributes` map of every
// returned property, its one privacy filter, the scan boundary that applies
// it, and the ROLES.md coverage list parser. Property key names follow the
// shapes the OTC RMS inventory, the STACKIT iaas v2 schemas and Azure
// Resource Graph return; every value is synthetic.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CredentialStore, LZ_LIVE_ATTRIBUTES_MAX, LzLiveAttributesSchema, LzLiveResourceSchema, LzLiveScanSchema } from '@swao/core';
import { ATTRIBUTES_TRUNCATED_KEY, flattenAttributes } from '../attributes.js';
import { attributeKeyRule, filterAttributes, filterResourceAttributes, lzPseudonymSaltKey, pseudonymiseName, pseudonymisePerson } from '../privacy.js';
import { parseCoverageList } from '../coverage-list.js';
import { runLzLiveScan } from '../scan.js';
import { registerBuiltInLiveLzDrivers, UNVERIFIED_DRIVERS_ENV } from '../builtin.js';
import { unregisterLiveLzDriver } from '../registry.js';
import { READONLY_ROLE, makeOtcMock } from '../otc/__tests__/otc-mock.js';
import { STACKIT_IAAS_NORMALISED_KEYS } from '../stackit/stackit-driver.js';
import { AZURE_INVENTORY_QUERY, AZURE_RESOURCE_NORMALISED_KEYS } from '../azure/azure-driver.js';
import { OTC_RMS_NORMALISED_KEYS } from '../otc/otc-driver.js';

// Identity-shaped fake values, built at runtime.
const PERSON = ['Jane', 'Doe'].join(' ');
const EMAIL = ['jane.doe', 'example.org'].join('@');
const LOGIN = ['mock', 'login', '42'].join('-');
const SALT = 'b'.repeat(64);
const FREE_TEXT = ['Created by', 'the platform team, please do not modify'].join(' ');
const ACCESS_KEY_ID = ['MOCK', 'AK', '0000'].join('');

const tmp: string[] = [];
const tempDir = (p: string): string => {
  const d = mkdtempSync(join(tmpdir(), p));
  tmp.push(d);
  return d;
};
beforeEach(() => unregisterLiveLzDriver());
afterEach(() => {
  unregisterLiveLzDriver();
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** An OTC RMS resource shape (keys as the inventory returns them, values synthetic). */
const RMS_SG = {
  id: 'sg-0001', name: 'web-tier-sg', provider: 'vpc', type: 'securityGroups', region_id: 'eu-de', project_id: 'p-0001', project_name: 'eu-de',
  ep_id: '0', ep_name: 'default', checksum: 'c0ffee', created: '2026-10-28T18:40:39.000Z', updated: '2026-10-28T18:40:39.000Z', provisioning_state: 'Succeeded',
  tags: { env: 'test' },
  properties: {
    description: FREE_TEXT,
    security_group_rules: [
      { direction: 'ingress', ethertype: 'IPv4', protocol: 'tcp', port_range_min: 22, port_range_max: 22, remote_ip_prefix: '0.0.0.0/0', description: FREE_TEXT },
      { direction: 'egress', ethertype: 'IPv6', protocol: null, remote_ip_prefix: '::/0' },
    ],
  },
};
const RMS_USER = {
  id: 'u-0001', name: LOGIN, provider: 'iam', type: 'users', region_id: 'global', created: '2026-10-01T00:00:00.000Z',
  properties: { enabled: true, pwd_status: true, pwd_strength: 'high', password_expires_at: '2027-01-01T00:00:00Z', last_login_time: '2026-11-01T08:00:00Z', virtual_mfa_device: false, credentials: [{ access: ACCESS_KEY_ID, status: 'active' }], email: EMAIL, is_root_user: false, creator: PERSON },
};

describe('flattenAttributes (#3886)', () => {
  it('flattens nested objects to dotted keys, keeps scalar arrays, indexes object arrays and omits the normalised keys', () => {
    const a = flattenAttributes(RMS_SG, { omit: OTC_RMS_NORMALISED_KEYS });
    expect(a).toBeDefined();
    expect(a).toMatchObject({
      ep_id: '0',
      provisioning_state: 'Succeeded',
      'properties.security_group_rules.0.direction': 'ingress',
      'properties.security_group_rules.0.port_range_min': 22,
      'properties.security_group_rules.0.remote_ip_prefix': '0.0.0.0/0',
      'properties.security_group_rules.1.protocol': null,
    });
    for (const k of OTC_RMS_NORMALISED_KEYS) expect(a).not.toHaveProperty(k);
    expect(flattenAttributes({ zones: ['1', '2'], sku: { name: 'Standard_LRS' } })).toEqual({ zones: ['1', '2'], 'sku.name': 'Standard_LRS' });
    expect(LzLiveAttributesSchema.safeParse(a).success).toBe(true);
  });

  it('returns undefined when nothing but normalised keys is left, and caps the map with a truncation count', () => {
    expect(flattenAttributes({ id: 'x', labels: {}, createdAt: 't' }, { omit: STACKIT_IAAS_NORMALISED_KEYS })).toBeUndefined();
    expect(flattenAttributes(null)).toBeUndefined();
    const wide = Object.fromEntries(Array.from({ length: LZ_LIVE_ATTRIBUTES_MAX + 40 }, (_, i) => [`k${i}`, i]));
    const a = flattenAttributes(wide) ?? {};
    expect(Object.keys(a)).toHaveLength(LZ_LIVE_ATTRIBUTES_MAX);
    expect(a[ATTRIBUTES_TRUNCATED_KEY]).toBe(41);
    expect(LzLiveAttributesSchema.safeParse(a).success).toBe(true);
    expect(LzLiveAttributesSchema.safeParse({ ...a, extra: 1 }).success).toBe(false);
  });

  it('the resource schema accepts an attributes map and stays valid without one (additive)', () => {
    expect(LzLiveResourceSchema.safeParse({ id: 'r', type: 't' }).success).toBe(true);
    expect(LzLiveResourceSchema.safeParse({ id: 'r', type: 't', attributes: { 'properties.encrypted': true, zones: ['1'] } }).success).toBe(true);
    expect(LzLiveResourceSchema.safeParse({ id: 'r', type: 't', attributes: { nested: { no: 1 } } }).success).toBe(false);
  });
});

describe('the attributes privacy filter (#3886, Design 123 section 12)', () => {
  it('names a rule per key: free text, user data and secret-shaped keys dropped; names and people pseudonymised; the rest kept', () => {
    expect(attributeKeyRule('properties.description')).toBe('drop');
    expect(attributeKeyRule('properties.security_group_rules.0.description')).toBe('drop');
    expect(attributeKeyRule('errorMessage')).toBe('drop');
    expect(attributeKeyRule('properties.metadata.foo')).toBe('drop');
    expect(attributeKeyRule('userData')).toBe('drop');
    expect(attributeKeyRule('properties.credentials.0.access')).toBe('drop');
    expect(attributeKeyRule('properties.policy_document')).toBe('drop');
    expect(attributeKeyRule('properties.admin_password')).toBe('drop');
    expect(attributeKeyRule('properties.request.body')).toBe('drop');
    // a map keyed by names (node names, user keys) is not an identifier path
    expect(attributeKeyRule('properties.node_ips.web-node-01')).toBe('drop');
    expect(attributeKeyRule('name')).toBe('name');
    expect(attributeKeyRule('ep_name')).toBe('name');
    expect(attributeKeyRule('properties.hostName')).toBe('name');
    expect(attributeKeyRule('properties.keyName')).toBe('name');
    expect(attributeKeyRule('resourceGroup')).toBe('name');
    expect(attributeKeyRule('properties.creator')).toBe('person');
    expect(attributeKeyRule('properties.owner')).toBe('person');
    expect(attributeKeyRule('sku.name')).toBe('keep');
    expect(attributeKeyRule('properties.flavor.name')).toBe('keep');
    expect(attributeKeyRule('properties.password_expires_at')).toBe('keep');
    expect(attributeKeyRule('properties.pwd_status')).toBe('keep');
    expect(attributeKeyRule('properties.security_group_rules.0.remote_ip_prefix')).toBe('keep');
  });

  it('applies the rules to an OTC IAM user and a security group: no person, e-mail, login, free text or access key survives', () => {
    const user = filterAttributes(flattenAttributes(RMS_USER, { omit: OTC_RMS_NORMALISED_KEYS }), SALT, [LOGIN]);
    const sg = filterAttributes(flattenAttributes(RMS_SG, { omit: OTC_RMS_NORMALISED_KEYS }), SALT, [LOGIN]);
    const text = JSON.stringify([user, sg]);
    for (const leaked of [PERSON, EMAIL, LOGIN, FREE_TEXT, ACCESS_KEY_ID, 'web-tier-sg']) expect(text, leaked).not.toContain(leaked);
    expect(user.attributes).toMatchObject({
      'properties.email': pseudonymisePerson(EMAIL, SALT),
      'properties.creator': pseudonymisePerson(PERSON, SALT),
      'properties.pwd_status': true,
      'properties.virtual_mfa_device': false,
      'properties.password_expires_at': '2027-01-01T00:00:00Z',
    });
    expect(sg.attributes).toMatchObject({ ep_name: pseudonymiseName('default', SALT), 'properties.security_group_rules.0.remote_ip_prefix': '0.0.0.0/0' });
    expect(sg.dropped).toBe(2);
    expect(user.dropped).toBe(2);
  });

  it('pseudonymises e-mail addresses and login names in any value, element by element, and drops long or multi-line strings', () => {
    const f = filterAttributes({ serviceAccountMails: [EMAIL, 'n/a'], note2: `deployed by ${LOGIN}`, long: 'x'.repeat(300), multi: 'a\nb', size: 20 }, SALT, [LOGIN]);
    expect(f.attributes).toEqual({ serviceAccountMails: [pseudonymisePerson(EMAIL, SALT), 'n/a'], note2: pseudonymisePerson(`deployed by ${LOGIN}`, SALT), size: 20 });
    expect(f.dropped).toBe(2);
  });

  it('#3953: keeps the device-owner enum of a port and pseudonymises any other value of the key, and other owner keys', () => {
    const f = filterAttributes({
      'properties.vnic.deviceOwner': 'compute:eu-de-01',
      'properties.vnic.device_owner': 'neutron:LOADBALANCERV2',
      'other.vnic.deviceOwner': 'Jane Doe',
      'mail.deviceOwner': EMAIL,
      'tags.owner': 'compute:eu-de-01',
      owner: 'compute:eu-de-01',
      'properties.vnic.name': 'port-a',
    }, SALT);
    expect(f.attributes).toEqual({
      'properties.vnic.deviceOwner': 'compute:eu-de-01',
      'properties.vnic.device_owner': 'neutron:LOADBALANCERV2',
      'other.vnic.deviceOwner': pseudonymisePerson('Jane Doe', SALT),
      'mail.deviceOwner': pseudonymisePerson(EMAIL, SALT),
      owner: pseudonymisePerson('compute:eu-de-01', SALT),
      'properties.vnic.name': pseudonymiseName('port-a', SALT),
    });
    expect(f.dropped).toBe(1);
  });

  it('drops host addresses (IPv4, IPv6, /32, /128) and keeps network ranges', () => {
    const f = filterAttributes({ ip: '203.0.113.7', v6: '2001:db8::7', host32: '198.51.100.9/32', any: '0.0.0.0/0', any6: '::/0', net: '10.0.0.0/16', addrs: ['203.0.113.8'], ver: '1.2.3' }, SALT);
    expect(f.attributes).toEqual({ any: '0.0.0.0/0', any6: '::/0', net: '10.0.0.0/16', ver: '1.2.3' });
    expect(f.dropped).toBe(4);
  });

  it('Name- and Person- pseudonyms are keyed, deterministic and in separate domains', () => {
    expect(pseudonymiseName('web', SALT)).toMatch(/^Name-[0-9a-f]{10}$/);
    expect(pseudonymiseName(' WEB ', SALT)).toBe(pseudonymiseName('web', SALT));
    expect(pseudonymiseName('web', SALT)).not.toBe(pseudonymiseName('web', 'c'.repeat(64)));
    expect(pseudonymiseName('web', SALT).slice(5)).not.toBe(pseudonymisePerson('web', SALT).slice(7));
    expect(() => pseudonymiseName('web', '')).toThrow(/salt/);
  });

  it('filterResourceAttributes removes an attributes map that the filter empties and leaves resources without one untouched', () => {
    const plain = { id: 'r1', type: 't' };
    const out = filterResourceAttributes([plain, { id: 'r2', type: 't', attributes: { description: FREE_TEXT } }], SALT);
    expect(out.resources[0]).toBe(plain);
    expect(out.resources[1]).toEqual({ id: 'r2', type: 't' });
    expect(out.dropped).toBe(1);
  });
});

describe('drivers hand every other property to the attributes map (#3886)', () => {
  it('azure inventory reads the bare Resources table (every column) and maps id, type, location and tags', () => {
    expect(AZURE_INVENTORY_QUERY).toBe('Resources');
    expect(AZURE_RESOURCE_NORMALISED_KEYS).toEqual(['id', 'type', 'location', 'tags']);
  });
});

const YML = ['name: demo', 'landing_zones:', '  - id: otc-test', '    provider: otc', '    scopes:', '      - id: platform', '        kind: platform', '        auth: iam-password-token', '        regions: [eu-de]', ''].join('\n');

describe('runLzLiveScan stores attributes only after the privacy filter (#3886)', () => {
  it('OTC RMS properties reach the scan as attributes; names pseudonymised, free text and access keys dropped; no source added', async () => {
    registerBuiltInLiveLzDrivers({ [UNVERIFIED_DRIVERS_ENV]: 'otc' });
    const ws = tempDir('swao-attr-ws-');
    writeFileSync(join(ws, '.swao.yml'), YML);
    const store = new CredentialStore(tempDir('swao-attr-vault-'));
    await store.set('lz:otc-test:platform:username', LOGIN);
    await store.set('lz:otc-test:platform:password', 'mock-pass-value');
    await store.set('lz:otc-test:platform:domain', 'MOCK-DOMAIN');
    const mock = makeOtcMock({ roles: [READONLY_ROLE], resourcesPages: [[RMS_SG, RMS_USER]] });
    const out = await runLzLiveScan({ workspaceRoot: ws, lzId: 'otc-test', store, env: {}, fetchImpl: mock.fetch });
    const scan = out.results[0]?.scan;
    expect(scan).toBeDefined();
    expect(LzLiveScanSchema.safeParse(scan).success).toBe(true);
    const text = JSON.stringify(scan);
    for (const leaked of [PERSON, EMAIL, LOGIN, FREE_TEXT, ACCESS_KEY_ID, 'web-tier-sg']) expect(text, leaked).not.toContain(leaked);
    const salt = (await store.get(lzPseudonymSaltKey('otc-test'))) as string;
    const sg = scan?.estate.resources.find((r) => r.id === 'sg-0001');
    expect(sg?.attributes).toMatchObject({ ep_name: pseudonymiseName('default', salt), 'properties.security_group_rules.0.port_range_min': 22 });
    const user = scan?.estate.resources.find((r) => r.id === 'u-0001');
    expect(user?.attributes?.['properties.pwd_status']).toBe(true);
    // the filter adds no collection source: sources stay the record of what was read (replay and conformance compare them)
    expect(scan?.meta.sources.map((s) => s.name)).not.toContain('inventory:attributes');
  });
});

describe('ROLES.md read-call coverage list parser (#3886)', () => {
  const head = '## Read-call coverage\n\n| Read call | Feeds | Used | Reason when not used |\n|---|---|---|---|\n';
  it('parses the four driver lists', () => {
    const live = join(dirname(fileURLToPath(import.meta.url)), '..');
    for (const p of ['otc', 'aws', 'stackit', 'azure']) {
      const rows = parseCoverageList(readFileSync(join(live, p, 'ROLES.md'), 'utf-8'));
      expect(rows.filter((r) => r.used === 'yes').length, p).toBeGreaterThan(5);
      // #3881: a hierarchy row is planned until the driver's collector lands, then yes.
      expect(rows.some((r) => r.feeds.includes('hierarchy') && (r.used === 'planned' || r.used === 'yes')), p).toBe(true);
    }
  });
  it('refuses a missing section, a wrong header, a planned row without an issue, an unused row without a reason and a repeated call', () => {
    expect(() => parseCoverageList('# x')).toThrow(/no "## Read-call coverage"/);
    expect(() => parseCoverageList('## Read-call coverage\n\n| Call | Feeds |\n|---|---|\n')).toThrow(/header/);
    expect(() => parseCoverageList(`${head}| \`GET /v3/projects\` | hierarchy | planned | later |\n`)).toThrow(/names its issue/);
    expect(() => parseCoverageList(`${head}| \`GET /v3/projects\` | hierarchy | no | - |\n`)).toThrow(/recorded reason/);
    expect(() => parseCoverageList(`${head}| \`GET /a\` | estate | yes | - |\n| \`GET /a\` | estate | yes | - |\n`)).toThrow(/twice/);
    expect(() => parseCoverageList(`${head}| \`GET /a\` | billing | yes | - |\n`)).toThrow();
    expect(parseCoverageList(`${head}| \`ec2:DescribeVolumes\` | posture | planned | volume encryption (#3866) |\n`)).toEqual([{ call: 'ec2:DescribeVolumes', feeds: ['posture'], used: 'planned', reason: 'volume encryption (#3866)' }]);
  });
});
