// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Doctor module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { _paths, LicenseGuard, buildLicenseKey } from '@swao/core';
import type { LicensePayload } from '@swao/core';

// Import the probe builders directly for unit testing. The Playwright probe
// (#0102) is host-coupled (playwright-driver lives in @swao/swao and is
// binary-excluded); its test moved to the host's crawl/playwright-driver.test.ts
// (#0573). The PlaywrightProbeResult type-shape assertions stay here because the
// type is defined in this module.
import { type LicenseProbeResult, type PlaywrightProbeResult, buildLicenseProbe, checkLlmProviderConfig, checkLzrSnapshots, checkLlmTemperature, checkLlmContextWindow, checkPlaceholderInputs, checkLzrCoveragePerApp } from './health-check.js';

function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const TEMP_HOME = join(tmpdir(), `swao-health-check-test-${process.pid}`);

beforeEach(() => {
  mkdirSync(TEMP_HOME, { recursive: true });
  _paths.statePath = join(TEMP_HOME, '.swao-state.json');
  _paths.licensePath = join(TEMP_HOME, '.swao-license.json');
  if (existsSync(_paths.statePath)) rmSync(_paths.statePath);
  if (existsSync(_paths.licensePath)) rmSync(_paths.licensePath);
});

afterEach(() => {
  rmSync(TEMP_HOME, { recursive: true, force: true });
});

function writeState(data: object): void {
  writeFileSync(_paths.statePath, JSON.stringify(data), 'utf-8');
}

function writeLicenseKey(payload: LicensePayload): void {
  const key = buildLicenseKey(payload);
  writeFileSync(_paths.licensePath, JSON.stringify({ key, activated_at: '2026-04-28', tier: payload.tier, exp: payload.exp, licensee: payload.licensee }), 'utf-8');
}

describe('HealthCheck --license probe state derivation', () => {
  it('Community -- LicenseGuard state is correct (no cap fields after M18)', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 18, fingerprint: 'abc123def456abc1' });
    const state = LicenseGuard.load().state;
    expect(state.tier).toBe('community');
    expect(state.assessmentCount).toBe(18);
    expect(state.assessmentLimit).toBeUndefined();
  });

  it('Community high assessment count -- still no enforcement (M18 D-05 revised)', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 100, fingerprint: 'abc123def456abc1' });
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('community');
    expect(() => guard.requireTier('community')).not.toThrow();
    expect(() => guard.guardAssessmentBudget()).not.toThrow();
  });

  it('Community old first_run -- still no enforcement', () => {
    writeState({ first_run: '2025-01-01', assessment_count: 0, fingerprint: 'abc123def456abc1' });
    const state = LicenseGuard.load().state;
    expect(state.tier).toBe('community');
    expect(state.daysElapsed).toBeGreaterThanOrEqual(90);
  });

  it('Consultant license -- tier is consultant', () => {
    const guard0 = LicenseGuard.load();
    const fp = guard0.state.fingerprint.substring(0, 8);
    writeLicenseKey({ v: 1, tier: 'consultant', licensee: 'Accenture', exp: '2027-12-31', assessment_limit: null, fp, iat: '2026-04-28' });
    const state = LicenseGuard.load().state;
    expect(state.tier).toBe('consultant');
  });

  it('Expired license -- treated as community (no grace counters after M18)', () => {
    const guard0 = LicenseGuard.load();
    const fp = guard0.state.fingerprint.substring(0, 8);
    writeLicenseKey({ v: 1, tier: 'consultant', licensee: 'Old', exp: '2020-01-01', assessment_limit: null, fp, iat: '2019-01-01' });
    const state = LicenseGuard.load().state;
    expect(state.tier).toBe('community');
    expect(state.exp).toBe('2020-01-01');
    expect(state.assessmentLimit).toBeUndefined();
  });
});

// The buildPlaywrightProbe behavioural test (#0102) moved to the host's
// crawl/playwright-driver.test.ts (#0573): playwright-driver is host-only +
// binary-excluded, so the module cannot import it. The PlaywrightProbeResult
// type-shape assertions below stay because the type is defined in doctor.ts.
describe('HealthCheck --PlaywrightProbeResult type shape (#0102)', () => {
  it('PlaywrightProbeResult type has required fields', () => {
    const probe: PlaywrightProbeResult = {
      status: 'ok',
      version: '121.0.6167.57',
      path: '/path/to/chrome',
      error: null,
    };
    expect(probe.status).toBe('ok');
    expect(probe.error).toBeNull();
  });

  it('PlaywrightProbeResult fail state has non-null error', () => {
    const probe: PlaywrightProbeResult = {
      status: 'fail',
      version: null,
      path: '/does/not/exist',
      error: 'Chromium binary not found',
    };
    expect(probe.status).toBe('fail');
    expect(probe.error).not.toBeNull();
  });
});

