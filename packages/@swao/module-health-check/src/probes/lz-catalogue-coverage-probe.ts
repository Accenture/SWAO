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

// #1698: LZ catalogue service-dep coverage probe.
// Validates that each provider/region in the active LZ catalogues has at
// least one service that fulfills each critical baseline service_dep code.
// Gaps are invisible until a customer runs `swao assess --type lz` and
// gets a spurious BLOCKED verdict.

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

// Baseline codes every region must fulfill (vm_compute, networking, etc.)
// plus at least one of the sovereignty alternatives (key_vault / secrets_management).
const BASELINE_CODES = ['vm_compute', 'networking', 'block_storage', 'object_storage'] as const;
const SOVEREIGNTY_ALTS = ['key_vault', 'secrets_management'] as const;

interface LzService {
  code?: string;
  status?: string;
  fulfills?: string[];
}

interface LzRegion {
  id?: string;
  services?: LzService[];
}

interface LzCatalogue {
  meta?: { provider?: string };
  regions?: LzRegion[];
}

export function buildLzCatalogueCoverageProbe(
  workspacePath: string,
): LzCatalogueCoverageProbeResult {
  const cataloguesDir = resolveLzCataloguesDir(workspacePath);
  if (!cataloguesDir || !existsSync(cataloguesDir)) {
    return {
      status: 'info',
      message: 'No LZ catalogues directory found -- bundled catalogues may not be installed',
      detail: '',
      gaps_count: 0,
    };
  }

  let files: string[];
  try {
    files = readdirSync(cataloguesDir)
      .filter(f => f.endsWith('.json') && f !== 'index.json' && !f.endsWith('-service-meta.json'));
  } catch {
    return { status: 'fail', message: 'Could not read LZ catalogues directory', detail: '', gaps_count: 0 };
  }

  const gapLines: string[] = [];

  for (const file of files) {
    let catalogue: LzCatalogue;
    try {
      catalogue = JSON.parse(readFileSync(join(cataloguesDir, file), 'utf-8')) as LzCatalogue;
    } catch {
      continue;
    }

    const provider = catalogue.meta?.provider ?? file.replace('.json', '');
    const regions = catalogue.regions ?? [];

    for (const region of regions) {
      const regionId = region.id ?? 'unknown';
      const fulfillsSet = new Set<string>();
      for (const svc of (region.services ?? [])) {
        for (const code of (svc.fulfills ?? [])) fulfillsSet.add(code);
      }

      const missing: string[] = [];
      for (const code of BASELINE_CODES) {
        if (!fulfillsSet.has(code)) missing.push(code);
      }
      const hasSovereigntyAlt = SOVEREIGNTY_ALTS.some(a => fulfillsSet.has(a));
      if (!hasSovereigntyAlt) missing.push(`(${SOVEREIGNTY_ALTS.join(' or ')})`);

      if (missing.length > 0) {
        gapLines.push(`${provider}/${regionId}: [${missing.join(', ')}]`);
      }
    }
  }

  if (gapLines.length === 0) {
    return {
      status: 'ok',
      message: `All ${files.length} provider catalogue(s) pass baseline service coverage check`,
      detail: '',
      gaps_count: 0,
    };
  }

  return {
    status: 'warn',
    message: `${gapLines.length} provider/region(s) missing critical service codes`,
    detail: gapLines.join('; '),
    gaps_count: gapLines.length,
  };
}
