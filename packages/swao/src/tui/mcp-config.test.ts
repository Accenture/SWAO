// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI + orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3163: these tests use a real filesystem sandbox instead of vi.mock('fs'):
// the multi-config resolver lives in @swao/core, outside this module's mocked
// fs. APPDATA, LOCALAPPDATA, HOME and USERPROFILE point at a temp dir for the
// whole file, so nothing here can read or write the operator's real Claude
// Desktop configs (feedback-binary-e2e-sandbox).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import { resolveClaudeDesktopConfigs } from '@swao/core';
import { registerMcp } from '@swao/module-mcp';
import {
  patchClaudeDesktopConfig,
  patchAllClaudeDesktopConfigs,
  resolveStableBinary,
  buildMcpInstallDeps,
  stableBinaryName,
  stableCopyWarning,
  STABLE_BINARY_NAME,
  binaryNameTier,
  mcpRegistrationRefusal,
  formatMcpRegistrationRefusal,
} from './mcp-config.js';
import { LicenseTierError, LicenseInvalidError } from '@swao/core';
import { runInitMcp } from '../commands/init.js';

const BINARY = 'C:\\swao\\test-9.5\\swao-enterprise-win.exe';

// #3341: SWAO_BINARY_TIER pinned to enterprise so un-tiered binary names resolve deterministically.
const ENV_KEYS = ['APPDATA', 'LOCALAPPDATA', 'HOME', 'USERPROFILE', 'SWAO_BINARY_TIER'] as const;
// #3341: tests never read the operator's real licence.
const ALLOW = { loadGuard: () => ({ requireFeature: () => {} }) };
let saved: Record<string, string | undefined>;
let root: string;
let CONFIG: string;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  root = mkdtempSync(join(tmpdir(), 'swao-mcp-config-'));
  process.env['APPDATA'] = join(root, 'Roaming');
  process.env['LOCALAPPDATA'] = join(root, 'Local');
  process.env['HOME'] = root;
  process.env['USERPROFILE'] = root;
  process.env['SWAO_BINARY_TIER'] = 'enterprise';
  CONFIG = join(root, 'Roaming', 'Claude', 'claude_desktop_config.json');
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(root, { recursive: true, force: true });
});

function writeConfig(path: string, obj: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(obj), 'utf-8');
}

function readServers(path: string): Record<string, { command: string }> {
  return (JSON.parse(readFileSync(path, 'utf-8')) as { mcpServers: Record<string, { command: string }> }).mcpServers;
}

