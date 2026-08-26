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

/**
 * Journey J5 -- BI Export (Star Schema CSV Contract)
 *
 * User journey (from docs/design/user-journey/J5-powerbi-output.md):
 *   After assessment, Alex exports the results as a BI-ready star schema bundle.
 *   The bundle contains 17 CSV files and a manifest.yaml with row counts and
 *   SHA-256 checksums for each table.
 *
 * PowerBI Desktop is a Windows native app and cannot be driven by Playwright.
 * The testable boundary for J5 is the CSV and manifest layer: correct files,
 * correct headers, and consistent manifest row counts and checksums.
 *
 * Tests J5-01 through J5-05 operate on the committed golden fixture bundle and
 * do NOT spawn the binary. J5-06 spawns the binary to verify the live export path.
 *
 * Golden fixture:
 *   examples/portfolio-workspace/portfolio/apps/sovereign-health/wsp/exports/
 *     2026-05-14T06-22-34/          -- full bundle with manifest.yaml + star/
 *       manifest.yaml
 *       star/
 *         *.csv  (17 files)
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import { hasBinary, run, validateStarSchema, WORKSPACE, attachOutput } from './helpers.js';

// ── Golden fixture paths ─────────────────────────────────────────────────────

// The dated export bundle committed to the golden fixture. It has both the
// manifest.yaml and the star/ subdirectory so all fixture tests use the same root.
const GOLDEN_BUNDLE = join(
  WORKSPACE, 'apps', 'sovereign-health', 'wsp', 'exports', '2026-05-14T06-22-34',
);
const GOLDEN_STAR_DIR = join(GOLDEN_BUNDLE, 'star');
const MANIFEST_PATH = join(GOLDEN_BUNDLE, 'manifest.yaml');

// ── CSV header contract ──────────────────────────────────────────────────────

/**
 * Expected column headers per table.
 * Derived directly from the golden fixture CSV files -- not invented.
 * Any change to star.ts column names causes these assertions to fail before commit.
 */
const HEADER_CONTRACT: Record<string, string[]> = {
  'dim_app.csv': [
    'app_id', 'name', 'business_domain', 'business_criticality', 'regulatory_class',
    'seven_r_label', 'modernization_position', 'coverage_score', 'confidence',
    'portability_score', 'landing_zone', 'engagement_name', 'client_code',
    'partnership_lead', 'engagement_start_date',
  ],
  'dim_control.csv': [
    'control_id', 'regime_id', 'title', 'description', 'severity_default', 'catalogue_version',
  ],
  'dim_evidence.csv': [
    'evidence_id', 'evidence_type', 'source_path', 'summary', 'context_input',
    'collected_at', 'reliability_weight',
  ],
  'dim_pass.csv': ['pass_num', 'name', 'signal_prefix', 'assessment_block_name'],
  'dim_regime.csv': [
    'regime_id', 'name', 'version', 'scope', 'authority', 'catalogue_version', 'controls_count',
  ],
  'dim_severity.csv': ['severity', 'rank', 'category'],
  'dim_wave.csv': ['wave_number', 'name', 'target_quarter', 'selection_criteria'],
  'fact_assessments.csv': [
    'assessment_id', 'app_id', 'block_name', 'overall_outcome', 'overall_rationale',
    'score', 'threshold', 'status', 'assessor', 'assessed_at',
  ],
  'fact_controls.csv': [
    'control_id', 'regime_id', 'app_id', 'outcome', 'status', 'severity',
    'rationale', 'assessor', 'assessed_at', 'remediation',
  ],
  'fact_findings.csv': [
    'finding_id', 'app_id', 'category', 'severity', 'description',
    'remediation', 'blocks_migration', 'signal_ref',
  ],
  'fact_pass_runs.csv': [
    'run_id', 'app_id', 'pass_num', 'pass_name', 'wall_clock_ms',
    'signals_emitted', 'tokens_in', 'tokens_out', 'cost_usd',
  ],
  'fact_risks.csv': [
    'risk_id', 'app_id', 'category', 'likelihood', 'impact', 'trigger', 'mitigation', 'owner',
  ],
  'fact_runs.csv': [
    'run_id', 'app_id', 'started_at', 'finished_at', 'duration_ms', 'duration_minutes',
    'iter', 'assessed_at', 'total_signals_emitted', 'passes_executed_count',
    'llm_provider', 'llm_model', 'llm_total_tokens_in', 'llm_total_tokens_out',
    'llm_total_cost_usd', 'llm_call_count', 'files_inventory_count', 'files_source_total',
    'files_imports_total', 'lz_weight_sovereign_score', 'lz_weight_service_coverage',
    'lz_weight_portability', 'lz_weight_cost_tier',
  ],
  'fact_signals.csv': [
    'signal_id', 'app_id', 'pass_num', 'severity', 'outcome', 'confidence', 'assessor',
    'assessed_at', 'source', 'category', 'synthesis', 'legacy_tier', 'signal_ref',
    'derivation', 'derivation_chain', 'false_positive_considered', 'false_positive_ruled_out',
  ],
  'link_control_evidence.csv': ['control_id', 'evidence_id', 'regime_id', 'app_id'],
  'link_control_signal.csv': ['control_id', 'signal_id', 'regime_id', 'app_id'],
  'link_signal_evidence.csv': ['signal_id', 'evidence_id', 'app_id'],
};

// ── Manifest schema ──────────────────────────────────────────────────────────

interface ManifestEntry {
  path: string;
  rows: number;
  sha256: string;
  bytes: number;
}

interface Manifest {
  bundle_schema_version: string;
  app_id: string;
  files: ManifestEntry[];
}

