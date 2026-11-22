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
import { buildLzrFromLiveRun, lzrLiveNotRecorded, readLzrLiveRun, NOT_RECORDED_BY_LZ_LIVE } from './providers/lz-live-run-adapter.js';
import { findLzrInputFiles, runLzrPass } from '../passes/index.js';
import { deriveLzrProviderId } from '@swao/module-app-assessment';
import { providerLabel, providerName } from '@swao/core';

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
  /** #4351: human label of the cloud provider of the evaluated snapshot, from the central name map (#4296). */
  provider_label?: string;
  /** #4351: set when the snapshot comes from a landing zone platform (meshStack) that manages the provider. */
  platform?: 'meshstack';
  /** #4351: provider-name-map id of the cloud provider (`aws`, `azure`, `stackit`; for meshStack the managed cloud). */
  provider_map_id?: string;
  /** #4351 (run 6): where the row came from; absent on rows written before the LZ Live source existed. */
  source_kind?: 'snapshot' | 'terraform' | 'lz-live-run';
  /** #4351 (run 6): the LZ Live run read as the snapshot source (source_kind `lz-live-run`). */
  live_run?: { lz_id: string; run_id: string; status: 'complete' | 'partial'; finished_at: string; folder: string };
  /** #4351 (run 6): LZR fields the LZ Live run does not record ("not recorded by LZ Live"), never invented. */
  not_recorded?: string[];
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
  /** #4351: provider id of the cloud a meshStack platform manages (from the snapshot platform_id). */
  managedProvider?: string;
}

/** #4351: the snapshot kinds an operator can pick for a Portfolio LZR run. */
export type LzrSnapshotKind = 'meshstack' | 'aws' | 'azure' | 'terraform';

/** #4351: snapshot file name of each picked kind (the Terraform route reads any *.tfstate or *.tfplan). */
export const LZR_SNAPSHOT_FILES: Readonly<Record<Exclude<LzrSnapshotKind, 'terraform'>, string>> = {
  meshstack: 'lz-meshstack-snapshot.json',
  aws: 'lz-aws-snapshot.json',
  azure: 'lz-azure-snapshot.json',
};

/**
 * #4351: the snapshot kind a `--lzr <label>` value picks. The TUI picker
 * passes `lz-meshstack-01`, `lz-aws-01`, `lz-azure-01` or `lz-terraform-01`;
 * the CLI accepts the same labels, the file stem (`lz-azure`) or the file
 * name (`lz-azure-snapshot.json`). A label whose second token names no
 * snapshot kind (for example `lz-stackit-de-01`) picks nothing, and the
 * adapter keeps the fixed priority (meshStack, AWS, Azure, Terraform).
 */
export function lzrSelectionFromLabel(label: string | undefined): LzrSnapshotKind | null {
  if (!label) return null;
  let s = label.trim().toLowerCase();
  if (s.endsWith('.json')) s = s.slice(0, -'.json'.length);
  const tokens = s.split('-');
  if (tokens[0] !== 'lz') return null;
  const kind = tokens[1];
  return kind === 'meshstack' || kind === 'aws' || kind === 'azure' || kind === 'terraform' ? kind : null;
}

/** #4351 (run 6): picker and `--lzr` prefix of an LZ Live run as the snapshot source (`live:otc-prod`). */
export const LZR_LIVE_LABEL_PREFIX = 'live:';

const LZ_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/;

/**
 * #4351 (run 6): the landing zone id a `--lzr live:<lz-id>` value picks, or
 * null when the label is not a live label. The colon keeps it apart from the
 * snapshot labels (landing zone ids carry hyphens, `otc-prod`).
 */
export function lzrLiveSelectionFromLabel(label: string | undefined): string | null {
  if (!label) return null;
  const s = label.trim();
  if (!s.toLowerCase().startsWith(LZR_LIVE_LABEL_PREFIX)) return null;
  const id = s.slice(LZR_LIVE_LABEL_PREFIX.length);
  return LZ_ID_RE.test(id) ? id : null;
}

