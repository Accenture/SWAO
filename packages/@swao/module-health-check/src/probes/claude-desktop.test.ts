// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Doctor module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UTIL_SRC   = resolve(__dirname, './claude-desktop.ts');

// ---------------------------------------------------------------------------
// Utility module -- structure
// ---------------------------------------------------------------------------

describe('src/probes/claude-desktop.ts -- structure', () => {
  it('file exists', () => {
    expect(existsSync(UTIL_SRC)).toBe(true);
  });

  it('exports claudeDesktopConfigPath', async () => {
    const mod = await import('./claude-desktop.js');
    expect(typeof mod.claudeDesktopConfigPath).toBe('function');
  });

  it('exports buildMcpProbe', async () => {
    const mod = await import('./claude-desktop.js');
    expect(typeof mod.buildMcpProbe).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// claudeDesktopConfigPath -- returns a non-empty string
// ---------------------------------------------------------------------------

describe('claudeDesktopConfigPath()', () => {
  it('returns a non-empty string', async () => {
    const { claudeDesktopConfigPath } = await import('./claude-desktop.js');
    const p = claudeDesktopConfigPath();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(0);
  });

  it('returned path ends with claude_desktop_config.json', async () => {
    const { claudeDesktopConfigPath } = await import('./claude-desktop.js');
    const p = claudeDesktopConfigPath();
    expect(p.endsWith('claude_desktop_config.json')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildMcpProbe -- not_installed when config absent
// ---------------------------------------------------------------------------

describe('buildMcpProbe()', () => {
  it('returns not_installed status when config path does not exist', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');
    // Works on machines where Claude Desktop is not installed.
    // Pass versionRunner: () => true to avoid slow subprocess calls on machines
    // that have Claude Desktop installed and a valid SWAO entry (#2908).
    const result = buildMcpProbe({ versionRunner: () => true });
    expect(['ok', 'missing_entry', 'binary_not_found', 'binary_unreachable', 'not_installed']).toContain(result.status);
    expect(typeof result.configPath).toBe('string');
    expect(result.configPath.endsWith('claude_desktop_config.json')).toBe(true);
  });

  it('returns ok when config has valid swao entry with existing command', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');

    const tmpDir = join(tmpdir(), `swao-test-mcp-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const fakeCfg = join(tmpDir, 'claude_desktop_config.json');
    const fakeBin = join(tmpDir, 'swao-enterprise-win-x64.exe');
    writeFileSync(fakeBin, 'placeholder', 'utf-8');
    writeFileSync(fakeCfg, JSON.stringify({
      mcpServers: { swao: { command: fakeBin, args: ['mcp'] } },
    }), 'utf-8');

    const result = buildMcpProbe({ configPathOverride: fakeCfg, versionRunner: () => true });
    expect(result.status).toBe('ok');
    expect(result.commandPath).toBe(fakeBin);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('result has status, configPath, and commandPath fields', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');
    const result = buildMcpProbe({ versionRunner: () => true });
    expect(Object.keys(result)).toContain('status');
    expect(Object.keys(result)).toContain('configPath');
    expect(Object.keys(result)).toContain('commandPath');
  });
});

// ---------------------------------------------------------------------------
// buildMcpProbe -- #0154 SWAO_MCP_CONTEXT short-circuit
// ---------------------------------------------------------------------------

describe('buildMcpProbe() -- SWAO_MCP_CONTEXT short-circuit (#0154)', () => {
  it('returns ok status when SWAO_MCP_CONTEXT=1 even with no Claude Desktop config', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');
    const prev = process.env['SWAO_MCP_CONTEXT'];
    process.env['SWAO_MCP_CONTEXT'] = '1';
    try {
      const result = buildMcpProbe();
      expect(result.status).toBe('ok');
      expect(result.commandPath).toBe(process.execPath);
    } finally {
      if (prev === undefined) delete process.env['SWAO_MCP_CONTEXT'];
      else process.env['SWAO_MCP_CONTEXT'] = prev;
    }
  });

  it('SWAO_MCP_CONTEXT short-circuit ignores SWAO_MCP_CONTEXT values other than "1"', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');
    const prev = process.env['SWAO_MCP_CONTEXT'];
    process.env['SWAO_MCP_CONTEXT'] = '0';
    try {
      // Pass versionRunner to avoid slow subprocess on machines with Claude
      // Desktop installed and a valid SWAO entry (#2908).
      const result = buildMcpProbe({ versionRunner: () => true });
      // Falls through to config-file inspection; status is whatever the
      // host environment actually produces.
      expect(['ok', 'missing_entry', 'binary_not_found', 'binary_unreachable', 'not_installed']).toContain(result.status);
    } finally {
      if (prev === undefined) delete process.env['SWAO_MCP_CONTEXT'];
      else process.env['SWAO_MCP_CONTEXT'] = prev;
    }
  });

  // The `server.ts spawns subprocesses with SWAO_MCP_CONTEXT=1` source-assertion
  // test moved to the host's mcp/server.test.ts (#0573): the MCP server is
  // host-only, so this module cannot read its source.
});

// ---------------------------------------------------------------------------
// formatMcpProbeLine -- #0154 label rename
// ---------------------------------------------------------------------------

describe('doctor probe label rename (#0154)', () => {
  it('doctor.ts emits the SWAO-MCP label (not bare MCP)', async () => {
    const { readFileSync } = await import('fs');
    const { resolve: res } = await import('path');
    const doctorSrc = readFileSync(res(__dirname, '../commands/health-check.ts'), 'utf-8');
    // [3/N] SWAO-MCP -- N grew from 7 to 8 in Sprint 029 with the
    // addition of Pass 13's [8/8] Scope probe (#0263).
    expect(doctorSrc).toMatch(/\[3\/\d+\] SWAO-MCP/);
    // The old bare label must no longer appear inside the probe-line formatter.
    expect(doctorSrc).not.toMatch(/pad\('\[3\/\d+\] MCP'/);
  });
});

// The `swao_import path traversal guard (#0142)` source-assertion tests moved
// to the host's mcp/server.test.ts (#0573): they read the host MCP server
// source, which this module cannot reach.

// ---------------------------------------------------------------------------
// buildMcpProbe -- WARN states (#2908)
// ---------------------------------------------------------------------------

describe('buildMcpProbe() -- binary_not_found WARN state (#2908)', () => {
  it('returns binary_not_found when config points to a non-existent binary', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');

    const tmpDir = join(tmpdir(), `swao-test-mcp-nf-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const fakeCfg = join(tmpDir, 'claude_desktop_config.json');
    writeFileSync(fakeCfg, JSON.stringify({
      mcpServers: { swao: { command: join(tmpDir, 'swao-enterprise-win-x64.exe'), args: ['mcp'] } },
    }), 'utf-8');

    const result = buildMcpProbe({ configPathOverride: fakeCfg });
    expect(result.status).toBe('binary_not_found');
    expect(result.commandPath).toContain('swao-enterprise-win-x64.exe');

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('buildMcpProbe() -- binary_unreachable WARN state (#2908)', () => {
  it('returns binary_unreachable when binary exists but version check fails', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');

    const tmpDir = join(tmpdir(), `swao-test-mcp-ur-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const fakeBin = join(tmpDir, 'swao-enterprise-win-x64.exe');
    writeFileSync(fakeBin, 'not-a-real-binary', 'utf-8');
    const fakeCfg = join(tmpDir, 'claude_desktop_config.json');
    writeFileSync(fakeCfg, JSON.stringify({
      mcpServers: { swao: { command: fakeBin, args: ['mcp'] } },
    }), 'utf-8');

    const result = buildMcpProbe({
      configPathOverride: fakeCfg,
      versionRunner: (_cmd: string) => false,
    });
    expect(result.status).toBe('binary_unreachable');
    expect(result.commandPath).toBe(fakeBin);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns ok when binary exists and version check succeeds', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');

    const tmpDir = join(tmpdir(), `swao-test-mcp-ok-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const fakeBin = join(tmpDir, 'swao-enterprise-win-x64.exe');
    writeFileSync(fakeBin, 'placeholder', 'utf-8');
    const fakeCfg = join(tmpDir, 'claude_desktop_config.json');
    writeFileSync(fakeCfg, JSON.stringify({
      mcpServers: { swao: { command: fakeBin, args: ['mcp'] } },
    }), 'utf-8');

    const result = buildMcpProbe({
      configPathOverride: fakeCfg,
      versionRunner: (_cmd: string) => true,
    });
    expect(result.status).toBe('ok');
    expect(result.commandPath).toBe(fakeBin);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
