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

// #4197 SET-08 (Design 125 section 6): `swao health-check --type <type>` runs
// the generic probes plus the probes of the type; probes outside the scope are
// neither run nor listed (no "not a service workspace" skip lines), the lines
// are renumbered [k/M], and the unscoped run is unchanged. Sandbox as in
// health-check-events.test.ts.

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
import { buildScopedHealthCheckPayload, buildHealthCheckPayload, registerHealthCheck, parseHealthCheckScope } from './health-check.js';
import type { HealthCheckHostDeps } from './health-check.js';
import { probesForScope, scopedProbeLineEmitter, HEALTH_PROBE_KEYS } from '../probe-scope.js';
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

async function runCli(args: string[]): Promise<{ out: string[]; code: number | undefined }> {
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

describe('scoped health check (#4197)', () => {
  it('runs exactly the probes of each scope', async () => {
    for (const scope of SETUP_SCOPES) {
      events.length = 0;
      const payload = await buildScopedHealthCheckPayload(workspace, hostDeps, scope);
      const started = events.map((e) => e.probe as string);
      expect(started.sort(), scope).toEqual([...probesForScope(scope)].sort());
      if (scope !== 'service') expect(payload.service_probes, scope).toBeUndefined();
      for (const k of HEALTH_PROBE_KEYS) {
        if (k.startsWith('service_') || ['research_cache', 'vendor_catalog', 'cluster_detection', 'pii_scrub_audit', 'delta_snapshot', 'framework_controls'].includes(k)) continue;
        expect(k in payload, `${scope}:${k}`).toBe(probesForScope(scope).includes(k));
      }
    }
  }, 120_000);

  it('the unscoped payload still runs every probe', async () => {
    events.length = 0;
    await buildHealthCheckPayload(workspace, hostDeps);
    expect(events).toHaveLength(HEALTH_PROBE_KEYS.length);
  }, 60_000);

  it('text output of --type application lists its probes renumbered, without the service skip lines', async () => {
    const { out } = await runCli(['--type', 'application', '--workspace', workspace]);
    const summary = summariseHealthCheckOutput(out);
    expect(summary.probeCount).toBe(probesForScope('application').length);
    const headers = out.filter((l) => /^\s*\[\d+\/\d+\]/.test(l));
    expect(headers[0]).toMatch(/^\s*\[1\/15\] /);
    expect(headers[headers.length - 1]).toMatch(/^\s*\[15\/15\] /);
    expect(out.join('\n')).not.toContain('not a service workspace');
  }, 60_000);

  it('json output of --type llm carries only the generic probes', async () => {
    const { out } = await runCli(['--type', 'llm', '--json', '--workspace', workspace]);
    const payload = JSON.parse(out.join('\n')) as Record<string, unknown>;
    for (const k of probesForScope('llm')) expect(payload).toHaveProperty(k);
    expect(payload).not.toHaveProperty('playwright');
    expect(payload).not.toHaveProperty('service_probes');
    expect(payload).not.toHaveProperty('lz_connections');
  }, 60_000);

  it('refuses an unknown type with exit 2', async () => {
    const { out, code } = await runCli(['--type', 'audit', '--workspace', workspace]);
    expect(code).toBe(2);
    expect(out.join('\n')).toContain('unknown --type audit');
  });
});

describe('parseHealthCheckScope and the line renumbering (#4197)', () => {
  it('parses the setup ids, generic and the assess type ids', () => {
    expect(parseHealthCheckScope(undefined)).toBeUndefined();
    expect(parseHealthCheckScope('generic')).toBe('generic');
    expect(parseHealthCheckScope('landing-zone-live')).toBe('lz-live');
    expect(parseHealthCheckScope('LLM')).toBe('llm');
    expect(parseHealthCheckScope('x')).toBeInstanceOf(Error);
  });

  it('renumbers headers and keeps the columns aligned', () => {
    const got: string[] = [];
    const emit = scopedProbeLineEmitter((l) => got.push(l), 'llm')!;
    emit('  [13/26] LLM gateway..........  ok    5 connectors');
    emit('      detail line');
    emit('  [1/26] License...............  ok    Enterprise');
    expect(got[0]).toMatch(/^ {2}\[1\/6\] LLM gateway\.+ {2}ok {4}5 connectors$/);
    expect(got[0]!.length).toBe('  [13/26] LLM gateway..........  ok    5 connectors'.length);
    expect(got[1]).toBe('      detail line');
    expect(got[2]).toMatch(/^ {2}\[2\/6\] License\.+ {2}ok {4}Enterprise$/);
    expect(got[2]!.length).toBe('  [1/26] License...............  ok    Enterprise'.length);
    expect(scopedProbeLineEmitter(undefined, 'llm')).toBeUndefined();
    const raw = (l: string): void => { got.push(l); };
    expect(scopedProbeLineEmitter(raw, undefined)).toBe(raw);
  });
});
