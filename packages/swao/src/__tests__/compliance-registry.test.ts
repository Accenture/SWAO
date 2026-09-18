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

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadRegimeRegistry,
  validateRegimeIdAgainstRegistry,
} from '../compliance/registry.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'swao-registry-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeFixture(
  catalogsDir: string,
  scope: 'community',
  regimes: Array<{ id: string; file: string; count: number; replaces?: string[] }>,
) {
  const scopeDir = join(catalogsDir, scope);
  mkdirSync(scopeDir, { recursive: true });
  const indexEntries = regimes
    .map(
      (r) => `  - id: ${r.id}
    name: "${r.id} catalogue"
    version: "1.0"
    file: ${r.file}
    controls_count: ${r.count}`,
    )
    .join('\n');
  writeFileSync(
    join(scopeDir, 'index.yaml'),
    `schema_version: "1"
scope: ${scope}
regimes:
${indexEntries}
`,
  );
  for (const r of regimes) {
    const replacesBlock = r.replaces && r.replaces.length > 0
      ? `  replaces:\n${r.replaces.map((id) => `    - ${id}`).join('\n')}\n`
      : '';
    writeFileSync(
      join(scopeDir, r.file),
      `regime_meta:
  id: ${r.id}
  name: "${r.id} catalogue"
  version: "1.0"
  scope: ${scope}
  authority: "Test"
  description: "Test catalogue for ${r.id} used in unit tests."
  catalogue_version: "1.0.0"
${replacesBlock}controls:
  - id: ${r.id}_C1
    title: "Control 1"
    description: "First test control for ${r.id}."
    evidence_basis:
      - signal_prefix: TF
`,
    );
  }
}

describe('loadRegimeRegistry', () => {
  it('loads an empty registry when no indexes exist', () => {
    const registry = loadRegimeRegistry(tmpRoot);
    expect(registry.byId.size).toBe(0);
    expect(registry.collisions).toEqual([]);
  });

  it('loads standard regimes from a populated standard index', () => {
    const catalogsDir = join(tmpRoot, 'catalogs');
    writeFixture(catalogsDir, 'community', [
      { id: 'GDPR', file: 'gdpr-controls.yaml', count: 1 },
      { id: 'DORA', file: 'dora-controls.yaml', count: 1 },
    ]);
    const registry = loadRegimeRegistry(catalogsDir);
    expect(registry.byId.size).toBe(2);
    expect(registry.byId.has('GDPR')).toBe(true);
    expect(registry.byId.has('DORA')).toBe(true);
  });

  it('community with replaces: aliases the replaced id and records the collision (design 029 §11)', () => {
    // Reframed from it.skip (#0367): replaces: now works between community frameworks.
    // GDPR-ENHANCED declares replaces: [GDPR]; after both load, byId holds two entries
    // (canonical GDPR + canonical GDPR-ENHANCED). The alias registration overwrites the
    // GDPR slot with the GDPR-ENHANCED entry and records GDPR in collisions.
    const catalogsDir = join(tmpRoot, 'catalogs');
    writeFixture(catalogsDir, 'community', [
      { id: 'GDPR', file: 'gdpr-controls.yaml', count: 1 },
      { id: 'GDPR-ENHANCED', file: 'gdpr-enhanced-controls.yaml', count: 1, replaces: ['GDPR'] },
    ]);
    const registry = loadRegimeRegistry(catalogsDir);
    expect(registry.byId.size).toBe(2); // GDPR (alias) + GDPR-ENHANCED (canonical)
    expect(registry.byId.get('GDPR')?.scope).toBe('community');
    expect(registry.collisions).toEqual(['GDPR']);
  });

  // Deleted: 'community without replaces: throws on collision with standard'
  // Reason: no standard scope exists post-retirement; the throw message referenced
  // "standard" which is no longer a concept. Duplicate same-id community entries
  // are covered by the 'throws on duplicate regime id within the same scope' test.

  it('community additive (no collision) registers two frameworks side by side', () => {
    // Reframed from it.skip (#0367): two community frameworks with distinct ids
    // register without collision; no standard scope involved.
    const catalogsDir = join(tmpRoot, 'catalogs');
    writeFixture(catalogsDir, 'community', [
      { id: 'GDPR', file: 'gdpr-controls.yaml', count: 1 },
      { id: 'AI-10-PILLARS', file: 'ai-10-pillars.yaml', count: 1 },
    ]);
    const registry = loadRegimeRegistry(catalogsDir);
    expect(registry.byId.size).toBe(2);
    expect(registry.byId.get('GDPR')?.scope).toBe('community');
    expect(registry.byId.get('AI-10-PILLARS')?.scope).toBe('community');
    expect(registry.collisions).toEqual([]);
  });

  it('throws on duplicate regime id within the same scope', () => {
    const catalogsDir = join(tmpRoot, 'catalogs');
    const dir = join(catalogsDir, 'community');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'index.yaml'),
      `schema_version: "1"
scope: community
regimes:
  - id: GDPR
    name: "GDPR"
    version: "1.0"
    file: gdpr-1.yaml
    controls_count: 1
  - id: GDPR
    name: "GDPR duplicate"
    version: "1.1"
    file: gdpr-2.yaml
    controls_count: 1
`,
    );
    expect(() => loadRegimeRegistry(catalogsDir)).toThrow(/duplicate (canonical regime id|regime id) "GDPR"/);
  });
});

