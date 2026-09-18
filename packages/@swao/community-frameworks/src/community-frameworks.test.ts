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

// community-frameworks test suite (#1332 Part A)
//
// A1: controls.yaml structural validation (required fields present)
// A2: framework-meta.yaml structural validation
// A3: _registry.yaml self-consistency
// A4: Control ID uniqueness within each framework
// A5: Demo framework structural invariants
// A6: loadBundledRegimeRegistry integration round-trip

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { loadBundledRegimeRegistry } from '@swao/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORKS_DIR = join(__dirname, '..', 'frameworks');

const frameworkDirs = readdirSync(FRAMEWORKS_DIR)
  .filter(d => !d.startsWith('_') && !d.startsWith('.'))
  .sort();

// ---------------------------------------------------------------------------
// A1 -- controls.yaml structural validation
// ---------------------------------------------------------------------------

describe('A1 -- controls.yaml: required fields present', () => {
  for (const dir of frameworkDirs) {
    it(`community-framework/${dir}/controls.yaml`, () => {
      const file = join(FRAMEWORKS_DIR, dir, 'controls.yaml');
      expect(existsSync(file), `controls.yaml missing in ${dir}`).toBe(true);

      const raw = load(readFileSync(file, 'utf-8')) as Record<string, unknown>;
      expect(raw, `controls.yaml parsed as null in ${dir}`).not.toBeNull();
      expect(typeof raw, `controls.yaml root is not an object in ${dir}`).toBe('object');

      // regime_meta required top-level fields
      const meta = raw['regime_meta'] as Record<string, unknown> | undefined;
      expect(meta, `regime_meta missing in ${dir}/controls.yaml`).toBeDefined();
      expect(typeof meta!['id'], `regime_meta.id missing in ${dir}`).toBe('string');
      expect((meta!['id'] as string).length, `regime_meta.id empty in ${dir}`).toBeGreaterThan(0);
      expect(typeof meta!['name'], `regime_meta.name missing in ${dir}`).toBe('string');
      expect(typeof meta!['version'], `regime_meta.version missing in ${dir}`).toBe('string');

      // controls array
      const controls = raw['controls'] as unknown[] | undefined;
      expect(Array.isArray(controls), `controls is not an array in ${dir}`).toBe(true);
      expect(controls!.length, `controls array is empty in ${dir}`).toBeGreaterThan(0);

      // each control has id and title
      for (const ctrl of controls!) {
        const c = ctrl as Record<string, unknown>;
        expect(typeof c['id'], `a control in ${dir} is missing id`).toBe('string');
        expect(typeof c['title'], `control ${c['id'] as string} in ${dir} is missing title`).toBe('string');
      }
    });
  }
});

// ---------------------------------------------------------------------------
// A2 -- framework-meta.yaml structural validation
// ---------------------------------------------------------------------------

