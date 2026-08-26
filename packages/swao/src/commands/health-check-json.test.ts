// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// #0573: buildDoctorPayload moved to @swao/module-doctor and now takes injected
// host deps (DoctorHostDeps). This test stays host-side because constructing
// the real payload requires the host-coupled probe builders (playwright / VCS
// auth / imports). The host wires them at the swao/src/index.ts injection site;
// here we supply the same three builders directly.
import { buildHealthCheckPayload, buildHealthCheckLogContext } from '@swao/module-health-check';
import type { HealthCheckPayload, HealthCheckHostDeps, BuildHealthCheckContext } from '@swao/module-health-check';
import { buildVcsAuthProbe } from '../health-check/vcs-auth-probe.js';
import { buildImportsProbe } from '../context/imports-probe.js';
// #1434: the audit-remote-ingestion probe was removed with the audit
// assessment surface; the health-check now runs 13 probes.
import { llmGatewayProbeContribution } from '@swao/module-llm-providers';

const hostDeps: HealthCheckHostDeps = {
  // Deferred playwright import (sprint-038 #0350): keep `--version`/`--help`
  // off the ~50MB playwright-core path. Same shape as swao/src/index.ts.
  buildPlaywrightProbe: async () => (await import('../crawl/playwright-driver.js')).buildPlaywrightProbe(),
  buildVcsAuthProbe,
  buildImportsProbe,
  // #1402 sprint-113: LLM-Gateway connector probe contribution.
  llmGatewayProbe: llmGatewayProbeContribution,
};

let tmp: string;
let payload: HealthCheckPayload;

beforeAll(async () => {
  process.env['SWAO_LICENSE_TIER_OVERRIDE'] = 'community';
  tmp = mkdtempSync(join(tmpdir(), 'swao-health-check-json-'));
  // Single in-process call -- Playwright detection takes a couple of seconds
  // so we share one payload across the unit assertions.
  payload = await buildHealthCheckPayload(tmp, hostDeps);
}, 60_000);

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env['SWAO_LICENSE_TIER_OVERRIDE'];
});

describe('buildHealthCheckPayload (#0024 / #0192)', () => {
  it('returns an object with all 7 probe sections', () => {
    expect(payload).toHaveProperty('license');
    expect(payload).toHaveProperty('playwright');
    expect(payload).toHaveProperty('mcp');
    expect(payload).toHaveProperty('community_frameworks');
    expect(payload).toHaveProperty('imports');
    expect(payload).toHaveProperty('traceability');
    expect(payload).toHaveProperty('bi_export');
    // #1434: the audit_remote_ingestion section was removed with the audit
    // assessment surface.
    expect(payload).not.toHaveProperty('audit_remote_ingestion');
  });

  it('license section contains the auditor-relevant fields', () => {
    expect(payload.license).toHaveProperty('status');
    expect(payload.license).toHaveProperty('tier');
    expect(payload.license).toHaveProperty('fingerprint');
  });

  it('imports section reports absent on a workspace without context_inputs', () => {
    expect(['absent', 'fail']).toContain(payload.imports.status);
  });

  it('community_frameworks reports absent when no catalogs/ exists', () => {
    expect(payload.community_frameworks.status).toBe('absent');
  });

  it('traceability reports absent on a workspace with no apps/<id>/wsp', () => {
    expect(payload.traceability.status).toBe('absent');
  });

  it('bi_export reports absent when no wsp/exports/<ts>/ exists', () => {
    expect(payload.bi_export.status).toBe('absent');
  });
});

