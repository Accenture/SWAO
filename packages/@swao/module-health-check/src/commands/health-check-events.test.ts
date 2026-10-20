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

// #3171: the v1.4.0 run logged 25 health-check.probe.complete events but only
// 18 health-check.probe.start events; probes [19]-[25] had no start and a
// cumulative elapsed_ms. This drives the real probe runner and asserts every
// probe emits start then complete as an adjacent pair.
//
// Sandboxing: APPDATA, LOCALAPPDATA, HOME and USERPROFILE point at a temp dir
// so the MCP probe never reads the operator's real Claude Desktop configs;
// child_process is mocked so no host tool is spawned; licence paths are
// redirected via _paths.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { events, probeRuns } = vi.hoisted(() => ({
  events: [] as Array<{ code: string; probe: unknown }>,
  // #3215: how often each probe that the --json branch used to re-run executes.
  probeRuns: { ingestion: 0, iac_toolchain: 0, wsp_metadata: 0 },
}));

vi.mock('../probes/ingestion-probe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../probes/ingestion-probe.js')>();
  return { ...actual, buildIngestionProbe: (...a: Parameters<typeof actual.buildIngestionProbe>) => { probeRuns.ingestion++; return actual.buildIngestionProbe(...a); } };
});
vi.mock('../probes/iac-toolchain-probe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../probes/iac-toolchain-probe.js')>();
  return { ...actual, buildIaCToolchainProbe: (...a: Parameters<typeof actual.buildIaCToolchainProbe>) => { probeRuns.iac_toolchain++; return actual.buildIaCToolchainProbe(...a); } };
});
vi.mock('../probes/wsp-metadata-probe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../probes/wsp-metadata-probe.js')>();
  return { ...actual, buildWspMetadataProbe: (...a: Parameters<typeof actual.buildWspMetadataProbe>) => { probeRuns.wsp_metadata++; return actual.buildWspMetadataProbe(...a); } };
});

vi.mock('child_process', () => ({
  spawnSync: vi.fn(() => ({ pid: 0, output: [], stdout: '', stderr: '', status: null, signal: null, error: new Error('ENOENT') })),
}));

vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return {
    ...actual,
    logPortfolio: (_level: string, code: string, _message: string, opts?: { context?: Record<string, unknown> }) => {
      if (code === 'health-check.probe.start' || code === 'health-check.probe.complete') {
        events.push({ code, probe: opts?.context?.['probe'] });
      }
    },
  };
});

import { _paths } from '@swao/core';
import { Command } from 'commander';
import { buildHealthCheckPayload, registerHealthCheck } from './health-check.js';
import type { HealthCheckHostDeps } from './health-check.js';
import { PROBE_TOTAL } from '../probes/service-probes.js';

const ENV_KEYS = ['APPDATA', 'LOCALAPPDATA', 'HOME', 'USERPROFILE', 'SWAO_MCP_CONTEXT'] as const;
const savedEnv: Record<string, string | undefined> = {};
let sandbox: string;
let workspace: string;

const hostDeps: HealthCheckHostDeps = {
  buildPlaywrightProbe: async () => ({ status: 'warn', version: null, path: null, error: 'stubbed' }),
  buildVcsAuthProbe: async () => ({ status: 'info', message: 'no apps', apps: [] }),
  buildImportsProbe: () => ({ status: 'absent', message: 'no imports', findings: [] }),
  llmGatewayProbe: { id: 'llm-gateway', name: 'LLM gateway', run: async () => ({ ok: null, message: 'stubbed' }) },
};

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'swao-hc-events-'));
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
  writeFileSync(join(workspace, '.swao.yml'), 'wsp_version: "0.9"\nengagement:\n  name: events-test\n');
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(sandbox, { recursive: true, force: true });
});

describe('health-check probe event sequence (#3171)', () => {
  it('every probe, including [19]-[25], emits probe.start immediately before probe.complete', async () => {
    events.length = 0;
    await buildHealthCheckPayload(workspace, hostDeps);

    const starts = events.filter((e) => e.code === 'health-check.probe.start');
    const completes = events.filter((e) => e.code === 'health-check.probe.complete');
    expect(starts).toHaveLength(PROBE_TOTAL);
    expect(completes).toHaveLength(PROBE_TOTAL);
    for (let i = 0; i < events.length; i += 2) {
      expect(events[i]?.code).toBe('health-check.probe.start');
      expect(events[i + 1]).toEqual({ code: 'health-check.probe.complete', probe: events[i]?.probe });
    }
    for (const key of ['service_workspace', 'research_cache', 'vendor_catalog', 'cluster_detection', 'pii_scrub_audit', 'delta_snapshot', 'framework_controls']) {
      expect(starts.map((e) => e.probe)).toContain(key);
    }
  }, 60_000);
});

describe('health-check --json runs each probe once (#3215)', () => {
  it('one probe.start / probe.complete pair per probe and no second ingestion, IaC or wsp_metadata run', async () => {
    events.length = 0;
    probeRuns.ingestion = 0;
    probeRuns.iac_toolchain = 0;
    probeRuns.wsp_metadata = 0;
    const out: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.map(String).join(' ')); });
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as typeof process.exit);
    try {
      const program = new Command('swao').exitOverride();
      registerHealthCheck(program, hostDeps);
      await program.parseAsync(['health-check', '--json', '--workspace', workspace], { from: 'user' });
    } finally {
      log.mockRestore();
      exit.mockRestore();
    }

    expect(probeRuns).toEqual({ ingestion: 1, iac_toolchain: 1, wsp_metadata: 1 });
    const starts = events.filter((e) => e.code === 'health-check.probe.start').map((e) => e.probe);
    const completes = events.filter((e) => e.code === 'health-check.probe.complete').map((e) => e.probe);
    expect(starts).toHaveLength(PROBE_TOTAL);
    expect(completes).toHaveLength(PROBE_TOTAL);
    expect(new Set(starts).size).toBe(PROBE_TOTAL);
    expect(new Set(completes).size).toBe(PROBE_TOTAL);

    // The JSON payload still carries the three probe results.
    const payload = JSON.parse(out.join('\n')) as Record<string, { status?: string }>;
    for (const key of ['ingestion', 'iac_toolchain', 'wsp_metadata']) {
      expect(payload[key]?.status, key).toBeTypeOf('string');
    }
  }, 60_000);
});
