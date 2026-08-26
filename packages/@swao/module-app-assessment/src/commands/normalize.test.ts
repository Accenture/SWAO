// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Tests for `swao normalize` (#0442).
// Uses real temp directories; no mocking of file IO.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';

import { classifyFile } from '../normalize/classifier.js';
import { sha256, findExactDuplicates } from '../normalize/dedup.js';
import { xlsxToCsv } from '../normalize/transformer.js';
import { runNormalize } from './normalize.js';

const TMP = join(tmpdir(), `swao-normalize-test-${process.pid}`);

beforeAll(() => {
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. classifyFile -- cmdb XLSX
// ---------------------------------------------------------------------------
describe('classifyFile -- cmdb_export.xlsx (#0442)', () => {
  it('returns category cmdb for cmdb_export.xlsx', () => {
    const filePath = join(TMP, 'cmdb_export.xlsx');
    const result = classifyFile(filePath, 'cmdb_export.xlsx');
    expect(result.category).toBe('cmdb');
    expect(result.targetSubdir).toBe('operations/');
    expect(result.requiresLlm).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. classifyFile -- arch-overview.md
// ---------------------------------------------------------------------------
describe('classifyFile -- arch-overview.md (#0442)', () => {
  it('returns category architecture, requiresLlm false', () => {
    const filePath = join(TMP, 'arch-overview.md');
    const result = classifyFile(filePath, 'arch-overview.md');
    expect(result.category).toBe('architecture');
    expect(result.requiresLlm).toBe(false);
    expect(result.targetSubdir).toBe('architecture/');
  });
});

// ---------------------------------------------------------------------------
// 3. classifyFile -- workshop-notes.docx
// ---------------------------------------------------------------------------
describe('classifyFile -- workshop-notes.docx (#0442)', () => {
  it('returns category workshops, requiresLlm true', () => {
    const filePath = join(TMP, 'workshop-notes.docx');
    const result = classifyFile(filePath, 'workshop-notes.docx');
    expect(result.category).toBe('workshops');
    expect(result.requiresLlm).toBe(true);
    expect(result.targetSubdir).toBe('workshops/');
  });
});

// ---------------------------------------------------------------------------
// 4. sha256 -- consistent hash for same content
// ---------------------------------------------------------------------------
describe('sha256 (#0442)', () => {
  it('returns consistent hash for the same file content', () => {
    const file = join(TMP, 'sha256-test.txt');
    writeFileSync(file, 'hello world');
    const h1 = sha256(file);
    const h2 = sha256(file);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// 5. findExactDuplicates -- detects duplicates
// ---------------------------------------------------------------------------
describe('findExactDuplicates (#0442)', () => {
  it('detects two identical files as duplicates', () => {
    const fileA = join(TMP, 'dup-a.csv');
    const fileB = join(TMP, 'dup-b.csv');
    const content = 'col1,col2\nval1,val2';
    writeFileSync(fileA, content);
    writeFileSync(fileB, content);

    const result = findExactDuplicates([fileA, fileB]);
    expect(result.size).toBe(1);
    const paths = Array.from(result.values())[0];
    expect(paths).toContain(fileA);
    expect(paths).toContain(fileB);
  });

  it('does not report unique files as duplicates', () => {
    const fileA = join(TMP, 'unique-a.csv');
    const fileB = join(TMP, 'unique-b.csv');
    writeFileSync(fileA, 'aaa');
    writeFileSync(fileB, 'bbb');

    const result = findExactDuplicates([fileA, fileB]);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. xlsxToCsv -- converts a minimal XLSX to CSV
// ---------------------------------------------------------------------------
describe('xlsxToCsv (#0442)', () => {
  it('converts a real XLSX (created via exceljs) to a CSV string', async () => {
    const xlsxPath = join(TMP, 'test-data.xlsx');
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Sheet1');
    ws.addRow(['Name', 'Value', 'Cost']);
    ws.addRow(['Alpha', 100, 9.99]);
    ws.addRow(['Beta', 200, 19.99]);
    await workbook.xlsx.writeFile(xlsxPath);

    const csv = await xlsxToCsv(xlsxPath);
    expect(csv).toContain('Name');
    expect(csv).toContain('Value');
    expect(csv).toContain('Cost');
    expect(csv).toContain('Alpha');
    expect(csv).toContain('100');
    expect(csv).toContain('9.99');
    // Check it is multi-line (rows separated by newlines)
    const lines = csv.split('\n').filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// 7. runNormalize --dry-run: prints classification, writes no files
// ---------------------------------------------------------------------------
describe('runNormalize --dry-run (#0442)', () => {
  it('prints classification, writes no output files', async () => {
    const wsDir = join(TMP, 'workspace-dryrun');
    mkdirSync(join(wsDir, 'wsp', 'intake'), { recursive: true });
    writeFileSync(join(wsDir, '.swao.yml'), 'assessment:\n  lenses: []\n', 'utf-8');
    writeFileSync(
      join(wsDir, 'wsp', 'intake', 'cmdb_data.csv'),
      'hostname,os\nserver1,linux',
      'utf-8',
    );

    const result = await runNormalize({
      dryRun: true,
      cwd: wsDir,
    });

    // No files should be written to wsp/inputs/.
    const inputsDir = join(wsDir, 'wsp', 'inputs');
    expect(existsSync(inputsDir)).toBe(false);

    // No report should be written.
    const reportPath = join(wsDir, 'wsp', 'normalize-report.yaml');
    expect(existsSync(reportPath)).toBe(false);

    // Result should show the file was classified.
    expect(result.filesProcessed.length).toBeGreaterThan(0);
    const entry = result.filesProcessed[0];
    expect(entry).toBeDefined();
    expect(entry!.category).toBe('cmdb');
  });
});

// ---------------------------------------------------------------------------
// 8. runNormalize --no-llm with XLSX (cmdb pattern): converts to CSV
// ---------------------------------------------------------------------------
describe('runNormalize --no-llm with cmdb XLSX (#0442)', () => {
  it('converts cmdb XLSX to CSV in wsp/inputs/operations/', async () => {
    const wsDir = join(TMP, 'workspace-nollm');
    mkdirSync(join(wsDir, 'wsp', 'intake'), { recursive: true });
    writeFileSync(join(wsDir, '.swao.yml'), 'assessment:\n  lenses: []\n', 'utf-8');

    // Create a minimal cmdb XLSX.
    const xlsxPath = join(wsDir, 'wsp', 'intake', 'cmdb_export.xlsx');
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('CMDB');
    ws.addRow(['hostname', 'os', 'environment']);
    ws.addRow(['server1', 'linux', 'prod']);
    await workbook.xlsx.writeFile(xlsxPath);

    const result = await runNormalize({
      noLlm: true,
      cwd: wsDir,
    });

    // Should have converted and written to operations/.
    const outputCsv = join(wsDir, 'wsp', 'inputs', 'operations', 'cmdb_export.csv');
    expect(existsSync(outputCsv)).toBe(true);

    expect(result.filesProcessed.length).toBeGreaterThan(0);
    const entry = result.filesProcessed[0];
    expect(entry).toBeDefined();
    expect(entry!.action).toBe('converted_xlsx_to_csv');
    expect(entry!.category).toBe('cmdb');

    // Report should be written.
    const reportPath = join(wsDir, 'wsp', 'normalize-report.yaml');
    expect(existsSync(reportPath)).toBe(true);
  });
});
