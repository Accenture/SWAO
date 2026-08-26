// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Doctor module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';

export type BiExportProbeStatus = 'ok' | 'warn' | 'absent' | 'fail';

export interface BiExportFinding {
  path: string;
  rows_expected: number;
  rows_actual: number;
  sha_expected: string;
  sha_actual: string;
  status: 'ok' | 'mismatch' | 'missing';
  error: string | null;
}

export interface BiExportProbeResult {
  status: BiExportProbeStatus;
  bundle_dir: string | null;
  findings: BiExportFinding[];
  message: string;
}

interface ManifestFile {
  path: string;
  rows: number;
  sha256: string;
  bytes: number;
}
interface Manifest {
  files: ManifestFile[];
  bundle_schema_version?: string;
  app_id?: string;
}

/**
 * Collect all candidate bundle roots under `base`.
 *
 * Symmetric dual-wsp (#0230): both portfolio-scope and per-app-scope
 * outputs live under a `wsp/exports/<ts>/` directory. Order checked,
 * most-recent-first across all roots:
 *
 * 1. `<base>/wsp/exports/<ts>/`           -- portfolio bundle when `base`
 *                                             is the workspace root, or
 *                                             single-app bundle when
 *                                             `base` is an app dir
 * 2. `<base>/apps/<id>/wsp/exports/<ts>/` -- per-app bundles inside a
 *                                             portfolio workspace
 */
function findLatestBundleDir(base: string): string | null {
  const candidates: Array<{ dir: string; mtime: number }> = [];

  const collect = (exportsRoot: string): void => {
    if (!existsSync(exportsRoot)) return;
    for (const entry of readdirSync(exportsRoot)) {
      const manifestPath = join(exportsRoot, entry, 'manifest.yaml');
      if (!existsSync(manifestPath)) continue;
      candidates.push({
        dir: join(exportsRoot, entry),
        mtime: statSync(join(exportsRoot, entry)).mtimeMs,
      });
    }
  };

  // 1. Direct: <base>/wsp/exports/<ts>/  (portfolio root, or single-app dir)
  collect(join(base, 'wsp', 'exports'));

  // 2. Per-app: <base>/apps/<id>/wsp/exports/<ts>/
  const appsDir = join(base, 'apps');
  if (existsSync(appsDir)) {
    for (const appId of readdirSync(appsDir)) {
      const appPath = join(appsDir, appId);
      if (!statSync(appPath).isDirectory()) continue;
      collect(join(appPath, 'wsp', 'exports'));
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]!.dir;
}

function countCsvDataRows(filePath: string): number {
  // eslint-disable-next-line no-irregular-whitespace
  const body = readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
  const lines = body.split(/\r?\n/).filter((l) => l.length > 0);
  return Math.max(0, lines.length - 1); // minus header
}

function countNdjsonRows(filePath: string): number {
  const body = readFileSync(filePath, 'utf-8');
  return body.split(/\r?\n/).filter((l) => l.length > 0).length;
}

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * Doctor `bi-export` probe (#0181). Verifies the most recent BI bundle
 * under `wsp/exports/<ts>/`:
 *
 * - Each file referenced by `manifest.yaml` exists
 * - Row counts in the manifest match parsed CSV / NDJSON row counts
 * - SHA-256 hashes match recomputed hashes
 *
 * Status:
 * - `absent`  no bundle directory found (no `swao export` has run)
 * - `fail`    a referenced file is missing or unreadable
 * - `warn`    row counts or hashes drift (post-emission tampering)
 * - `ok`      every file resolves and matches the manifest
 */
export function buildBiExportProbe(workspaceAppDir: string): BiExportProbeResult {
  const bundleDir = findLatestBundleDir(workspaceAppDir);
  if (!bundleDir) {
    return {
      status: 'absent',
      bundle_dir: null,
      findings: [],
      message: 'no BI bundle under wsp/exports/ yet (run `swao export`)',
    };
  }

  const manifestPath = join(bundleDir, 'manifest.yaml');
  let manifest: Manifest;
  try {
    manifest = load(readFileSync(manifestPath, 'utf-8')) as Manifest;
  } catch (e) {
    return {
      status: 'fail',
      bundle_dir: bundleDir,
      findings: [],
      message: `manifest.yaml unreadable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const findings: BiExportFinding[] = [];
  for (const f of manifest.files ?? []) {
    const fullPath = join(bundleDir, f.path);
    if (!existsSync(fullPath)) {
      findings.push({
        path: f.path,
        rows_expected: f.rows,
        rows_actual: 0,
        sha_expected: f.sha256,
        sha_actual: '',
        status: 'missing',
        error: `file not found: ${fullPath}`,
      });
      continue;
    }
    const isCsv = f.path.endsWith('.csv');
    const isNdjson = f.path.endsWith('.ndjson');
    const rows = isCsv ? countCsvDataRows(fullPath) : isNdjson ? countNdjsonRows(fullPath) : f.rows;
    const sha = sha256(fullPath);
    const rowsMatch = rows === f.rows;
    const shaMatch = sha === f.sha256;
    findings.push({
      path: f.path,
      rows_expected: f.rows,
      rows_actual: rows,
      sha_expected: f.sha256,
      sha_actual: sha,
      status: rowsMatch && shaMatch ? 'ok' : 'mismatch',
      error: null,
    });
  }

  let status: BiExportProbeStatus = 'ok';
  if (findings.some((f) => f.status === 'missing')) status = 'fail';
  else if (findings.some((f) => f.status === 'mismatch')) status = 'warn';

  const message = (() => {
    const total = findings.length;
    const okCount = findings.filter((f) => f.status === 'ok').length;
    if (status === 'ok') return `bundle OK (${total} files, all rows + hashes match)`;
    if (status === 'warn') {
      const mCount = findings.filter((f) => f.status === 'mismatch').length;
      return `${okCount}/${total} OK; ${mCount} row/hash drift -- bundle modified after emission?`;
    }
    const missingCount = findings.filter((f) => f.status === 'missing').length;
    return `${okCount}/${total} OK; ${missingCount} file(s) missing`;
  })();

  return { status, bundle_dir: bundleDir, findings, message };
}
