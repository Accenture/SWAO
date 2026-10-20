// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * VM price table resolution for the cost model (#3288, Design 110 D-23).
 *
 * Order:
 *   1. workspace: <workspace>/wsp/inputs/catalogs/lz-catalogues/prices/vm-prices.json
 *      (written by `swao lz catalogue update`, same folder convention as the
 *      workspace LZ catalogues)
 *   2. bundled: walk up from this module to `_lz-catalogues/prices/` (binary
 *      bundle, build-lib copies lz-catalogues/** there) or
 *      `lz-catalogues/prices/` (repo and dev).
 *
 * A workspace table that is not valid JSON or fails the schema stops the
 * scaffold with a clear error instead of silently falling back.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeParseVmPriceTable, VM_PRICE_TABLE_FILE, type VmPriceTable } from '@swao/core';

export type PriceTableOrigin = 'workspace' | 'bundled';

export interface LoadedPriceTable {
  table: VmPriceTable;
  origin: PriceTableOrigin;
  path: string;
}

export class PriceTableError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`Invalid VM price table ${path}: ${detail}`);
    this.name = 'PriceTableError';
  }
}

export function workspacePriceTablePath(workspacePath: string): string {
  return join(workspacePath, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', VM_PRICE_TABLE_FILE);
}

/** Bundled price table path, or null when none is found. */
export function resolveBundledPriceTablePath(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    for (const name of ['_lz-catalogues', 'lz-catalogues']) {
      const candidate = join(dir, name, VM_PRICE_TABLE_FILE);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function readPriceTable(path: string): VmPriceTable {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    throw new PriceTableError(path, `not valid JSON: ${(e as Error).message}`);
  }
  const r = safeParseVmPriceTable(raw);
  if (!r.ok) throw new PriceTableError(path, r.issues.join('; '));
  return r.table;
}

/** Workspace table when present, else the bundled one; null when neither exists. */
export function loadPriceTable(opts: { workspacePath?: string } = {}): LoadedPriceTable | null {
  if (opts.workspacePath) {
    const ws = workspacePriceTablePath(opts.workspacePath);
    if (existsSync(ws)) return { table: readPriceTable(ws), origin: 'workspace', path: ws };
  }
  const bundled = resolveBundledPriceTablePath();
  return bundled ? { table: readPriceTable(bundled), origin: 'bundled', path: bundled } : null;
}
