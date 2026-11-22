// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Doctor module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { load } from 'js-yaml';
import { buildCommunityFrameworksProbe } from './compliance-catalogues-probe.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'swao-probe-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeRegime(
  catalogsDir: string,
  scope: 'community',
  id: string,
  filename: string,
  controlsCount: number,
  metaVersion = '1.0',
  controlPrefix = 'CTRL',
  replaces: string[] = [],
) {
  const scopeDir = join(catalogsDir, scope);
  mkdirSync(scopeDir, { recursive: true });
  const indexPath = join(scopeDir, 'index.yaml');
  const indexEntry = `  - id: ${id}
    name: "${id} catalogue"
    version: "${metaVersion}"
    file: ${filename}
    controls_count: ${controlsCount}`;
  let body = '';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    body = require('fs').readFileSync(indexPath, 'utf-8');
  } catch {
    body = `schema_version: "1"\nscope: ${scope}\nregimes:\n`;
  }
  writeFileSync(indexPath, body + indexEntry + '\n');

  const controls = Array.from({ length: controlsCount })
    .map(
      (_, i) => `  - id: ${controlPrefix}_${i + 1}
    title: "Control ${i + 1}"
    description: "Test control number ${i + 1} for ${id}."
    evidence_basis:
      - signal_prefix: TF`,
    )
    .join('\n');
  const replacesBlock = replaces.length > 0
    ? `  replaces:\n${replaces.map((r) => `    - ${r}`).join('\n')}\n`
    : '';
  // Sprint-037 #0342: community-scope regimes need framework-meta.yaml-equivalent
  // fields (id + contributor) for the probe to validate them. Embed them in the
  // regime_meta block so the legacy single-file fixture shape still passes the
  // new probe checks. (`classification` was removed in sprint-038 #0349.)
  const communityFields = scope === 'community'
    ? `  contributor:
    name: "Test contributor"
`
    : '';
  writeFileSync(
    join(scopeDir, filename),
    `regime_meta:
  id: ${id}
  name: "${id} catalogue"
  version: "${metaVersion}"
  scope: ${scope}
  authority: "Test"
  description: "Test catalogue for ${id} used in unit tests."
  catalogue_version: "1.0.0"
${communityFields}${replacesBlock}controls:
${controls}
`,
  );
}