/**
 * #4351: the provider-name-map id of an LZR provider id such as
 * `aws_eu_central_1` or `stackit_de_sovereign` (its first token), or the id
 * itself when the first token is not in the map.
 */
export function lzrProviderMapId(providerId: string): string {
  if (!providerId) return '';
  const first = providerId.split(/[_-]/)[0] ?? providerId;
  return providerName(first) ? first : providerId;
}

/** #4351: human label of the provider of a result row ("Azure, Microsoft Azure"; "STACKIT through meshStack"). */
export function lzrProviderText(app: Pick<AppLzrResult, 'provider_id' | 'platform' | 'picker_label' | 'provider_map_id'>, form: 'pair' | 'abbr' = 'pair'): string {
  if (!app.provider_id) return '';
  const label = providerLabel(app.provider_map_id ?? lzrProviderMapId(app.provider_id), form);
  const viaMeshstack = app.platform === 'meshstack' || app.picker_label === 'lz-meshstack';
  return viaMeshstack ? `${label} through meshStack` : label;
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

  const snapshotConfig = (kind: Exclude<LzrSnapshotKind, 'terraform'>): AppAdapterConfig | null => {
    const file = join(importsDir, LZR_SNAPSHOT_FILES[kind]);
    if (!existsSync(file)) return null;
    const ids = kind === 'meshstack'
      ? { providerId: MESHSTACK_PROVIDER, landingZoneId: MESHSTACK_LZ }
      : kind === 'aws'
        ? { providerId: AWS_PROVIDER, landingZoneId: AWS_LZ }
        : { providerId: AZURE_PROVIDER, landingZoneId: AZURE_LZ };
    const managedProvider = kind === 'meshstack' ? readManagedProvider(file) : undefined;
    return {
      appId,
      appDir,
      adapterType: kind,
      ...ids,
      snapshotFile: file,
      pickerLabel: snapshotPickerLabel(file),
      fabricated: readFabricatedFlag(file),
      ...(managedProvider ? { managedProvider } : {}),
    };
  };

  const terraformConfig = (): AppAdapterConfig | null => {
    if (findLzrInputFiles(appDir).length === 0) return null;
    return {
      appId,
      appDir,
      adapterType: 'terraform',
      // #3153: derived from the landing-zone ID instead of hard-coding STACKIT.
      providerId: deriveLzrProviderId({ landingZoneId }).providerId,
      landingZoneId,
    };
  };

  // #4351: the snapshot the operator picked (TUI picker or `--lzr <label>`)
  // is the one evaluated. A picked kind this app does not have is not
  // replaced by another snapshot: the app is skipped (see pickedSnapshotMissing).
  // #4351 (run 6): a live label is never a snapshot file and never falls back to the priority below.
  if (lzrLiveSelectionFromLabel(landingZoneId) !== null) return null;
  const selection = lzrSelectionFromLabel(landingZoneId);
  if (selection) return selection === 'terraform' ? terraformConfig() : snapshotConfig(selection);

  // Without a selection: priority meshstack > aws > azure > terraform.
  return snapshotConfig('meshstack') ?? snapshotConfig('aws') ?? snapshotConfig('azure') ?? terraformConfig();
}

/** #4351: the skip reason of an app that lacks the picked snapshot, or null when nothing was picked. */
export function pickedSnapshotMissing(landingZoneId: string): string | null {
  const live = lzrLiveSelectionFromLabel(landingZoneId);
  if (live !== null) return `no usable LZ Live run of landing zone ${live}`;
  const selection = lzrSelectionFromLabel(landingZoneId);
  if (!selection) return null;
  const what = selection === 'terraform' ? 'no *.tfstate or *.tfplan file' : `picked snapshot ${LZR_SNAPSHOT_FILES[selection]} not found`;
  return `${what} in wsp/inputs/terraform/`;
}

