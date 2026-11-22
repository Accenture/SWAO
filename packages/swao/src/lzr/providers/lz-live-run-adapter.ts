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

// #4351 (owner decision 2026-11-12, Design 015 section 7.3a): Portfolio LZR
// reads the newest LZ Live run of a registered landing zone as its snapshot
// source. Read-only and from disk only: the run folder written by
// `runLzLiveAssessment` (module-landing-zone live/assess.ts), read through
// `readLzLiveRunForPortfolio` (live/portfolio.ts: latest-lz-live.txt, the
// merged view and the scope scans). No cloud API is ever called here, and
// never `.raw/` or a recording.
//
// Field mapping (Design 015 section 7.3a):
// - clusters, databases, caches: `estate.resources[].type` of the merged view,
//   by the type lists below (presence only; a live resource carries no run
//   state, so "ACTIVE" or "available" is not recorded by LZ Live);
// - quotas: `estate.quotas[]` of the scope scans (`remaining`, else
//   `limit - used`); a limit without usage is recorded but not judged;
// - policy compliance: `estate.guardrails[]` of the merged view (status
//   pass, fail, unknown) and the baseline checks `estate.checks[]`;
// - network: VPC and network resource types of the merged view.
// A block the run did not record (driver without a collector, source
// `not_collected`) is reported as "not recorded by LZ Live" with a warning,
// never as a pass (ADR-0041).

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  readLandingZones,
  readLzLiveRunForPortfolio,
  LZ_LIVE_MANIFEST_FILE,
  LZ_LIVE_RUN_STATUS_FILE,
  type LzLiveRunInput,
} from '@swao/module-landing-zone';
import type { LzLiveScan } from '@swao/core';
import type {
  LandingZoneReadinessResult,
  LZBlockerItem,
  LZWarningItem,
  LZServiceCheck,
  LZQuotaCheck,
  LZPolicyCheck,
  LZNetworkCheck,
} from '../../schema/wsp-lzr.js';

/** The text every field the live run did not record carries (operator facing, report and TUI). */
export const NOT_RECORDED_BY_LZ_LIVE = 'not recorded by LZ Live';

/** The resource categories LZR reads from a live run. */
export type LzrLiveCategory = 'clusters' | 'databases' | 'caches' | 'networks';

/**
 * Live resource types of each LZR category per provider. Sources: the driver
 * resource types of module-landing-zone live/resource-capabilities.ts
 * (LIVE_RESOURCE_CAPABILITY_MAPS), the AWS ARN formats (aws/aws-arn-formats.ts:
 * rds `db`, `cluster`; elasticache `replicationgroup`, `cluster`,
 * `serverlesscache`; memorydb `cluster`) and the STACKIT data kinds
 * (stackit/stackit-driver.ts STACKIT_DATA_KINDS). A category without types for
 * a provider is not recorded by that driver (for example STACKIT SKE clusters
 * and caches, which no STACKIT inventory lists).
 */
export const LZR_LIVE_CATEGORY_TYPES: Readonly<Record<string, Readonly<Record<LzrLiveCategory, readonly string[]>>>> = {
  aws: {
    clusters: ['eks.cluster'],
    databases: ['rds.db', 'rds.cluster', 'dynamodb.table'],
    caches: ['elasticache.replicationgroup', 'elasticache.cluster', 'elasticache.serverlesscache', 'memorydb.cluster'],
    networks: ['ec2.vpc'],
  },
  azure: {
    clusters: ['microsoft.containerservice/managedclusters'],
    databases: ['microsoft.dbforpostgresql/flexibleservers', 'microsoft.sql/servers'],
    caches: ['microsoft.cache/redis'],
    networks: ['microsoft.network/virtualnetworks'],
  },
  otc: {
    clusters: ['cce.clusters'],
    databases: ['rds.instances'],
    caches: ['dcs.instances'],
    networks: ['vpc.vpcs'],
  },
  stackit: {
    clusters: [],
    databases: ['postgres-flex.instance', 'sqlserver-flex.instance', 'mongodb-flex.instance'],
    caches: [],
    networks: ['iaas.network'],
  },
};

const CATEGORY_LABELS: Readonly<Record<LzrLiveCategory, string>> = {
  clusters: 'Kubernetes clusters',
  databases: 'databases',
  caches: 'caches',
  networks: 'networks (VPC)',
};

