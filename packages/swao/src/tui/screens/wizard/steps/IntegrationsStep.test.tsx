// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI tests: ClaudeDesktopStep resolution
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3216: the Claude Desktop step resolves the configs once per mount and the
// stable binary (a file copy) only on the user's Enter, never per Ink render.
// #3217: the wizard registers the same command as `swao mcp install`.
//
// Real filesystem sandbox under the OS temp dir; the resolvers are injected,
// so nothing here touches the operator's Claude Desktop configs or copies the
// running executable.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ClaudeDesktopConfigCandidate } from '@swao/core';
import type { McpClientInstallRequest } from '@swao/module-mcp';

vi.mock('../shared.js', () => ({
  _wizardGuidanceOpen: false,
  setWizardGuidanceOpen: vi.fn(),
}));

import { ClaudeDesktopStep } from './IntegrationsStep.js';
import { buildMcpInstallDeps, resolveStableBinary, STABLE_BINARY_NAME, type StableBinaryResolution } from '../../../mcp-config.js';

let root: string;
let configPath: string;
let candidates: ClaudeDesktopConfigCandidate[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'swao-wizard-mcp-'));
  configPath = join(root, 'Claude', 'claude_desktop_config.json');
  mkdirSync(join(root, 'Claude'), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ mcpServers: {} }), 'utf-8');
  candidates = [{ path: configPath, kind: 'conventional', effective: true }];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const tick = () => new Promise((r) => setTimeout(r, 20));
// #3341: tests never read the operator's real licence; the gate itself is tested below.
const allowLicence = (): string | undefined => undefined;

const STABLE = 'C:\\swao\\swao-enterprise-win-x64.exe';
const resolution = (extra: Partial<StableBinaryResolution> = {}): StableBinaryResolution => ({
  path: STABLE, args: ['mcp'], copied: false, execPath: STABLE, stablePath: STABLE, sourceRun: false, ...extra,
});

function registeredCommand(): string | undefined {
  const cfg = JSON.parse(readFileSync(configPath, 'utf-8')) as { mcpServers: Record<string, { command: string }> };
  return cfg.mcpServers['swao']?.command;
}

describe('ClaudeDesktopStep -- resolution per mount (#3216)', () => {
  it('resolves the configs once and never copies the binary across several renders', () => {
    const resolveConfigs = vi.fn(() => candidates);
    const resolveBinary = vi.fn(() => resolution());
    const el = (n: number) => (
      <ClaudeDesktopStep checkLicence={allowLicence} key="step" workDir={`w${n}`} onNext={() => {}} resolveConfigs={resolveConfigs} resolveBinary={resolveBinary} />
    );
    const { rerender, lastFrame, unmount } = render(el(0));
    for (let i = 1; i <= 4; i++) rerender(el(i));
    expect(lastFrame() ?? '').toContain(configPath);
    expect(resolveConfigs).toHaveBeenCalledTimes(1);
    expect(resolveBinary).not.toHaveBeenCalled();
    unmount();
  });

  it('resolves the binary once, on Enter, and patches with that path', async () => {
    const resolveConfigs = vi.fn(() => candidates);
    const resolveBinary = vi.fn(() => resolution());
    const { stdin, lastFrame, unmount } = render(
      <ClaudeDesktopStep checkLicence={allowLicence} workDir="w" onNext={() => {}} resolveConfigs={resolveConfigs} resolveBinary={resolveBinary} />,
    );
    await tick();
    stdin.write('\r');
    await tick();
    expect(resolveBinary).toHaveBeenCalledTimes(1);
    expect(resolveConfigs).toHaveBeenCalledTimes(1);
    expect(registeredCommand()).toBe('C:\\swao\\swao-enterprise-win-x64.exe');
    expect(lastFrame() ?? '').toContain('Updated');
    unmount();
  });
});

describe('ClaudeDesktopStep -- same command as `swao mcp install` (#3217)', () => {
  it('the wizard and mcp install register the stable sibling copy', async () => {
    const binDir = join(root, 'swao-v1.4.0');
    mkdirSync(binDir, { recursive: true });
    const exec = join(binDir, 'swao-win-x64.exe');
    writeFileSync(exec, 'fake-binary', 'utf-8');

    const { stdin, unmount } = render(
      <ClaudeDesktopStep checkLicence={allowLicence}
        workDir="w"
        onNext={() => {}}
        resolveConfigs={() => candidates}
        resolveBinary={() => resolveStableBinary({ execPath: exec, binaryTier: 'enterprise' })}
      />,
    );
    await tick();
    stdin.write('\r');
    await tick();
    unmount();
    const wizardCommand = registeredCommand();

    const installDeps = buildMcpInstallDeps({ execPath: exec, binaryTier: 'enterprise' }, candidates);
    const installPath = installDeps.resolveBinary().path;

    expect(wizardCommand).toBe(join(binDir, STABLE_BINARY_NAME));
    expect(installPath).toBe(wizardCommand);
  });
});

