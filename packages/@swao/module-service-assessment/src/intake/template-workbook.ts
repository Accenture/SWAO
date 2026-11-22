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
 * #4225 (owner decision D-3, 2026-11-09): the blank intake workbook template
 * SWAO ships. Its header row uses the English names of the default intake
 * template (DEFAULT_HEADER_ALIASES, Design 103 section 3.2), so every column
 * is recognised without a column map. The workbook is generated from this
 * list when it is copied (exceljs, already a dependency of this module), so
 * no binary file lives in the repository or the build assets.
 *
 * No personal-data columns (contact, phone, email): the template does not
 * invite personal data; the PII scrub still handles them when a client
 * workbook has them.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { serviceIntakeDir } from '../scaffold/intake-location.js';

/** File name of the template in the intake folder. */
export const INTAKE_TEMPLATE_FILE = 'service-intake-template.xlsx';

/** Sheet name of the template. */
export const INTAKE_TEMPLATE_SHEET = 'Intake';

/**
 * Header row of the template, in the recommended column order. Every name is
 * an exact alias of one field in DEFAULT_HEADER_ALIASES (pinned by the test).
 */
export const INTAKE_TEMPLATE_HEADERS: readonly string[] = [
  'App ID',
  'App Name',
  'Vendor',
  'Version',
  'Vendor Website',
  'Assessment Type',
  'Vendor Support Active',
  'Contract Expiry',
  'OS',
  'OS Support Status',
  'CPU Cores',
  'Memory (MB)',
  'Disks',
  'Total Disk (GB)',
  'Network Zone',
  'Authentication',
  'Backup / DR',
  'SLA Uptime (%)',
  'Department',
  'Function',
  'User Count',
  'Criticality',
  'Annual Cost (EUR)',
  'License Type',
  'Contains Personal Data (PII)',
  'Data Classification',
  'Data Residency',
  'Regulatory Obligations',
  'Migration Candidate',
  'Gartner TIME',
  'Integration Dependencies',
];

/** Writes the blank template (header row only) to `path`. */
export async function writeIntakeTemplateWorkbook(path: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SWAO';
  const ws = wb.addWorksheet(INTAKE_TEMPLATE_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  const header = ws.addRow([...INTAKE_TEMPLATE_HEADERS]);
  header.font = { bold: true };
  ws.columns.forEach((c, i) => { c.width = Math.max(12, (INTAKE_TEMPLATE_HEADERS[i] ?? '').length + 2); });
  await wb.xlsx.writeFile(path);
}

export interface IntakeTemplateCopy {
  /** Absolute path of the template in the intake folder. */
  path: string;
  /** False when a file of that name was there already (never overwritten). */
  created: boolean;
}

/**
 * Copies the blank template into `<workspace>/wsp/inputs/service-intake/`
 * (creating the folder). An existing file of the same name is kept, so a
 * template the operator already filled in is never overwritten.
 */
export async function copyIntakeTemplate(workspacePath: string): Promise<IntakeTemplateCopy> {
  const dir = serviceIntakeDir(workspacePath);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, INTAKE_TEMPLATE_FILE);
  if (existsSync(path)) return { path, created: false };
  await writeIntakeTemplateWorkbook(path);
  return { path, created: true };
}
