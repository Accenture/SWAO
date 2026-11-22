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
// Tests the Community Frameworks command surface against synthesised fixture
// workspaces. Since #4126 `swao framework list` is the only subcommand: it lists
// the frameworks of the workspace (meta discovery, #3297) and points to the
// GitHub repository for more. Captures stdout via console.log spy.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { cmdList, communityDir, registerFramework, COMMUNITY_FRAMEWORKS_URL } from './framework.js';
import { communityFrameworksDir } from '@swao/community-frameworks';
import { discoverFrameworks, loadRegimeCatalogue } from '@swao/core';

const listBundledFrameworks = (root: string) => discoverFrameworks(root, { warn: () => {} });

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

  it('cmdList prints the frameworks of the workspace and where to get more (#4126)', () => {
    const target = join(communityDir(tmpWorkspace), 'ai-10-pillars');
    cpSync(BUNDLED_AI_10_PILLARS, target, { recursive: true });
    cmdList(tmpWorkspace);
    const output = logSpy.mock.calls.map((args) => String(args[0])).join('\n');
    expect(output).toContain('Community frameworks in this workspace');
    expect(output).toMatch(/^ {2}AI_10_PILLARS$/m);
    expect(output).toMatch(/contributor:\s+"?SWAO Development Team/);
    expect(output).toContain('folder:         ai-10-pillars');
    // Only the workspace copy, not the frameworks the binary ships.
    expect(output).not.toMatch(/^ {2}COBIT_5$/m);
    expect(output).toContain(COMMUNITY_FRAMEWORKS_URL);
  });

  it('cmdList on an empty workspace says so and points to the GitHub repository (#4126)', () => {
    cmdList(tmpWorkspace);
    const output = logSpy.mock.calls.map((args) => String(args[0])).join('\n');
    expect(output).toMatch(/No community frameworks in this workspace/);
    expect(output).toContain(COMMUNITY_FRAMEWORKS_URL);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('cmdList outside a workspace points to the GitHub repository (#4126)', () => {
    cmdList(null);
    const output = logSpy.mock.calls.map((args) => String(args[0])).join('\n');
    expect(output).toMatch(/not in a workspace/);
    expect(output).toContain(COMMUNITY_FRAMEWORKS_URL);
  });

  it('swao framework --help offers list only; install, uninstall, info and baseline are removed (#4126)', () => {
    const program = new Command();
    registerFramework(program);
    const fw = program.commands.find((c) => c.name() === 'framework');
    expect(fw?.commands.map((c) => c.name())).toEqual(['list']);
    const help = fw?.helpInformation() ?? '';
    expect(help).not.toMatch(/\b(install|uninstall|info|baseline)\b/);
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

describe('framework list target (#3149)', () => {
  it('lists the folder that discovery and Pass 11 read', () => {
    expect(communityDir(join('ws'))).toBe(join('ws', 'wsp', 'inputs', 'catalogs', 'community'));
  });
});

// #3297: the list is driven by framework-meta.yaml, not _registry.yaml.
describe('framework list from framework-meta.yaml (#3297)', () => {
  let ws: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  function inWorkspace(folder: string, meta: string): void {
    const root = communityDir(ws);
    mkdirSync(join(root, folder), { recursive: true });
    writeFileSync(join(root, folder, 'framework-meta.yaml'), meta, 'utf-8');
    writeFileSync(join(root, folder, 'controls.yaml'), 'regime_meta:\n  id: X\n', 'utf-8');
  }

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'swao-fw-ws-'));
    inWorkspace('alpha', 'framework:\n  id: ALPHA_FW\n  name: "Alpha framework"\n  version: "1"\n  contributor: "Team A"\n');
    inWorkspace('broken', 'framework:\n  id: BROKEN_FW\n  scoring_mode: weighted\n');
    mkdirSync(join(communityDir(ws), 'no-meta'), { recursive: true });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    rmSync(ws, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('cmdList shows valid metas, names folders without a valid meta and warns about the invalid one', () => {
    cmdList(ws);
    const out = logSpy.mock.calls.map((a) => String(a[0])).join('\n');
    expect(out).toMatch(/^ {2}ALPHA_FW$/m);
    expect(out).toContain('contributor:    Team A');
    expect(out).not.toContain('BROKEN_FW');
    expect(out).toMatch(/Folders without a valid framework-meta.yaml[\s\S]*broken[\s\S]*no-meta/);
    const err = errorSpy.mock.calls.map((a) => String(a[0])).join('\n');
    expect(err).toMatch(/skipped broken: framework-meta.yaml failed validation/);
    expect(process.exitCode ?? 0).toBe(0);
  });
});