// #3286 (Design 110 D-10): a failed stable copy is no longer silent in the wizard.
describe('ClaudeDesktopStep -- copy-failure warning (#3286)', () => {
  it('shows the same warning as `swao mcp install` when the stable copy fails', async () => {
    writeFileSync(configPath, JSON.stringify({ mcpServers: { swao: { command: STABLE, args: ['mcp'] } } }), 'utf-8');
    const { stdin, lastFrame, unmount } = render(
      <ClaudeDesktopStep checkLicence={allowLicence}
        workDir="w"
        onNext={() => {}}
        resolveConfigs={() => candidates}
        resolveBinary={() => resolution({ execPath: 'C:\\swao\\swao-win-x64.exe', copyError: 'EPERM: operation not permitted' })}
      />,
    );
    await tick();
    stdin.write('\r');
    await tick();
    const frame = lastFrame() ?? '';
    unmount();
    expect(frame).toContain('Already current');
    expect(frame).toContain('Warning: Could not refresh the stable binary copy');
    expect(frame).toContain('EPERM');
    expect(frame).toContain('Quit Claude Desktop');
  });

  it('shows no warning when the copy succeeds', async () => {
    const { stdin, lastFrame, unmount } = render(
      <ClaudeDesktopStep checkLicence={allowLicence} workDir="w" onNext={() => {}} resolveConfigs={() => candidates} resolveBinary={() => resolution({ copied: true })} />,
    );
    await tick();
    stdin.write('\r');
    await tick();
    const frame = lastFrame() ?? '';
    unmount();
    expect(frame).not.toContain('Could not refresh');
  });

  it('a source run registers node plus the script path, not a copied node.exe', async () => {
    const binDir = join(root, 'node');
    mkdirSync(binDir, { recursive: true });
    const node = join(binDir, 'node.exe');
    writeFileSync(node, 'fake-node', 'utf-8');
    const script = join(root, 'repo', 'dist', 'index.js');
    const { stdin, unmount } = render(
      <ClaudeDesktopStep checkLicence={allowLicence}
        workDir="w"
        onNext={() => {}}
        resolveConfigs={() => candidates}
        resolveBinary={() => resolveStableBinary({ execPath: node, scriptPath: script })}
      />,
    );
    await tick();
    stdin.write('\r');
    await tick();
    unmount();
    const cfg = JSON.parse(readFileSync(configPath, 'utf-8')) as { mcpServers: Record<string, { command: string; args: string[] }> };
    expect(cfg.mcpServers['swao']).toEqual({ command: node, args: [script, 'mcp'] });
    expect(existsSync(join(binDir, STABLE_BINARY_NAME))).toBe(false);
  });
});

