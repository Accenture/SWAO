// #3862: policy-baseline.yaml schema and loader (Design 123 sections 5.1, 5.2, 7.2; D-09, D-10).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PolicyBaselineSchema,
  PolicySchema,
  POLICY_KINDS,
  POLICY_KIND_CATEGORY,
  POLICY_PARAM_SCHEMAS,
  POLICY_BASELINE_FILE,
  loadPolicyBaseline,
  policyKindParamNames,
  policyBaselineCapabilityTags,
  compareCatalogueVersions,
  findShippedPolicyBaseline,
  shippedPolicyIdsOf,
  policyBaselineDrift,
  parsePolicyBaselineText,
  readPolicyBaselineControlIds,
  policyBaselineFindings,
  type PolicyKind,
} from './policy-baseline.js';

/** One complete, valid parameter set per kind (Design 123 section 5.1 and the section 6.2 defaults). */
const VALID_PARAMS: Record<PolicyKind, Record<string, unknown>> = {
  region_residency: {
    allowed_countries: ['DE', 'EU'],
    allowed_operator_jurisdictions: ['EU-entity'],
    forbid_exposure: ['us_cloud_act', 'fisa_702'],
    required_certifications: ['BSI_C5'],
  },
  service_deny: { capabilities: ['managed_llm', 'postgresql'] },
  service_allow_list: { capabilities: ['vm_compute', 'object_storage'] },
  encryption_at_rest: { min_key_custody: 'customer-managed', applies_to: ['object_storage', 'block_storage'] },
  encryption_in_transit: { min_tls_version: '1.2', applies_to: ['load_balancer'] },
  no_public_exposure: { allow_capabilities: ['load_balancer', 'waf'] },
  no_open_admin_ingress: { ports: [22, 3389], forbidden_sources: ['0.0.0.0/0', '::/0'] },
  privileged_mfa: {},
  credential_age: { max_age_days: 90 },
  audit_trail: { all_regions: true },
  log_retention: { min_days: 180 },
  required_tags: { keys: ['owner', 'data-classification'] },
  min_availability_zones: { min: 2 },
  backup_configured: { applies_to: ['block_storage', 'postgresql'] },
  budget_alerts: { required: true },
  documented_exit: {},
};

const CAT_CODE: Record<PolicyKind, string> = {
  region_residency: 'RES',
  service_deny: 'SVC',
  service_allow_list: 'SVC',
  encryption_at_rest: 'ENC',
  encryption_in_transit: 'ENC',
  no_public_exposure: 'NET',
  no_open_admin_ingress: 'NET',
  privileged_mfa: 'IAM',
  credential_age: 'IAM',
  audit_trail: 'LOG',
  log_retention: 'LOG',
  required_tags: 'TAG',
  min_availability_zones: 'AVL',
  backup_configured: 'BCK',
  budget_alerts: 'COST',
  documented_exit: 'PRT',
};

function policyOf(kind: PolicyKind, n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const id = `CPB-${CAT_CODE[kind]}-${String(n).padStart(2, '0')}`;
  return {
    id,
    kind,
    category: POLICY_KIND_CATEGORY[kind],
    control: id,
    state: 'enabled',
    params: VALID_PARAMS[kind],
    default_source: 'BSI_C5_DAT-02 (frameworks/bsi-c5/controls.yaml:1165); BSI_OPS22_A3',
    ...overrides,
  };
}

const ALL_POLICIES = POLICY_KINDS.map((k, i) => policyOf(k, i + 1));

const base = {
  schema_version: '0.1',
  framework: 'CLIENT_LZ_POLICY_BASELINE',
  baseline_of: 'CLIENT_LZ_POLICY_BASELINE',
  catalogue_version: '1.0.0',
};

