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

// #4392: `swao init` prints when it changes the saved default workspace (old
// path to new path), and `--no-save-default` leaves it as it is. Every test
// points HOME and USERPROFILE at its own temporary profile (the config path is
// resolved per call), so the real ~/.config/swao/config.json is never written,
// also not with SWAO_TEST_KEEP_HOME set.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { defaultWorkspaceConfigPath, readSavedDefaultWorkspacePath, saveDefaultWorkspace } from '@swao/core';
import { registerInit, saveDefaultWorkspaceStep } from './init.js';

const made: string[] = [];
const savedProfile = { HOME: process.env['HOME'], USERPROFILE: process.env['USERPROFILE'] };
beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), 'swao-test-home-4392-'));
  made.push(home);
  process.env['HOME'] = home;
  process.env['USERPROFILE'] = home;
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(savedProfile)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  while (made.length) { try { rmSync(made.pop()!, { recursive: true, force: true }); } catch { /* Windows lock */ } }
});
const tempDir = (prefix: string): string => { const d = mkdtempSync(join(tmpdir(), prefix)); made.push(d); return d; };

describe('#4392 saved default workspace in swao init', () => {
  it('the test profile is a temporary one: the config lives under it, not under the real home', () => {
    expect(homedir()).toContain('swao-test-home-4392-');
    expect(defaultWorkspaceConfigPath().startsWith(homedir())).toBe(true);
  });

  it('prints old path to new path when the saved default changes, nothing when it stays', () => {
    const a = tempDir('swao-4392-a-');
    const b = tempDir('swao-4392-b-');
    saveDefaultWorkspace(a);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    saveDefaultWorkspaceStep(b, true);
    expect(log.mock.calls.flat().join('\n')).toContain(`Saved default workspace changed: ${a} -> ${b}`);
    expect(readSavedDefaultWorkspacePath()).toBe(b);
    log.mockClear();
    saveDefaultWorkspaceStep(b, true);
    expect(log).not.toHaveBeenCalled();
  });

  it('--no-save-default (save false) leaves the saved default unchanged and says so', () => {
    const a = tempDir('swao-4392-keep-');
    const b = tempDir('swao-4392-other-');
    saveDefaultWorkspace(a);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    saveDefaultWorkspaceStep(b, false);
    expect(readSavedDefaultWorkspacePath()).toBe(a);
    expect(log.mock.calls.flat().join('\n')).toContain(`Saved default workspace left unchanged (--no-save-default): ${a}`);
  });

  it('swao init offers --no-save-default (commander: saveDefault false)', () => {
    const program = new Command();
    registerInit(program);
    const init = program.commands.find((c) => c.name() === 'init')!;
    expect(init.options.some((o) => o.long === '--no-save-default')).toBe(true);
    init.parseOptions(['--no-save-default']);
    expect(init.opts()['saveDefault']).toBe(false);
  });
});
