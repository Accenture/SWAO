// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service Assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4489 (Design 103 section 21.1): an intake whose column map gives no app a
// vendor name warns at the import (plan, service init, scaffold-signals.json),
// because CVE lookups and the vendor consolidation stay empty.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planServiceInit, runServiceInit, vendorCoverageWarning, serviceAppVendorNames, NO_VENDOR_COLUMN_WARNING_PREFIX } from '../scaffold/init.js';
import { tier2Dir } from '../catalog/infra-cat.js';
import { DEFAULT_HEADERS, DEFAULT_TEMPLATE_ROWS, MAPPED_COLUMN_MAP_YAML, MAPPED_HEADERS, MAPPED_ROWS, TIER2_YAML, writeWorkbook } from './fixtures/scaffold-fixture.js';

const tmp: string[] = [];
afterAll(() => { for (const d of tmp) rmSync(d, { recursive: true, force: true }); });

function newWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-4489-'));
  tmp.push(ws);
  writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
  mkdirSync(tier2Dir(ws), { recursive: true });
  writeFileSync(join(tier2Dir(ws), 'custom.yaml'), TIER2_YAML);
  return ws;
}

describe('vendorCoverageWarning (#4489)', () => {
  it('warns only when no app has a vendor name', () => {
    expect(vendorCoverageWarning([undefined, '', '  '])).toBe(`${NO_VENDOR_COLUMN_WARNING_PREFIX}: 0 of 3 apps have a vendor name; CVE lookups and vendor consolidation need a vendor column (field vendor_name; the product is the app name); map one in the column map`);
    expect(vendorCoverageWarning([undefined, 'FUJIFILM'])).toBeNull();
    expect(vendorCoverageWarning([])).toBeNull();
  });
});

describe('import of an intake without a vendor column (#4489)', () => {
  it('the plan and service init carry the warning; scaffold-signals.json records it', async () => {
    const ws = newWorkspace();
    const xlsx = join(ws, 'inventory.xlsx');
    const map = join(ws, 'column-map.yaml');
    await writeWorkbook(xlsx, [{ name: 'Inventory', headers: MAPPED_HEADERS, rows: MAPPED_ROWS }]);
    writeFileSync(map, MAPPED_COLUMN_MAP_YAML);
    const plan = await planServiceInit({ workspacePath: ws, intakePath: xlsx, mappingPath: map });
    expect(plan.ok && plan.warnings.some((w) => w.startsWith(NO_VENDOR_COLUMN_WARNING_PREFIX))).toBe(true);
    const res = await runServiceInit({ workspacePath: ws, intakePath: xlsx, mappingPath: map });
    expect(res.ok && res.warnings.some((w) => w.startsWith(NO_VENDOR_COLUMN_WARNING_PREFIX))).toBe(true);
    const file = JSON.parse(readFileSync(join(ws, 'wsp', 'signals', 'scaffold-signals.json'), 'utf-8')) as { warnings: string[] };
    expect(file.warnings.some((w) => w.startsWith(NO_VENDOR_COLUMN_WARNING_PREFIX))).toBe(true);
    expect(serviceAppVendorNames(ws).every((v) => v === undefined)).toBe(true);
  });

  it('an intake with vendor names does not warn', async () => {
    const ws = newWorkspace();
    const xlsx = join(ws, 'intake.xlsx');
    await writeWorkbook(xlsx, [{ name: 'Sheet1', headers: DEFAULT_HEADERS, rows: DEFAULT_TEMPLATE_ROWS }]);
    const plan = await planServiceInit({ workspacePath: ws, intakePath: xlsx });
    expect(plan.ok && plan.warnings.some((w) => w.startsWith(NO_VENDOR_COLUMN_WARNING_PREFIX))).toBe(false);
  });
});
