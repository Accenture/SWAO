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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runPortfolioLzr, detectAdapterConfig, formatPortfolioLzrReport } from './portfolio-lzr.js';
import type { PortfolioLzrSummary } from './portfolio-lzr.js';

// ---------------------------------------------------------------------------
// Stub data
// ---------------------------------------------------------------------------

const MESHSTACK_READY = {
  platform_id: 'stackit-de-01',
  tenant_exists: true,
  building_block_definitions: [
    { identifier: 'stackit-ske', displayName: 'STACKIT Kubernetes Engine (SKE)', status: 'ACTIVE' },
  ],
  building_block_instances: [
    { definitionIdentifier: 'stackit-ske', state: 'SUCCEEDED', displayName: 'app-ske' },
  ],
  quota_supported: false,
};

const MESHSTACK_ADVISORY = {
  platform_id: 'stackit-de-01',
  tenant_exists: false,
  building_block_definitions: [],
  building_block_instances: [],
  quota_supported: false,
};

const AWS_BLOCKED = {
  eks_clusters: [{ name: 'prod-cluster', status: 'ACTIVE', version: '1.29', region: 'eu-central-1' }],
  rds_instances: [],
  elasticache_groups: [],
  config_compliance: { non_compliant_rule_count: 0, violations: [] },
  vpc_count: 1,
  service_quota_eks_remaining: 0,
  service_quota_rds_remaining: 5,
};

// ---------------------------------------------------------------------------
// Test workspace factory
// ---------------------------------------------------------------------------

const TEMP_ROOT = join(tmpdir(), `plzr-test-${process.pid}`);

function makeApp(appId: string, stubName: string, stubContent: object): string {
  const appDir = join(TEMP_ROOT, 'apps', appId);
  // #0232: LZ stubs live under wsp/inputs/terraform/, not legacy imports/.
  const importsDir = join(appDir, 'wsp', 'inputs', 'terraform');
  mkdirSync(importsDir, { recursive: true });
  writeFileSync(join(importsDir, stubName), JSON.stringify(stubContent));
  return appDir;
}

function makeAppNoImports(appId: string): string {
  const appDir = join(TEMP_ROOT, 'apps', appId);
  mkdirSync(appDir, { recursive: true });
  return appDir;
}

beforeEach(() => {
  mkdirSync(join(TEMP_ROOT, 'apps'), { recursive: true });
});

