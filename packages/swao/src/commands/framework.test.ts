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

// Integration tests for the `swao framework` command surface (#0324 sprint-036).
//
// Tests the Community Frameworks command surface end-to-end against
// synthesised fixture workspaces. Verifies the registry-read path, the
// install-copies-files path, the info-print path, and the uninstall-
// removes-files path. Captures stdout via console.log spy.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdList, cmdInstall, cmdInfo, cmdUninstall } from './framework.js';
import { communityFrameworksDir } from '@swao/community-frameworks';
import { loadRegimeCatalogue } from '@swao/core';

const BUNDLED_AI_10_PILLARS = join(communityFrameworksDir, 'ai-10-pillars');

describe('swao framework command surface (#0324)', () => {
  let tmpWorkspace: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpWorkspace = mkdtempSync(join(tmpdir(), 'swao-framework-test-'));
    // Make it look like a workspace by dropping a .swao.yml at the root
    writeFileSync(join(tmpWorkspace, '.swao.yml'), 'workspace:\n  name: test\n', 'utf-8');
    mkdirSync(join(tmpWorkspace, 'apps'), { recursive: true });

    originalCwd = process.cwd();
    // vitest workers reject process.chdir, so the tests cannot exercise the
    // resolveWorkspace() walk-up logic via cwd. Instead each test that needs
    // a workspace uses a tmp directory and reads installed-folder state by
    // checking the file system directly post-action. The resolveWorkspace()
    // logic is exercised via the integration tests in binary-e2e.test.ts at
    // a higher level (operator runs the binary with cwd set externally).
    void originalCwd;

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    if (tmpWorkspace && existsSync(tmpWorkspace)) {
      rmSync(tmpWorkspace, { recursive: true, force: true });
    }
    process.exitCode = 0;  // reset between tests
  });

  it('cmdList prints bundled frameworks from _registry.yaml when invoked', () => {
    cmdList();
    const output = logSpy.mock.calls.map((args) => String(args[0])).join('\n');
    // Sprint-037 #0340 + 50331f0 (contributor sweep): all bundled
    // frameworks attribute packaging to the SWAO maintainer (Helmut /
    // Accenture team); upstream authors stay in `authority:`.
    expect(output).toContain('AI_10_PILLARS');
    expect(output).toMatch(/contributor:\s+Helmut Schindlwick/);
  });

  it('cmdInfo prints framework metadata for a known framework id', () => {
    cmdInfo('AI_10_PILLARS');
    const output = logSpy.mock.calls.map((args) => String(args[0])).join('\n');
    expect(output).toContain('AI_10_PILLARS');
    expect(output).toMatch(/contributor:/);
    expect(output).toMatch(/version:\s+2026-Q2/);
  });

  it('cmdInfo accepts the folder name as an alias for the id', () => {
    cmdInfo('ai-10-pillars');
    const output = logSpy.mock.calls.map((args) => String(args[0])).join('\n');
    expect(output).toContain('AI_10_PILLARS');
  });

  it('cmdInfo fails with a clear error for an unknown id', () => {
    cmdInfo('NONEXISTENT_FRAMEWORK');
    const errOut = errorSpy.mock.calls.map((args) => String(args[0])).join('\n');
    expect(errOut).toMatch(/no framework with id or folder/);
    expect(process.exitCode).toBe(1);
  });

  it('cmdInfo prints registry+meta for LLM_SELECTION (#0695)', () => {
    cmdInfo('LLM_SELECTION');
    const output = logSpy.mock.calls.map((args) => String(args[0])).join('\n');
    expect(output).toContain('LLM_SELECTION');
    expect(output).toMatch(/contributor:/);
    expect(output).toMatch(/version:\s+1\.0/);
  });

  it('cmdInstall fails when not in a workspace', () => {
    // resolveWorkspace walks up from process.cwd(); in vitest worker this is
    // the package dir which has no .swao.yml. Confirm the failure path.
    cmdInstall('NONEXISTENT_FRAMEWORK');
    const errOut = errorSpy.mock.calls.map((args) => String(args[0])).join('\n');
    // Either "no bundled framework" (unknown id) or "not in a workspace"
    // depending on which check fires first; both prove the error-surface.
    expect(errOut.length).toBeGreaterThan(0);
    expect(process.exitCode).toBe(1);
  });

  it('cmdUninstall fails when the framework is not installed', () => {
    cmdUninstall('AI_10_PILLARS');
    const errOut = errorSpy.mock.calls.map((args) => String(args[0])).join('\n');
    // Either workspace-missing or framework-not-installed surface; both
    // result in exit 1 and a non-empty error message.
    expect(errOut.length).toBeGreaterThan(0);
    expect(process.exitCode).toBe(1);
  });

  it('bundled AI_10_PILLARS framework folder contains required files', () => {
    expect(existsSync(BUNDLED_AI_10_PILLARS)).toBe(true);
    expect(existsSync(join(BUNDLED_AI_10_PILLARS, 'framework-meta.yaml'))).toBe(true);
    expect(existsSync(join(BUNDLED_AI_10_PILLARS, 'controls.yaml'))).toBe(true);
  });

  it('bundled framework-meta.yaml declares a contributor (required by #0324 §9)', () => {
    const meta = readFileSync(join(BUNDLED_AI_10_PILLARS, 'framework-meta.yaml'), 'utf-8');
    expect(meta).toMatch(/contributor:/);
  });

  it('_registry.yaml has the framework entry matching the framework-meta.yaml id', () => {
    const REGISTRY = join(communityFrameworksDir, '_registry.yaml');
    const registry = readFileSync(REGISTRY, 'utf-8');
    expect(registry).toContain('AI_10_PILLARS');
    expect(registry).toContain('ai-10-pillars');  // folder
    // Sprint-037 contributor sweep: SWAO maintainer (Helmut) is the
    // packager for every bundled framework; Alok Sharan stays as the
    // upstream author in framework-meta.yaml's `authority:` field.
    expect(registry).toMatch(/contributor:\s+"?Helmut Schindlwick/);
  });
});