describe('HealthCheck --LicenseProbeResult type shape', () => {
  it('Community probe -- no assessments_limit field', () => {
    const probe: LicenseProbeResult = {
      status: 'ok',
      tier: 'community',
      assessments_used: 5,
      days_elapsed: 3,
      warning: null,
    };
    expect(probe.status).toBe('ok');
    expect(probe.assessments_limit).toBeUndefined();
    expect(probe.warning).toBeNull();
  });

  it('Consultant near_limit -- assessments_limit set, warning non-null', () => {
    const probe: LicenseProbeResult = {
      status: 'near_limit',
      tier: 'consultant',
      assessments_used: 498,
      assessments_limit: 500,
      days_elapsed: 100,
      warning: 'Near licence budget: 498/500 assessments used',
    };
    expect(probe.assessments_limit).toBe(500);
    expect(probe.warning).not.toBeNull();
  });

  it('Enterprise unlimited -- assessments_limit is null, status is ok', () => {
    const probe: LicenseProbeResult = {
      status: 'ok',
      tier: 'enterprise',
      assessments_used: 1234,
      assessments_limit: null,
      days_elapsed: 60,
      warning: null,
    };
    expect(probe.assessments_limit).toBeNull();
    expect(probe.warning).toBeNull();
  });
});

// Design 062 §6 step 3: proactive expiry warning (re-issue against the EVB-IT
// renewal before the offline key self-expires). buildLicenseProbe is a pure
// function of LicenseState, so drive it with literals.
describe('HealthCheck --buildLicenseProbe expiry warning (Design 062 §6)', () => {
  const base = { fingerprint: 'abc123def456abc1', firstRun: '2026-01-01', daysElapsed: 100 } as const;

  it('Consultant expiring within 30 days -- status expiring_soon, warning + days_until_expiry set', () => {
    const probe = buildLicenseProbe({ ...base, tier: 'consultant', assessmentCount: 10, assessmentLimit: 500, exp: isoInDays(10) });
    expect(probe.status).toBe('expiring_soon');
    expect(probe.warning).toMatch(/expires in \d+ days?/);
    expect(probe.days_until_expiry).toBeGreaterThan(0);
    expect(probe.days_until_expiry).toBeLessThanOrEqual(30);
  });

  it('Consultant exp far in the future -- status ok, no warning', () => {
    const probe = buildLicenseProbe({ ...base, tier: 'consultant', assessmentCount: 10, assessmentLimit: 500, exp: isoInDays(200) });
    expect(probe.status).toBe('ok');
    expect(probe.warning).toBeNull();
    expect(probe.days_until_expiry).toBeGreaterThan(30);
  });

  it('Community -- no exp, days_until_expiry omitted, status ok', () => {
    const probe = buildLicenseProbe({ ...base, tier: 'community', assessmentCount: 50 });
    expect(probe.status).toBe('ok');
    expect(probe.days_until_expiry).toBeUndefined();
  });

  it('Reached budget outranks imminent expiry -- status exhausted', () => {
    const probe = buildLicenseProbe({ ...base, tier: 'consultant', assessmentCount: 10, assessmentLimit: 10, exp: isoInDays(5) });
    expect(probe.status).toBe('exhausted');
    expect(probe.warning).toMatch(/budget reached/);
  });

  it('Near budget but not expiring -- status near_limit (expiry check does not mask it)', () => {
    const probe = buildLicenseProbe({ ...base, tier: 'consultant', assessmentCount: 498, assessmentLimit: 500, exp: isoInDays(200) });
    expect(probe.status).toBe('near_limit');
  });
});

// ---------------------------------------------------------------------------
// #0470 -- LLM provider config check + LZR snapshot staleness
// ---------------------------------------------------------------------------

