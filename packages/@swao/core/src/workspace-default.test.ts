// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4392: the saved default workspace (~/.config/swao/config.json) follows the
// HOME / USERPROFILE of the moment (no path fixed at import), and the change
// line names the old and the new path.

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultWorkspaceChangeLine,
  defaultWorkspaceConfigPath,
  readDefaultWorkspace,
  readSavedDefaultWorkspacePath,
  saveDefaultWorkspace,
} from './workspace.js';

const saved = { HOME: process.env['HOME'], USERPROFILE: process.env['USERPROFILE'] };
const made: string[] = [];
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  while (made.length) { try { rmSync(made.pop()!, { recursive: true, force: true }); } catch { /* Windows lock */ } }
});

function pointProfileAtTemp(): string {
  const home = mkdtempSync(join(tmpdir(), 'swao-4392-home-'));
  made.push(home);
  process.env['HOME'] = home;
  process.env['USERPROFILE'] = home;
  return home;
}

describe('#4392 saved default workspace', () => {
  it('the config path is resolved per call, so a profile redirected after import is honoured', () => {
    const home = pointProfileAtTemp();
    expect(defaultWorkspaceConfigPath()).toBe(join(home, '.config', 'swao', 'config.json'));
    const ws = mkdtempSync(join(tmpdir(), 'swao-4392-ws-'));
    made.push(ws);
    saveDefaultWorkspace(ws);
    expect(existsSync(join(home, '.config', 'swao', 'config.json'))).toBe(true);
    expect(readDefaultWorkspace()).toBe(ws);
    expect(readSavedDefaultWorkspacePath()).toBe(ws);
  });

  it('the raw read keeps a saved path whose folder is gone; readDefaultWorkspace drops it', () => {
    pointProfileAtTemp();
    const gone = join(tmpdir(), 'swao-4392-gone-folder-that-does-not-exist');
    saveDefaultWorkspace(gone);
    expect(readSavedDefaultWorkspacePath()).toBe(gone);
    expect(readDefaultWorkspace()).toBeNull();
  });

  it('the change line names old and new path, and is null when nothing changes', () => {
    expect(defaultWorkspaceChangeLine(null, '/ws/new')).toBe('Saved default workspace changed: (none) -> /ws/new');
    expect(defaultWorkspaceChangeLine('/ws/old', '/ws/new')).toBe('Saved default workspace changed: /ws/old -> /ws/new');
    expect(defaultWorkspaceChangeLine('/ws/same', '/ws/same')).toBeNull();
  });
});
