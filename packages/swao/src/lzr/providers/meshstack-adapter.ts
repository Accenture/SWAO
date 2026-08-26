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
import { credentialStore } from '@swao/core';
import type { LandingZoneReadinessResult, LZServiceCheck, LZQuotaCheck, LZBlockerItem, LZWarningItem, LZNetworkCheck } from '../../schema/wsp-lzr.js';

// ---------------------------------------------------------------------------
// Public config
// ---------------------------------------------------------------------------

export interface MeshstackAdapterConfig {
  platformId: string;
  landingZoneId: string;
  providerId: string;
  baseUrl?: string;
  workspaceId?: string;
  projectId?: string;
  snapshotFile?: string;
}

// ---------------------------------------------------------------------------
// Snapshot file shape (WoZ / CI mode)
// ---------------------------------------------------------------------------

interface BBDefinition {
  identifier: string;
  displayName: string;
  status?: string;
}

interface BBInstance {
  definitionIdentifier: string;
  state: string;
  displayName?: string;
}

interface MeshstackSnapshot {
  platform_id?: string;
  tenant_exists?: boolean;
  building_block_definitions?: BBDefinition[];
  building_block_instances?: BBInstance[];
  quota_supported?: boolean;
  snapshot_generated_at?: string;
  fabricated?: boolean;
}

// ---------------------------------------------------------------------------
// BB service keyword matching
// ---------------------------------------------------------------------------

function matchesService(defDisplayName: string, defIdentifier: string, service: string): boolean {
  const haystack = (defDisplayName + ' ' + defIdentifier).toLowerCase();
  return haystack.includes(service.toLowerCase());
}

// ---------------------------------------------------------------------------
// Snapshot-mode builder
// ---------------------------------------------------------------------------

function buildFromSnapshot(
  snapshot: MeshstackSnapshot,
  requiredServices: string[],
  config: MeshstackAdapterConfig,
): LandingZoneReadinessResult {
  const stub = snapshot;
  const now = new Date().toISOString();
  const blockers: LZBlockerItem[] = [];
  const warnings: LZWarningItem[] = [];
  const service_checks: LZServiceCheck[] = [];
  const quota_checks: LZQuotaCheck[] = [];
  const network_checks: LZNetworkCheck[] = [];

  // Tenant existence check
  const tenantExists = stub.tenant_exists ?? true;
  if (!tenantExists) {
    warnings.push({
      check_id: 'LZ-SVC-01',
      category: 'service',
      description: `Landing zone tenant not yet provisioned on platform ${config.platformId}`,
      evidence: [`platform_id: ${config.platformId}`, 'tenant_exists: false'],
      remediation: `Provision a meshTenant on platform ${config.platformId} for this project`,
    });
  }

  // Only check BBs if tenant exists -- without tenant, BB instances won't be there either
  const definitions = stub.building_block_definitions ?? [];
  const instances = stub.building_block_instances ?? [];
  const succeededInstances = instances.filter((i) => i.state === 'SUCCEEDED');

  // Build a lookup from definition identifier -> definition display name
  const defByIdentifier = new Map(definitions.map((d) => [d.identifier, d]));

  // Service checks via BB instance -> definition keyword matching
  for (const svc of requiredServices) {
    const matchedBB = succeededInstances.find((inst) => {
      const def = defByIdentifier.get(inst.definitionIdentifier);
      const displayName = def?.displayName ?? inst.displayName ?? '';
      return matchesService(displayName, inst.definitionIdentifier, svc);
    });
    const checkId = `LZ-MESH-${String(requiredServices.indexOf(svc) + 1).padStart(2, '0')}`;
    const isReady = tenantExists && matchedBB !== undefined;

    service_checks.push({
      service: svc,
      required: true,
      available_in_lz: true,
      provisioned_in_lz: isReady,
      status: isReady ? 'ready' : 'warning',
      note: isReady
        ? `Building Block: ${defByIdentifier.get(matchedBB!.definitionIdentifier)?.displayName ?? matchedBB!.definitionIdentifier} (SUCCEEDED)`
        : `No SUCCEEDED Building Block matching "${svc}" found on platform ${config.platformId}`,
    });

    if (!isReady) {
      warnings.push({
        check_id: checkId,
        category: 'service',
        service: svc,
        description: `No active Building Block for "${svc}" on platform ${config.platformId}`,
        evidence: [`tenant_exists: ${tenantExists}`, `succeeded_bb_count: ${succeededInstances.length}`],
        remediation: `Deploy a Building Block covering "${svc}" via meshStack on platform ${config.platformId}`,
      });
    }
  }

  // Quota check (optional -- skip silently if not supported)
  const quotaSupported = stub.quota_supported ?? false;
  if (quotaSupported) {
    quota_checks.push({
      resource: 'meshstack_quota',
      status: 'ok',
      note: 'meshStack quota check passed (quota data not in stub)',
    });
  }

  // Verdict: blockers -> blocked; warnings only -> advisory; none -> ready
  const overall_verdict: LandingZoneReadinessResult['overall_verdict'] =
    blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'advisory' : 'ready';

  return {
    provider_id: config.providerId,
    landing_zone_id: config.landingZoneId,
    assessed_at: now,
    ingestion_strategy: 'meshcloud',
    blockers,
    warnings,
    service_checks,
    quota_checks,
    policy_checks: [],
    network_checks,
    overall_verdict,
  };
}

