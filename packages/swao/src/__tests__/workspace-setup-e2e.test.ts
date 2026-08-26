// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- workspace setup E2E tests (#1092/#1093)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * E2E test for the workspace setup flow: YAML builder, date validation,
 * and full scaffold orchestration (SetupWizard writeAndFinish path).
 *
 * These tests exercise the extracted functions from init.ts so that
 * regressions in the workspace .swao.yml generator or scaffold orchestration
 * are caught by CI without needing a running TUI.
 */

import { mkdtempSync, readFileSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { load as yamlLoad } from 'js-yaml';
import {
  validateIso8601Date,
  buildWorkspaceSwaoYml,
  runWorkspaceScaffolders,
} from '../commands/init.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-ws-e2e-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Date validation (#1092)
// ---------------------------------------------------------------------------

describe('validateIso8601Date (#1092)', () => {
  it('returns null for empty string (skip)', () => {
    expect(validateIso8601Date('')).toBeNull();
  });

  it('returns null for a valid YYYY-MM-DD date', () => {
    expect(validateIso8601Date('2026-12-31')).toBeNull();
    expect(validateIso8601Date('2027-01-01')).toBeNull();
  });

  it('returns error for a 3-digit year (226-12-31 -- real-world typo from test-7.11)', () => {
    expect(validateIso8601Date('226-12-31')).not.toBeNull();
  });

  it('returns error for an arbitrary non-date string', () => {
    expect(validateIso8601Date('not-a-date')).not.toBeNull();
  });

  it('returns error for a partial date (2026-12)', () => {
    expect(validateIso8601Date('2026-12')).not.toBeNull();
  });

  it('returns error for a date with extra chars', () => {
    expect(validateIso8601Date('2026-12-311')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// YAML builder (#1093)
// ---------------------------------------------------------------------------

describe('buildWorkspaceSwaoYml (#1093)', () => {
  it('emits wsp_version, engagement block, providers block, and imports_dir', () => {
    const yml = buildWorkspaceSwaoYml({
      name: 'Test Engagement',
      code: 'test',
      ownerLead: 'owner@example.com',
      engLead: 'Lead Person',
      endDate: '2026-12-31',
    });
    const parsed = yamlLoad(yml) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      wsp_version: '0.9',
      engagement: expect.objectContaining({
        name: 'Test Engagement',
        client_code: 'test',
        partnership_lead: 'owner@example.com',
        engagement_lead: 'Lead Person',
        end_date: '2026-12-31',
      }),
      providers: expect.objectContaining({
        llm: expect.anything(),
        redactor: expect.objectContaining({ type: 'pattern' }),
      }),
      imports_dir: 'wsp/inputs/',
    });
  });

  it('omits end_date when empty (skip path)', () => {
    const yml = buildWorkspaceSwaoYml({
      name: 'Test', code: 'tst', ownerLead: '', engLead: '', endDate: '',
    });
    expect(yml).not.toContain('end_date');
  });

  it('omits engagement_lead from the YAML engagement block when empty', () => {
    const yml = buildWorkspaceSwaoYml({
      name: 'Test', code: 'tst', ownerLead: '', engLead: '', endDate: '',
    });
    const parsed = yamlLoad(yml) as { engagement?: { engagement_lead?: string } };
    expect(parsed.engagement?.engagement_lead).toBeUndefined();
  });

  it('emits start_date as today', () => {
    const today = new Date().toISOString().slice(0, 10);
    const yml = buildWorkspaceSwaoYml({
      name: 'Test', code: 'tst', ownerLead: '', engLead: '', endDate: '',
    });
    expect(yml).toContain(`start_date: "${today}"`);
  });

  it('respects explicit redactorType gitleaks', () => {
    const yml = buildWorkspaceSwaoYml({
      name: 'Test', code: 'tst', ownerLead: '', engLead: '', endDate: '',
      redactorType: 'gitleaks',
    });
    expect(yml).toContain('type: gitleaks');
  });

  it('produced YAML round-trips through js-yaml without errors', () => {
    const yml = buildWorkspaceSwaoYml({
      name: 'Sovereign Health', code: 'sovereign-health',
      ownerLead: 'helmut@accenture.com', engLead: 'Helmut Schindlwick',
      endDate: '2027-06-30',
    });
    expect(() => yamlLoad(yml)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Scaffold orchestration
// ---------------------------------------------------------------------------

describe('runWorkspaceScaffolders (#1093)', () => {
  it('creates community catalog directory with bundled demo frameworks', () => {
    runWorkspaceScaffolders(tmp);
    const communityDir = join(tmp, 'wsp', 'inputs', 'catalogs', 'community');
    expect(existsSync(communityDir)).toBe(true);
    // At least one demo framework should be present (gdpr-demo is the baseline)
    expect(existsSync(join(communityDir, 'gdpr-demo'))).toBe(true);
  });

  it('creates PowerBI templates directory', () => {
    runWorkspaceScaffolders(tmp);
    expect(existsSync(join(tmp, 'wsp', 'templates', 'powerbi'))).toBe(true);
  });

  it('writes .gitignore with required workspace entries', () => {
    runWorkspaceScaffolders(tmp);
    const gi = readFileSync(join(tmp, '.gitignore'), 'utf-8');
    expect(gi).toMatch(/^wsp\/logs\/$/m);
    expect(gi).toMatch(/^wsp\/inputs\/catalogs\/community\/\.bundled\/$/m);
    expect(gi).toMatch(/^wsp\/templates\/powerbi\/\*\.pbit$/m);
    expect(gi).toMatch(/^swao-enterprise-win\.exe$/m);
  });

  it('runs scaffoldIngestion on any existing app directories', () => {
    mkdirSync(join(tmp, 'apps', 'my-app'), { recursive: true });
    runWorkspaceScaffolders(tmp);
    expect(existsSync(join(tmp, 'apps', 'my-app', 'ingestion'))).toBe(true);
  });

  it('is idempotent -- calling twice does not throw or duplicate entries', () => {
    runWorkspaceScaffolders(tmp);
    expect(() => runWorkspaceScaffolders(tmp)).not.toThrow();
    const gi = readFileSync(join(tmp, '.gitignore'), 'utf-8');
    const wspLogsCount = (gi.match(/^wsp\/logs\/$/mg) ?? []).length;
    expect(wspLogsCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Full workspace creation flow (writeAndFinish path, #1093)
// ---------------------------------------------------------------------------

describe('full workspace creation flow (#1093)', () => {
  it('produces correct .swao.yml and full directory tree', () => {
    const yamlContent = buildWorkspaceSwaoYml({
      name: 'Sovereign Health',
      code: 'sovereign-health',
      ownerLead: 'helmut@accenture.com',
      engLead: 'Helmut Schindlwick',
      endDate: '2027-06-30',
    });
    mkdirSync(tmp, { recursive: true });
    mkdirSync(join(tmp, 'apps'), { recursive: true });
    // Scaffolders run BEFORE .swao.yml is written, matching the actual CLI flow.
    // #1679 skips demo seeding when .swao.yml already exists (existing workspace
    // protection); writing it first would suppress framework seeding in this test.
    runWorkspaceScaffolders(tmp);
    writeFileSync(join(tmp, '.swao.yml'), yamlContent, 'utf-8');

    // .swao.yml content
    const parsed = yamlLoad(readFileSync(join(tmp, '.swao.yml'), 'utf-8')) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      wsp_version: '0.9',
      engagement: expect.objectContaining({
        name: 'Sovereign Health',
        client_code: 'sovereign-health',
        end_date: '2027-06-30',
        engagement_lead: 'Helmut Schindlwick',
      }),
      imports_dir: 'wsp/inputs/',
    });

    // apps/ directory exists (empty is fine)
    expect(existsSync(join(tmp, 'apps'))).toBe(true);

    // community demo frameworks present directly under community/
    expect(existsSync(join(tmp, 'wsp', 'inputs', 'catalogs', 'community', 'gdpr-demo'))).toBe(true);

    // .gitignore present and covers logs
    const gi = readFileSync(join(tmp, '.gitignore'), 'utf-8');
    expect(gi).toContain('wsp/logs/');
    expect(gi).toMatch(/^wsp\/inputs\/catalogs\/community\/\.bundled\/$/m);
  });

  it('date typo 226-12-31 is rejected by validateIso8601Date before reaching writeAndFinish', () => {
    const err = validateIso8601Date('226-12-31');
    expect(err).not.toBeNull();
    expect(err).toMatch(/YYYY-MM-DD/);
  });
});
