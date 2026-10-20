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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, mkdtempSync, readFileSync } from 'fs';
import type { ClaudeDesktopConfigCandidate } from '@swao/core';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UTIL_SRC   = resolve(__dirname, './claude-desktop.ts');

// #3163: the probe now scans every Claude Desktop config. Point APPDATA,
// LOCALAPPDATA, HOME and USERPROFILE at an empty temp dir for every test so
// calls without an override never read the operator's real configs.
const SANDBOX_ENV_KEYS = ['APPDATA', 'LOCALAPPDATA', 'HOME', 'USERPROFILE'] as const;
let savedEnv: Record<string, string | undefined> = {};
let envSandbox = '';
beforeEach(() => {
  savedEnv = Object.fromEntries(SANDBOX_ENV_KEYS.map((k) => [k, process.env[k]]));
  envSandbox = mkdtempSync(join(tmpdir(), 'swao-test-mcp-env-'));
  process.env['APPDATA'] = join(envSandbox, 'Roaming');
  process.env['LOCALAPPDATA'] = join(envSandbox, 'Local');
  process.env['HOME'] = envSandbox;
  process.env['USERPROFILE'] = envSandbox;
});
afterEach(() => {
  for (const k of SANDBOX_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(envSandbox, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Utility module -- structure
// ---------------------------------------------------------------------------

describe('src/probes/claude-desktop.ts -- structure', () => {
  it('file exists', () => {
    expect(existsSync(UTIL_SRC)).toBe(true);
  });

  // First dynamic import of the probe module is cold (it pulls in @swao/core);
  // under a parallel workspace run it exceeds the 5 s default (#3317).
  it('exports claudeDesktopConfigPath', async () => {
    const mod = await import('./claude-desktop.js');
    expect(typeof mod.claudeDesktopConfigPath).toBe('function');
  }, 60_000);

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

// ---------------------------------------------------------------------------
// buildMcpProbe -- every Claude Desktop config (#3163)
// ---------------------------------------------------------------------------
//
// All paths live in a temp sandbox and the candidates are passed explicitly,
// so these tests never read the operator's real Claude Desktop configs.

describe('buildMcpProbe() -- MSIX and conventional configs (#3163)', () => {
  function sandbox() {
    const root = mkdtempSync(join(tmpdir(), 'swao-test-mcp-multi-'));
    const msix = join(root, 'Local', 'Packages', 'Claude_x', 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json');
    const conventional = join(root, 'Roaming', 'Claude', 'claude_desktop_config.json');
    const currentDir = join(root, 'swao-v1.4.0');
    const oldDir = join(root, 'swao-v1.2.1');
    mkdirSync(currentDir, { recursive: true });
    mkdirSync(oldDir, { recursive: true });
    const current = join(currentDir, 'swao-enterprise-win-x64.exe');
    const old = join(oldDir, 'swao-enterprise-win-x64.exe');
    writeFileSync(current, 'placeholder', 'utf-8');
    const candidates: ClaudeDesktopConfigCandidate[] = [
      { path: msix, kind: 'msix', effective: true },
      { path: conventional, kind: 'conventional', effective: false },
    ];
    const writeCfg = (p: string, command: string) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify({ mcpServers: { swao: { command, args: ['mcp'] } } }), 'utf-8');
    };
    return { root, msix, conventional, current, old, oldDir, candidates, writeCfg };
  }

  it('warns when the conventional config keeps a SWAO entry whose binary no longer exists', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');
    const s = sandbox();
    try {
      s.writeCfg(s.msix, s.current);
      s.writeCfg(s.conventional, s.old); // old binary was deleted
      const result = buildMcpProbe({ configCandidates: s.candidates, runningBinary: s.current, versionRunner: () => true });
      expect(result.status).toBe('stale_entry');
      expect(result.configPath).toBe(s.msix);
      expect(result.configsChecked).toEqual([s.msix, s.conventional]);
      expect(result.staleEntries).toEqual([{ configPath: s.conventional, kind: 'conventional', commandPath: s.old, reason: 'binary_not_found' }]);
      expect(result.message).toContain(s.conventional);
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });

  it('warns when a config points at an existing binary that is not the running one', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');
    const s = sandbox();
    try {
      writeFileSync(s.old, 'placeholder', 'utf-8');
      s.writeCfg(s.msix, s.old);
      const result = buildMcpProbe({ configCandidates: s.candidates, runningBinary: s.current, versionRunner: () => true });
      expect(result.status).toBe('stale_entry');
      expect(result.staleEntries?.[0]).toMatchObject({ configPath: s.msix, reason: 'not_running_binary' });
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });

  it('is ok when every SWAO entry points at the running binary folder', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');
    const s = sandbox();
    try {
      s.writeCfg(s.msix, s.current);
      s.writeCfg(s.conventional, s.current);
      const result = buildMcpProbe({ configCandidates: s.candidates, runningBinary: join(dirname(s.current), 'swao-win-x64.exe'), versionRunner: () => true });
      expect(result.status).toBe('ok');
      expect(result.staleEntries).toEqual([]);
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });

  it('skips the running-binary comparison when not running as a SWAO binary (runningBinary null)', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');
    const s = sandbox();
    try {
      writeFileSync(s.old, 'placeholder', 'utf-8');
      s.writeCfg(s.msix, s.old);
      const result = buildMcpProbe({ configCandidates: s.candidates, runningBinary: null, versionRunner: () => true });
      expect(result.status).toBe('ok');
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });

  it('reports a stale conventional entry even when the effective MSIX config is absent', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');
    const s = sandbox();
    try {
      s.writeCfg(s.conventional, s.old);
      const result = buildMcpProbe({ configCandidates: s.candidates, runningBinary: s.current, versionRunner: () => true });
      expect(result.status).toBe('stale_entry');
      expect(result.configPath).toBe(s.msix);
      expect(result.staleEntries).toHaveLength(1);
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });

  it('keeps the effective status and still lists the other config when the effective binary is missing', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');
    const s = sandbox();
    try {
      s.writeCfg(s.msix, s.old);
      s.writeCfg(s.conventional, join(s.oldDir, 'swao-consultant-win-x64.exe'));
      const result = buildMcpProbe({ configCandidates: s.candidates, runningBinary: s.current, versionRunner: () => true });
      expect(result.status).toBe('binary_not_found');
      expect(result.staleEntries?.map((e) => e.configPath)).toEqual([s.conventional]);
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });

  it('does not flag a source-variant entry (node + dist/index.js) the patcher never rewrites', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');
    const s = sandbox();
    try {
      s.writeCfg(s.msix, s.current);
      mkdirSync(dirname(s.conventional), { recursive: true });
      writeFileSync(s.conventional, JSON.stringify({
        mcpServers: { swao: { command: join(s.root, 'nodejs', 'node.exe'), args: [join(s.root, 'repo', 'packages', 'swao', 'dist', 'index.js'), 'mcp'] } },
      }), 'utf-8');
      const result = buildMcpProbe({ configCandidates: s.candidates, runningBinary: s.current, versionRunner: () => true });
      expect(result.status).toBe('ok');
      expect(result.staleEntries).toEqual([]);
      expect(result.configsChecked).toEqual([s.msix, s.conventional]);
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------------------
// #3295: node-registered entries (source run) under a custom key
// ---------------------------------------------------------------------------

describe('buildMcpProbe() -- node-registered SWAO entry (#3295)', () => {
  function sandbox(writeScript: boolean) {
    // Prefix without 'swao': the legacy fallback accepts any command path containing 'swao'.
    const root = mkdtempSync(join(tmpdir(), 'mcp-node-probe-'));
    const node = join(root, 'nodejs', 'node.exe');
    const script = join(root, 'repo', 'swao', 'packages', 'swao', 'dist', 'index.js');
    mkdirSync(dirname(node), { recursive: true });
    writeFileSync(node, 'placeholder', 'utf-8');
    if (writeScript) {
      mkdirSync(dirname(script), { recursive: true });
      writeFileSync(script, '// placeholder', 'utf-8');
    }
    const configPath = join(root, 'claude_desktop_config.json');
    writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        other: { command: join(root, 'tools', 'other.exe') },
        'swao-dev': { command: node, args: [script, 'mcp'] },
      },
    }), 'utf-8');
    return { root, node, script, configPath };
  }

  it('reports a node-registered entry under a custom key as present (ok)', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');
    const s = sandbox(true);
    try {
      const result = buildMcpProbe({ configPathOverride: s.configPath, runningBinary: null, versionRunner: () => true });
      expect(result.status).toBe('ok');
      expect(result.commandPath).toBe(s.node);
      expect(result.staleEntries).toEqual([]);
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });

  it('reports binary_not_found with the script path when the SWAO entry script is gone', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');
    const s = sandbox(false);
    try {
      const result = buildMcpProbe({ configPathOverride: s.configPath, runningBinary: null, versionRunner: () => true });
      expect(result.status).toBe('binary_not_found');
      expect(result.commandPath).toBe(s.script);
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });

  it('still reports missing_entry for a node entry that does not run a SWAO script', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');
    const s = sandbox(true);
    try {
      writeFileSync(s.configPath, JSON.stringify({
        mcpServers: { tool: { command: s.node, args: [join(s.root, 'other-mcp', 'dist', 'index.js')] } },
      }), 'utf-8');
      const result = buildMcpProbe({ configPathOverride: s.configPath, runningBinary: null, versionRunner: () => true });
      expect(result.status).toBe('missing_entry');
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------------------
// #3333: slow --version is "slow to respond", not "unreachable"; one retry
// ---------------------------------------------------------------------------

describe('runVersionCheck() / buildMcpProbe() -- slow binary (#3333)', () => {
  // A fake SWAO binary: `node <script> --version`. The script appends one line
  // per start to a counter file, then sleeps `delayMs` (or `firstDelayMs` on the
  // first start only, a cold start) and exits with `exitCode`.
  function fakeBinary(opts: { delayMs?: number; firstDelayMs?: number; exitCode?: number }): { dir: string; script: string; starts: () => number } {
    const dir = mkdtempSync(join(tmpdir(), 'swao-test-mcp-slow-'));
    const counter = join(dir, 'starts.txt');
    const script = join(dir, 'fake-swao.cjs');
    const first = opts.firstDelayMs ?? opts.delayMs ?? 0;
    writeFileSync(script, [
      "const fs = require('fs');",
      `const counter = ${JSON.stringify(counter)};`,
      "const n = fs.existsSync(counter) ? fs.readFileSync(counter, 'utf-8').length : 0;",
      "fs.appendFileSync(counter, 'x');",
      `const delay = n === 0 ? ${first} : ${opts.delayMs ?? 0};`,
      `setTimeout(() => { console.log('SWAO 1.4.0'); process.exit(${opts.exitCode ?? 0}); }, delay);`,
      '',
    ].join('\n'));
    const starts = (): number => (existsSync(counter) ? readFileSync(counter, 'utf-8').length : 0);
    return { dir, script, starts };
  }

  it('the default per-attempt timeout is 20 s (was 5 s)', async () => {
    const { VERSION_CHECK_TIMEOUT_MS } = await import('./claude-desktop.js');
    expect(VERSION_CHECK_TIMEOUT_MS).toBe(20_000);
  });

  it('a binary that answers inside the timeout is ok after one start', async () => {
    const { runVersionCheck } = await import('./claude-desktop.js');
    const f = fakeBinary({ delayMs: 0 });
    try {
      expect(runVersionCheck(process.execPath, { argsPrefix: [f.script], timeoutMs: 10_000 })).toBe('ok');
      expect(f.starts()).toBe(1);
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  it('a cold start over the timeout is retried once and reported ok when the warm start answers', async () => {
    const { runVersionCheck } = await import('./claude-desktop.js');
    const f = fakeBinary({ firstDelayMs: 30_000, delayMs: 0 });
    try {
      expect(runVersionCheck(process.execPath, { argsPrefix: [f.script], timeoutMs: 5_000 })).toBe('ok');
      expect(f.starts()).toBe(2);
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  }, 60_000);

  it('a binary that times out on every attempt is slow, after exactly 2 starts', async () => {
    const { runVersionCheck } = await import('./claude-desktop.js');
    const f = fakeBinary({ delayMs: 30_000 });
    try {
      expect(runVersionCheck(process.execPath, { argsPrefix: [f.script], timeoutMs: 5_000 })).toBe('slow');
      expect(f.starts()).toBe(2);
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  }, 60_000);

  it('a binary that exits non-zero is failed, without a retry', async () => {
    const { runVersionCheck } = await import('./claude-desktop.js');
    const f = fakeBinary({ delayMs: 0, exitCode: 3 });
    try {
      expect(runVersionCheck(process.execPath, { argsPrefix: [f.script], timeoutMs: 10_000 })).toBe('failed');
      expect(f.starts()).toBe(1);
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  it('a missing binary is failed', async () => {
    const { runVersionCheck } = await import('./claude-desktop.js');
    expect(runVersionCheck(join(tmpdir(), 'no-such-swao-3333.exe'), { timeoutMs: 2_000 })).toBe('failed');
  });

  function probeFixture(withStale: boolean): { root: string; candidates: ClaudeDesktopConfigCandidate[]; running: string } {
    const root = mkdtempSync(join(tmpdir(), 'swao-test-mcp-slowprobe-'));
    const current = join(root, 'current');
    const old = join(root, 'old');
    mkdirSync(current);
    mkdirSync(old);
    const curBin = join(current, 'swao-enterprise-win-x64.exe');
    const oldBin = join(old, 'swao-enterprise-win-x64.exe');
    writeFileSync(curBin, 'placeholder');
    writeFileSync(oldBin, 'placeholder');
    const effective = join(root, 'msix.json');
    const other = join(root, 'conventional.json');
    writeFileSync(effective, JSON.stringify({ mcpServers: { swao: { command: curBin, args: ['mcp'] } } }));
    writeFileSync(other, JSON.stringify({ mcpServers: { swao: { command: withStale ? oldBin : curBin, args: ['mcp'] } } }));
    return {
      root,
      running: curBin,
      candidates: [
        { path: effective, kind: 'msix', effective: true },
        { path: other, kind: 'conventional', effective: false },
      ],
    };
  }

  it('buildMcpProbe reports binary_slow (not binary_unreachable) when --version only times out', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');
    const s = probeFixture(false);
    try {
      const result = buildMcpProbe({ configCandidates: s.candidates, runningBinary: s.running, versionRunner: () => 'slow' });
      expect(result.status).toBe('binary_slow');
      expect(result.commandPath).toBe(s.running);
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });

  it('the verdict is stable for an unchanged config: stale_entry whether --version is fast or slow', async () => {
    const { buildMcpProbe } = await import('./claude-desktop.js');
    const s = probeFixture(true);
    try {
      const fast = buildMcpProbe({ configCandidates: s.candidates, runningBinary: s.running, versionRunner: () => 'ok' });
      const slow = buildMcpProbe({ configCandidates: s.candidates, runningBinary: s.running, versionRunner: () => 'slow' });
      expect(fast.status).toBe('stale_entry');
      expect(slow.status).toBe('stale_entry');
      expect(slow.staleEntries).toEqual(fast.staleEntries);
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });

  it('buildMcpProbe drives a real slow fake binary end to end', async () => {
    const { buildMcpProbe, runVersionCheck } = await import('./claude-desktop.js');
    const s = probeFixture(false);
    const f = fakeBinary({ delayMs: 30_000 });
    try {
      const result = buildMcpProbe({
        configCandidates: s.candidates,
        runningBinary: s.running,
        versionRunner: () => runVersionCheck(process.execPath, { argsPrefix: [f.script], timeoutMs: 5_000 }),
      });
      expect(result.status).toBe('binary_slow');
      expect(f.starts()).toBe(2);
    } finally {
      rmSync(s.root, { recursive: true, force: true });
      rmSync(f.dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('the health-check formatter prints "slow to respond" for binary_slow, distinct from "did not respond"', async () => {
    const { readFileSync: rf } = await import('fs');
    const { resolve: res } = await import('path');
    const src = rf(res(__dirname, '../commands/health-check.ts'), 'utf-8');
    expect(src).toMatch(/case 'binary_slow':[\s\S]{0,300}slow to respond to --version/);
    expect(src).toMatch(/case 'binary_unreachable':[\s\S]{0,200}did not respond to --version/);
  });
});
