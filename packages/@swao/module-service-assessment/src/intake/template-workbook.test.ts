// #4225 (D-3): the blank intake workbook template matches the default column map.

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_HEADER_ALIASES, resolveDefaultMap } from './default-template.js';
import { parseIntakeWorkbook } from './parser.js';
import { isPiiHeader } from '../schema/column-map.schema.js';
import { SERVICE_INTAKE_DIR } from '../scaffold/intake-location.js';
import { copyIntakeTemplate, INTAKE_TEMPLATE_FILE, INTAKE_TEMPLATE_HEADERS, writeIntakeTemplateWorkbook } from './template-workbook.js';

const dirs: string[] = [];
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'swao-intake-tpl-')); dirs.push(d); return d; };
afterEach(() => { while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe('intake template headers (#4225)', () => {
  it('every header is an exact alias of a distinct field of the default template', () => {
    const fieldOf = (h: string): string | undefined => Object.entries(DEFAULT_HEADER_ALIASES).find(([, aliases]) => aliases!.includes(h.toLowerCase()))?.[0];
    const fields = INTAKE_TEMPLATE_HEADERS.map(fieldOf);
    expect(fields.filter((f) => f === undefined)).toEqual([]);
    expect(new Set(fields).size).toBe(INTAKE_TEMPLATE_HEADERS.length);
  });

  it('has no personal-data column', () => {
    expect(INTAKE_TEMPLATE_HEADERS.filter((h) => isPiiHeader(h))).toEqual([]);
  });

  it('resolves into a column map with every column recognised', () => {
    const map = resolveDefaultMap(new Map(INTAKE_TEMPLATE_HEADERS.map((h, i) => [i + 1, h])));
    expect(map).not.toBeNull();
    expect(Object.keys(map!.fields)).toHaveLength(INTAKE_TEMPLATE_HEADERS.length);
    expect(map!.pii_columns).toEqual([]);
  });
});

describe('writeIntakeTemplateWorkbook / copyIntakeTemplate (#4225)', () => {
  it('writes a workbook the intake parser reads with the default map and no data rows', async () => {
    const p = join(tmp(), INTAKE_TEMPLATE_FILE);
    await writeIntakeTemplateWorkbook(p);
    const r = await parseIntakeWorkbook(p);
    expect(r.rows).toHaveLength(0);
    expect(r.sheets).toHaveLength(1);
    expect(r.sheets[0]!.mapping).toBe('default');
    expect(Object.keys(r.sheets[0]!.headers)).toHaveLength(INTAKE_TEMPLATE_HEADERS.length);
  });

  it('copies the template into wsp/inputs/service-intake and never overwrites a file of that name', async () => {
    const ws = tmp();
    const first = await copyIntakeTemplate(ws);
    expect(first.created).toBe(true);
    expect(first.path).toBe(join(ws, SERVICE_INTAKE_DIR, INTAKE_TEMPLATE_FILE));
    writeFileSync(first.path, 'filled in by the operator');
    const second = await copyIntakeTemplate(ws);
    expect(second.created).toBe(false);
    expect(readFileSync(second.path, 'utf-8')).toBe('filled in by the operator');
  });
});