describe('validateRegimeIdAgainstRegistry', () => {
  it('accepts a registered regime id', () => {
    const catalogsDir = join(tmpRoot, 'catalogs');
    writeFixture(catalogsDir, 'community', [{ id: 'GDPR', file: 'gdpr-controls.yaml', count: 1 }]);
    const registry = loadRegimeRegistry(catalogsDir);
    const result = validateRegimeIdAgainstRegistry('GDPR', registry);
    expect(result.valid).toBe(true);
  });

  it('accepts the DiGA legacy alias regardless of registry contents', () => {
    const registry = loadRegimeRegistry(tmpRoot);
    const result = validateRegimeIdAgainstRegistry('DiGA', registry);
    expect(result.valid).toBe(true);
  });

  it('rejects a regime id that fails the regex', () => {
    const registry = loadRegimeRegistry(tmpRoot);
    const result = validateRegimeIdAgainstRegistry('gdpr', registry);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/does not match/);
    }
  });

  it('rejects a regex-valid but unregistered id', () => {
    const catalogsDir = join(tmpRoot, 'catalogs');
    writeFixture(catalogsDir, 'community', [{ id: 'GDPR', file: 'gdpr-controls.yaml', count: 1 }]);
    const registry = loadRegimeRegistry(catalogsDir);
    const result = validateRegimeIdAgainstRegistry('TISAX', registry);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/not registered/);
    }
  });

  it('error reason lists the registered regimes for the operator', () => {
    const catalogsDir = join(tmpRoot, 'catalogs');
    writeFixture(catalogsDir, 'community', [
      { id: 'GDPR', file: 'gdpr-controls.yaml', count: 1 },
      { id: 'DORA', file: 'dora-controls.yaml', count: 1 },
    ]);
    const registry = loadRegimeRegistry(catalogsDir);
    const result = validateRegimeIdAgainstRegistry('UNKNOWN', registry);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/DORA/);
      expect(result.reason).toMatch(/GDPR/);
    }
  });
});

describe('ComplianceRegimeSchema integration with new id schema', { timeout: 30_000 }, () => {
  it('the existing DiGA fixture id continues to validate via the union back-compat', async () => {
    const { PlanSchema } = await import('../schema/wsp-plan.js');
    const minimalPlan = {
      migration_plan: { runbook: [] },
      risk_register: [],
      value_case: [],
      compliance: {
        regimes: [{ id: 'DiGA', status: 'unknown', controls: [] }],
      },
      security_findings: [],
      assumptions: [],
      data_gaps: [],
    };
    expect(PlanSchema.safeParse(minimalPlan).success).toBe(true);
  });

  it('the new flagship IDs (PCI_DSS, ISO_27001, SOC_2) all validate', async () => {
    const { PlanSchema } = await import('../schema/wsp-plan.js');
    const make = (id: string) => ({
      migration_plan: { runbook: [] },
      risk_register: [],
      value_case: [],
      compliance: { regimes: [{ id, status: 'unknown', controls: [] }] },
      security_findings: [],
      assumptions: [],
      data_gaps: [],
    });
    for (const id of ['PCI_DSS', 'ISO_27001', 'SOC_2', 'GDPR', 'DORA', 'BSI_C5', 'HIPAA']) {
      expect(PlanSchema.safeParse(make(id)).success, `failed for ${id}`).toBe(true);
    }
  });

  it('rejects a lowercase regime id', async () => {
    const { PlanSchema } = await import('../schema/wsp-plan.js');
    const plan = {
      migration_plan: { runbook: [] },
      risk_register: [],
      value_case: [],
      compliance: { regimes: [{ id: 'gdpr', status: 'unknown', controls: [] }] },
      security_findings: [],
      assumptions: [],
      data_gaps: [],
    };
    expect(PlanSchema.safeParse(plan).success).toBe(false);
  });
});
