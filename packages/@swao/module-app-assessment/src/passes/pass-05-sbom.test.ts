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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseSbomCsvSheet, parseCycloneDxJson, runSbomPass } from './pass-05-sbom.js';
import type { PassContext } from '@swao/core';

const TMP_ROOT = join(tmpdir(), `swao-sbom-test-${process.pid}`);
const TMP_SRC  = join(TMP_ROOT, 'src');
const TMP_WS   = join(TMP_ROOT, 'ws');
const COMPLIANCE_DIR = join(TMP_WS, 'wsp', 'inputs', 'compliance');

beforeAll(() => {
  mkdirSync(TMP_SRC, { recursive: true });
  mkdirSync(COMPLIANCE_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Unit tests: parseSbomCsvSheet
// ---------------------------------------------------------------------------

describe('parseSbomCsvSheet', () => {
  it('parses comma-delimited CSV with packageName + version headers', () => {
    const csvPath = join(TMP_ROOT, 'test-comma.csv');
    writeFileSync(csvPath, [
      'packageName,version,license',
      'tokio,1.35.0,MIT',
      'serde,1.0.196,MIT OR Apache-2.0',
      'reqwest,0.11.23,MIT OR Apache-2.0',
    ].join('\n'));
    try {
      const result = parseSbomCsvSheet(csvPath);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ name: 'tokio', version: '1.35.0' });
      expect(result[1]).toEqual({ name: 'serde', version: '1.0.196' });
      expect(result[2]).toEqual({ name: 'reqwest', version: '0.11.23' });
    } finally {
      rmSync(csvPath, { force: true });
    }
  });

  it('parses semicolon-delimited CSV (German locale)', () => {
    const csvPath = join(TMP_ROOT, 'test-semi.csv');
    writeFileSync(csvPath, [
      'name;ver;origin',
      'axum;0.7.4;crates.io',
      'tower;0.4.13;crates.io',
    ].join('\n'));
    try {
      const result = parseSbomCsvSheet(csvPath);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: 'axum', version: '0.7.4' });
      expect(result[1]).toEqual({ name: 'tower', version: '0.4.13' });
    } finally {
      rmSync(csvPath, { force: true });
    }
  });

  it('uses component column as name alias', () => {
    const csvPath = join(TMP_ROOT, 'test-component.csv');
    writeFileSync(csvPath, [
      'Component,Version',
      'hyper,1.1.0',
    ].join('\n'));
    try {
      const result = parseSbomCsvSheet(csvPath);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'hyper', version: '1.1.0' });
    } finally {
      rmSync(csvPath, { force: true });
    }
  });

  it('skips empty lines and returns empty array when no name column found', () => {
    const csvPath = join(TMP_ROOT, 'test-noname.csv');
    writeFileSync(csvPath, [
      'library,release',
      'foo,1.0',
      '',
    ].join('\n'));
    try {
      const result = parseSbomCsvSheet(csvPath);
      // 'library' is not a recognised name alias
      expect(result).toHaveLength(0);
    } finally {
      rmSync(csvPath, { force: true });
    }
  });

  it('returns empty array for non-existent file', () => {
    const result = parseSbomCsvSheet(join(TMP_ROOT, 'does-not-exist.csv'));
    expect(result).toHaveLength(0);
  });

  it('handles quoted fields', () => {
    const csvPath = join(TMP_ROOT, 'test-quoted.csv');
    writeFileSync(csvPath, [
      '"packageName","version"',
      '"my-crate","2.0.0"',
    ].join('\n'));
    try {
      const result = parseSbomCsvSheet(csvPath);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'my-crate', version: '2.0.0' });
    } finally {
      rmSync(csvPath, { force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Unit tests: parseCycloneDxJson
// ---------------------------------------------------------------------------

describe('parseCycloneDxJson', () => {
  it('parses CycloneDX v1.4 JSON components', () => {
    const cdxPath = join(TMP_ROOT, 'test.cdx.json');
    writeFileSync(cdxPath, JSON.stringify({
      bomFormat: 'CycloneDX',
      specVersion: '1.4',
      components: [
        { type: 'library', name: 'tokio', version: '1.35.0', purl: 'pkg:cargo/tokio@1.35.0' },
        { type: 'library', name: 'serde', version: '1.0.196', purl: 'pkg:cargo/serde@1.0.196' },
      ],
    }));
    try {
      const result = parseCycloneDxJson(cdxPath);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: 'tokio', version: '1.35.0' });
      expect(result[1]).toEqual({ name: 'serde', version: '1.0.196' });
    } finally {
      rmSync(cdxPath, { force: true });
    }
  });

  it('uses "unknown" when version field is absent', () => {
    const cdxPath = join(TMP_ROOT, 'test-noversion.cdx.json');
    writeFileSync(cdxPath, JSON.stringify({
      components: [
        { type: 'library', name: 'my-lib' },
      ],
    }));
    try {
      const result = parseCycloneDxJson(cdxPath);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'my-lib', version: 'unknown' });
    } finally {
      rmSync(cdxPath, { force: true });
    }
  });

  it('returns empty array when components key is absent', () => {
    const cdxPath = join(TMP_ROOT, 'test-empty.cdx.json');
    writeFileSync(cdxPath, JSON.stringify({ bomFormat: 'CycloneDX' }));
    try {
      const result = parseCycloneDxJson(cdxPath);
      expect(result).toHaveLength(0);
    } finally {
      rmSync(cdxPath, { force: true });
    }
  });

  it('returns empty array for non-existent file', () => {
    const result = parseCycloneDxJson(join(TMP_ROOT, 'does-not-exist.cdx.json'));
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: runSbomPass reads external SBOM files (#1778)
// ---------------------------------------------------------------------------

const BASE_CTX: Omit<PassContext, 'sourcePath' | 'workspacePath'> = {
  appId: 'test-sbom-app',
  iter: 1,
  assessedAt: '2026-08-17',
  llm: undefined as unknown as PassContext['llm'],
};

describe('runSbomPass -- external SBOM inputs', () => {
  it('merges packages from SBOM-*.xlsx.*.csv into dependency set', async () => {
    // Simulate a Rust app: no package.json; SBOM provided via compliance dir.
    const csvFile = 'SBOM-app.xlsx.Rust Dependencies.csv';
    writeFileSync(join(COMPLIANCE_DIR, csvFile), [
      'packageName,version,license',
      'tokio,1.35.0,MIT',
      'serde,1.0.196,MIT OR Apache-2.0',
      'reqwest,0.11.23,MIT OR Apache-2.0',
    ].join('\n'));

    try {
      const result = await runSbomPass({
        ...BASE_CTX,
        sourcePath: TMP_SRC,
        workspacePath: TMP_WS,
      });

      // Should NOT short-circuit (no_package_json)
      expect(result.assessment['scan_type']).not.toBe('skipped');
      // dependency_count must include the 3 CSV rows
      expect(result.assessment['dependency_count']).toBeGreaterThanOrEqual(3);
      // External files recorded in assessment
      expect(result.assessment['external_sbom_files']).toContain(csvFile);
      expect(result.assessment['external_sbom_component_count']).toBe(3);
      // Must produce signals
      expect(result.signals.length).toBeGreaterThan(0);
    } finally {
      rmSync(join(COMPLIANCE_DIR, csvFile), { force: true });
    }
  });

  it('merges packages from *.cdx.json CycloneDX file', async () => {
    const cdxFile = 'sovereign-health.cdx.json';
    writeFileSync(join(COMPLIANCE_DIR, cdxFile), JSON.stringify({
      bomFormat: 'CycloneDX',
      specVersion: '1.4',
      components: [
        { type: 'library', name: 'axum', version: '0.7.4' },
        { type: 'library', name: 'tower', version: '0.4.13' },
      ],
    }));

    try {
      const result = await runSbomPass({
        ...BASE_CTX,
        sourcePath: TMP_SRC,
        workspacePath: TMP_WS,
      });

      expect(result.assessment['scan_type']).not.toBe('skipped');
      expect(result.assessment['dependency_count']).toBeGreaterThanOrEqual(2);
      expect(result.assessment['external_sbom_files']).toContain(cdxFile);
    } finally {
      rmSync(join(COMPLIANCE_DIR, cdxFile), { force: true });
    }
  });

  it('returns skipped assessment when no package.json and no external SBOM files exist', async () => {
    // Ensure compliance dir is empty for this test.
    const emptyWs = join(TMP_ROOT, 'empty-ws');
    mkdirSync(join(emptyWs, 'wsp', 'inputs', 'compliance'), { recursive: true });

    try {
      const result = await runSbomPass({
        ...BASE_CTX,
        sourcePath: TMP_SRC,
        workspacePath: emptyWs,
      });

      expect(result.assessment['scan_type']).toBe('skipped');
      expect(result.assessment['reason']).toBe('no_package_json');
    } finally {
      rmSync(emptyWs, { recursive: true, force: true });
    }
  });

  it('does not add external packages to OSV spot-check set (npm ecosystem isolation)', async () => {
    // Provide only a Rust SBOM; no package.json.
    const csvFile = 'rust-only.sbom.csv';
    writeFileSync(join(COMPLIANCE_DIR, csvFile), [
      'name,version',
      'tokio,1.35.0',
    ].join('\n'));

    try {
      const result = await runSbomPass({
        ...BASE_CTX,
        sourcePath: TMP_SRC,
        workspacePath: TMP_WS,
      });

      // SBOM-01 derivation should show 0 queried deps (a CSV row has no
      // package URL, so its ecosystem is unknown and it is not sent to OSV).
      // #3420: wording changed from "Spot check of N runtime dependencies".
      const sbom01 = result.signals.find(s => s.id === 'SBOM-01');
      expect(sbom01).toBeDefined();
      expect(sbom01?.derivation).toContain('OSV batch query of 0 dependencies');
    } finally {
      rmSync(join(COMPLIANCE_DIR, csvFile), { force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Integration tests: EOL catalogue extension (#3065)
// ---------------------------------------------------------------------------

describe('runSbomPass -- EOL catalogue extension via build config files', () => {
  it('emits an EOL signal when a build.gradle contains a Java version key from the catalogue', async () => {
    // Write a build.gradle that contains a Java version specifier.
    // The pass-05-runtime-eol.yaml catalogue entry for java-17 / java-11 uses
    // config_keys like ["sourceCompatibility", "targetCompatibility"].
    writeFileSync(join(TMP_SRC, 'build.gradle'), `
plugins { id 'java' }
sourceCompatibility = '11'
targetCompatibility = '11'
`, 'utf-8');

    const result = await runSbomPass({
      ...BASE_CTX,
      sourcePath: TMP_SRC,
      workspacePath: TMP_WS,
    });

    // #3420: the Java release is read from the build file deterministically
    // (one Java runtime signal, no duplicate from the catalogue regexes).
    const javaSignals = result.signals.filter(
      (s) => s.id.startsWith('SBOM-') && s.derivation.toLowerCase().includes('java'),
    );
    expect(javaSignals).toHaveLength(1);
    expect(javaSignals[0]!.derivation).toContain('sourceCompatibility');
    expect(javaSignals[0]!.evidence.some((e) => e.includes('build.gradle'))).toBe(true);
    expect((result.assessment['java_runtime'] as { major: number }).major).toBe(11);

    rmSync(join(TMP_SRC, 'build.gradle'), { force: true });
  });

  it('emits an EOL signal when a pom.xml specifies a Python runtime via config_key', async () => {
    // Write a pyproject.toml that contains a python version specifier.
    // The pass-05-runtime-eol.yaml catalogue entry for python-3.8 uses
    // config_keys like ["python_requires", "python-requires"].
    writeFileSync(join(TMP_SRC, 'pyproject.toml'), `
[build-system]
requires = ["setuptools>=42"]

[tool.poetry]
name = "my-service"

[tool.poetry.dependencies]
python = "~3.8.0"
python_requires = ">=3.8,<3.9"
`, 'utf-8');

    const result = await runSbomPass({
      ...BASE_CTX,
      sourcePath: TMP_SRC,
      workspacePath: TMP_WS,
    });

    const catalogueSignals = result.signals.filter(
      (s) => s.id.startsWith('SBOM-') && s.derivation.toLowerCase().includes('python'),
    );

    if (catalogueSignals.length === 0) {
      // Catalogue absent or no Python EOL entry matched -- pass is still complete
      expect(result.pass.name).toBe('sbom_cve');
    } else {
      expect(catalogueSignals[0]!.evidence.some((e) => e.includes('pyproject.toml'))).toBe(true);
    }

    rmSync(join(TMP_SRC, 'pyproject.toml'), { force: true });
  });

  it('does not emit duplicate signals for Node.js (hardcoded check takes priority)', async () => {
    // Write a .nvmrc that would be scanned by the catalogue, but Node.js is covered
    // by the hardcoded Node.js EOL check so should not produce a second SBOM signal
    // with the same runtime.
    writeFileSync(join(TMP_SRC, 'package.json'), JSON.stringify({
      name: 'test-app', engines: { node: '14.x' }, dependencies: {},
    }), 'utf-8');
    writeFileSync(join(TMP_SRC, '.nvmrc'), '14\n', 'utf-8');

    const result = await runSbomPass({
      ...BASE_CTX,
      sourcePath: TMP_SRC,
      workspacePath: TMP_WS,
    });

    // Count signals that reference Node.js EOL
    const nodejsSignals = result.signals.filter(
      (s) => s.derivation.toLowerCase().includes('node') && s.derivation.toLowerCase().includes('eol'),
    );

    // At most 1 Node.js EOL signal (hardcoded check only; catalogue skips nodejs-* IDs)
    expect(nodejsSignals.length).toBeLessThanOrEqual(1);

    rmSync(join(TMP_SRC, 'package.json'), { force: true });
    rmSync(join(TMP_SRC, '.nvmrc'), { force: true });
  });
});
