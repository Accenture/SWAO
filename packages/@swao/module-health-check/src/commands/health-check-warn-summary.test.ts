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

// #4260: a probe that is not ok is never logged at info level, and
// health-check.complete states the real outcome with warn_count and
// warned_probes equal to what the Setup Wizard reports in
// setup.health-check.complete (the wizard parses the same text output with
// summariseHealthCheckOutput).
//
// Sandboxing as in health-check-events.test.ts: APPDATA, LOCALAPPDATA, HOME and
// USERPROFILE point at a temp dir; child_process.spawnSync is mocked so no host
// tool is started; licence paths are redirected via _paths.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { events } = vi.hoisted(() => ({
  events: [] as Array<{ level: string; code: string; message: string; context: Record<string, unknown>; mirror: boolean }>,
}));

vi.mock('child_process', () => ({
  spawnSync: vi.fn(() => ({ pid: 0, output: [], stdout: '', stderr: '', status: null, signal: null, error: new Error('ENOENT') })),
}));

vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return {
    ...actual,
    logPortfolio: (level: string, code: string, message: string, opts?: { context?: Record<string, unknown>; mirror?: boolean }) => {
      events.push({ level, code, message, context: opts?.context ?? {}, mirror: opts?.mirror !== false });
    },
  };
});

import { _paths } from '@swao/core';
import { Command } from 'commander';
import {
  registerHealthCheck,
  formatHealthCheckCompleteMessage,
  formatHealthCheckSummaryLine,
  probeLineLogLevel,
  mcpProbeLogFields,
  redactHomePath,
} from './health-check.js';
import type { HealthCheckHostDeps } from './health-check.js';
import { summariseHealthCheckOutput, parseHealthCheckOutput } from '../tui/components/health-check-parse.js';

const ENV_KEYS = ['APPDATA', 'LOCALAPPDATA', 'HOME', 'USERPROFILE', 'SWAO_MCP_CONTEXT'] as const;
const savedEnv: Record<string, string | undefined> = {};
let sandbox: string;
let workspace: string;

const hostDeps: HealthCheckHostDeps = {
  // One WARN probe line (Playwright) besides whatever the sandbox host gives.
  buildPlaywrightProbe: async () => ({ status: 'warn', version: null, path: null, error: 'stubbed' }),
  buildVcsAuthProbe: async () => ({ status: 'info', message: 'no apps', apps: [] }),
  buildImportsProbe: () => ({ status: 'absent', message: 'no imports', findings: [] }),
  llmGatewayProbe: { id: 'llm-gateway', name: 'LLM gateway', run: async () => ({ ok: null, message: 'stubbed' }) },
  detectCodeHealthTools: async () => [],
  buildLzConnectionsProbe: async () => ({ status: 'info', message: 'no live landing zone registered', scopes: [] }),
};

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'swao-hc-warn-'));
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
  writeFileSync(join(workspace, '.swao.yml'), 'wsp_version: "0.9"\nengagement:\n  name: warn-test\n');
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(sandbox, { recursive: true, force: true });
});

async function runText(args: string[]): Promise<string[]> {
  events.length = 0;
  const out: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(...a.map(String).join(' ').split('\n')); });
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as typeof process.exit);
  try {
    const program = new Command('swao').exitOverride();
    registerHealthCheck(program, hostDeps);
    await program.parseAsync(['health-check', '--workspace', workspace, ...args], { from: 'user' });
  } finally {
    log.mockRestore();
    exit.mockRestore();
  }
  return out;
}

describe('#4260 probe log levels and the health-check.complete summary (text run)', () => {
  it('logs every probe line at the level of its status token and never a non-ok status at info', async () => {
    const out = await runText([]);
    const probes = parseHealthCheckOutput(out);
    const completes = events.filter((e) => e.code === 'health-check.probe.complete');
    expect(completes.length).toBe(probes.length);
    const byStatus = completes.map((e) => ({ status: String(e.context['status']), level: e.level }));
    for (const { status, level } of byStatus) {
      if (status === 'fail' || status === 'error' || status === 'invalid' || status === 'blocked') expect(level, status).toBe('error');
      if (status === 'warn' || status === 'binary_unreachable') expect(level, status).toBe('warn');
      if (level === 'info') expect(['ok', 'skip', 'info', 'absent', 'processed', 'not_installed'], status).toContain(status);
    }
    expect(completes.find((e) => e.context['probe'] === 'playwright')?.level).toBe('warn');
    expect(completes.find((e) => e.context['probe'] === 'license')?.level).toBe('info');
    // The probe line is printed, so the console mirror is off for every probe event.
    expect(completes.every((e) => !e.mirror)).toBe(true);
  }, 60_000);

  it('health-check.complete names the warnings and carries the warn list the wizard parses from the same output', async () => {
    const out = await runText([]);
    const complete = events.find((e) => e.code === 'health-check.complete')!;
    const wizard = summariseHealthCheckOutput(out);
    expect(wizard.warnCount).toBeGreaterThan(0);
    expect(complete.context['warn_count']).toBe(wizard.warnCount);
    expect(complete.context['warned_probes']).toEqual(wizard.warnedProbes);
    expect(complete.context['warned_probes']).toContain('Playwright / Chromium');
    expect(complete.message).not.toMatch(/all probes ok/);
    expect(complete.message).toContain(`${wizard.warnCount} warning(s)`);
    expect(complete.level).toBe('warn');
    expect(out).toContain(`Warnings (${wizard.warnCount}): ${wizard.warnedProbes.join(', ')}.`);
    expect(out).not.toContain('All probes passed.');
  }, 60_000);

  it('a scoped run carries the scoped warn list as well', async () => {
    const out = await runText(['--type', 'generic']);
    const complete = events.find((e) => e.code === 'health-check.complete')!;
    const wizard = summariseHealthCheckOutput(out);
    expect(complete.context['scope']).toBe('generic');
    expect(complete.context['warned_probes']).toEqual(wizard.warnedProbes);
    expect(complete.context['warn_count']).toBe(wizard.warnCount);
  }, 60_000);
});

