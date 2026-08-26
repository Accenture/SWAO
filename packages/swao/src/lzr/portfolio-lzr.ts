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

import { readdirSync, existsSync, statSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import type { LandingZoneReadinessResult } from '../schema/wsp-lzr.js';
import { runAwsChecks } from './providers/aws-adapter.js';
import { runAzureChecks } from './providers/azure-adapter.js';
import { runMeshstackChecks } from './providers/meshstack-adapter.js';
import { findLzrInputFiles, runLzrPass } from '../passes/index.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

type Verdict = 'ready' | 'blocked' | 'advisory';

export interface AppLzrResult {
  app_id: string;
  provider_id: string;
  landing_zone_id: string;
  verdict: Verdict | 'skipped';
  blocker_count: number;
  warning_count: number;
  skip_reason?: string;
  /** #1256: basename of the snapshot file that drove this result (e.g. lz-meshstack-snapshot.json). */
  source_snapshot?: string;
  /** #1256: display label derived from the snapshot filename (e.g. lz-meshstack). */
  picker_label?: string;
  /** #1260: true when the snapshot was flagged fabricated:true -- verdict is simulated, not real cloud state. */
  lzr_snapshot_fabricated?: boolean;
}

export interface PortfolioLzrSummary {
  assessed_at: string;
  total_apps: number;
  apps: AppLzrResult[];
  counts: { ready: number; blocked: number; advisory: number; skipped: number };
  overall_verdict: Verdict;
}

// ---------------------------------------------------------------------------
// Adapter detection
// ---------------------------------------------------------------------------

type AdapterType = 'aws' | 'azure' | 'meshstack' | 'terraform';

interface AppAdapterConfig {
  appId: string;
  appDir: string;
  adapterType: AdapterType;
  providerId: string;
  landingZoneId: string;
  snapshotFile?: string;
  /** #1256: display label derived from snapshotFile basename (strip path + -snapshot suffix). */
  pickerLabel?: string;
  /** #1260: true when snapshot JSON has fabricated:true. */
  fabricated?: boolean;
}

function snapshotPickerLabel(snapshotPath: string): string {
  return basename(snapshotPath, '.json').replace(/-snapshot$/, '');
}

function readFabricatedFlag(snapshotPath: string): boolean | undefined {
  try {
    const snap = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as Record<string, unknown>;
    return snap.fabricated === true ? true : undefined;
  } catch {
    return undefined;
  }
}

const AWS_PROVIDER = 'aws_eu_central_1';
const AWS_LZ = 'lz-aws-eu-central-1';
const AZURE_PROVIDER = 'azure_eu_west';
const AZURE_LZ = 'lz-azure-eu-west';
const MESHSTACK_PROVIDER = 'stackit_de_sovereign';
const MESHSTACK_LZ = 'lz-stackit-de-01';
const TERRAFORM_PROVIDER = 'stackit_de_sovereign';

function discoverApps(workspaceRoot: string): string[] {
  const appsDir = join(workspaceRoot, 'apps');
  if (!existsSync(appsDir)) return [];
  return readdirSync(appsDir)
    .filter((name) => {
      try {
        return statSync(join(appsDir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

export function detectAdapterConfig(
  appId: string,
  appDir: string,
  landingZoneId: string,
): AppAdapterConfig | null {
  // #0227 / #0232: LZ snapshots live under <appDir>/wsp/inputs/terraform/
  // (per-app scope). The legacy <appDir>/imports/ path has been retired.
  const importsDir = join(appDir, 'wsp', 'inputs', 'terraform');
  if (!existsSync(importsDir)) return null;

  // Priority: meshstack > aws > azure > terraform
  const meshFile = join(importsDir, 'lz-meshstack-snapshot.json');
  if (existsSync(meshFile)) {
    return {
      appId,
      appDir,
      adapterType: 'meshstack',
      providerId: MESHSTACK_PROVIDER,
      landingZoneId: MESHSTACK_LZ,
      snapshotFile: meshFile,
      pickerLabel: snapshotPickerLabel(meshFile),
      fabricated: readFabricatedFlag(meshFile),
    };
  }

  const awsFile = join(importsDir, 'lz-aws-snapshot.json');
  if (existsSync(awsFile)) {
    return {
      appId,
      appDir,
      adapterType: 'aws',
      providerId: AWS_PROVIDER,
      landingZoneId: AWS_LZ,
      snapshotFile: awsFile,
      pickerLabel: snapshotPickerLabel(awsFile),
      fabricated: readFabricatedFlag(awsFile),
    };
  }

  const azureFile = join(importsDir, 'lz-azure-snapshot.json');
  if (existsSync(azureFile)) {
    return {
      appId,
      appDir,
      adapterType: 'azure',
      providerId: AZURE_PROVIDER,
      landingZoneId: AZURE_LZ,
      snapshotFile: azureFile,
      pickerLabel: snapshotPickerLabel(azureFile),
      fabricated: readFabricatedFlag(azureFile),
    };
  }

  const tfFiles = findLzrInputFiles(appDir);
  if (tfFiles.length > 0) {
    return {
      appId,
      appDir,
      adapterType: 'terraform',
      providerId: TERRAFORM_PROVIDER,
      landingZoneId,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Adapter runner
// ---------------------------------------------------------------------------

async function runAdapter(config: AppAdapterConfig): Promise<LandingZoneReadinessResult> {
  switch (config.adapterType) {
    case 'meshstack':
      return runMeshstackChecks(
        {
          platformId: config.landingZoneId,
          landingZoneId: config.landingZoneId,
          providerId: config.providerId,
          snapshotFile: config.snapshotFile,
        },
        [],
      );

    case 'aws':
      return runAwsChecks(
        {
          region: 'eu-central-1',
          landingZoneId: config.landingZoneId,
          providerId: config.providerId,
          snapshotFile: config.snapshotFile,
        },
        [],
      );

    case 'azure':
      return runAzureChecks(
        {
          subscriptionId: 'portfolio',
          location: 'westeurope',
          landingZoneId: config.landingZoneId,
          providerId: config.providerId,
          snapshotFile: config.snapshotFile,
        },
        [],
      );

    case 'terraform': {
      const result = await runLzrPass(
        {
          appId: config.appId,
          sourcePath: config.appDir,
          workspacePath: config.appDir,
          iter: 1,
          assessedAt: new Date().toISOString().slice(0, 10),
        },
        { providerId: config.providerId, landingZoneId: config.landingZoneId },
      );
      return result.lzrResult;
    }
  }
}

// ---------------------------------------------------------------------------
// Portfolio entry point
// ---------------------------------------------------------------------------

export async function runPortfolioLzr(
  workspaceRoot: string,
  landingZoneId: string,
): Promise<PortfolioLzrSummary> {
  const assessedAt = new Date().toISOString().slice(0, 10);
  const appIds = discoverApps(workspaceRoot);

  // Cache keyed by `${providerId}:${landingZoneId}` -- apps sharing a platform
  // reuse the same adapter result without re-running the adapter.
  const cache = new Map<string, LandingZoneReadinessResult>();
  const apps: AppLzrResult[] = [];

  for (const appId of appIds) {
    const appDir = join(workspaceRoot, 'apps', appId);
    const adapterConfig = detectAdapterConfig(appId, appDir, landingZoneId);

    if (!adapterConfig) {
      apps.push({
        app_id: appId,
        provider_id: '',
        landing_zone_id: '',
        verdict: 'skipped',
        blocker_count: 0,
        warning_count: 0,
        skip_reason: 'no LZR imports found',
      });
      continue;
    }

    const cacheKey = `${adapterConfig.providerId}:${adapterConfig.landingZoneId}`;
    let lzrResult = cache.get(cacheKey);

    if (!lzrResult) {
      lzrResult = await runAdapter(adapterConfig);
      cache.set(cacheKey, lzrResult);
    }

    apps.push({
      app_id: appId,
      provider_id: lzrResult.provider_id,
      landing_zone_id: lzrResult.landing_zone_id,
      verdict: lzrResult.overall_verdict,
      blocker_count: lzrResult.blockers.length,
      warning_count: lzrResult.warnings.length,
      ...(adapterConfig.snapshotFile ? { source_snapshot: basename(adapterConfig.snapshotFile) } : {}),
      ...(adapterConfig.pickerLabel ? { picker_label: adapterConfig.pickerLabel } : {}),
      ...(adapterConfig.fabricated ? { lzr_snapshot_fabricated: true } : {}),
    });
  }

  const counts = {
    ready: apps.filter((a) => a.verdict === 'ready').length,
    blocked: apps.filter((a) => a.verdict === 'blocked').length,
    advisory: apps.filter((a) => a.verdict === 'advisory').length,
    skipped: apps.filter((a) => a.verdict === 'skipped').length,
  };

  const overall_verdict: Verdict =
    counts.blocked > 0 ? 'blocked' : counts.advisory > 0 ? 'advisory' : 'ready';

  return {
    assessed_at: assessedAt,
    total_apps: appIds.length,
    apps,
    counts,
    overall_verdict,
  };
}

// ---------------------------------------------------------------------------
// Portfolio LZR report formatter (used by report.ts --portfolio --view lzr)
// ---------------------------------------------------------------------------

export function formatPortfolioLzrReport(summary: PortfolioLzrSummary): string {
  const title = 'Portfolio Landing Zone Readiness Report';
  const lines: string[] = [
    title,
    '='.repeat(title.length),
    `Assessed: ${summary.assessed_at}`,
    `Apps:     ${summary.total_apps}`,
    '',
  ];

  const COL_APP = 22;
  const COL_PROV = 22;
  const COL_ZONE = 22;
  const COL_VERDICT = 10;
  const COL_BLK = 9;
  const COL_WARN = 9;
  const sep = '-'.repeat(COL_APP + COL_PROV + COL_ZONE + COL_VERDICT + COL_BLK + COL_WARN + 5);

  lines.push(
    `${'App'.padEnd(COL_APP)} ${'Provider'.padEnd(COL_PROV)} ${'Zone'.padEnd(COL_ZONE)} ${'Verdict'.padEnd(COL_VERDICT)} ${'Blockers'.padStart(COL_BLK)} ${'Warnings'.padStart(COL_WARN)}`,
  );
  lines.push(sep);

  for (const app of summary.apps) {
    // #1256: show picker_label (filename stem) in the zone column when available
    const zone = app.picker_label ?? app.landing_zone_id;
    // #1260: annotate READY with [SIM] when snapshot was fabricated
    const verdictStr = app.verdict.toUpperCase() + (app.lzr_snapshot_fabricated ? ' [SIM]' : '');
    const blockers = app.verdict === 'skipped' ? '-' : String(app.blocker_count);
    const warnings = app.verdict === 'skipped' ? '-' : String(app.warning_count);
    lines.push(
      `${app.app_id.padEnd(COL_APP)} ${(app.provider_id || '--').padEnd(COL_PROV)} ${(zone || '--').padEnd(COL_ZONE)} ${verdictStr.padEnd(COL_VERDICT)} ${blockers.padStart(COL_BLK)} ${warnings.padStart(COL_WARN)}`,
    );
  }

  lines.push(sep);
  lines.push('');
  lines.push(`Portfolio verdict: ${summary.overall_verdict.toUpperCase()}`);
  lines.push(
    `  ${summary.counts.ready} ready  ${summary.counts.advisory} advisory  ${summary.counts.blocked} blocked  ${summary.counts.skipped} skipped`,
  );
  lines.push('');

  return lines.join('\n');
}
