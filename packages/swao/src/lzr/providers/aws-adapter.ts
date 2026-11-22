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
import { readAwsPass23StateForScope } from '@swao/module-landing-zone';
import type { LandingZoneReadinessResult, LZServiceCheck, LZQuotaCheck, LZPolicyCheck, LZBlockerItem, LZNetworkCheck } from '../../schema/wsp-lzr.js';

// ---------------------------------------------------------------------------
// Public config
// ---------------------------------------------------------------------------

export interface AwsAdapterConfig {
  region: string;
  landingZoneId: string;
  providerId: string;
  snapshotFile?: string;
  // #3570: live credentials come from lz:<lzId>:<scopeId>:<field> (Design 120
  // section 6.2). Without a registered scope the live path does not run.
  credentialScope?: { lzId: string; scopeId: string };
}

// ---------------------------------------------------------------------------
// Snapshot file shape (WoZ / CI mode)
// ---------------------------------------------------------------------------

interface AwsSnapshot {
  eks_clusters?: Array<{ name: string; status: string; version?: string }>;
  rds_instances?: Array<{ identifier: string; engine: string; status: string; engineVersion?: string }>;
  elasticache_groups?: Array<{ id: string; status: string }>;
  config_compliance?: { non_compliant_rules: Array<{ rule: string; resource?: string }> };
  vpc_count?: number;
  service_quota_eks_remaining?: number;
  service_quota_rds_remaining?: number;
  snapshot_generated_at?: string;
  fabricated?: boolean;
}

// ---------------------------------------------------------------------------
// Snapshot-mode builder
// ---------------------------------------------------------------------------