afterEach(() => {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// detectAdapterConfig
// ---------------------------------------------------------------------------

describe('detectAdapterConfig', () => {
  it('returns null when imports dir is absent', () => {
    makeAppNoImports('no-imports');
    const result = detectAdapterConfig('no-imports', join(TEMP_ROOT, 'apps', 'no-imports'), 'lz-x');
    expect(result).toBeNull();
  });

  it('detects meshstack over aws when both present', () => {
    makeApp('both', 'lz-meshstack-snapshot.json', MESHSTACK_READY);
    makeApp('both', 'lz-aws-snapshot.json', AWS_BLOCKED);
    const result = detectAdapterConfig('both', join(TEMP_ROOT, 'apps', 'both'), 'lz-x');
    expect(result?.adapterType).toBe('meshstack');
  });

  it('detects aws when only aws stub present', () => {
    makeApp('aws-only', 'lz-aws-snapshot.json', AWS_BLOCKED);
    const result = detectAdapterConfig('aws-only', join(TEMP_ROOT, 'apps', 'aws-only'), 'lz-x');
    expect(result?.adapterType).toBe('aws');
    expect(result?.providerId).toBe('aws_eu_central_1');
  });

  it('detects azure when only azure stub present', () => {
    makeApp('azure-only', 'lz-azure-snapshot.json', { aks_clusters: [], postgresql_servers: [], redis_instances: [], keyvault_vaults: [], vnet_count: 1, aks_quota_remaining: 3, policy_non_compliant_count: 0 });
    const result = detectAdapterConfig('azure-only', join(TEMP_ROOT, 'apps', 'azure-only'), 'lz-x');
    expect(result?.adapterType).toBe('azure');
    expect(result?.providerId).toBe('azure_eu_west');
  });
});

// ---------------------------------------------------------------------------
// Same-platform deduplication
// ---------------------------------------------------------------------------

describe('runPortfolioLzr -- same-platform deduplication', () => {
  it('two apps with meshstack stubs share the same provider_id and landing_zone_id', async () => {
    makeApp('app-alpha', 'lz-meshstack-snapshot.json', MESHSTACK_READY);
    makeApp('app-beta', 'lz-meshstack-snapshot.json', MESHSTACK_READY);

    const summary = await runPortfolioLzr(TEMP_ROOT, 'lz-stackit-de-01');

    expect(summary.total_apps).toBe(2);
    const alpha = summary.apps.find((a) => a.app_id === 'app-alpha');
    const beta = summary.apps.find((a) => a.app_id === 'app-beta');
    expect(alpha?.provider_id).toBe(beta?.provider_id);
    expect(alpha?.landing_zone_id).toBe(beta?.landing_zone_id);
    expect(alpha?.verdict).toBe('ready');
    expect(beta?.verdict).toBe('ready');
  });

  it('two apps on same platform have identical blocker and warning counts', async () => {
    makeApp('app-one', 'lz-meshstack-snapshot.json', MESHSTACK_ADVISORY);
    makeApp('app-two', 'lz-meshstack-snapshot.json', MESHSTACK_ADVISORY);

    const summary = await runPortfolioLzr(TEMP_ROOT, 'lz-stackit-de-01');

    const one = summary.apps.find((a) => a.app_id === 'app-one');
    const two = summary.apps.find((a) => a.app_id === 'app-two');
    expect(one?.blocker_count).toBe(two?.blocker_count);
    expect(one?.warning_count).toBe(two?.warning_count);
  });
});

// ---------------------------------------------------------------------------
// Mixed verdicts
// ---------------------------------------------------------------------------

describe('runPortfolioLzr -- mixed verdicts', () => {
  it('blocked app drives portfolio overall_verdict to blocked', async () => {
    makeApp('mesh-app', 'lz-meshstack-snapshot.json', MESHSTACK_READY);
    makeApp('aws-app', 'lz-aws-snapshot.json', AWS_BLOCKED);

    const summary = await runPortfolioLzr(TEMP_ROOT, 'lz-any');

    expect(summary.counts.ready).toBeGreaterThanOrEqual(1);
    expect(summary.counts.blocked).toBe(1);
    expect(summary.overall_verdict).toBe('blocked');
  });

  it('advisory without blocked -> overall_verdict is advisory', async () => {
    makeApp('adv-app', 'lz-meshstack-snapshot.json', MESHSTACK_ADVISORY);

    const summary = await runPortfolioLzr(TEMP_ROOT, 'lz-any');

    expect(summary.counts.blocked).toBe(0);
    expect(summary.counts.advisory).toBe(1);
    expect(summary.overall_verdict).toBe('advisory');
  });

  it('counts.skipped incremented for apps with no imports', async () => {
    makeApp('ready-app', 'lz-meshstack-snapshot.json', MESHSTACK_READY);
    makeAppNoImports('no-lzr-app');

    const summary = await runPortfolioLzr(TEMP_ROOT, 'lz-any');

    expect(summary.counts.skipped).toBe(1);
    const skipped = summary.apps.find((a) => a.app_id === 'no-lzr-app');
    expect(skipped?.verdict).toBe('skipped');
    expect(skipped?.skip_reason).toBeDefined();
  });

  it('all ready -> overall_verdict is ready', async () => {
    makeApp('app-a', 'lz-meshstack-snapshot.json', MESHSTACK_READY);
    makeApp('app-b', 'lz-meshstack-snapshot.json', MESHSTACK_READY);

    const summary = await runPortfolioLzr(TEMP_ROOT, 'lz-any');

    expect(summary.overall_verdict).toBe('ready');
    expect(summary.counts.ready).toBe(2);
    expect(summary.counts.blocked).toBe(0);
    expect(summary.counts.advisory).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Empty workspace
// ---------------------------------------------------------------------------

describe('runPortfolioLzr -- empty workspace', () => {
  it('zero apps -> overall_verdict ready, zero counts', async () => {
    const summary = await runPortfolioLzr(TEMP_ROOT, 'lz-any');
    expect(summary.total_apps).toBe(0);
    expect(summary.apps).toHaveLength(0);
    expect(summary.overall_verdict).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// #1256 -- source_snapshot + picker_label
// ---------------------------------------------------------------------------

describe('detectAdapterConfig -- picker_label + source_snapshot (#1256)', () => {
  it('meshstack: picker_label is filename stem without -snapshot', () => {
    makeApp('mesh-label', 'lz-meshstack-snapshot.json', MESHSTACK_READY);
    const result = detectAdapterConfig('mesh-label', join(TEMP_ROOT, 'apps', 'mesh-label'), 'lz-x');
    expect(result?.pickerLabel).toBe('lz-meshstack');
    expect(result?.snapshotFile).toContain('lz-meshstack-snapshot.json');
  });

  it('aws: picker_label is lz-aws', () => {
    makeApp('aws-label', 'lz-aws-snapshot.json', { eks_clusters: [], rds_instances: [], elasticache_groups: [], config_compliance: { non_compliant_rule_count: 0, violations: [] }, vpc_count: 1, service_quota_eks_remaining: 3, service_quota_rds_remaining: 5 });
    const result = detectAdapterConfig('aws-label', join(TEMP_ROOT, 'apps', 'aws-label'), 'lz-x');
    expect(result?.pickerLabel).toBe('lz-aws');
  });
});

describe('runPortfolioLzr -- source_snapshot + picker_label in result (#1256)', () => {
  it('propagates source_snapshot and picker_label into AppLzrResult', async () => {
    makeApp('snap-app', 'lz-meshstack-snapshot.json', MESHSTACK_READY);
    const summary = await runPortfolioLzr(TEMP_ROOT, 'lz-stackit-de-01');
    const app = summary.apps.find(a => a.app_id === 'snap-app');
    expect(app?.source_snapshot).toBe('lz-meshstack-snapshot.json');
    expect(app?.picker_label).toBe('lz-meshstack');
  });
});

// ---------------------------------------------------------------------------
// #1260 -- fabricated flag
// ---------------------------------------------------------------------------

describe('runPortfolioLzr -- lzr_snapshot_fabricated (#1260)', () => {
  it('sets lzr_snapshot_fabricated when snapshot has fabricated:true', async () => {
    makeApp('fab-app', 'lz-meshstack-snapshot.json', { ...MESHSTACK_READY, fabricated: true });
    const summary = await runPortfolioLzr(TEMP_ROOT, 'lz-stackit-de-01');
    const app = summary.apps.find(a => a.app_id === 'fab-app');
    expect(app?.lzr_snapshot_fabricated).toBe(true);
  });

  it('lzr_snapshot_fabricated is absent when snapshot has no fabricated flag', async () => {
    makeApp('real-app', 'lz-meshstack-snapshot.json', MESHSTACK_READY);
    const summary = await runPortfolioLzr(TEMP_ROOT, 'lz-stackit-de-01');
    const app = summary.apps.find(a => a.app_id === 'real-app');
    expect(app?.lzr_snapshot_fabricated).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// TFv5 show-format terraform adapter
// ---------------------------------------------------------------------------

const TFV5_SOURCE_TFSTATE = {
  format_version: '1.0',
  terraform_version: '1.9.0',
  values: {
    outputs: {},
    root_module: {
      resources: [
        {
          address: 'hostinger_vps.prod',
          mode: 'managed',
          type: 'hostinger_vps',
          name: 'prod',
          provider_name: 'registry.terraform.io/hostinger/hostinger',
          schema_version: 0,
          values: { id: '1054506', hostname: 'srv1054506.hstgr.cloud', ipv4_address: '72.61.154.115' },
          sensitive_values: {},
        },
        {
          address: 'docker_container.db',
          mode: 'managed',
          type: 'docker_container',
          name: 'db',
          provider_name: 'registry.terraform.io/kreuzwerker/docker',
          schema_version: 2,
          values: {
            id: 'd4f6a8b2c4e6',
            name: 'my-app-db',
            image: 'sha256:c8180498e5035b3529c365fb1715f21922e355ab6f72537b03bd842d361b9004',
            env: ['POSTGRES_DB=myapp', 'POSTGRES_USER=myapp'],
            command: ['postgres', '-c', 'shared_preload_libraries=pgaudit'],
            ports: [],
          },
          sensitive_values: { env: true },
        },
        {
          address: 'docker_container.redis',
          mode: 'managed',
          type: 'docker_container',
          name: 'redis',
          provider_name: 'registry.terraform.io/kreuzwerker/docker',
          schema_version: 2,
          values: {
            id: 'e5a7c9d1f3b5',
            name: 'my-app-redis',
            image: 'sha256:aa189b5a1954929c393585e6dc5717a75b18f75a931df8bdcc00a3d3bd546be6',
            env: [],
            command: [],
            ports: [],
          },
          sensitive_values: {},
        },
      ],
    },
  },
};

describe('detectAdapterConfig -- TFv5 terraform adapter', () => {
  it('returns adapterType terraform when only tfstate present (no snapshot)', () => {
    makeApp('tf-only', 'terraform-prod.tfstate', TFV5_SOURCE_TFSTATE);
    const result = detectAdapterConfig('tf-only', join(TEMP_ROOT, 'apps', 'tf-only'), 'lz-test');
    expect(result?.adapterType).toBe('terraform');
  });

  it('snapshot takes priority over tfstate when both present', () => {
    makeApp('tf-and-mesh', 'terraform-prod.tfstate', TFV5_SOURCE_TFSTATE);
    makeApp('tf-and-mesh', 'lz-meshstack-snapshot.json', MESHSTACK_READY);
    const result = detectAdapterConfig('tf-and-mesh', join(TEMP_ROOT, 'apps', 'tf-and-mesh'), 'lz-test');
    expect(result?.adapterType).toBe('meshstack');
  });
});

describe('runPortfolioLzr -- TFv5 source-environment analysis', () => {
  it('TFv5 tfstate: enters source-only mode, verdict blocked (postgres needs target LZ)', async () => {
    makeApp('tfv5-source', 'terraform-prod.tfstate', TFV5_SOURCE_TFSTATE);
    const summary = await runPortfolioLzr(TEMP_ROOT, 'lz-stackit-de-01');
    const app = summary.apps.find((a) => a.app_id === 'tfv5-source');
    expect(app?.verdict).toBe('blocked');
    expect(app?.blocker_count).toBeGreaterThan(0);
  });

  it('TFv5 tfstate: ingestion_strategy is source_environment_analysis', async () => {
    makeApp('tfv5-strategy', 'terraform-prod.tfstate', TFV5_SOURCE_TFSTATE);
    const summary = await runPortfolioLzr(TEMP_ROOT, 'lz-stackit-de-01');
    expect(summary.total_apps).toBeGreaterThan(0);
    expect(summary.counts.blocked).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// formatPortfolioLzrReport
// ---------------------------------------------------------------------------

describe('formatPortfolioLzrReport', () => {
  const SAMPLE_SUMMARY: PortfolioLzrSummary = {
    assessed_at: '2026-04-28',
    total_apps: 3,
    apps: [
      { app_id: 'ghostfolio', provider_id: 'stackit_de_sovereign', landing_zone_id: 'lz-stackit-de-01', verdict: 'ready', blocker_count: 0, warning_count: 0 },
      { app_id: 'medplum', provider_id: 'aws_eu_central_1', landing_zone_id: 'lz-aws-eu-central-1', verdict: 'blocked', blocker_count: 1, warning_count: 0 },
      { app_id: 'legacy-billing', provider_id: '', landing_zone_id: '', verdict: 'skipped', blocker_count: 0, warning_count: 0, skip_reason: 'no LZR imports found' },
    ],
    counts: { ready: 1, blocked: 1, advisory: 0, skipped: 1 },
    overall_verdict: 'blocked',
  };

  it('contains app IDs', () => {
    const out = formatPortfolioLzrReport(SAMPLE_SUMMARY);
    expect(out).toContain('ghostfolio');
    expect(out).toContain('medplum');
    expect(out).toContain('legacy-billing');
  });

  it('shows overall verdict', () => {
    const out = formatPortfolioLzrReport(SAMPLE_SUMMARY);
    expect(out).toContain('BLOCKED');
  });

  it('shows per-app verdict labels', () => {
    const out = formatPortfolioLzrReport(SAMPLE_SUMMARY);
    expect(out).toContain('READY');
    expect(out).toContain('SKIPPED');
  });

  it('shows count summary line', () => {
    const out = formatPortfolioLzrReport(SAMPLE_SUMMARY);
    expect(out).toContain('1 ready');
    expect(out).toContain('1 blocked');
    expect(out).toContain('1 skipped');
  });

  it('shows assessed date and app count', () => {
    const out = formatPortfolioLzrReport(SAMPLE_SUMMARY);
    expect(out).toContain('2026-04-28');
    expect(out).toContain('3');
  });

  it('#1260: [SIM] annotation when lzr_snapshot_fabricated is true', () => {
    const summary = {
      ...SAMPLE_SUMMARY,
      apps: [
        { app_id: 'sim-app', provider_id: 'stackit_de_sovereign', landing_zone_id: 'lz-stackit-de-01', verdict: 'ready' as const, blocker_count: 0, warning_count: 0, lzr_snapshot_fabricated: true },
      ],
    };
    const out = formatPortfolioLzrReport(summary);
    expect(out).toContain('[SIM]');
  });

  it('#1256: picker_label shown in zone column instead of landing_zone_id', () => {
    const summary = {
      ...SAMPLE_SUMMARY,
      apps: [
        { app_id: 'labeled-app', provider_id: 'stackit_de_sovereign', landing_zone_id: 'lz-stackit-de-01', verdict: 'ready' as const, blocker_count: 0, warning_count: 0, picker_label: 'lz-meshstack' },
      ],
    };
    const out = formatPortfolioLzrReport(summary);
    expect(out).toContain('lz-meshstack');
  });
});