// #1094: unit test for buildHealthCheckLogContext without spawning the CLI.
describe('buildHealthCheckLogContext (#1094)', () => {
  it('maps probe results to compact per-probe log context', () => {
    const mockCtx: BuildHealthCheckContext = {
      licenseProbe: { status: 'ok', tier: 'community', assessments_used: 0, days_elapsed: 0, warning: null },
      licenseInvalid: false,
      fingerprint: 'abc12345',
      playwrightProbe: { status: 'ok', version: '1.0.0', path: '/usr/bin/chromium', error: null },
      mcpProbe: { status: 'not_installed', configPath: '/home/.claude/config.json', commandPath: null },
      communityFrameworksProbe: {
        status: 'absent', catalogs_dir: '', standard_count: 0, community_count: 0,
        collisions: [], warnings: [], errors: [], frameworks: [],
      },
      importsProbe: { status: 'absent', message: 'no imports', findings: [] },
      traceabilityProbe: { status: 'absent', message: 'no apps', apps: [], targets: [] },
      biExportProbe: { status: 'absent', bundle_dir: null, message: 'no exports', findings: [] },
      scopeProbe: {
        status: 'absent', apps_with_scope: 0, apps_total: 0, total_blind_spots: 0,
        closed: 0, partial: 0, open: 0, coverage_ratio: null, message: 'no apps',
      },
      prerequisitesProbe: { status: 'ok', message: 'all tools found', tools: [] },
      vcsAuthProbe: { status: 'info', message: 'no apps', apps: [] },
      ingestionProbe: { status: 'info', file_count: 0, has_manifest: false, message: 'no ingestion' },
      llmGatewayProbe: { ok: true, message: '[PASS] 5 connector(s) discovered' },
      iacToolchainProbe: { status: 'warn', tools: [], message: 'no IaC tools found' },
      wspMetadataProbe: { status: 'absent', engagement_name: '', warnings: [], message: 'no .swao.yml' },
      lzCatalogueCoverageProbe: { status: 'ok', message: 'No LZ catalogues directory found -- bundled catalogues may not be installed', detail: '', gaps_count: 0 },
    };
    const ctx = buildHealthCheckLogContext(mockCtx, []);
    expect(ctx['fail_count']).toBe(0);
    expect(ctx['probe_count']).toBe(15);
    const probes = ctx['probes'] as Record<string, Record<string, unknown>>;
    expect(probes['license']['status']).toBe('ok');
    expect(probes['playwright']['status']).toBe('ok');
    expect(probes['mcp']['status']).toBe('not_installed');
    expect(probes['community_frameworks']['status']).toBe('absent');
    expect(probes['community_frameworks']['community_count']).toBe(0);
    // #1434: audit_remote_ingestion no longer appears in the log context.
    expect(probes).not.toHaveProperty('audit_remote_ingestion');
    expect(probes['ingestion']['file_count']).toBe(0);
  });

  it('records failed probes in fail_count and failed_probes array', () => {
    const mockCtx: BuildHealthCheckContext = {
      licenseProbe: { status: 'invalid', tier: 'unknown', assessments_used: 0, days_elapsed: 0, warning: 'expired' },
      licenseInvalid: true,
      fingerprint: 'deadbeef',
      playwrightProbe: { status: 'fail', version: null, path: null, error: 'not found' },
      mcpProbe: { status: 'not_installed', configPath: '', commandPath: null },
      communityFrameworksProbe: {
        status: 'fail', catalogs_dir: '', standard_count: 0, community_count: 0,
        collisions: [], warnings: [], errors: ['missing'], frameworks: [],
      },
      importsProbe: { status: 'absent', message: '', findings: [] },
      traceabilityProbe: { status: 'absent', message: '', apps: [], targets: [] },
      biExportProbe: { status: 'absent', bundle_dir: null, message: '', findings: [] },
      scopeProbe: {
        status: 'absent', apps_with_scope: 0, apps_total: 0, total_blind_spots: 0,
        closed: 0, partial: 0, open: 0, coverage_ratio: null, message: '',
      },
      prerequisitesProbe: { status: 'ok', message: '', tools: [] },
      vcsAuthProbe: { status: 'info', message: '', apps: [] },
      ingestionProbe: { status: 'info', file_count: 0, has_manifest: false, message: '' },
      llmGatewayProbe: { ok: true, message: '[PASS] 5 connector(s) discovered' },
      iacToolchainProbe: { status: 'warn', tools: [], message: 'no IaC tools found' },
      wspMetadataProbe: { status: 'absent', engagement_name: '', warnings: [], message: 'no .swao.yml' },
      lzCatalogueCoverageProbe: { status: 'ok', message: 'No LZ catalogues directory found -- bundled catalogues may not be installed', detail: '', gaps_count: 0 },
    };
    const failedProbes = ['license', 'playwright', 'community-frameworks'];
    const ctx = buildHealthCheckLogContext(mockCtx, failedProbes);
    expect(ctx['fail_count']).toBe(3);
    expect(ctx['failed_probes']).toEqual(failedProbes);
    const probes = ctx['probes'] as Record<string, Record<string, unknown>>;
    expect(probes['license']['status']).toBe('invalid');
    expect(probes['playwright']['status']).toBe('fail');
  });
});

