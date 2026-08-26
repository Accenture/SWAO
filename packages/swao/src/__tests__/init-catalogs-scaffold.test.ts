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

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { load } from 'js-yaml';
import {
  scaffoldCatalogs,
  scaffoldImports,
  ensureGitignore,
} from '../commands/init.js';
import { RegimeIndexSchema } from '../schema/regime-catalogue.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-init-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// sprint-039 #0358 Phase 3 -- standard scope retired; reframed for
// community-only scaffold (#0367).
describe('scaffoldCatalogs (#0161; sprint-037 #0341 overlay->community)', () => {
  it('creates wsp/inputs/catalogs/community/ directory', () => {
    const result = scaffoldCatalogs(tmp);
    expect(existsSync(result.communityDir)).toBe(true);
  });

  it('copies the 4 default bundled frameworks (#0775); other frameworks install via `swao framework install`', () => {
    const result = scaffoldCatalogs(tmp);
    // Demo variants ship by default since commit 16e129ed (#0842 COBIT_5 excluded).
    expect(result.copiedFiles).toContain('community/gdpr-demo/');
    expect(result.copiedFiles).toContain('community/ai-10-pillars-demo/');
    expect(result.copiedFiles).toContain('community/nist-sp-800-66r2-demo/');
    expect(result.copiedFiles).toContain('community/bsi-grundschutz-2023-demo/');
    // sprint-116 also scaffolds lz-catalogues/ entries; filter to community-only.
    expect(result.copiedFiles.filter((f) => f.startsWith('community/'))).toHaveLength(4);
  });

  // Deleted: 'catalogs/standard/index.yaml lists exactly the seven flagship regimes'
  // Reason: standard scope retired in sprint-039; no standard/index.yaml is written.

  // Deleted: 'every copied catalogue parses against RegimeCatalogueSchema'
  // Reason: test read from catalogs/standard/ which no longer exists.

  it('catalogs/community/index.yaml is empty (zero regimes)', () => {
    scaffoldCatalogs(tmp);
    const idx = RegimeIndexSchema.parse(
      load(readFileSync(join(tmp, 'wsp/inputs/catalogs/community/index.yaml'), 'utf-8')),
    );
    expect(idx.scope).toBe('community');
    expect(idx.regimes).toEqual([]);
  });

  it('catalogs/community/README.md contains a TISAX worked example', () => {
    scaffoldCatalogs(tmp);
    const readme = readFileSync(join(tmp, 'wsp/inputs/catalogs/community/README.md'), 'utf-8');
    expect(readme).toMatch(/TISAX/);
    expect(readme).toMatch(/regime_meta:/);
    expect(readme).toMatch(/scope: community/);
    expect(readme).toMatch(/replaces:/);
  });

  it('community README.md is preserved on re-scaffolding (idempotent)', () => {
    scaffoldCatalogs(tmp);
    const customised = '# customised by consultant\n';
    writeFileSync(join(tmp, 'wsp/inputs/catalogs/community/README.md'), customised, 'utf-8');
    scaffoldCatalogs(tmp);
    expect(readFileSync(join(tmp, 'wsp/inputs/catalogs/community/README.md'), 'utf-8')).toBe(customised);
  });

  it('community index.yaml is preserved on re-scaffolding', () => {
    scaffoldCatalogs(tmp);
    const customised = `schema_version: "1"
scope: community
regimes:
  - id: TISAX
    name: "Trusted Information Security Assessment Exchange"
    version: "5.1"
    file: tisax-controls.yaml
    controls_count: 1
`;
    writeFileSync(join(tmp, 'wsp/inputs/catalogs/community/index.yaml'), customised, 'utf-8');
    scaffoldCatalogs(tmp);
    expect(readFileSync(join(tmp, 'wsp/inputs/catalogs/community/index.yaml'), 'utf-8')).toBe(customised);
  });

  // #1777: wizard writes .swao.yml before calling runWorkspaceScaffolders; the
  // old guard (existsSync('.swao.yml')) incorrectly suppressed seeding. Seeding
  // must happen even when .swao.yml exists, as long as no frameworks are installed.
  it('seeds DEMO frameworks even when .swao.yml exists in workspace root (#1777)', () => {
    writeFileSync(join(tmp, '.swao.yml'), 'engagement:\n  name: test\n', 'utf-8');
    const result = scaffoldCatalogs(tmp);
    expect(result.copiedFiles).toContain('community/gdpr-demo/');
    expect(result.copiedFiles).toContain('community/ai-10-pillars-demo/');
    expect(result.copiedFiles).toContain('community/nist-sp-800-66r2-demo/');
    expect(result.copiedFiles).toContain('community/bsi-grundschutz-2023-demo/');
  });

  // #1777: when community frameworks already exist (have framework-meta.yaml),
  // a second init call must not re-copy them (idempotency guard).
  it('skips DEMO seeding when community frameworks are already installed (#1777)', () => {
    const result1 = scaffoldCatalogs(tmp);
    expect(result1.copiedFiles.filter((f) => f.startsWith('community/'))).toHaveLength(4);
    // Second call: frameworks present -> no files copied.
    const result2 = scaffoldCatalogs(tmp);
    expect(result2.copiedFiles.filter((f) => f.startsWith('community/'))).toHaveLength(0);
  });

  // Deleted: 'the doctor compliance-catalogues probe reports warn (GDPR supersession)...'
  // Reason: asserted standard_count=6 (impossible post-retirement) and relied on
  // a GDPR replaces:[GDPR] collision between standard and community; no standard
  // scope exists any more. Probe behaviour against a fresh community-only scaffold
  // is covered by compliance-probe.test.ts.
});

