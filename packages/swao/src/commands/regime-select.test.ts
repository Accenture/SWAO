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
 * Tests for regime-select CLI helpers -- issues #1154, #1158
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { load } from 'js-yaml';
import { writeRegimesActive, readRegimesActive } from '../compliance/regime-picker.js';
import { writeAppRegimesActive } from './regime-select.js';

// ---------------------------------------------------------------------------
// #1154 -- workspace-level writeRegimesActive baseline
// ---------------------------------------------------------------------------
describe('writeRegimesActive (workspace-level)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'swao-rs-ws-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sets regimes_active in workspace .swao.yml', () => {
    const ymlPath = join(tmpDir, '.swao.yml');
    writeRegimesActive(ymlPath, ['GDPR', 'ISO_27001']);
    const parsed = load(readFileSync(ymlPath, 'utf-8')) as Record<string, unknown>;
    const assessment = parsed['assessment'] as Record<string, unknown>;
    expect(assessment['regimes_active']).toEqual(['GDPR', 'ISO_27001']);
  });

  it('readRegimesActive returns the written regimes', () => {
    const ymlPath = join(tmpDir, '.swao.yml');
    writeRegimesActive(ymlPath, ['BSI_C5', 'DORA']);
    expect(readRegimesActive(ymlPath)).toEqual(['BSI_C5', 'DORA']);
  });

  it('does not clobber unrelated YAML keys', () => {
    const ymlPath = join(tmpDir, '.swao.yml');
    writeFileSync(ymlPath, 'app:\n  id: my-app\nassessment:\n  regimes_active: [GDPR]\n', 'utf-8');
    writeRegimesActive(ymlPath, ['PCI_DSS']);
    const parsed = load(readFileSync(ymlPath, 'utf-8')) as Record<string, unknown>;
    expect((parsed['app'] as Record<string, unknown>)['id']).toBe('my-app');
    const assessment = parsed['assessment'] as Record<string, unknown>;
    expect(assessment['regimes_active']).toEqual(['PCI_DSS']);
  });
});

// ---------------------------------------------------------------------------
// #1154 -- writeAppRegimesActive: app-level write, no providers block injected
// ---------------------------------------------------------------------------
describe('writeAppRegimesActive (#1154)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'swao-rs-app-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes regimes_active to app .swao.yml', () => {
    const appSwaoYml = join(tmpDir, '.swao.yml');
    writeFileSync(appSwaoYml, 'assessment:\n  regimes_active: []\n', 'utf-8');
    writeAppRegimesActive(appSwaoYml, ['GDPR', 'BSI_C5']);
    const parsed = load(readFileSync(appSwaoYml, 'utf-8')) as Record<string, unknown>;
    const assessment = parsed['assessment'] as Record<string, unknown>;
    expect(assessment['regimes_active']).toEqual(['GDPR', 'BSI_C5']);
  });

  it('does NOT inject providers.regime_catalogs into app-level .swao.yml', () => {
    const appSwaoYml = join(tmpDir, '.swao.yml');
    writeFileSync(appSwaoYml, 'assessment:\n  regimes_active: []\n', 'utf-8');
    writeAppRegimesActive(appSwaoYml, ['GDPR']);
    const parsed = load(readFileSync(appSwaoYml, 'utf-8')) as Record<string, unknown>;
    // workspace-level writeRegimesActive injects providers.regime_catalogs;
    // app-level writeAppRegimesActive must NOT do this.
    expect(parsed['providers']).toBeUndefined();
  });

  it('preserves existing app-level keys when updating regimes', () => {
    const appSwaoYml = join(tmpDir, '.swao.yml');
    writeFileSync(appSwaoYml, 'app:\n  id: sovereign-health\nassessment:\n  regimes_active: [GDPR_DEMO]\n', 'utf-8');
    writeAppRegimesActive(appSwaoYml, ['GDPR', 'ISO_27001']);
    const parsed = load(readFileSync(appSwaoYml, 'utf-8')) as Record<string, unknown>;
    expect((parsed['app'] as Record<string, unknown>)['id']).toBe('sovereign-health');
    const assessment = parsed['assessment'] as Record<string, unknown>;
    expect(assessment['regimes_active']).toEqual(['GDPR', 'ISO_27001']);
  });

  it('creates .swao.yml if it does not exist yet', () => {
    const appSwaoYml = join(tmpDir, 'new-app.swao.yml');
    writeAppRegimesActive(appSwaoYml, ['DORA']);
    const parsed = load(readFileSync(appSwaoYml, 'utf-8')) as Record<string, unknown>;
    const assessment = parsed['assessment'] as Record<string, unknown>;
    expect(assessment['regimes_active']).toEqual(['DORA']);
  });
});

// ---------------------------------------------------------------------------
// #1158 regression -- no runs directory must not break regime selection
// ---------------------------------------------------------------------------
describe('regime-select with no prior assessment run (#1158 regression)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'swao-rs-fresh-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writeRegimesActive succeeds even when wsp/runs does not exist', () => {
    const appDir = join(tmpDir, 'apps', 'my-app');
    mkdirSync(appDir, { recursive: true });
    const appYml = join(appDir, '.swao.yml');
    writeFileSync(appYml, 'assessment:\n  regimes_active: []\n', 'utf-8');
    // wsp/runs does NOT exist -- must not throw (#1158 regression guard).
    expect(() => writeRegimesActive(appYml, ['GDPR'])).not.toThrow();
    expect(readRegimesActive(appYml)).toEqual(['GDPR']);
  });

  it('writeAppRegimesActive succeeds even when wsp/runs does not exist', () => {
    const appYml = join(tmpDir, '.swao.yml');
    writeFileSync(appYml, 'assessment:\n  regimes_active: []\n', 'utf-8');
    expect(() => writeAppRegimesActive(appYml, ['ISO_27001'])).not.toThrow();
  });
});