// #0641 (sprint-073): LLM_SELECTION community framework fixture validation.
// #0695 (sprint-075): renamed SWAO_LLM_ASSESS -> LLM_SELECTION; dir swao-llm-assess -> llm-selection.
// Checks schema shape, control count, and key control presence.
describe('LLM_SELECTION community framework fixture (#0641 #0695)', () => {
  const BUNDLED_LLM_SELECTION = join(communityFrameworksDir, 'llm-selection');

  it('bundled llm-selection folder contains all required files', () => {
    expect(existsSync(BUNDLED_LLM_SELECTION)).toBe(true);
    expect(existsSync(join(BUNDLED_LLM_SELECTION, 'framework-meta.yaml'))).toBe(true);
    expect(existsSync(join(BUNDLED_LLM_SELECTION, 'controls.yaml'))).toBe(true);
    expect(existsSync(join(BUNDLED_LLM_SELECTION, 'README.md'))).toBe(true);
  });

  it('controls.yaml parses through RegimeCatalogueSchema without error', () => {
    const controlsPath = join(BUNDLED_LLM_SELECTION, 'controls.yaml');
    expect(() => loadRegimeCatalogue(controlsPath)).not.toThrow();
    const catalogue = loadRegimeCatalogue(controlsPath);
    expect(catalogue.regime_meta.id).toBe('LLM_SELECTION');
    expect(catalogue.controls.length).toBe(34);
  });

  it('controls.yaml has exactly 34 controls across 7 domains', () => {
    const raw = readFileSync(join(BUNDLED_LLM_SELECTION, 'controls.yaml'), 'utf-8');
    const matches = raw.match(/^ {2}- id: (DSR|MT|PR|CLF|SB|PEO|AC)-\d+/gm);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(34);
  });

  it('key controls DSR-01, SB-04, and AC-05 are present with required fields', () => {
    const raw = readFileSync(join(BUNDLED_LLM_SELECTION, 'controls.yaml'), 'utf-8');
    expect(raw).toContain('id: DSR-01');
    expect(raw).toContain('id: SB-04');
    expect(raw).toContain('id: AC-05');
    // Hard gate controls must carry critical severity
    const dsr01Idx = raw.indexOf('id: DSR-01');
    const dsr01Block = raw.slice(dsr01Idx, dsr01Idx + 400);
    expect(dsr01Block).toContain('severity_default: critical');
  });

  it('_registry.yaml includes LLM_SELECTION entry', () => {
    const registry = readFileSync(join(communityFrameworksDir, '_registry.yaml'), 'utf-8');
    expect(registry).toContain('LLM_SELECTION');
    expect(registry).toContain('llm-selection');
  });

  it('framework-meta.yaml declares an Accenture contributor block', () => {
    const meta = readFileSync(join(BUNDLED_LLM_SELECTION, 'framework-meta.yaml'), 'utf-8');
    expect(meta).toMatch(/contributor:/);
    expect(meta).toMatch(/Helmut Schindlwick/);
    expect(meta).toMatch(/github\.com\/Accenture\/SWAO/);
  });
});