describe('#4260 summary wording', () => {
  it('the complete message never says "all probes ok" when a probe warned or failed', () => {
    expect(formatHealthCheckCompleteMessage({ failedProbes: [], warnedProbes: [], absentProbes: [], appCount: 0 })).toBe('Health-check passed, all probes ok');
    expect(formatHealthCheckCompleteMessage({ failedProbes: [], warnedProbes: ['SWAO-MCP'], absentProbes: [], appCount: 0 })).toBe('Health-check passed with 1 warning(s): SWAO-MCP');
    expect(formatHealthCheckCompleteMessage({ failedProbes: ['license'], warnedProbes: ['SWAO-MCP'], absentProbes: [], appCount: 0 })).toBe('Health-check found 1 failure(s): license; 1 warning(s): SWAO-MCP');
    for (const m of [
      formatHealthCheckCompleteMessage({ failedProbes: [], warnedProbes: ['SWAO-MCP'], absentProbes: ['traceability'], appCount: 1 }),
      formatHealthCheckCompleteMessage({ failedProbes: [], warnedProbes: [], absentProbes: ['scope'], appCount: 0 }),
    ]) {
      expect(m).not.toContain(' -- ');
      expect(m).not.toMatch(/all probes ok/);
    }
  });

  it('the text summary keeps "All probes passed." only for a clean run and adds the warnings line', () => {
    expect(formatHealthCheckSummaryLine([])).toBe('All probes passed.');
    expect(formatHealthCheckSummaryLine([], ['SWAO-MCP'])).toBe('No probe failed.\nWarnings (1): SWAO-MCP.');
    expect(formatHealthCheckSummaryLine(['license'], ['SWAO-MCP', 'IaC toolchain'])).toBe('1 probe(s) failed: license.\nWarnings (2): SWAO-MCP, IaC toolchain.');
  });

  it('the wizard parser reads the warnings line (a check without a probe line counts too) and keeps it off the last probe', () => {
    const lines = [
      '  [1/2] License...........  ok    Community',
      '  [2/2] SWAO-MCP..........  WARN  swao binary found but did not respond to --version (exit_code_1): C:\\swao\\swao.exe',
      '',
      'No probe failed.',
      'Warnings (2): SWAO-MCP, Source access.',
    ];
    const s = summariseHealthCheckOutput(lines);
    expect(s).toMatchObject({ failCount: 0, warnCount: 2, warnedProbes: ['SWAO-MCP', 'Source access'] });
    expect(parseHealthCheckOutput(lines)[1]!.detailLines).toEqual([]);
    // Without the line (older output) the WARN headers are counted.
    expect(summariseHealthCheckOutput(lines.slice(0, 4))).toMatchObject({ warnCount: 1, warnedProbes: ['SWAO-MCP'] });
  });

  it('probeLineLogLevel maps the status token', () => {
    expect(probeLineLogLevel('  [3/26] SWAO-MCP................  WARN  x')).toBe('warn');
    expect(probeLineLogLevel('  [1/26] License.................  FAIL  license key invalid')).toBe('error');
    expect(probeLineLogLevel('  [3/26] SWAO-MCP................  INFO  Claude Desktop not installed')).toBe('info');
    expect(probeLineLogLevel('  [3/26] SWAO-MCP................  ok    configured')).toBe('info');
  });

  it('the mcp probe event names the checked config entry with the home folder redacted, and the reason', () => {
    const home = join(tmpdir(), 'home-4260');
    const fields = mcpProbeLogFields({
      status: 'binary_unreachable',
      configPath: join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
      commandPath: join(tmpdir(), 'swao', 'swao-enterprise-win-x64.exe'),
      reason: 'exit_code_1',
    }, home);
    const cfg = join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
    expect(fields['config_path']).toBe(`<home>${cfg.slice(home.length)}`);
    expect(fields['reason']).toBe('exit_code_1');
    expect(fields['command_path']).toBe(join(tmpdir(), 'swao', 'swao-enterprise-win-x64.exe'));
    expect(mcpProbeLogFields({ status: 'ok', configPath: 'x', commandPath: 'y' }, home)).toEqual({});
    expect(redactHomePath('/elsewhere/file', home)).toBe('/elsewhere/file');
  });
});