describe('buildCommunityFrameworksProbe', () => {
  it('returns absent when catalogs/ does not exist', () => {
    const result = buildCommunityFrameworksProbe(tmpRoot);
    expect(result.status).toBe('absent');
    expect(result.standard_count).toBe(0);
    expect(result.community_count).toBe(0);
  });

  it('returns ok when standard index is present and consistent', () => {
    const catalogsDir = join(tmpRoot, 'catalogs');
    writeRegime(catalogsDir, 'community', 'GDPR', 'gdpr-controls.yaml', 2);
    const result = buildCommunityFrameworksProbe(tmpRoot);
    expect(result.status).toBe('ok');
    expect(result.standard_count).toBe(0);
    expect(result.community_count).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('counts standard plus community regimes', () => {
    const catalogsDir = join(tmpRoot, 'catalogs');
    writeRegime(catalogsDir, 'community', 'GDPR', 'gdpr-controls.yaml', 2);
    writeRegime(catalogsDir, 'community', 'ACME-INTERNAL', 'acme-internal-controls.yaml', 1);
    const result = buildCommunityFrameworksProbe(tmpRoot);
    expect(result.status).toBe('ok');
    expect(result.standard_count).toBe(0);
    expect(result.community_count).toBe(2);
  });

  // Deleted: 'warns when community supersedes standard via replaces: (collision)'
  // Reason: replaces: now works between community frameworks only (no standard scope).
  // Two community entries with the same canonical id are a hard duplicate error, not
  // a collision warning. Cross-id alias collisions are a different case tested separately.

  it('warns when controls_count drifts from controls.length', () => {
    // Reframed from it.skip (#0367): drift detection still exists for community frameworks.
    const catalogsDir = join(tmpRoot, 'catalogs');
    const scopeDir = join(catalogsDir, 'community');
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(
      join(scopeDir, 'index.yaml'),
      `schema_version: "1"
scope: community
regimes:
  - id: GDPR
    name: "GDPR"
    version: "1.0"
    file: gdpr-controls.yaml
    controls_count: 5
`,
    );
    writeFileSync(
      join(scopeDir, 'gdpr-controls.yaml'),
      `regime_meta:
  id: GDPR
  name: "GDPR"
  version: "1.0"
  scope: community
  authority: "Test"
  description: "Test catalogue for drift detection."
  catalogue_version: "1.0.0"
  contributor:
    name: "Test contributor"
controls:
  - id: G1
    title: "Only one control"
    description: "Single control to mismatch the index count."
    evidence_basis:
      - signal_prefix: TF
`,
    );
    const result = buildCommunityFrameworksProbe(tmpRoot);
    expect(result.status).toBe('warn');
    expect(result.warnings.some((w) => w.includes('controls.length=1'))).toBe(true);
  });

  it('warns when regime_meta.version drifts from index version', () => {
    // Reframed from it.skip (#0367): version drift detection still exists for community frameworks.
    const catalogsDir = join(tmpRoot, 'catalogs');
    const scopeDir = join(catalogsDir, 'community');
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(
      join(scopeDir, 'index.yaml'),
      `schema_version: "1"
scope: community
regimes:
  - id: GDPR
    name: "GDPR"
    version: "1.0"
    file: gdpr-controls.yaml
    controls_count: 1
`,
    );
    writeFileSync(
      join(scopeDir, 'gdpr-controls.yaml'),
      `regime_meta:
  id: GDPR
  name: "GDPR"
  version: "2.0"
  scope: community
  authority: "Test"
  description: "Test catalogue with version drift between index and header."
  catalogue_version: "1.0.0"
  contributor:
    name: "Test contributor"
controls:
  - id: G1
    title: "Only one control"
    description: "Single control sufficient for the drift test."
    evidence_basis:
      - signal_prefix: TF
`,
    );
    const result = buildCommunityFrameworksProbe(tmpRoot);
    expect(result.status).toBe('warn');
    expect(result.warnings.some((w) => w.includes('version'))).toBe(true);
  });

  it('returns fail when a malformed index parses as invalid', () => {
    const catalogsDir = join(tmpRoot, 'catalogs');
    const scopeDir = join(catalogsDir, 'community');
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(
      join(scopeDir, 'index.yaml'),
      `schema_version: "999"
scope: community
regimes: []
`,
    );
    const result = buildCommunityFrameworksProbe(tmpRoot);
    expect(result.status).toBe('fail');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('detects a missing catalogue file', () => {
    const catalogsDir = join(tmpRoot, 'catalogs');
    const scopeDir = join(catalogsDir, 'community');
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(
      join(scopeDir, 'index.yaml'),
      `schema_version: "1"
scope: community
regimes:
  - id: GDPR
    name: "GDPR"
    version: "1.0"
    file: gdpr-missing.yaml
    controls_count: 1
`,
    );
    const result = buildCommunityFrameworksProbe(tmpRoot);
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.toLowerCase().includes('gdpr-missing'))).toBe(true);
  });

  it('catalogs_dir field is the canonical wsp/inputs/catalogs path (or legacy fallback if pre-#0228 workspace)', () => {
    const result = buildCommunityFrameworksProbe(tmpRoot);
    // Empty tmpRoot has neither location, so the probe returns the canonical new path
    expect(result.catalogs_dir).toBe(join(tmpRoot, 'wsp', 'inputs', 'catalogs'));
  });
});

// Sprint-037 #0342: framework-meta.yaml required-field validation +
// per-framework summary emission. Helper to scaffold a folder-shape
// community framework (design 029 §11) inside the workspace.
function writeCommunityFolder(
  catalogsDir: string,
  folder: string,
  framework: {
    id: string;
    contributor?: { name: string; email?: string } | string | null;
    controls?: number;
  },
) {
  const dir = join(catalogsDir, 'community', folder);
  mkdirSync(dir, { recursive: true });
  // framework-meta.yaml (canonical)
  const metaLines: string[] = [
    'framework:',
    `  id: ${framework.id}`,
    `  name: "${framework.id} catalogue"`,
    `  version: "1.0"`,
    `  authority: "Test"`,
    `  catalogue_version: "1.0.0"`,
  ];
  if (framework.contributor !== null && framework.contributor !== undefined) {
    if (typeof framework.contributor === 'string') {
      metaLines.push(`  contributor: "${framework.contributor}"`);
    } else {
      metaLines.push('  contributor:');
      metaLines.push(`    name: "${framework.contributor.name}"`);
      if (framework.contributor.email) {
        metaLines.push(`    email: "${framework.contributor.email}"`);
      }
    }
  }
  writeFileSync(join(dir, 'framework-meta.yaml'), metaLines.join('\n') + '\n');

  // controls.yaml -- regime_meta block + N controls
  const controlsCount = framework.controls ?? 1;
  const controls = Array.from({ length: controlsCount })
    .map((_, i) => `  - id: ${framework.id}_C${i + 1}
    title: "Control ${i + 1}"
    description: "Synthetic test control ${i + 1} for ${framework.id}."
    evidence_basis:
      - signal_prefix: TF`)
    .join('\n');
  writeFileSync(
    join(dir, 'controls.yaml'),
    `regime_meta:
  id: ${framework.id}
  name: "${framework.id} catalogue"
  version: "1.0"
  authority: "Test"
  catalogue_version: "1.0.0"
controls:
${controls}
`,
  );
}

describe('buildCommunityFrameworksProbe -- sprint-037 #0342 framework-meta validation', () => {
  it('emits a per-framework summary for each community regime with contributor + controls_count', () => {
    const catalogsDir = join(tmpRoot, 'wsp', 'inputs', 'catalogs');
    writeCommunityFolder(catalogsDir, 'gdpr', {
      id: 'GDPR',
      contributor: { name: 'Jane Example', email: 'https://github.com/Accenture/SWAO/discussions' },
      controls: 53,
    });
    const result = buildCommunityFrameworksProbe(tmpRoot);
    expect(result.community_count).toBe(1);
    expect(result.frameworks).toHaveLength(1);
    const gdpr = result.frameworks[0]!;
    expect(gdpr.id).toBe('GDPR');
    expect(gdpr.scope).toBe('community');
    expect(gdpr.contributor).toBe('Jane Example');
    expect(gdpr.controls_count).toBe(53);
    expect(result.status).toBe('ok');
    expect(result.errors).toEqual([]);
  });

  it('fails with a clear error when contributor is missing', () => {
    const catalogsDir = join(tmpRoot, 'wsp', 'inputs', 'catalogs');
    writeCommunityFolder(catalogsDir, 'broken', {
      id: 'BROKEN',
      contributor: null,  // missing entirely
    });
    const result = buildCommunityFrameworksProbe(tmpRoot);
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => /community\/BROKEN.*contributor/.test(e))).toBe(true);
  });

  it('fails when controls.yaml is unparseable', () => {
    const catalogsDir = join(tmpRoot, 'wsp', 'inputs', 'catalogs');
    const dir = join(catalogsDir, 'community', 'broken');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'framework-meta.yaml'), `framework:
  id: BROKEN
  name: "BROKEN catalogue"
  version: "1.0"
  authority: "Test"
  catalogue_version: "1.0.0"
  contributor:
    name: "Test"
`);
    // Schema-invalid: `controls:` missing required min(1) array; this trips
    // RegimeCatalogueSchema.parse inside loadRegimeCatalogue (which the probe
    // catches and surfaces as an error). YAML itself is lenient about
    // syntactically-malformed input so we use a schema-invalid catalogue
    // instead of a syntactically-invalid one.
    writeFileSync(join(dir, 'controls.yaml'), `regime_meta:
  id: BROKEN
  name: "BROKEN catalogue"
  version: "1.0"
  authority: "Test"
  catalogue_version: "1.0.0"
controls: []
`);
    const result = buildCommunityFrameworksProbe(tmpRoot);
    expect(result.status).toBe('fail');
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// #0724: regime resolution probe -- warns for declared but unloadable regimes
// ---------------------------------------------------------------------------

describe('buildCommunityFrameworksProbe -- #0724 regime resolution warning', () => {
  it('warns (not fails) when an app declares a regime not in the catalog', () => {
    const catalogsDir = join(tmpRoot, 'wsp', 'inputs', 'catalogs');
    writeCommunityFolder(catalogsDir, 'gdpr', { id: 'GDPR', contributor: { name: 'Test' }, controls: 1 });
    // App that declares an unknown regime
    const appDir = join(tmpRoot, 'apps', 'my-app');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, '.swao.yml'), `assessment:\n  regimes_active:\n    - UNKNOWN_REGIME\n`);
    const result = buildCommunityFrameworksProbe(tmpRoot);
    expect(result.status).toBe('warn');
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some(w => w.includes('UNKNOWN_REGIME'))).toBe(true);
    expect(result.warnings.some(w => w.includes('apps/my-app'))).toBe(true);
  });

  it('does not warn when the declared regime is in the catalog', () => {
    const catalogsDir = join(tmpRoot, 'wsp', 'inputs', 'catalogs');
    writeCommunityFolder(catalogsDir, 'gdpr', { id: 'GDPR', contributor: { name: 'Test' }, controls: 1 });
    const appDir = join(tmpRoot, 'apps', 'my-app');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, '.swao.yml'), `assessment:\n  regimes_active:\n    - GDPR\n`);
    const result = buildCommunityFrameworksProbe(tmpRoot);
    expect(result.status).toBe('ok');
    expect(result.warnings.filter(w => w.includes('regime'))).toHaveLength(0);
  });

  it('skips the "all" sentinel regime without warning', () => {
    const catalogsDir = join(tmpRoot, 'wsp', 'inputs', 'catalogs');
    writeCommunityFolder(catalogsDir, 'gdpr', { id: 'GDPR', contributor: { name: 'Test' }, controls: 1 });
    const appDir = join(tmpRoot, 'apps', 'my-app');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, '.swao.yml'), `assessment:\n  regimes_active:\n    - all\n`);
    const result = buildCommunityFrameworksProbe(tmpRoot);
    expect(result.status).toBe('ok');
    expect(result.warnings).toHaveLength(0);
  });

  it('passes existing workspaces with no apps/ dir', () => {
    const catalogsDir = join(tmpRoot, 'wsp', 'inputs', 'catalogs');
    writeCommunityFolder(catalogsDir, 'gdpr', { id: 'GDPR', contributor: { name: 'Test' }, controls: 1 });
    const result = buildCommunityFrameworksProbe(tmpRoot);
    expect(result.status).toBe('ok');
    expect(result.warnings).toHaveLength(0);
  });
});