describe('A2 -- framework-meta.yaml: required fields present', () => {
  for (const dir of frameworkDirs) {
    it(`community-framework/${dir}/framework-meta.yaml`, () => {
      const file = join(FRAMEWORKS_DIR, dir, 'framework-meta.yaml');
      expect(existsSync(file), `framework-meta.yaml missing in ${dir}`).toBe(true);

      const raw = load(readFileSync(file, 'utf-8')) as Record<string, unknown>;
      expect(raw, `framework-meta.yaml parsed as null in ${dir}`).not.toBeNull();

      const fw = raw['framework'] as Record<string, unknown> | undefined;
      expect(fw, `framework block missing in ${dir}/framework-meta.yaml`).toBeDefined();
      expect(typeof fw!['id'], `framework.id missing in ${dir}`).toBe('string');

      // contributor must be present (per community-framework-contributor memory)
      expect(fw!['contributor'], `framework.contributor missing in ${dir}`).toBeDefined();

      // applicability_hints must be a non-empty array
      const hints = fw!['applicability_hints'] as unknown[] | undefined;
      expect(Array.isArray(hints), `applicability_hints not an array in ${dir}`).toBe(true);
      expect(hints!.length, `applicability_hints empty in ${dir}`).toBeGreaterThan(0);

      // framework.id must match regime_meta.id in controls.yaml
      const controlsFile = join(FRAMEWORKS_DIR, dir, 'controls.yaml');
      if (existsSync(controlsFile)) {
        const ctrl = load(readFileSync(controlsFile, 'utf-8')) as Record<string, unknown>;
        const meta = ctrl['regime_meta'] as Record<string, unknown> | undefined;
        expect(fw!['id'], `framework.id in ${dir}/framework-meta.yaml does not match regime_meta.id`).toBe(meta?.['id']);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// A3 -- _registry.yaml self-consistency
// ---------------------------------------------------------------------------

describe('A3 -- _registry.yaml self-consistency', () => {
  const registryFile = join(FRAMEWORKS_DIR, '_registry.yaml');
  const registry = load(readFileSync(registryFile, 'utf-8')) as {
    version: number;
    frameworks: Array<{ id: string; folder: string }>;
  };

  it('_registry.yaml parses without error', () => {
    expect(registry).toBeDefined();
    expect(Array.isArray(registry.frameworks)).toBe(true);
    expect(registry.frameworks.length).toBeGreaterThan(0);
  });

  it('every registry entry has framework.folder + controls.yaml on disk', () => {
    for (const entry of registry.frameworks) {
      const folderPath = join(FRAMEWORKS_DIR, entry.folder);
      expect(existsSync(folderPath), `registry folder missing: ${entry.folder}`).toBe(true);
      expect(existsSync(join(folderPath, 'controls.yaml')), `controls.yaml missing for registry entry ${entry.id}`).toBe(true);
      expect(existsSync(join(folderPath, 'framework-meta.yaml')), `framework-meta.yaml missing for registry entry ${entry.id}`).toBe(true);
    }
  });

  it('every registry entry.id matches regime_meta.id in the folder\'s controls.yaml', () => {
    for (const entry of registry.frameworks) {
      const controlsFile = join(FRAMEWORKS_DIR, entry.folder, 'controls.yaml');
      if (!existsSync(controlsFile)) continue;
      const raw = load(readFileSync(controlsFile, 'utf-8')) as Record<string, unknown>;
      const meta = raw['regime_meta'] as Record<string, unknown> | undefined;
      expect(meta?.['id'], `registry id ${entry.id} does not match regime_meta.id in ${entry.folder}`).toBe(entry.id);
    }
  });

  it('no duplicate id entries in registry', () => {
    const ids = registry.frameworks.map(e => e.id);
    const unique = new Set(ids);
    expect(unique.size, `duplicate ids in _registry.yaml: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`).toBe(ids.length);
  });

  it('every registry entry folder exists on disk (no phantom registry entries)', () => {
    // Orphaned dirs (dirs on disk not in registry) are allowed: e.g. cobit-5
    // was intentionally removed from the registry in sprint-107 (D-02) but the
    // directory was retained. The reverse -- a registry entry with no dir -- is
    // an error that would cause `swao framework install` to fail at runtime.
    const registryFolders = registry.frameworks.map(e => e.folder);
    const missing = registryFolders.filter(f => !existsSync(join(FRAMEWORKS_DIR, f)));
    expect(missing, `registry entries with no dir on disk: ${missing.join(', ')}`).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// A4 -- Control ID uniqueness within each framework
// ---------------------------------------------------------------------------

describe('A4 -- control ID uniqueness within each framework', () => {
  for (const dir of frameworkDirs) {
    it(`community-framework/${dir}: no duplicate control.id values`, () => {
      const file = join(FRAMEWORKS_DIR, dir, 'controls.yaml');
      if (!existsSync(file)) return;
      const raw = load(readFileSync(file, 'utf-8')) as Record<string, unknown>;
      const controls = (raw['controls'] as Array<Record<string, unknown>>) ?? [];
      const ids = controls.map(c => c['id'] as string);
      const unique = new Set(ids);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect(unique.size, `duplicate control IDs in ${dir}: ${dupes.join(', ')}`).toBe(ids.length);
    });
  }
});

// ---------------------------------------------------------------------------
// A5 -- Demo frameworks: shape + count invariants
//
// Demo frameworks use their own control IDs (e.g. GDPR_DEMO.ART5_1_A rather
// than GDPR.ART5_1_A) -- they are NOT ID-level subsets of the full framework.
// The "structurally identical" claim (memory: demo-frameworks-design-intent)
// means they share the same YAML shape and field requirements, which A1/A2
// already validate. This test adds the count invariant: if a corresponding
// full framework exists on disk, the demo must have fewer controls.
// ---------------------------------------------------------------------------

describe('A5 -- demo framework structural invariants', () => {
  const demoDirs = frameworkDirs.filter(d => d.endsWith('-demo'));

  it('at least one demo framework present', () => {
    expect(demoDirs.length).toBeGreaterThan(0);
  });

  for (const demoDir of demoDirs) {
    it(`${demoDir} has fewer controls than its full counterpart (if present)`, () => {
      const fullDir = demoDir.replace(/-demo$/, '');
      const fullPath = join(FRAMEWORKS_DIR, fullDir, 'controls.yaml');

      if (!existsSync(fullPath)) return; // no full counterpart (e.g. nist-hipaa-demo)

      const demoFile = join(FRAMEWORKS_DIR, demoDir, 'controls.yaml');
      if (!existsSync(demoFile)) return;

      const fullRaw = load(readFileSync(fullPath, 'utf-8')) as Record<string, unknown>;
      const demoRaw = load(readFileSync(demoFile, 'utf-8')) as Record<string, unknown>;

      const fullCount = ((fullRaw['controls'] as unknown[]) ?? []).length;
      const demoCount = ((demoRaw['controls'] as unknown[]) ?? []).length;

      expect(demoCount, `${demoDir} has more controls (${demoCount}) than full ${fullDir} (${fullCount})`).toBeLessThanOrEqual(fullCount);
    });

    it(`${demoDir} regime_meta.id ends with _DEMO`, () => {
      const file = join(FRAMEWORKS_DIR, demoDir, 'controls.yaml');
      if (!existsSync(file)) return;
      const raw = load(readFileSync(file, 'utf-8')) as Record<string, unknown>;
      const meta = raw['regime_meta'] as Record<string, unknown> | undefined;
      const id = meta?.['id'] as string | undefined;
      expect(id, `${demoDir} regime_meta.id should end with _DEMO`).toMatch(/_DEMO$/);
    });
  }
});

// ---------------------------------------------------------------------------
// A6 -- loadBundledRegimeRegistry integration round-trip
// ---------------------------------------------------------------------------

describe('A6 -- loadBundledRegimeRegistry integration round-trip', () => {
  const registry = loadBundledRegimeRegistry(FRAMEWORKS_DIR);

  it('returns a non-empty byId map', () => {
    expect(registry.byId.size).toBeGreaterThan(0);
  });

  it('has zero collisions on canonical IDs', () => {
    expect(registry.collisions).toHaveLength(0);
  });

  it('all registry.yaml ids are present in the loaded byId map', () => {
    const yamlRegistry = load(readFileSync(join(FRAMEWORKS_DIR, '_registry.yaml'), 'utf-8')) as {
      frameworks: Array<{ id: string }>;
    };
    for (const entry of yamlRegistry.frameworks) {
      expect(
        registry.byId.has(entry.id),
        `loadBundledRegimeRegistry: id ${entry.id} from _registry.yaml not found in byId map`,
      ).toBe(true);
    }
  });

  it('canonical ID count is at least the registry framework count', () => {
    // loadBundledRegimeRegistry scans ALL dirs including intentional orphans
    // (cobit-5 removed D-02, nist-hipaa-demo unreleased). byId may therefore
    // contain more entries than _registry.yaml. The invariant is >=, not ===.
    const yamlRegistry = load(readFileSync(join(FRAMEWORKS_DIR, '_registry.yaml'), 'utf-8')) as {
      frameworks: Array<{ id: string }>;
    };
    let canonicalCount = 0;
    for (const [id, resolved] of registry.byId) {
      if (resolved.entry.id === id) canonicalCount++;
    }
    expect(canonicalCount).toBeGreaterThanOrEqual(yamlRegistry.frameworks.length);
  });
});