// #1064: scaffoldImports no longer creates a CMDB sample file. Operators supply
// their own CMDB / ServiceNow export and wire it in context_inputs:.
describe('scaffoldImports (#1064 -- creates wsp/inputs/, no stub files)', () => {
  it('creates the wsp/inputs/ directory', () => {
    scaffoldImports(tmp);
    expect(existsSync(join(tmp, 'wsp/inputs'))).toBe(true);
  });

  it('does NOT create cmdb-sample.csv or any cmdb/ subfolder', () => {
    scaffoldImports(tmp);
    expect(existsSync(join(tmp, 'wsp/inputs/cmdb'))).toBe(false);
    expect(existsSync(join(tmp, 'wsp/inputs/cmdb/cmdb-sample.csv'))).toBe(false);
  });

  it('does NOT create README.md or any other subfolders (all created dynamically by Pass 00)', () => {
    scaffoldImports(tmp);
    expect(existsSync(join(tmp, 'wsp/inputs/README.md'))).toBe(false);
    expect(existsSync(join(tmp, 'wsp/inputs/architecture'))).toBe(false);
    expect(existsSync(join(tmp, 'wsp/inputs/finops'))).toBe(false);
    expect(existsSync(join(tmp, 'wsp/inputs/incidents'))).toBe(false);
    expect(existsSync(join(tmp, 'wsp/inputs/workshops'))).toBe(false);
    expect(existsSync(join(tmp, 'wsp/inputs/ops'))).toBe(false);
  });

  it('is idempotent: calling twice does not throw', () => {
    scaffoldImports(tmp);
    expect(() => scaffoldImports(tmp)).not.toThrow();
  });
});

// sprint-039 #0358 Phase 3 reframed for community-only scaffold (#0367).
// The gitignore baseline now emits `wsp/inputs/catalogs/community/.bundled/`
// (bundled mirror) instead of `wsp/inputs/catalogs/standard/`.
describe('ensureGitignore (#0161)', () => {
  it('writes a fresh .gitignore including community/.bundled/ when absent', () => {
    ensureGitignore(tmp);
    const gi = readFileSync(join(tmp, '.gitignore'), 'utf-8');
    expect(gi).toMatch(/^wsp\/inputs\/catalogs\/community\/\.bundled\/$/m);
    expect(gi).toMatch(/^\.swao\.secrets\.env$/m);
    expect(gi).toMatch(/^apps\/\*\/wsp\/runs\/$/m);
    expect(gi).toMatch(/^apps\/\*\/wsp\/exports\/$/m);
    expect(gi).toMatch(/^apps\/\*\/wsp\/reports-app\/$/m);
    expect(gi).toMatch(/^apps\/\*\/wsp\/reports-lz\/$/m);
    // #0968 -- binary and logs must be excluded
    expect(gi).toMatch(/^swao-enterprise-win\.exe$/m);
    expect(gi).toMatch(/^swao-community-win\.exe$/m);
    expect(gi).toMatch(/^swao\.bat$/m);
    expect(gi).toMatch(/^wsp\/logs\/$/m);
    expect(gi).toMatch(/^apps\/\*\/wsp\/logs\/$/m);
  });

  it('appends missing entries when .gitignore already exists', () => {
    writeFileSync(join(tmp, '.gitignore'), 'node_modules/\n', 'utf-8');
    ensureGitignore(tmp);
    const gi = readFileSync(join(tmp, '.gitignore'), 'utf-8');
    expect(gi).toMatch(/^node_modules\/$/m);
    expect(gi).toMatch(/^wsp\/inputs\/catalogs\/community\/\.bundled\/$/m);
    expect(gi).toMatch(/^\.swao\.secrets\.env$/m);
    // #0968 -- binary and logs must be merged into existing gitignore
    expect(gi).toMatch(/^swao-enterprise-win\.exe$/m);
    expect(gi).toMatch(/^swao-community-win\.exe$/m);
    expect(gi).toMatch(/^swao\.bat$/m);
    expect(gi).toMatch(/^wsp\/logs\/$/m);
    expect(gi).toMatch(/^apps\/\*\/wsp\/logs\/$/m);
  });

  it('does not duplicate entries on a second call', () => {
    ensureGitignore(tmp);
    const first = readFileSync(join(tmp, '.gitignore'), 'utf-8');
    ensureGitignore(tmp);
    const second = readFileSync(join(tmp, '.gitignore'), 'utf-8');
    expect(second).toBe(first);
  });

  it('preserves existing entries that are unrelated to SWAO baseline', () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(
      join(tmp, '.gitignore'),
      '# project-specific\nbuild/\n.env.local\n',
      'utf-8',
    );
    ensureGitignore(tmp);
    const gi = readFileSync(join(tmp, '.gitignore'), 'utf-8');
    expect(gi).toMatch(/^build\/$/m);
    expect(gi).toMatch(/^\.env\.local$/m);
    expect(gi).toMatch(/^wsp\/inputs\/catalogs\/community\/\.bundled\/$/m);
  });
});