function issuesOf(doc: unknown): string[] {
  const r = PolicyBaselineSchema.safeParse(doc);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('PolicyBaselineSchema (#3862)', () => {
  it('accepts a valid policy of every kind of Design 123 section 5.1', () => {
    for (const p of ALL_POLICIES) {
      expect(issuesOf({ ...base, policies: [p] }), String(p.kind)).toEqual([]);
    }
    expect(issuesOf({ ...base, policies: ALL_POLICIES })).toEqual([]);
  });

  it('has one parameter schema and one category per kind', () => {
    expect(Object.keys(POLICY_PARAM_SCHEMAS).sort()).toEqual([...POLICY_KINDS].sort());
    expect(Object.keys(POLICY_KIND_CATEGORY).sort()).toEqual([...POLICY_KINDS].sort());
    expect(policyKindParamNames('privileged_mfa')).toEqual([]);
    expect(policyKindParamNames('no_open_admin_ingress')).toEqual(['ports', 'forbidden_sources']);
  });

  it('accepts the states enabled, disabled and not_set and rejects any other', () => {
    for (const state of ['enabled', 'disabled', 'not_set']) {
      expect(issuesOf({ ...base, policies: [policyOf('audit_trail', 1, { state })] }), state).toEqual([]);
    }
    expect(issuesOf({ ...base, policies: [policyOf('audit_trail', 1, { state: 'on' })] })).not.toEqual([]);
  });

  it('rejects a parameter of the wrong type and never coerces', () => {
    const wrong: [PolicyKind, Record<string, unknown>][] = [
      ['encryption_in_transit', { min_tls_version: 1.2 }], // unquoted YAML 1.2 is a number
      ['credential_age', { max_age_days: '90' }],
      ['credential_age', { max_age_days: 1.5 }],
      ['audit_trail', { all_regions: 'yes' }],
      ['no_open_admin_ingress', { ports: [0] }],
      ['no_open_admin_ingress', { ports: [70000] }],
      ['no_open_admin_ingress', { forbidden_sources: ['internet'] }],
      ['no_open_admin_ingress', { forbidden_sources: ['10.0.0.0/33'] }],
      ['region_residency', { allowed_countries: ['Germany'] }],
      ['region_residency', { allowed_countries: 'DE' }],
      ['service_deny', { capabilities: ['Microsoft.DBforPostgreSQL'] }],
      ['service_deny', { capabilities: [] }],
      ['encryption_at_rest', { min_key_custody: 'customer_managed' }],
      ['min_availability_zones', { min: 0 }],
    ];
    for (const [kind, params] of wrong) {
      expect(issuesOf({ ...base, policies: [policyOf(kind, 1, { params })] }), `${kind} ${JSON.stringify(params)}`).not.toEqual([]);
    }
    const tls = PolicySchema.safeParse(policyOf('encryption_in_transit', 1, { params: { min_tls_version: 1.2 } }));
    expect(tls.success).toBe(false);
    expect(JSON.stringify(tls.error?.issues)).toContain('quote it in YAML');
  });

  it('rejects an unknown kind, a category that does not match the kind and unknown parameters', () => {
    expect(issuesOf({ ...base, policies: [policyOf('audit_trail', 1, { kind: 'encrypt_everything' })] })).not.toEqual([]);
    expect(issuesOf({ ...base, policies: [policyOf('audit_trail', 1, { category: 'encryption' })] })).not.toEqual([]);
    expect(issuesOf({ ...base, policies: [policyOf('audit_trail', 1, { params: { all_regions: true, weight: 3 } })] })).not.toEqual([]);
    expect(issuesOf({ ...base, policies: [policyOf('privileged_mfa', 1, { params: { enforce: true } })] })).not.toEqual([]);
  });

  it('accepts partial parameters (absent values take the shipped default) but not an empty region_residency', () => {
    expect(issuesOf({ ...base, policies: [policyOf('region_residency', 1, { params: { allowed_countries: ['DE'] } })] })).toEqual([]);
    expect(issuesOf({ ...base, policies: [policyOf('region_residency', 2, { params: { required_certifications: ['BSI_C5'] } })] })).toEqual([]);
    const audit = PolicyBaselineSchema.parse({ ...base, policies: [policyOf('audit_trail', 1, { params: undefined })] });
    expect(audit.policies[0]?.params).toEqual({});
    expect(issuesOf({ ...base, policies: [policyOf('region_residency', 1, { params: {} })] }).join()).toContain('at least one parameter');
  });

  it('enforces the id forms of D-09 and unique ids', () => {
    const ok = ['CPB-RES-01', 'CPB-COST-01', 'CPB-SVC-100', 'X-ORG-SVC-01', 'X-BU2-TAG-12'];
    const bad = ['RES-01', 'cpb-res-01', 'CPB-RES-1', 'X-SVC-01', 'Y-ORG-SVC-01', 'X-org-SVC-01', 'CPB_RES_01'];
    for (const id of ok) expect(issuesOf({ ...base, policies: [policyOf('audit_trail', 1, { id })] }), id).toEqual([]);
    for (const id of bad) expect(issuesOf({ ...base, policies: [policyOf('audit_trail', 1, { id })] }), id).not.toEqual([]);
    const dup = issuesOf({ ...base, policies: [policyOf('audit_trail', 1), policyOf('log_retention', 1, { id: 'CPB-LOG-01' })] });
    expect(dup.join()).toContain('duplicate policy id "CPB-LOG-01"');
  });

  it('rejects unknown top-level keys, a wrong schema version and a non-semver catalogue_version', () => {
    expect(issuesOf({ ...base, settings: {} })).not.toEqual([]);
    expect(issuesOf({ ...base, schema_version: '1.0' })).not.toEqual([]);
    expect(issuesOf({ ...base, catalogue_version: '1.0' })).not.toEqual([]);
    expect(issuesOf({ ...base, framework: 'client-lz-policy-baseline' })).not.toEqual([]);
  });

  it('lists every capability tag the baseline names', () => {
    const doc = PolicyBaselineSchema.parse({ ...base, policies: ALL_POLICIES });
    expect(policyBaselineCapabilityTags(doc)).toEqual(
      ['block_storage', 'load_balancer', 'managed_llm', 'object_storage', 'postgresql', 'vm_compute', 'waf'].sort(),
    );
  });
});

describe('loadPolicyBaseline (#3862)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'swao-pb-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeControls(ids: string[]): void {
    const body = ids.map((id) => `  - id: ${id}\n    title: Control ${id}\n    description: Control text for ${id}.\n`).join('');
    writeFileSync(join(dir, 'controls.yaml'), `regime_meta:\n  id: CLIENT_LZ_POLICY_BASELINE\ncontrols:\n${body}`);
  }
  function writeBaseline(doc: unknown): void {
    writeFileSync(join(dir, POLICY_BASELINE_FILE), JSON.stringify(doc, null, 2)); // JSON is valid YAML
  }

  it('returns absent without a policy-baseline.yaml', () => {
    const r = loadPolicyBaseline(dir, 'CLIENT_LZ_POLICY_BASELINE');
    expect(r.status).toBe('absent');
    expect(r.baseline).toBeNull();
  });

  it('loads a valid YAML file with every kind', () => {
    writeControls(ALL_POLICIES.map((p) => String(p.control)));
    writeBaseline({ ...base, policies: ALL_POLICIES });
    const r = loadPolicyBaseline(dir, 'CLIENT_LZ_POLICY_BASELINE', { shippedPolicyIds: new Set(ALL_POLICIES.map((p) => String(p.id))) });
    expect(r.errors).toEqual([]);
    expect(r.status).toBe('ok');
    expect(r.baseline?.policies).toHaveLength(POLICY_KINDS.length);
  });

  it('loads the Design 123 section 7.2 YAML example', () => {
    writeControls(['CPB-RES-01', 'CPB-SVC-01']);
    writeFileSync(
      join(dir, POLICY_BASELINE_FILE),
      `schema_version: "0.1"
framework: CLIENT_LZ_POLICY_BASELINE
baseline_of: CLIENT_LZ_POLICY_BASELINE
catalogue_version: "1.0.0"
policies:
  - id: CPB-RES-01
    kind: region_residency
    category: data_residency
    control: CPB-RES-01
    state: enabled
    params:
      allowed_countries: [DE]
    default_source: "BSI_C5_DAT-02; BSI_OPS22_A3"
  - id: CPB-SVC-01
    kind: service_deny
    category: service_control
    control: CPB-SVC-01
    state: enabled
    params:
      capabilities: [postgresql]
    default_source: assumption
`,
    );
    expect(loadPolicyBaseline(dir, 'CLIENT_LZ_POLICY_BASELINE').status).toBe('ok');
  });

  it('is invalid on a framework id mismatch', () => {
    writeControls(['CPB-LOG-01']);
    writeBaseline({ ...base, policies: [policyOf('audit_trail', 1)] });
    const r = loadPolicyBaseline(dir, 'BSI_C5');
    expect(r.status).toBe('invalid');
    expect(r.errors.join()).toContain('does not match framework-meta.yaml id "BSI_C5"');
  });

  it('is invalid when a control is not in controls.yaml, or controls.yaml is missing or malformed', () => {
    writeBaseline({ ...base, policies: [policyOf('audit_trail', 1, { control: 'CPB-LOG-99' })] });
    expect(loadPolicyBaseline(dir).errors.join()).toContain('controls.yaml: missing');
    writeFileSync(join(dir, 'controls.yaml'), 'controls: not-a-list\n');
    expect(loadPolicyBaseline(dir).errors.join()).toContain('not readable as a controls catalogue');
    writeFileSync(join(dir, 'controls.yaml'), 'controls: [\n');
    expect(loadPolicyBaseline(dir).status).toBe('invalid');
    writeControls(['CPB-LOG-01']);
    const r = loadPolicyBaseline(dir);
    expect(r.status).toBe('invalid');
    expect(r.errors.join()).toContain('"CPB-LOG-99" is not a control id in controls.yaml');
  });

  it('is invalid on a duplicate id, an unknown kind and a wrong parameter type', () => {
    writeControls(['CPB-LOG-01']);
    writeBaseline({ ...base, policies: [policyOf('audit_trail', 1), policyOf('audit_trail', 1)] });
    expect(loadPolicyBaseline(dir).errors.join()).toContain('duplicate policy id');
    writeBaseline({ ...base, policies: [policyOf('audit_trail', 1, { kind: 'quantum_safe' })] });
    expect(loadPolicyBaseline(dir).status).toBe('invalid');
    writeBaseline({ ...base, policies: [policyOf('audit_trail', 1, { params: { all_regions: 'true' } })] });
    expect(loadPolicyBaseline(dir).errors.join()).toContain('policies.0.params.all_regions');
  });

  it('reserves the CPB- prefix for shipped policies when the shipped ids are given', () => {
    writeControls(['CPB-SVC-01', 'CPB-SVC-09', 'X-ORG-SVC-01']);
    const client = policyOf('service_deny', 9); // CPB-SVC-09 is not shipped
    writeBaseline({ ...base, framework: 'CLIENT_LZ_POLICY_BASELINE_HIGH', policies: [policyOf('service_deny', 1), client] });
    const shippedPolicyIds = new Set(['CPB-SVC-01']);
    const r = loadPolicyBaseline(dir, 'CLIENT_LZ_POLICY_BASELINE_HIGH', { shippedPolicyIds });
    expect(r.status).toBe('invalid');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('"CPB-SVC-09" uses the CPB- prefix reserved for shipped policies');
    writeBaseline({
      ...base,
      framework: 'CLIENT_LZ_POLICY_BASELINE_HIGH',
      policies: [policyOf('service_deny', 1), { ...client, id: 'X-ORG-SVC-01', control: 'X-ORG-SVC-01' }],
    });
    expect(loadPolicyBaseline(dir, 'CLIENT_LZ_POLICY_BASELINE_HIGH', { shippedPolicyIds }).status).toBe('ok');
  });

  it('requires every parameter of a client-added policy (no shipped default to fall back on)', () => {
    writeControls(['X-ORG-NET-01']);
    writeBaseline({ ...base, policies: [policyOf('no_open_admin_ingress', 1, { id: 'X-ORG-NET-01', control: 'X-ORG-NET-01', params: { ports: [22] } })] });
    const r = loadPolicyBaseline(dir);
    expect(r.status).toBe('invalid');
    expect(r.errors.join()).toContain('set forbidden_sources');
    writeBaseline({ ...base, policies: [policyOf('privileged_mfa', 1, { id: 'X-ORG-NET-01', control: 'X-ORG-NET-01', params: {} })] });
    expect(loadPolicyBaseline(dir).status).toBe('ok');
  });

  it('refuses a secret-shaped value and reports the path, never the value', () => {
    writeControls(['CPB-TAG-01']);
    const key = 'AKIA' + 'ABCDEFGHIJKLMNOP';
    writeBaseline({ ...base, policies: [policyOf('required_tags', 1, { params: { keys: ['owner', key] } })] });
    const r = loadPolicyBaseline(dir);
    expect(r.status).toBe('invalid');
    expect(r.errors).toEqual(['policies.0.params.keys.1: secret-shaped value refused; credentials never belong in framework content']);
    expect(r.errors.join()).not.toContain(key);
  });

  it('does not flag realistic baseline values as secret-shaped', () => {
    const ids = ALL_POLICIES.map((p) => String(p.control));
    writeControls(ids);
    const sourced = ALL_POLICIES.map((p) => ({
      ...p,
      default_source:
        'BSI_C5_CRY-01 key management (frameworks/bsi-c5/controls.yaml:421), BSI_C5_CRY-02 (:442), BSI_CON1_A2 (frameworks/bsi-grundschutz-2023/controls.yaml:314)',
    }));
    writeBaseline({ ...base, framework: 'CLIENT_LZ_POLICY_BASELINE_HIGH', policies: [...sourced, policyOf('audit_trail', 2, { default_source: 'assumption' })] });
    writeControls([...ids, 'CPB-LOG-02']);
    const r = loadPolicyBaseline(dir, 'CLIENT_LZ_POLICY_BASELINE_HIGH');
    expect(r.errors).toEqual([]);
    expect(r.status).toBe('ok');
  });

  it('is invalid, not a throw, on malformed YAML and on an unreadable file', () => {
    writeFileSync(join(dir, POLICY_BASELINE_FILE), 'policies: [\n');
    const r = loadPolicyBaseline(dir);
    expect(r.status).toBe('invalid');
    expect(r.errors[0]).toContain('not valid YAML');
    rmSync(join(dir, POLICY_BASELINE_FILE));
    mkdirSync(join(dir, POLICY_BASELINE_FILE)); // a directory where the file should be: readFileSync throws EISDIR
    expect(() => loadPolicyBaseline(dir)).not.toThrow();
    expect(loadPolicyBaseline(dir).status).toBe('invalid');
  });
});

