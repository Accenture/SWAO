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
 * Excel intake parser (Design 103 §3.2-§3.4, §21.1, #3077, #3081, #3082).
 *
 * Reads rows through a ColumnMap (custom `--mapping` file, or the default
 * template resolved from each sheet's header row). PII columns are reduced to
 * presence booleans as they are read. Nothing returned by this module carries
 * a PII value; warnings and signal evidence reference sheet / row / column only.
 */

import ExcelJS from 'exceljs';
import { scaffoldSignal, type ScaffoldSignal } from '@swao/core';
import {
  type ColumnMap,
  type FieldKey,
  type FieldMapping,
  type FieldType,
  FIELD_REGISTRY,
  columnToIndex,
  indexToColumn,
} from '../schema/column-map.schema.js';
import { cellText, coerceCell, parseCapacity, DEFAULT_NULL_VALUES } from './cell.js';
import { detectOperationalFlag, normaliseAppId, parseIdNameCell, type ParsedIdName } from './column-a.js';
import { piiKindOf, resolveDefaultMap } from './default-template.js';
import { emptyPresence, looksLikePersonalName, REDACTED_CONTACT_NAME, type PiiPresence } from './pii.js';

/** Minimal sheet abstraction so the parser is testable without an .xlsx file. */
export interface SheetLike {
  name: string;
  rowCount: number;
  /** Raw cell value at 1-based row / column (exceljs CellValue or a plain value). */
  cell(row: number, col: number): unknown;
}

export type ParsedValue = string | number | boolean | string[] | null;

export interface IntakeRow {
  sheet: string;
  row: number;
  appId: string;
  appName: string;
  flag?: ParsedIdName['flag'];
  values: Partial<Record<FieldKey, ParsedValue>>;
  domains: string[];
  integrations: string[];
  integrationsNotes: string | null;
  pii: PiiPresence;
  vendorRedacted: boolean;
  /** Fields the sheet's column layout mapped (#3196). */
  mappedFields: FieldKey[];
}

export interface IntakeSheetInfo {
  name: string;
  /** Header names keyed by column letter (names only; header text is not PII). */
  headers: Record<string, string>;
  mapping: 'default' | 'custom';
  rows: number;
  /** Mapped field -> column letter (#3168 recognised-columns report; header names only). */
  fields: Partial<Record<FieldKey, string>>;
}

export interface IntakeParseResult {
  rows: IntakeRow[];
  sheets: IntakeSheetInfo[];
  signals: ScaffoldSignal[];
  warnings: string[];
  duplicateIds: string[];
}

export class IntakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntakeError';
  }
}

export interface ParseOptions {
  /** Validated custom column map; omit to use the default template per sheet. */
  map?: ColumnMap;
  /** INFRA-CAT vendor_patterns, so known vendors are never redacted as personal names. */
  knownVendors?: readonly string[];
  /** File label used in signal evidence (basename only). */
  sourceLabel?: string;
}

/** Capacity fields and their storage unit; values with a unit suffix are converted (#3108). */
const CAPACITY_UNIT: Partial<Record<FieldKey, 'mb' | 'mib' | 'gb'>> = { memory_mb: 'mb', active_memory_mb: 'mb', total_disk_mib: 'mib', total_disk_gb: 'gb' };

const DEFAULT_APP_ID_PATTERN = /^[A-Za-z][A-Za-z_]{1,11}\d{2,6}(?:-[A-Za-z0-9]+)?$/;
const GENERIC_SHEET_NAME = /^(sheet|tabelle|blatt|table)\s*\d+$/i;
const YES_NO = /^(ja|nein|yes|no|y|n|j|true|false|x)$/i;

function headerMap(sheet: SheetLike, headerRow: number): Map<number, string> {
  const headers = new Map<number, string>();
  if (headerRow < 1) return headers;
  for (let c = 1; c <= 52; c++) {
    const h = cellText(sheet.cell(headerRow, c));
    if (h) headers.set(c, h);
  }
  return headers;
}

