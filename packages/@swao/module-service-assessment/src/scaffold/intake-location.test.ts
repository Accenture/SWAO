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

// Default intake location wsp/inputs/service-intake/ (#3211).
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IntakeLocationError, SERVICE_INTAKE_DIR, resolveServiceIntake } from './intake-location.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function ws(files: string[]): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-intake-loc-'));
  dirs.push(d);
  mkdirSync(join(d, SERVICE_INTAKE_DIR), { recursive: true });
  for (const f of files) writeFileSync(join(d, SERVICE_INTAKE_DIR, f), 'x');
  return d;
}

describe('resolveServiceIntake (#3211)', () => {
  it('uses the single workbook and ignores Excel lock files', () => {
    const d = ws(['inventory.xlsx', '~$inventory.xlsx', 'notes.txt']);
    expect(resolveServiceIntake(d)).toEqual({ intakePath: join(d, SERVICE_INTAKE_DIR, 'inventory.xlsx'), mappingPath: null });
  });

  it('picks up exactly one column map next to the workbook', () => {
    const d = ws(['inventory.xlsx', 'intake-column-map.yaml']);
    expect(resolveServiceIntake(d).mappingPath).toBe(join(d, SERVICE_INTAKE_DIR, 'intake-column-map.yaml'));
    expect(resolveServiceIntake(ws(['a.xlsx', 'one.column-map.yml', 'two-column-map.yaml'])).mappingPath).toBeNull();
  });

  it('fails without a prompt when the folder is empty, missing, or ambiguous', () => {
    expect(() => resolveServiceIntake(ws([]))).toThrow(IntakeLocationError);
    expect(() => resolveServiceIntake(mkdtempSync(join(tmpdir(), 'swao-intake-none-')))).toThrow(/no intake workbook found/);
    expect(() => resolveServiceIntake(ws(['a.xlsx', 'b.xlsx']))).toThrow(/2 workbooks .*a\.xlsx, b\.xlsx/);
  });
});