describe('shipped baseline lookup and drift (#3869)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'swao-pb-shipped-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeFramework(folder: string, doc: Record<string, unknown> & { policies: Record<string, unknown>[] }): string {
    const dir = join(root, folder);
    mkdirSync(dir, { recursive: true });
    const body = doc.policies.map((p) => `  - id: ${String(p.control)}\n    title: Control ${String(p.control)}\n    description: Control text for this policy.\n`).join('');
    writeFileSync(join(dir, 'controls.yaml'), `controls:\n${body}`);
    writeFileSync(join(dir, POLICY_BASELINE_FILE), JSON.stringify(doc));
    return dir;
  }

  it('orders catalogue versions numerically', () => {
    expect(compareCatalogueVersions('1.0.0', '1.1.0')).toBeLessThan(0);
    expect(compareCatalogueVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareCatalogueVersions('2.0.0', '2.0.0')).toBe(0);
  });

  it('finds the shipped baseline by its framework id, not by folder name, and never throws', () => {
    writeFramework('other', { ...base, framework: 'OTHER_BASELINE', baseline_of: 'OTHER_BASELINE', policies: [policyOf('audit_trail', 1)] });
    const dir = writeFramework('zz-renamed', { ...base, policies: [policyOf('audit_trail', 1)] });
    mkdirSync(join(root, 'no-baseline'));
    const found = findShippedPolicyBaseline(root, 'CLIENT_LZ_POLICY_BASELINE');
    expect(found?.dir).toBe(dir);
    expect([...(shippedPolicyIdsOf(found) ?? [])]).toEqual(['CPB-LOG-01']);
    expect(findShippedPolicyBaseline(root, 'MISSING')).toBeNull();
    expect(shippedPolicyIdsOf(null)).toBeUndefined();
    expect(findShippedPolicyBaseline(join(root, 'does-not-exist'), 'X')).toBeNull();
  });

  it('reports stale copies, missing and removed shipped ids and differing policies', () => {
    const shipped = PolicyBaselineSchema.parse({
      ...base,
      catalogue_version: '1.1.0',
      policies: [policyOf('audit_trail', 1), policyOf('log_retention', 2), policyOf('budget_alerts', 1)],
    });
    const copy = PolicyBaselineSchema.parse({
      ...base,
      policies: [
        policyOf('audit_trail', 1, { state: 'disabled' }), // state change is the client's, not drift
        policyOf('log_retention', 2, { params: { min_days: 365 } }),
        policyOf('required_tags', 9),
        policyOf('privileged_mfa', 1, { id: 'X-ORG-IAM-01', control: 'X-ORG-IAM-01' }),
      ],
    });
    expect(policyBaselineDrift(copy, shipped)).toEqual({
      copy_version: '1.0.0',
      shipped_version: '1.1.0',
      stale: true,
      missing_shipped_ids: ['CPB-COST-01'],
      removed_shipped_ids: ['CPB-TAG-09'],
      differing_ids: ['CPB-LOG-02'],
    });
    expect(policyBaselineDrift(shipped, shipped)).toMatchObject({ stale: false, missing_shipped_ids: [], removed_shipped_ids: [], differing_ids: [] });
  });
});