describe('HealthCheck --checkLlmProviderConfig (#0470)', () => {
  const savedProvider = process.env['SWAO_LLM_PROVIDER'];
  afterEach(() => {
    if (savedProvider === undefined) {
      delete process.env['SWAO_LLM_PROVIDER'];
    } else {
      process.env['SWAO_LLM_PROVIDER'] = savedProvider;
    }
  });

  it('returns [WARN] listing the affected passes when no env and no .swao.yml provider (#0550)', () => {
    delete process.env['SWAO_LLM_PROVIDER'];
    const errors = checkLlmProviderConfig(TEMP_HOME);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/\[WARN\].*No LLM provider/);
    // LLM-optional alignment: the five affected passes are named.
    expect(errors[0]).toMatch(/DATA, CTX, SYNTH, COMP, BLOCKS/);
  });

  it('returns empty when SWAO_LLM_PROVIDER is set', () => {
    process.env['SWAO_LLM_PROVIDER'] = 'stub';
    const errors = checkLlmProviderConfig(TEMP_HOME);
    expect(errors).toHaveLength(0);
  });

  it('returns empty when .swao.yml has providers.llm.primary.type', () => {
    delete process.env['SWAO_LLM_PROVIDER'];
    const ymlPath = join(TEMP_HOME, '.swao.yml');
    writeFileSync(ymlPath, 'providers:\n  llm:\n    primary:\n      type: anthropic\n', 'utf-8');
    const errors = checkLlmProviderConfig(TEMP_HOME);
    expect(errors).toHaveLength(0);
    rmSync(ymlPath);
  });
});

