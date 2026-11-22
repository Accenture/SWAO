// #3587: privacy defaults of Design 120 section 6.4 for the live scan.
// Mock OTC tenant (otc-mock.ts) with identity-shaped values that must never
// reach the LzLiveScan, and the pre-LLM redactor over live data shapes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore, redactPreLlm } from '@swao/core';
import { createHash } from 'node:crypto';
import { lzPseudonymSalt, lzPseudonymSaltKey, pseudonymisePerson, pseudonymiseTags, pseudonymiseResources, PERSON_TAG_KEYS } from '../privacy.js';
import { runLzLiveScan } from '../scan.js';
import { registerBuiltInLiveLzDrivers, UNVERIFIED_DRIVERS_ENV } from '../builtin.js';
import { unregisterLiveLzDriver } from '../registry.js';
import { DOMAIN_ID, GROUP_ID, PROJECT_IDS, READONLY_ROLE, USER_ID, makeOtcMock } from '../otc/__tests__/otc-mock.js';
import { lzScanAction } from '../cli.js';

// Identity-shaped fake values, built at runtime.
const PERSON = ['Jane', 'Doe'].join(' ');
const EMAIL = ['jane.doe', 'example.org'].join('@');
const AUDIT_USER = ['audit', 'user', '7'].join('-');
const SOURCE_IP = ['198', '51', '100', '23'].join('.');
const SALT = 'a'.repeat(64);

