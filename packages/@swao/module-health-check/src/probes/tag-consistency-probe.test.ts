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

// #0363 (sprint-039) -- tag-consistency probe tests.
//
// Two test surfaces:
//   1. clean: the 4 currently-bundled community frameworks (GDPR,
//      HIPAA, AI 10 Pillars, COBIT 5) MUST pass with 0 flags at the
//      default 50% threshold. Catches a regression where the
//      retro-tagging from sprint-038 #0348 drifted.
//   2. typo: a tmpdir fixture with a workspace `wsp/inputs/catalogs/community/`
//      overlay containing a small framework where 1-of-5 controls
//      carries a typo-d axis prefix. The probe must flag it AND
//      suggest the canonical via levenshtein-closest neighbour.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildTagConsistencyProbe } from './tag-consistency-probe.js';

describe('buildTagConsistencyProbe -- clean run against bundled frameworks (#0363)', () => {
  // Empty workspace path -> only bundled community-frameworks/ are loaded.
  const TMP_WS = mkdtempSync(join(tmpdir(), 'swao-tag-clean-'));

  it('returns status=ok with 0 flags across the bundled frameworks', () => {
    const result = buildTagConsistencyProbe(TMP_WS);
    // At least one bundled framework expected (GDPR is the most stable).
    expect(result.frameworks.length, 'expected at least one bundled framework').toBeGreaterThan(0);
    expect(result.status).toBe('ok');
    const totalFlags = result.frameworks.reduce((sum, f) => sum + f.flags.length, 0);
    expect(totalFlags, `frameworks with flags: ${result.frameworks.filter((f) => f.flags.length > 0).map((f) => f.framework_id).join(', ')}`).toBe(0);
  });

  it('every bundled framework has at least one axis prefix at 100% coverage (sanity check the data)', () => {
    const result = buildTagConsistencyProbe(TMP_WS);
    for (const fw of result.frameworks) {
      const maxRatio = Math.max(
        ...Object.values(fw.axis_prefix_coverage).map((c) => c / fw.controls_total),
      );
      // Skip frameworks without tags backfilled (axis_prefix_coverage = {}).
      if (Object.keys(fw.axis_prefix_coverage).length === 0) continue;
      expect(maxRatio, `${fw.framework_id} should have a 100%-coverage prefix`).toBeCloseTo(1.0, 5);
    }
  });

  afterAll(() => {
    rmSync(TMP_WS, { recursive: true, force: true });
  });
});