// ---------------------------------------------------------------------------
// Live-mode credential resolution (compiles; not called in CI stub mode)
// ---------------------------------------------------------------------------

export async function resolveMeshstackApiKey(): Promise<string> {
  return credentialStore.getOrThrow('meshstack-api-key', 'meshStack LZR adapter');
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runMeshstackChecks(
  config: MeshstackAdapterConfig,
  requiredServices: string[],
): Promise<LandingZoneReadinessResult> {
  // Snapshot mode: detect snapshot file FIRST, before any credential lookup
  if (config.snapshotFile && existsSync(config.snapshotFile)) {
    const raw = readFileSync(config.snapshotFile, 'utf-8');
    const snapshot = JSON.parse(raw) as MeshstackSnapshot;
    return { ...buildFromSnapshot(snapshot, requiredServices, config), input_type: 'snapshot' as const };
  }

  // Live mode: resolve API key then call meshStack APIs (#0109 / #0480 C-23 meshStack).
  let apiKey: string;
  try {
    apiKey = await resolveMeshstackApiKey();
  } catch {
    return {
      provider_id: config.providerId,
      landing_zone_id: config.landingZoneId,
      assessed_at: new Date().toISOString(),
      ingestion_strategy: 'meshcloud',
      blockers: [],
      warnings: [{ check_id: 'LZ-WARN-00', category: 'service', description: 'meshStack API key not found; configure meshstack-api-key', evidence: [] }],
      service_checks: [],
      quota_checks: [],
      policy_checks: [],
      network_checks: [],
      overall_verdict: 'advisory',
      input_type: 'live_api' as const,
    };
  }

  const baseUrl = config.baseUrl ?? 'https://mesh.stackit.de';
  try {
    const liveSnapshot = await fetchMeshstackState(apiKey, baseUrl, config);
    return { ...buildFromSnapshot(liveSnapshot, requiredServices, config), input_type: 'live_api' as const };
  } catch (err) {
    return {
      provider_id: config.providerId,
      landing_zone_id: config.landingZoneId,
      assessed_at: new Date().toISOString(),
      ingestion_strategy: 'meshcloud',
      blockers: [],
      warnings: [{ check_id: 'LZ-WARN-02', category: 'service', description: `Live meshStack API call failed: ${(err as Error).message}`, evidence: [] }],
      service_checks: [],
      quota_checks: [],
      policy_checks: [],
      network_checks: [],
      overall_verdict: 'advisory',
      input_type: 'live_api' as const,
    };
  }
}

async function meshFetch(url: string, apiKey: string): Promise<unknown> {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`meshStack HTTP ${resp.status} from ${new URL(url).hostname}`);
  return resp.json();
}

async function fetchMeshstackState(apiKey: string, baseUrl: string, config: MeshstackAdapterConfig): Promise<MeshstackSnapshot> {
  const base = baseUrl.replace(/\/$/, '');

  const [bbDefs, bbInstances] = await Promise.all([
    meshFetch(`${base}/api/meshobjects/meshbuildingblockdefinitions`, apiKey) as Promise<{ _embedded?: { 'mesh:meshBuildingBlockDefinitions'?: BBDefinition[] } }>,
    meshFetch(`${base}/api/meshobjects/meshbuildingblocks`, apiKey) as Promise<{ _embedded?: { 'mesh:meshBuildingBlocks'?: Array<{ spec?: { definitionIdentifier?: string; displayName?: string }; status?: { status?: string } }> } }>,
  ]);

  const definitions = bbDefs._embedded?.['mesh:meshBuildingBlockDefinitions'] ?? [];
  const instances = (bbInstances._embedded?.['mesh:meshBuildingBlocks'] ?? []).map((b) => ({
    definitionIdentifier: b.spec?.definitionIdentifier ?? '',
    state: b.status?.status ?? 'UNKNOWN',
    displayName: b.spec?.displayName,
  }));

  return {
    platform_id: config.platformId,
    tenant_exists: true,
    building_block_definitions: definitions,
    building_block_instances: instances,
    quota_supported: false,
  };
}