/** #4351: provider-map id of the cloud a meshStack platform manages, from the snapshot platform_id (`stackit-de-01`). */
function readManagedProvider(snapshotPath: string): string | undefined {
  try {
    const snap = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as { platform_id?: unknown };
    if (typeof snap.platform_id !== 'string') return undefined;
    const first = snap.platform_id.split(/[_.-]/)[0]?.toLowerCase() ?? '';
    return providerName(first) ? first : undefined;
  } catch {
    return undefined;
  }
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

/** #4351: the provider display fields of a result row: map id, label, and the meshStack platform marker. */
function lzrProviderFields(providerId: string, config: AppAdapterConfig): Pick<AppLzrResult, 'provider_map_id' | 'provider_label' | 'platform'> {
  const platform = config.adapterType === 'meshstack' ? ('meshstack' as const) : undefined;
  const mapId = config.managedProvider ?? lzrProviderMapId(providerId);
  const row = { provider_id: providerId, provider_map_id: mapId, ...(platform ? { platform } : {}) };
  return { provider_map_id: mapId, provider_label: lzrProviderText(row), ...(platform ? { platform } : {}) };
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

  // #4351 (run 6, owner decision 2026-11-12): `live:<lz-id>` reads the newest
  // LZ Live run of that landing zone from disk (never a cloud API). The run is
  // landing zone level, so it is evaluated once and applies to every app; an
  // unusable run skips every app with the reason, never another source.
  const liveLzId = lzrLiveSelectionFromLabel(landingZoneId);
  if (liveLzId !== null) {
    const run = readLzrLiveRun(workspaceRoot, liveLzId);
    if (typeof run === 'string') {
      for (const appId of appIds) {
        apps.push({ app_id: appId, provider_id: '', landing_zone_id: '', verdict: 'skipped', blocker_count: 0, warning_count: 0, skip_reason: run, source_kind: 'lz-live-run' });
      }
    } else {
      const result = buildLzrFromLiveRun(run);
      const mapId = lzrProviderMapId(result.provider_id);
      const notRecorded = lzrLiveNotRecorded(run);
      for (const appId of appIds) {
        apps.push({
          app_id: appId,
          provider_id: result.provider_id,
          landing_zone_id: result.landing_zone_id,
          verdict: result.overall_verdict,
          blocker_count: result.blockers.length,
          warning_count: result.warnings.length,
          source_snapshot: `landing-zones/${run.lzId}/wsp/runs/${run.runId}/`,
          picker_label: `${LZR_LIVE_LABEL_PREFIX}${run.lzId}`,
          ...(run.simulated ? { lzr_snapshot_fabricated: true } : {}),
          provider_map_id: mapId,
          provider_label: lzrProviderText({ provider_id: result.provider_id, provider_map_id: mapId }),
          source_kind: 'lz-live-run',
          live_run: { lz_id: run.lzId, run_id: run.runId, status: run.status, finished_at: run.finishedAt, folder: `landing-zones/${run.lzId}/wsp/runs/${run.runId}/` },
          not_recorded: notRecorded,
        });
      }
    }
    return summarise(assessedAt, appIds.length, apps);
  }

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
        // #4351: a picked snapshot this app lacks is named; no other snapshot stands in.
        skip_reason: pickedSnapshotMissing(landingZoneId) ?? 'no LZR imports found',
      });
      continue;
    }

    const cacheKey = `${adapterConfig.adapterType}:${adapterConfig.providerId}:${adapterConfig.landingZoneId}`;
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
      ...lzrProviderFields(lzrResult.provider_id, adapterConfig),
      source_kind: adapterConfig.adapterType === 'terraform' ? 'terraform' : 'snapshot',
    });
  }

  return summarise(assessedAt, appIds.length, apps);
}