describe('buildTagConsistencyProbe -- flags typo-d axis prefix (#0363)', () => {
  let TMP_WS: string;

  beforeAll(() => {
    TMP_WS = mkdtempSync(join(tmpdir(), 'swao-tag-typo-'));
    // Set up a workspace overlay with a 5-control framework. 4 controls
    // use the canonical `applies-to.pii` axis; 1 control mis-spells it
    // as `applies_to.pii` (underscore). The probe must flag `applies_to`
    // and suggest `applies-to`.
    const fwDir = join(TMP_WS, 'wsp', 'inputs', 'catalogs', 'community', 'fixture-typo-fw');
    mkdirSync(fwDir, { recursive: true });

    const yaml = `regime_meta:
  id: FIXTURE_TYPO
  name: Fixture Typo Framework
  version: "0.0.1"
controls:
  - id: TYPO_1
    title: First control
    description: ok
    tags: ["applies-to.pii", "obligation.principle"]
  - id: TYPO_2
    title: Second control
    description: ok
    tags: ["applies-to.pii", "obligation.principle"]
  - id: TYPO_3
    title: Third control
    description: ok
    tags: ["applies-to.pii", "obligation.principle"]
  - id: TYPO_4
    title: Fourth control
    description: ok
    tags: ["applies-to.pii", "obligation.principle"]
  - id: TYPO_5_BAD
    title: Fifth control (axis-prefix typo-d)
    description: typo control
    tags: ["applies_to.pii", "obligation.principle"]
`;
    writeFileSync(join(fwDir, 'controls.yaml'), yaml, 'utf-8');
  });

  afterAll(() => {
    if (TMP_WS) rmSync(TMP_WS, { recursive: true, force: true });
  });

  it('returns status=warn with the typo prefix flagged', () => {
    const result = buildTagConsistencyProbe(TMP_WS);
    const fixtureFw = result.frameworks.find((f) => f.framework_id === 'fixture-typo-fw');
    expect(fixtureFw, 'fixture framework must be loaded from workspace overlay').toBeDefined();
    expect(result.status).toBe('warn');
    expect(fixtureFw!.flags.length).toBeGreaterThan(0);
    const typoFlag = fixtureFw!.flags.find((f) => f.axis_prefix === 'applies_to');
    expect(typoFlag, '`applies_to` (underscored typo) must be flagged').toBeDefined();
    expect(typoFlag!.controls_with_prefix).toBe(1);
    expect(typoFlag!.framework_total_controls).toBe(5);
    expect(typoFlag!.coverage_ratio).toBeCloseTo(0.2, 5);
  });

  it('suggests the levenshtein-closest canonical prefix in the same framework', () => {
    const result = buildTagConsistencyProbe(TMP_WS);
    const fixtureFw = result.frameworks.find((f) => f.framework_id === 'fixture-typo-fw');
    const typoFlag = fixtureFw!.flags.find((f) => f.axis_prefix === 'applies_to');
    expect(typoFlag!.suggested_canonical).toBe('applies-to');
  });

  it('sample_control_ids names the offending control(s)', () => {
    const result = buildTagConsistencyProbe(TMP_WS);
    const fixtureFw = result.frameworks.find((f) => f.framework_id === 'fixture-typo-fw');
    const typoFlag = fixtureFw!.flags.find((f) => f.axis_prefix === 'applies_to');
    expect(typoFlag!.sample_control_ids).toContain('TYPO_5_BAD');
  });

  it('canonical prefixes (applies-to + obligation) remain at 100% coverage and are NOT flagged', () => {
    const result = buildTagConsistencyProbe(TMP_WS);
    const fixtureFw = result.frameworks.find((f) => f.framework_id === 'fixture-typo-fw');
    expect(fixtureFw!.axis_prefix_coverage['applies-to']).toBe(4);
    expect(fixtureFw!.axis_prefix_coverage['obligation']).toBe(5);
    const obligationFlagged = fixtureFw!.flags.some((f) => f.axis_prefix === 'obligation');
    expect(obligationFlagged).toBe(false);
  });

  it('overall message reflects the flag count', () => {
    const result = buildTagConsistencyProbe(TMP_WS);
    expect(result.message).toMatch(/suspicious axis prefix/);
  });
});

describe('buildTagConsistencyProbe -- small fixture (<4 controls) is not flagged (avoids stub-catalogue false positives)', () => {
  let TMP_WS: string;

  beforeAll(() => {
    TMP_WS = mkdtempSync(join(tmpdir(), 'swao-tag-small-'));
    const fwDir = join(TMP_WS, 'wsp', 'inputs', 'catalogs', 'community', 'tiny-stub');
    mkdirSync(fwDir, { recursive: true });
    writeFileSync(
      join(fwDir, 'controls.yaml'),
      `regime_meta:
  id: TINY
  name: Tiny stub
  version: "0.0.1"
controls:
  - id: T1
    title: Only control
    description: ok
    tags: ["applies-to.pii"]
  - id: T2
    title: Second
    description: ok
    tags: ["applies_to.pii"]
`,
      'utf-8',
    );
  });

  afterAll(() => {
    if (TMP_WS) rmSync(TMP_WS, { recursive: true, force: true });
  });

  it('does NOT flag a 2-control framework even with prefix-shape divergence', () => {
    const result = buildTagConsistencyProbe(TMP_WS);
    const tinyFw = result.frameworks.find((f) => f.framework_id === 'tiny-stub');
    expect(tinyFw).toBeDefined();
    expect(tinyFw!.flags).toHaveLength(0);
  });
});
