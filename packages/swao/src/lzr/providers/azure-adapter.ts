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

import { existsSync, readFileSync } from 'fs';
import { credentialStore, resolveLzCredentials, LzCredentialExpiredError } from '@swao/core';
import { readAzurePass23StateForScope } from '@swao/module-landing-zone';
import type { LandingZoneReadinessResult, LZServiceCheck, LZQuotaCheck, LZPolicyCheck, LZBlockerItem, LZNetworkCheck } from '../../schema/wsp-lzr.js';

// ---------------------------------------------------------------------------
// Public config
// ---------------------------------------------------------------------------

export interface AzureAdapterConfig {
  subscriptionId: string;
  location: string;
  landingZoneId: string;
  providerId: string;
  snapshotFile?: string;
  // #3570: live credentials come from lz:<lzId>:<scopeId>:<field> (Design 120 section 6.2).
  credentialScope?: { lzId: string; scopeId: string };
}

// ---------------------------------------------------------------------------
// Snapshot file shape (WoZ / CI mode)
// ---------------------------------------------------------------------------

interface PolicyViolation {
  policyDefinitionName: string;
  resourceId?: string;
}

interface AzureSnapshot {
  aks_clusters?: Array<{ name: string; provisioningState: string; kubernetesVersion?: string }>;
  postgresql_servers?: Array<{ name: string; state: string; version?: string }>;
  redis_instances?: Array<{ name: string; provisioningState: string }>;
  keyvault_vaults?: Array<{ name: string }>;
  vnet_count?: number;
  aks_quota_remaining?: number;
  policy_non_compliant_count?: number;
  policy_violations?: PolicyViolation[];
  snapshot_generated_at?: string;
  fabricated?: boolean;
}

// ---------------------------------------------------------------------------
// Snapshot-mode builder
// ---------------------------------------------------------------------------

function buildFromSnapshot(
  snapshot: AzureSnapshot,
  requiredServices: string[],
  config: AzureAdapterConfig,
): LandingZoneReadinessResult {
  const stub = snapshot;
  const now = new Date().toISOString();
  const blockers: LZBlockerItem[] = [];
  const service_checks: LZServiceCheck[] = [];
  const quota_checks: LZQuotaCheck[] = [];
  const policy_checks: LZPolicyCheck[] = [];
  const network_checks: LZNetworkCheck[] = [];

  // Service checks
  for (const svc of requiredServices) {
    if (svc === 'kubernetes') {
      const ready = (stub.aks_clusters ?? []).filter((c) => c.provisioningState === 'Succeeded');
      service_checks.push({
        service: 'kubernetes',
        required: true,
        available_in_lz: true,
        provisioned_in_lz: ready.length > 0,
        status: ready.length > 0 ? 'ready' : 'blocked',
        note: ready.length > 0
          ? `AKS cluster: ${ready[0].name} (k8s ${ready[0].kubernetesVersion ?? 'unknown'})`
          : 'No Succeeded AKS cluster found',
      });
      if (ready.length === 0) {
        blockers.push({
          check_id: 'LZ-SVC-01',
          category: 'service',
          service: 'kubernetes',
          description: 'No provisioned AKS cluster in landing zone',
          evidence: [],
          remediation: 'Provision an AKS cluster in the target subscription',
          blocks_migration: true,
        });
      }
    } else if (svc === 'postgresql') {
      const ready = (stub.postgresql_servers ?? []).filter((s) => s.state === 'Ready');
      service_checks.push({
        service: 'postgresql',
        required: true,
        available_in_lz: true,
        provisioned_in_lz: ready.length > 0,
        status: ready.length > 0 ? 'ready' : 'blocked',
        note: ready.length > 0
          ? `Azure Database for PostgreSQL: ${ready[0].name} (v${ready[0].version ?? 'unknown'})`
          : 'No ready PostgreSQL Flexible Server',
      });
      if (ready.length === 0) {
        blockers.push({
          check_id: 'LZ-SVC-02',
          category: 'service',
          service: 'postgresql',
          description: 'No ready Azure Database for PostgreSQL -- Flexible Server',
          evidence: [],
          remediation: 'Provision an Azure PostgreSQL Flexible Server in the target subscription',
          blocks_migration: true,
        });
      }
    } else if (svc === 'redis') {
      const ready = (stub.redis_instances ?? []).filter((r) => r.provisioningState === 'Succeeded');
      service_checks.push({
        service: 'redis',
        required: true,
        available_in_lz: true,
        provisioned_in_lz: ready.length > 0,
        status: ready.length > 0 ? 'ready' : 'blocked',
        note: ready.length > 0 ? `Azure Cache for Redis: ${ready[0].name}` : 'No Succeeded Redis instance',
      });
      if (ready.length === 0) {
        blockers.push({
          check_id: 'LZ-SVC-03',
          category: 'service',
          service: 'redis',
          description: 'No provisioned Azure Cache for Redis instance',
          evidence: [],
          remediation: 'Provision an Azure Cache for Redis instance in the target subscription',
          blocks_migration: true,
        });
      }
    }
  }

  // Quota check -- AKS clusters
  const aksQuota = stub.aks_quota_remaining ?? null;
  if (aksQuota !== null) {
    const aksOk = aksQuota > 0;
    quota_checks.push({
      resource: 'aks_clusters',
      available: aksQuota,
      status: aksOk ? 'ok' : 'blocked',
      note: aksOk ? `${aksQuota} AKS cluster slots remaining` : 'AKS cluster quota exhausted in region',
    });
    if (!aksOk) {
      blockers.push({
        check_id: 'LZ-QUO-01',
        category: 'quota',
        description: 'AKS cluster quota exhausted; cannot create new cluster in subscription',
        evidence: [`aks_quota_remaining: ${aksQuota}`],
        remediation: 'Request AKS quota increase via Azure Support',
        blocks_migration: true,
      });
    }
  }

  // Policy check
  const nonCompliantCount = stub.policy_non_compliant_count ?? 0;
  const violations = stub.policy_violations ?? [];
  const policyStatus = nonCompliantCount === 0 ? 'pass' : 'fail';
  policy_checks.push({
    check_id: 'LZ-POL-03',
    rule: 'azure-policy-compliance',
    status: policyStatus,
    severity: nonCompliantCount === 0 ? 'informational' : 'high',
    note: nonCompliantCount === 0
      ? 'No non-compliant Azure Policy assignments'
      : `${nonCompliantCount} non-compliant policy assignment(s): ${violations.map((v) => v.policyDefinitionName).join(', ')}`,
  });

  // Network check -- VNet presence
  const vnetCount = stub.vnet_count ?? 0;
  network_checks.push({
    check_id: 'LZ-NET-01',
    description: 'Custom VNet exists in subscription',
    status: vnetCount > 0 ? 'pass' : 'fail',
    note: vnetCount > 0 ? `${vnetCount} VNet(s) present` : 'No custom VNet found in subscription',
  });

  const overall_verdict: LandingZoneReadinessResult['overall_verdict'] =
    blockers.length > 0 ? 'blocked' : 'ready';

  return {
    provider_id: config.providerId,
    landing_zone_id: config.landingZoneId,
    assessed_at: now,
    ingestion_strategy: 'cloud_native',
    blockers,
    warnings: [],
    service_checks,
    quota_checks,
    policy_checks,
    network_checks,
    overall_verdict,
  };
}