// #3341: the wizard MCP step uses the same Enterprise gate as `swao mcp install`
// and `swao init --mcp`; below Enterprise nothing is copied or written.
describe('ClaudeDesktopStep -- Enterprise gate (#3341)', () => {
  const REFUSAL = '[LICENSE] MCP server registration requires an Enterprise licence.\nYour current tier: community';

  it('shows the [LICENSE] text, never resolves the binary, leaves the config untouched, Enter skips', async () => {
    const before = readFileSync(configPath, 'utf-8');
    const resolveBinary = vi.fn(() => resolution());
    const onNext = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <ClaudeDesktopStep checkLicence={() => REFUSAL} workDir="w" onNext={onNext} resolveConfigs={() => candidates} resolveBinary={resolveBinary} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    stdin.write('\r');
    await tick();
    unmount();
    expect(frame).toContain('[LICENSE] MCP server registration requires an Enterprise licence.');
    expect(frame).toContain('nothing is copied or written');
    expect(resolveBinary).not.toHaveBeenCalled();
    expect(readFileSync(configPath, 'utf-8')).toBe(before);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('the default wizard gate refuses a Community binary edition (same decision as the CLI)', async () => {
    const { defaultMcpWizardLicenceCheck } = await import('./IntegrationsStep.js');
    const saved = process.env['SWAO_BINARY_TIER'];
    process.env['SWAO_BINARY_TIER'] = 'community';
    try {
      const text = defaultMcpWizardLicenceCheck() ?? '';
      expect(text).toContain('[LICENSE] MCP server registration requires an Enterprise licence.');
      expect(text).toContain('Your current tier: community');
    } finally {
      if (saved === undefined) delete process.env['SWAO_BINARY_TIER'];
      else process.env['SWAO_BINARY_TIER'] = saved;
    }
  });
});

describe('ClaudeDesktopStep -- no MCP client detected branch (#3386)', () => {
  it('names the other MCP clients and the HTTP transport, not only Claude Desktop', () => {
    const { lastFrame, unmount } = render(
      <ClaudeDesktopStep checkLicence={allowLicence} workDir="w" onNext={() => {}} resolveConfigs={() => []} resolveBinary={() => resolution()} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('No MCP client detected.');
    // #3386: the hint must name the other supported clients + the HTTP transport,
    // not just Claude Desktop, so an operator on Claude Code / VS Code / Kilo knows
    // how to connect.
    expect(frame).toContain('swao mcp --http');
    expect(frame).toMatch(/Claude Code/);
    unmount();
  });
});

// #3479 (Design 116 REQ-13.3): the MCP step offers the `swao mcp install --client`
// choice and calls the same writer. The writer is a spy here, so nothing is written.
describe('ClaudeDesktopStep -- client choice (#3479)', () => {
  // Defence in depth: the writer is a spy, and the home, profile and PATH
  // variables point into the temp sandbox, so no real client config is reachable.
  const KEYS = ['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'PATH'] as const;
  let saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) process.env[k] = join(root, 'sandbox-env', k);
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function setup(resolveConfigs: () => ClaudeDesktopConfigCandidate[]) {
    const installClient = vi.fn((_r: McpClientInstallRequest) => ({ exitCode: 0 as const, out: ['Configuring SWAO for Claude Code'], err: [] }));
    const resolveBinary = vi.fn(() => resolution());
    const view = render(
      <ClaudeDesktopStep checkLicence={allowLicence} workDir={root} onNext={() => {}} resolveConfigs={resolveConfigs} resolveBinary={resolveBinary} installClient={installClient} />,
    );
    return { ...view, installClient, resolveBinary };
  }

  it('lists Claude Desktop, Claude Code and Kilo with Claude Desktop preselected', () => {
    const { lastFrame, unmount } = setup(() => candidates);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('> 1  Claude Desktop');
    expect(frame).toContain('2  Claude Code');
    expect(frame).toContain('3  Kilo');
    unmount();
  });

  it('choosing Claude Code calls the Claude Code writer with the install defaults; Claude Desktop is untouched', async () => {
    const before = readFileSync(configPath, 'utf-8');
    const { stdin, lastFrame, installClient, unmount } = setup(() => candidates);
    await tick();
    stdin.write('\u001B[B'); // Down
    await tick();
    stdin.write('\r');
    await tick();
    expect(installClient).toHaveBeenCalledTimes(1);
    expect(installClient.mock.calls[0]?.[0]).toMatchObject({
      client: 'claude-code', scope: 'user', transport: 'http', url: 'http://localhost:3737/mcp',
      agent: true, profile: 'starter', workspace: root, projectDir: root, dryRun: false, uninstall: false,
      binary: { path: STABLE, args: ['mcp'] },
    });
    expect(readFileSync(configPath, 'utf-8')).toBe(before);
    expect(lastFrame() ?? '').toContain('Configuring SWAO for Claude Code');
    unmount();
  });

  it('key 3 chooses Kilo (stdio) even when Claude Desktop is not installed', async () => {
    const { stdin, installClient, unmount } = setup(() => []);
    await tick();
    stdin.write('3');
    await tick();
    stdin.write('\r');
    await tick();
    expect(installClient.mock.calls[0]?.[0]).toMatchObject({ client: 'kilo', transport: 'stdio' });
    unmount();
  });

  it('Enter on Claude Desktop keeps the existing patcher and never calls the client writer', async () => {
    const { stdin, installClient, unmount } = setup(() => candidates);
    await tick();
    stdin.write('\r');
    await tick();
    expect(installClient).not.toHaveBeenCalled();
    expect(registeredCommand()).toBe(STABLE);
    unmount();
  });

  it('a refused licence never calls the client writer', async () => {
    const installClient = vi.fn();
    const { stdin, unmount } = render(
      <ClaudeDesktopStep checkLicence={() => '[LICENSE] refused'} workDir={root} onNext={() => {}} resolveConfigs={() => candidates} resolveBinary={() => resolution()} installClient={installClient} />,
    );
    await tick();
    stdin.write('2');
    await tick();
    stdin.write('\r');
    await tick();
    expect(installClient).not.toHaveBeenCalled();
    unmount();
  });
});