// #3577 (Design 120 §8.2): per-framework service-mapping coverage against the
// capability tags in use. A framework without service-controls.yaml is not a
// warning (no framework ships one yet); an invalid file or a mapping of a tag
// no resolved LZ catalogue uses is.
describe('buildCommunityFrameworksProbe -- #3577 service-mapping coverage', () => {
  const TAGS = ['key_vault', 'kubernetes', 'object_storage'];
  const catalogs = (): string => join(tmpRoot, 'wsp', 'inputs', 'catalogs');
  const writeMapping = (folder: string, body: string): void => {
    writeFileSync(join(catalogs(), 'community', folder, 'service-controls.yaml'), body);
  };
  const mapping = (id: string, rows: string): string => `schema_version: "0.1"\nframework: ${id}\nmappings:\n${rows}`;
  const row = (cap: string, ctl: string): string => `  - capability: ${cap}\n    controls: [${ctl}]\n    relevance: configure\n    confidence: curated\n`;

  it('reports absent with zero mapped and no warning when the framework has no service-controls.yaml', () => {
    writeCommunityFolder(catalogs(), 'gdpr', { id: 'GDPR', contributor: 'Test' });
    const result = buildCommunityFrameworksProbe(tmpRoot, { capabilityTags: TAGS });
    expect(result.frameworks[0]!.service_mapping).toEqual({ status: 'absent', mapped: 0, in_use: 3, unused_mappings: [] });
    expect(result.status).toBe('ok');
    expect(result.warnings).toEqual([]);
  });

  it('computes mapped / in-use capability tags for a valid mapping', () => {
    writeCommunityFolder(catalogs(), 'bsi-c5', { id: 'BSI_C5', contributor: 'Test' });
    writeMapping('bsi-c5', mapping('BSI_C5', row('key_vault', 'BSI_C5_C1') + row('object_storage', 'BSI_C5_C1')));
    const result = buildCommunityFrameworksProbe(tmpRoot, { capabilityTags: TAGS });
    expect(result.frameworks[0]!.service_mapping).toEqual({ status: 'ok', mapped: 2, in_use: 3, unused_mappings: [] });
    expect(result.status).toBe('ok');
    expect(result.warnings).toEqual([]);
  });

  it('warns (not fails) for control ids that the framework controls.yaml does not define', () => {
    writeCommunityFolder(catalogs(), 'bsi-c5', { id: 'BSI_C5', contributor: 'Test', controls: 2 });
    writeMapping('bsi-c5', mapping('BSI_C5', row('key_vault', 'BSI_C5_C2, CRY-3') + row('object_storage', 'CRY-3')));
    const result = buildCommunityFrameworksProbe(tmpRoot, { capabilityTags: TAGS });
    expect(result.status).toBe('warn');
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(['BSI_C5: service-controls.yaml references control ids not in controls.yaml: CRY-3']);
    expect(result.frameworks[0]!.service_mapping.status).toBe('ok');
  });

  it('keeps the framework summaries when the LZ capability-tag scan fails', () => {
    writeCommunityFolder(catalogs(), 'gdpr', { id: 'GDPR', contributor: 'Test' });
    writeMapping('gdpr', mapping('GDPR', row('key_vault', 'GDPR_C1')));
    const result = buildCommunityFrameworksProbe(tmpRoot, {
      collectCapabilityTags: () => { throw new Error('catalogue unreadable'); },
    });
    expect(result.errors).toEqual([]);
    expect(result.frameworks).toHaveLength(1);
    expect(result.frameworks[0]!.service_mapping).toEqual({ status: 'ok', mapped: 0, in_use: 0, unused_mappings: ['key_vault'] });
    expect(result.warnings.filter((w) => w.includes('capability tags could not be read'))).toHaveLength(1);
  });

  it('warns for an invalid file and for a mapped tag that no LZ catalogue uses', () => {
    writeCommunityFolder(catalogs(), 'bsi-c5', { id: 'BSI_C5', contributor: 'Test' });
    writeMapping('bsi-c5', mapping('GDPR', row('key_vault', 'CRY-03')));
    writeCommunityFolder(catalogs(), 'gdpr', { id: 'GDPR', contributor: 'Test' });
    writeMapping('gdpr', mapping('GDPR', row('key_vault', 'GDPR_C1') + row('mainframe', 'GDPR_C1')));
    const result = buildCommunityFrameworksProbe(tmpRoot, { capabilityTags: TAGS });
    const byId = new Map(result.frameworks.map((f) => [f.id, f.service_mapping]));
    expect(byId.get('BSI_C5')?.status).toBe('invalid');
    expect(byId.get('GDPR')).toEqual({ status: 'ok', mapped: 1, in_use: 3, unused_mappings: ['mainframe'] });
    expect(result.status).toBe('warn');
    expect(result.warnings.some((w) => w.startsWith('BSI_C5: service-controls.yaml is invalid'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('GDPR: service-controls.yaml maps capability tags no resolved LZ catalogue uses: mainframe'))).toBe(true);
  });

  it('defaults the capability tags to the LZ catalogues the workspace resolves', () => {
    writeCommunityFolder(catalogs(), 'gdpr', { id: 'GDPR', contributor: 'Test' });
    writeMapping('gdpr', mapping('GDPR', row('key_vault', 'GDPR_C1')));
    const result = buildCommunityFrameworksProbe(tmpRoot);
    const sm = result.frameworks[0]!.service_mapping;
    expect(sm.status).toBe('ok');
    expect(sm.mapped).toBe(1);
    expect(sm.in_use).toBeGreaterThan(10); // bundled catalogues carry the full tag vocabulary
  });
});

// ---------------------------------------------------------------------------
// #3869 (Design 123 section 7.4): policy-baseline.yaml validation.
// ---------------------------------------------------------------------------

describe('buildCommunityFrameworksProbe -- #3869 policy baseline', () => {
  const SHIPPED_DIR = join(__dirname, '..', '..', '..', 'community-frameworks', 'frameworks', 'client-lz-policy-baseline');
  const catalogs = (): string => join(tmpRoot, 'wsp', 'inputs', 'catalogs');
  const copyDir = (folder = 'client-lz-policy-baseline'): string => join(catalogs(), 'community', folder);
  const install = (folder = 'client-lz-policy-baseline'): string => {
    const dir = copyDir(folder);
    mkdirSync(dirname(dir), { recursive: true });
    cpSync(SHIPPED_DIR, dir, { recursive: true });
    return dir;
  };
  // Every tag the shipped service-controls.yaml maps plus the rest of the CPB-SVC-02 allow-list,
  // so neither the service-mapping nor the baseline unused-tag warning fires in the clean cases.
  const ALL_TAGS = [
    ...(load(readFileSync(join(SHIPPED_DIR, 'service-controls.yaml'), 'utf-8')) as { mappings: { capability: string }[] }).mappings.map((m) => m.capability),
    'ci_cd', 'container_orchestration', 'container_registry', 'dns', 'iac', 'metrics', 'vpn',
  ];
  const editBaseline = (dir: string, edit: (s: string) => string): void => {
    const file = join(dir, 'policy-baseline.yaml');
    writeFileSync(file, edit(readFileSync(file, 'utf-8')));
  };

  it('accepts the shipped baseline copy: ok, counts, no warning', () => {
    install();
    const result = buildCommunityFrameworksProbe(tmpRoot, { capabilityTags: ALL_TAGS });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.status).toBe('ok');
    expect(result.frameworks[0]!.policy_baseline).toEqual({
      status: 'ok', policies: 20, enabled: 17, disabled: 3, not_set: [], catalogue_version: '1.0.0',
      shipped_version: '1.0.0', stale: false, missing_shipped_ids: [], unused_tags: [],
    });
  });

  it('leaves a framework without policy-baseline.yaml unchanged (absent, no warning)', () => {
    writeCommunityFolder(catalogs(), 'gdpr', { id: 'GDPR', contributor: 'Test' });
    const result = buildCommunityFrameworksProbe(tmpRoot, { capabilityTags: ALL_TAGS });
    expect(result.frameworks[0]!.policy_baseline.status).toBe('absent');
    expect(result.status).toBe('ok');
    expect(result.warnings).toEqual([]);
  });

  it('fails the framework on a schema error', () => {
    const dir = install();
    editBaseline(dir, (s) => s.replace('min_days: 180', 'min_days: "180"'));
    const result = buildCommunityFrameworksProbe(tmpRoot, { capabilityTags: ALL_TAGS });
    expect(result.status).toBe('fail');
    expect(result.frameworks[0]!.policy_baseline.status).toBe('invalid');
    expect(result.errors.join()).toContain('CLIENT_LZ_POLICY_BASELINE: policy-baseline.yaml is invalid (policies.14.params.min_days');
  });

  it('fails a copy that uses the CPB- prefix for a policy SWAO does not ship (shipped id set passed)', () => {
    const dir = install();
    // the control CPB-SVC-03 still exists, so the only error is the reservation
    editBaseline(dir, (s) => s.replace('  - id: CPB-SVC-03\n', '  - id: CPB-SVC-09\n'));
    const result = buildCommunityFrameworksProbe(tmpRoot, { capabilityTags: ALL_TAGS });
    expect(result.status).toBe('fail');
    expect(result.errors.join()).toContain('"CPB-SVC-09" uses the CPB- prefix reserved for shipped policies');
  });

  it('warns for not_set policies and lists them', () => {
    const dir = install();
    editBaseline(dir, (s) => s
      .replace(/(id: CPB-COST-01[\s\S]*?state: )enabled/, '$1not_set')
      .replace(/(id: CPB-PRT-01[\s\S]*?state: )enabled/, '$1not_set'));
    const result = buildCommunityFrameworksProbe(tmpRoot, { capabilityTags: ALL_TAGS });
    expect(result.status).toBe('warn');
    expect(result.frameworks[0]!.policy_baseline.not_set).toEqual(['CPB-COST-01', 'CPB-PRT-01']);
    expect(result.warnings).toEqual([
      'CLIENT_LZ_POLICY_BASELINE: policy-baseline.yaml has 2 policies not reviewed (state not_set, not evaluated until reviewed): CPB-COST-01, CPB-PRT-01',
    ]);
  });

  it('warns for a stale copy and lists the shipped policies it misses', () => {
    install();
    // A newer shipped baseline: 1.1.0 with one more policy.
    const bundled = join(tmpRoot, 'bundled');
    const shipped = join(bundled, 'client-lz-policy-baseline');
    cpSync(SHIPPED_DIR, shipped, { recursive: true });
    editBaseline(shipped, (s) => s
      .replace('catalogue_version: "1.0.0"', 'catalogue_version: "1.1.0"')
      .replace('policies:\n', 'policies:\n  - id: CPB-LOG-03\n    kind: audit_trail\n    category: logging\n    control: CPB-LOG-01\n    state: enabled\n    params:\n      all_regions: true\n    default_source: assumption\n'));
    const result = buildCommunityFrameworksProbe(tmpRoot, { capabilityTags: ALL_TAGS, bundledFrameworksDir: bundled });
    expect(result.status).toBe('warn');
    const pb = result.frameworks[0]!.policy_baseline;
    expect(pb).toMatchObject({ stale: true, catalogue_version: '1.0.0', shipped_version: '1.1.0', missing_shipped_ids: ['CPB-LOG-03'] });
    expect(result.warnings.join()).toContain(
      'policy-baseline.yaml is stale (catalogue_version 1.0.0 is lower than the shipped 1.1.0); shipped policies missing from the copy: CPB-LOG-03',
    );
    // #4126: the hint names no removed command; SWAO never updates the copy (D-07).
    expect(result.warnings.join()).toContain('SWAO never updates the copy');
    expect(result.warnings.join()).not.toMatch(/swao framework baseline/);
  });

  it('warns for capability tags no resolved LZ catalogue uses', () => {
    install();
    const result = buildCommunityFrameworksProbe(tmpRoot, { capabilityTags: ['postgresql'] });
    expect(result.frameworks[0]!.policy_baseline.unused_tags).toContain('managed_llm');
    expect(result.frameworks[0]!.policy_baseline.unused_tags).not.toContain('postgresql');
    expect(result.warnings.join()).toContain('policy-baseline.yaml names capability tags no resolved LZ catalogue uses: ');
    expect(result.status).toBe('warn');
  });

  it('finds the shipped baseline through baseline_of for a renamed second copy', () => {
    const dir = install('my-high-baseline');
    for (const f of ['framework-meta.yaml', 'controls.yaml', 'policy-baseline.yaml', 'service-controls.yaml']) {
      const file = join(dir, f);
      writeFileSync(file, readFileSync(file, 'utf-8').replace(/^(\s*(?:id|framework)): CLIENT_LZ_POLICY_BASELINE$/gm, '$1: CLIENT_LZ_POLICY_BASELINE_HIGH'));
    }
    const result = buildCommunityFrameworksProbe(tmpRoot, { capabilityTags: ALL_TAGS });
    expect(result.errors).toEqual([]);
    const pb = result.frameworks.find((f) => f.id === 'CLIENT_LZ_POLICY_BASELINE_HIGH')!.policy_baseline;
    expect(pb).toMatchObject({ status: 'ok', shipped_version: '1.0.0', stale: false });
  });
});

