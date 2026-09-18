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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  inputPathSatisfied,
  evaluateBlindSpot,
  buildScopeCoverage,
  loadBlindSpotsCatalogue,
  resolveDefaultBlindSpotsCataloguePath,
  runScopePass,
} from './pass-13-scope.js';
import type { BlindSpotEntry } from '../schema/blind-spots-catalogue.js';

// Sprint 029 Phase 1 (#0263) -- Pass 13 unit tests. Cover the rule-engine
// paths (closed / partial / open + option-B override) and the runner
// integration with the bundled catalogue.

const NOW = '2026-05-14T12:00:00Z';

function makeEntry(overrides: Partial<BlindSpotEntry> = {}): BlindSpotEntry {
  return {
    id: 'BS_TEST',
    name: 'Test blind spot',
    category: 'network',
    description: 'A synthetic blind spot used by Pass 13 unit tests.',
    severity_default: 'high',
    current_swao_coverage: 'none',
    input_that_closes: 'test_input',
    input_paths: ['wsp/inputs/test-input'],
    input_path_hint: 'Drop the test input under wsp/inputs/test-input/',
    related_regimes: ['BSI_C5'],
    ...overrides,
  };
}

let tmp: string;
let appDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-pass13-'));
  appDir = join(tmp, 'apps', 'audited');
  mkdirSync(join(appDir, 'wsp', 'inputs'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('inputPathSatisfied (#0263 rule-engine primitive)', () => {
  it('returns false for missing path', () => {
    expect(inputPathSatisfied(appDir, 'wsp/inputs/nonexistent')).toBe(false);
  });

  it('returns false for empty directory', () => {
    mkdirSync(join(appDir, 'wsp', 'inputs', 'empty'), { recursive: true });
    expect(inputPathSatisfied(appDir, 'wsp/inputs/empty')).toBe(false);
  });

  it('returns false for zero-byte file', () => {
    writeFileSync(join(appDir, 'wsp', 'inputs', 'empty.csv'), '');
    expect(inputPathSatisfied(appDir, 'wsp/inputs/empty.csv')).toBe(false);
  });

  it('returns true for non-empty file', () => {
    writeFileSync(join(appDir, 'wsp', 'inputs', 'runbook.md'), '# Runbook\nContent.\n');
    expect(inputPathSatisfied(appDir, 'wsp/inputs/runbook.md')).toBe(true);
  });

  it('returns true for directory with at least one non-empty file', () => {
    mkdirSync(join(appDir, 'wsp', 'inputs', 'iam'));
    writeFileSync(join(appDir, 'wsp', 'inputs', 'iam', 'roles.json'), '{"roles":[]}');
    expect(inputPathSatisfied(appDir, 'wsp/inputs/iam')).toBe(true);
  });

  it('ignores dot-files when checking non-emptiness', () => {
    mkdirSync(join(appDir, 'wsp', 'inputs', 'with-dotfile'));
    writeFileSync(join(appDir, 'wsp', 'inputs', 'with-dotfile', '.gitkeep'), '');
    expect(inputPathSatisfied(appDir, 'wsp/inputs/with-dotfile')).toBe(false);
  });
});

describe('evaluateBlindSpot (#0263 coverage classification)', () => {
  it('open when input absent and baseline coverage is none', () => {
    const entry = makeEntry({ current_swao_coverage: 'none' });
    const result = evaluateBlindSpot(appDir, entry);
    expect(result.coverage).toBe('open');
    expect(result.inputProvided).toBeNull();
  });

  it('partial when input absent and baseline coverage is partial', () => {
    const entry = makeEntry({ current_swao_coverage: 'partial' });
    const result = evaluateBlindSpot(appDir, entry);
    expect(result.coverage).toBe('partial');
  });

  it('closed when input present, regardless of baseline (Option B override)', () => {
    // Baseline says partial; input present -> closed wins.
    writeFileSync(join(appDir, 'wsp', 'inputs', 'test-input'), 'content');
    const entry = makeEntry({ current_swao_coverage: 'partial' });
    const result = evaluateBlindSpot(appDir, entry);
    expect(result.coverage).toBe('closed');
    expect(result.inputProvided).toBe('wsp/inputs/test-input');
  });

  it('closed when input is a populated directory', () => {
    mkdirSync(join(appDir, 'wsp', 'inputs', 'test-input'));
    writeFileSync(join(appDir, 'wsp', 'inputs', 'test-input', 'export.yaml'), 'a: 1');
    const entry = makeEntry();
    const result = evaluateBlindSpot(appDir, entry);
    expect(result.coverage).toBe('closed');
  });

  it('walks multiple input_paths and matches the first that satisfies', () => {
    writeFileSync(join(appDir, 'wsp', 'inputs', 'second-path.csv'), 'col1,col2\n1,2');
    const entry = makeEntry({
      input_paths: ['wsp/inputs/first-path', 'wsp/inputs/second-path.csv'],
    });
    const result = evaluateBlindSpot(appDir, entry);
    expect(result.coverage).toBe('closed');
    expect(result.inputProvided).toBe('wsp/inputs/second-path.csv');
  });
});

describe('buildScopeCoverage (#0263 aggregate)', () => {
  it('computes coverage_ratio as (closed + 0.5 * partial) / total', () => {
    const catalogue = { schema_version: '1' as const, catalogue_version: '1.0.0', blind_spots: [] };
    const evaluations = [
      { entry: makeEntry({ id: 'BS_A' }), coverage: 'closed' as const, inputProvided: 'wsp/inputs/a' },
      { entry: makeEntry({ id: 'BS_B' }), coverage: 'closed' as const, inputProvided: 'wsp/inputs/b' },
      { entry: makeEntry({ id: 'BS_C' }), coverage: 'closed' as const, inputProvided: 'wsp/inputs/c' },
      { entry: makeEntry({ id: 'BS_D' }), coverage: 'partial' as const, inputProvided: null },
      { entry: makeEntry({ id: 'BS_E' }), coverage: 'partial' as const, inputProvided: null },
      { entry: makeEntry({ id: 'BS_F' }), coverage: 'open' as const, inputProvided: null },
      { entry: makeEntry({ id: 'BS_G' }), coverage: 'open' as const, inputProvided: null },
      { entry: makeEntry({ id: 'BS_H' }), coverage: 'open' as const, inputProvided: null },
      { entry: makeEntry({ id: 'BS_I' }), coverage: 'open' as const, inputProvided: null },
      { entry: makeEntry({ id: 'BS_J' }), coverage: 'open' as const, inputProvided: null },
    ];
    const result = buildScopeCoverage(catalogue, evaluations, NOW);
    expect(result.total_blind_spots).toBe(10);
    expect(result.closed).toBe(3);
    expect(result.partial).toBe(2);
    expect(result.open).toBe(5);
    expect(result.coverage_ratio).toBe(0.4);
  });

  it('returns 0 ratio for empty catalogue', () => {
    const catalogue = { schema_version: '1' as const, catalogue_version: '1.0.0', blind_spots: [] };
    const result = buildScopeCoverage(catalogue, [], NOW);
    expect(result.coverage_ratio).toBe(0);
    expect(result.total_blind_spots).toBe(0);
  });

  it('attaches partial_coverage_note only to partial entries with partial baseline', () => {
    const partialBaseline = makeEntry({ id: 'BS_PARTIAL', current_swao_coverage: 'partial' });
    const evaluations = [
      { entry: partialBaseline, coverage: 'partial' as const, inputProvided: null },
      { entry: makeEntry({ id: 'BS_OPEN' }), coverage: 'open' as const, inputProvided: null },
    ];
    const catalogue = { schema_version: '1' as const, catalogue_version: '1.0.0', blind_spots: [] };
    const result = buildScopeCoverage(catalogue, evaluations, NOW);
    const partialRow = result.blind_spots.find((b) => b.id === 'BS_PARTIAL');
    const openRow = result.blind_spots.find((b) => b.id === 'BS_OPEN');
    expect(partialRow?.partial_coverage_note).toBeDefined();
    expect(openRow?.partial_coverage_note).toBeUndefined();
    expect(openRow?.input_required).toBeDefined();
  });
});

describe('bundled blind-spots catalogue (#0263 schema integrity)', () => {
  it('loads and schema-validates', () => {
    const path = resolveDefaultBlindSpotsCataloguePath();
    expect(() => loadBlindSpotsCatalogue(path)).not.toThrow();
  });

  it('has 10+ entries', () => {
    const catalogue = loadBlindSpotsCatalogue(resolveDefaultBlindSpotsCataloguePath());
    expect(catalogue.blind_spots.length).toBeGreaterThanOrEqual(10);
  });

  it('every entry has at least one input_paths candidate', () => {
    const catalogue = loadBlindSpotsCatalogue(resolveDefaultBlindSpotsCataloguePath());
    for (const entry of catalogue.blind_spots) {
      expect(entry.input_paths.length, `${entry.id} input_paths`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('runScopePass integration (#0263)', () => {
  it('emits SCOPE-* signals + scope_coverage block on an empty workspace', async () => {
    const result = await runScopePass({
      appId: 'audited',
      sourcePath: appDir,
      workspacePath: appDir,
      iter: 1,
      assessedAt: NOW,
    });
    expect(result.signals.length).toBeGreaterThanOrEqual(1);
    expect(result.signals[0]?.id).toMatch(/^SCOPE-/);
    const scope = result.assessment['scope_coverage'] as { total_blind_spots: number; open: number };
    expect(scope.total_blind_spots).toBeGreaterThanOrEqual(10);
    // Empty workspace -> mostly open; some partial baselines exist.
    expect(scope.open).toBeGreaterThan(0);
  });

  it('closes a blind spot when its input_path is satisfied', async () => {
    // Stage the IAM input path so BS_CLOUD_IAM closes.
    mkdirSync(join(appDir, 'wsp', 'inputs', 'iam'));
    writeFileSync(join(appDir, 'wsp', 'inputs', 'iam', 'roles.json'), '{"roles":[]}');
    const result = await runScopePass({
      appId: 'audited',
      sourcePath: appDir,
      workspacePath: appDir,
      iter: 1,
      assessedAt: NOW,
    });
    const scope = result.assessment['scope_coverage'] as { blind_spots: Array<{ id: string; coverage: string }> };
    const iamRow = scope.blind_spots.find((b) => b.id === 'BS_CLOUD_IAM');
    expect(iamRow?.coverage).toBe('closed');
  });
});
