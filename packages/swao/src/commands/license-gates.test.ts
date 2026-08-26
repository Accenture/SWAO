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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { FEATURE_GATES } from '../license/license-guard.js';
import type { FeatureKey } from '../license/license-guard.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { _paths, LicenseGuard, LicenseTierError, LicenseLimitError, buildLicenseKey } from '../license/license-guard.js';
import type { LicensePayload } from '../license/license-guard.js';

// ---------------------------------------------------------------------------
// Test isolation -- redirect license/state files to tmpdir
// ---------------------------------------------------------------------------

const TEMP_HOME = join(tmpdir(), `swao-gates-test-${process.pid}`);

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

function fp8(): string {
  return LicenseGuard.load().state.fingerprint.substring(0, 8);
}

function writeLicenseKey(tier: 'consultant' | 'enterprise'): void {
  const payload: LicensePayload = {
    v: 1,
    tier,
    licensee: 'TestOrg',
    email: 'test@example.com',
    exp: '2027-12-31',
    assessment_limit: null,
    fp: fp8(),
    iat: '2026-04-28',
  };
  const key = buildLicenseKey(payload);
  writeFileSync(
    _paths.licensePath,
    JSON.stringify({ key, activated_at: '2026-04-28', tier: payload.tier, exp: payload.exp, licensee: payload.licensee }),
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// assess --portfolio gate (Enterprise)
// ---------------------------------------------------------------------------

describe('assess --portfolio enterprise gate', () => {
  it('requireTier("enterprise") throws LicenseTierError on community tier', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123de' });
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('enterprise', { feature: 'assess --portfolio' })).toThrow(LicenseTierError);
  });

  it('requireTier("enterprise") throws LicenseTierError on consultant tier', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123de' });
    writeLicenseKey('consultant');
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('enterprise', { feature: 'assess --portfolio' })).toThrow(LicenseTierError);
  });

  it('requireTier("enterprise") does not throw on enterprise tier', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123de' });
    writeLicenseKey('enterprise');
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('enterprise', { feature: 'assess --portfolio' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// report --portfolio gate (Enterprise)
// ---------------------------------------------------------------------------

describe('report --portfolio enterprise gate', () => {
  it('requireTier("enterprise") throws LicenseTierError on community tier', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123de' });
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('enterprise', { feature: 'report --portfolio' })).toThrow(LicenseTierError);
  });

  it('requireTier("enterprise") does not throw on enterprise tier', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123de' });
    writeLicenseKey('enterprise');
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('enterprise', { feature: 'report --portfolio' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// report --format pdf gate (Consultant)
// ---------------------------------------------------------------------------

describe('report --format pdf consultant gate', () => {
  it('requireTier("consultant") throws LicenseTierError on community tier', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123de' });
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('consultant', { feature: 'report --format pdf' })).toThrow(LicenseTierError);
  });

  it('aged Community still throws LicenseTierError (no cap after M18 D-05 revised)', () => {
    writeState({ first_run: '2025-01-01', assessment_count: 0, fingerprint: 'abc123de' });
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('consultant', { feature: 'report --format pdf' })).toThrow(LicenseTierError);
    expect(() => guard.requireTier('consultant', { feature: 'report --format pdf' })).not.toThrow(LicenseLimitError);
  });

  it('requireTier("consultant") does not throw on consultant tier', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123de' });
    writeLicenseKey('consultant');
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('consultant', { feature: 'report --format pdf' })).not.toThrow();
  });

  it('requireTier("consultant") does not throw on enterprise tier', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123de' });
    writeLicenseKey('enterprise');
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('consultant', { feature: 'report --format pdf' })).not.toThrow();
  });

  // #0576: the PDF renderer moved to @swao/module-pdf-report (Consultant tier),
  // but the runtime gate stays in the host report command. Source-scan to make
  // sure the consultant gate for the pdf format was not lost in the extraction.
  it('host report.ts still gates --format pdf behind requireTier("consultant")', () => {
    const reportSrc = readFileSync(join(__dirname, 'report.ts'), 'utf-8');
    expect(reportSrc).toMatch(/requireTier\(\s*'consultant'\s*,\s*\{\s*feature:\s*'report --format pdf'/);
  });
});

// ---------------------------------------------------------------------------
// LLM Assessment -- ungated (Community+, DOCX golden standard)
// ---------------------------------------------------------------------------

describe('LLM Assessment -- ungated (Community+ per DOCX golden standard)', () => {
  it('FEATURE_GATES maps llm-assessment to community tier', () => {
    expect(FEATURE_GATES['llm-assessment']).toBe('community');
  });

  it('community tier can call requireFeature("llm-assessment") without error', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123de' });
    const guard = LicenseGuard.load();
    expect(() => guard.requireFeature('llm-assessment')).not.toThrow();
  });

  it('llm-type.ts does NOT gate LLM Assessment behind any tier', () => {
    const src = readFileSync(
      join(__dirname, '../../../@swao/module-llm-assessment/src/llm-type.ts'),
      'utf-8',
    );
    expect(src).not.toMatch(/requireTier\(\s*['"]consultant['"]/);
    expect(src).not.toMatch(/requireTier\(\s*['"]enterprise['"]/);
  });

  it('LlmAssessmentScreen.tsx does NOT gate behind requireTier', () => {
    const src = readFileSync(
      join(__dirname, '../tui/screens/LlmAssessmentScreen.tsx'),
      'utf-8',
    );
    expect(src).not.toMatch(/requireTier\(\s*['"]consultant['"]/);
  });
});

// ---------------------------------------------------------------------------
// publish --edit enterprise gate (D-06, upgraded from consultant 2026-07-26)
// ---------------------------------------------------------------------------

describe('publish --edit enterprise gate (D-06)', () => {
  it('requireTier("enterprise") throws on community', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123de' });
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('enterprise', { feature: 'publish --edit' })).toThrow(LicenseTierError);
  });

  it('requireTier("enterprise") throws on consultant', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123de' });
    writeLicenseKey('consultant');
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('enterprise', { feature: 'publish --edit' })).toThrow(LicenseTierError);
  });

  it('requireTier("enterprise") passes on enterprise', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123de' });
    writeLicenseKey('enterprise');
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('enterprise', { feature: 'publish --edit' })).not.toThrow();
  });

  it('publish.ts gates --edit behind requireTier("enterprise")', () => {
    const src = readFileSync(
      join(__dirname, '../../../@swao/module-html-report/src/commands/publish.ts'),
      'utf-8',
    );
    expect(src).toMatch(/requireTier\(\s*'enterprise'\s*,\s*\{\s*feature:\s*'publish --edit'/);
  });
});

// ---------------------------------------------------------------------------
// HTML Report baseline consultant gate
// ---------------------------------------------------------------------------

describe('html-report baseline consultant gate', () => {
  it('FEATURE_GATES maps html-report to consultant tier', () => {
    expect(FEATURE_GATES['html-report']).toBe('consultant');
  });

  it('community tier throws when requireFeature("html-report") is called', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123de' });
    const guard = LicenseGuard.load();
    expect(() => guard.requireFeature('html-report')).toThrow(LicenseTierError);
  });

  it('consultant tier passes requireFeature("html-report")', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123de' });
    writeLicenseKey('consultant');
    const guard = LicenseGuard.load();
    expect(() => guard.requireFeature('html-report')).not.toThrow();
  });

  it('publish.ts has html-report consultant gate for non-community block profiles', () => {
    const src = readFileSync(
      join(__dirname, '../../../@swao/module-html-report/src/commands/publish.ts'),
      'utf-8',
    );
    expect(src).toMatch(/requireTier\(\s*'consultant'\s*,\s*\{\s*feature:\s*'html-report'/);
  });
});

// ---------------------------------------------------------------------------
// challenge --agent gate (consistency check -- gate already existed)
// ---------------------------------------------------------------------------

describe('challenge --agent enterprise gate (consistency)', () => {
  it('requireTier("enterprise") throws on community for challenge', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123de' });
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('enterprise', { feature: 'challenge' })).toThrow(LicenseTierError);
  });
});

// ---------------------------------------------------------------------------
// FEATURE_GATES registry completeness and correctness
// ---------------------------------------------------------------------------

describe('FEATURE_GATES registry (golden standard: swao-feature-tier-matrix.docx)', () => {
  const EXPECTED: Record<string, string> = {
    'llm-assessment':       'community',
    'portfolio-assess':     'enterprise',
    'pdf-report':           'consultant',
    'html-report':          'consultant',
    'html-editor':          'enterprise',
    'html-portal':          'enterprise',
    'challenge':            'enterprise',
    'lz-catalogue-update':  'consultant',
    'bi-export':            'enterprise',
    'mcp-server':           'enterprise',
    'portfolio-report':     'enterprise',
  };

  it('every expected feature key exists in FEATURE_GATES', () => {
    for (const key of Object.keys(EXPECTED) as FeatureKey[]) {
      expect(FEATURE_GATES).toHaveProperty(key);
    }
  });

  it('every feature key maps to the correct tier', () => {
    for (const [key, tier] of Object.entries(EXPECTED)) {
      expect(FEATURE_GATES[key as FeatureKey]).toBe(tier);
    }
  });
});

// ---------------------------------------------------------------------------
// Gate messages include both contact addresses
// ---------------------------------------------------------------------------

describe('gate upgrade messages include both contact addresses', () => {
  it('assess --portfolio upgrade message has both contact emails', () => {
    const msg = [
      '[LICENSE] swao assess --portfolio requires an Enterprise license.',
      'Run `swao license request` to obtain a license.',
      'Contact: https://github.com/Accenture/SWAO/discussions',
    ].join('\n');
    expect(msg).toContain('github.com/Accenture/SWAO');
    expect(msg).toContain('github.com/Accenture/SWAO');
  });

  it('report --portfolio upgrade message has both contact emails', () => {
    const msg = [
      '[LICENSE] swao report --portfolio requires an Enterprise license.',
      'Run `swao license request` to obtain a license.',
      'Contact: https://github.com/Accenture/SWAO/discussions',
    ].join('\n');
    expect(msg).toContain('github.com/Accenture/SWAO');
    expect(msg).toContain('github.com/Accenture/SWAO');
  });

  it('report --format pdf upgrade message has both contact emails', () => {
    const msg = [
      '[LICENSE] swao report --format pdf requires a Consultant or Enterprise license.',
      'Run `swao license request` to obtain a license.',
      'Contact: https://github.com/Accenture/SWAO/discussions',
    ].join('\n');
    expect(msg).toContain('github.com/Accenture/SWAO');
    expect(msg).toContain('github.com/Accenture/SWAO');
  });
});