function summarise(assessedAt: string, totalApps: number, apps: AppLzrResult[]): PortfolioLzrSummary {
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
    total_apps: totalApps,
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
  const COL_PROV = 26;
  const COL_ZONE = 16;
  const COL_VERDICT = 15;
  const COL_BLK = 9;
  const COL_WARN = 9;
  const sep = '-'.repeat(COL_APP + COL_PROV + COL_ZONE + COL_VERDICT + COL_BLK + COL_WARN + 5);

  lines.push(
    `${'App'.padEnd(COL_APP)} ${'Provider'.padEnd(COL_PROV)} ${'Snapshot'.padEnd(COL_ZONE)} ${'Verdict'.padEnd(COL_VERDICT)} ${'Blockers'.padStart(COL_BLK)} ${'Warnings'.padStart(COL_WARN)}`,
  );
  lines.push(sep);

  for (const app of summary.apps) {
    // #1256: show picker_label (filename stem) in the zone column when available
    const zone = app.picker_label ?? app.landing_zone_id;
    // #1260: annotate READY with [SIM] when snapshot was fabricated
    const verdictStr = app.verdict.toUpperCase() + (app.lzr_snapshot_fabricated ? ' [SIM]' : '');
    const blockers = app.verdict === 'skipped' ? '-' : String(app.blocker_count);
    const warnings = app.verdict === 'skipped' ? '-' : String(app.warning_count);
    // #4351: the provider through the central name map; no double hyphen placeholder in report output.
    const provider = lzrProviderText(app, 'abbr');
    lines.push(
      `${app.app_id.padEnd(COL_APP)} ${(provider || '-').padEnd(COL_PROV)} ${(zone || '-').padEnd(COL_ZONE)} ${verdictStr.padEnd(COL_VERDICT)} ${blockers.padStart(COL_BLK)} ${warnings.padStart(COL_WARN)}`,
    );
  }

  lines.push(sep);
  lines.push('');
  // #4351: which file drove each row, the provider in full, and why a row was skipped.
  for (const app of summary.apps) {
    if (app.verdict === 'skipped') {
      lines.push(`${app.app_id}: skipped, ${app.skip_reason ?? 'no landing zone snapshot'}`);
      continue;
    }
    if (app.live_run) {
      // #4351 (run 6): the LZ Live run, its finish time and status, and what it does not record.
      const r = app.live_run;
      const sim = app.lzr_snapshot_fabricated ? ', simulated (mock CSP)' : '';
      lines.push(`${app.app_id}: LZ Live run ${r.run_id} of ${r.lz_id} (${r.status}, finished ${r.finished_at}), ${lzrProviderText(app, 'pair')}${sim}, ${r.folder}`);
      continue;
    }
    const source = app.source_snapshot ?? 'Terraform state or plan';
    const sample = app.lzr_snapshot_fabricated ? ', sample data' : '';
    lines.push(`${app.app_id}: ${source}, ${lzrProviderText(app, 'pair')}${sample}`);
  }
  const notRecorded = summary.apps.find((a) => a.not_recorded && a.not_recorded.length > 0)?.not_recorded;
  if (notRecorded) {
    lines.push(`Not recorded by LZ Live: ${notRecorded.join(', ')}. These fields are reported as ${NOT_RECORDED_BY_LZ_LIVE}, never as passed.`);
  }
  if (summary.apps.some((a) => a.platform === 'meshstack' || a.picker_label === 'lz-meshstack')) {
    lines.push('meshStack is a landing zone platform; the provider shown is the cloud it manages.');
  }
  if (summary.apps.some((a) => a.lzr_snapshot_fabricated && !a.live_run)) {
    lines.push('[SIM]: the snapshot is a sample file seeded by swao init, not an export of the client landing zone.');
  }
  if (summary.apps.some((a) => a.lzr_snapshot_fabricated && a.live_run)) {
    lines.push('[SIM]: the LZ Live run was served by a mock CSP environment, not by the client tenant.');
  }
  lines.push('');
  lines.push(`Portfolio verdict: ${summary.overall_verdict.toUpperCase()}`);
  lines.push(
    `  ${summary.counts.ready} ready  ${summary.counts.advisory} advisory  ${summary.counts.blocked} blocked  ${summary.counts.skipped} skipped`,
  );
  lines.push('');

  return lines.join('\n');
}