describe('patchClaudeDesktopConfig', () => {
  it('creates a new config with key "swao" when no file exists', () => {
    const result = patchClaudeDesktopConfig(CONFIG, BINARY);

    expect(result).toBe('patched');
    expect(readServers(CONFIG)['swao']?.command).toBe(BINARY);
  });

  it('returns already_present when the existing entry already points to binaryPath', () => {
    writeConfig(CONFIG, { mcpServers: { swao: { command: BINARY, args: ['mcp'] } } });
    const before = readFileSync(CONFIG, 'utf-8');
    const mtime = statSync(CONFIG).mtimeMs;

    const result = patchClaudeDesktopConfig(CONFIG, BINARY);

    expect(result).toBe('already_present');
    expect(readFileSync(CONFIG, 'utf-8')).toBe(before);
    expect(statSync(CONFIG).mtimeMs).toBe(mtime);
  });

  it('updates existing swao-mcp entry in-place, preserving the key name', () => {
    const oldBinary = 'C:\\swao\\test-8.2\\swao-enterprise-win-x64.exe';
    writeConfig(CONFIG, { mcpServers: { 'swao-mcp': { command: oldBinary, args: ['mcp'] } } });

    const result = patchClaudeDesktopConfig(CONFIG, BINARY);

    expect(result).toBe('patched');
    const servers = readServers(CONFIG);
    expect(servers).toHaveProperty('swao-mcp');
    expect(servers).not.toHaveProperty('swao');
    expect(servers['swao-mcp']?.command).toBe(BINARY);
  });

  it('adds new "swao" key when no existing swao binary entry is found', () => {
    writeConfig(CONFIG, { mcpServers: { 'other-tool': { command: '/path/to/other.exe', args: ['start'] } } });

    const result = patchClaudeDesktopConfig(CONFIG, 'C:\\swao\\swao-enterprise-win.exe');

    expect(result).toBe('patched');
    const servers = readServers(CONFIG);
    expect(servers).toHaveProperty('swao');
    expect(servers).toHaveProperty('other-tool');
  });

  it('detects existing win-x64.exe entry and updates it in-place', () => {
    const oldBinary = 'C:\\swao\\rc-1\\swao-enterprise-win-x64.exe';
    writeConfig(CONFIG, { mcpServers: { 'swao': { command: oldBinary, args: ['mcp'] } } });
    const newBinary = 'C:\\swao\\rc-2\\swao-enterprise-win-x64.exe';

    const result = patchClaudeDesktopConfig(CONFIG, newBinary);

    expect(result).toBe('patched');
    expect(readServers(CONFIG)['swao']?.command).toBe(newBinary);
  });

  it('recognises linux binary names', () => {
    writeConfig(CONFIG, { mcpServers: { 'swao': { command: '/old/swao-linux-x64', args: ['mcp'] } } });

    const result = patchClaudeDesktopConfig(CONFIG, '/new/swao-linux-x64');

    expect(result).toBe('patched');
    expect(readServers(CONFIG)['swao']?.command).toBe('/new/swao-linux-x64');
  });

  // CI audit gate: SWAO_BIN_RE must match every actual release binary filename (#2713).
  // Tier-named Unix binaries (swao-enterprise-linux-x64) were not covered by the
  // previous regex and would not be detected as existing SWAO entries.
  it.each([
    ['swao-community-win-x64.exe',   'C:\\swao\\rc-1\\swao-community-win-x64.exe'],
    ['swao-consultant-win-x64.exe',  'C:\\swao\\rc-1\\swao-consultant-win-x64.exe'],
    ['swao-enterprise-linux-x64',    '/opt/swao/swao-enterprise-linux-x64'],
    ['swao-community-linux-x64',     '/opt/swao/swao-community-linux-x64'],
    ['swao-consultant-linux-x64',    '/opt/swao/swao-consultant-linux-x64'],
    ['swao-enterprise-macos-x64',    '/Applications/swao-enterprise-macos-x64'],
    ['swao-community-macos-x64',     '/Applications/swao-community-macos-x64'],
    ['swao-enterprise-macos-arm64',  '/Applications/swao-enterprise-macos-arm64'],
  ])('detects existing %s entry and updates it in-place', (_name, oldBinary) => {
    writeConfig(CONFIG, { mcpServers: { 'swao': { command: oldBinary, args: ['mcp'] } } });
    const newBinary = 'C:\\swao\\rc-2\\swao-enterprise-win-x64.exe';

    const result = patchClaudeDesktopConfig(CONFIG, newBinary);

    expect(result).toBe('patched');
    expect(readServers(CONFIG)['swao']?.command).toBe(newBinary);
  });

  it('returns error when the config cannot be written', () => {
    // The parent "directory" is a regular file, so mkdir/write must fail.
    const blocker = join(root, 'blocker');
    writeFileSync(blocker, 'not a directory', 'utf-8');

    const result = patchClaudeDesktopConfig(join(blocker, 'claude_desktop_config.json'), BINARY);

    expect(result).toBe('error');
  });

  it('leaves an unparsable config untouched and returns error (F-14)', () => {
    mkdirSync(dirname(CONFIG), { recursive: true });
    const original = '{\n  // operator comment\n  "mcpServers": { "other": { "command": "x" } },\n}\n';
    writeFileSync(CONFIG, original, 'utf-8');

    expect(patchClaudeDesktopConfig(CONFIG, BINARY)).toBe('error');
    expect(readFileSync(CONFIG, 'utf-8')).toBe(original);
  });

  it('leaves a config whose root is not an object untouched and returns error (F-14)', () => {
    mkdirSync(dirname(CONFIG), { recursive: true });
    writeFileSync(CONFIG, '[1, 2]\n', 'utf-8');

    expect(patchClaudeDesktopConfig(CONFIG, BINARY)).toBe('error');
    expect(readFileSync(CONFIG, 'utf-8')).toBe('[1, 2]\n');
  });

  it('patches exactly the path it is given, even when an MSIX config folder exists (#3163)', () => {
    mkdirSync(join(root, 'Local', 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude'), { recursive: true });

    expect(patchClaudeDesktopConfig(CONFIG, BINARY)).toBe('patched');

    expect(readServers(CONFIG)['swao']?.command).toBe(BINARY);
    expect(existsSync(join(root, 'Local', 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #3163: every Claude Desktop config (MSIX virtualised + conventional)
// ---------------------------------------------------------------------------

describe('patchAllClaudeDesktopConfigs (#3163)', () => {
  const NEW = 'C:\\swao\\swao-v1.4.0\\swao-enterprise-win-x64.exe';
  const STALE_A = 'C:\\swao\\swao-v1.3.0\\swao-enterprise-win-x64.exe';
  const STALE_B = 'C:\\swao\\swao-v1.2.1\\swao-enterprise-win-x64.exe';
  const msixCfg = () => join(root, 'Local', 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json');
  const candidates = () => resolveClaudeDesktopConfigs({ platform: 'win32', env: process.env, home: root });

  it('both configs present with stale entries: both are patched and both are reported', () => {
    writeConfig(msixCfg(), { mcpServers: { swao: { command: STALE_A, args: ['mcp'] } } });
    writeConfig(CONFIG, { mcpServers: { 'swao-mcp': { command: STALE_B, args: ['mcp'] }, other: { command: 'x.exe' } } });

    const outcomes = patchAllClaudeDesktopConfigs(NEW, candidates());

    expect(outcomes).toEqual([
      { path: msixCfg(), kind: 'msix', effective: true, result: 'patched' },
      { path: CONFIG, kind: 'conventional', effective: false, result: 'patched' },
    ]);
    expect(readServers(msixCfg())['swao']?.command).toBe(NEW);
    expect(readServers(CONFIG)['swao-mcp']?.command).toBe(NEW);
    expect(readServers(CONFIG)['other']?.command).toBe('x.exe');
  });

  it('MSIX only: only the MSIX config is patched and no conventional config is created', () => {
    writeConfig(msixCfg(), { mcpServers: {} });

    const outcomes = patchAllClaudeDesktopConfigs(NEW, candidates());

    expect(outcomes.map((o) => [o.kind, o.result])).toEqual([['msix', 'patched']]);
    expect(readServers(msixCfg())['swao']?.command).toBe(NEW);
    expect(existsSync(CONFIG)).toBe(false);
  });

  it('conventional config without a SWAO entry is left untouched while MSIX is effective', () => {
    writeConfig(msixCfg(), { mcpServers: { swao: { command: STALE_A, args: ['mcp'] } } });
    writeConfig(CONFIG, { mcpServers: { other: { command: 'C:\\tools\\other.exe' } } });
    const before = readFileSync(CONFIG, 'utf-8');

    const outcomes = patchAllClaudeDesktopConfigs(NEW, candidates());

    expect(outcomes.map((o) => o.path)).toEqual([msixCfg()]);
    expect(readFileSync(CONFIG, 'utf-8')).toBe(before);
  });

  it('reports already_present per file when a config is already current', () => {
    writeConfig(msixCfg(), { mcpServers: { swao: { command: NEW, args: ['mcp'] } } });
    writeConfig(CONFIG, { mcpServers: { swao: { command: STALE_B, args: ['mcp'] } } });

    const outcomes = patchAllClaudeDesktopConfigs(NEW, candidates());

    expect(outcomes.map((o) => [o.kind, o.result])).toEqual([['msix', 'already_present'], ['conventional', 'patched']]);
  });

  it('no MSIX install: the conventional config is the effective target (created as before)', () => {
    const outcomes = patchAllClaudeDesktopConfigs(NEW, candidates());

    expect(outcomes).toEqual([{ path: CONFIG, kind: 'conventional', effective: true, result: 'patched' }]);
    expect(readServers(CONFIG)['swao']?.command).toBe(NEW);
  });
});

// ---------------------------------------------------------------------------
// #3217: one stable-binary resolver for the wizard, `init --mcp` and `mcp install`
// ---------------------------------------------------------------------------

describe('resolveStableBinary (#3217)', () => {
  function fakeBinary(name: string): string {
    const dir = join(root, 'swao-v1.4.0');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, name);
    writeFileSync(p, 'fake-binary', 'utf-8');
    return p;
  }

  it('copies the running binary to the stable sibling name and returns it', () => {
    const exec = fakeBinary('swao-win-x64.exe');
    const r = resolveStableBinary({ execPath: exec });
    const stable = join(dirname(exec), STABLE_BINARY_NAME);
    expect(r).toEqual({ path: stable, args: ['mcp'], copied: true, execPath: exec, stablePath: stable, sourceRun: false });
    expect(readFileSync(stable, 'utf-8')).toBe('fake-binary');
  });

  it('does not copy when the running binary already has the stable name', () => {
    const exec = fakeBinary(STABLE_BINARY_NAME);
    const copyFile = vi.fn();
    expect(resolveStableBinary({ execPath: exec, copyFile })).toEqual({ path: exec, args: ['mcp'], copied: false, execPath: exec, stablePath: exec, sourceRun: false });
    expect(copyFile).not.toHaveBeenCalled();
  });

  it('keeps an existing stable copy and reports the error when the copy fails (EPERM)', () => {
    const exec = fakeBinary('swao-win-x64.exe');
    const stable = join(dirname(exec), STABLE_BINARY_NAME);
    writeFileSync(stable, 'old-copy', 'utf-8');
    const r = resolveStableBinary({ execPath: exec, copyFile: () => { throw new Error('EPERM: operation not permitted'); } });
    expect(r).toEqual({ path: stable, args: ['mcp'], copied: false, execPath: exec, stablePath: stable, sourceRun: false, copyError: 'EPERM: operation not permitted' });
  });

  it('falls back to the running binary when the copy fails and no stable copy exists', () => {
    const exec = fakeBinary('swao-win-x64.exe');
    const r = resolveStableBinary({ execPath: exec, copyFile: () => { throw new Error('ENOSPC'); } });
    expect(r.path).toBe(exec);
    expect(r.copyError).toBe('ENOSPC');
  });

  it('`swao mcp install` and the wizard path register the same command', () => {
    const exec = fakeBinary('swao-win-x64.exe');
    const candidates = resolveClaudeDesktopConfigs({ platform: 'win32', env: process.env, home: root });

    // `swao mcp install`, wired exactly as bootstrap.ts wires it.
    const program = new Command('swao').exitOverride();
    registerMcp(program, {} as Parameters<typeof registerMcp>[1], '1.4.0', buildMcpInstallDeps({ execPath: exec }, candidates, ALLOW));
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      program.parse(['mcp', 'install'], { from: 'user' });
    } finally {
      write.mockRestore();
    }
    const installCommand = readServers(CONFIG)['swao']?.command;

    // Wizard (ClaudeDesktopStep doPatch) and `swao init --mcp`: shared resolver + patcher.
    rmSync(CONFIG);
    const wizardResolution = resolveStableBinary({ execPath: exec });
    patchAllClaudeDesktopConfigs(wizardResolution.path, candidates, wizardResolution.args);
    const wizardCommand = readServers(CONFIG)['swao']?.command;

    expect(installCommand).toBe(join(dirname(exec), STABLE_BINARY_NAME));
    expect(wizardCommand).toBe(installCommand);
  });

  it('init.ts and IntegrationsStep.tsx carry no private copy of the resolver', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const rel of ['../commands/init.ts', './screens/wizard/steps/IntegrationsStep.tsx']) {
      const src = readFileSync(join(here, rel), 'utf-8');
      expect(src, rel).not.toContain('copyFileSync(process.execPath');
      expect(src, rel).toContain('resolveStableBinary');
    }
  });
});

// ---------------------------------------------------------------------------
// #3286 (Design 110 D-08, D-09, D-10): copy only SWAO binaries, platform name
// ---------------------------------------------------------------------------

describe('stableBinaryName (#3286, D-09)', () => {
  it.each([
    ['swao-win-x64.exe', STABLE_BINARY_NAME],
    ['swao-win.exe', STABLE_BINARY_NAME],
    ['swao-community-win-x64.exe', 'swao-community-win-x64.exe'],
    ['swao-consultant-win-x64.exe', 'swao-consultant-win-x64.exe'],
    ['swao-community-win.exe', 'swao-community-win-x64.exe'],
    ['swao-enterprise-win-x64.exe', STABLE_BINARY_NAME],
    ['swao-enterprise-linux-x64', 'swao-enterprise-linux-x64'],
    ['swao-consultant-linux-arm64', 'swao-consultant-linux-arm64'],
    ['swao-community-macos-arm64', 'swao-community-macos-arm64'],
    ['swao-enterprise-darwin-x64', 'swao-enterprise-darwin-x64'],
    ['swao-linux-x64', 'swao-enterprise-linux-x64'],
    ['swao-macos-arm64', 'swao-enterprise-macos-arm64'],
  ])('%s -> %s', (running, expected) => {
    expect(stableBinaryName(running)).toBe(expected);
  });

  it.each(['node.exe', 'node', 'swao.exe', 'index.js'])('%s is not a SWAO binary: no stable name', (running) => {
    expect(stableBinaryName(running)).toBeUndefined();
  });

  it('the Enterprise Windows stable name is unchanged', () => {
    expect(STABLE_BINARY_NAME).toBe('swao-enterprise-win-x64.exe');
  });
});

describe('resolveStableBinary: copy only SWAO binaries (#3286, D-08)', () => {
  function fakeFile(name: string): string {
    const dir = join(root, 'bin');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, name);
    writeFileSync(p, 'fake', 'utf-8');
    return p;
  }

  it('a source run copies nothing and registers node plus the script path', () => {
    const node = fakeFile('node.exe');
    const script = join(root, 'repo', 'packages', 'swao', 'dist', 'index.js');
    const copyFile = vi.fn();
    const r = resolveStableBinary({ execPath: node, scriptPath: script, copyFile });
    expect(copyFile).not.toHaveBeenCalled();
    expect(r).toEqual({ path: node, args: [resolve(script), 'mcp'], copied: false, execPath: node, sourceRun: true });
    expect(existsSync(join(dirname(node), STABLE_BINARY_NAME))).toBe(false);
  });

  it.each(['swao', 'swao.exe'])('a renamed binary (%s) is registered as is with args [mcp], no copy, no script', (name) => {
    const exec = fakeFile(name);
    const copyFile = vi.fn();
    const r = resolveStableBinary({ execPath: exec, scriptPath: '/snapshot/swao/dist/index.js', copyFile });
    expect(copyFile).not.toHaveBeenCalled();
    expect(r).toEqual({ path: exec, args: ['mcp'], copied: false, execPath: exec, sourceRun: false });
  });

  it('a relative script path is registered as an absolute path', () => {
    const r = resolveStableBinary({ execPath: fakeFile('node'), scriptPath: 'dist/index.js', copyFile: vi.fn() });
    expect(r.args).toEqual([resolve('dist/index.js'), 'mcp']);
  });

  it('a tiered macOS or Linux binary is registered as itself (already its stable name)', () => {
    const exec = fakeFile('swao-community-linux-x64');
    const copyFile = vi.fn();
    const r = resolveStableBinary({ execPath: exec, copyFile });
    expect(copyFile).not.toHaveBeenCalled();
    expect(r.path).toBe(exec);
    expect(r.args).toEqual(['mcp']);
  });

  it('a legacy un-tiered Linux binary is copied to swao-enterprise-linux-x64, not the Windows name', () => {
    const exec = fakeFile('swao-linux-x64');
    const r = resolveStableBinary({ execPath: exec });
    expect(r.path).toBe(join(dirname(exec), 'swao-enterprise-linux-x64'));
    expect(r.copied).toBe(true);
    expect(existsSync(join(dirname(exec), STABLE_BINARY_NAME))).toBe(false);
  });

  it('`swao mcp install` on a source run writes node plus the script path into the config', () => {
    const node = fakeFile('node.exe');
    const script = join(root, 'repo', 'dist', 'index.js');
    const candidates = resolveClaudeDesktopConfigs({ platform: 'win32', env: process.env, home: root });
    const program = new Command('swao').exitOverride();
    registerMcp(program, {} as Parameters<typeof registerMcp>[1], '1.4.0', buildMcpInstallDeps({ execPath: node, scriptPath: script }, candidates, ALLOW));
    const out: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
    try {
      program.parse(['mcp', 'install'], { from: 'user' });
    } finally {
      write.mockRestore();
    }
    const entry = (JSON.parse(readFileSync(CONFIG, 'utf-8')) as { mcpServers: Record<string, { command: string; args: string[] }> }).mcpServers['swao'];
    expect(entry).toEqual({ command: node, args: [resolve(script), 'mcp'] });
    expect(out.join('')).toContain(`${node} ${resolve(script)} mcp`);
  });
});

describe('patchClaudeDesktopConfig with args (#3286)', () => {
  const NODE = 'C:\\Program Files\\nodejs\\node.exe';
  const SCRIPT_A = 'C:\\repo-a\\packages\\swao\\dist\\index.js';
  const SCRIPT_B = 'C:\\repo-b\\packages\\swao\\dist\\index.js';

  it('writes node plus the script path and mcp', () => {
    expect(patchClaudeDesktopConfig(CONFIG, NODE, [SCRIPT_A, 'mcp'])).toBe('patched');
    expect(readServers(CONFIG)['swao']).toEqual({ command: NODE, args: [SCRIPT_A, 'mcp'] });
  });

  it('same node and script: already_present; a different script: patched', () => {
    writeConfig(CONFIG, { mcpServers: { swao: { command: NODE, args: [SCRIPT_A, 'mcp'] } } });
    expect(patchClaudeDesktopConfig(CONFIG, NODE, [SCRIPT_A, 'mcp'])).toBe('already_present');
    expect(patchClaudeDesktopConfig(CONFIG, NODE, [SCRIPT_B, 'mcp'])).toBe('patched');
    expect(readServers(CONFIG)['swao']).toEqual({ command: NODE, args: [SCRIPT_B, 'mcp'] });
  });

  it('a binary entry with extra operator args (--workspace) stays already_present', () => {
    writeConfig(CONFIG, { mcpServers: { swao: { command: BINARY, args: ['mcp', '--workspace', 'C:\\ws'] } } });
    expect(patchClaudeDesktopConfig(CONFIG, BINARY)).toBe('already_present');
  });

  it('an entry previously registered as node is replaced by the binary with args [mcp]', () => {
    writeConfig(CONFIG, { mcpServers: { swao: { command: NODE, args: [SCRIPT_A, 'mcp'] } } });
    expect(patchClaudeDesktopConfig(CONFIG, BINARY)).toBe('patched');
    expect(readServers(CONFIG)['swao']).toEqual({ command: BINARY, args: ['mcp'] });
  });
});

describe('stableCopyWarning (#3286, D-10)', () => {
  it('is undefined when the copy did not fail', () => {
    expect(stableCopyWarning({ path: 'x', args: ['mcp'], copied: true, execPath: 'y', sourceRun: false })).toBeUndefined();
  });

  it('names the error, the registered path and the quit-and-re-run instruction', () => {
    const lines = stableCopyWarning({
      path: 'C:\\swao\\swao-enterprise-win-x64.exe', args: ['mcp'], copied: false, execPath: 'C:\\swao\\swao-win-x64.exe',
      stablePath: 'C:\\swao\\swao-enterprise-win-x64.exe', sourceRun: false, copyError: 'EPERM: operation not permitted',
    }) ?? [];
    const text = lines.join('\n');
    expect(text).toContain('EPERM: operation not permitted');
    expect(text).toContain('Registering: C:\\swao\\swao-enterprise-win-x64.exe');
    expect(text).toContain('Quit Claude Desktop (tray icon, Quit) and re-run `swao mcp install`');
  });
});

// ---------------------------------------------------------------------------
// #3341: a lower-tier binary never overwrites the Enterprise binary, and MCP
// registration is Enterprise-gated on every entry point
// ---------------------------------------------------------------------------

describe('stableBinaryName: tier-aware (#3341)', () => {
  const TIERS = ['community', 'consultant', 'enterprise'] as const;

  it.each(['swao-community-win-x64.exe', 'swao-consultant-win-x64.exe', 'swao-community-win.exe', 'swao-consultant-win.exe'])(
    'regression: %s never resolves to the Enterprise name, whatever the fallback tier',
    (running) => {
      for (const fallback of TIERS) {
        expect(stableBinaryName(running, fallback)).not.toBe(STABLE_BINARY_NAME);
        expect(stableBinaryName(running, fallback)).toMatch(/^swao-(community|consultant)-win-x64\.exe$/);
      }
    },
  );

  it.each([
    ['community', 'swao-community-win-x64.exe'],
    ['consultant', 'swao-consultant-win-x64.exe'],
    ['enterprise', 'swao-enterprise-win-x64.exe'],
  ] as const)('an un-tiered Windows binary on a %s entry maps to %s', (tier, expected) => {
    expect(stableBinaryName('swao-win-x64.exe', tier)).toBe(expected);
  });

  it('binaryNameTier reads the tier from the name, undefined for legacy names', () => {
    expect(binaryNameTier('swao-community-win-x64.exe')).toBe('community');
    expect(binaryNameTier('swao-enterprise-linux-x64')).toBe('enterprise');
    expect(binaryNameTier('swao-win-x64.exe')).toBeUndefined();
  });
});

describe('resolveStableBinary never overwrites a binary of another tier (#3341)', () => {
  function folderWithEnterprise(): { dir: string; enterprise: string } {
    const dir = join(root, 'dist-bin');
    mkdirSync(dir, { recursive: true });
    const enterprise = join(dir, STABLE_BINARY_NAME);
    writeFileSync(enterprise, 'ENTERPRISE-BYTES', 'utf-8');
    return { dir, enterprise };
  }

  it.each(['swao-community-win-x64.exe', 'swao-consultant-win-x64.exe'])('%s registers itself and copies nothing', (name) => {
    const { dir, enterprise } = folderWithEnterprise();
    const exec = join(dir, name);
    writeFileSync(exec, 'LOWER-TIER-BYTES', 'utf-8');
    const copyFile = vi.fn();
    const r = resolveStableBinary({ execPath: exec, copyFile, binaryTier: 'enterprise' });
    expect(copyFile).not.toHaveBeenCalled();
    expect(r.path).toBe(exec);
    expect(r.copied).toBe(false);
    expect(readFileSync(enterprise, 'utf-8')).toBe('ENTERPRISE-BYTES');
  });

  it('an un-tiered binary of the Community entry copies to the Community name, never the Enterprise exe', () => {
    const { dir, enterprise } = folderWithEnterprise();
    const exec = join(dir, 'swao-win-x64.exe');
    writeFileSync(exec, 'COMMUNITY-BYTES', 'utf-8');
    const r = resolveStableBinary({ execPath: exec, binaryTier: 'community' });
    expect(r.path).toBe(join(dir, 'swao-community-win-x64.exe'));
    expect(readFileSync(join(dir, 'swao-community-win-x64.exe'), 'utf-8')).toBe('COMMUNITY-BYTES');
    expect(readFileSync(enterprise, 'utf-8')).toBe('ENTERPRISE-BYTES');
  });

  it('the running file already has its stable name: no copy', () => {
    const { enterprise } = folderWithEnterprise();
    const copyFile = vi.fn();
    const r = resolveStableBinary({ execPath: enterprise, copyFile });
    expect(copyFile).not.toHaveBeenCalled();
    expect(r.path).toBe(enterprise);
  });
});

describe('mcpRegistrationRefusal (#3341)', () => {
  const allow = () => ({ requireFeature: () => {} });

  it.each(['swao-community-win-x64.exe', 'swao-consultant-win-x64.exe', 'swao-community-linux-x64'])(
    'refuses the %s binary edition even with an Enterprise licence',
    (name) => {
      const r = mcpRegistrationRefusal({ execPath: join(root, name), binaryTier: 'enterprise', loadGuard: allow });
      expect(r).toMatchObject({ kind: 'tier', required: 'enterprise', edition: true });
    },
  );

  it('refuses when SWAO_BINARY_TIER is below Enterprise (un-tiered or renamed binary)', () => {
    expect(mcpRegistrationRefusal({ execPath: join(root, 'swao-win-x64.exe'), binaryTier: 'consultant', loadGuard: allow }))
      .toMatchObject({ kind: 'tier', current: 'consultant', edition: true });
  });

  it('takes the stricter of the binary name and SWAO_BINARY_TIER', () => {
    expect(mcpRegistrationRefusal({ execPath: join(root, STABLE_BINARY_NAME), binaryTier: 'community', loadGuard: allow }))
      .toMatchObject({ kind: 'tier', current: 'community' });
  });

  it('refuses a Consultant licence on the Enterprise binary with the standard [LICENSE] text', () => {
    const r = mcpRegistrationRefusal({
      execPath: join(root, STABLE_BINARY_NAME), binaryTier: 'enterprise',
      loadGuard: () => ({ requireFeature: () => { throw new LicenseTierError('enterprise', 'consultant', 'mcp-server'); } }),
    });
    expect(r).toEqual({ kind: 'tier', required: 'enterprise', current: 'consultant', edition: false });
    expect(formatMcpRegistrationRefusal(r!, 'swao mcp install')).toContain('[LICENSE] swao mcp install requires an Enterprise licence.');
  });

  it('reports an invalid licence', () => {
    const r = mcpRegistrationRefusal({
      execPath: join(root, STABLE_BINARY_NAME), binaryTier: 'enterprise',
      loadGuard: () => ({ requireFeature: () => { throw new LicenseInvalidError('bad key', 'signature_invalid'); } }),
    });
    expect(r).toEqual({ kind: 'invalid', message: 'bad key' });
  });

  it('allows the Enterprise binary with an Enterprise licence', () => {
    expect(mcpRegistrationRefusal({ execPath: join(root, STABLE_BINARY_NAME), binaryTier: 'enterprise', loadGuard: allow })).toBeUndefined();
  });

  it('the edition refusal names the Enterprise binary', () => {
    const r = mcpRegistrationRefusal({ execPath: join(root, 'swao-community-win-x64.exe'), loadGuard: allow });
    expect(r).toBeDefined();
    const text = formatMcpRegistrationRefusal(r!, 'swao mcp install');
    expect(text).toContain('Your current tier: community');
    expect(text).toContain('This is the Community binary');
  });
});

describe('MCP registration entry points refuse below Enterprise before any copy or write (#3341)', () => {
  function captureExit(fn: () => unknown): { exitCode: number | undefined; err: string } {
    let exitCode: number | undefined;
    const err: string[] = [];
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { exitCode = code; throw new Error('exit'); }) as typeof process.exit);
    const cerr = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
    const serr = vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try { fn(); } catch { /* exit sentinel */ } finally {
      exit.mockRestore(); cerr.mockRestore(); serr.mockRestore(); out.mockRestore();
    }
    return { exitCode, err: err.join('\n') };
  }

  it('`swao mcp install` from the Community exe: exit 1, [LICENSE], sibling Enterprise exe and Claude config untouched', () => {
    const dir = join(root, 'dist-bin');
    mkdirSync(dir, { recursive: true });
    const enterprise = join(dir, STABLE_BINARY_NAME);
    writeFileSync(enterprise, 'ENTERPRISE-BYTES', 'utf-8');
    const community = join(dir, 'swao-community-win-x64.exe');
    writeFileSync(community, 'COMMUNITY-BYTES', 'utf-8');
    const candidates = resolveClaudeDesktopConfigs({ platform: 'win32', env: process.env, home: root });
    const program = new Command('swao').exitOverride();
    registerMcp(program, {} as Parameters<typeof registerMcp>[1], '1.4.0',
      buildMcpInstallDeps({ execPath: community }, candidates, { binaryTier: 'community', loadGuard: () => ({ requireFeature: () => {} }) }));
    const r = captureExit(() => program.parse(['mcp', 'install'], { from: 'user' }));
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain('[LICENSE] swao mcp install requires an Enterprise licence.');
    expect(readFileSync(enterprise, 'utf-8')).toBe('ENTERPRISE-BYTES');
    expect(existsSync(CONFIG)).toBe(false);
  });

  it('`swao init --mcp` below Enterprise: exit 1 before the resolver or patcher runs', () => {
    const resolveBinary = vi.fn();
    const patchAll = vi.fn(() => []);
    const r = captureExit(() => runInitMcp({
      gate: { execPath: join(root, 'swao-consultant-win-x64.exe'), loadGuard: () => ({ requireFeature: () => {} }) },
      resolveBinary, patchAll,
    }));
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain('[LICENSE] swao init --mcp requires an Enterprise licence.');
    expect(resolveBinary).not.toHaveBeenCalled();
    expect(patchAll).not.toHaveBeenCalled();
  });

  it('`swao init --mcp` on Enterprise registers the resolved binary', () => {
    const patchAll = vi.fn(() => [{ path: CONFIG, kind: 'conventional' as const, effective: true, result: 'patched' as const }]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const code = runInitMcp({
        gate: { execPath: join(root, STABLE_BINARY_NAME), binaryTier: 'enterprise', loadGuard: () => ({ requireFeature: () => {} }) },
        resolveBinary: () => ({ path: 'X', args: ['mcp'], copied: false, execPath: 'X', sourceRun: false }),
        patchAll,
      });
      expect(code).toBe(0);
      expect(patchAll).toHaveBeenCalledWith('X', undefined, ['mcp']);
    } finally { log.mockRestore(); }
  });
});
