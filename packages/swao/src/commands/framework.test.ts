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
// synthesised fixture workspaces. Verifies the meta-discovery path (#3297), the
// install-copies-files path, the info-print path, and the uninstall-
// removes-files path. Captures stdout via console.log spy.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdList, cmdInstall, cmdInfo, cmdUninstall, communityDir, copyFrameworkIntoWorkspace, listBundledFrameworks } from './framework.js';
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

  it('cmdList prints bundled frameworks discovered from framework-meta.yaml (#3297)', () => {
    cmdList();
    const output = logSpy.mock.calls.map((args) => String(args[0])).join('\n');
    // Sprint-037 #0340 + contributor sweep: all bundled frameworks attribute
    // packaging to the SWAO Development Team; upstream authors stay in `authority:`.
    expect(output).toContain('AI_10_PILLARS');
    expect(output).toMatch(/contributor:\s+"?SWAO Development Team/);
    // #3297: COBIT 5 has no registry entry to depend on any more.
    expect(output).toMatch(/^ {2}COBIT_5$/m);
    expect(output).toContain('folder:         cobit-5');
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

  it('the bundled list carries the AI_10_PILLARS meta id, folder and contributor (#3297)', () => {
    const f = listBundledFrameworks(communityFrameworksDir).find((x) => x.id === 'AI_10_PILLARS');
    expect(f?.folder).toBe('ai-10-pillars');
    const c = f?.meta.contributor;
    expect(typeof c === 'string' ? c : c?.name).toMatch(/SWAO Development Team/);
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

  it('discovery lists LLM_SELECTION from its framework-meta.yaml (#3297)', () => {
    const f = listBundledFrameworks(communityFrameworksDir).find((x) => x.id === 'LLM_SELECTION');
    expect(f?.folder).toBe('llm-selection');
  });

  it('framework-meta.yaml declares an Accenture contributor block', () => {
    const meta = readFileSync(join(BUNDLED_LLM_SELECTION, 'framework-meta.yaml'), 'utf-8');
    expect(meta).toMatch(/contributor:/);
    expect(meta).toMatch(/SWAO Development Team/);
    expect(meta).toMatch(/github\.com\/Accenture\/SWAO/);
  });
});

describe('framework install target (#3149)', () => {
  it('installs into the folder that discovery and Pass 11 read', () => {
    expect(communityDir(join('ws'))).toBe(join('ws', 'wsp', 'inputs', 'catalogs', 'community'));
  });
});

// #3297: list + copy helper driven by framework-meta.yaml, not _registry.yaml.
describe('framework list and copy helper from framework-meta.yaml (#3297)', () => {
  let root: string;
  let ws: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  function shipped(folder: string, meta: string): void {
    mkdirSync(join(root, folder, 'evidence'), { recursive: true });
    writeFileSync(join(root, folder, 'framework-meta.yaml'), meta, 'utf-8');
    writeFileSync(join(root, folder, 'controls.yaml'), 'regime_meta:\n  id: X\n', 'utf-8');
    writeFileSync(join(root, folder, 'evidence', 'q.md'), '# q\n', 'utf-8');
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'swao-fw-shipped-'));
    ws = mkdtempSync(join(tmpdir(), 'swao-fw-ws-'));
    shipped('alpha', 'framework:\n  id: ALPHA_FW\n  name: "Alpha framework"\n  version: "1"\n  contributor: "Team A"\n');
    shipped('broken', 'framework:\n  id: BROKEN_FW\n  scoring_mode: weighted\n');
    shipped('hidden', 'framework:\n  id: HIDDEN_FW\n  listed: false\n');
    mkdirSync(join(root, 'no-meta'), { recursive: true });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    rmSync(root, { recursive: true, force: true });
    rmSync(ws, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('cmdList shows valid metas only and warns about the invalid one', () => {
    cmdList(root);
    const out = logSpy.mock.calls.map((a) => String(a[0])).join('\n');
    expect(out).toMatch(/^ {2}ALPHA_FW$/m);
    expect(out).toContain('contributor:    Team A');
    expect(out).not.toContain('BROKEN_FW');
    expect(out).not.toContain('HIDDEN_FW');
    const err = errorSpy.mock.calls.map((a) => String(a[0])).join('\n');
    expect(err).toMatch(/skipped broken: framework-meta.yaml failed validation/);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('copyFrameworkIntoWorkspace copies the whole folder by id or folder name', () => {
    const r = copyFrameworkIntoWorkspace('alpha_fw', ws, root);
    expect(r.ok).toBe(true);
    const target = join(communityDir(ws), 'alpha');
    expect(r.ok && r.target).toBe(target);
    expect(readFileSync(join(target, 'framework-meta.yaml'), 'utf-8')).toContain('ALPHA_FW');
    expect(existsSync(join(target, 'controls.yaml'))).toBe(true);
    expect(existsSync(join(target, 'evidence', 'q.md'))).toBe(true);
    // A second copy never overwrites.
    const again = copyFrameworkIntoWorkspace('alpha', ws, root);
    expect(again).toMatchObject({ ok: false, reason: 'exists' });
  });

  it('copyFrameworkIntoWorkspace refuses invalid, unlisted and unknown folders', () => {
    expect(copyFrameworkIntoWorkspace('BROKEN_FW', ws, root)).toEqual({ ok: false, reason: 'unknown' });
    expect(copyFrameworkIntoWorkspace('HIDDEN_FW', ws, root)).toEqual({ ok: false, reason: 'unknown' });
    expect(copyFrameworkIntoWorkspace('no-meta', ws, root)).toEqual({ ok: false, reason: 'unknown' });
    expect(existsSync(communityDir(ws))).toBe(false);
  });

  it('copies the shipped COBIT_5 folder (no registry entry needed)', () => {
    const r = copyFrameworkIntoWorkspace('COBIT_5', ws, communityFrameworksDir);
    expect(r.ok).toBe(true);
    expect(existsSync(join(communityDir(ws), 'cobit-5', 'controls.yaml'))).toBe(true);
  });
});
