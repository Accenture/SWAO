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

// #1698 / #2222: LZ catalogue structural validity probe.
// Checks that each catalogue file in the workspace LZ catalogues directory
// is valid JSON and has the required top-level fields (meta.provider, regions).
// Service coverage gaps are NOT checked -- those vary by deployment target and
// are not a health concern.

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { resolveLzCataloguesDir } from '@swao/module-landing-zone';

export type LzCatalogueCoverageStatus = 'ok' | 'warn' | 'info' | 'fail';

export interface LzCatalogueCoverageProbeResult {
  status: LzCatalogueCoverageStatus;
  message: string;
  detail: string;
  gaps_count: number;
}

export function buildLzCatalogueCoverageProbe(
  workspacePath: string,
): LzCatalogueCoverageProbeResult {
  const cataloguesDir = resolveLzCataloguesDir(workspacePath);
  if (!cataloguesDir || !existsSync(cataloguesDir)) {
    return {
      status: 'info',
      message: 'No LZ catalogues directory found -- run Update LZ Catalogue (Tools menu)',
      detail: '',
      gaps_count: 0,
    };
  }

  let files: string[];
  try {
    files = readdirSync(cataloguesDir)
      .filter(f =>
        f.endsWith('.json') &&
        f !== 'index.json' &&
        !f.startsWith('_') &&
        !f.endsWith('-service-meta.json') &&
        !f.endsWith('-template.json'),
      );
  } catch {
    return { status: 'fail', message: 'Could not read LZ catalogues directory', detail: '', gaps_count: 0 };
  }

  if (files.length === 0) {
    return {
      status: 'info',
      message: 'LZ catalogues directory is empty -- run Update LZ Catalogue (Tools menu)',
      detail: '',
      gaps_count: 0,
    };
  }

  const invalidFiles: string[] = [];

  for (const file of files) {
    try {
      const raw = readFileSync(join(cataloguesDir, file), 'utf-8');
      const parsed = JSON.parse(raw) as { meta?: { provider?: string }; regions?: unknown[] };
      if (!parsed.meta?.provider || !Array.isArray(parsed.regions)) {
        invalidFiles.push(`${file}: missing meta.provider or regions`);
      }
    } catch {
      invalidFiles.push(`${file}: invalid JSON`);
    }
  }

  if (invalidFiles.length === 0) {
    return {
      status: 'ok',
      message: `${files.length} LZ catalogue(s) present and structurally valid`,
      detail: '',
      gaps_count: 0,
    };
  }

  return {
    status: 'warn',
    message: `${invalidFiles.length} of ${files.length} catalogue(s) have structural issues`,
    detail: invalidFiles.join('; '),
    gaps_count: invalidFiles.length,
  };
}
