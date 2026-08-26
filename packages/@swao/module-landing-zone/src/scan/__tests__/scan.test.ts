// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { parseLzScanResult, scanHasService } from '@swao/core';
import { normalizeAwsSnapshot } from '../scan-aws.js';
import { normalizeAzureSnapshot } from '../scan-azure.js';

// Inline samples matching the real lz-*-snapshot.json shapes (avoids deep-path
// fixture fragility; the shapes mirror examples/.../terraform/lz-aws-snapshot.json).
const AWS_SNAPSHOT = {
  snapshot_generated_at: '2026-01-01T00:00:00Z',
  fabricated: true,
  eks_clusters: [{ name: 'prod', status: 'ACTIVE', version: '1.30' }],
  rds_instances: [{ identifier: 'pg', engine: 'postgres', status: 'available', engineVersion: '15.6' }],
  elasticache_groups: [{ id: 'redis', status: 'available' }],
  config_compliance: { non_compliant_rules: ['s3-bucket-public-read-prohibited'] },
  service_quota_eks_remaining: 3,
  service_quota_rds_remaining: 10,
};

const AZURE_SNAPSHOT = {
  snapshot_generated_at: '2026-01-01T00:00:00Z',
  aks_clusters: [{ name: 'prod', provisioningState: 'Succeeded', kubernetesVersion: '1.30.5' }],
  postgresql_servers: [{ name: 'pg', state: 'Ready', version: '15' }],
  redis_instances: [{ name: 'redis', provisioningState: 'Succeeded' }],
  keyvault_vaults: [{ name: 'kv' }],
  aks_quota_remaining: 4,
  policy_violations: [],
};

describe('AWS LZ scan normaliser (#0566)', () => {
  it('maps an AWS snapshot to a valid LzScanResult', () => {
    const scan = normalizeAwsSnapshot(AWS_SNAPSHOT);
    expect(() => parseLzScanResult(scan)).not.toThrow();
    expect(scan.provider).toBe('aws');
    expect(scan.confidence).toBe('observed'); // default mode export
    expect(scanHasService(scan, 'eks')).toBe(true);
    expect(scanHasService(scan, 'rds-postgres')).toBe(true);
    expect(scanHasService(scan, 'elasticache')).toBe(true);
    expect(scan.guardrails).toHaveLength(1);
    expect(scan.guardrails[0]!.status).toBe('fail');
    expect(scan.quotas.find((q) => q.resource === 'eks')?.remaining).toBe(3);
    expect(scan.provenance.fabricated).toBe(true);
  });

  it('IaC mode is declared confidence', () => {
    const scan = normalizeAwsSnapshot(AWS_SNAPSHOT, { collectionMode: 'iac' });
    expect(scan.confidence).toBe('declared');
    expect(scan.provenance.source).toBe('terraform/iac');
  });
});

describe('Azure LZ scan normaliser (#0566)', () => {
  it('maps an Azure snapshot to a valid LzScanResult', () => {
    const scan = normalizeAzureSnapshot(AZURE_SNAPSHOT);
    expect(() => parseLzScanResult(scan)).not.toThrow();
    expect(scan.provider).toBe('azure');
    expect(scanHasService(scan, 'Microsoft.ContainerService/managedClusters')).toBe(true);
    expect(scanHasService(scan, 'Microsoft.DBforPostgreSQL/flexibleServers')).toBe(true);
    expect(scanHasService(scan, 'Microsoft.Cache/Redis')).toBe(true);
    expect(scanHasService(scan, 'Microsoft.KeyVault/vaults')).toBe(true);
    expect(scan.quotas.find((q) => q.resource === 'aks')?.remaining).toBe(4);
    expect(scan.guardrails).toHaveLength(0);
  });
});