// #4410: on a busy machine the probe took 40 s (1.3 s before) and a slower run
// passed the 120 s idle watchdog of the Setup Wizard. The probe now has a time
// budget and parses each catalogue once.
describe('#4410 community frameworks probe: time budget and single parse', () => {
  it('past its budget the probe stops validating, warns with the count and still returns', () => {
    const catalogsDir = join(tmpRoot, 'catalogs');
    writeRegime(catalogsDir, 'community', 'GDPR', 'gdpr-controls.yaml', 2);
    writeRegime(catalogsDir, 'community', 'ACME-INTERNAL', 'acme-internal-controls.yaml', 1);
    let clock = 0;
    // Every clock read advances 10 s; the budget is 15 s.
    const result = buildCommunityFrameworksProbe(tmpRoot, { capabilityTags: [], budgetMs: 15_000, now: () => (clock += 10_000) });
    expect(result.status).toBe('warn');
    expect(result.warnings.some((w) => /^stopped after 15 s: 1 of 2 frameworks validated/.test(w))).toBe(true);
    expect(result.frameworks).toHaveLength(1);
  });

  it('within its budget every framework is validated', () => {
    const catalogsDir = join(tmpRoot, 'catalogs');
    writeRegime(catalogsDir, 'community', 'GDPR', 'gdpr-controls.yaml', 2);
    writeRegime(catalogsDir, 'community', 'ACME-INTERNAL', 'acme-internal-controls.yaml', 1);
    const result = buildCommunityFrameworksProbe(tmpRoot, { capabilityTags: [] });
    expect(result.status).toBe('ok');
    expect(result.frameworks).toHaveLength(2);
  });
});

