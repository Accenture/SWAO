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

// #4190 SET-01 (Design 125 sections 6, 11): registry test, every probe of the
// health-check payload has `applies_to`, and the branch scopes match the design.

import { describe, it, expect } from 'vitest';
import { SETUP_ASSESSMENT_TYPES, SETUP_SCOPES } from '@swao/core';
import {
  HEALTH_PROBE_KEYS,
  PROBE_APPLIES_TO,
  isProbeInScope,
  probesForScope,
  branchOwnProbes,
} from './probe-scope.js';
import { buildHealthCheckLogContext, type BuildHealthCheckContext } from './commands/health-check.js';
import { SERVICE_PROBE_RUNNERS, PROBE_TOTAL } from './probes/service-probes.js';
import { probes as contributedProbes } from './index.js';

function ctx(): BuildHealthCheckContext {
  return {
    licenseProbe: { status: 'ok', tier: 'enterprise', assessments_used: 0, days_elapsed: 0, warning: null },
    licenseInvalid: false,
    fingerprint: 'abc12345',
    playwrightProbe: { status: 'ok', version: '1.0.0', path: '/usr/bin/chromium', error: null },
    mcpProbe: { status: 'ok', configPath: '/cfg/c.json', commandPath: '/bin/swao' },
    communityFrameworksProbe: { status: 'absent', catalogs_dir: '', standard_count: 0, community_count: 0, collisions: [], warnings: [], errors: [], frameworks: [] },
    importsProbe: { status: 'absent', message: '', findings: [] },
    traceabilityProbe: { status: 'absent', message: '', apps: [], targets: [] },
    biExportProbe: { status: 'absent', bundle_dir: null, message: '', findings: [] },
    scopeProbe: { status: 'absent', apps_with_scope: 0, apps_total: 0, total_blind_spots: 0, closed: 0, partial: 0, open: 0, coverage_ratio: null, message: '' },
    prerequisitesProbe: { status: 'ok', message: '', tools: [] },
    vcsAuthProbe: { status: 'info', message: '', apps: [] },
    ingestionProbe: { status: 'info', file_count: 0, has_manifest: false, message: '' },
    llmGatewayProbe: { ok: true, message: 'ok' },
    iacToolchainProbe: { status: 'ok', tools: [], message: 'ready' },
    wspMetadataProbe: { status: 'absent', engagement_name: '', warnings: [], message: '' },
    lzCatalogueCoverageProbe: { status: 'ok', message: '', detail: '', gaps_count: 0 },
    credentialVaultProbe: { status: 'ok', vaultExists: true, decryptable: true, keyCount: 0, categories: [], message: '' },
    lzConnectionsProbe: { status: 'info', message: '', scopes: [] },
    intakeMappingProbe: { status: 'skip', message: '', errors: [], warnings: [] },
    apmWeightsProbe: { status: 'skip', message: '', source: null, errors: [], warnings: [] },
    serviceProbes: SERVICE_PROBE_RUNNERS.map((r) => ({ key: r.key, label: r.key, status: 'skip', message: '' })) as unknown as BuildHealthCheckContext['serviceProbes'],
  };
}

describe('probe registry applies_to (#4190, Design 125 section 6)', () => {
  it('lists exactly the probes the health check runs, each with a non-empty applies_to', () => {
    const logged = Object.keys(buildHealthCheckLogContext(ctx(), []).probes as Record<string, unknown>);
    expect([...HEALTH_PROBE_KEYS].sort()).toEqual([...logged].sort());
    expect(HEALTH_PROBE_KEYS).toHaveLength(PROBE_TOTAL);
    for (const k of HEALTH_PROBE_KEYS) {
      expect(PROBE_APPLIES_TO[k].length).toBeGreaterThan(0);
      for (const s of PROBE_APPLIES_TO[k]) expect(SETUP_SCOPES).toContain(s);
    }
  });

  it('generic runs the six generic probes of section 5.1', () => {
    expect(probesForScope('generic').sort()).toEqual(['community_frameworks', 'credential_vault', 'license', 'llm_gateway', 'mcp', 'wsp_metadata']);
  });

  it('each branch adds the probes of its section 5 table', () => {
    expect(branchOwnProbes('application').sort()).toEqual(['bi_export', 'iac_toolchain', 'imports', 'ingestion', 'playwright', 'prerequisites', 'scope', 'traceability', 'vcs_auth']);
    expect(branchOwnProbes('service').sort()).toEqual(['apm_weights', 'cluster_detection', 'delta_snapshot', 'framework_controls', 'intake_mapping', 'pii_scrub_audit', 'research_cache', 'service_workspace', 'vendor_catalog']);
    expect(branchOwnProbes('lz-catalog')).toEqual(['lz_catalogue_coverage']);
    expect(branchOwnProbes('lz-live')).toEqual(['lz_connections']);
    expect(branchOwnProbes('llm')).toEqual([]);
    for (const t of SETUP_ASSESSMENT_TYPES) {
      expect(probesForScope(t)).toEqual(HEALTH_PROBE_KEYS.filter((k) => probesForScope('generic').includes(k) || branchOwnProbes(t).includes(k)));
    }
  });

  it('a non-service branch does not list the service probes (no ten skip lines)', () => {
    for (const k of branchOwnProbes('service')) {
      expect(isProbeInScope(k, 'application')).toBe(false);
      expect(isProbeInScope(k, 'lz-live')).toBe(false);
    }
  });

  it('the unscoped run keeps every probe; unknown keys are never dropped', () => {
    expect(probesForScope(undefined)).toEqual([...HEALTH_PROBE_KEYS]);
    expect(isProbeInScope('future_probe', 'llm')).toBe(true);
  });

  it('the contributed ProbeContribution entries carry applies_to consistent with the registry', () => {
    const byId: Record<string, string> = { traceability: 'traceability', scope: 'scope', prerequisites: 'prerequisites' };
    for (const p of contributedProbes) {
      const key = byId[p.id];
      expect(key, p.id).toBeDefined();
      expect(p.applies_to).toEqual(PROBE_APPLIES_TO[key as keyof typeof PROBE_APPLIES_TO]);
    }
  });
});