/** One LZ Live run read for LZR: the run input plus its status and simulation flag. */
export interface LzrLiveRun {
  lzId: string;
  provider: string;
  runId: string;
  /** run-status.json `status`; a failed run is never read. */
  status: 'complete' | 'partial';
  /** manifest.json `finished_at`, else the run folder name. */
  finishedAt: string;
  /** A scope of the run was served by a mock CSP (manifest `simulated`, merged scope `simulated`). */
  simulated: boolean;
  input: LzLiveRunInput;
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    const j = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    return j !== null && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The newest usable LZ Live run of a registered landing zone, read from disk:
 * `latest-lz-live.txt` (written for complete and partial runs), else the
 * newest run folder with a merged view. Returns the reason as a string when
 * there is none (not registered, no run, failed run, unreadable files).
 */
export function readLzrLiveRun(workspaceRoot: string, lzId: string): LzrLiveRun | string {
  let provider: string | undefined;
  try {
    provider = readLandingZones(workspaceRoot).find((l) => l.id === lzId)?.provider;
  } catch (err) {
    return `landing zones not readable: ${(err as Error).message}`;
  }
  if (!provider) return `landing zone ${lzId} is not registered in .swao.yml`;
  const input = readLzLiveRunForPortfolio(workspaceRoot, lzId, provider);
  if (typeof input === 'string') return `landing zone ${lzId}: ${input}`;
  const runDir = join(workspaceRoot, 'landing-zones', lzId, 'wsp', 'runs', input.runId);
  const status = readJson(join(runDir, LZ_LIVE_RUN_STATUS_FILE))?.['status'];
  if (status === 'failed') return `landing zone ${lzId}: LZ Live run ${input.runId} failed`;
  const manifest = existsSync(join(runDir, LZ_LIVE_MANIFEST_FILE)) ? readJson(join(runDir, LZ_LIVE_MANIFEST_FILE)) : undefined;
  const finished = manifest?.['finished_at'];
  const simulated = manifest?.['simulated'] === true || input.merged.scopes.some((s) => s.status === 'merged' && s.simulated !== undefined);
  return {
    lzId,
    provider,
    runId: input.runId,
    // A run without run-status.json (older runs) counts as complete when it has a merged view.
    status: status === 'partial' ? 'partial' : 'complete',
    finishedAt: typeof finished === 'string' ? finished : input.runId,
    simulated,
    input,
  };
}

/** The scans of the merged scopes (the ones the merged view used). */
function mergedScans(run: LzrLiveRun): LzLiveScan[] {
  return run.input.merged.scopes
    .filter((s) => s.status === 'merged')
    .map((s) => run.input.scans.get(s.scope_id))
    .filter((s): s is LzLiveScan => s !== undefined);
}

/**
 * Live resource types read by the optional service inventory
 * (`listServiceResources`, source `inventory:service-resources`, #3970), not
 * by the main inventory (`inventory:resources`). Today the STACKIT data kinds
 * only (stackit-driver.ts STACKIT_DATA_KINDS; no other driver implements it).
 */
const SERVICE_INVENTORY_TYPES: ReadonlySet<string> = new Set(['postgres-flex.instance', 'sqlserver-flex.instance', 'mongodb-flex.instance']);
const SERVICE_INVENTORY_SOURCE = 'inventory:service-resources';
const MAIN_INVENTORY_SOURCE = 'inventory:resources';

/** How a block was collected across the merged scopes. */
export type LzrLiveCoverage = 'recorded' | 'partial' | 'not-recorded';

function underSource(name: string, prefix: string): boolean {
  return name === prefix || name.startsWith(`${prefix}:`);
}

/**
 * Coverage of the source a block depends on. A source a scan lists as
 * `not_collected` (the exact name, or a name under it: `guardrails:organizations`
 * under `guardrails`, `quotas:eu-de` under `quotas`) is missing in that scan.
 * `requireOk` sources (the optional service inventory) are also missing when
 * the scan does not list them at all (the collector did not run).
 * Not recorded: missing in every merged scan (or no scan); partial: missing in
 * some; recorded: missing in none.
 */
function coverage(scans: readonly LzLiveScan[], prefix: string, requireOk = false): LzrLiveCoverage {
  if (scans.length === 0) return 'not-recorded';
  const missing = scans.filter((s) => {
    const own = s.meta.sources.filter((src) => underSource(src.name, prefix));
    if (own.some((src) => src.status === 'not_collected')) return true;
    return requireOk && !own.some((src) => src.status === 'ok');
  }).length;
  return missing === 0 ? 'recorded' : missing === scans.length ? 'not-recorded' : 'partial';
}

/** The sources under a block that a merged scope could not read (`guardrails:organizations`, `quotas:eu-de`). */
function blockGaps(scans: readonly LzLiveScan[], prefix: string): string[] {
  const names = new Set<string>();
  for (const s of scans) {
    for (const src of s.meta.sources) if (src.status === 'not_collected' && underSource(src.name, prefix)) names.add(src.name);
  }
  return [...names].sort();
}

interface CategoryView { coverage: LzrLiveCoverage; count: number }

/** Per category: how its inventory was collected and how many resources of its types the merged view holds. */
function categoryView(run: LzrLiveRun, scans: readonly LzLiveScan[], c: LzrLiveCategory): CategoryView {
  const types = LZR_LIVE_CATEGORY_TYPES[run.provider]?.[c] ?? [];
  if (types.length === 0) return { coverage: 'not-recorded', count: 0 };
  const parts: LzrLiveCoverage[] = [];
  if (types.some((t) => !SERVICE_INVENTORY_TYPES.has(t))) parts.push(coverage(scans, MAIN_INVENTORY_SOURCE));
  if (types.some((t) => SERVICE_INVENTORY_TYPES.has(t))) parts.push(coverage(scans, SERVICE_INVENTORY_SOURCE, true));
  const cov: LzrLiveCoverage = parts.every((p) => p === 'not-recorded') ? 'not-recorded' : parts.every((p) => p === 'recorded') ? 'recorded' : 'partial';
  // Case-insensitive: Azure Resource Graph types arrive in mixed case.
  const wanted = new Set(types.map((t) => t.toLowerCase()));
  return { coverage: cov, count: run.input.merged.estate.resources.filter((r) => wanted.has(r.type.toLowerCase())).length };
}

/** The LZR fields a live run of this provider and these scans does not record, or records only in part (summary row and report). */
export function lzrLiveNotRecorded(run: LzrLiveRun): string[] {
  const scans = mergedScans(run);
  const out: string[] = [];
  for (const c of ['clusters', 'databases', 'caches', 'networks'] as const) {
    const v = categoryView(run, scans, c);
    if (v.coverage === 'not-recorded') out.push(CATEGORY_LABELS[c]);
    else if (v.coverage === 'partial') out.push(`${CATEGORY_LABELS[c]} (partial)`);
  }
  const quotas = scans.flatMap((s) => s.estate.quotas);
  if (quotas.length === 0) out.push('quotas');
  else {
    if (!quotas.some((q) => remainingOf(q) !== undefined)) out.push('quota usage');
    if (blockGaps(scans, 'quotas').length > 0) out.push('quotas (partial)');
  }
  if (run.input.merged.estate.guardrails.length === 0) out.push('policy compliance');
  else if (blockGaps(scans, 'guardrails').length > 0) out.push('policy compliance (partial)');
  out.push('resource state (running, available)');
  return out;
}

function remainingOf(q: LzLiveScan['estate']['quotas'][number]): number | undefined {
  if (typeof q.remaining === 'number') return q.remaining;
  if (typeof q.limit === 'number' && typeof q.used === 'number') return q.limit - q.used;
  return undefined;
}

/**
 * The LZR result of a live run: the same LandingZoneReadinessResult shape as
 * the snapshot adapters. Pure: the run is already read. Verdict like the
 * snapshot adapters: blockers give blocked, warnings give advisory, else
 * ready; every block the run did not record adds a warning, so a live run
 * without quotas or policy data never reads READY.
 */
export function buildLzrFromLiveRun(run: LzrLiveRun, now: Date = new Date()): LandingZoneReadinessResult {
  const scans = mergedScans(run);
  const merged = run.input.merged;
  const runRef = `landing-zones/${run.lzId}/wsp/runs/${run.runId}/`;

  const blockers: LZBlockerItem[] = [];
  const warnings: LZWarningItem[] = [];
  const service_checks: LZServiceCheck[] = [];
  const quota_checks: LZQuotaCheck[] = [];
  const policy_checks: LZPolicyCheck[] = [];
  const network_checks: LZNetworkCheck[] = [];

  // Clusters, databases, caches: inventory only. Portfolio LZR runs with no
  // required services (runPortfolioLzr passes [] to every adapter), so these
  // rows inform and never decide the verdict, as for the snapshot files.
  for (const c of ['clusters', 'databases', 'caches'] as const) {
    const v = categoryView(run, scans, c);
    const recorded = v.coverage !== 'not-recorded';
    service_checks.push({
      service: CATEGORY_LABELS[c],
      required: false,
      available_in_lz: recorded && v.count > 0,
      provisioned_in_lz: !recorded || (v.coverage === 'partial' && v.count === 0) ? null : v.count > 0,
      status: v.coverage === 'recorded' ? 'ready' : 'warning',
      note: !recorded
        ? `${CATEGORY_LABELS[c]}: ${NOT_RECORDED_BY_LZ_LIVE}`
        : `${v.count} observed in the LZ Live run${v.coverage === 'partial' ? ' (inventory partial: a scope did not read it)' : ''}; resource state ${NOT_RECORDED_BY_LZ_LIVE}`,
    });
  }

  // Quotas: remaining recorded (STACKIT limit and usage) is judged; a limit
  // without usage (AWS Service Quotas) is listed but not judged.
  const quotas = scans.flatMap((s) => s.estate.quotas);
  const judged = quotas.filter((q) => remainingOf(q) !== undefined);
  for (const q of judged) {
    const remaining = remainingOf(q) as number;
    const ok = remaining > 0;
    quota_checks.push({
      resource: q.region ? `${q.resource} (${q.region})` : q.resource,
      available: remaining,
      status: ok ? 'ok' : 'blocked',
      note: ok ? `${remaining} remaining` : 'quota exhausted',
    });
    if (!ok) {
      blockers.push({
        check_id: 'LZ-QUO-LIVE',
        category: 'quota',
        description: `Quota ${q.resource} exhausted in the landing zone`,
        evidence: [`${runRef}: remaining ${remaining}${q.region ? ` in ${q.region}` : ''}`],
        remediation: 'Request a quota increase from the provider before migrating',
        blocks_migration: true,
      });
    }
  }
  const unjudged = quotas.length - judged.length;
  if (quotas.length === 0 || unjudged > 0) {
    const note = quotas.length === 0
      ? `quotas: ${NOT_RECORDED_BY_LZ_LIVE}`
      : `${unjudged} quota limit(s) recorded; usage ${NOT_RECORDED_BY_LZ_LIVE}`;
    quota_checks.push({ resource: 'quotas', available: null, status: 'warning', note });
    if (judged.length === 0) {
      warnings.push({ check_id: 'LZ-WARN-LIVE-QUO', category: 'quota', description: `Quota headroom ${NOT_RECORDED_BY_LZ_LIVE} (${note})`, evidence: [runRef] });
    }
  }
  // A region or scope whose quotas were not read leaves the headroom partial: never a clean pass.
  const quotaGaps = quotas.length > 0 ? blockGaps(scans, 'quotas') : [];
  if (quotaGaps.length > 0) {
    quota_checks.push({ resource: 'quotas', available: null, status: 'warning', note: `partial: ${quotaGaps.join(', ')} ${NOT_RECORDED_BY_LZ_LIVE}` });
    warnings.push({ check_id: 'LZ-WARN-LIVE-QUO', category: 'quota', description: `Quotas recorded in part: ${quotaGaps.join(', ')} ${NOT_RECORDED_BY_LZ_LIVE}`, evidence: [runRef] });
  }

  // Policy compliance: the guardrails of the merged view, then the baseline checks.
  const guardrails = merged.estate.guardrails;
  if (guardrails.length === 0) {
    policy_checks.push({ check_id: 'LZ-POL-LIVE', rule: 'lz-live-guardrails', status: 'skipped', note: `policy compliance: ${NOT_RECORDED_BY_LZ_LIVE}` });
    warnings.push({ check_id: 'LZ-WARN-LIVE-POL', category: 'policy', description: `Policy compliance ${NOT_RECORDED_BY_LZ_LIVE}: the run holds no guardrails`, evidence: [runRef] });
  } else {
    const failed = guardrails.filter((g) => g.status === 'fail');
    const unknown = guardrails.filter((g) => g.status === 'unknown');
    // A guardrail source a scope could not read (for example guardrails:organizations
    // on an application scope login, Design 120 section 5.2) leaves the policy picture
    // partial: the row is never a pass then.
    const gaps = blockGaps(scans, 'guardrails');
    const cleanStatus: LZPolicyCheck['status'] = unknown.length === guardrails.length || gaps.length > 0 ? 'skipped' : 'pass';
    policy_checks.push({
      check_id: 'LZ-POL-LIVE',
      rule: 'lz-live-guardrails',
      status: failed.length > 0 ? 'fail' : cleanStatus,
      severity: failed.length > 0 ? 'high' : 'informational',
      note: `${guardrails.length} guardrail(s): ${guardrails.length - failed.length - unknown.length} pass, ${failed.length} fail, ${unknown.length} unknown${gaps.length > 0 ? `; partial: ${gaps.join(', ')} ${NOT_RECORDED_BY_LZ_LIVE}` : ''}`,
    });
    if (gaps.length > 0) {
      warnings.push({ check_id: 'LZ-WARN-LIVE-POL', category: 'policy', description: `Policy compliance recorded in part: ${gaps.join(', ')} ${NOT_RECORDED_BY_LZ_LIVE}`, evidence: [runRef] });
    }
    if (failed.length > 0) {
      warnings.push({
        check_id: 'LZ-POL-LIVE',
        category: 'policy',
        description: `${failed.length} guardrail(s) fail in the LZ Live run: ${[...new Set(failed.map((g) => g.type))].join(', ')}`,
        evidence: [runRef],
        remediation: 'See the LZ Live Assessment publication of this landing zone for each guardrail',
      });
    }
  }
  const checks = scans.flatMap((s) => s.estate.checks);
  if (checks.length > 0) {
    const fail = checks.filter((c) => c.status === 'fail').length;
    const warn = checks.filter((c) => c.status === 'warn').length;
    const unverified = checks.filter((c) => c.status === 'unverified').length;
    policy_checks.push({
      check_id: 'LZ-POL-LIVE-BASELINE',
      rule: 'lz-live-baseline-checks',
      status: fail > 0 ? 'fail' : 'pass',
      severity: fail > 0 ? 'medium' : 'informational',
      note: `${checks.length} baseline check(s): ${fail} fail, ${warn} warn, ${unverified} unverified`,
    });
  }

  // Network: VPC and network resources. An observed network passes even when a
  // scope did not read its inventory; "none observed" decides only on a full inventory.
  const nets = categoryView(run, scans, 'networks');
  if (nets.coverage === 'not-recorded' || (nets.coverage === 'partial' && nets.count === 0)) {
    const what = nets.coverage === 'partial' ? 'recorded in part, none observed' : NOT_RECORDED_BY_LZ_LIVE;
    network_checks.push({ check_id: 'LZ-NET-01', description: 'Network (VPC) exists in landing zone', status: 'skipped', note: `networks: ${what}` });
    warnings.push({ check_id: 'LZ-WARN-LIVE-NET', category: 'network', description: `Networks ${what}`, evidence: [runRef] });
  } else {
    network_checks.push({
      check_id: 'LZ-NET-01',
      description: 'Network (VPC) exists in landing zone',
      status: nets.count > 0 ? 'pass' : 'fail',
      note: nets.count > 0 ? `${nets.count} network(s) observed` : 'No network observed in the LZ Live run',
    });
  }

  if (run.status === 'partial') {
    warnings.push({ check_id: 'LZ-WARN-LIVE-RUN', category: 'service', description: `LZ Live run ${run.runId} is partial: at least one scope did not complete`, evidence: [`${runRef}${LZ_LIVE_RUN_STATUS_FILE}`] });
  }

  const overall_verdict: LandingZoneReadinessResult['overall_verdict'] =
    blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'advisory' : 'ready';

  return {
    provider_id: run.provider,
    landing_zone_id: run.lzId,
    assessed_at: now.toISOString(),
    ingestion_strategy: 'cloud_native',
    blockers,
    warnings,
    service_checks,
    quota_checks,
    policy_checks,
    network_checks,
    overall_verdict,
  };
}
