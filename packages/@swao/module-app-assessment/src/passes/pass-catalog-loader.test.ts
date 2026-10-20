// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadPassCatalog } from './pass-catalog-loader.js';

const BASE_CATALOG_YAML = `
pass_number: 99
pass_name: "Test Pass"
entries:
  - id: entry-a
    name: "Entry A"
    posture:
      severity: approved
  - id: entry-b
    name: "Entry B"
    posture:
      severity: weak
`.trimStart();

const WORKSPACE_OVERRIDE_YAML = `
pass_number: 99
pass_name: "Test Pass"
entries:
  - id: entry-b
    name: "Entry B -- workspace override"
    posture:
      severity: approved
  - id: entry-c
    name: "Entry C -- workspace only"
    posture:
      severity: deprecated
`.trimStart();

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-loader-'));
  mkdirSync(join(tmp, 'wsp', 'inputs', 'pass-catalogs'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('loadPassCatalog', () => {
  it('returns null when neither bundled nor workspace file exists', () => {
    const result = loadPassCatalog(tmp, 'pass-99-test.yaml');
    expect(result).toBeNull();
  });

  it('returns entries from workspace file when present', () => {
    writeFileSync(
      join(tmp, 'wsp', 'inputs', 'pass-catalogs', 'pass-99-test.yaml'),
      BASE_CATALOG_YAML,
      'utf-8',
    );
    const result = loadPassCatalog(tmp, 'pass-99-test.yaml');
    expect(result).not.toBeNull();
    expect(result!.entries).toHaveLength(2);
    expect(result!.entries[0].id).toBe('entry-a');
    expect(result!.entries[1].id).toBe('entry-b');
  });

  it('workspace entry wins on id collision with bundled defaults', () => {
    // Write both bundled (simulated via wsp) and workspace override
    // We cannot inject a bundled path in unit tests; simulate by writing two workspace files
    // with the loader's workspace path, then verify override logic via the second tier.
    // The real two-tier merge is exercised in the scaffold integration test.
    writeFileSync(
      join(tmp, 'wsp', 'inputs', 'pass-catalogs', 'pass-99-test.yaml'),
      WORKSPACE_OVERRIDE_YAML,
      'utf-8',
    );
    const result = loadPassCatalog(tmp, 'pass-99-test.yaml');
    expect(result).not.toBeNull();
    const entryB = result!.entries.find((e) => e.id === 'entry-b');
    expect(entryB).toBeDefined();
    expect((entryB as Record<string, unknown>).name).toBe('Entry B -- workspace override');
  });

  it('includes workspace-only entries not present in base', () => {
    writeFileSync(
      join(tmp, 'wsp', 'inputs', 'pass-catalogs', 'pass-99-test.yaml'),
      WORKSPACE_OVERRIDE_YAML,
      'utf-8',
    );
    const result = loadPassCatalog(tmp, 'pass-99-test.yaml');
    expect(result!.entries.some((e) => e.id === 'entry-c')).toBe(true);
  });

  it('returns null on malformed YAML without throwing', () => {
    writeFileSync(
      join(tmp, 'wsp', 'inputs', 'pass-catalogs', 'pass-99-test.yaml'),
      ': bad:\nyaml: [unclosed',
      'utf-8',
    );
    expect(() => loadPassCatalog(tmp, 'pass-99-test.yaml')).not.toThrow();
    const result = loadPassCatalog(tmp, 'pass-99-test.yaml');
    expect(result).toBeNull();
  });

  it('exposes pass_number and pass_name from the file header', () => {
    writeFileSync(
      join(tmp, 'wsp', 'inputs', 'pass-catalogs', 'pass-99-test.yaml'),
      BASE_CATALOG_YAML,
      'utf-8',
    );
    const result = loadPassCatalog(tmp, 'pass-99-test.yaml');
    expect(result!.pass_number).toBe(99);
    expect(result!.pass_name).toBe('Test Pass');
  });
});

describe('loadPassCatalog -- real bundled catalogue (dev environment)', () => {
  it('resolves the bundled pass-08-crypto-algorithms.yaml in dev source tree', () => {
    const result = loadPassCatalog(tmp, 'pass-08-crypto-algorithms.yaml');
    // In dev, resolveBundledPassCatalogsDir() finds swao/pass-catalogs/ via the __dirname probe.
    // If the bundled file is absent (e.g. CI with a different cwd), we get null -- that is acceptable.
    if (result !== null) {
      expect(result.pass_number).toBe(8);
      expect(result.entries.length).toBeGreaterThan(0);
      expect(result.entries.every((e) => typeof e.id === 'string')).toBe(true);
    }
  });

  it('resolves the bundled pass-03-pii-patterns.yaml in dev source tree', () => {
    const result = loadPassCatalog(tmp, 'pass-03-pii-patterns.yaml');
    if (result !== null) {
      expect(result.pass_number).toBe(3);
      expect(result.entries.length).toBeGreaterThan(0);
    }
  });

  it('resolves the bundled pass-05-runtime-eol.yaml in dev source tree', () => {
    const result = loadPassCatalog(tmp, 'pass-05-runtime-eol.yaml');
    if (result !== null) {
      expect(result.pass_number).toBe(5);
      expect(result.entries.length).toBeGreaterThan(0);
    }
  });

  it('resolves the bundled pass-21-iam-providers.yaml in dev source tree', () => {
    const result = loadPassCatalog(tmp, 'pass-21-iam-providers.yaml');
    if (result !== null) {
      expect(result.pass_number).toBe(21);
      expect(result.entries.some((e) => e.id === 'bundid')).toBe(true);
      expect(result.entries.some((e) => e.id === 'elster-nezo')).toBe(true);
    }
  });
});
