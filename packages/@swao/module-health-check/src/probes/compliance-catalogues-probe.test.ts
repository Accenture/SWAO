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

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
      contributor: { name: 'Helmut Schindlwick', email: 'https://github.com/Accenture/SWAO/discussions' },
      controls: 53,
    });
    const result = buildCommunityFrameworksProbe(tmpRoot);
    expect(result.community_count).toBe(1);
    expect(result.frameworks).toHaveLength(1);
    const gdpr = result.frameworks[0]!;
    expect(gdpr.id).toBe('GDPR');
    expect(gdpr.scope).toBe('community');
    expect(gdpr.contributor).toBe('Helmut Schindlwick');
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
