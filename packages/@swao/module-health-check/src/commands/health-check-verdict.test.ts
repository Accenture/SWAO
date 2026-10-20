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

// #3170: one failure definition shared by health-check.complete (fail_count),
// the --json exit code, the text exit code and the text summary line.

import { describe, it, expect } from 'vitest';
import { computeFailedProbes, formatHealthCheckSummaryLine, buildHealthCheckLogContext } from './health-check.js';
import type { BuildHealthCheckContext } from './health-check.js';
import { summariseHealthCheckOutput } from '../tui/components/health-check-parse.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCredentialVaultProbe } from '../probes/credential-vault-probe.js';

function baseHealthCheckCtx(): BuildHealthCheckContext {
  return {
    licenseProbe: { status: 'ok', tier: 'enterprise', assessments_used: 0, days_elapsed: 0, warning: null },
    licenseInvalid: false,
    fingerprint: 'abc12345',
    playwrightProbe: { status: 'ok', version: '1.0.0', path: '/usr/bin/chromium', error: null },
    mcpProbe: { status: 'ok', configPath: '/cfg/claude_desktop_config.json', commandPath: '/bin/swao-enterprise-linux-x64' },
    communityFrameworksProbe: {
      status: 'absent', catalogs_dir: '', standard_count: 0, community_count: 0,
      collisions: [], warnings: [], errors: [], frameworks: [],
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
    iacToolchainProbe: { status: 'ok', tools: [], message: 'ready' },
    wspMetadataProbe: { status: 'absent', engagement_name: '', warnings: [], message: '' },
    lzCatalogueCoverageProbe: { status: 'ok', message: '', detail: '', gaps_count: 0 },
    credentialVaultProbe: { status: 'ok', vaultExists: true, decryptable: true, keyCount: 0, categories: [], message: '' },
    intakeMappingProbe: { status: 'skip', message: '', errors: [], warnings: [] },
    apmWeightsProbe: { status: 'skip', message: '', source: null, errors: [], warnings: [] },
    serviceProbes: [],
  };
}

describe('computeFailedProbes (#3170)', () => {
  it('does not count WARN or binary_not_found as failures (v1.4.0 UAT run shape)', () => {
    const ctx = baseHealthCheckCtx();
    ctx.mcpProbe = { status: 'binary_not_found', configPath: '/cfg', commandPath: '/old/swao-enterprise-win-x64.exe' };
    ctx.prerequisitesProbe = { status: 'warn', message: 'optional tools missing', tools: [] };
    ctx.iacToolchainProbe = { status: 'warn', tools: [], message: 'partial' };
    ctx.llmGatewayProbe = { ok: null, message: 'credential not loaded' };
    expect(computeFailedProbes(ctx)).toEqual([]);
  });

  it('counts every FAIL-level outcome, including probes the NDJSON list used to omit', () => {
    const ctx = baseHealthCheckCtx();
    ctx.importsProbe = { status: 'blocked', message: 'missing column', findings: [] };
    ctx.traceabilityProbe = { status: 'fail', message: '', apps: [], targets: [] };
    ctx.biExportProbe = { status: 'fail', bundle_dir: null, message: '', findings: [] };
    ctx.vcsAuthProbe = { status: 'fail', message: '', apps: [] };
    ctx.llmGatewayProbe = { ok: false, message: 'no connector' };
    ctx.serviceProbes = [{ key: 'vendor_catalog', label: 'Vendor catalogue (Tier 2)', status: 'error', message: 'x', errors: ['x'], warnings: [] }];
    expect(computeFailedProbes(ctx)).toEqual(['imports', 'traceability', 'bi-export', 'vcs-auth', 'llm-gateway', 'vendor-catalog']);
  });

  it('the log context fail_count, the summary line and the wizard summary agree', () => {
    const ctx = baseHealthCheckCtx();
    ctx.licenseInvalid = true;
    ctx.prerequisitesProbe = { status: 'warn', message: '', tools: [] };
    ctx.importsProbe = { status: 'fail', message: '', findings: [] };
    const failed = computeFailedProbes(ctx);
    const logCtx = buildHealthCheckLogContext(ctx, failed);
    const line = formatHealthCheckSummaryLine(failed);
    expect(line).toBe('2 probe(s) failed: license, imports.');
    const wizard = summariseHealthCheckOutput([
      '  [1/25] License...............  FAIL  invalid',
      '  [9/25] Prerequisites.........  WARN  optional tools missing',
      '',
      line,
    ]);
    expect(wizard.failCount).toBe(logCtx['fail_count']);
    expect(wizard.failedProbes).toEqual(logCtx['failed_probes']);
    expect(wizard.warnCount).toBe(1);
  });

  it('prints "All probes passed." when nothing failed', () => {
    expect(formatHealthCheckSummaryLine([])).toBe('All probes passed.');
  });
});

// #3344: a fresh workspace (no credential vault, no LLM configured) must not
// make health-check exit 1; the absent vault is a WARN.
describe('computeFailedProbes: fresh workspace without a credential vault (#3344)', () => {
  it('an absent vault is not a failure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-hc-novault-'));
    try {
      const ctx = baseHealthCheckCtx();
      ctx.credentialVaultProbe = buildCredentialVaultProbe(dir);
      expect(ctx.credentialVaultProbe.status).toBe('warn');
      expect(computeFailedProbes(ctx)).not.toContain('credential-vault');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