// #4128 BC-01 (Design 123 section 17.5.5): the loader's content rules over a
// text, and the health-check rules over a document, shared with the MCP write path.
describe('parsePolicyBaselineText and policyBaselineFindings (#4128 BC-01)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'swao-pb-text-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const ids = ALL_POLICIES.map((p) => String(p.control));
  function writeControls(list: string[]): void {
    writeFileSync(join(dir, 'controls.yaml'), `controls:\n${list.map((id) => `  - id: ${id}\n    title: T\n`).join('')}`);
  }

  it('gives the same result as the loader for valid and invalid files', () => {
    writeControls(ids);
    const cases: unknown[] = [
      { ...base, policies: ALL_POLICIES },
      { ...base, framework: 'OTHER', policies: ALL_POLICIES },
      { ...base, policies: [policyOf('audit_trail', 1, { control: 'NOPE' })] },
      { ...base, policies: [policyOf('privileged_mfa', 1, { id: 'X-ORG-IAM-01', control: 'CPB-IAM-08' }), policyOf('log_retention', 1, { id: 'X-ORG-LOG-01', control: 'CPB-LOG-11', params: {} })] },
      { ...base, policies: [policyOf('required_tags', 1, { params: { keys: ['ghp' + '_' + 'a'.repeat(36)] } })] },
      { ...base, schema_version: '9.9', policies: [] },
    ];
    for (const doc of cases) {
      const text = JSON.stringify(doc, null, 2);
      writeFileSync(join(dir, POLICY_BASELINE_FILE), text);
      const shippedPolicyIds = new Set(['CPB-LOG-01']);
      const loaded = loadPolicyBaseline(dir, 'CLIENT_LZ_POLICY_BASELINE', { shippedPolicyIds });
      const parsed = parsePolicyBaselineText(text, { expectedFrameworkId: 'CLIENT_LZ_POLICY_BASELINE', shippedPolicyIds, controlIds: readPolicyBaselineControlIds(dir) });
      expect(parsed.ok).toBe(loaded.status === 'ok');
      expect(parsed.errors).toEqual(loaded.errors);
    }
  });

  it('reports a missing or unreadable controls.yaml as the loader does', () => {
    const text = JSON.stringify({ ...base, policies: [policyOf('audit_trail', 1)] });
    expect(readPolicyBaselineControlIds(dir)).toBe('missing');
    expect(parsePolicyBaselineText(text, { controlIds: 'missing' }).errors[0]).toMatch(/^controls\.yaml: missing/);
    writeFileSync(join(dir, 'controls.yaml'), 'just: text\n');
    expect(readPolicyBaselineControlIds(dir)).toBe('unreadable');
    expect(parsePolicyBaselineText(text, { controlIds: 'unreadable' }).errors[0]).toMatch(/^controls\.yaml: not readable/);
  });

  it('is invalid, not a throw, on malformed YAML text', () => {
    const r = parsePolicyBaselineText('policies: [unclosed', { controlIds: new Set() });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/^not valid YAML/);
  });

  it('applies the probe rules: not_set, stale copy with missing ids, unknown baseline_of, unused tags only with a vocabulary', () => {
    const shippedDoc = PolicyBaselineSchema.parse({ ...base, catalogue_version: '1.1.0', policies: [policyOf('audit_trail', 1), policyOf('budget_alerts', 1)] });
    const copy = PolicyBaselineSchema.parse({
      ...base,
      framework: 'CLIENT_COPY',
      policies: [policyOf('audit_trail', 1, { state: 'not_set' }), policyOf('service_deny', 1, { params: { capabilities: ['managed_llm'] } })],
    });
    const f = policyBaselineFindings(copy, { dir, baseline: shippedDoc }, ['vm_compute']);
    expect(f.errors).toEqual([]);
    expect(f.not_set).toEqual(['CPB-LOG-01']);
    expect(f.drift?.stale).toBe(true);
    expect(f.unused_tags).toEqual(['managed_llm']);
    expect(f.warnings).toEqual([
      'policy-baseline.yaml has 1 policy not reviewed (state not_set, not evaluated until reviewed): CPB-LOG-01',
      expect.stringMatching(/^policy-baseline\.yaml is stale \(catalogue_version 1\.0\.0 is lower than the shipped 1\.1\.0\); shipped policies missing from the copy: CPB-COST-01;/),
      'policy-baseline.yaml names capability tags no resolved LZ catalogue uses: managed_llm',
    ]);
    // No vocabulary: no unused-tag warning; no shipped baseline: the baseline_of warning instead of staleness.
    const g = policyBaselineFindings(copy, null, []);
    expect(g.unused_tags).toEqual([]);
    expect(g.drift).toBeNull();
    expect(g.warnings).toContain('policy-baseline.yaml baseline_of CLIENT_LZ_POLICY_BASELINE is not a baseline SWAO ships; staleness cannot be checked');
  });
});