describe('swao doctor CLI smoke (#0024)', () => {
  // Single spawn-based smoke that proves CLI wiring of --format json.
  // Older per-assertion spawns lived here pre-#0192 and added ~150s to
  // the full vitest suite; the unit assertions above cover format
  // correctness via `buildDoctorPayload` directly.
  it('CLI emits parseable JSON with the same payload shape', () => {
    // Use the compiled dist/index.js instead of tsx src/index.ts to avoid
    // the tsx transpilation overhead + Windows grandchild-pipe hang (#1415)
    // that causes spawnSync to time out before the process completes.
    const cli = join(__dirname, '..', '..', 'dist', 'index.js');
    const result = spawnSync(process.execPath, [cli, 'health-check', '--workspace', tmp, '--format', 'json'], {
      encoding: 'utf-8',
      cwd: join(__dirname, '..', '..'),
      env: { ...process.env, SWAO_LICENSE_TIER_OVERRIDE: 'community' },
      timeout: 110_000,
    });
    const stdout = result.stdout ?? '';
    const jsonStart = stdout.indexOf('{');
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    const json = JSON.parse(stdout.slice(jsonStart));
    expect(json).toHaveProperty('license');
    expect(json).toHaveProperty('bi_export');
  }, 120_000);

  // #1095: assert the NDJSON log file is written with start + complete events
  // including per-probe detail. The log is a side-effect of the spawn above;
  // this test must run after 'CLI emits parseable JSON' (same describe block,
  // so Vitest runs them in declaration order).
  it('CLI writes health-check.start and health-check.complete to NDJSON log (#1095)', () => {
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const logPath = join(tmp, 'wsp', 'logs', `portfolio-events-${month}.ndjson`);
    expect(existsSync(logPath), `log file missing at ${logPath}`).toBe(true);

    const lines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
    const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);

    const startEvent = events.find((e) => e['code'] === 'health-check.start');
    expect(startEvent, 'health-check.start event missing from log').toBeDefined();
    expect((startEvent!['context'] as Record<string, unknown>)['workspace']).toBe(tmp);

    const completeEvent = events.find((e) => e['code'] === 'health-check.complete');
    expect(completeEvent, 'health-check.complete event missing from log').toBeDefined();
    const ctx = completeEvent!['context'] as Record<string, unknown>;
    expect(typeof ctx['fail_count']).toBe('number');
    expect(typeof ctx['probe_count']).toBe('number');
    expect(ctx['probe_count']).toBe(15);

    // #1094: verify per-probe detail is present (the key addition)
    const probes = ctx['probes'] as Record<string, unknown>;
    expect(probes, 'probes object missing from health-check.complete context').toBeDefined();
    const probeKeys = [
      'license', 'playwright', 'mcp', 'community_frameworks',
      'imports', 'traceability', 'bi_export', 'scope',
      'prerequisites', 'vcs_auth', 'ingestion',
      'iac_toolchain', 'wsp_metadata',
    ];
    for (const key of probeKeys) {
      expect(probes, `probe '${key}' missing from log context`).toHaveProperty(key);
    }
    const licenseProbe = probes['license'] as Record<string, unknown>;
    expect(licenseProbe).toHaveProperty('status');
    // #1434: audit_remote_ingestion no longer appears in the log context.
    expect(probes).not.toHaveProperty('audit_remote_ingestion');
    const ingestionProbe = probes['ingestion'] as Record<string, unknown>;
    expect(ingestionProbe).toHaveProperty('file_count');
  }, 10_000);
});
