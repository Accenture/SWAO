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
 * AWS LZ scan normaliser (Design 056 Layer B, #0566). Maps an AWS landing-zone
 * snapshot -- the existing `lz-aws-snapshot.json` shape produced by IaC export
 * or a read-only inventory (AWS Config / Resource Groups) -- into the normalised
 * LzScanResult the fit engine consumes. No credentials: the snapshot is
 * operator-provided (Mode A IaC / Mode B export). Mode C (live read-only scan)
 * produces the same shape via a transport, then reuses this normaliser.
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

export interface AwsScanOptions {
  collectionMode?: 'iac' | 'export' | 'live';
  scannedAt?: string;
  region?: string;
}

export function normalizeAwsSnapshot(raw: Record<string, unknown>, opts: AwsScanOptions = {}): LzScanResult {
  const services: LzEnabledService[] = [];

  const eks = asArray(raw['eks_clusters']);
  if (eks.length > 0) {
    services.push({
      code: 'eks',
      fulfills: ['kubernetes'],
      provisioned: eks.some((c) => str((c as Record<string, unknown>)['status']) === 'ACTIVE'),
      count: eks.length,
      version: str((eks[0] as Record<string, unknown>)['version']),
    });
  }

  // RDS instances grouped by engine -> rds-<engine>.
  const rds = asArray(raw['rds_instances']);
  const byEngine = new Map<string, { count: number; version?: string; available: boolean }>();
  for (const r of rds) {
    const rec = r as Record<string, unknown>;
    const engine = str(rec['engine']) ?? 'unknown';
    const cur = byEngine.get(engine) ?? { count: 0, available: false };
    cur.count += 1;
    cur.version = cur.version ?? str(rec['engineVersion']);
    if (str(rec['status']) === 'available') cur.available = true;
    byEngine.set(engine, cur);
  }
  for (const [engine, info] of byEngine) {
    const cap = engine === 'postgres' ? 'postgresql' : engine;
    services.push({ code: `rds-${engine}`, fulfills: [cap], provisioned: info.available, count: info.count, version: info.version });
  }

  const elasticache = asArray(raw['elasticache_groups']);
  if (elasticache.length > 0) {
    services.push({
      code: 'elasticache',
      fulfills: ['redis'],
      provisioned: elasticache.some((g) => str((g as Record<string, unknown>)['status']) === 'available'),
      count: elasticache.length,
    });
  }

  // EC2 instances -> vm_compute.
  const ec2 = asArray(raw['ec2_instances']);
  if (ec2.length > 0) {
    services.push({
      code: 'ec2',
      fulfills: ['vm_compute'],
      provisioned: ec2.some((i) => str((i as Record<string, unknown>)['state']) === 'running'),
      count: ec2.length,
    });
  }

  // VPCs -> networking.
  const vpcs = asArray(raw['vpcs']);
  const vpcCount = num(raw['vpc_count']);
  if (vpcs.length > 0 || (vpcCount !== undefined && vpcCount > 0)) {
    services.push({ code: 'vpc', fulfills: ['networking'], provisioned: true, count: vpcCount ?? vpcs.length });
  }

  // EBS volumes -> block_storage.
  const ebs = asArray(raw['ebs_volumes']);
  if (ebs.length > 0) {
    services.push({
      code: 'ebs',
      fulfills: ['block_storage'],
      provisioned: ebs.some((v) => str((v as Record<string, unknown>)['state']) === 'in-use'),
      count: ebs.length,
    });
  }

  // S3 buckets -> object_storage.
  const s3 = asArray(raw['s3_buckets']);
  if (s3.length > 0) {
    services.push({ code: 's3', fulfills: ['object_storage'], provisioned: true, count: s3.length });
  }

  // Guardrails from AWS Config non-compliant rules.
  const guardrails: LzGuardrail[] = [];
  const config = raw['config_compliance'] as Record<string, unknown> | undefined;
  for (const rule of asArray(config?.['non_compliant_rules'])) {
    guardrails.push({ type: 'config-rule', id: str(rule) ?? String(rule), status: 'fail' });
  }

  // Quotas.
  const quotas: LzQuota[] = [];
  const eksQuota = num(raw['service_quota_eks_remaining']);
  if (eksQuota !== undefined) quotas.push({ resource: 'eks', remaining: eksQuota });
  const rdsQuota = num(raw['service_quota_rds_remaining']);
  if (rdsQuota !== undefined) quotas.push({ resource: 'rds', remaining: rdsQuota });

  const mode = opts.collectionMode ?? 'export';
  return {
    provider: 'aws',
    collection_mode: mode,
    confidence: mode === 'iac' ? 'declared' : 'observed',
    scanned_at: opts.scannedAt ?? str(raw['snapshot_generated_at']) ?? new Date().toISOString().slice(0, 10),
    regions: opts.region ? [opts.region] : [],
    enabled_services: services,
    guardrails,
    quotas,
    provenance: {
      source: mode === 'iac' ? 'terraform/iac' : 'aws-snapshot',
      fabricated: raw['fabricated'] === true,
    },
  };
}
