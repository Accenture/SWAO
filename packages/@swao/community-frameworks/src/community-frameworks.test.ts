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
// A3: discovery from framework-meta.yaml (#3297; replaces _registry.yaml)
// A4: Control ID uniqueness within each framework
// A5: Demo framework structural invariants
// A6: loadBundledRegimeRegistry integration round-trip
// A7: cross-mapping references resolve (#3151)
// A8: meta description control counts (#3151, #3297)
// A9: standalone community-frameworks/ copy mirrors the package (#3151)

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { loadBundledRegimeRegistry, discoverFrameworks, FrameworkMetaSchema } from '@swao/core';

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
// A3 -- discovery from framework-meta.yaml (#3297)
//
// There is no _registry.yaml. `swao framework list`, the copy helper and the
// publication extractor build their list with discoverFrameworks(), which reads
// each folder's framework-meta.yaml. Every shipped folder must therefore carry a
// meta that validates, or it silently drops out of the list.
// ---------------------------------------------------------------------------

describe('A3 -- discovery from framework-meta.yaml', () => {
  const warnings: string[] = [];
  const all = discoverFrameworks(FRAMEWORKS_DIR, { includeUnlisted: true, warn: (m) => warnings.push(m) });
  const listed = discoverFrameworks(FRAMEWORKS_DIR, { warn: () => {} });

  it('no _registry.yaml is shipped', () => {
    expect(existsSync(join(FRAMEWORKS_DIR, '_registry.yaml'))).toBe(false);
  });

  it('every shipped folder is discovered (valid meta, unique id), with no warning', () => {
    expect(warnings).toEqual([]);
    expect(all.map(f => f.folder).sort()).toEqual(frameworkDirs);
  });

  it('every framework-meta.yaml validates against FrameworkMetaSchema', () => {
    for (const dir of frameworkDirs) {
      const raw = load(readFileSync(join(FRAMEWORKS_DIR, dir, 'framework-meta.yaml'), 'utf-8'));
      const r = FrameworkMetaSchema.safeParse(raw);
      expect(r.success, `${dir}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true);
    }
  });

  it('COBIT_5 is listed without any registry entry', () => {
    expect(listed.find(f => f.id === 'COBIT_5')?.folder).toBe('cobit-5');
  });

  it('only nist-hipaa-demo is unlisted (it was never in the old registry)', () => {
    const unlisted = all.filter(f => !listed.some(l => l.id === f.id)).map(f => f.folder);
    expect(unlisted).toEqual(['nist-hipaa-demo']);
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

  const discovered = discoverFrameworks(FRAMEWORKS_DIR, { includeUnlisted: true, warn: () => {} });

  it('every discovered framework id is present in the loaded byId map', () => {
    for (const entry of discovered) {
      expect(
        registry.byId.has(entry.id),
        `loadBundledRegimeRegistry: id ${entry.id} from ${entry.folder}/framework-meta.yaml not found in byId map`,
      ).toBe(true);
    }
  });

  it('canonical ID count equals the discovered framework count', () => {
    // Both scan every shipped folder (#3297), one from controls.yaml, one from
    // framework-meta.yaml; A2 pins the two ids to each other.
    let canonicalCount = 0;
    for (const [id, resolved] of registry.byId) {
      if (resolved.entry.id === id) canonicalCount++;
    }
    expect(canonicalCount).toBe(discovered.length);
  });
});

// ---------------------------------------------------------------------------
// A7 -- cross-mapping references resolve (#3151)
// ---------------------------------------------------------------------------

// References into frameworks SWAO does not bundle cannot resolve to a control
// ID; they are kept as external citations.
const EXTERNAL_REF_PREFIXES = ['NIST_CSF_', 'ISO_42001_', 'COPPA_', 'HIPAA_164.5'];

interface XrefControl {
  id: string;
  maps_to?: string[];
  cross_mapping?: Array<{ target_control?: string }>;
}

function loadControls(dir: string): XrefControl[] {
  const raw = load(readFileSync(join(FRAMEWORKS_DIR, dir, 'controls.yaml'), 'utf-8')) as {
    controls?: XrefControl[];
  };
  return raw.controls ?? [];
}

describe('A7 -- cross-mapping references resolve to bundled control IDs', () => {
  const allIds = new Set<string>();
  for (const dir of frameworkDirs) {
    for (const c of loadControls(dir)) allIds.add(c.id);
  }
  for (const dir of frameworkDirs.filter(d => !d.endsWith('-demo'))) {
    it(`${dir}: every maps_to / cross_mapping target exists or is an external citation`, () => {
      const broken: string[] = [];
      for (const c of loadControls(dir)) {
        expect(c.maps_to === null, `${dir}/${c.id}: maps_to is null (use [] or omit)`).toBe(false);
        const targets = [
          ...(c.maps_to ?? []),
          ...(c.cross_mapping ?? []).map(x => x.target_control ?? ''),
        ];
        for (const t of targets) {
          if (allIds.has(t)) continue;
          if (EXTERNAL_REF_PREFIXES.some(p => t.startsWith(p))) continue;
          broken.push(`${c.id} -> ${t}`);
        }
      }
      expect(broken, `unresolved references in ${dir}`).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// A8 -- registry descriptions state the real control count (#3151)
// ---------------------------------------------------------------------------

describe('A8 -- framework-meta.yaml description control counts match controls.yaml', () => {
  for (const f of discoverFrameworks(FRAMEWORKS_DIR, { includeUnlisted: true, warn: () => {} })) {
    it(`${f.id}: first "<N> controls" in the meta description equals the catalogue size`, () => {
      const m = /\b(\d+) controls\b/.exec(f.meta.description ?? '');
      if (!m) return;
      expect(Number(m[1])).toBe(loadControls(f.folder).length);
    });
  }
});

// ---------------------------------------------------------------------------
// A9 -- standalone download copy mirrors the package (#3151)
// ---------------------------------------------------------------------------

const STANDALONE_DIR = join(__dirname, '..', '..', '..', '..', 'community-frameworks');

function listFiles(root: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(root, r));
    else if (e.isFile()) out.push(r);
  }
  return out.sort();
}

describe.skipIf(!existsSync(STANDALONE_DIR))('A9 -- swao/community-frameworks/ mirrors the package', () => {
  const standaloneDirs = existsSync(STANDALONE_DIR)
    ? readdirSync(STANDALONE_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
    : [];
  for (const dir of standaloneDirs) {
    it(`${dir}: identical to frameworks/${dir}`, () => {
      expect(existsSync(join(FRAMEWORKS_DIR, dir)), `${dir} missing from the package`).toBe(true);
      const a = listFiles(join(STANDALONE_DIR, dir));
      expect(listFiles(join(FRAMEWORKS_DIR, dir))).toEqual(a);
      for (const f of a) {
        const sa = readFileSync(join(STANDALONE_DIR, dir, f));
        const pa = readFileSync(join(FRAMEWORKS_DIR, dir, f));
        expect(sa.equals(pa), `${dir}/${f} differs between standalone copy and package`).toBe(true);
      }
    });
  }

  it('the standalone copy has no _registry.yaml and every folder is discoverable (#3297)', () => {
    expect(existsSync(join(STANDALONE_DIR, '_registry.yaml'))).toBe(false);
    const found = discoverFrameworks(STANDALONE_DIR, { warn: () => {} }).map(f => f.folder).sort();
    expect(found).toEqual([...standaloneDirs].sort());
  });
});
