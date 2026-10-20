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
 * Single choke point for reading spreadsheet cells. exceljs returns rich-text,
 * hyperlink, formula, and error objects for some cells (email cells are often
 * hyperlinks); every read goes through cellText() so a raw cell object is never
 * serialised into an artefact.
 */

import type { FieldType } from '../schema/column-map.schema.js';

/** Plain text of an exceljs cell value; '' for empty, error, or unknown shapes. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v['richText'])) {
      return (v['richText'] as Array<{ text?: unknown }>).map((r) => (typeof r.text === 'string' ? r.text : '')).join('').trim();
    }
    if ('result' in v) return cellText(v['result']);
    if (typeof v['text'] === 'string') return v['text'].trim();
  }
  return '';
}

const CAPACITY_FACTORS: Record<string, number> = { kb: 1 / 1024, kib: 1 / 1024, mb: 1, mib: 1, gb: 1024, gib: 1024, tb: 1024 * 1024, tib: 1024 * 1024 };

/**
 * Parse a capacity with a unit suffix ("16 GB", "512 MiB", "1,5 TB") into the
 * target unit (binary multiples, as VM inventories report). Returns undefined
 * when the text has no unit suffix, so the caller falls back to the plain
 * numeric path.
 */
export function parseCapacity(text: string, target: 'mb' | 'mib' | 'gb'): number | null | undefined {
  const m = /^\s*([\d.,]+)\s*(kb|kib|mb|mib|gb|gib|tb|tib)\s*$/i.exec(text);
  if (!m) return undefined;
  const n = Number((m[1] as string).replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const mb = n * (CAPACITY_FACTORS[(m[2] as string).toLowerCase()] as number);
  return Math.round((target === 'gb' ? mb / 1024 : mb) * 100) / 100;
}

// #3210: German yes / no / not-specified forms map to the same canonical values.
export const DEFAULT_TRUE_VALUES = ['yes', 'ja', 'y', 'j', 'true', '1', 'x', 'wahr'];
export const DEFAULT_FALSE_VALUES = ['no', 'nein', 'n', 'false', '0', '', 'falsch'];
export const DEFAULT_NULL_VALUES = ['', 'n/a', 'na', 'n.a.', '-', '--', '~', 'null', 'none', 'k.a.', 'k. a.', 'keine angabe'];

export interface CoerceOptions {
  type: FieldType;
  trueValues?: readonly string[];
  falseValues?: readonly string[];
  nullValues?: readonly string[];
  separator?: string;
}

export type CoerceResult =
  | { ok: true; value: string | number | boolean | string[] | null }
  | { ok: false; reason: 'not_numeric' | 'unknown_boolean' };

/** Coerce cell text to the field type. Returns a reason (never the value) on failure. */
export function coerceCell(text: string, opts: CoerceOptions): CoerceResult {
  const nulls = (opts.nullValues ?? DEFAULT_NULL_VALUES).map((s) => s.toLowerCase());
  const t = text.trim();
  if (nulls.includes(t.toLowerCase())) return { ok: true, value: null };

  switch (opts.type) {
    case 'string':
      return { ok: true, value: t };
    case 'integer':
    case 'number': {
      const n = Number(t.replace(/\s/g, '').replace(/,(?=\d{1,2}$)/, '.'));
      if (!Number.isFinite(n)) return { ok: false, reason: 'not_numeric' };
      return { ok: true, value: opts.type === 'integer' ? Math.round(n) : n };
    }
    case 'boolean': {
      const lower = t.toLowerCase();
      const trues = (opts.trueValues ?? DEFAULT_TRUE_VALUES).map((s) => s.toLowerCase());
      const falses = (opts.falseValues ?? DEFAULT_FALSE_VALUES).map((s) => s.toLowerCase());
      if (trues.includes(lower)) return { ok: true, value: true };
      if (falses.includes(lower)) return { ok: true, value: false };
      return { ok: false, reason: 'unknown_boolean' };
    }
    case 'list': {
      const sep = opts.separator ?? ',';
      return { ok: true, value: t.split(sep).map((s) => s.trim()).filter((s) => s.length > 0) };
    }
  }
}
