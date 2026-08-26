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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { findWorkspace, saveDefaultWorkspace } from '@swao/core';

const GLOBAL_CONFIG = join(homedir(), '.config', 'swao', 'config.json');

// #0137: workspace resolution must fall back to the global-config
// default_workspace when the CWD is unrelated to any workspace, so the
// binary can be launched from dist-bin/ or %USERPROFILE% without crashing
// the assess/report screens with "App directory not found".

describe('findWorkspace (#0137)', () => {
  let tmp: string;
  let unrelatedDir: string;
  let workspaceDir: string;
  let savedConfig: string | null = null;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-workspace-'));
    unrelatedDir = join(tmp, 'unrelated');
    workspaceDir = join(tmp, 'real-workspace');
    mkdirSync(unrelatedDir, { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(join(workspaceDir, '.swao.yml'), 'engagement: test\n', 'utf-8');

    // Stash any existing global config so the user's real setup is preserved.
    if (existsSync(GLOBAL_CONFIG)) {
      savedConfig = readFileSync(GLOBAL_CONFIG, 'utf-8');
    } else {
      savedConfig = null;
    }
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    if (savedConfig !== null) {
      writeFileSync(GLOBAL_CONFIG, savedConfig, 'utf-8');
    } else if (existsSync(GLOBAL_CONFIG)) {
      rmSync(GLOBAL_CONFIG, { force: true });
    }
  });

  it('walks up from startDir when .swao.yml is on the path', () => {
    const nested = join(workspaceDir, 'deep', 'nesting');
    mkdirSync(nested, { recursive: true });
    expect(findWorkspace(nested)).toBe(workspaceDir);
  });

  it('returns null when no .swao.yml above startDir AND no global config', () => {
    if (existsSync(GLOBAL_CONFIG)) {
      rmSync(GLOBAL_CONFIG, { force: true });
    }
    expect(findWorkspace(unrelatedDir)).toBeNull();
  });

  it('returns the global-config default_workspace when called from an unrelated directory', () => {
    saveDefaultWorkspace(workspaceDir);
    expect(findWorkspace(unrelatedDir)).toBe(workspaceDir);
  });

  it('ignores the global config when its default_workspace no longer exists', () => {
    saveDefaultWorkspace(workspaceDir);
    rmSync(workspaceDir, { recursive: true, force: true });
    expect(findWorkspace(unrelatedDir)).toBeNull();
  });

  it('survives a corrupt global config file (does not throw)', () => {
    mkdirSync(join(homedir(), '.config', 'swao'), { recursive: true });
    writeFileSync(GLOBAL_CONFIG, '{ not valid json', 'utf-8');
    expect(() => findWorkspace(unrelatedDir)).not.toThrow();
    expect(findWorkspace(unrelatedDir)).toBeNull();
  });
});
