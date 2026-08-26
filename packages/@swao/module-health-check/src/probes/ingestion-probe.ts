// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health Check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// #0970: ingestion probe -- checks whether the workspace-level ingestion/
// folder (drop zone for unprocessed raw files) and per-app processed
// ingestion directories exist and have content.
//
// Status semantics:
//   ok        -- workspace drop zone: manifest present + at least one file
//   processed -- drop zone absent/empty, but apps/<app>/ingestion/ data exists
//                (the normal state after `swao ingest` has run)
//   warn      -- drop zone has files but no manifest (unprocessed)
//   info      -- drop zone exists but is empty (no files yet)
//   absent    -- no ingestion data anywhere (drop zone absent, no per-app data)

export type IngestionProbeStatus = 'ok' | 'warn' | 'info' | 'absent' | 'processed';

export interface IngestionProbeResult {
  status: IngestionProbeStatus;
  file_count: number;
  has_manifest: boolean;
  message: string;
  // Per-app processed ingestion data (#1212)
  apps_with_ingestion: string[];
  per_app_file_counts: Record<string, number>;
}

function scanPerAppIngestion(
  workspacePath: string,
): { apps: string[]; counts: Record<string, number> } {
  const apps: string[] = [];
  const counts: Record<string, number> = {};
  const appsDir = join(workspacePath, 'apps');
  if (!existsSync(appsDir)) return { apps, counts };
  let appDirs: string[];
  try {
    appDirs = readdirSync(appsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch { return { apps, counts }; }
  for (const appId of appDirs) {
    const appIngestionDir = join(appsDir, appId, 'ingestion');
    if (!existsSync(appIngestionDir)) continue;
    try {
      const files = readdirSync(appIngestionDir).filter(f => {
        try { return statSync(join(appIngestionDir, f)).isFile(); } catch { return false; }
      });
      if (files.length > 0) {
        apps.push(appId);
        counts[appId] = files.length;
      }
    } catch { /* skip unreadable app dir */ }
  }
  return { apps, counts };
}

export function buildIngestionProbe(workspacePath: string): IngestionProbeResult {
  const ingestionDir = join(workspacePath, 'ingestion');
  const { apps: appsWithIngestion, counts: perAppFileCounts } =
    scanPerAppIngestion(workspacePath);

  if (!existsSync(ingestionDir)) {
    if (appsWithIngestion.length > 0) {
      const summary = appsWithIngestion
        .map(id => `${id}(${perAppFileCounts[id]} files)`)
        .join(', ');
      return {
        status: 'processed',
        file_count: 0,
        has_manifest: false,
        message: `Context ingested into ${appsWithIngestion.length} app(s): ${summary}. Drop zone (workspace/ingestion/) is clear.`,
        apps_with_ingestion: appsWithIngestion,
        per_app_file_counts: perAppFileCounts,
      };
    }
    return {
      status: 'absent',
      file_count: 0,
      has_manifest: false,
      message: 'No ingestion/ directory found at workspace root and no per-app ingestion data.',
      apps_with_ingestion: [],
      per_app_file_counts: {},
    };
  }

  let entries: string[];
  try {
    entries = readdirSync(ingestionDir).filter(f => {
      try { return statSync(join(ingestionDir, f)).isFile(); } catch { return false; }
    });
  } catch {
    return {
      status: 'absent',
      file_count: 0,
      has_manifest: false,
      message: 'ingestion/ directory unreadable.',
      apps_with_ingestion: appsWithIngestion,
      per_app_file_counts: perAppFileCounts,
    };
  }

  const hasManifest = entries.includes('ingestion-manifest.json');
  const fileCount = entries.filter(f => f !== 'ingestion-manifest.json').length;

  if (fileCount === 0 && !hasManifest) {
    const appInfo = appsWithIngestion.length > 0
      ? ` ${appsWithIngestion.length} app(s) have processed context data.`
      : '';
    return {
      status: 'info',
      file_count: 0,
      has_manifest: false,
      message: `ingestion/ is empty. Drop files here before running an assessment.${appInfo}`,
      apps_with_ingestion: appsWithIngestion,
      per_app_file_counts: perAppFileCounts,
    };
  }

  if (!hasManifest) {
    return {
      status: 'warn',
      file_count: fileCount,
      has_manifest: false,
      message: `${fileCount} file(s) found but no ingestion-manifest.json. Run "swao ingest" or use Tools - Ingest Files to process them.`,
      apps_with_ingestion: appsWithIngestion,
      per_app_file_counts: perAppFileCounts,
    };
  }

  return {
    status: 'ok',
    file_count: fileCount,
    has_manifest: true,
    message: `${fileCount} file(s) indexed (ingestion-manifest.json present).`,
    apps_with_ingestion: appsWithIngestion,
    per_app_file_counts: perAppFileCounts,
  };
}
