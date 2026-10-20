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
 * Synthetic intake fixtures for the service scaffold tests (#3085).
 *
 * All data is invented: site prefixes HOS / ANX / OLD / REM, example.org
 * contacts, and phone numbers from no real person. Workbooks are generated at
 * test time from these rows so the fixture content is reviewable in a diff.
 */

import ExcelJS from 'exceljs';

/** PII values planted in the fixtures; no output file may contain any of them. */
export const PLANTED_PII = [
  '+49-123-456789',
  '+49 30 1234567',
  'erika@example.org',
  'support@example.org',
  'Erika Musterfrau',
  'Hans Beispiel',
  'Example Support Desk',
] as const;

export const DEFAULT_HEADERS = [
  'App ID', 'App Name', 'Vendor', 'Version', 'OS', 'CPU Cores', 'Memory (MB)', 'Disks',
  'Total Disk (GB)', 'Department', 'Migration Candidate', 'Contact', 'Phone', 'Email',
  'Integration Dependencies',
] as const;

type Row = Array<string | number | null>;

/** 20 rows in the recommended template layout (Design 103 §3.2). */
export const DEFAULT_TEMPLATE_ROWS: Row[] = [
  ['HOSAPP133', 'Radimetrics', 'Example Dose Vendor GmbH', '9.1', 'Windows Server 2016 (64-bit)', 4, 8192, 2, 143, 'Radiologie', 'YES', 'Erika Musterfrau', '+49-123-456789', 'erika@example.org', 'HOSAPP141'],
  ['HOSPACS004', 'PACS Storage', 'FUJIFILM', null, 'Windows Server 2016 (64-bit)', 4, 16384, 18, 47184, 'Radiologie', 'YES', null, null, null, null],
  ['HOSAPP200', 'Imaging Viewer', 'FUJIFILM', '7.2', 'Windows Server 2019', 2, 8192, 1, 100, 'Radiologie', 'NO', null, '+49 30 1234567', null, null],
  ['HOSAPP210', 'Carestream Vue', null, null, 'Windows Server 2016', 2, 4096, 1, 80, 'Radiologie', 'YES', null, null, null, null],
  ['HOSCIX001', 'Citrix Worker', 'Citrix', null, 'Windows Server 2019', 8, 32768, 1, 120, 'IT', 'YES', null, null, null, null],
  ['HOSCIX002', 'Citrix Worker', 'Citrix', null, 'Windows Server 2019', 8, 32768, 1, 120, 'IT', 'YES', null, null, null, null],
  ['HOSCIX003', 'Citrix Worker', 'Citrix', null, 'Windows Server 2019', 8, 32768, 1, 120, 'IT', 'YES', null, null, null, null],
  ['HOSCIX004', 'Citrix Worker', 'Citrix', null, 'Windows Server 2019', 8, 32768, 1, 120, 'IT', 'YES', null, null, null, null],
  ['HOSCIX005', 'Citrix Worker', 'Citrix', null, 'Windows Server 2019', 8, 32768, 1, 120, 'IT', 'YES', null, null, null, null],
  ['HOSAPP045', 'Payroll Suite', null, null, 'Windows Server 2012 R2', 2, 4096, 1, 60, 'Personal', 'NO', null, null, null, null],
  ['HOSAPP098', 'Room Booking', null, null, 'Debian GNU/Linux 10', 1, 2048, 1, 20, 'Verwaltung', 'NO', null, null, null, null],
  ['ANXAPP010', 'Labor Befund', null, null, 'SUSE Linux Enterprise 12', 2, 4096, 1, 40, 'Labor', 'YES', null, null, null, null],
  ['OLDSRV001', 'Domain Controller', null, null, 'Windows Server 2008 R2', 2, 4096, 1, 60, 'IT', 'NO', null, null, null, null],
  ['REMSRV002', 'Backup Server', 'Veeam', null, 'Windows Server 2016', 4, 8192, 4, 2000, 'IT', 'NO', null, null, null, null],
  ['HOSAPP300', 'ICCA', 'Hans Beispiel', null, 'Windows Server 2016', 4, 8192, 2, 200, 'Intensiv', 'NO', 'Example Support Desk', null, 'support@example.org', null],
  ['HOSAPP301', 'macmon NAC', null, null, 'Ubuntu 22.04', 2, 4096, 1, 40, 'IT', 'YES', null, null, null, null],
  ['HOSAPP302', 'Print Server', null, null, 'Windows Server 2019', 2, 4096, 1, 40, 'IT', 'YES', null, null, null, null],
  ['HOSAPP303', 'Exchange Mail Server', null, null, 'Windows Server 2016', 4, 16384, 2, 500, 'IT', 'YES', null, null, null, null],
  ['HOSAPP304', 'SQL Server Reporting', null, null, 'Windows Server 2016', 4, 16384, 2, 300, 'IT', 'YES', null, null, null, null],
  ['HOSAPP305', 'Konnektor', 'secunet', null, 'Debian GNU/Linux 11', 1, 2048, 1, 20, 'IT', 'NO', null, null, null, null],
];

/** Rows in a non-standard 18-column layout (A-R), read through MAPPED_COLUMN_MAP_YAML. */
export const MAPPED_ROWS: Row[] = [
  // A id+name, B cpu, C mem, D active mem, E disks, F disk MiB, G ip, H integration, I os, J migration,
  // K support holder (PII), L phone (PII), M url, N email (PII), O function, P domain, Q project, R sovereign
  ['HOSAPP133 (Radimetrics)', 4, 8192, 1310, 2, 146432, null, 'HOSAPP141', 'Windows Server 2016 (64-bit)', 'YES', 'Example Support Desk', '+49-123-456789', 'N/A', 'support@example.org', 'Dosimeter', 'Radiologie', null, null],
  ['HOSAPP045 (Payroll Applikation) nicht starten & nicht loschen!', 2, 4096, 512, 1, 61440, null, 'Nein', 'Windows Server 2012 R2', 'NO', null, null, 'N/A', null, null, 'Personal', null, null],
  ['HOSAPP050 (Old Archive) Alt Abgeschaltet', 2, 4096, 0, 1, 61440, null, null, 'Windows Server 2008 R2', 'NO', null, null, null, null, null, 'Verwaltung', null, null],
  ['HOSAPP051 (Spare VM) Ungenutzte Ressource. Nicht starten', 1, 2048, 0, 1, 20480, null, null, 'Debian GNU/Linux 10', 'NO', null, null, null, null, null, 'IT', null, null],
  ['HOSAPP060 (Idle Server)', 2, 4096, 0, 1, 40960, null, null, 'Windows Server 2016', 'NO', null, null, null, null, null, 'IT', null, null],
  ['HOSAPP153-MACMON', 2, 4096, 2048, 1, 40960, null, 'Anbindung ans PACS', 'Ubuntu 22.04', 'YES', null, null, null, null, null, 'Alle / IT', null, 'Ja'],
  ['HOSPACS004 (PACS Speicher)', 4, 16384, 1146, 18, 1048576, null, null, 'Windows Server 2016', 'YES', 'Example Support Desk', '+49 30 1234567', null, null, 'PACS Speicher Radiologie', 'Radiologie', null, null],
  ['HOSAPP070 (Report%2fExport)', 2, 4096, 1024, 1, 40960, null, null, 'Windows Server 2019', 'YES', null, null, null, null, null, 'Controlling', null, null],
];

export const MAPPED_COLUMN_MAP_YAML = `version: "1.0"
source:
  sheet: 1
  header_row: 1
  data_start_row: 2
fields:
  id_name_combined: { col: A, required: true, split_on: "(", strip_closing: ")", strip_flags: true }
  cpu_cores: { col: B, type: integer }
  memory_mb: { col: C, type: integer }
  active_memory_mb: { col: D, type: integer }
  disk_count: { col: E, type: integer }
  total_disk_mib: { col: F, type: integer, unit: mib }
  ip: { col: G, type: string }
  integrations_raw: { col: H, type: string, app_id_pattern: "^[A-Z]{3,10}[0-9]{3,6}(-[A-Z0-9]+)?$" }
  os: { col: I, required: true, type: string }
  migration_candidate: { col: J, type: boolean, true_values: ["YES", "Ja"], false_values: ["NO", "Nein", ""] }
  vendor_url: { col: M, type: string, null_values: ["N/A", "n/a", "", "-"] }
  business_function: { col: O, type: string }
  business_domain: { col: P, type: string, multi_value_separator: "/" }
  migration_project_vendor: { col: Q, type: string }
  ams_sovereign_cloud: { col: R, type: boolean, true_values: ["Ja", "YES"], false_values: ["Nein", "NO", ""] }
pii_columns:
  - { col: K, reason: vendor_support_name, stored_as: vendor.support_contact_present }
  - { col: L, reason: support_phone, stored_as: vendor.support_phone_present }
  - { col: N, reason: support_email, stored_as: vendor.support_email_present }
`;

export const MAPPED_HEADERS = [
  'VM', 'CPUs', 'Memory', 'Active Memory', 'Disks', 'Total disk capacity MiB', 'IP', 'Integration',
  'OS according to the configuration file', 'Migration', 'Hersteller Support', 'Telefonnummer', 'URL',
  'Kontakt', 'App-Funktion', 'Fachbereich', 'Migrationsprojekt mit Hersteller', 'Sovereign Cloud Ja / Nein',
] as const;

/** Tier 2 workspace catalogue: site map (G-01) and an override of a Tier 1 entry. */
export const TIER2_YAML = `id: INFRA_CUSTOM
name: "Engagement-specific entries"
sites:
  - { prefix: hos, site: "Main site" }
  - { prefix: anx, site: "Annex" }
  - { prefix: old, site: "Legacy site" }
  - { prefix: rem, site: "Remote site" }
services:
  - id: INFRA_MEDIZIN_PACS
    name: "PACS (engagement override)"
    sovereign_rating: proprietary
    data_health_implied: true
    regulatory: [MDR, GDPR_ART9]
    id_prefix_hints: [pacs]
    vendor_patterns: ["FUJIFILM"]
    product_name_patterns: ["\\\\bPACS\\\\b", "\\\\bCarestream\\\\b"]
    sovereign_alternatives:
      - { id: orthanc, name: "Orthanc (engagement default)", sovereign_rating: open-source }
`;

export async function writeWorkbook(
  path: string,
  sheets: Array<{ name: string; headers: readonly string[]; rows: Row[] }>,
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.addRow([...s.headers]);
    for (const r of s.rows) ws.addRow(r.map((v) => (v === null ? undefined : v)));
  }
  await wb.xlsx.writeFile(path);
}