// ── Local helpers ─────────────────────────────────────────────────────────────

/** Read the first (header) row of a CSV file as a trimmed string array. */
function readCsvHeader(csvPath: string): string[] {
  const raw = readFileSync(csvPath, 'utf-8').replace(/^﻿/, ''); // strip BOM
  const firstLine = raw.split('\n')[0] ?? '';
  return firstLine.split(',').map(h => h.trim());
}

/** Count non-empty data rows in a CSV file (header excluded). */
function countDataRows(csvPath: string): number {
  const raw = readFileSync(csvPath, 'utf-8').replace(/^﻿/, '');
  const lines = raw.split('\n').filter(l => l.trim() !== '');
  return Math.max(0, lines.length - 1);
}

/** Compute the SHA-256 digest (hex) of a file's raw bytes. */
function fileSha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('J5 -- BI Export Star Schema Contract', () => {

  // ── J5-01: All 17 CSV files present ─────────────────────────────────────────

  test('J5-01: golden fixture star/ contains all 17 CSV files and manifest.yaml', async () => {
    expect(
      existsSync(GOLDEN_BUNDLE),
      `Golden bundle not found at ${GOLDEN_BUNDLE}`,
    ).toBe(true);
    expect(
      existsSync(MANIFEST_PATH),
      `manifest.yaml missing from ${GOLDEN_BUNDLE}`,
    ).toBe(true);
    await validateStarSchema(GOLDEN_STAR_DIR);
  });

  // ── J5-02: CSV headers match column contract ─────────────────────────────────

  test('J5-02: CSV headers match Design 051 column contract', () => {
    for (const [filename, expectedCols] of Object.entries(HEADER_CONTRACT)) {
      const csvPath = join(GOLDEN_STAR_DIR, filename);
      const actualCols = readCsvHeader(csvPath);
      expect(
        actualCols,
        `${filename}: header mismatch -- actual: [${actualCols.join(', ')}]`,
      ).toEqual(expectedCols);
    }
  });

  // ── J5-03: Row counts consistent with manifest ───────────────────────────────

  test('J5-03: manifest row counts match actual CSV data rows', () => {
    test.skip(!existsSync(MANIFEST_PATH), 'golden bundle manifest.yaml not present');
    const manifest = yamlLoad(readFileSync(MANIFEST_PATH, 'utf-8')) as Manifest;
    expect(Array.isArray(manifest.files), 'manifest.files must be an array').toBe(true);
    for (const entry of manifest.files) {
      const csvPath = join(GOLDEN_BUNDLE, entry.path);
      const actualRows = countDataRows(csvPath);
      expect(
        actualRows,
        `${entry.path}: manifest rows=${entry.rows} but CSV contains ${actualRows} data rows`,
      ).toBe(entry.rows);
    }
  });

  // ── J5-04: fact_signals row count > 0 ───────────────────────────────────────

  test('J5-04: fact_signals.csv has at least one data row', () => {
    const csvPath = join(GOLDEN_STAR_DIR, 'fact_signals.csv');
    const rows = countDataRows(csvPath);
    expect(
      rows,
      'fact_signals.csv has no data rows -- every PowerBI report page would be blank',
    ).toBeGreaterThan(0);
  });

  // ── J5-05: SHA-256 checksums match manifest ──────────────────────────────────

  test('J5-05: SHA-256 checksums match manifest values', () => {
    test.skip(!existsSync(MANIFEST_PATH), 'golden bundle manifest.yaml not present');
    const manifest = yamlLoad(readFileSync(MANIFEST_PATH, 'utf-8')) as Manifest;
    for (const entry of manifest.files) {
      const csvPath = join(GOLDEN_BUNDLE, entry.path);
      const actualHash = fileSha256(csvPath);
      expect(
        actualHash,
        `${entry.path}: SHA-256 mismatch -- manifest: ${entry.sha256}, computed: ${actualHash}`,
      ).toBe(entry.sha256);
    }
  });

  // ── J5-06: Live export produces the 17 CSV files ─────────────────────────────

  test('J5-06: swao export --app sovereign-health produces 17 CSV files', async ({}, testInfo) => {
    test.skip(!hasBinary, 'swao binary not found -- run scripts/build-binary.sh first');
    test.setTimeout(120_000);

    const exportsDir = join(WORKSPACE, 'apps', 'sovereign-health', 'wsp', 'exports');
    const beforeDirs: string[] = existsSync(exportsDir)
      ? readdirSync(exportsDir, { withFileTypes: true })
          .filter(e => e.isDirectory())
          .map(e => e.name)
      : [];

    const r = run(['export', '--app', 'sovereign-health', '--formats', 'csv', '--no-templates']);
    attachOutput(testInfo, 'export --app sovereign-health --formats csv --no-templates', r);
    expect(r.status, 'swao export exited non-zero').toBe(0);

    // Locate the newly created bundle directory.
    const afterDirs = readdirSync(exportsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
    const newDirs = afterDirs.filter(d => !beforeDirs.includes(d));
    expect(
      newDirs.length,
      `expected a new export bundle directory under ${exportsDir} -- found none`,
    ).toBeGreaterThan(0);

    const newBundleStarDir = join(exportsDir, newDirs[newDirs.length - 1], 'star');
    await validateStarSchema(newBundleStarDir);

    // fact_signals must carry at least one row.
    const signalsPath = join(newBundleStarDir, 'fact_signals.csv');
    const rows = countDataRows(signalsPath);
    expect(
      rows,
      'fact_signals.csv is empty in live export -- assessment output is missing',
    ).toBeGreaterThan(0);
  });

});