// ---------------------------------------------------------------------------
// Live-mode credential resolution (compiles; not called in CI stub mode)
// ---------------------------------------------------------------------------

export interface AzureCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

// #3570: scoped keys only; the Pass 23 keys azure-tenant-id, ... are moved by
// moveLegacyLzCredentials() and no longer read (no dual-read fallback).
export async function resolveAzureCredentials(scope: { lzId: string; scopeId: string }): Promise<AzureCredentials> {
  const c = await resolveLzCredentials(credentialStore, scope.lzId, scope.scopeId, ['tenant-id', 'client-id', 'client-secret']);
  return { tenantId: c['tenant-id'], clientId: c['client-id'], clientSecret: c['client-secret'] };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runAzureChecks(
  config: AzureAdapterConfig,
  requiredServices: string[],
): Promise<LandingZoneReadinessResult> {
  // Snapshot mode: detect snapshot file FIRST, before any credential lookup
  if (config.snapshotFile && existsSync(config.snapshotFile)) {
    const raw = readFileSync(config.snapshotFile, 'utf-8');
    const snapshot = JSON.parse(raw) as AzureSnapshot;
    return buildFromSnapshot(snapshot, requiredServices, config);
  }

  // Live mode: resolve credentials then call Azure ARM / Policy Insights APIs
  if (!config.credentialScope) {
    throw new Error('[credential] Azure live mode needs a registered landing zone scope (landing_zones in .swao.yml) with lz:<lz-id>:<scope-id>:tenant-id, client-id and client-secret');
  }
  // Missing or legacy-only scoped keys refuse before any request (#3570).
  await resolveAzureCredentials(config.credentialScope);
  const scope = config.credentialScope;
  try {
    // #3575 (Design 120 section 7.5): the live reads run on the `azure` driver
    // transport (read-only allow-list, endpoint seam, service principal token,
    // Resource Graph). Policy compliance is not read live yet (no Policy
    // Insights route in the driver), so the live result says so in a warning
    // instead of reporting a pass.
    const state = await readAzurePass23StateForScope({ lzId: scope.lzId, scopeId: scope.scopeId, subscriptionId: config.subscriptionId, store: credentialStore });
    const result = buildFromSnapshot({ ...state }, requiredServices, config);
    return {
      ...result,
      policy_checks: [],
      warnings: [...result.warnings, { check_id: 'LZ-WARN-03', category: 'policy', description: 'Azure Policy compliance is not read on the live path yet (#3575); no policy check reported', evidence: [] }],
      input_type: 'live_api' as const,
    };
  } catch (err) {
    if (err instanceof LzCredentialExpiredError) throw err;
    return {
      provider_id: config.providerId,
      landing_zone_id: config.landingZoneId,
      assessed_at: new Date().toISOString(),
      ingestion_strategy: 'cloud_native',
      blockers: [],
      warnings: [{ check_id: 'LZ-WARN-02', category: 'service', description: `Live Azure API call failed: ${(err as Error).message}`, evidence: [] }],
      service_checks: [],
      quota_checks: [],
      policy_checks: [],
      network_checks: [],
      overall_verdict: 'advisory',
      input_type: 'live_api' as const,
    };
  }
}