const tmp: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmp.push(d);
  return d;
}
beforeEach(() => unregisterLiveLzDriver());
afterEach(() => {
  unregisterLiveLzDriver();
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('pseudonymisation helpers (#3587, section 6.4)', () => {
  it('Person-<hash> is deterministic per salt, case and space insensitive, and idempotent', () => {
    const p = pseudonymisePerson(PERSON, SALT);
    expect(p).toMatch(/^Person-[0-9a-f]{10}$/);
    expect(pseudonymisePerson(`  ${PERSON.toUpperCase()} `, SALT)).toBe(p);
    // An upstream pseudonym (recording neutraliser) is hashed again (#3687).
    expect(pseudonymisePerson(p, SALT)).not.toBe(p);
    expect(pseudonymisePerson(EMAIL, SALT)).not.toBe(p);
  });

  it('is keyed: another salt gives another pseudonym, and the unsalted hash of the value does not match', () => {
    const p = pseudonymisePerson(EMAIL, SALT);
    expect(pseudonymisePerson(EMAIL, 'b'.repeat(64))).not.toBe(p);
    const unsalted = `Person-${createHash('sha256').update(EMAIL.toLowerCase()).digest('hex').slice(0, 10)}`;
    expect(p).not.toBe(unsalted);
    expect(() => pseudonymisePerson(EMAIL, '')).toThrow(/salt/);
  });

  it('the salt is created once per landing zone in the vault and reused', async () => {
    const store = new CredentialStore(tempDir('swao-salt-vault-'));
    const a = await lzPseudonymSalt(store, 'otc-test');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await store.get(lzPseudonymSaltKey('otc-test'))).toBe(a);
    expect(await lzPseudonymSalt(store, 'otc-test')).toBe(a);
    expect(await lzPseudonymSalt(store, 'aws-demo')).not.toBe(a);
  });

  it('person tag keys and any e-mail valued tag are pseudonymised; other tags are kept', () => {
    expect(PERSON_TAG_KEYS).toEqual(expect.arrayContaining(['owner', 'createdby', 'contact', 'email']));
    const out = pseudonymiseTags({ Owner: PERSON, 'created-by': PERSON, cost_center: 'cc-12', note: `ask ${EMAIL}`, env: 'prod', contact: '' }, SALT);
    expect(out['Owner']).toBe(pseudonymisePerson(PERSON, SALT));
    expect(out['created-by']).toBe(pseudonymisePerson(PERSON, SALT));
    expect(out['note']).toMatch(/^Person-/);
    expect(out['cost_center']).toBe('cc-12');
    expect(out['env']).toBe('prod');
    expect(out['contact']).toBe('');
  });

  it('#3687: created-by with the login name, owner with an e-mail and provider key variants carry no person value', () => {
    const login = ['ops', 'login', '7'].join('-');
    const out = pseudonymiseTags({ 'created-by': login, created_by: login, owner: EMAIL, CreatedBy: PERSON, 'aws:createdBy': `arn:aws:iam::1:user/${login}`, note: `made by ${login}`, env: 'prod' }, SALT, [login]);
    const text = JSON.stringify(out);
    for (const v of [login, EMAIL, PERSON]) expect(text).not.toContain(v);
    for (const k of ['created-by', 'created_by', 'owner', 'CreatedBy', 'aws:createdBy', 'note']) expect(out[k]).toMatch(/^Person-[0-9a-f]{10}$/);
    expect(out['env']).toBe('prod');
  });

  it('pseudonymiseResources returns new objects and leaves the input untouched', () => {
    const input = [{ id: 'r1', type: 'x', tags: { owner: PERSON } }, { id: 'r2', type: 'y' }];
    const out = pseudonymiseResources(input, SALT);
    expect(input[0]!.tags.owner).toBe(PERSON);
    expect(out[0]!.tags?.owner).toBe(pseudonymisePerson(PERSON, SALT));
    expect(out[1]).toEqual({ id: 'r2', type: 'y' });
  });
});

const YML = ['name: demo', 'landing_zones:', '  - id: otc-test', '    provider: otc', '    scopes:', '      - id: platform', '        kind: platform', '        auth: iam-password-token', '        regions: [eu-de]', ''].join('\n');

describe('live scan output carries no people, source IPs or request bodies (#3587)', () => {
  it('runLzLiveScan pseudonymises tag people and drops the audit user and source IP', async () => {
    registerBuiltInLiveLzDrivers({ [UNVERIFIED_DRIVERS_ENV]: 'otc' });
    const ws = tempDir('swao-privacy-ws-');
    writeFileSync(join(ws, '.swao.yml'), YML);
    const store = new CredentialStore(tempDir('swao-privacy-vault-'));
    await store.set('lz:otc-test:platform:username', 'mock-user');
    await store.set('lz:otc-test:platform:password', 'mock-pass-value');
    await store.set('lz:otc-test:platform:domain', 'MOCK-DOMAIN');
    const mock = makeOtcMock({
      roles: [READONLY_ROLE],
      resourcesPages: [[{ id: 'res-1', provider: 'ecs', type: 'cloudservers', region_id: 'eu-de', name: `vm of ${PERSON}`, tags: { owner: PERSON, contact: EMAIL, env: 'prod' }, properties: { request: { body: 'secret-ish' } } }]],
      traces: [[
        { trace_name: 'login', read_only: true, user: { name: AUDIT_USER }, source_ip: SOURCE_IP },
        { trace_name: 'createServer', read_only: false, user: { name: PERSON }, source_ip: SOURCE_IP },
      ]],
    });
    const out = await runLzLiveScan({ workspaceRoot: ws, lzId: 'otc-test', store, env: {}, fetchImpl: mock.fetch });
    const scan = out.results[0]?.scan;
    expect(scan).toBeDefined();
    const text = JSON.stringify(scan);
    for (const leaked of [PERSON, EMAIL, AUDIT_USER, SOURCE_IP, 'secret-ish']) expect(text, leaked).not.toContain(leaked);
    const salt = await store.get(lzPseudonymSaltKey('otc-test'));
    expect(salt).toMatch(/^[0-9a-f]{64}$/);
    expect(scan?.estate.resources[0]?.tags).toEqual({ owner: pseudonymisePerson(PERSON, salt!), contact: pseudonymisePerson(EMAIL, salt!), env: 'prod' });
    expect(scan?.estate.activity_summary?.events_total).toBe(2);
  });
});

describe('no tenant, domain, project, user or group id in the run folder artefacts (#3587)', () => {
  it('lz-live-scan, lz-live-merged.yaml and lz-live-catalogue.json from the OTC mock carry none of the mock identity values', { timeout: 20_000 }, async () => {
    registerBuiltInLiveLzDrivers({ [UNVERIFIED_DRIVERS_ENV]: 'otc' });
    const ws = tempDir('swao-privacy-ids-');
    writeFileSync(join(ws, '.swao.yml'), YML.replace('regions: [eu-de]', 'regions: [eu-de, eu-nl]'));
    const store = new CredentialStore(tempDir('swao-privacy-ids-vault-'));
    const username = ['mock', 'login', 'name'].join('-');
    const domainName = ['MOCK', 'TENANT', 'NAME'].join('-');
    await store.set('lz:otc-test:platform:username', username);
    await store.set('lz:otc-test:platform:password', 'mock-pass-value');
    await store.set('lz:otc-test:platform:domain', domainName);
    const mock = makeOtcMock({ roles: [READONLY_ROLE] });
    const out = join(ws, 'landing-zones', 'otc-test', 'wsp', 'runs', '2026-11-03T08-00-00');
    const code = await lzScanAction('otc-test', { mode: 'live', out }, { cwd: ws, store, env: {}, fetchImpl: mock.fetch, out: () => undefined, err: () => undefined, guard: { requireFeature: () => undefined } });
    expect(code).toBe(0);
    const files = readdirSync(out).sort();
    // #3956: evidence-refs.json is the local evidence map (never published); the mock's scan holds no identity value, so neither does the map.
    expect(files).toEqual(['evidence-refs.json', 'lz-live-catalogue.json', 'lz-live-merged.yaml', 'otc-test.platform.lz-live-scan.json']);
    const identity = [DOMAIN_ID, USER_ID, GROUP_ID, ...Object.values(PROJECT_IDS), username, domainName, 'mock-user', 'MOCK-DOMAIN'];
    for (const f of files) {
      const text = readFileSync(join(out, f), 'utf-8');
      for (const v of identity) expect(text, `${f} contains ${v}`).not.toContain(v);
    }
  });
});

describe('live data reaching an LLM path passes the pre-LLM redactor (#3587)', () => {
  it('redactPreLlm removes e-mail addresses and IP addresses from serialised live data', () => {
    // Every LLM driver scrubs its request text with redactPreLlm (module-llm-providers egress-redaction.ts, #3157).
    const liveText = JSON.stringify({ estate: { resources: [{ id: 'r1', tags: { contact: EMAIL } }], guardrails: [{ type: 'cts', detail: `forwarded from ${SOURCE_IP}` }] } });
    const { text } = redactPreLlm(liveText);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(SOURCE_IP);
  });
});