function buildFromSnapshot(
  snapshot: AwsSnapshot,
  requiredServices: string[],
  config: AwsAdapterConfig,
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
      const active = (stub.eks_clusters ?? []).filter((c) => c.status === 'ACTIVE');
      service_checks.push({
        service: 'kubernetes',
        required: true,
        available_in_lz: true,
        provisioned_in_lz: active.length > 0,
        status: active.length > 0 ? 'ready' : 'blocked',
        note: active.length > 0 ? `EKS cluster: ${active[0].name}` : 'No ACTIVE EKS cluster found',
      });
      if (active.length === 0) {
        blockers.push({
          check_id: 'LZ-SVC-01',
          category: 'service',
          service: 'kubernetes',
          description: 'No active EKS cluster in landing zone',
          evidence: [],
          remediation: 'Provision an EKS cluster in the target region',
          blocks_migration: true,
        });
      }
    } else if (svc === 'postgresql') {
      const ready = (stub.rds_instances ?? []).filter((r) => r.engine === 'postgres' && r.status === 'available');
      service_checks.push({
        service: 'postgresql',
        required: true,
        available_in_lz: true,
        provisioned_in_lz: ready.length > 0,
        status: ready.length > 0 ? 'ready' : 'blocked',
        note: ready.length > 0 ? `RDS: ${ready[0].identifier} (v${ready[0].engineVersion ?? 'unknown'})` : 'No available RDS PostgreSQL instance',
      });
      if (ready.length === 0) {
        blockers.push({
          check_id: 'LZ-SVC-02',
          category: 'service',
          service: 'postgresql',
          description: 'No available RDS PostgreSQL instance in landing zone',
          evidence: [],
          remediation: 'Provision an RDS PostgreSQL instance in the target region',
          blocks_migration: true,
        });
      }
    } else if (svc === 'redis') {
      const ready = (stub.elasticache_groups ?? []).filter((g) => g.status === 'available');
      service_checks.push({
        service: 'redis',
        required: true,
        available_in_lz: true,
        provisioned_in_lz: ready.length > 0,
        status: ready.length > 0 ? 'ready' : 'blocked',
        note: ready.length > 0 ? `ElastiCache group: ${ready[0].id}` : 'No available ElastiCache Redis group',
      });
      if (ready.length === 0) {
        blockers.push({
          check_id: 'LZ-SVC-03',
          category: 'service',
          service: 'redis',
          description: 'No available ElastiCache Redis replication group',
          evidence: [],
          remediation: 'Provision an ElastiCache Redis cluster in the target region',
          blocks_migration: true,
        });
      }
    }
  }

  // Quota checks
  const eksQuota = stub.service_quota_eks_remaining ?? null;
  if (eksQuota !== null) {
    const eksOk = eksQuota > 0;
    quota_checks.push({
      resource: 'eks_clusters',
      available: eksQuota,
      status: eksOk ? 'ok' : 'blocked',
      note: eksOk ? `${eksQuota} EKS cluster slots remaining` : 'EKS cluster quota exhausted in region',
    });
    if (!eksOk) {
      blockers.push({
        check_id: 'LZ-QUO-01',
        category: 'quota',
        description: 'EKS cluster quota exhausted; cannot create new cluster in landing zone',
        evidence: [`service_quota_eks_remaining: ${eksQuota}`],
        remediation: 'Request EKS quota increase via AWS Service Quotas',
        blocks_migration: true,
      });
    }
  }

  const rdsQuota = stub.service_quota_rds_remaining ?? null;
  if (rdsQuota !== null) {
    quota_checks.push({
      resource: 'rds_instances',
      available: rdsQuota,
      status: rdsQuota > 0 ? 'ok' : 'blocked',
      note: rdsQuota > 0 ? `${rdsQuota} RDS instance slots remaining` : 'RDS instance quota exhausted',
    });
    if (rdsQuota === 0) {
      blockers.push({
        check_id: 'LZ-QUO-02',
        category: 'quota',
        description: 'RDS instance quota exhausted in region',
        evidence: [`service_quota_rds_remaining: ${rdsQuota}`],
        remediation: 'Request RDS quota increase via AWS Service Quotas',
        blocks_migration: true,
      });
    }
  }

  // Policy checks (AWS Config compliance)
  const nonCompliant = stub.config_compliance?.non_compliant_rules ?? [];
  policy_checks.push({
    check_id: 'LZ-POL-01',
    rule: 'aws-config-compliance',
    status: nonCompliant.length === 0 ? 'pass' : 'fail',
    severity: nonCompliant.length === 0 ? 'informational' : 'high',
    note: nonCompliant.length === 0
      ? 'No non-compliant AWS Config rules'
      : `${nonCompliant.length} non-compliant rule(s): ${nonCompliant.map((r) => r.rule).join(', ')}`,
  });

  // Network check
  const vpcCount = stub.vpc_count ?? 0;
  network_checks.push({
    check_id: 'LZ-NET-01',
    description: 'Non-default VPC exists in landing zone',
    status: vpcCount > 0 ? 'pass' : 'fail',
    note: vpcCount > 0 ? `${vpcCount} VPC(s) present` : 'No custom VPC found in subscription',
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

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

// #3570: scoped keys only; the Pass 23 keys aws-access-key-id, ... are moved
// by moveLegacyLzCredentials() and no longer read (no dual-read fallback).
// An expired lz:<lz>:<scope>:expires-at throws LzCredentialExpiredError
// before any request.
export async function resolveAwsCredentials(scope: { lzId: string; scopeId: string }): Promise<AwsCredentials> {
  const c = await resolveLzCredentials(credentialStore, scope.lzId, scope.scopeId, ['access-key-id', 'secret-access-key'], ['session-token']);
  return { accessKeyId: c['access-key-id'], secretAccessKey: c['secret-access-key'], sessionToken: c['session-token'] };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runAwsChecks(
  config: AwsAdapterConfig,
  requiredServices: string[],
): Promise<LandingZoneReadinessResult> {
  // Snapshot mode: detect snapshot file FIRST, before any credential lookup
  if (config.snapshotFile && existsSync(config.snapshotFile)) {
    const raw = readFileSync(config.snapshotFile, 'utf-8');
    const snapshot = JSON.parse(raw) as AwsSnapshot;
    return { ...buildFromSnapshot(snapshot, requiredServices, config), input_type: 'snapshot' as const };
  }

  // Live mode: resolve credentials then call AWS APIs (#0107 / #0479 C-23 AWS).
  let scope: { lzId: string; scopeId: string };
  try {
    if (!config.credentialScope) throw new Error('no landing zone scope registered');
    await resolveAwsCredentials(config.credentialScope);
    scope = config.credentialScope;
  } catch (err) {
    if (err instanceof LzCredentialExpiredError) throw err;
    return {
      provider_id: config.providerId,
      landing_zone_id: config.landingZoneId,
      assessed_at: new Date().toISOString(),
      ingestion_strategy: 'cloud_native',
      blockers: [],
      warnings: [{ check_id: 'LZ-WARN-00', category: 'service', description: 'AWS credentials not found; register the landing zone (landing_zones in .swao.yml) and store lz:<lz-id>:<scope-id>:access-key-id and secret-access-key', evidence: [] }],
      service_checks: [],
      quota_checks: [],
      policy_checks: [],
      network_checks: [],
      overall_verdict: 'advisory',
      input_type: 'live_api' as const,
    };
  }

  try {
    // #3574 (Design 120 section 7.5): the live reads run on the `aws` driver
    // transport (read-only allow-list, AWS action guard, endpoint seam).
    const state = await readAwsPass23StateForScope({ lzId: scope.lzId, scopeId: scope.scopeId, region: config.region, store: credentialStore });
    const liveSnapshot: AwsSnapshot = { ...state, elasticache_groups: [], config_compliance: { non_compliant_rules: [] } };
    return { ...buildFromSnapshot(liveSnapshot, requiredServices, config), input_type: 'live_api' as const };
  } catch (err) {
    return {
      provider_id: config.providerId,
      landing_zone_id: config.landingZoneId,
      assessed_at: new Date().toISOString(),
      ingestion_strategy: 'cloud_native',
      blockers: [],
      warnings: [{ check_id: 'LZ-WARN-02', category: 'service', description: `Live AWS API call failed: ${(err as Error).message}`, evidence: [] }],
      service_checks: [],
      quota_checks: [],
      policy_checks: [],
      network_checks: [],
      overall_verdict: 'advisory',
      input_type: 'live_api' as const,
    };
  }
}