// #4452: a regime of the bundled catalogue (SWAO_APM, written by the service
// scaffold) counts as loaded; a regime found nowhere is one warning with its
// app count, without a spaced double hyphen.
describe('buildCommunityFrameworksProbe: declared regimes resolve through the bundled catalogue (#4452)', () => {
  function app(id: string, regimes: string[]): void {
    const dir = join(tmpRoot, 'apps', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.swao.yml'), `assessment:\n  type: service\n  regimes_active:\n${regimes.map((r) => `    - ${r}\n`).join('')}`);
  }

  it('SWAO_APM in a service app gives no warning', () => {
    writeCommunityFolder(join(tmpRoot, 'wsp', 'inputs', 'catalogs'), 'gdpr', { id: 'GDPR', contributor: { name: 'Test' }, controls: 1 });
    app('svc-a', ['SWAO_APM']);
    app('svc-b', ['SWAO_APM']);
    const result = buildCommunityFrameworksProbe(tmpRoot);
    expect(result.warnings.filter((w) => w.includes('SWAO_APM'))).toHaveLength(0);
    expect(result.status).toBe('ok');
  });

  it('an unknown id is one warning naming the app count, without a spaced double hyphen', () => {
    writeCommunityFolder(join(tmpRoot, 'wsp', 'inputs', 'catalogs'), 'gdpr', { id: 'GDPR', contributor: { name: 'Test' }, controls: 1 });
    for (const id of ['app-1', 'app-2', 'app-3', 'app-4']) app(id, ['NOT_A_REGIME', 'SWAO_APM']);
    const result = buildCommunityFrameworksProbe(tmpRoot);
    const regimeWarnings = result.warnings.filter((w) => w.includes('regime "'));
    expect(regimeWarnings).toEqual([
      'regime "NOT_A_REGIME" declared in .swao.yml of 4 apps (apps/app-1, apps/app-2, apps/app-3 and 1 more) is not found in the workspace or the bundled catalogue; the catalogue may not be set up yet',
    ]);
    expect(regimeWarnings[0]).not.toContain(' -- ');
    expect(result.status).toBe('warn');
  });
});
