// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health-check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4392: the HTTP MCP endpoint line under the SWAO-MCP probe (injected probe,
// no request); a server that is not running never changes the verdict.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { events } = vi.hoisted(() => ({ events: [] as Array<{ code: string; probe: unknown }> }));

vi.mock('child_process', () => ({
  spawnSync: vi.fn(() => ({ pid: 0, output: [], stdout: '', stderr: '', status: null, signal: null, error: new Error('ENOENT') })),
}));

vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return {
    ...actual,
    logPortfolio: (_level: string, code: string, _message: string, opts?: { context?: Record<string, unknown> }) => {
      if (code === 'health-check.probe.start') events.push({ code, probe: opts?.context?.['probe'] });
    },
  };
});

import { _paths, SETUP_SCOPES } from '@swao/core';
import { Command } from 'commander';
import { registerHealthCheck } from './health-check.js';
import type { HealthCheckHostDeps } from './health-check.js';
import { summariseHealthCheckOutput } from '../tui/components/health-check-parse.js';

const ENV_KEYS = ['APPDATA', 'LOCALAPPDATA', 'HOME', 'USERPROFILE', 'SWAO_MCP_CONTEXT'] as const;
const savedEnv: Record<string, string | undefined> = {};
let sandbox: string;
let workspace: string;

const hostDeps: HealthCheckHostDeps = {
  buildPlaywrightProbe: async () => ({ status: 'warn', version: null, path: null, error: 'stubbed' }),
  buildVcsAuthProbe: async () => ({ status: 'info', message: 'no apps', apps: [] }),
  buildImportsProbe: () => ({ status: 'absent', message: 'no imports', findings: [] }),
  llmGatewayProbe: { id: 'llm-gateway', name: 'LLM gateway', run: async () => ({ ok: null, message: 'stubbed' }) },
  buildLzConnectionsProbe: async () => ({ status: 'info', message: 'no live landing zone registered', scopes: [] }),
};

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'swao-hc-scope-'));
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env['APPDATA'] = join(sandbox, 'AppData', 'Roaming');
  process.env['LOCALAPPDATA'] = join(sandbox, 'AppData', 'Local');
  process.env['HOME'] = sandbox;
  process.env['USERPROFILE'] = sandbox;
  delete process.env['SWAO_MCP_CONTEXT'];
  _paths.statePath = join(sandbox, '.swao-state.json');
  _paths.licensePath = join(sandbox, 'licence.json');
  _paths.legacyLicencePath = join(sandbox, '.swao-license.json');
  workspace = mkdtempSync(join(sandbox, 'ws-'));
  writeFileSync(join(workspace, '.swao.yml'), 'wsp_version: "0.9"\nengagement:\n  name: scope-test\n');
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(sandbox, { recursive: true, force: true });
});

async function runCli(args: string[], hostDeps: HealthCheckHostDeps): Promise<{ out: string[]; code: number | undefined }> {
  const out: string[] = [];
  let code: number | undefined;
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.map(String).join(' ')); });
  const err = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { out.push(a.map(String).join(' ')); });
  const exit = vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { code ??= c; throw new Error(`exit ${c}`); }) as typeof process.exit);
  try {
    const program = new Command('swao').exitOverride();
    registerHealthCheck(program, hostDeps);
    await program.parseAsync(['health-check', ...args], { from: 'user' }).catch((e: Error) => { if (!e.message.startsWith('exit')) throw e; });
  } finally {
    log.mockRestore();
    err.mockRestore();
    exit.mockRestore();
  }
  return { out, code };
}

describe('#4392 HTTP MCP endpoint in swao health-check', () => {
  it('not running: one informational line under SWAO-MCP, same failures as without the probe', async () => {
    const base = await runCli(['--workspace', workspace], hostDeps);
    const probed = await runCli(['--workspace', workspace], {
      ...hostDeps,
      mcpHttpProbe: async () => ({ status: 'not_reachable', url: 'http://localhost:3737/mcp', reason: 'ECONNREFUSED' }),
    });
    const text = probed.out.join(' ');
    expect(text).toContain('HTTP endpoint http://localhost:3737/mcp: not running (ECONNREFUSED)');
    expect(base.out.join(' ')).not.toContain('HTTP endpoint');
    expect(summariseHealthCheckOutput(probed.out).failCount).toBe(summariseHealthCheckOutput(base.out).failCount);
    expect(summariseHealthCheckOutput(probed.out).warnCount).toBe(summariseHealthCheckOutput(base.out).warnCount);
    expect(probed.code).toBe(base.code);
  }, 120_000);

  it('reachable: names the owning binary and the workspace', async () => {
    const { out } = await runCli(['--workspace', workspace], {
      ...hostDeps,
      mcpHttpProbe: async () => ({ status: 'reachable', url: 'http://localhost:3737/mcp', version: '1.6.1', pid: 12, workspace: '/ws (saved default)', binary: '/b/swao-enterprise-linux-x64' }),
    });
    const text = out.join(' ');
    expect(text).toContain('reachable, SWAO 1.6.1, pid 12');
    expect(text).toContain('workspace: /ws (saved default)');
    expect(text).toContain('binary: /b/swao-enterprise-linux-x64');
  }, 120_000);
});
