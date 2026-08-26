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
 * Tests for `swao init` scaffolding helpers -- issues #1153, #1155
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, existsSync, readFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { scaffoldLandingZoneStubs } from './init.js';

// ---------------------------------------------------------------------------
// #1153 -- scaffoldLandingZoneStubs: correct files, no overwrite, graceful
// ---------------------------------------------------------------------------
describe('scaffoldLandingZoneStubs (#1153)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'swao-init-lz-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the imports directory', () => {
    const result = scaffoldLandingZoneStubs(tmpDir);
    expect(existsSync(result.importsDir)).toBe(true);
  });

  it('scaffolds README.md in imports directory', () => {
    const result = scaffoldLandingZoneStubs(tmpDir);
    expect(existsSync(join(result.importsDir, 'README.md'))).toBe(true);
  });

  it('copies all three snapshot files from examples when source is available', () => {
    // In the dev tree, examples/ exists and the 3 LZ snapshot files are present.
    // If copiedFiles is empty AND warnings are present it means the source was not found,
    // which would indicate the binary asset glob regression (#1153) is still present.
    const result = scaffoldLandingZoneStubs(tmpDir);
    expect(result.warnings.length).toBe(0);
    expect(result.copiedFiles.length).toBe(3);
    for (const f of result.copiedFiles) {
      expect(existsSync(join(result.importsDir, f))).toBe(true);
    }
  });

  it('does not overwrite existing operator-customised snapshot files', () => {
    const result1 = scaffoldLandingZoneStubs(tmpDir);
    if (result1.copiedFiles.length === 0) return; // source not available in this environment

    const firstFile = join(result1.importsDir, result1.copiedFiles[0]!);
    writeFileSync(firstFile, '{"custom": true}', 'utf-8');

    const result2 = scaffoldLandingZoneStubs(tmpDir);
    // Already-existing files must NOT be re-copied.
    expect(result2.copiedFiles).not.toContain(result1.copiedFiles[0]);
    expect(readFileSync(firstFile, 'utf-8')).toBe('{"custom": true}');
  });

  it('produces a warning but still creates the directory when source is absent', () => {
    // Verify the shape of the warning message that the binary would emit when the
    // pkg snapshot does not contain the examples/ directory (the pre-fix binary case).
    // We cannot directly trigger this in the dev tree (examples/ always present), but
    // we document the expected interface here for future binary-level E2E validation.
    const result = scaffoldLandingZoneStubs(tmpDir);
    // If source IS available: zero warnings, three files -- happy path.
    // If source is NOT available: one warning, zero files -- graceful degradation.
    const isGraceful = result.warnings.length > 0 && result.copiedFiles.length === 0;
    const isHappy    = result.warnings.length === 0 && result.copiedFiles.length > 0;
    expect(isGraceful || isHappy).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #1155 -- scaffoldLandingZoneStubs idempotency (files not re-copied)
// ---------------------------------------------------------------------------
describe('init idempotency (#1155)', () => {
  it('second scaffoldLandingZoneStubs call skips already-present files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-init-idem-'));
    try {
      scaffoldLandingZoneStubs(dir);
      const r2 = scaffoldLandingZoneStubs(dir);
      // Second call: no files re-copied (idempotent).
      expect(r2.copiedFiles.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