function nullValuesFor(m: FieldMapping): string[] {
  return m.null_values ? [...m.null_values, ''] : DEFAULT_NULL_VALUES;
}

function selectSheets(sheets: readonly SheetLike[], map?: ColumnMap): SheetLike[] {
  const wanted = map?.source.sheet;
  if (wanted === undefined) return map ? sheets.slice(0, 1) : [...sheets];
  const found = typeof wanted === 'number' ? sheets[wanted - 1] : sheets.find((s) => s.name === wanted);
  if (!found) throw new IntakeError(`sheet not found: ${typeof wanted === 'number' ? `index ${wanted}` : `"${wanted}"`} (workbook has ${sheets.length} sheet(s))`);
  return [found];
}

/** Parse already-loaded sheets. Pure apart from the inputs; see parseIntakeWorkbook for files. */
export function parseIntakeSheets(sheets: readonly SheetLike[], opts: ParseOptions = {}): IntakeParseResult {
  const source = opts.sourceLabel ?? 'intake';
  const rows: IntakeRow[] = [];
  const infos: IntakeSheetInfo[] = [];
  const signals: ScaffoldSignal[] = [];
  const warnings: string[] = [];
  const typeFailures = new Map<string, { failures: number; total: number; reason: string }>();
  const piiCounts = new Map<string, number>();
  let vendorRedactions = 0;
  const osMissing: string[] = [];

  for (const sheet of selectSheets(sheets, opts.map)) {
    const map = opts.map ?? resolveDefaultMap(headerMap(sheet, 1));
    if (!map) {
      warnings.push(`sheet "${sheet.name}": no identity column found in header row; sheet skipped`);
      continue;
    }
    const headers = headerMap(sheet, map.source.header_row);
    infos.push({
      name: sheet.name,
      headers: Object.fromEntries([...headers].map(([i, h]) => [indexToColumn(i), h])),
      mapping: opts.map ? 'custom' : 'default',
      rows: 0,
      fields: Object.fromEntries(Object.entries(map.fields).map(([k, f]) => [k, indexToColumn(columnToIndex((f as FieldMapping).col))])) as Partial<Record<FieldKey, string>>,
    });
    const info = infos[infos.length - 1] as IntakeSheetInfo;

    const fields = map.fields as Partial<Record<FieldKey, FieldMapping>>;
    const mappedCols = [
      ...Object.values(fields).map((f) => columnToIndex((f as FieldMapping).col)),
      ...map.pii_columns.map((p) => columnToIndex(p.col)),
    ];

    for (let r = map.source.data_start_row; r <= sheet.rowCount; r++) {
      if (mappedCols.every((c) => cellText(sheet.cell(r, c)) === '')) continue;
      const where = `${source} sheet "${sheet.name}" row ${r}`;

      // Identity (mandatory)
      let ident: ParsedIdName;
      const combined = fields.id_name_combined;
      if (combined) {
        ident = parseIdNameCell(cellText(sheet.cell(r, columnToIndex(combined.col))), {
          ...(combined.split_on ? { splitOn: combined.split_on } : {}),
          ...(combined.strip_closing !== undefined ? { stripClosing: combined.strip_closing } : {}),
          stripFlags: combined.strip_flags ?? true,
        });
      } else {
        const idText = fields.id ? cellText(sheet.cell(r, columnToIndex(fields.id.col))) : '';
        const nameText = fields.name ? cellText(sheet.cell(r, columnToIndex(fields.name.col))) : '';
        // #3167: the same identity rules as the combined form (code, bracket
        // name, flags, notes dropped); a separate name column wins.
        const parsed = parseIdNameCell(idText);
        const flag = parsed.flag ?? detectOperationalFlag(nameText);
        ident = { id: parsed.id, name: nameText || parsed.name, ...(flag ? { flag } : {}) };
      }
      if (!ident.id) {
        signals.push(scaffoldSignal('SCAFFOLD.MANDATORY_FIELD_MISSING', {
          derivation: 'Row has data but its identity (app ID) cell is blank; no app folder can be created for it.',
          evidence: [`${where}: identity column blank`],
        }));
        continue;
      }
      info.rows++;

      // PII columns: presence only
      const pii = emptyPresence();
      for (const p of map.pii_columns) {
        const text = cellText(sheet.cell(r, columnToIndex(p.col)));
        if (!text || DEFAULT_NULL_VALUES.includes(text.toLowerCase())) continue;
        const kind = piiKindOf(p, headers.get(columnToIndex(p.col)) ?? '');
        pii[kind === 'phone' ? 'support_phone_present' : kind === 'email' ? 'support_email_present' : 'support_contact_present'] = true;
        const key = indexToColumn(columnToIndex(p.col));
        piiCounts.set(key, (piiCounts.get(key) ?? 0) + 1);
      }

      // Mapped fields
      const values: Partial<Record<FieldKey, ParsedValue>> = {};
      let domains: string[] = [];
      let integrations: string[] = [];
      let integrationsNotes: string | null = null;
      let vendorRedacted = false;

      for (const [key, m] of Object.entries(fields) as Array<[FieldKey, FieldMapping]>) {
        if (key === 'id_name_combined' || key === 'id' || key === 'name') continue;
        const col = columnToIndex(m.col);
        const text = cellText(sheet.cell(r, col));

        if (key === 'integrations_raw') {
          if (!text || nullValuesFor(m).includes(text.toLowerCase())) continue;
          const pattern = m.app_id_pattern ? new RegExp(m.app_id_pattern, 'i') : DEFAULT_APP_ID_PATTERN;
          const tokens = text.split(/[,;\s]+/).filter(Boolean);
          const ids = tokens.filter((t) => pattern.test(t)).map(normaliseAppId);
          integrations = [...new Set(ids)];
          if (ids.length === 0 && !YES_NO.test(text)) integrationsNotes = text;
          continue;
        }

        const capUnit = CAPACITY_UNIT[key];
        const cap = capUnit ? parseCapacity(text, capUnit) : undefined;
        if (cap !== undefined) {
          const stat = typeFailures.get(key) ?? { failures: 0, total: 0, reason: 'not_numeric' };
          stat.total++;
          if (cap === null) stat.failures++;
          typeFailures.set(key, stat);
          values[key] = cap;
          if (key === 'total_disk_mib' && cap !== null) values.total_disk_gb = Math.round(cap / 1024);
          continue;
        }
        const type: FieldType = m.type ?? FIELD_REGISTRY[key].type;
        const res = coerceCell(text, {
          type: m.multi_value_separator && type === 'string' ? 'list' : type,
          nullValues: nullValuesFor(m),
          ...(m.true_values ? { trueValues: m.true_values } : {}),
          ...(m.false_values ? { falseValues: m.false_values } : {}),
          ...(m.multi_value_separator ? { separator: m.multi_value_separator } : {}),
        });
        const stat = typeFailures.get(key) ?? { failures: 0, total: 0, reason: '' };
        if (text) stat.total++;
        if (!res.ok) {
          stat.failures++;
          stat.reason = res.reason;
          typeFailures.set(key, stat);
          values[key] = null;
          continue;
        }
        typeFailures.set(key, stat);
        let value = res.value;

        if (key === 'business_domain' && Array.isArray(value)) {
          domains = value;
          value = value[0] ?? null;
        }
        if (key === 'vendor_name' && typeof value === 'string' && looksLikePersonalName(value, opts.knownVendors)) {
          value = REDACTED_CONTACT_NAME;
          vendorRedacted = true;
          vendorRedactions++;
        }
        if (key === 'total_disk_mib' && typeof value === 'number' && m.unit !== 'gb') {
          values.total_disk_gb = Math.round(value / 1024);
        }
        values[key] = value;
      }

      // G-09: sheet name as business.domain fallback
      if ((values.business_domain === undefined || values.business_domain === null) && !GENERIC_SHEET_NAME.test(sheet.name)) {
        values.business_domain = sheet.name;
      }
      if (domains.length === 0 && typeof values.business_domain === 'string') domains = [values.business_domain];

      if (fields.os && (values.os === null || values.os === undefined || values.os === '')) osMissing.push(ident.id);
      if (!fields.os) osMissing.push(ident.id);

      rows.push({
        sheet: sheet.name,
        row: r,
        appId: ident.id,
        appName: ident.name,
        ...(ident.flag ? { flag: ident.flag } : {}),
        values,
        domains,
        integrations,
        integrationsNotes,
        pii,
        vendorRedacted,
        mappedFields: Object.keys(fields) as FieldKey[],
      });

      if (ident.flag) {
        signals.push(scaffoldSignal('SCAFFOLD.ID_FLAG_DETECTED', {
          derivation: `Operational flag "${ident.flag}" detected in the identity cell (Design 103 §3.3.2, G-03).`,
          evidence: [`${where}`],
          appId: ident.id,
        }));
      }
    }
  }

  // Aggregated signals and warnings (counts and column letters only)
  for (const [col, count] of piiCounts) {
    signals.push(scaffoldSignal('SCAFFOLD.PII_FIELD_SCRUBBED', {
      derivation: `PII column ${col} values were discarded at scaffold time and stored as presence booleans only (G-06).`,
      evidence: [`${source} column ${col}: ${count} non-empty value(s) scrubbed`],
    }));
  }
  if (vendorRedactions > 0) {
    signals.push(scaffoldSignal('SCAFFOLD.PII_FIELD_SCRUBBED', {
      derivation: 'Vendor name values that look like a personal name were replaced with a redaction marker (G-06).',
      evidence: [`${source} vendor_name: ${vendorRedactions} value(s) redacted; enter the company name manually`],
    }));
  }
  if (osMissing.length > 0) {
    signals.push(scaffoldSignal('SCAFFOLD.MANDATORY_FIELD_MISSING', {
      derivation: 'Operating system is blank or not mapped; the end-of-life lookup will be partial for these apps (§18.3).',
      evidence: osMissing.slice(0, 200).map((id) => `app ${id}: os blank`),
      confidence: 'medium',
    }));
  }
  for (const [key, s] of typeFailures) {
    if (s.failures === 0) continue;
    const label = s.reason === 'unknown_boolean' ? 'not in true_values / false_values' : 'not numeric';
    warnings.push(`field ${key}: ${s.failures} of ${s.total} value(s) ${label}; stored as null`);
  }

  // Duplicate IDs halt the scaffold (validated before any folder is written)
  const byId = new Map<string, IntakeRow[]>();
  for (const row of rows) byId.set(row.appId, [...(byId.get(row.appId) ?? []), row]);
  const duplicateIds: string[] = [];
  for (const [id, group] of byId) {
    if (group.length < 2) continue;
    duplicateIds.push(id);
    signals.push(scaffoldSignal('SCAFFOLD.DUPLICATE_ID', {
      derivation: `App ID "${id}" is produced by ${group.length} rows; the scaffold cannot continue until IDs are unique.`,
      evidence: group.map((g) => `${source} sheet "${g.sheet}" row ${g.row}`),
      appId: id,
    }));
  }

  return { rows, sheets: infos, signals, warnings, duplicateIds };
}

/** Adapt an exceljs worksheet to SheetLike. */
function adaptWorksheet(ws: ExcelJS.Worksheet): SheetLike {
  return {
    name: ws.name,
    rowCount: ws.rowCount,
    cell: (row, col) => ws.getRow(row).getCell(col).value,
  };
}

/** Load an .xlsx file and parse it. */
export async function parseIntakeWorkbook(filePath: string, opts: ParseOptions = {}): Promise<IntakeParseResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
  } catch (e) {
    throw new IntakeError(`cannot read intake workbook: ${(e as Error).message}`);
  }
  return parseIntakeSheets(workbook.worksheets.map(adaptWorksheet), opts);
}