describe('HealthCheck --checkLzrSnapshots (#0470)', () => {
  it('warns when snapshot is older than 7 days', () => {
    const terraformDir = join(TEMP_HOME, 'wsp', 'inputs', 'terraform');
    mkdirSync(terraformDir, { recursive: true });
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(join(terraformDir, 'lz-aws-snapshot.json'), JSON.stringify({ snapshot_generated_at: old }), 'utf-8');
    const warnings = checkLzrSnapshots(TEMP_HOME);
    expect(warnings.some((w) => w.includes('[WARN]') && w.includes('days old'))).toBe(true);
    rmSync(terraformDir, { recursive: true, force: true });
  });

  it('warns when snapshot has fabricated: true', () => {
    const terraformDir = join(TEMP_HOME, 'wsp', 'inputs', 'terraform');
    mkdirSync(terraformDir, { recursive: true });
    const fresh = new Date().toISOString();
    writeFileSync(join(terraformDir, 'lz-meshstack-snapshot.json'), JSON.stringify({ snapshot_generated_at: fresh, fabricated: true }), 'utf-8');
    const warnings = checkLzrSnapshots(TEMP_HOME);
    expect(warnings.some((w) => w.includes('[WARN]') && w.includes('fabricated'))).toBe(true);
    rmSync(terraformDir, { recursive: true, force: true });
  });

  it('returns no warnings for fresh non-fabricated snapshot', () => {
    const terraformDir = join(TEMP_HOME, 'wsp', 'inputs', 'terraform');
    mkdirSync(terraformDir, { recursive: true });
    const fresh = new Date().toISOString();
    writeFileSync(join(terraformDir, 'lz-aws-snapshot.json'), JSON.stringify({ snapshot_generated_at: fresh, fabricated: false }), 'utf-8');
    const warnings = checkLzrSnapshots(TEMP_HOME);
    expect(warnings).toHaveLength(0);
    rmSync(terraformDir, { recursive: true, force: true });
  });

  it('returns empty when no terraform directory exists', () => {
    const warnings = checkLzrSnapshots(TEMP_HOME);
    expect(warnings).toHaveLength(0);
  });

  it('uses configurable maxAgeDays (#0476)', () => {
    const terraformDir = join(TEMP_HOME, 'wsp', 'inputs', 'terraform');
    mkdirSync(terraformDir, { recursive: true });
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      join(terraformDir, 'lz-aws-snapshot.json'),
      JSON.stringify({ snapshot_generated_at: tenDaysAgo }),
      'utf-8',
    );
    expect(checkLzrSnapshots(TEMP_HOME, 7)).toHaveLength(1);
    expect(checkLzrSnapshots(TEMP_HOME, 30)).toHaveLength(0);
    rmSync(terraformDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// #0476 -- new C-19 diagnostics
// ---------------------------------------------------------------------------

describe('checkLlmTemperature (#0476)', () => {
  it('returns empty when no .swao.yml', () => {
    expect(checkLlmTemperature(TEMP_HOME)).toHaveLength(0);
  });

  it('returns warning when llm primary configured but temperature absent', () => {
    writeFileSync(
      join(TEMP_HOME, '.swao.yml'),
      'providers:\n  llm:\n    primary:\n      type: anthropic\n      model: claude-sonnet-4-6\n',
      'utf-8',
    );
    const warnings = checkLlmTemperature(TEMP_HOME);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('[WARN]');
    expect(warnings[0]).toContain('temperature');
  });

  it('returns empty when temperature is set', () => {
    writeFileSync(
      join(TEMP_HOME, '.swao.yml'),
      'providers:\n  llm:\n    primary:\n      type: anthropic\n      temperature: 0\n',
      'utf-8',
    );
    expect(checkLlmTemperature(TEMP_HOME)).toHaveLength(0);
  });
});

describe('checkLlmContextWindow (#0571)', () => {
  // resolveConfiguredModel reads SWAO_*_MODEL env first; clear them so the
  // .swao.yml-driven fixtures are deterministic regardless of the host env.
  const MODEL_ENV = ['SWAO_ANTHROPIC_MODEL', 'SWAO_OPENAI_MODEL', 'SWAO_OLLAMA_MODEL', 'SWAO_LLM_MODEL'] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of MODEL_ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  });
  afterEach(() => {
    for (const k of MODEL_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function writeModel(model: string) {
    writeFileSync(
      join(TEMP_HOME, '.swao.yml'),
      `providers:\n  llm:\n    primary:\n      type: ollama\n      model: ${model}\n`,
      'utf-8',
    );
  }

  it('returns empty when no model is configured', () => {
    expect(checkLlmContextWindow(TEMP_HOME)).toHaveLength(0);
  });

  it('warns when the configured model has a sub-16k context window', () => {
    writeModel('llama3');
    const warnings = checkLlmContextWindow(TEMP_HOME);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('[WARN]');
    expect(warnings[0]).toContain('context window');
    expect(warnings[0]).toContain('COMP');
  });

  it('does not warn for a large-context model (claude)', () => {
    writeModel('claude-sonnet-4-6');
    expect(checkLlmContextWindow(TEMP_HOME)).toHaveLength(0);
  });

  it('does not warn for a large-context model (gpt-4o)', () => {
    writeModel('gpt-4o');
    expect(checkLlmContextWindow(TEMP_HOME)).toHaveLength(0);
  });

  it('does not assert a window for an unknown model', () => {
    writeModel('some-private-model-x');
    expect(checkLlmContextWindow(TEMP_HOME)).toHaveLength(0);
  });

  it('honours the SWAO_OLLAMA_MODEL env override', () => {
    process.env['SWAO_OLLAMA_MODEL'] = 'gemma';
    expect(checkLlmContextWindow(null).length).toBe(1);
  });
});

describe('checkPlaceholderInputs (#0476)', () => {
  it('returns empty when no wsp/inputs directory', () => {
    expect(checkPlaceholderInputs(TEMP_HOME)).toHaveLength(0);
  });

  it('detects placeholder text in wsp/inputs/ files', () => {
    const inputsDir = join(TEMP_HOME, 'wsp', 'inputs', 'workshops');
    mkdirSync(inputsDir, { recursive: true });
    writeFileSync(
      join(inputsDir, 'workshop-sample.md'),
      '# Workshop\nSample / placeholder content\n',
      'utf-8',
    );
    const warnings = checkPlaceholderInputs(TEMP_HOME);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0]).toContain('[WARN]');
    expect(warnings[0]).toContain('placeholder');
    rmSync(join(TEMP_HOME, 'wsp'), { recursive: true, force: true });
  });

  it('skips source/ and catalogs/ subdirs', () => {
    const sourceDir = join(TEMP_HOME, 'wsp', 'inputs', 'source');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, 'README.md'), 'replace-with-real content\n', 'utf-8');
    expect(checkPlaceholderInputs(TEMP_HOME)).toHaveLength(0);
    rmSync(join(TEMP_HOME, 'wsp'), { recursive: true, force: true });
  });
});

describe('checkLzrCoveragePerApp (#0476)', () => {
  it('returns info message when no LZR inputs found for single app', () => {
    const info = checkLzrCoveragePerApp(TEMP_HOME);
    expect(info.length).toBeGreaterThanOrEqual(1);
    expect(info[0]).toContain('[INFO]');
    expect(info[0]).toContain('Pass 23 will skip');
  });

  it('returns empty when LZR snapshot present', () => {
    const tfDir = join(TEMP_HOME, 'wsp', 'inputs', 'terraform');
    mkdirSync(tfDir, { recursive: true });
    writeFileSync(join(tfDir, 'lz-aws-snapshot.json'), '{}', 'utf-8');
    expect(checkLzrCoveragePerApp(TEMP_HOME)).toHaveLength(0);
    rmSync(join(TEMP_HOME, 'wsp'), { recursive: true, force: true });
  });
});
