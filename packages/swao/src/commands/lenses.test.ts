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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  listLenses,
  showLens,
  readWorkspaceLenses,
  writeWorkspaceLenses,
} from './lenses.js';
import { INIT_TEMPLATE, INIT_WORKSPACE_YML } from '../__tests__/fixtures/init-workspace-yml.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the real controls/lenses dir relative to this test file.
// src/commands -> src -> packages/swao -> swao -> swao/controls/lenses
const REAL_LENSES_DIR = join(__dirname, '../../../../controls/lenses');

const TMP_DIR = join(tmpdir(), `swao-lenses-test-${ process.pid }`);

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. listLenses -- output contains 'cloud-migration'
// ---------------------------------------------------------------------------
describe('listLenses (#0455)', () => {
  it('returns at least cloud-migration from the real controls directory', () => {
    const defs = listLenses(REAL_LENSES_DIR);
    const ids = defs.map((d) => d.id);
    expect(ids).toContain('cloud-migration');
  });

  it('returns all three bundled lenses', () => {
    const defs = listLenses(REAL_LENSES_DIR);
    const ids = defs.map((d) => d.id);
    expect(ids).toContain('security-focus');
    expect(ids).toContain('data-governance');
  });

  it('returns built-in lenses even when custom directory does not exist', () => {
    const defs = listLenses(join(TMP_DIR, 'nonexistent'));
    // Built-in lenses are always returned regardless of directory (#0459 fix)
    expect(defs.length).toBeGreaterThan(0);
    expect(defs.some(d => d.id === 'cloud-migration')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. showLens -- 'cloud-migration' contains 'INV'
// ---------------------------------------------------------------------------
describe('showLens (#0455)', () => {
  it('cloud-migration contains INV in passes', () => {
    const def = showLens('cloud-migration', REAL_LENSES_DIR);
    expect(def.passes).toContain('INV');
  });

  it('security-focus has SBOM and CRYPTO passes', () => {
    const def = showLens('security-focus', REAL_LENSES_DIR);
    expect(def.passes).toContain('SBOM');
    expect(def.passes).toContain('CRYPTO');
  });

  it('security-focus has auto_frameworks KRITIS and NIS2', () => {
    const def = showLens('security-focus', REAL_LENSES_DIR);
    expect(def.auto_frameworks).toContain('KRITIS');
    expect(def.auto_frameworks).toContain('NIS2');
  });

  it('throws for unknown lens id', () => {
    expect(() => showLens('nonexistent', REAL_LENSES_DIR)).toThrow('Unknown lens: nonexistent');
  });
});

// ---------------------------------------------------------------------------
// 3. lenses add -- writes to .swao.yml correctly
// ---------------------------------------------------------------------------
describe('writeWorkspaceLenses / readWorkspaceLenses -- add (#0455)', () => {
  it('creates .swao.yml with assessment.lenses when file does not exist', () => {
    const yml = join(TMP_DIR, 'new-workspace.swao.yml');
    writeWorkspaceLenses(yml, ['cloud-migration']);
    const result = readWorkspaceLenses(yml);
    expect(result).toEqual(['cloud-migration']);
  });

  it('merging (add semantics) does not duplicate existing lenses', () => {
    const yml = join(TMP_DIR, 'merge-workspace.swao.yml');
    writeWorkspaceLenses(yml, ['cloud-migration']);
    // Simulate add by reading then merging
    const current = readWorkspaceLenses(yml);
    const merged = Array.from(new Set([...current, 'security-focus']));
    writeWorkspaceLenses(yml, merged);
    const result = readWorkspaceLenses(yml);
    expect(result).toContain('cloud-migration');
    expect(result).toContain('security-focus');
    expect(result).toHaveLength(2);
  });

  it('preserves other .swao.yml fields when writing lenses', () => {
    const yml = join(TMP_DIR, 'preserve-fields.swao.yml');
    writeFileSync(yml, 'source:\n  path: ./app\n', 'utf-8');
    writeWorkspaceLenses(yml, ['data-governance']);
    const result = readWorkspaceLenses(yml);
    expect(result).toEqual(['data-governance']);
    // Source field must survive
    const raw = readFileSync(yml, 'utf-8');
    expect(raw).toContain('path: ./app');
  });
});

// ---------------------------------------------------------------------------
// 4. lenses set -- replaces existing lenses
// ---------------------------------------------------------------------------
describe('writeWorkspaceLenses -- set (replace) (#0455)', () => {
  it('replaces all existing lenses', () => {
    const yml = join(TMP_DIR, 'set-workspace.swao.yml');
    writeWorkspaceLenses(yml, ['cloud-migration', 'security-focus']);
    // set replaces entirely
    writeWorkspaceLenses(yml, ['data-governance']);
    const result = readWorkspaceLenses(yml);
    expect(result).toEqual(['data-governance']);
    expect(result).not.toContain('cloud-migration');
    expect(result).not.toContain('security-focus');
  });
});

// ---------------------------------------------------------------------------
// 5. lenses remove -- removes one lens
// ---------------------------------------------------------------------------
describe('remove lens logic (#0455)', () => {
  it('removes a single lens, leaving others intact', () => {
    const yml = join(TMP_DIR, 'remove-workspace.swao.yml');
    writeWorkspaceLenses(yml, ['cloud-migration', 'security-focus', 'data-governance']);
    const current = readWorkspaceLenses(yml);
    const updated = current.filter((l) => l !== 'security-focus');
    writeWorkspaceLenses(yml, updated);
    const result = readWorkspaceLenses(yml);
    expect(result).not.toContain('security-focus');
    expect(result).toContain('cloud-migration');
    expect(result).toContain('data-governance');
  });

  it('returns empty array when last lens is removed', () => {
    const yml = join(TMP_DIR, 'remove-last.swao.yml');
    writeWorkspaceLenses(yml, ['cloud-migration']);
    const updated = readWorkspaceLenses(yml).filter((l) => l !== 'cloud-migration');
    writeWorkspaceLenses(yml, updated);
    const result = readWorkspaceLenses(yml);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. #4283: the lens save is a minimal patch of the commented init template
// ---------------------------------------------------------------------------
describe('writeWorkspaceLenses keeps the workspace file (#4283)', () => {
  // INIT_TEMPLATE: the swao init template fixture (__tests__/fixtures/init-workspace-yml.ts).

  it('the fixture matches the swao init template lines', () => {
    const src = readFileSync(join(__dirname, 'init.ts'), 'utf-8');
    for (const line of INIT_TEMPLATE.split('\n')) {
      if (line === '' || /"(Example|EX|Lead|2026-11-09)"|type: pattern/.test(line)) continue;
      expect(src).toContain(line);
    }
  });

  function initWorkspace(name: string): string {
    const dir = join(TMP_DIR, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.swao.yml'), INIT_WORKSPACE_YML, 'utf-8');
    return dir;
  }

  it('changes nothing but the added lenses lines', () => {
    const dir = initWorkspace('minimal-patch');
    const yml = join(dir, '.swao.yml');
    const before = readFileSync(yml, 'utf-8');
    expect(writeWorkspaceLenses(yml, ['security-focus'])).toBe(true);
    const after = readFileSync(yml, 'utf-8');
    expect(after.startsWith(before.trimEnd())).toBe(true);
    expect(after.slice(before.trimEnd().length).trim()).toBe('assessment:\n  lenses: [security-focus]');
    expect(after).toContain('  assessment_types: [application]');
    expect(after).toMatch(/^ {2}setup_state: \{ application: \{ state: /m);
    // A second save edits the lenses line in place.
    writeWorkspaceLenses(yml, ['security-focus', 'data-governance']);
    expect(readFileSync(yml, 'utf-8')).toBe(after.replace('[security-focus]', '[security-focus, data-governance]'));
    // Removing every lens restores the original text (no `lenses: []`).
    writeWorkspaceLenses(yml, []);
    expect(readFileSync(yml, 'utf-8')).toBe(before);
  });

  it('an empty selection without a lenses key writes nothing', () => {
    const dir = initWorkspace('empty-selection');
    const yml = join(dir, '.swao.yml');
    const before = readFileSync(yml, 'utf-8');
    expect(writeWorkspaceLenses(yml, [])).toBe(false);
    expect(readFileSync(yml, 'utf-8')).toBe(before);
  });
});
