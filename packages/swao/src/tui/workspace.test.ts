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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findWorkspace } from '@swao/core';

// #0137 / #2185: workspace resolution walks up the directory tree only.
// The global-config fallback was removed (#2185) -- it silently routed
// operations to stale workspaces when the cwd was uninitialised.

describe('findWorkspace (#0137)', () => {
  let tmp: string;
  let unrelatedDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-workspace-'));
    unrelatedDir = join(tmp, 'unrelated');
    workspaceDir = join(tmp, 'real-workspace');
    mkdirSync(unrelatedDir, { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(join(workspaceDir, '.swao.yml'), 'engagement: test\n', 'utf-8');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('walks up from startDir when .swao.yml is on the path', () => {
    const nested = join(workspaceDir, 'deep', 'nesting');
    mkdirSync(nested, { recursive: true });
    expect(findWorkspace(nested)).toBe(workspaceDir);
  });

  it('returns null when no .swao.yml above startDir (#2185: no global-config fallback)', () => {
    expect(findWorkspace(unrelatedDir)).toBeNull();
  });
});
