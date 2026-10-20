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

// #3163: single Claude Desktop config resolver. Every test builds a sandbox
// APPDATA / LOCALAPPDATA / home under the OS temp dir and passes it explicitly,
// so no test reads or writes the operator's real Claude Desktop configs.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  resolveClaudeDesktopConfigs,
  claudeDesktopConfigPath,
  claudeDesktopConfigHasSwaoEntry,
  selectClaudeDesktopPatchTargets,
  findSwaoServerKey,
  isSwaoServerEntry,
} from './claude-desktop-config.js';

let root: string;
let env: Record<string, string | undefined>;

function msixDir(): string {
  return join(root, 'Local', 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude');
}
function conventionalDir(): string {
  return join(root, 'Roaming', 'Claude');
}
function writeCfg(dir: string, servers: Record<string, unknown>): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'claude_desktop_config.json');
  writeFileSync(p, JSON.stringify({ mcpServers: servers }), 'utf-8');
  return p;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'swao-claude-cfg-'));
  env = { APPDATA: join(root, 'Roaming'), LOCALAPPDATA: join(root, 'Local') };
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('resolveClaudeDesktopConfigs (#3163)', () => {
  it('Windows without MSIX: only the conventional config, effective', () => {
    const c = resolveClaudeDesktopConfigs({ platform: 'win32', env, home: root });
    expect(c).toEqual([{ path: join(conventionalDir(), 'claude_desktop_config.json'), kind: 'conventional', effective: true }]);
  });

  it('Windows with an MSIX folder: MSIX effective first, conventional still listed', () => {
    mkdirSync(msixDir(), { recursive: true });
    const c = resolveClaudeDesktopConfigs({ platform: 'win32', env, home: root });
    expect(c.map((x) => [x.kind, x.effective])).toEqual([['msix', true], ['conventional', false]]);
    expect(c[0]!.path).toBe(join(msixDir(), 'claude_desktop_config.json'));
    expect(claudeDesktopConfigPath({ platform: 'win32', env, home: root })).toBe(c[0]!.path);
  });

  it('ignores a Claude_ package folder Claude Desktop has never run in', () => {
    mkdirSync(join(root, 'Local', 'Packages', 'Claude_pzs8sxrjxfjjc'), { recursive: true });
    const c = resolveClaudeDesktopConfigs({ platform: 'win32', env, home: root });
    expect(c.map((x) => x.kind)).toEqual(['conventional']);
  });

  it('falls back to <home>/AppData/Roaming when APPDATA is unset', () => {
    const c = resolveClaudeDesktopConfigs({ platform: 'win32', env: {}, home: root });
    expect(c[0]!.path).toBe(join(root, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'));
  });

  it('macOS and Linux: one conventional config', () => {
    expect(resolveClaudeDesktopConfigs({ platform: 'darwin', env, home: root })[0]!.path)
      .toBe(join(root, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'));
    expect(resolveClaudeDesktopConfigs({ platform: 'linux', env, home: root })[0]!.path)
      .toBe(join(root, '.config', 'Claude', 'claude_desktop_config.json'));
  });
});

describe('selectClaudeDesktopPatchTargets (#3163)', () => {
  it('both configs hold SWAO entries: both are targets', () => {
    writeCfg(msixDir(), { swao: { command: 'C:\\swao\\v1.4.0\\swao-enterprise-win-x64.exe' } });
    writeCfg(conventionalDir(), { swao: { command: 'C:\\swao\\v1.2.1\\swao-enterprise-win-x64.exe' } });
    const t = selectClaudeDesktopPatchTargets(resolveClaudeDesktopConfigs({ platform: 'win32', env, home: root }));
    expect(t.map((x) => x.kind)).toEqual(['msix', 'conventional']);
  });

  it('MSIX effective, conventional absent: only MSIX', () => {
    mkdirSync(msixDir(), { recursive: true });
    const t = selectClaudeDesktopPatchTargets(resolveClaudeDesktopConfigs({ platform: 'win32', env, home: root }));
    expect(t.map((x) => x.kind)).toEqual(['msix']);
  });

  it('MSIX effective, conventional without a SWAO entry: conventional is not a target', () => {
    mkdirSync(msixDir(), { recursive: true });
    writeCfg(conventionalDir(), { other: { command: 'C:\\tools\\other.exe' } });
    const t = selectClaudeDesktopPatchTargets(resolveClaudeDesktopConfigs({ platform: 'win32', env, home: root }));
    expect(t.map((x) => x.kind)).toEqual(['msix']);
  });

  it('MSIX effective, conventional holds a node-registered SWAO entry: both are targets (#3295)', () => {
    mkdirSync(msixDir(), { recursive: true });
    writeCfg(conventionalDir(), {
      'swao-dev': { command: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\repo\\swao\\packages\\swao\\dist\\index.js', 'mcp'] },
    });
    const t = selectClaudeDesktopPatchTargets(resolveClaudeDesktopConfigs({ platform: 'win32', env, home: root }));
    expect(t.map((x) => x.kind)).toEqual(['msix', 'conventional']);
  });

  it('no MSIX: the conventional config is the effective target even without an entry', () => {
    const t = selectClaudeDesktopPatchTargets(resolveClaudeDesktopConfigs({ platform: 'win32', env, home: root }));
    expect(t.map((x) => [x.kind, x.effective])).toEqual([['conventional', true]]);
  });
});

describe('SWAO entry detection (#3163)', () => {
  it('findSwaoServerKey matches tier-named binaries under any key', () => {
    expect(findSwaoServerKey({ a: { command: '/x/other' }, 'swao-mcp': { command: '/opt/swao-enterprise-linux-x64' } })).toBe('swao-mcp');
    expect(findSwaoServerKey({ a: { command: 'node' }, b: null })).toBeUndefined();
  });

  it('findSwaoServerKey matches a node-registered source run under any key (#3295)', () => {
    const winNode = { command: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\repo\\swao\\packages\\swao\\dist\\index.js', 'mcp'] };
    expect(findSwaoServerKey({ other: { command: 'C:\\tools\\other.exe' }, 'my-swao': winNode })).toBe('my-swao');
    const posixBundle = { command: '/usr/local/bin/node', args: ['/opt/swao/swao-enterprise.cjs', 'mcp'] };
    expect(findSwaoServerKey({ dev: posixBundle })).toBe('dev');
    expect(findSwaoServerKey({ dev: { command: 'node', args: ['/opt/swao/swao.js', 'mcp', '--http'] } })).toBe('dev');
  });

  it('isSwaoServerEntry rejects node entries whose first argument is not a SWAO script (#3295)', () => {
    expect(isSwaoServerEntry({ command: '/usr/bin/node', args: ['/opt/other-mcp/dist/index.js'] })).toBe(false);
    expect(isSwaoServerEntry({ command: '/usr/bin/node', args: ['mcp', '/repo/packages/swao/dist/index.js'] })).toBe(false);
    expect(isSwaoServerEntry({ command: '/usr/bin/node' })).toBe(false);
    expect(isSwaoServerEntry({ command: '/usr/bin/nodemon', args: ['/repo/packages/swao/dist/index.js'] })).toBe(false);
    expect(isSwaoServerEntry({ command: 'C:\\swao\\swao-enterprise-win-x64.exe', args: ['mcp'] })).toBe(true);
    expect(isSwaoServerEntry(null)).toBe(false);
  });

  it('claudeDesktopConfigHasSwaoEntry is false for missing or unparseable files', () => {
    expect(claudeDesktopConfigHasSwaoEntry(join(root, 'nope.json'))).toBe(false);
    mkdirSync(conventionalDir(), { recursive: true });
    const bad = join(conventionalDir(), 'claude_desktop_config.json');
    writeFileSync(bad, '{ not json', 'utf-8');
    expect(claudeDesktopConfigHasSwaoEntry(bad)).toBe(false);
  });
});
