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

import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeFileSync, mkdirSync } from 'fs';
import { runAzureChecks } from './azure-adapter.js';
import type { AzureAdapterConfig } from './azure-adapter.js';
import { LandingZoneReadinessResultSchema } from '../../schema/wsp-lzr.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpStub(content: object): string {
  const dir = join(tmpdir(), `azure-adapter-test-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'lz-azure-snapshot.json');
  writeFileSync(file, JSON.stringify(content));
  return file;
}

const BASE_CONFIG: AzureAdapterConfig = {
  subscriptionId: 'sub-ghostfolio-001',
  location: 'westeurope',
  landingZoneId: 'lz-ghostfolio-prod',
  providerId: 'azure_west_europe',
};

const CLEAN_STUB = {
  aks_clusters: [{ name: 'ghostfolio-prod', provisioningState: 'Succeeded', kubernetesVersion: '1.30.5' }],
  postgresql_servers: [{ name: 'ghostfolio-pg', state: 'Ready', version: '15' }],
  redis_instances: [{ name: 'ghostfolio-redis', provisioningState: 'Succeeded' }],
  keyvault_vaults: [{ name: 'ghostfolio-kv' }],
  vnet_count: 1,
  aks_quota_remaining: 4,
  policy_non_compliant_count: 0,
  policy_violations: [],
};

// ---------------------------------------------------------------------------
// Ghostfolio fixture integration
// ---------------------------------------------------------------------------

describe('runAzureChecks -- ghostfolio clean stub', () => {
  it('returns overall_verdict: ready from ghostfolio stub file', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAzureChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes', 'postgresql', 'redis']);
    expect(result.overall_verdict).toBe('ready');
  });

  it('service_checks: kubernetes ready', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAzureChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes', 'postgresql', 'redis']);
    const k8s = result.service_checks.find((s) => s.service === 'kubernetes');
    expect(k8s?.status).toBe('ready');
    expect(k8s?.provisioned_in_lz).toBe(true);
  });

  it('service_checks: postgresql ready', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAzureChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes', 'postgresql', 'redis']);
    const pg = result.service_checks.find((s) => s.service === 'postgresql');
    expect(pg?.status).toBe('ready');
  });

  it('service_checks: redis ready', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAzureChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes', 'postgresql', 'redis']);
    const redis = result.service_checks.find((s) => s.service === 'redis');
    expect(redis?.status).toBe('ready');
  });

  it('quota_checks: AKS quota ok with remaining=4', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAzureChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes']);
    const aksQ = result.quota_checks.find((q) => q.resource === 'aks_clusters');
    expect(aksQ?.status).toBe('ok');
    expect(aksQ?.available).toBe(4);
  });

  it('policy_checks: LZ-POL-03 pass with no non-compliant assignments', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAzureChecks({ ...BASE_CONFIG, snapshotFile }, []);
    const pol = result.policy_checks.find((p) => p.check_id === 'LZ-POL-03');
    expect(pol?.status).toBe('pass');
  });

  it('output validates against LandingZoneReadinessResultSchema', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAzureChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes', 'postgresql', 'redis']);
    expect(() => LandingZoneReadinessResultSchema.parse(result)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AKS quota exhaustion -- blocked
// ---------------------------------------------------------------------------

describe('runAzureChecks -- quota exhaustion', () => {
  it('AKS quota=0 produces LZ-QUO-01 blocker and overall_verdict: blocked', async () => {
    const snapshotFile = makeTmpStub({ ...CLEAN_STUB, aks_quota_remaining: 0 });
    const result = await runAzureChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes']);
    expect(result.overall_verdict).toBe('blocked');
    const blocker = result.blockers.find((b) => b.check_id === 'LZ-QUO-01');
    expect(blocker).toBeDefined();
    expect(blocker?.blocks_migration).toBe(true);
  });

  it('AKS quota ok but no cluster -> blocked via LZ-SVC-01', async () => {
    const snapshotFile = makeTmpStub({ ...CLEAN_STUB, aks_clusters: [] });
    const result = await runAzureChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes']);
    expect(result.overall_verdict).toBe('blocked');
    const svc = result.service_checks.find((s) => s.service === 'kubernetes');
    expect(svc?.status).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// Policy violation -- advisory
// ---------------------------------------------------------------------------

describe('runAzureChecks -- policy violations', () => {
  it('non-compliant policy assignments produce LZ-POL-03 fail', async () => {
    const snapshotFile = makeTmpStub({
      ...CLEAN_STUB,
      policy_non_compliant_count: 2,
      policy_violations: [
        { policyDefinitionName: 'Require encryption on Data Lake Store accounts', resourceId: '/sub/acmestor01' },
      ],
    });
    const result = await runAzureChecks({ ...BASE_CONFIG, snapshotFile }, []);
    const pol = result.policy_checks.find((p) => p.check_id === 'LZ-POL-03');
    expect(pol?.status).toBe('fail');
    expect(pol?.note).toContain('Require encryption');
  });
});

// ---------------------------------------------------------------------------
// Stub mode: no credential access
// ---------------------------------------------------------------------------

describe('runAzureChecks -- stub mode isolation', () => {
  it('stub mode succeeds without any SWAO_CREDENTIAL_AZURE_* env vars set', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const saved = {
      TENANT: process.env['SWAO_CREDENTIAL_AZURE_TENANT_ID'],
      CLIENT: process.env['SWAO_CREDENTIAL_AZURE_CLIENT_ID'],
      SECRET: process.env['SWAO_CREDENTIAL_AZURE_CLIENT_SECRET'],
    };
    delete process.env['SWAO_CREDENTIAL_AZURE_TENANT_ID'];
    delete process.env['SWAO_CREDENTIAL_AZURE_CLIENT_ID'];
    delete process.env['SWAO_CREDENTIAL_AZURE_CLIENT_SECRET'];
    try {
      const result = await runAzureChecks({ ...BASE_CONFIG, snapshotFile }, ['kubernetes']);
      expect(result.overall_verdict).toBe('ready');
    } finally {
      if (saved.TENANT !== undefined) process.env['SWAO_CREDENTIAL_AZURE_TENANT_ID'] = saved.TENANT;
      if (saved.CLIENT !== undefined) process.env['SWAO_CREDENTIAL_AZURE_CLIENT_ID'] = saved.CLIENT;
      if (saved.SECRET !== undefined) process.env['SWAO_CREDENTIAL_AZURE_CLIENT_SECRET'] = saved.SECRET;
    }
  });

  it('provider_id and landing_zone_id are reflected in output', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAzureChecks(
      { ...BASE_CONFIG, snapshotFile, providerId: 'azure_de_region', landingZoneId: 'lz-azure-de-prod' },
      [],
    );
    expect(result.provider_id).toBe('azure_de_region');
    expect(result.landing_zone_id).toBe('lz-azure-de-prod');
  });

  it('ingestion_strategy is cloud_native in stub mode', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAzureChecks({ ...BASE_CONFIG, snapshotFile }, []);
    expect(result.ingestion_strategy).toBe('cloud_native');
  });
});

// ---------------------------------------------------------------------------
// Missing services
// ---------------------------------------------------------------------------

describe('runAzureChecks -- missing services', () => {
  it('absent postgresql server produces LZ-SVC-02 blocker', async () => {
    const snapshotFile = makeTmpStub({ ...CLEAN_STUB, postgresql_servers: [] });
    const result = await runAzureChecks({ ...BASE_CONFIG, snapshotFile }, ['postgresql']);
    const blocker = result.blockers.find((b) => b.check_id === 'LZ-SVC-02');
    expect(blocker).toBeDefined();
    expect(result.overall_verdict).toBe('blocked');
  });

  it('absent redis instance produces LZ-SVC-03 blocker', async () => {
    const snapshotFile = makeTmpStub({ ...CLEAN_STUB, redis_instances: [] });
    const result = await runAzureChecks({ ...BASE_CONFIG, snapshotFile }, ['redis']);
    const blocker = result.blockers.find((b) => b.check_id === 'LZ-SVC-03');
    expect(blocker).toBeDefined();
    expect(result.overall_verdict).toBe('blocked');
  });

  it('requiredServices empty -> no service_checks emitted, verdict ready', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAzureChecks({ ...BASE_CONFIG, snapshotFile }, []);
    expect(result.service_checks).toHaveLength(0);
    expect(result.overall_verdict).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// Network check
// ---------------------------------------------------------------------------

describe('runAzureChecks -- network', () => {
  it('vnet_count=0 produces LZ-NET-01 fail', async () => {
    const snapshotFile = makeTmpStub({ ...CLEAN_STUB, vnet_count: 0 });
    const result = await runAzureChecks({ ...BASE_CONFIG, snapshotFile }, []);
    const net = result.network_checks.find((n) => n.check_id === 'LZ-NET-01');
    expect(net?.status).toBe('fail');
  });

  it('vnet_count=1 produces LZ-NET-01 pass', async () => {
    const snapshotFile = makeTmpStub(CLEAN_STUB);
    const result = await runAzureChecks({ ...BASE_CONFIG, snapshotFile }, []);
    const net = result.network_checks.find((n) => n.check_id === 'LZ-NET-01');
    expect(net?.status).toBe('pass');
  });
});
