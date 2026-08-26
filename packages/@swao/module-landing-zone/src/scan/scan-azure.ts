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

import type { LzScanResult, LzEnabledService, LzGuardrail, LzQuota } from '@swao/core';

/**
 * Azure LZ scan normaliser (Design 056 Layer B, #0566). Maps an Azure
 * landing-zone snapshot -- the existing `lz-azure-snapshot.json` shape (IaC
 * export, or an Azure Resource Graph export) -- into the normalised
 * LzScanResult. No credentials for Mode A/B. Mode C (live Resource Graph) calls
 * the same normaliser after a transport adapts the live query results into this
 * shape (the live SDK transport is the thin premium add).
 */

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

export interface AzureScanOptions {
  collectionMode?: 'iac' | 'export' | 'live';
  scannedAt?: string;
  region?: string;
}

const PROVISIONED = new Set(['Succeeded', 'Ready', 'Running']);

function provisionedState(rec: Record<string, unknown>): boolean {
  return PROVISIONED.has(str(rec['provisioningState']) ?? str(rec['state']) ?? '');
}

export function normalizeAzureSnapshot(raw: Record<string, unknown>, opts: AzureScanOptions = {}): LzScanResult {
  const services: LzEnabledService[] = [];

  const mapping: Array<{ key: string; code: string; fulfills: string[] }> = [
    { key: 'aks_clusters', code: 'Microsoft.ContainerService/managedClusters', fulfills: ['kubernetes'] },
    { key: 'postgresql_servers', code: 'Microsoft.DBforPostgreSQL/flexibleServers', fulfills: ['postgresql'] },
    { key: 'redis_instances', code: 'Microsoft.Cache/Redis', fulfills: ['redis'] },
    { key: 'keyvault_vaults', code: 'Microsoft.KeyVault/vaults', fulfills: ['key_vault'] },
  ];
  for (const m of mapping) {
    const arr = asArray(raw[m.key]);
    if (arr.length === 0) continue;
    const first = arr[0] as Record<string, unknown>;
    services.push({
      code: m.code,
      fulfills: m.fulfills,
      provisioned: arr.some((x) => provisionedState(x as Record<string, unknown>)) || m.key === 'keyvault_vaults',
      count: arr.length,
      version: str(first['kubernetesVersion']) ?? str(first['version']),
    });
  }

  const guardrails: LzGuardrail[] = [];
  for (const v of asArray(raw['policy_violations'])) {
    guardrails.push({ type: 'azure-policy', id: str(v) ?? String(v), status: 'fail' });
  }

  const quotas: LzQuota[] = [];
  const aksQuota = num(raw['aks_quota_remaining']);
  if (aksQuota !== undefined) quotas.push({ resource: 'aks', remaining: aksQuota });

  const mode = opts.collectionMode ?? 'export';
  return {
    provider: 'azure',
    collection_mode: mode,
    confidence: mode === 'iac' ? 'declared' : 'observed',
    scanned_at: opts.scannedAt ?? str(raw['snapshot_generated_at']) ?? new Date().toISOString().slice(0, 10),
    regions: opts.region ? [opts.region] : [],
    enabled_services: services,
    guardrails,
    quotas,
    provenance: {
      source: mode === 'iac' ? 'terraform/iac' : 'azure-snapshot',
      fabricated: raw['fabricated'] === true,
    },
  };
}
